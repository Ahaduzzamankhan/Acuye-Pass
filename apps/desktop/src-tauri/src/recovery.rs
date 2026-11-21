//! Account recovery commands: a one-time recovery code and three security
//! questions.
//!
//! Recovery is deliberately narrow. Enrolling it requires the master password,
//! and completing it requires either the code or every answer. A successful
//! recovery sets a new master password, rotates the vault key, and hands back a
//! fresh recovery code — the old one stops working.

use acuye_auth::{RecoveryOutcome, RecoverySetup, RecoveryStatus};
use acuye_core::Session;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::lock_core;
use crate::error::{ApiError, ApiResult};
use crate::state::{touch_device, AppState, Core, LiveSession, SessionView};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityQuestionInput {
    pub question: String,
    pub answer: String,
}

/// A recovered vault is open, and the rotated recovery code is shown once.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryUnlock {
    pub session: SessionView,
    pub recovery_code: String,
}

/// Which recovery methods a vault has enrolled.
#[tauri::command]
pub fn recovery_status(state: State<'_, AppState>, vault_id: String) -> ApiResult<RecoveryStatus> {
    let core = lock_core(&state)?;
    Ok(core.auth.recovery_status(&vault_id)?)
}

/// The enrolled question prompts, so the unlock screen can ask for answers.
#[tauri::command]
pub fn recovery_questions(state: State<'_, AppState>, vault_id: String) -> ApiResult<Vec<String>> {
    let core = lock_core(&state)?;
    Ok(core.auth.security_questions(&vault_id)?)
}

#[tauri::command(async)]
pub fn enable_recovery(
    state: State<'_, AppState>,
    vault_id: String,
    password: String,
    questions: Option<Vec<SecurityQuestionInput>>,
) -> ApiResult<RecoverySetup> {
    let core = lock_core(&state)?;
    let pairs: Option<Vec<(String, String)>> = questions.map(|list| {
        list.into_iter()
            .map(|entry| (entry.question, entry.answer))
            .collect()
    });
    Ok(core
        .auth
        .enable_recovery(&vault_id, &password, pairs.as_deref())?)
}

#[tauri::command(async)]
pub fn disable_recovery(
    state: State<'_, AppState>,
    vault_id: String,
    password: String,
) -> ApiResult<()> {
    let core = lock_core(&state)?;
    core.auth.disable_recovery(&vault_id, &password)?;
    Ok(())
}

#[tauri::command(async)]
pub fn recover_with_code(
    state: State<'_, AppState>,
    code: String,
    new_password: String,
) -> ApiResult<RecoveryUnlock> {
    let mut core = lock_core(&state)?;
    core.session = None;
    let outcome = core.auth.recover_with_code(&code, &new_password)?;
    finish(&mut core, outcome)
}

#[tauri::command(async)]
pub fn recover_with_answers(
    state: State<'_, AppState>,
    vault_id: String,
    answers: Vec<String>,
    new_password: String,
) -> ApiResult<RecoveryUnlock> {
    let mut core = lock_core(&state)?;
    core.session = None;
    let outcome = core
        .auth
        .recover_with_answers(&vault_id, &answers, &new_password)?;
    finish(&mut core, outcome)
}

fn finish(core: &mut Core, outcome: RecoveryOutcome) -> ApiResult<RecoveryUnlock> {
    let RecoveryOutcome {
        unlocked,
        recovery_code,
    } = outcome;
    let idle = core.settings.auto_lock_secs;
    core.session = Some(LiveSession {
        session: Session::new(unlocked.username.clone(), unlocked.vault.id.clone(), idle),
        unlocked,
    });
    touch_device(core.auth.db(), &core.device_id)?;
    let session = core.session_view().ok_or_else(ApiError::internal)?;
    Ok(RecoveryUnlock {
        session,
        recovery_code,
    })
}
