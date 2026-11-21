//! Shared mobile vault session.
//!
//! React Native never sees key material or SQLite: the app calls into this
//! module through JNI (`android.rs`), and every answer is a JSON string. The
//! module reuses the exact desktop crates, so KDF parameters, wrapping, item
//! encryption, imports, exports, recovery and TOTP all behave identically on
//! Android.
//!
//! `MobileVault::call` is the single command router. It mirrors the desktop
//! Tauri command surface (`apps/desktop/src-tauri/src/{commands,data,advanced,
//! recovery}.rs`) so every feature the desktop app has is reachable from the
//! phone, while window and self-update commands stay desktop-only.

use std::fs;
use std::path::{Path, PathBuf};

use acuye_auth::{AuthService, UnlockedVault};
use acuye_core::{
    AccountSummary, AcuyeError, AppSettings, Item, ItemFields, ItemSummary, ItemType, Result,
};
use acuye_crypto::KdfParams;
use acuye_generator::{PassphraseOptions, PasswordOptions};
use acuye_storage::{Database, DeviceRecord};
use acuye_totp::{OtpConfig, OtpType, TotpAlgorithm};
use serde_json::{json, Value};

const SETTINGS_KEY: &str = "app_settings";
const DEVICE_ID_KEY: &str = "device_id";

fn error_json(error: &AcuyeError) -> String {
    json!({
        "ok": false,
        "code": error.code(),
        "message": error.to_string(),
    })
    .to_string()
}

fn ok(value: Value) -> String {
    let mut object = serde_json::Map::new();
    object.insert("ok".into(), Value::Bool(true));
    if let Value::Object(map) = value {
        for (key, value) in map {
            object.insert(key, value);
        }
    }
    Value::Object(object).to_string()
}

fn invalid(message: &str) -> AcuyeError {
    AcuyeError::Validation(message.into())
}

fn parse_args(args_json: &str) -> Result<Value> {
    let trimmed = args_json.trim();
    if trimmed.is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(trimmed).map_err(|_| invalid("The app sent an unreadable request"))
}

fn str_arg(args: &Value, key: &str) -> String {
    args.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn opt_str(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn bool_arg(args: &Value, key: &str) -> bool {
    args.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn u64_arg(args: &Value, key: &str) -> u64 {
    args.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn items_arg(args: &Value, key: &str) -> Vec<Item> {
    args.get(key)
        .cloned()
        .and_then(|value| serde_json::from_value::<Vec<Item>>(value).ok())
        .unwrap_or_default()
}

/// One unlocked vault plus the service that opened it.
pub struct MobileVault {
    service: AuthService,
    unlocked: Option<UnlockedVault>,
    settings: AppSettings,
    data_dir: PathBuf,
    device_id: String,
    last_touch: i64,
}

impl MobileVault {
    /// Open the local database. The vault stays locked until `unlock`.
    pub fn open(db_path: &str) -> Result<Self> {
        if db_path.trim().is_empty() {
            return Err(invalid("The app data directory is unavailable"));
        }
        let path = Path::new(db_path);
        let data_dir = path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        let db = Database::open(path)?;
        let settings = load_settings(&db);
        let device_id = ensure_device(&db)?;
        Ok(Self {
            service: AuthService::new(db, KdfParams::default()),
            unlocked: None,
            settings,
            data_dir,
            device_id,
            last_touch: acuye_core::time::now(),
        })
    }

    pub fn is_unlocked(&self) -> bool {
        self.unlocked.is_some()
    }

    // ---------------------------------------------------------------- helpers

    fn paths(&self) -> Paths {
        Paths::from_data_dir(self.data_dir.clone())
    }

    fn persist_settings(&self) -> Result<()> {
        let raw = serde_json::to_string(&self.settings).map_err(|_| AcuyeError::Format)?;
        self.service.db().set_setting(SETTINGS_KEY, &raw)
    }

    /// Auto-lock is authoritative here: an expired session is dropped before
    /// the next command runs, even if the UI timer was delayed.
    fn unlocked_mut(&mut self) -> Result<&mut UnlockedVault> {
        if self.unlocked.is_some() {
            let now = acuye_core::time::now();
            let timeout = self.settings.auto_lock_secs;
            if timeout > 0 && now.saturating_sub(self.last_touch) > timeout as i64 {
                self.unlocked = None;
            }
        }
        if self.unlocked.is_none() {
            return Err(AcuyeError::AuthenticationFailed);
        }
        self.last_touch = acuye_core::time::now();
        self.unlocked
            .as_mut()
            .ok_or(AcuyeError::AuthenticationFailed)
    }

    fn session_value(&self) -> Option<Value> {
        self.unlocked.as_ref().map(|unlocked| {
            json!({
                "username": unlocked.username,
                "vaultId": unlocked.vault.id,
                "vaultName": unlocked.vault.name,
                "itemCount": unlocked.vault.items.len(),
                "idleTimeoutSecs": self.settings.auto_lock_secs,
            })
        })
    }

    fn touch_device(&self) -> Result<()> {
        touch_device(self.service.db(), &self.device_id)
    }

    fn set_session(&mut self, unlocked: UnlockedVault) {
        self.unlocked = Some(unlocked);
        self.last_touch = acuye_core::time::now();
    }

    // -------------------------------------------------------------- commands

    /// Accounts, unlock state and the shared core version.
    pub fn status_json(&self) -> String {
        let accounts: Vec<Value> = self
            .service
            .accounts()
            .unwrap_or_default()
            .into_iter()
            .map(|account| {
                json!({
                    "vaultId": account.vault_id,
                    "username": account.username,
                    "vaultName": account.vault_name,
                    "kdfAlgorithm": account.kdf_algorithm,
                    "kdfMemoryKib": account.kdf_memory_kib,
                    "kdfIterations": account.kdf_iterations,
                    "createdAt": account.created_at,
                })
            })
            .collect();
        ok(json!({
            "version": crate::CORE_VERSION,
            "accounts": accounts,
            "unlocked": self.is_unlocked(),
            "session": self.session_value(),
            "dataDir": self.data_dir.to_string_lossy(),
            "databaseSize": self.service.db().db_size_bytes(),
            "repository": "Ahaduzzamankhan/Acuye-Pass",
            "platform": "android",
            "settings": self.settings,
        }))
    }

    /// First-run account creation.
    pub fn create_json(&mut self, username: &str, password: &str) -> String {
        if self.service.has_account().unwrap_or(false) {
            return error_json(&AcuyeError::Conflict(
                "an account already exists on this device".into(),
            ));
        }
        match self.service.create_account(username, password) {
            Ok(unlocked) => {
                self.set_session(unlocked);
                let _ = self.touch_device();
                self.status_json()
            }
            Err(error) => error_json(&error),
        }
    }

    /// Unlock one vault by vault id, or by username when no id is given.
    pub fn unlock_json(
        &mut self,
        vault_id: Option<&str>,
        username: &str,
        password: &str,
    ) -> String {
        let outcome = match vault_id.filter(|id| !id.is_empty()) {
            Some(id) => self.service.unlock_vault(id, password),
            None => self.service.unlock(username, password),
        };
        match outcome {
            Ok(unlocked) => {
                self.set_session(unlocked);
                let _ = self.touch_device();
                self.status_json()
            }
            Err(error) => error_json(&error),
        }
    }

    /// Drop the in-memory vault key.
    pub fn lock_json(&mut self) -> String {
        self.unlocked = None;
        ok(json!({ "unlocked": false }))
    }

    /// Item summaries, optionally filtered by a search string.
    pub fn list_json(&self, query: &str) -> String {
        match self.search_json(query, None, false) {
            Ok(value) => ok(value),
            Err(error) => error_json(&error),
        }
    }

    fn search_json(
        &self,
        query: &str,
        kind: Option<ItemType>,
        favorites_only: bool,
    ) -> Result<Value> {
        let unlocked = self
            .unlocked
            .as_ref()
            .ok_or(AcuyeError::AuthenticationFailed)?;
        let items: Vec<ItemSummary> = unlocked.vault.search(query, kind, favorites_only);
        Ok(json!({ "items": items }))
    }

    /// One full item, with its type-specific fields already tagged by serde.
    pub fn item_json(&self, id: &str) -> String {
        let Some(unlocked) = self.unlocked.as_ref() else {
            return error_json(&AcuyeError::AuthenticationFailed);
        };
        match unlocked.vault.get(id) {
            Some(item) => ok(json!({ "item": item })),
            None => error_json(&AcuyeError::NotFound("item".into())),
        }
    }

    /// Reveal one field. Usernames, URLs and notes are returned as-is; the
    /// password and TOTP secret are only returned when explicitly requested.
    pub fn secret_json(&self, id: &str, field: &str) -> String {
        let Some(unlocked) = self.unlocked.as_ref() else {
            return error_json(&AcuyeError::AuthenticationFailed);
        };
        let Some(item) = unlocked.vault.get(id) else {
            return error_json(&AcuyeError::NotFound("item".into()));
        };
        let value = match (field, &item.fields) {
            ("username", ItemFields::Login { username, .. }) => username.clone(),
            ("password", ItemFields::Login { password, .. }) => password.clone(),
            ("url", ItemFields::Login { url, .. }) => url.clone(),
            ("totp", ItemFields::Login { totp, .. }) => totp.clone(),
            ("secret", ItemFields::Totp { secret, .. }) => secret.clone(),
            ("card_number", ItemFields::Card { number, .. }) => number.clone(),
            ("cvv", ItemFields::Card { cvv, .. }) => cvv.clone(),
            ("notes", _) => item.notes.clone(),
            _ => return error_json(&invalid("Unknown field")),
        };
        ok(json!({ "value": value }))
    }

    /// Current TOTP code for a login's `totp` field or an authenticator item.
    pub fn totp_json(&self, id: &str) -> String {
        let Some(unlocked) = self.unlocked.as_ref() else {
            return error_json(&AcuyeError::AuthenticationFailed);
        };
        let Some(item) = unlocked.vault.get(id) else {
            return error_json(&AcuyeError::NotFound("item".into()));
        };
        let config = match totp_config(item) {
            Ok(config) => config,
            Err(error) => return error_json(&error),
        };
        match totp_code(&config) {
            Ok(value) => ok(value),
            Err(error) => error_json(&error),
        }
    }

    /// Create a login and persist it under the open vault key.
    pub fn create_login_json(
        &mut self,
        title: &str,
        username: &str,
        password: &str,
        url: &str,
        notes: &str,
    ) -> String {
        let fields = ItemFields::Login {
            username: username.to_string(),
            password: password.to_string(),
            url: url.to_string(),
            totp: String::new(),
            password_changed_at: Some(acuye_core::time::now()),
        };
        match self.create_item(fields, title, notes, &[], false) {
            Ok(item) => ok(json!({ "item": item })),
            Err(error) => error_json(&error),
        }
    }

    /// Password generator, reusing the desktop engine.
    pub fn generate_json(&self, options_json: &str) -> String {
        crate::generate_password_json(options_json)
    }

    fn create_item(
        &mut self,
        fields: ItemFields,
        title: &str,
        notes: &str,
        tags: &[String],
        favorite: bool,
    ) -> Result<Item> {
        let mut item = Item::new(fields, title);
        item.notes = notes.to_string();
        item.tags = tags.to_vec();
        item.favorite = favorite;
        let added = self.unlocked_mut()?.vault.add(item)?;
        let stored = self.unlocked_mut()?.encrypt_item(&added)?;
        self.service.db().upsert_item(&stored)?;
        Ok(added)
    }

    fn update_item(&mut self, item: Item) -> Result<Item> {
        let updated = self.unlocked_mut()?.vault.update(item)?;
        let stored = self.unlocked_mut()?.encrypt_item(&updated)?;
        self.service.db().upsert_item(&stored)?;
        Ok(updated)
    }

    // ------------------------------------------------------------ dispatcher

    /// Execute one command. `op` names the desktop equivalent; `args_json` is
    /// a JSON object using camelCase keys.
    pub fn call(&mut self, op: &str, args_json: &str) -> String {
        let args = match parse_args(args_json) {
            Ok(args) => args,
            Err(error) => return error_json(&error),
        };
        match self.handle(op, &args) {
            Ok(value) => ok(value),
            Err(error) => error_json(&error),
        }
    }

    fn handle(&mut self, op: &str, args: &Value) -> Result<Value> {
        match op {
            "status" => Ok(json!({
                "version": crate::CORE_VERSION,
                "accounts": self.service.accounts()?.into_iter().map(account_value).collect::<Vec<_>>(),
                "unlocked": self.is_unlocked(),
                "session": self.session_value(),
                "dataDir": self.data_dir.to_string_lossy(),
                "databaseSize": self.service.db().db_size_bytes(),
                "repository": "Ahaduzzamankhan/Acuye-Pass",
                "platform": "android",
                "settings": self.settings,
            })),
            "accounts.create" => {
                if self.service.has_account()? {
                    return Err(AcuyeError::Conflict(
                        "an account already exists on this device".into(),
                    ));
                }
                let unlocked = self
                    .service
                    .create_account(&str_arg(args, "username"), &str_arg(args, "password"))?;
                self.set_session(unlocked);
                self.touch_device()?;
                Ok(self.status_value())
            }
            "accounts.add" => {
                self.unlocked = None;
                let unlocked = self.service.add_account(
                    &str_arg(args, "username"),
                    &str_arg(args, "password"),
                    opt_str(args, "vaultName").as_deref(),
                )?;
                self.set_session(unlocked);
                self.touch_device()?;
                Ok(self.status_value())
            }
            "accounts.list" => Ok(json!({
                "accounts": self.service.accounts()?.into_iter().map(account_value).collect::<Vec<_>>()
            })),
            "accounts.unlock" => {
                let password = str_arg(args, "password");
                let unlocked = match opt_str(args, "vaultId") {
                    Some(id) => self.service.unlock_vault(&id, &password)?,
                    None => self.service.unlock(&str_arg(args, "username"), &password)?,
                };
                self.set_session(unlocked);
                self.touch_device()?;
                Ok(self.status_value())
            }
            "accounts.lock" | "accounts.logout" => {
                self.unlocked = None;
                Ok(json!({ "unlocked": false }))
            }
            "accounts.changePassword" => {
                let vault_id = self.unlocked_ref()?.vault.id.clone();
                let rotated = self.service.change_master_password(
                    &vault_id,
                    &str_arg(args, "currentPassword"),
                    &str_arg(args, "newPassword"),
                )?;
                self.set_session(rotated);
                Ok(self.status_value())
            }
            "accounts.renameVault" => {
                let name = str_arg(args, "name");
                let (vault_id, key) = {
                    let live = self.unlocked_ref()?;
                    (live.vault.id.clone(), live.vault_key.clone())
                };
                self.service.rename_vault(&vault_id, &key, &name)?;
                let trimmed = name.trim().to_string();
                self.unlocked_mut()?.vault.name = trimmed.clone();
                Ok(json!({ "name": trimmed }))
            }
            "accounts.summary" => Ok(json!({
                "account": self.service.account_summary()?.map(account_value)
            })),
            "settings.get" => Ok(json!({ "settings": self.settings })),
            "settings.save" => {
                let mut next: AppSettings =
                    serde_json::from_value(args.get("settings").cloned().unwrap_or(json!({})))
                        .map_err(|_| invalid("Those settings are not valid"))?;
                // Only `settings.channel` may change the release channel, and
                // this build never collects telemetry.
                next.update_channel = self.settings.update_channel.clone();
                next.telemetry = false;
                next.validate()?;
                self.settings = next.clone();
                self.persist_settings()?;
                Ok(json!({ "settings": next }))
            }
            "settings.channel" => {
                let channel = str_arg(args, "channel");
                let parsed = acuye_updater_channel(&channel)?;
                if parsed != "stable" && !bool_arg(args, "acknowledge") {
                    return Err(invalid(
                        "Beta and alpha channels must be explicitly enabled",
                    ));
                }
                self.settings.update_channel = parsed;
                self.settings.validate()?;
                self.persist_settings()?;
                Ok(json!({ "settings": self.settings }))
            }
            "session.touch" => match self.unlocked_mut() {
                Ok(_) => Ok(json!({ "session": self.session_value() })),
                Err(_) => Ok(json!({ "session": null })),
            },
            "items.list" => {
                let kind = match opt_str(args, "itemType") {
                    Some(value) => Some(
                        serde_json::from_value::<ItemType>(Value::String(value))
                            .map_err(|_| invalid("Unknown item type"))?,
                    ),
                    None => None,
                };
                self.search_json(
                    &str_arg(args, "query"),
                    kind,
                    bool_arg(args, "favoritesOnly"),
                )
            }
            "items.get" => {
                let id = str_arg(args, "id");
                let item = self
                    .unlocked_ref()?
                    .vault
                    .get(&id)
                    .cloned()
                    .ok_or_else(|| AcuyeError::NotFound("item".into()))?;
                Ok(json!({ "item": item }))
            }
            "items.secret" => {
                let id = str_arg(args, "id");
                let field = str_arg(args, "field");
                let unlocked = self.unlocked_ref()?;
                let item = unlocked
                    .vault
                    .get(&id)
                    .ok_or_else(|| AcuyeError::NotFound("item".into()))?;
                let value = field_value(item, &field)
                    .ok_or_else(|| invalid("That field is empty or cannot be copied"))?;
                Ok(json!({ "value": value }))
            }
            "items.create" => {
                let fields: ItemFields =
                    serde_json::from_value(args.get("fields").cloned().unwrap_or(json!({})))
                        .map_err(|_| invalid("Those item fields are not valid"))?;
                let tags: Vec<String> = args
                    .get("tags")
                    .cloned()
                    .and_then(|value| serde_json::from_value(value).ok())
                    .unwrap_or_default();
                let item = self.create_item(
                    fields,
                    &str_arg(args, "title"),
                    &str_arg(args, "notes"),
                    &tags,
                    bool_arg(args, "favorite"),
                )?;
                Ok(json!({ "item": item }))
            }
            "items.update" => {
                let item: Item =
                    serde_json::from_value(args.get("item").cloned().unwrap_or(json!({})))
                        .map_err(|_| invalid("That item is not valid"))?;
                Ok(json!({ "item": self.update_item(item)? }))
            }
            "items.delete" => {
                let id = str_arg(args, "id");
                self.unlocked_mut()?.vault.delete(&id)?;
                self.service.db().delete_item(&id)?;
                Ok(json!({ "deleted": true }))
            }
            "items.duplicate" => {
                let id = str_arg(args, "id");
                let copy = self.unlocked_mut()?.vault.duplicate(&id)?;
                let stored = self.unlocked_mut()?.encrypt_item(&copy)?;
                self.service.db().upsert_item(&stored)?;
                Ok(json!({ "item": copy }))
            }
            "items.favorite" => {
                let id = str_arg(args, "id");
                let item = self.unlocked_mut()?.vault.toggle_favorite(&id)?;
                let stored = self.unlocked_mut()?.encrypt_item(&item)?;
                self.service.db().upsert_item(&stored)?;
                Ok(json!({ "item": item }))
            }
            "items.counts" => {
                let vault = &self.unlocked_ref()?.vault;
                Ok(json!({
                    "counts": {
                        "total": vault.items.len(),
                        "favorites": vault.favorites_count(),
                        "logins": vault.count(ItemType::Login),
                        "notes": vault.count(ItemType::SecureNote),
                        "cards": vault.count(ItemType::Card),
                        "identities": vault.count(ItemType::Identity),
                        "documents": vault.count(ItemType::Document),
                        "custom": vault.count(ItemType::Custom),
                        "authenticators": vault.count(ItemType::Totp),
                        "secrets": vault.count(ItemType::Secret),
                    }
                }))
            }
            "security.report" => {
                let report = self.unlocked_ref()?.vault.security_report();
                Ok(json!({ "report": report }))
            }
            "generator.password" => {
                let options: PasswordOptions =
                    serde_json::from_value(args.get("options").cloned().unwrap_or(json!({})))
                        .map_err(|_| invalid("Invalid generator options"))?;
                Ok(json!({ "password": acuye_generator::generate_password(&options)? }))
            }
            "generator.passphrase" => {
                let options: PassphraseOptions =
                    serde_json::from_value(args.get("options").cloned().unwrap_or(json!({})))
                        .map_err(|_| invalid("Invalid passphrase options"))?;
                Ok(json!({ "passphrase": acuye_generator::generate_passphrase(&options)? }))
            }
            "generator.strength" => {
                let strength = acuye_generator::strength::evaluate(&str_arg(args, "password"));
                Ok(json!({ "strength": strength }))
            }
            "authenticator.list" => {
                let unlocked = self.unlocked_ref()?;
                let at = acuye_core::time::now() as u64;
                let mut entries: Vec<Value> = Vec::new();
                for item in &unlocked.vault.items {
                    if !matches!(item.fields, ItemFields::Totp { .. }) {
                        continue;
                    }
                    entries.push(entry_value(item, at));
                }
                entries.sort_by(|left, right| {
                    left["title"]
                        .as_str()
                        .unwrap_or("")
                        .to_lowercase()
                        .cmp(&right["title"].as_str().unwrap_or("").to_lowercase())
                });
                Ok(json!({ "entries": entries }))
            }
            "authenticator.addUri" => {
                let config = OtpConfig::parse_uri(&str_arg(args, "uri"))?;
                let title = entry_title("", &config);
                let item = self.store_entry(config, title)?;
                Ok(json!({ "item": item }))
            }
            "authenticator.addEntry" => {
                let entry = args.get("entry").cloned().unwrap_or(json!({}));
                let config = OtpConfig::from_parts(
                    &str_arg(&entry, "secret"),
                    &str_arg(&entry, "issuer"),
                    &str_arg(&entry, "account"),
                    &str_arg(&entry, "algorithm"),
                    entry.get("digits").and_then(Value::as_u64).unwrap_or(6) as u32,
                    entry.get("period").and_then(Value::as_u64).unwrap_or(30) as u32,
                    &str_arg(&entry, "otpType"),
                    entry.get("counter").and_then(Value::as_u64).unwrap_or(0),
                )?;
                if self.unlocked_ref()?.vault.items.iter().any(|existing| {
                    matches!(&existing.fields, ItemFields::Totp { secret, .. } if secret == &config.secret)
                }) {
                    return Err(invalid(
                        "That authenticator secret is already in your vault",
                    ));
                }
                let title = entry_title(&str_arg(&entry, "name"), &config);
                let item = self.store_entry(config, title)?;
                Ok(json!({ "item": item }))
            }
            "authenticator.advance" => {
                let id = str_arg(args, "id");
                let item = self
                    .unlocked_ref()?
                    .vault
                    .get(&id)
                    .cloned()
                    .ok_or_else(|| AcuyeError::NotFound("item".into()))?;
                let config = totp_config(&item)?;
                if !config.is_counter_based() {
                    return Err(invalid("That entry uses time based codes, not a counter"));
                }
                let counter = config.counter.saturating_add(1);
                let mut updated = item;
                if let ItemFields::Totp {
                    counter: stored, ..
                } = &mut updated.fields
                {
                    *stored = counter;
                }
                let updated = self.update_item(updated)?;
                Ok(json!({ "item": updated, "counter": counter }))
            }
            "authenticator.export" => {
                let id = str_arg(args, "id");
                let item = self
                    .unlocked_ref()?
                    .vault
                    .get(&id)
                    .cloned()
                    .ok_or_else(|| AcuyeError::NotFound("item".into()))?;
                Ok(json!({ "uri": totp_config(&item)?.to_uri() }))
            }
            "secrets.reveal" => {
                let id = str_arg(args, "id");
                let index = u64_arg(args, "index") as usize;
                let (value, concealed) = {
                    let item = self
                        .unlocked_ref()?
                        .vault
                        .get(&id)
                        .ok_or_else(|| AcuyeError::NotFound("item".into()))?;
                    let fields = match &item.fields {
                        ItemFields::Secret { fields, .. } => fields,
                        _ => return Err(invalid("That item is not a secret")),
                    };
                    let field = fields
                        .get(index)
                        .ok_or_else(|| invalid("That field does not exist"))?;
                    (field.value.clone(), field.concealed)
                };
                self.service.db_mut().record_secret_access(
                    &id,
                    "revealed",
                    acuye_core::time::now(),
                )?;
                Ok(json!({ "value": value, "concealed": concealed }))
            }
            "secrets.accessLog" => {
                let rows = self.service.db().secret_access(&str_arg(args, "id"))?;
                Ok(json!({
                    "entries": rows.into_iter().map(|row| json!({
                        "action": row.action,
                        "at": row.at,
                    })).collect::<Vec<_>>()
                }))
            }
            "secrets.clearHistory" => {
                let id = str_arg(args, "id");
                self.service.db_mut().clear_secret_access(&id)?;
                Ok(json!({ "cleared": true }))
            }
            "secrets.alerts" => Ok(json!({ "alerts": self.secret_alerts() })),
            "devices.list" => {
                let current = self.device_id.clone();
                let devices = self.service.db().list_devices()?;
                Ok(json!({
                    "devices": devices.into_iter().map(|device| device_value(device, &current))
                        .collect::<Vec<_>>()
                }))
            }
            "devices.revoke" => {
                let id = str_arg(args, "id");
                if id == self.device_id {
                    return Err(invalid(
                        "This is the device you are using. Lock the vault instead.",
                    ));
                }
                self.service.db().revoke_device(&id)?;
                Ok(json!({ "revoked": true }))
            }
            "storage.info" => {
                let db = self.service.db();
                let paths = self.paths();
                Ok(json!({
                    "info": {
                        "dataDir": paths.data.to_string_lossy(),
                        "databasePath": paths.database.to_string_lossy(),
                        "databaseSize": db.db_size_bytes(),
                        "schemaVersion": db.schema_version()?,
                        "integrityOk": db.integrity_ok(),
                        "backupDir": paths.backups.to_string_lossy(),
                        "exportDir": paths.exports.to_string_lossy(),
                        "itemCount": db.item_count()?,
                    }
                }))
            }
            "backups.create" => {
                let paths = self.paths();
                fs::create_dir_all(&paths.backups)?;
                let name = format!("acuye-backup-{}.db", acuye_core::time::now());
                let path = paths.backups.join(&name);
                self.service.db().backup_to(&path)?;
                Ok(json!({
                    "backup": backup_value(&path, acuye_core::time::now())
                }))
            }
            "backups.list" => {
                let dir = self.paths().backups;
                let mut backups: Vec<Value> = Vec::new();
                if let Ok(entries) = fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.extension().and_then(|value| value.to_str()) != Some("db") {
                            continue;
                        }
                        let created = entry
                            .metadata()
                            .and_then(|meta| meta.modified())
                            .ok()
                            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|duration| duration.as_secs() as i64)
                            .unwrap_or(0);
                        backups.push(backup_value(&path, created));
                    }
                }
                backups.sort_by(|left, right| {
                    right["createdAt"]
                        .as_i64()
                        .unwrap_or(0)
                        .cmp(&left["createdAt"].as_i64().unwrap_or(0))
                });
                Ok(json!({ "backups": backups }))
            }
            "backups.restore" => {
                let name = str_arg(args, "name");
                if name.contains('/')
                    || name.contains('\\')
                    || name.contains("..")
                    || !name.ends_with(".db")
                {
                    return Err(invalid("Invalid backup name"));
                }
                let path = self.paths().backups.join(&name);
                if !path.exists() {
                    return Err(invalid("That backup does not exist"));
                }
                self.unlocked = None;
                self.service.db_mut().replace_with_backup(&path)?;
                self.settings = load_settings(self.service.db());
                self.device_id = ensure_device(self.service.db())?;
                Ok(json!({ "restored": true }))
            }
            "storage.exportEncrypted" => {
                let password = str_arg(args, "password");
                acuye_export::validate_export_password(&password)?;
                let items = self.unlocked_ref()?.vault.items.clone();
                let payload =
                    acuye_export::encrypt_export(&items, &password, KdfParams::default())?;
                let path = self
                    .paths()
                    .exports
                    .join(format!("acuye-export-{}.json", acuye_core::time::now()));
                write_private(&path, payload.as_bytes())?;
                Ok(json!({
                    "export": {
                        "path": path.to_string_lossy(),
                        "encrypted": true,
                        "itemCount": items.len(),
                        "bytes": fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0),
                    }
                }))
            }
            "storage.exportCsv" => {
                if !bool_arg(args, "acknowledge") {
                    return Err(invalid(
                        "Plaintext export requires explicit acknowledgement",
                    ));
                }
                let items = self.unlocked_ref()?.vault.items.clone();
                let csv = acuye_export::to_csv(&items);
                let path = self
                    .paths()
                    .exports
                    .join(format!("acuye-export-{}.csv", acuye_core::time::now()));
                write_private(&path, csv.as_bytes())?;
                Ok(json!({
                    "export": {
                        "path": path.to_string_lossy(),
                        "encrypted": false,
                        "itemCount": items.len(),
                        "bytes": fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0),
                    }
                }))
            }
            "import.preview" => {
                let format = match opt_str(args, "format") {
                    Some(value) => Some(
                        serde_json::from_value::<acuye_import::ImportFormat>(Value::String(value))
                            .map_err(|_| invalid("Unknown import format"))?,
                    ),
                    None => None,
                };
                let parsed = acuye_import::parse(&str_arg(args, "payload"), format)?;
                Ok(json!({
                    "preview": {
                        "format": parsed.format,
                        "items": parsed.items,
                        "skipped": parsed.skipped,
                        "warnings": parsed.warnings,
                    }
                }))
            }
            "import.apply" => {
                let format = match opt_str(args, "format") {
                    Some(value) => Some(
                        serde_json::from_value::<acuye_import::ImportFormat>(Value::String(value))
                            .map_err(|_| invalid("Unknown import format"))?,
                    ),
                    None => None,
                };
                Ok(json!({ "result": self.import_items(items_arg(args, "items"), format)? }))
            }
            "import.encrypted" => {
                let payload = str_arg(args, "payload");
                let password = str_arg(args, "password");
                let imported = acuye_export::decrypt_export(&payload, &password)?;
                Ok(json!({ "result": self.import_items(imported.items, None)? }))
            }
            "recovery.status" => {
                let vault_id = str_arg(args, "vaultId");
                let status = self.service.recovery_status(&vault_id)?;
                Ok(json!({ "status": status }))
            }
            "recovery.questions" => {
                let questions = self.service.security_questions(&str_arg(args, "vaultId"))?;
                Ok(json!({ "questions": questions }))
            }
            "recovery.enable" => {
                let questions: Option<Vec<(String, String)>> = args
                    .get("questions")
                    .cloned()
                    .filter(|value| !value.is_null())
                    .map(|value| {
                        serde_json::from_value::<Vec<QuestionInput>>(value).map(|list| {
                            list.into_iter()
                                .map(|entry| (entry.question, entry.answer))
                                .collect()
                        })
                    })
                    .transpose()
                    .map_err(|_| invalid("Those security questions are not valid"))?;
                let setup = self.service.enable_recovery(
                    &str_arg(args, "vaultId"),
                    &str_arg(args, "password"),
                    questions.as_deref(),
                )?;
                Ok(json!({ "setup": setup }))
            }
            "recovery.disable" => {
                self.service
                    .disable_recovery(&str_arg(args, "vaultId"), &str_arg(args, "password"))?;
                Ok(json!({ "disabled": true }))
            }
            "recovery.withCode" => {
                self.unlocked = None;
                let outcome = self
                    .service
                    .recover_with_code(&str_arg(args, "code"), &str_arg(args, "newPassword"))?;
                self.finish_recovery(outcome)
            }
            "recovery.withAnswers" => {
                self.unlocked = None;
                let answers: Vec<String> = args
                    .get("answers")
                    .cloned()
                    .and_then(|value| serde_json::from_value(value).ok())
                    .unwrap_or_default();
                let outcome = self.service.recover_with_answers(
                    &str_arg(args, "vaultId"),
                    &answers,
                    &str_arg(args, "newPassword"),
                )?;
                self.finish_recovery(outcome)
            }
            other => Err(invalid(&format!("Unknown command: {other}"))),
        }
    }

    fn status_value(&self) -> Value {
        json!({
            "version": crate::CORE_VERSION,
            "accounts": self.service.accounts().unwrap_or_default()
                .into_iter().map(account_value).collect::<Vec<_>>(),
            "unlocked": self.is_unlocked(),
            "session": self.session_value(),
            "dataDir": self.data_dir.to_string_lossy(),
            "databaseSize": self.service.db().db_size_bytes(),
            "repository": "Ahaduzzamankhan/Acuye-Pass",
            "platform": "android",
            "settings": self.settings,
        })
    }

    fn unlocked_ref(&self) -> Result<&UnlockedVault> {
        self.unlocked
            .as_ref()
            .ok_or(AcuyeError::AuthenticationFailed)
    }

    fn store_entry(&mut self, config: OtpConfig, title: String) -> Result<Item> {
        let fields = ItemFields::Totp {
            secret: config.secret,
            issuer: config.issuer,
            account: config.account,
            algorithm: config.algorithm.as_str().to_ascii_lowercase(),
            digits: config.digits,
            period: config.period,
            otp_type: config.otp_type.as_str().to_string(),
            counter: config.counter,
        };
        self.create_item(fields, &title, "", &[], false)
    }

    fn import_items(
        &mut self,
        items: Vec<Item>,
        _format: Option<acuye_import::ImportFormat>,
    ) -> Result<Value> {
        if items.is_empty() {
            return Ok(json!({ "imported": 0, "renamed": 0 }));
        }
        let mut renamed = 0usize;
        let (prepared, persisted) = {
            let live = self.unlocked_ref()?;
            let mut prepared: Vec<Item> = Vec::with_capacity(items.len());
            let mut persisted = Vec::with_capacity(items.len());
            let mut accepted: Vec<String> = Vec::with_capacity(items.len());
            for mut item in items {
                while live.vault.get(&item.id).is_some() || accepted.contains(&item.id) {
                    item.id = acuye_crypto::b64_encode(&acuye_crypto::random_bytes(16));
                    renamed += 1;
                }
                item.normalize();
                item.validate()?;
                accepted.push(item.id.clone());
                persisted.push(live.encrypt_item(&item)?);
                prepared.push(item);
            }
            (prepared, persisted)
        };
        self.service.db_mut().upsert_items(&persisted)?;
        for item in prepared {
            self.unlocked_mut()?.vault.add(item)?;
        }
        Ok(json!({ "imported": persisted.len(), "renamed": renamed }))
    }

    fn secret_alerts(&self) -> Vec<Value> {
        let Ok(unlocked) = self.unlocked_ref() else {
            return Vec::new();
        };
        let at = acuye_core::time::now();
        const DAY: i64 = 86_400;
        let mut out: Vec<Value> = Vec::new();
        for item in &unlocked.vault.items {
            if let ItemFields::Secret {
                expires_at,
                rotate_every_days,
                last_rotated_at,
                ..
            } = &item.fields
            {
                if let Some(expires_at) = expires_at {
                    if *expires_at <= at {
                        out.push(alert_value(&item.id, &item.title, "expired", *expires_at));
                    } else if *expires_at - at <= 14 * DAY {
                        out.push(alert_value(&item.id, &item.title, "expiring", *expires_at));
                    }
                }
                if let Some(days) = rotate_every_days {
                    let anchor = last_rotated_at.unwrap_or(item.updated_at);
                    let due = anchor + i64::from(*days) * DAY;
                    if due <= at {
                        out.push(alert_value(&item.id, &item.title, "rotation_due", due));
                    } else if due - at <= 7 * DAY {
                        out.push(alert_value(&item.id, &item.title, "rotation_soon", due));
                    }
                }
            }
        }
        out.sort_by_key(|alert| alert["dueAt"].as_i64().unwrap_or(0));
        out
    }

    fn finish_recovery(&mut self, outcome: acuye_auth::RecoveryOutcome) -> Result<Value> {
        let code = outcome.recovery_code;
        self.set_session(outcome.unlocked);
        self.touch_device()?;
        Ok(json!({
            "session": self.session_value(),
            "recoveryCode": code,
        }))
    }
}

#[derive(serde::Deserialize)]
struct QuestionInput {
    question: String,
    answer: String,
}

struct Paths {
    data: PathBuf,
    database: PathBuf,
    backups: PathBuf,
    exports: PathBuf,
}

impl Paths {
    fn from_data_dir(data: PathBuf) -> Self {
        Self {
            database: data.join("acuye.db"),
            backups: data.join("backups"),
            exports: data.join("exports"),
            data,
        }
    }
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
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

fn backup_value(path: &Path, created_at: i64) -> Value {
    json!({
        "name": path.file_name().and_then(|name| name.to_str()).unwrap_or("backup"),
        "path": path.to_string_lossy(),
        "size": fs::metadata(path).map(|meta| meta.len()).unwrap_or(0),
        "createdAt": created_at,
    })
}

fn alert_value(id: &str, title: &str, kind: &str, due_at: i64) -> Value {
    json!({ "id": id, "title": title, "kind": kind, "dueAt": due_at })
}

fn account_value(account: AccountSummary) -> Value {
    json!({
        "vaultId": account.vault_id,
        "username": account.username,
        "vaultName": account.vault_name,
        "kdfAlgorithm": account.kdf_algorithm,
        "kdfMemoryKib": account.kdf_memory_kib,
        "kdfIterations": account.kdf_iterations,
        "createdAt": account.created_at,
    })
}

fn device_value(device: DeviceRecord, current_id: &str) -> Value {
    json!({
        "id": device.id,
        "name": device.name,
        "platform": device.platform,
        "createdAt": device.created_at,
        "lastSeenAt": device.last_seen_at,
        "revoked": device.revoked,
        "syncRegistered": device.sync_registered,
        "current": device.id == current_id,
    })
}

fn entry_value(item: &Item, at: u64) -> Value {
    let mut view = json!({
        "id": item.id,
        "title": item.title,
        "issuer": "",
        "account": "",
        "code": "",
        "digits": 6,
        "period": 30,
        "remaining": 0,
        "algorithm": "sha1",
        "otpType": "totp",
        "counter": 0,
        "progress": 0.0,
        "error": null,
    });
    match totp_config(item) {
        Ok(config) => {
            let code = if config.is_counter_based() {
                config
                    .code_for_counter(config.counter)
                    .map_err(|error| error.to_string())
            } else {
                config.code_at(at).map_err(|error| error.to_string())
            };
            view["issuer"] = json!(config.issuer);
            view["account"] = json!(config.account);
            view["digits"] = json!(config.digits);
            view["period"] = json!(config.period);
            view["remaining"] = json!(config.remaining_secs(at));
            view["progress"] = json!(config.progress(at));
            view["algorithm"] = json!(config.algorithm.as_str().to_ascii_lowercase());
            view["otpType"] = json!(config.otp_type.as_str());
            view["counter"] = json!(config.counter);
            match code {
                Ok(code) => view["code"] = json!(code),
                Err(error) => view["error"] = json!(error),
            }
        }
        Err(error) => view["error"] = json!(error.to_string()),
    }
    view
}

fn totp_code(config: &OtpConfig) -> Result<Value> {
    let now = acuye_core::time::now() as u64;
    let code = if config.is_counter_based() {
        config.code_for_counter(config.counter)?
    } else {
        config.code_at(now)?
    };
    Ok(json!({
        "code": code,
        "remaining": config.remaining_secs(now),
        "period": config.period,
        "progress": config.progress(now),
        "otpType": config.otp_type.as_str(),
        "counter": config.counter,
    }))
}

fn load_settings(db: &Database) -> AppSettings {
    db.get_setting(SETTINGS_KEY)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<AppSettings>(&raw).ok())
        .filter(|settings| settings.validate().is_ok())
        .unwrap_or_default()
}

fn ensure_device(db: &Database) -> Result<String> {
    if let Some(id) = db.get_setting(DEVICE_ID_KEY)? {
        return Ok(id);
    }
    let id = acuye_crypto::b64_encode(&acuye_crypto::random_bytes(16));
    db.set_setting(DEVICE_ID_KEY, &id)?;
    let now = acuye_core::time::now();
    db.upsert_device(&DeviceRecord {
        id: id.clone(),
        name: "Android phone".into(),
        platform: "android".into(),
        created_at: now,
        last_seen_at: now,
        revoked: false,
        sync_registered: false,
    })?;
    Ok(id)
}

fn touch_device(db: &Database, device_id: &str) -> Result<()> {
    let mut devices = db.list_devices()?;
    if let Some(device) = devices.iter_mut().find(|device| device.id == device_id) {
        device.last_seen_at = acuye_core::time::now();
        db.upsert_device(device)?;
    }
    Ok(())
}

fn acuye_updater_channel(value: &str) -> Result<String> {
    match value {
        "stable" | "beta" | "alpha" => Ok(value.to_string()),
        _ => Err(invalid("Unknown release channel")),
    }
}

fn field_value(item: &Item, field: &str) -> Option<String> {
    let value = match (field, &item.fields) {
        ("title", _) => item.title.clone(),
        ("notes", _) => item.notes.clone(),
        ("username", ItemFields::Login { username, .. }) => username.clone(),
        ("password", ItemFields::Login { password, .. }) => password.clone(),
        ("url", ItemFields::Login { url, .. }) => url.clone(),
        ("totp", ItemFields::Login { totp, .. }) => totp.clone(),
        ("secret", ItemFields::Totp { secret, .. }) => secret.clone(),
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

fn entry_title(name: &str, config: &OtpConfig) -> String {
    let name = name.trim();
    if !name.is_empty() {
        name.to_string()
    } else if !config.issuer.is_empty() {
        config.issuer.clone()
    } else if !config.account.is_empty() {
        config.account.clone()
    } else {
        "Authenticator".to_string()
    }
}

fn normalize_host(host: &str) -> String {
    host.trim().trim_start_matches("www.").to_lowercase()
}

/// Logins whose URL host equals `host`, for the future mobile autofill service.
pub fn matches_host_json(vault: &MobileVault, host: &str) -> String {
    let Ok(unlocked) = vault
        .unlocked
        .as_ref()
        .ok_or(AcuyeError::AuthenticationFailed)
    else {
        return error_json(&AcuyeError::AuthenticationFailed);
    };
    let wanted = normalize_host(host);
    let items: Vec<Value> = unlocked
        .vault
        .items
        .iter()
        .filter_map(|item| match &item.fields {
            ItemFields::Login { url, username, .. } => {
                let item_host = url
                    .split("://")
                    .nth(1)
                    .unwrap_or(url)
                    .split('/')
                    .next()
                    .unwrap_or("")
                    .trim_start_matches("www.")
                    .to_lowercase();
                if !wanted.is_empty() && item_host == wanted {
                    Some(json!({ "id": item.id, "title": item.title, "username": username }))
                } else {
                    None
                }
            }
            _ => None,
        })
        .collect();
    ok(json!({ "items": items }))
}

fn totp_config(item: &Item) -> Result<OtpConfig> {
    match &item.fields {
        ItemFields::Totp {
            secret,
            issuer,
            account,
            algorithm,
            digits,
            period,
            otp_type,
            counter,
        } => Ok(OtpConfig {
            secret: secret.clone(),
            issuer: issuer.clone(),
            account: account.clone(),
            algorithm: TotpAlgorithm::parse(algorithm)?,
            digits: *digits,
            period: *period,
            otp_type: OtpType::parse(otp_type)?,
            counter: *counter,
        }),
        ItemFields::Login { totp, .. } => {
            let value = totp.trim();
            if value.is_empty() {
                return Err(invalid("That login has no authenticator secret"));
            }
            if value.starts_with("otpauth://") {
                return OtpConfig::parse_uri(value);
            }
            let secret = value.replace(' ', "").to_uppercase();
            OtpConfig::parse_uri(&format!("otpauth://totp/Acuye?secret={secret}"))
        }
        _ => Err(invalid("That item has no authenticator entry")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    /// A database inside its own directory. Backups and exports live next to
    /// the database, so each test needs its own directory to stay isolated
    /// from earlier runs.
    fn temp_db() -> PathBuf {
        let unique = format!(
            "acuye-mobile-test-{}-{}-{}",
            std::process::id(),
            acuye_core::time::now(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        let dir = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("acuye.db")
    }

    fn call(vault: &mut MobileVault, op: &str, args: Value) -> Value {
        serde_json::from_str(&vault.call(op, &args.to_string())).unwrap()
    }

    #[test]
    fn unlock_list_reveal_and_totp_round_trip() {
        let path = temp_db();
        let mut vault = MobileVault::open(path.to_str().unwrap()).unwrap();
        let status: Value = call(
            &mut vault,
            "accounts.create",
            json!({ "username": "ada", "password": "correct-horse-battery-42" }),
        );
        assert_eq!(status["ok"], true);
        assert_eq!(status["unlocked"], true);

        let created: Value = call(
            &mut vault,
            "items.create",
            json!({
                "title": "Example",
                "fields": {
                    "kind": "login",
                    "username": "ada@example.com",
                    "password": "server-password-123",
                    "url": "https://example.com"
                }
            }),
        );
        assert_eq!(created["ok"], true);
        let id = created["item"]["id"].as_str().unwrap().to_string();

        let listed: Value = call(&mut vault, "items.list", json!({}));
        assert_eq!(listed["items"].as_array().unwrap().len(), 1);
        let searched: Value = call(&mut vault, "items.list", json!({ "query": "examp" }));
        assert_eq!(searched["items"].as_array().unwrap().len(), 1);

        let secret: Value = call(
            &mut vault,
            "items.secret",
            json!({ "id": id, "field": "password" }),
        );
        assert_eq!(secret["value"], "server-password-123");

        assert!(vault.lock_json().contains("\"ok\":true"));
        let locked: Value = call(&mut vault, "items.list", json!({}));
        assert_eq!(locked["ok"], false);

        let wrong: Value = call(
            &mut vault,
            "accounts.unlock",
            json!({ "username": "ada", "password": "not-the-password-1" }),
        );
        assert_eq!(wrong["ok"], false);
        assert_eq!(wrong["code"], "authentication_failed");

        let reopened: Value = call(
            &mut vault,
            "accounts.unlock",
            json!({ "username": "ada", "password": "correct-horse-battery-42" }),
        );
        assert_eq!(reopened["unlocked"], true);

        let item: Value = call(&mut vault, "items.get", json!({ "id": id }));
        assert_eq!(item["item"]["title"], "Example");

        std::fs::remove_file(path).ok();
    }

    #[test]
    fn every_item_type_round_trips_and_counts() {
        let path = temp_db();
        let mut vault = MobileVault::open(path.to_str().unwrap()).unwrap();
        call(
            &mut vault,
            "accounts.create",
            json!({ "username": "ada", "password": "correct-horse-battery-42" }),
        );

        let kinds = [
            json!({ "kind": "login", "username": "a", "password": "b", "url": "https://a.test" }),
            json!({ "kind": "secure_note" }),
            json!({ "kind": "card", "number": "4111", "cardholder": "Ada" }),
            json!({ "kind": "identity", "email": "ada@example.com" }),
            json!({ "kind": "document", "filename": "id.pdf" }),
            json!({ "kind": "custom", "fields": [{ "label": "PIN", "value": "1234" }] }),
            json!({ "kind": "totp", "secret": "JBSWY3DPEHPK3PXP" }),
            json!({ "kind": "secret", "environment": "production", "fields": [] }),
        ];
        for (index, fields) in kinds.into_iter().enumerate() {
            let created: Value = call(
                &mut vault,
                "items.create",
                json!({ "title": format!("Item {index}"), "fields": fields }),
            );
            assert_eq!(created["ok"], true, "{created}");
        }
        let counts: Value = call(&mut vault, "items.counts", json!({}));
        assert_eq!(counts["counts"]["total"], 8);
        assert_eq!(counts["counts"]["authenticators"], 1);
        assert_eq!(counts["counts"]["secrets"], 1);

        let auth: Value = call(&mut vault, "authenticator.list", json!({}));
        let entries = auth["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["code"].as_str().unwrap().len(), 6);

        std::fs::remove_file(path).ok();
    }

    #[test]
    fn settings_import_export_and_backups_work() {
        let path = temp_db();
        let mut vault = MobileVault::open(path.to_str().unwrap()).unwrap();
        call(
            &mut vault,
            "accounts.create",
            json!({ "username": "ada", "password": "correct-horse-battery-42" }),
        );
        call(
            &mut vault,
            "items.create",
            json!({
                "title": "Mail",
                "fields": { "kind": "login", "username": "ada", "password": "pw-1234567890" }
            }),
        );

        let mut settings: Value = call(&mut vault, "settings.get", json!({}));
        settings["settings"]["auto_lock_secs"] = json!(120);
        let saved: Value = call(
            &mut vault,
            "settings.save",
            json!({ "settings": settings["settings"] }),
        );
        assert_eq!(saved["settings"]["auto_lock_secs"], 120);

        let exported: Value = call(
            &mut vault,
            "storage.exportEncrypted",
            json!({ "password": "export-password-123" }),
        );
        assert_eq!(exported["ok"], true, "{exported}");
        let exported_path = exported["export"]["path"].as_str().unwrap().to_string();
        let payload = std::fs::read_to_string(&exported_path).unwrap();
        let decrypted: Value = call(
            &mut vault,
            "import.encrypted",
            json!({ "payload": payload, "password": "export-password-123" }),
        );
        assert_eq!(decrypted["result"]["imported"], 1, "{decrypted}");

        let backup: Value = call(&mut vault, "backups.create", json!({}));
        assert_eq!(backup["ok"], true, "{backup}");
        let list: Value = call(&mut vault, "backups.list", json!({}));
        assert_eq!(list["backups"].as_array().unwrap().len(), 1);

        if let Some(dir) = path.parent() {
            std::fs::remove_dir_all(dir).ok();
        }
        let _ = exported_path;
    }

    #[test]
    fn matches_host_finds_the_login() {
        let path = temp_db();
        let mut vault = MobileVault::open(path.to_str().unwrap()).unwrap();
        vault
            .create_json("ada", "correct-horse-battery-42")
            .to_string();
        vault.create_login_json(
            "Example",
            "ada@example.com",
            "server-password-123",
            "https://www.example.com/login",
            "",
        );
        let matched: Value =
            serde_json::from_str(&matches_host_json(&vault, "example.com")).unwrap();
        assert_eq!(matched["items"].as_array().unwrap().len(), 1);
        let empty: Value = serde_json::from_str(&matches_host_json(&vault, "other.test")).unwrap();
        assert!(empty["items"].as_array().unwrap().is_empty());
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn generator_is_shared_with_desktop() {
        let path = temp_db();
        let vault = MobileVault::open(path.to_str().unwrap()).unwrap();
        let value: Value = serde_json::from_str(&vault.generate_json(r#"{"length":20}"#)).unwrap();
        assert_eq!(value["ok"], true);
        assert_eq!(value["password"].as_str().unwrap().len(), 20);
        std::fs::remove_file(path).ok();
    }
}
