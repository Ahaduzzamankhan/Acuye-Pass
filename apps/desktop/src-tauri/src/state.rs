use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use acuye_auth::{AuthService, UnlockedVault};
use acuye_core::{AppSettings, Session};
use acuye_storage::{Database, DeviceRecord};
use acuye_updater::{UpdateCandidate, VerifiedUpdate};
use serde::Serialize;
use tauri::Manager;

use crate::error::{ApiError, ApiResult};

pub const SETTINGS_KEY: &str = "app_settings";
pub const DEVICE_ID_KEY: &str = "device_id";

/// Directory layout. Everything sensitive stays inside `data_dir`.
#[derive(Debug, Clone)]
pub struct Paths {
    pub data: PathBuf,
    pub database: PathBuf,
    pub backups: PathBuf,
    pub exports: PathBuf,
    pub cache: PathBuf,
    pub updates: PathBuf,
}

impl Paths {
    pub fn from_data_dir(data: PathBuf) -> Self {
        Self {
            database: data.join("acuye.db"),
            backups: data.join("backups"),
            exports: data.join("exports"),
            cache: data.join("cache").join("favicons"),
            updates: data.join("updates"),
            data,
        }
    }

    pub fn ensure(&self) -> ApiResult<()> {
        for dir in [
            &self.data,
            &self.backups,
            &self.exports,
            &self.cache,
            &self.updates,
        ] {
            std::fs::create_dir_all(dir)?;
        }
        Ok(())
    }
}

/// Live unlocked session: key material plus idle-timeout metadata.
pub struct LiveSession {
    pub unlocked: UnlockedVault,
    pub session: Session,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub username: String,
    pub vault_id: String,
    pub vault_name: String,
    pub item_count: usize,
    pub idle_timeout_secs: u64,
}

pub struct Core {
    pub auth: AuthService,
    pub session: Option<LiveSession>,
    pub settings: AppSettings,
    pub paths: Paths,
    pub device_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateStage {
    Idle,
    Checking,
    Available,
    Downloading,
    Downloaded,
    Verified,
    Installing,
    UpToDate,
    Failed,
}

#[derive(Default)]
pub struct UpdateRuntime {
    pub stage: Option<UpdateStage>,
    pub candidate: Option<UpdateCandidate>,
    pub verified: Option<VerifiedUpdate>,
    pub download_path: Option<PathBuf>,
    pub progress: Option<(u64, u64)>,
    pub error: Option<String>,
    pub last_check: Option<i64>,
    pub checking: bool,
}

pub struct AppState {
    pub core: Mutex<Core>,
    pub update: Arc<Mutex<UpdateRuntime>>,
}

impl AppState {
    pub fn init(app: &tauri::AppHandle) -> ApiResult<Self> {
        let data_dir = match app.path().app_data_dir() {
            Ok(dir) => dir,
            Err(_) => acuye_platform::default_data_dir(),
        };
        let paths = Paths::from_data_dir(data_dir);
        paths.ensure()?;

        let db = Database::open(&paths.database)?;
        let settings = load_settings(&db);
        let device_id = ensure_device(&db)?;
        let auth = AuthService::with_default_kdf(db);

        Ok(Self {
            core: Mutex::new(Core {
                auth,
                session: None,
                settings,
                paths,
                device_id,
            }),
            update: Arc::new(Mutex::new(UpdateRuntime::default())),
        })
    }
}

pub fn load_settings(db: &Database) -> AppSettings {
    db.get_setting(SETTINGS_KEY)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<AppSettings>(&raw).ok())
        .filter(|settings| settings.validate().is_ok())
        .unwrap_or_default()
}

pub fn persist_settings(db: &Database, settings: &AppSettings) -> ApiResult<()> {
    let raw = serde_json::to_string(settings).map_err(|_| ApiError::internal())?;
    db.set_setting(SETTINGS_KEY, &raw)?;
    Ok(())
}

/// Stable per-installation device id. Not secret; used for device management
/// and the future sync protocol.
fn ensure_device(db: &Database) -> ApiResult<String> {
    if let Some(id) = db.get_setting(DEVICE_ID_KEY)? {
        return Ok(id);
    }
    let id = uuid_v4();
    db.set_setting(DEVICE_ID_KEY, &id)?;
    let now = acuye_core::time::now();
    let hostname = device_hostname();
    db.upsert_device(&DeviceRecord {
        id: id.clone(),
        name: hostname,
        platform: acuye_platform::platform_name().into(),
        created_at: now,
        last_seen_at: now,
        revoked: false,
        sync_registered: false,
    })?;
    Ok(id)
}

pub fn device_hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|name| !name.trim().is_empty())
        .map(|name| name.trim().to_string())
        .unwrap_or_else(|| "This device".into())
}

fn uuid_v4() -> String {
    acuye_crypto::b64_encode(&acuye_crypto::random_bytes(16))
}

pub fn touch_device(db: &Database, device_id: &str) -> ApiResult<()> {
    let mut devices = db.list_devices()?;
    if let Some(device) = devices.iter_mut().find(|d| d.id == device_id) {
        device.last_seen_at = acuye_core::time::now();
        db.upsert_device(device)?;
    }
    Ok(())
}

pub fn cache_key(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub fn ensure_within(base: &Path, candidate: &Path) -> ApiResult<PathBuf> {
    let base = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let candidate = candidate
        .canonicalize()
        .unwrap_or_else(|_| candidate.to_path_buf());
    if !candidate.starts_with(&base) {
        return Err(ApiError::validation(
            "Path is outside the application data folder",
        ));
    }
    Ok(candidate)
}
