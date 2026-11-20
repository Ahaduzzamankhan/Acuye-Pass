use std::path::PathBuf;

use acuye_updater::{self, ReleaseChannel, UpdateCandidate, VerifiedUpdate};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::commands::lock_core;
use crate::error::{ApiError, ApiResult};
use crate::state::{persist_settings, AppState, UpdateRuntime, UpdateStage};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusView {
    pub current_version: String,
    pub channel: String,
    pub stage: UpdateStage,
    pub available: Option<UpdateCandidate>,
    pub verified: Option<VerifiedUpdate>,
    pub progress: Option<u64>,
    pub total: Option<u64>,
    pub error: Option<String>,
    pub signing_configured: bool,
    pub repository: String,
    pub last_check: Option<i64>,
    pub download_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    received: u64,
    total: u64,
}

fn signing_key() -> Option<String> {
    if let Some(key) = acuye_updater::embedded_public_key() {
        return Some(key);
    }
    // Development-only overrides. Release builds must embed the key at compile
    // time so no local file can alter update trust.
    if cfg!(debug_assertions) {
        if let Ok(key) = std::env::var("ACUYE_UPDATER_PUBKEY") {
            if !key.trim().is_empty() {
                return Some(key.trim().to_string());
            }
        }
    }
    None
}

fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn view(core_channel: &str, last_check: Option<i64>, runtime: &UpdateRuntime) -> UpdateStatusView {
    let stage = runtime.stage.unwrap_or(UpdateStage::Idle);
    let progress = runtime.progress.map(|(received, _)| received);
    let total = runtime
        .progress
        .map(|(_, total)| total)
        .filter(|total| *total > 0);
    UpdateStatusView {
        current_version: current_version(),
        channel: core_channel.to_string(),
        stage,
        available: runtime.candidate.clone(),
        verified: runtime.verified.clone(),
        progress,
        total,
        error: runtime.error.clone(),
        signing_configured: signing_key().is_some(),
        repository: acuye_updater::OFFICIAL_REPO_SLUG.into(),
        last_check: runtime.last_check.or(last_check),
        download_path: runtime
            .download_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub fn update_status(state: State<'_, AppState>) -> ApiResult<UpdateStatusView> {
    let core = lock_core(&state)?;
    let runtime = state.update.lock().map_err(|_| ApiError::internal())?;
    Ok(view(
        &core.settings.update_channel,
        core.settings.last_update_check,
        &runtime,
    ))
}

#[tauri::command]
pub fn check_for_updates(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> ApiResult<UpdateStatusView> {
    let (channel, last_check, auto_check) = {
        let core = lock_core(&state)?;
        (
            core.settings.update_channel.clone(),
            core.settings.last_update_check,
            core.settings.update_auto_check,
        )
    };
    if !force.unwrap_or(false) && !auto_check {
        let runtime = state.update.lock().map_err(|_| ApiError::internal())?;
        return Ok(view(&channel, last_check, &runtime));
    }

    let parsed_channel = ReleaseChannel::parse(&channel)?;
    let mut runtime = state.update.lock().map_err(|_| ApiError::internal())?;
    if runtime.checking {
        return Ok(view(&channel, last_check, &runtime));
    }
    runtime.checking = true;
    runtime.error = None;
    runtime.stage = Some(UpdateStage::Checking);
    drop(runtime);

    let result = acuye_updater::check_for_updates(
        &acuye_updater::GithubReleaseSource,
        &current_version(),
        parsed_channel,
        true,
    );

    let now = acuye_core::time::now();
    let mut runtime = state.update.lock().map_err(|_| ApiError::internal())?;
    runtime.checking = false;
    runtime.last_check = Some(now);
    match result {
        Ok(Some(candidate)) => {
            if let Err(error) = acuye_updater::ensure_upgrade(&current_version(), &candidate) {
                runtime.stage = Some(UpdateStage::Failed);
                runtime.error = Some(error.to_string());
            } else {
                runtime.stage = Some(UpdateStage::Available);
                runtime.candidate = Some(candidate);
                runtime.verified = None;
                runtime.download_path = None;
                runtime.progress = None;
            }
        }
        Ok(None) => {
            runtime.stage = Some(UpdateStage::UpToDate);
            runtime.candidate = None;
            runtime.verified = None;
            runtime.download_path = None;
            runtime.progress = None;
        }
        Err(error) => {
            runtime.stage = Some(UpdateStage::Failed);
            runtime.error = Some(error.to_string());
        }
    }

    // Persist the check timestamp without disturbing other settings.
    if let Ok(mut core) = state.core.lock() {
        core.settings.last_update_check = Some(now);
        let _ = persist_settings(core.auth.db(), &core.settings);
    }

    Ok(view(&channel, Some(now), &runtime))
}

#[tauri::command]
pub fn download_update(app: AppHandle, state: State<'_, AppState>) -> ApiResult<UpdateStatusView> {
    let (channel, last_check, candidate, signing) = {
        let core = lock_core(&state)?;
        let runtime = state.update.lock().map_err(|_| ApiError::internal())?;
        (
            core.settings.update_channel.clone(),
            core.settings.last_update_check,
            runtime.candidate.clone(),
            signing_key(),
        )
    };
    let Some(candidate) = candidate else {
        return Err(ApiError::validation("Check for updates first"));
    };
    if signing.is_none() {
        return Err(ApiError::validation(
            "This build has no updater signing key configured, so updates cannot be verified",
        ));
    }

    let destination = {
        let core = lock_core(&state)?;
        core.paths
            .updates
            .join(&candidate.version)
            .join(&candidate.asset.name)
    };
    let runtime = state.update.clone();
    {
        let mut guard = runtime.lock().map_err(|_| ApiError::internal())?;
        if guard.stage == Some(UpdateStage::Downloading) {
            return Err(ApiError::validation("A download is already in progress"));
        }
        guard.stage = Some(UpdateStage::Downloading);
        guard.error = None;
        guard.progress = Some((0, candidate.asset.size));
    }

    let handle = app.clone();
    let task_runtime = runtime.clone();
    let task_candidate = candidate.clone();
    std::thread::spawn(move || {
        let mut last_emitted = 0u64;
        let result = acuye_updater::download_installer(
            &task_candidate,
            &destination,
            &mut |received, total| {
                if received.saturating_sub(last_emitted) >= 256 * 1024 {
                    last_emitted = received;
                    if let Ok(mut guard) = task_runtime.lock() {
                        guard.progress = Some((received, total));
                    }
                    let _ = handle.emit("update://progress", ProgressPayload { received, total });
                }
            },
        );
        if let Ok(mut guard) = task_runtime.lock() {
            match result {
                Ok(()) => {
                    guard.stage = Some(UpdateStage::Downloaded);
                    guard.download_path = Some(destination.clone());
                    guard.progress = None;
                    guard.error = None;
                }
                Err(error) => {
                    guard.stage = Some(UpdateStage::Failed);
                    guard.error = Some(error.to_string());
                    guard.download_path = None;
                    guard.progress = None;
                }
            }
        }
        let _ = handle.emit("update://finished", ());
    });

    let runtime = state.update.lock().map_err(|_| ApiError::internal())?;
    Ok(view(&channel, last_check, &runtime))
}

#[tauri::command]
pub fn verify_update(state: State<'_, AppState>) -> ApiResult<UpdateStatusView> {
    let (channel, last_check, candidate, path): (
        String,
        Option<i64>,
        Option<UpdateCandidate>,
        Option<PathBuf>,
    ) = {
        let core = lock_core(&state)?;
        let runtime = state.update.lock().map_err(|_| ApiError::internal())?;
        (
            core.settings.update_channel.clone(),
            core.settings.last_update_check,
            runtime.candidate.clone(),
            runtime.download_path.clone(),
        )
    };
    let candidate =
        candidate.ok_or_else(|| ApiError::validation("No update is available to verify"))?;
    let path: PathBuf =
        path.ok_or_else(|| ApiError::validation("Download the update before verifying it"))?;
    let Some(public_key) = signing_key() else {
        return Err(ApiError::validation(
            "This build has no updater signing key configured",
        ));
    };

    let signature = acuye_updater::fetch_signature(&candidate);
    let mut runtime = state.update.lock().map_err(|_| ApiError::internal())?;
    match signature {
        Ok(signature) => {
            match acuye_updater::verify_installer(&path, &signature, &public_key, &candidate) {
                Ok(verified) => {
                    runtime.stage = Some(UpdateStage::Verified);
                    runtime.verified = Some(verified);
                    runtime.error = None;
                }
                Err(error) => {
                    runtime.stage = Some(UpdateStage::Failed);
                    runtime.verified = None;
                    runtime.error = Some(error.to_string());
                    let _ = std::fs::remove_file(&path);
                    runtime.download_path = None;
                }
            }
        }
        Err(error) => {
            runtime.stage = Some(UpdateStage::Failed);
            runtime.error = Some(error.to_string());
        }
    }
    Ok(view(&channel, last_check, &runtime))
}

#[tauri::command]
pub fn install_update(state: State<'_, AppState>) -> ApiResult<UpdateStatusView> {
    let (channel, last_check, updates_dir, path, candidate, verified) = {
        let core = lock_core(&state)?;
        let runtime = state.update.lock().map_err(|_| ApiError::internal())?;
        (
            core.settings.update_channel.clone(),
            core.settings.last_update_check,
            core.paths.updates.clone(),
            runtime.download_path.clone(),
            runtime.candidate.clone(),
            runtime.verified.clone(),
        )
    };
    let (Some(path), Some(candidate), Some(verified)) = (path, candidate, verified) else {
        return Err(ApiError::validation(
            "The update must be downloaded and verified before installation",
        ));
    };
    if verified.version != candidate.version {
        return Err(ApiError::validation("The verified update does not match"));
    }
    acuye_updater::ensure_upgrade(&current_version(), &candidate)?;

    let canonical = path
        .canonicalize()
        .map_err(|_| ApiError::validation("The update file is missing"))?;
    let base = updates_dir.canonicalize().unwrap_or(updates_dir);
    if !canonical.starts_with(&base) {
        return Err(ApiError::validation("Invalid update location"));
    }
    let extension = canonical
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !matches!(extension.as_str(), "exe" | "msi") {
        return Err(ApiError::validation("Unsupported installer type"));
    }

    tauri_plugin_opener::open_path(&canonical, None::<&str>)
        .map_err(|_| ApiError::validation("Could not start the installer"))?;

    let runtime = state.update.lock().map_err(|_| ApiError::internal())?;
    let mut runtime = runtime;
    runtime.stage = Some(UpdateStage::Installing);
    Ok(view(&channel, last_check, &runtime))
}

#[tauri::command]
pub fn discard_update(state: State<'_, AppState>) -> ApiResult<()> {
    let mut runtime = state.update.lock().map_err(|_| ApiError::internal())?;
    if let Some(path) = runtime.download_path.take() {
        let _ = std::fs::remove_file(path);
    }
    runtime.candidate = None;
    runtime.verified = None;
    runtime.stage = Some(UpdateStage::Idle);
    runtime.error = None;
    runtime.progress = None;
    Ok(())
}
