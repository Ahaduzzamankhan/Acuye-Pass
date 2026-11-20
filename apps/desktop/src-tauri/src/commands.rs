use std::time::Duration;

use acuye_core::{AccountSummary, AppSettings, Item, ItemFields, ItemSummary, ItemType, Session};
use acuye_generator::strength::PasswordStrength;
use acuye_generator::{PassphraseOptions, PasswordOptions};
use acuye_storage::DeviceRecord;
use acuye_vault::SecurityReport;
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::error::{ApiError, ApiResult};
use crate::state::{
    device_hostname, load_settings, persist_settings, touch_device, AppState, Core, LiveSession,
    SessionView,
};

pub fn lock_core<'a, 'r>(
    state: &'a State<'r, AppState>,
) -> ApiResult<std::sync::MutexGuard<'a, Core>> {
    state.core.lock().map_err(|_| ApiError::internal())
}

impl Core {
    /// Returns the unlocked session, clearing it first if the idle timeout has
    /// elapsed. This makes auto-lock authoritative in Rust even if the UI timer
    /// is delayed.
    pub fn unlocked(&mut self) -> ApiResult<&mut LiveSession> {
        if self
            .session
            .as_ref()
            .map(|s| s.session.is_expired())
            .unwrap_or(false)
        {
            self.session = None;
        }
        self.session.as_mut().ok_or_else(|| ApiError {
            code: "locked".into(),
            message: "The vault is locked".into(),
        })
    }

    pub fn session_view(&self) -> Option<SessionView> {
        self.session.as_ref().map(|live| SessionView {
            username: live.unlocked.username.clone(),
            vault_id: live.unlocked.vault.id.clone(),
            vault_name: live.unlocked.vault.name.clone(),
            item_count: live.unlocked.vault.items.len(),
            idle_timeout_secs: live.session.idle_timeout_secs,
        })
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub has_account: bool,
    pub username: Option<String>,
    pub locked: bool,
    pub app_version: String,
    pub platform: String,
    pub data_dir: String,
    pub database_size: u64,
    pub repository: String,
    pub kdf_memory_kib: u32,
    pub kdf_iterations: u32,
    pub session: Option<SessionView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultCounts {
    pub total: usize,
    pub favorites: usize,
    pub logins: usize,
    pub notes: usize,
    pub cards: usize,
    pub identities: usize,
    pub documents: usize,
    pub custom: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyResult {
    pub field: String,
    pub clear_after_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub created_at: i64,
    pub last_seen_at: i64,
    pub revoked: bool,
    pub sync_registered: bool,
    pub current: bool,
}

#[tauri::command]
pub fn app_status(state: State<'_, AppState>) -> ApiResult<AppStatus> {
    let core = lock_core(&state)?;
    let account = core.auth.account_summary()?;
    Ok(AppStatus {
        has_account: account.is_some(),
        username: account.as_ref().map(|a| a.username.clone()),
        locked: core.session.is_none(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        platform: acuye_platform::platform_name().into(),
        data_dir: core.paths.data.to_string_lossy().to_string(),
        database_size: core.auth.db().db_size_bytes(),
        repository: acuye_updater::OFFICIAL_REPO_SLUG.into(),
        kdf_memory_kib: account.as_ref().map(|a| a.kdf_memory_kib).unwrap_or(0),
        kdf_iterations: account.as_ref().map(|a| a.kdf_iterations).unwrap_or(0),
        session: core.session_view(),
    })
}

#[tauri::command]
pub fn create_account(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> ApiResult<SessionView> {
    let mut core = lock_core(&state)?;
    let unlocked = core.auth.create_account(&username, &password)?;
    let idle = core.settings.auto_lock_secs;
    core.session = Some(LiveSession {
        session: Session::new(unlocked.username.clone(), unlocked.vault.id.clone(), idle),
        unlocked,
    });
    touch_device(core.auth.db(), &core.device_id)?;
    core.session_view().ok_or_else(ApiError::internal)
}

#[tauri::command]
pub fn unlock(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> ApiResult<SessionView> {
    let mut core = lock_core(&state)?;
    let unlocked = core.auth.unlock(&username, &password)?;
    let idle = core.settings.auto_lock_secs;
    core.session = Some(LiveSession {
        session: Session::new(unlocked.username.clone(), unlocked.vault.id.clone(), idle),
        unlocked,
    });
    touch_device(core.auth.db(), &core.device_id)?;
    core.session_view().ok_or_else(ApiError::internal)
}

#[tauri::command]
pub fn lock(state: State<'_, AppState>) -> ApiResult<()> {
    let mut core = lock_core(&state)?;
    core.session = None;
    Ok(())
}

#[tauri::command]
pub fn logout(state: State<'_, AppState>) -> ApiResult<()> {
    let mut core = lock_core(&state)?;
    core.session = None;
    Ok(())
}

#[tauri::command]
pub fn session_touch(state: State<'_, AppState>) -> ApiResult<Option<SessionView>> {
    let mut core = lock_core(&state)?;
    match core.unlocked() {
        Ok(live) => {
            live.session.touch();
            Ok(core.session_view())
        }
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn change_master_password(
    state: State<'_, AppState>,
    current_password: String,
    new_password: String,
) -> ApiResult<SessionView> {
    let mut core = lock_core(&state)?;
    // Require an unlocked session as well as the current password.
    core.unlocked()?;
    let rotated = core
        .auth
        .change_master_password(&current_password, &new_password)?;
    let idle = core.settings.auto_lock_secs;
    let username = rotated.username.clone();
    let vault_id = rotated.vault.id.clone();
    core.session = Some(LiveSession {
        session: Session::new(username, vault_id, idle),
        unlocked: rotated,
    });
    core.session_view().ok_or_else(ApiError::internal)
}

#[tauri::command]
pub fn rename_vault(state: State<'_, AppState>, name: String) -> ApiResult<String> {
    let mut core = lock_core(&state)?;
    let key = core.unlocked()?.unlocked.vault_key.clone();
    core.auth.rename_vault(&key, &name)?;
    let trimmed = name.trim().to_string();
    core.unlocked()?.unlocked.vault.name = trimmed.clone();
    Ok(trimmed)
}

#[tauri::command]
pub fn get_account(state: State<'_, AppState>) -> ApiResult<Option<AccountSummary>> {
    let core = lock_core(&state)?;
    Ok(core.auth.account_summary()?)
}

#[tauri::command]
pub fn list_items(
    state: State<'_, AppState>,
    query: Option<String>,
    item_type: Option<ItemType>,
    favorites_only: Option<bool>,
) -> ApiResult<Vec<ItemSummary>> {
    let mut core = lock_core(&state)?;
    let live = core.unlocked()?;
    Ok(live.unlocked.vault.search(
        query.as_deref().unwrap_or(""),
        item_type,
        favorites_only.unwrap_or(false),
    ))
}

#[tauri::command]
pub fn get_item(state: State<'_, AppState>, id: String) -> ApiResult<Item> {
    let mut core = lock_core(&state)?;
    let live = core.unlocked()?;
    live.unlocked
        .vault
        .get(&id)
        .cloned()
        .ok_or_else(|| ApiError::from(acuye_core::AcuyeError::NotFound("item".into())))
}

#[tauri::command]
pub fn create_item(
    state: State<'_, AppState>,
    fields: ItemFields,
    title: String,
    notes: Option<String>,
    tags: Option<Vec<String>>,
    favorite: Option<bool>,
) -> ApiResult<Item> {
    let mut core = lock_core(&state)?;
    let mut item = Item::new(fields, title);
    item.notes = notes.unwrap_or_default();
    item.tags = tags.unwrap_or_default();
    item.favorite = favorite.unwrap_or(false);

    let item = core.unlocked()?.unlocked.vault.add(item)?;
    let stored = core.unlocked()?.unlocked.encrypt_item(&item)?;
    core.auth.db().upsert_item(&stored)?;
    Ok(item)
}

#[tauri::command]
pub fn update_item(state: State<'_, AppState>, item: Item) -> ApiResult<Item> {
    let mut core = lock_core(&state)?;
    let item = core.unlocked()?.unlocked.vault.update(item)?;
    let stored = core.unlocked()?.unlocked.encrypt_item(&item)?;
    core.auth.db().upsert_item(&stored)?;
    Ok(item)
}

#[tauri::command]
pub fn delete_item(state: State<'_, AppState>, id: String) -> ApiResult<()> {
    let mut core = lock_core(&state)?;
    core.unlocked()?.unlocked.vault.delete(&id)?;
    core.auth.db().delete_item(&id)?;
    Ok(())
}

#[tauri::command]
pub fn duplicate_item(state: State<'_, AppState>, id: String) -> ApiResult<Item> {
    let mut core = lock_core(&state)?;
    let item = core.unlocked()?.unlocked.vault.duplicate(&id)?;
    let stored = core.unlocked()?.unlocked.encrypt_item(&item)?;
    core.auth.db().upsert_item(&stored)?;
    Ok(item)
}

#[tauri::command]
pub fn toggle_favorite(state: State<'_, AppState>, id: String) -> ApiResult<Item> {
    let mut core = lock_core(&state)?;
    let item = core.unlocked()?.unlocked.vault.toggle_favorite(&id)?;
    let stored = core.unlocked()?.unlocked.encrypt_item(&item)?;
    core.auth.db().upsert_item(&stored)?;
    Ok(item)
}

#[tauri::command]
pub fn vault_counts(state: State<'_, AppState>) -> ApiResult<VaultCounts> {
    let mut core = lock_core(&state)?;
    let vault = &core.unlocked()?.unlocked.vault;
    Ok(VaultCounts {
        total: vault.items.len(),
        favorites: vault.favorites_count(),
        logins: vault.count(ItemType::Login),
        notes: vault.count(ItemType::SecureNote),
        cards: vault.count(ItemType::Card),
        identities: vault.count(ItemType::Identity),
        documents: vault.count(ItemType::Document),
        custom: vault.count(ItemType::Custom),
    })
}

#[tauri::command]
pub fn security_report(state: State<'_, AppState>) -> ApiResult<SecurityReport> {
    let mut core = lock_core(&state)?;
    Ok(core.unlocked()?.unlocked.vault.security_report())
}

fn field_value(item: &Item, field: &str) -> Option<String> {
    let value = match (field, &item.fields) {
        ("title", _) => item.title.clone(),
        ("notes", _) => item.notes.clone(),
        ("username", ItemFields::Login { username, .. }) => username.clone(),
        ("password", ItemFields::Login { password, .. }) => password.clone(),
        ("url", ItemFields::Login { url, .. }) => url.clone(),
        ("totp", ItemFields::Login { totp, .. }) => totp.clone(),
        ("card_number", ItemFields::Card { number, .. }) => number.clone(),
        ("card_cvv", ItemFields::Card { cvv, .. }) => cvv.clone(),
        ("card_pin", ItemFields::Card { pin, .. }) => pin.clone(),
        ("card_cardholder", ItemFields::Card { cardholder, .. }) => cardholder.clone(),
        ("identity_email", ItemFields::Identity { email, .. }) => email.clone(),
        ("identity_phone", ItemFields::Identity { phone, .. }) => phone.clone(),
        _ => return None,
    };
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

#[tauri::command]
pub fn copy_field(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    field: String,
) -> ApiResult<CopyResult> {
    let (value, clear_after) = {
        let mut core = lock_core(&state)?;
        let live = core.unlocked()?;
        let item = live
            .unlocked
            .vault
            .get(&id)
            .ok_or_else(|| ApiError::from(acuye_core::AcuyeError::NotFound("item".into())))?;
        let value = field_value(item, &field)
            .ok_or_else(|| ApiError::validation("That field is empty or cannot be copied"))?;
        (value, core.settings.clipboard_clear_secs)
    };

    app.clipboard()
        .write_text(value.clone())
        .map_err(|_| ApiError::validation("Could not access the clipboard"))?;

    if clear_after > 0 {
        let handle = app.clone();
        let secret = value;
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(clear_after));
            // Only clear when the clipboard still holds what this command put
            // there: wiping whatever the user copied in the meantime would
            // destroy their data.
            let still_ours = handle
                .clipboard()
                .read_text()
                .map(|current| current == secret)
                .unwrap_or(false);
            if still_ours {
                let _ = handle.clipboard().write_text(String::new());
            }
        });
    }

    Ok(CopyResult {
        field,
        clear_after_secs: clear_after,
    })
}

#[tauri::command]
pub fn open_website(url: String) -> ApiResult<()> {
    let target = acuye_platform::normalize_website(&url)
        .ok_or_else(|| ApiError::validation("That website address is not valid"))?;
    tauri_plugin_opener::open_url(target, None::<&str>)
        .map_err(|_| ApiError::validation("Could not open the website"))?;
    Ok(())
}

#[tauri::command]
pub fn generate_password(options: PasswordOptions) -> ApiResult<String> {
    Ok(acuye_generator::generate_password(&options)?)
}

#[tauri::command]
pub fn generate_passphrase(options: PassphraseOptions) -> ApiResult<String> {
    Ok(acuye_generator::generate_passphrase(&options)?)
}

#[tauri::command]
pub fn evaluate_password(password: String) -> PasswordStrength {
    acuye_generator::strength::evaluate(&password)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> ApiResult<AppSettings> {
    let core = lock_core(&state)?;
    Ok(core.settings.clone())
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> ApiResult<AppSettings> {
    let mut core = lock_core(&state)?;
    let mut next = settings;
    // The release channel can only change through `set_update_channel`, so a
    // general settings save can never silently switch channels.
    next.update_channel = core.settings.update_channel.clone();
    next.telemetry = false;
    next.validate()?;

    persist_settings(core.auth.db(), &next)?;
    core.settings = next.clone();
    if let Some(live) = core.session.as_mut() {
        live.session.idle_timeout_secs = next.auto_lock_secs;
    }
    Ok(next)
}

#[tauri::command]
pub fn set_update_channel(
    state: State<'_, AppState>,
    channel: String,
    acknowledge_prerelease: bool,
) -> ApiResult<AppSettings> {
    let mut core = lock_core(&state)?;
    let parsed = acuye_updater::ReleaseChannel::parse(&channel)?;
    if parsed.is_opt_in() && !acknowledge_prerelease {
        return Err(ApiError::validation(
            "Beta and alpha channels must be explicitly enabled",
        ));
    }
    core.settings.update_channel = parsed.as_str().into();
    core.settings.validate()?;
    persist_settings(core.auth.db(), &core.settings)?;
    Ok(core.settings.clone())
}

#[tauri::command]
pub fn list_devices(state: State<'_, AppState>) -> ApiResult<Vec<DeviceView>> {
    let core = lock_core(&state)?;
    let devices = core.auth.db().list_devices()?;
    Ok(devices
        .into_iter()
        .map(|device| device_view(device, &core.device_id))
        .collect())
}

fn device_view(device: DeviceRecord, current_id: &str) -> DeviceView {
    DeviceView {
        current: device.id == current_id,
        id: device.id,
        name: device.name,
        platform: device.platform,
        created_at: device.created_at,
        last_seen_at: device.last_seen_at,
        revoked: device.revoked,
        sync_registered: device.sync_registered,
    }
}

#[tauri::command]
pub fn revoke_device(state: State<'_, AppState>, id: String) -> ApiResult<()> {
    let core = lock_core(&state)?;
    if id == core.device_id {
        return Err(ApiError::validation(
            "This is the device you are using. Lock the vault instead.",
        ));
    }
    core.auth.db().revoke_device(&id)?;
    Ok(())
}

#[tauri::command]
pub fn current_device_name() -> String {
    device_hostname()
}

/// Reload settings from disk (used after a backup restore).
pub fn reload_settings(core: &mut Core) -> ApiResult<()> {
    core.settings = load_settings(core.auth.db());
    Ok(())
}
