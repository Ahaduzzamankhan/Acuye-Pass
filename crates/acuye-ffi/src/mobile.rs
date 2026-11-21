//! Shared mobile vault session.
//!
//! React Native never sees key material or SQLite: the app calls into this
//! module through JNI (`android.rs`), and every answer is a JSON string. The
//! module reuses the exact desktop crates, so KDF parameters, wrapping, item
//! encryption and TOTP all behave identically on Android.

use acuye_auth::{AuthService, UnlockedVault};
use acuye_core::{AcuyeError, Item, ItemFields, Result};
use acuye_crypto::KdfParams;
use acuye_storage::Database;
use acuye_totp::{OtpConfig, OtpType, TotpAlgorithm, TotpConfig};
use serde_json::json;

fn error_json(error: &AcuyeError) -> String {
    json!({
        "ok": false,
        "code": error.code(),
        "message": error.to_string(),
    })
    .to_string()
}

fn ok(value: serde_json::Value) -> String {
    let mut object = serde_json::Map::new();
    object.insert("ok".into(), serde_json::Value::Bool(true));
    if let serde_json::Value::Object(map) = value {
        for (key, value) in map {
            object.insert(key, value);
        }
    }
    serde_json::Value::Object(object).to_string()
}

/// One unlocked vault plus the service that opened it.
pub struct MobileVault {
    service: AuthService,
    unlocked: Option<UnlockedVault>,
}

impl MobileVault {
    /// Open the local database. The vault stays locked until `unlock_json`.
    pub fn open(db_path: &str) -> Result<Self> {
        if db_path.trim().is_empty() {
            return Err(AcuyeError::Validation(
                "The app data directory is unavailable".into(),
            ));
        }
        let db = Database::open(db_path)?;
        Ok(Self {
            service: AuthService::new(db, KdfParams::default()),
            unlocked: None,
        })
    }

    pub fn is_unlocked(&self) -> bool {
        self.unlocked.is_some()
    }

    /// Accounts, unlock state and the shared core version.
    pub fn status_json(&self) -> String {
        let accounts: Vec<serde_json::Value> = self
            .service
            .accounts()
            .unwrap_or_default()
            .into_iter()
            .map(|account| {
                json!({
                    "vaultId": account.vault_id,
                    "username": account.username,
                    "vaultName": account.vault_name,
                })
            })
            .collect();
        ok(json!({
            "version": crate::CORE_VERSION,
            "accounts": accounts,
            "unlocked": self.is_unlocked(),
            "session": self.unlocked.as_ref().map(|unlocked| json!({
                "username": unlocked.username,
                "vaultId": unlocked.vault.id,
                "vaultName": unlocked.vault.name,
                "itemCount": unlocked.vault.items.len(),
            })),
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
                self.unlocked = Some(unlocked);
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
                self.unlocked = Some(unlocked);
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

    fn session(&self) -> Result<&UnlockedVault> {
        self.unlocked
            .as_ref()
            .ok_or_else(|| AcuyeError::AuthenticationFailed)
    }

    /// Item summaries, optionally filtered by a search string.
    pub fn list_json(&self, query: &str) -> String {
        let unlocked = match self.session() {
            Ok(unlocked) => unlocked,
            Err(error) => return error_json(&error),
        };
        let needle = query.trim().to_lowercase();
        let mut items: Vec<serde_json::Value> = unlocked
            .vault
            .summaries()
            .into_iter()
            .filter(|summary| {
                needle.is_empty()
                    || summary.title.to_lowercase().contains(&needle)
                    || summary.subtitle.to_lowercase().contains(&needle)
                    || summary.host.to_lowercase().contains(&needle)
            })
            .map(|summary| {
                json!({
                    "id": summary.id,
                    "title": summary.title,
                    "subtitle": summary.subtitle,
                    "type": summary.item_type,
                    "typeLabel": summary.item_type.label(),
                    "favorite": summary.favorite,
                    "host": summary.host,
                    "hasPassword": summary.has_password,
                    "updatedAt": summary.updated_at,
                })
            })
            .collect();
        items.sort_by(|left, right| {
            left["title"]
                .as_str()
                .unwrap_or("")
                .to_lowercase()
                .cmp(&right["title"].as_str().unwrap_or("").to_lowercase())
        });
        ok(json!({ "items": items }))
    }

    /// One full item, with its type-specific fields already tagged by serde.
    pub fn item_json(&self, id: &str) -> String {
        let unlocked = match self.session() {
            Ok(unlocked) => unlocked,
            Err(error) => return error_json(&error),
        };
        match unlocked.vault.get(id) {
            Some(item) => ok(json!({ "item": item })),
            None => error_json(&AcuyeError::NotFound("item".into())),
        }
    }

    /// Reveal one field. Usernames, URLs and notes are returned as-is; the
    /// password and TOTP secret are only returned when explicitly requested.
    pub fn secret_json(&self, id: &str, field: &str) -> String {
        let unlocked = match self.session() {
            Ok(unlocked) => unlocked,
            Err(error) => return error_json(&error),
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
            _ => return error_json(&AcuyeError::Validation("Unknown field".into())),
        };
        ok(json!({ "value": value }))
    }

    /// Current TOTP code for a login's `totp` field or an authenticator item.
    pub fn totp_json(&self, id: &str) -> String {
        let unlocked = match self.session() {
            Ok(unlocked) => unlocked,
            Err(error) => return error_json(&error),
        };
        let Some(item) = unlocked.vault.get(id) else {
            return error_json(&AcuyeError::NotFound("item".into()));
        };
        let config = match totp_config(item) {
            Ok(config) => config,
            Err(error) => return error_json(&error),
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        match config.code_at(now) {
            Ok(code) => ok(json!({
                "code": code,
                "remaining": config.remaining_secs(now),
                "period": config.period,
            })),
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
        let mut unlocked = match self.unlocked.take() {
            Some(unlocked) => unlocked,
            None => return error_json(&AcuyeError::AuthenticationFailed),
        };
        let mut item = Item::new(
            ItemFields::Login {
                username: username.to_string(),
                password: password.to_string(),
                url: url.to_string(),
                totp: String::new(),
                password_changed_at: Some(acuye_core::time::now()),
            },
            title,
        );
        if !notes.trim().is_empty() {
            item.notes = notes.to_string();
        }
        let result = (|| -> Result<serde_json::Value> {
            let added = unlocked.vault.add(item)?;
            let stored = unlocked.encrypt_item(&added)?;
            self.service.db().upsert_item(&stored)?;
            Ok(json!({ "item": added }))
        })();
        self.unlocked = Some(unlocked);
        match result {
            Ok(value) => ok(value),
            Err(error) => error_json(&error),
        }
    }

    /// Password generator, reusing the desktop engine.
    pub fn generate_json(&self, options_json: &str) -> String {
        crate::generate_password_json(options_json)
    }
}

fn normalize_host(host: &str) -> String {
    host.trim().trim_start_matches("www.").to_lowercase()
}

/// Logins whose URL host equals `host`, for a future mobile autofill service.
pub fn matches_host_json(vault: &MobileVault, host: &str) -> String {
    let unlocked = match vault.session() {
        Ok(unlocked) => unlocked,
        Err(error) => return error_json(&error),
    };
    let wanted = normalize_host(host);
    let items: Vec<serde_json::Value> = unlocked
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

fn totp_config(item: &Item) -> Result<TotpConfig> {
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
        } => Ok(TotpConfig {
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
                return Err(AcuyeError::Validation(
                    "That login has no authenticator secret".into(),
                ));
            }
            if value.starts_with("otpauth://") {
                return OtpConfig::parse_uri(value);
            }
            let secret = value.replace(' ', "").to_uppercase();
            OtpConfig::parse_uri(&format!("otpauth://totp/Acuye?secret={secret}"))
        }
        _ => Err(AcuyeError::Validation(
            "That item has no authenticator entry".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_db() -> PathBuf {
        let unique = format!(
            "acuye-mobile-test-{}-{}-{}.db",
            std::process::id(),
            acuye_core::time::now(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        std::env::temp_dir().join(unique)
    }

    #[test]
    fn unlock_list_reveal_and_totp_round_trip() {
        let path = temp_db();
        let mut vault = MobileVault::open(path.to_str().unwrap()).unwrap();
        let status: serde_json::Value =
            serde_json::from_str(&vault.create_json("ada", "correct-horse-battery-42")).unwrap();
        assert_eq!(status["ok"], true);
        assert_eq!(status["unlocked"], true);

        let created: serde_json::Value = serde_json::from_str(&vault.create_login_json(
            "Example",
            "ada@example.com",
            "server-password-123",
            "https://example.com",
            "",
        ))
        .unwrap();
        assert_eq!(created["ok"], true);
        let id = created["item"]["id"].as_str().unwrap().to_string();

        let listed: serde_json::Value = serde_json::from_str(&vault.list_json("")).unwrap();
        assert_eq!(listed["items"].as_array().unwrap().len(), 1);
        let searched: serde_json::Value = serde_json::from_str(&vault.list_json("examp")).unwrap();
        assert_eq!(searched["items"].as_array().unwrap().len(), 1);

        let secret: serde_json::Value =
            serde_json::from_str(&vault.secret_json(&id, "password")).unwrap();
        assert_eq!(secret["value"], "server-password-123");

        assert_eq!(vault.lock_json().contains("\"ok\":true"), true);
        let locked: serde_json::Value = serde_json::from_str(&vault.list_json("")).unwrap();
        assert_eq!(locked["ok"], false);

        let wrong: serde_json::Value =
            serde_json::from_str(&vault.unlock_json(None, "ada", "not-the-password-1")).unwrap();
        assert_eq!(wrong["ok"], false);
        assert_eq!(wrong["code"], "authentication_failed");

        let reopened: serde_json::Value =
            serde_json::from_str(&vault.unlock_json(None, "ada", "correct-horse-battery-42"))
                .unwrap();
        assert_eq!(reopened["unlocked"], true);

        let item: serde_json::Value = serde_json::from_str(&vault.item_json(&id)).unwrap();
        assert_eq!(item["item"]["title"], "Example");

        std::fs::remove_file(path).ok();
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
        let matched: serde_json::Value =
            serde_json::from_str(&matches_host_json(&vault, "example.com")).unwrap();
        assert_eq!(matched["items"].as_array().unwrap().len(), 1);
        let empty: serde_json::Value =
            serde_json::from_str(&matches_host_json(&vault, "other.test")).unwrap();
        assert!(empty["items"].as_array().unwrap().is_empty());
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn generator_is_shared_with_desktop() {
        let path = temp_db();
        let vault = MobileVault::open(path.to_str().unwrap()).unwrap();
        let value: serde_json::Value =
            serde_json::from_str(&vault.generate_json(r#"{"length":20}"#)).unwrap();
        assert_eq!(value["ok"], true);
        assert_eq!(value["password"].as_str().unwrap().len(), 20);
        std::fs::remove_file(path).ok();
    }
}
