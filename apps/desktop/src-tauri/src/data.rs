use std::fs;
use std::path::Path;

use acuye_core::Item;
use acuye_export::{self, EncryptedExportEnvelope};
use acuye_import::{ImportFormat, ParsedImport};
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::commands::{lock_core, reload_settings};
use crate::error::{ApiError, ApiResult};
use crate::state::{cache_key, reload_device_identity, AppState};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub data_dir: String,
    pub database_path: String,
    pub database_size: u64,
    pub schema_version: i32,
    pub integrity_ok: bool,
    pub backup_dir: String,
    pub export_dir: String,
    pub item_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportInfo {
    pub path: String,
    pub encrypted: bool,
    pub item_count: usize,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub renamed: usize,
}

fn timestamp_name(prefix: &str, extension: &str) -> String {
    let now = acuye_core::time::now();
    let stamp = format!("{now}");
    format!("{prefix}-{stamp}.{extension}")
}

fn file_created_at(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn storage_info(state: State<'_, AppState>) -> ApiResult<StorageInfo> {
    let core = lock_core(&state)?;
    let db = core.auth.db();
    Ok(StorageInfo {
        data_dir: core.paths.data.to_string_lossy().to_string(),
        database_path: core.paths.database.to_string_lossy().to_string(),
        database_size: db.db_size_bytes(),
        schema_version: db.schema_version()?,
        integrity_ok: db.integrity_ok(),
        backup_dir: core.paths.backups.to_string_lossy().to_string(),
        export_dir: core.paths.exports.to_string_lossy().to_string(),
        item_count: db.item_count()?,
    })
}

#[tauri::command(async)]
pub fn create_backup(state: State<'_, AppState>) -> ApiResult<BackupInfo> {
    let core = lock_core(&state)?;
    let name = timestamp_name("acuye-backup", "db");
    let path = core.paths.backups.join(&name);
    core.auth.db().backup_to(&path)?;
    Ok(BackupInfo {
        name,
        path: path.to_string_lossy().to_string(),
        size: fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
        created_at: acuye_core::time::now(),
    })
}

#[tauri::command]
pub fn list_backups(state: State<'_, AppState>) -> ApiResult<Vec<BackupInfo>> {
    let core = lock_core(&state)?;
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&core.paths.backups) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("db") {
                continue;
            }
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(name) => name.to_string(),
                None => continue,
            };
            out.push(BackupInfo {
                name,
                path: path.to_string_lossy().to_string(),
                size: entry.metadata().map(|m| m.len()).unwrap_or(0),
                created_at: file_created_at(&path),
            });
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

#[tauri::command(async)]
pub fn restore_backup(state: State<'_, AppState>, name: String) -> ApiResult<()> {
    if name.contains('/') || name.contains('\\') || name.contains("..") || !name.ends_with(".db") {
        return Err(ApiError::validation("Invalid backup name"));
    }
    let mut core = lock_core(&state)?;
    let path = core.paths.backups.join(&name);
    if !path.exists() {
        return Err(ApiError::validation("That backup does not exist"));
    }
    // Drop the in-memory session first: the restored vault may be protected by
    // a different master password, so the old key must not linger.
    core.session = None;
    core.auth.db_mut().replace_with_backup(&path)?;
    reload_settings(&mut core)?;
    // The restored vault carries its own device registry and device id, so the
    // in-memory identity has to follow instead of pointing at the old vault.
    reload_device_identity(&mut core)?;
    Ok(())
}

#[tauri::command]
pub fn open_data_folder(app: AppHandle, state: State<'_, AppState>) -> ApiResult<()> {
    let core = lock_core(&state)?;
    let path = core.paths.data.clone();
    drop(core);
    tauri_plugin_opener::open_path(path, None::<&str>)
        .map_err(|_| ApiError::validation("Could not open the folder"))?;
    let _ = app;
    Ok(())
}

#[tauri::command]
pub fn open_backups_folder(app: AppHandle, state: State<'_, AppState>) -> ApiResult<()> {
    let core = lock_core(&state)?;
    let path = core.paths.backups.clone();
    drop(core);
    tauri_plugin_opener::open_path(path, None::<&str>)
        .map_err(|_| ApiError::validation("Could not open the folder"))?;
    let _ = app;
    Ok(())
}

#[tauri::command]
pub fn open_exports_folder(app: AppHandle, state: State<'_, AppState>) -> ApiResult<()> {
    let core = lock_core(&state)?;
    let path = core.paths.exports.clone();
    drop(core);
    tauri_plugin_opener::open_path(path, None::<&str>)
        .map_err(|_| ApiError::validation("Could not open the folder"))?;
    let _ = app;
    Ok(())
}

#[tauri::command(async)]
pub fn import_preview(payload: String, format: Option<ImportFormat>) -> ApiResult<ParsedImport> {
    Ok(acuye_import::parse(&payload, format)?)
}

#[tauri::command(async)]
pub fn import_apply(
    state: State<'_, AppState>,
    items: Vec<Item>,
    format: Option<ImportFormat>,
) -> ApiResult<ImportResult> {
    let mut core = lock_core(&state)?;
    if items.is_empty() {
        return Ok(ImportResult {
            imported: 0,
            renamed: 0,
        });
    }
    let mut renamed = 0usize;
    // Prepare the whole batch first: resolve id collisions, validate, encrypt.
    // Nothing is written until every item is ready, and the in-memory vault is
    // only updated after the batch is durable, so a failure cannot leave the
    // two out of step.
    let (prepared, persisted) = {
        let live = core.unlocked()?;
        let mut prepared = Vec::with_capacity(items.len());
        let mut persisted = Vec::with_capacity(items.len());
        let mut accepted: Vec<String> = Vec::with_capacity(items.len());
        for mut item in items {
            while live.unlocked.vault.get(&item.id).is_some() || accepted.contains(&item.id) {
                item.id = acuye_crypto::b64_encode(&acuye_crypto::random_bytes(16));
                renamed += 1;
            }
            item.normalize();
            item.validate()?;
            accepted.push(item.id.clone());
            persisted.push(live.unlocked.encrypt_item(&item)?);
            prepared.push(item);
        }
        (prepared, persisted)
    };
    core.auth.db_mut().upsert_items(&persisted)?;
    {
        let live = core.unlocked()?;
        for item in prepared {
            live.unlocked.vault.add(item)?;
        }
    }
    let _ = format;
    Ok(ImportResult {
        imported: persisted.len(),
        renamed,
    })
}

#[tauri::command(async)]
pub fn export_encrypted(state: State<'_, AppState>, password: String) -> ApiResult<ExportInfo> {
    let mut core = lock_core(&state)?;
    let items = core.unlocked()?.unlocked.vault.items.clone();
    let payload =
        acuye_export::encrypt_export(&items, &password, acuye_crypto::KdfParams::default())?;
    let name = timestamp_name("acuye-export", "json");
    let path = core.paths.exports.join(&name);
    write_private(&path, payload.as_bytes())?;
    Ok(ExportInfo {
        path: path.to_string_lossy().to_string(),
        encrypted: true,
        item_count: items.len(),
        bytes: fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
    })
}

#[tauri::command(async)]
pub fn export_plaintext_csv(
    state: State<'_, AppState>,
    acknowledge_plaintext: bool,
) -> ApiResult<ExportInfo> {
    if !acknowledge_plaintext {
        return Err(ApiError::validation(
            "Plaintext export requires explicit acknowledgement",
        ));
    }
    let mut core = lock_core(&state)?;
    let items = core.unlocked()?.unlocked.vault.items.clone();
    let csv = acuye_export::to_csv(&items);
    let name = timestamp_name("acuye-export", "csv");
    let path = core.paths.exports.join(&name);
    write_private(&path, csv.as_bytes())?;
    Ok(ExportInfo {
        path: path.to_string_lossy().to_string(),
        encrypted: false,
        item_count: items.len(),
        bytes: fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
    })
}

#[tauri::command(async)]
pub fn import_encrypted(
    state: State<'_, AppState>,
    payload: String,
    password: String,
) -> ApiResult<ImportResult> {
    let imported = acuye_export::decrypt_export(&payload, &password)?;
    import_apply(state, imported.items, None)
}

/// Validate an encrypted export file without importing it.
#[tauri::command]
pub fn inspect_encrypted_export(payload: String) -> ApiResult<bool> {
    let envelope: EncryptedExportEnvelope = serde_json::from_str(&payload)
        .map_err(|_| ApiError::validation("Not an Acuye Pass export"))?;
    Ok(envelope.format == acuye_export::EXPORT_FORMAT)
}

fn write_private(path: &Path, bytes: &[u8]) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command(async)]
pub fn get_favicon(state: State<'_, AppState>, url: String) -> ApiResult<Option<String>> {
    let (enabled, cache_dir) = {
        let core = lock_core(&state)?;
        (core.settings.favicon_enabled, core.paths.cache.clone())
    };
    if !enabled {
        return Ok(None);
    }
    let normalized = match acuye_platform::normalize_website(&url) {
        Some(value) => value,
        None => return Ok(None),
    };
    let host = acuye_core::item::host_of(&normalized);
    if host.is_empty() {
        return Ok(None);
    }
    let key = cache_key(&host);
    let bin = cache_dir.join(format!("{key}.bin"));
    let mime_file = cache_dir.join(format!("{key}.mime"));
    if bin.exists() && mime_file.exists() {
        if let (Ok(bytes), Ok(mime)) = (fs::read(&bin), fs::read_to_string(&mime_file)) {
            return Ok(Some(data_url(&mime, &bytes)));
        }
    }
    let fetched = match acuye_platform::fetch_favicon(&normalized) {
        Ok(favicon) => favicon,
        Err(_) => return Ok(None),
    };
    let _ = fs::create_dir_all(&cache_dir);
    let _ = fs::write(&bin, &fetched.bytes);
    let _ = fs::write(&mime_file, &fetched.mime);
    Ok(Some(data_url(&fetched.mime, &fetched.bytes)))
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    use base64::Engine;
    format!(
        "data:{};base64,{}",
        mime,
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}
