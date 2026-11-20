//! Username + master-password authentication and vault unlock.
//!
//! There is no biometric path anywhere in this crate. The username identifies
//! the local account; it is never used as key material. Password verification
//! happens against a derived verifier, and the actual vault key is unwrapped
//! only after the verifier matches.

use acuye_core::{AccountRecord, AccountSummary, AcuyeError, Result, Timestamp};
use acuye_crypto::{
    auth_verifier, derive_master_key, random_salt, unwrap_vault_key, verifiers_match,
    wrap_vault_key, ExpandedKeys, KdfParams, Sealed, SecretKey,
};
use acuye_generator::strength;
use acuye_storage::{Database, StoredItem};
use acuye_vault::{codec, Vault as VaultModel};

pub const MIN_MASTER_PASSWORD_LEN: usize = 10;
pub const MAX_MASTER_PASSWORD_LEN: usize = 1024;
pub const MIN_USERNAME_LEN: usize = 3;
pub const MAX_USERNAME_LEN: usize = 64;

/// Result of a successful create/unlock/rotation.
pub struct UnlockedVault {
    pub username: String,
    pub vault: VaultModel,
    pub vault_key: SecretKey,
}

impl std::fmt::Debug for UnlockedVault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UnlockedVault")
            .field("username", &self.username)
            .field("vault", &self.vault)
            .field("vault_key", &"REDACTED")
            .finish()
    }
}

impl UnlockedVault {
    pub fn encrypt_item(&self, item: &acuye_core::Item) -> Result<StoredItem> {
        let sealed = codec::encrypt_item(&self.vault_key, &self.vault.id, item)?;
        Ok(StoredItem {
            id: item.id.clone(),
            vault_id: self.vault.id.clone(),
            nonce: sealed.nonce,
            ciphertext: sealed.ciphertext,
            updated_at: item.updated_at,
        })
    }
}

pub struct AuthService {
    db: Database,
    kdf: KdfParams,
}

impl AuthService {
    pub fn new(db: Database, kdf: KdfParams) -> Self {
        Self { db, kdf }
    }

    pub fn with_default_kdf(db: Database) -> Self {
        Self::new(db, KdfParams::default())
    }

    /// Read-only access to persistence for settings/devices/diagnostics.
    pub fn db(&self) -> &Database {
        &self.db
    }

    pub fn db_mut(&mut self) -> &mut Database {
        &mut self.db
    }

    pub fn has_account(&self) -> Result<bool> {
        Ok(self.db.load_account()?.is_some())
    }

    pub fn account_summary(&self) -> Result<Option<AccountSummary>> {
        Ok(self.db.load_account()?.map(|a| AccountSummary {
            username: a.username,
            vault_id: a.vault_id,
            vault_name: a.vault_name,
            kdf_algorithm: a.kdf_algorithm,
            kdf_memory_kib: a.kdf_memory_kib,
            kdf_iterations: a.kdf_iterations,
            created_at: a.created_at,
        }))
    }

    /// First-launch account creation. Refuses to overwrite an existing vault.
    pub fn create_account(&self, username: &str, password: &str) -> Result<UnlockedVault> {
        if self.has_account()? {
            return Err(AcuyeError::Conflict(
                "an account already exists on this device".into(),
            ));
        }
        let username = normalize_username(username)?;
        validate_master_password(password, &username)?;

        let salt = random_salt();
        let master = derive_master_key(password, &salt, &self.kdf)?;
        let keys = ExpandedKeys::derive(&master)?;
        let verifier = auth_verifier(&keys.auth_key);
        let vault = VaultModel::new(acuye_vault::DEFAULT_VAULT_NAME);
        let vault_key = SecretKey::generate();
        let wrapped = wrap_vault_key(&keys.wrapping_key, &vault_key, &vault.id)?;
        let now = acuye_core::time::now();

        let record = AccountRecord {
            username: username.clone(),
            kdf_algorithm: "argon2id".into(),
            kdf_memory_kib: self.kdf.memory_kib,
            kdf_iterations: self.kdf.iterations,
            kdf_parallelism: self.kdf.parallelism,
            salt: salt.to_vec(),
            verifier: verifier.to_vec(),
            wrapped_vault_key: wrapped.ciphertext,
            vault_key_nonce: wrapped.nonce,
            vault_id: vault.id.clone(),
            vault_name: vault.name.clone(),
            created_at: now,
            updated_at: now,
        };
        self.db.insert_account(&record)?;

        Ok(UnlockedVault {
            username,
            vault,
            vault_key,
        })
    }

    /// Unlock an existing vault. Username comparison is case-insensitive;
    /// every failure returns the same error so account existence is not leaked.
    pub fn unlock(&self, username: &str, password: &str) -> Result<UnlockedVault> {
        let record = self
            .db
            .load_account()?
            .ok_or(AcuyeError::AuthenticationFailed)?;
        if !record.username.eq_ignore_ascii_case(username.trim()) {
            // Still run the KDF to keep timing roughly constant.
            let params = params_of(&record)?;
            let _ = derive_master_key(password, &record.salt, &params);
            return Err(AcuyeError::AuthenticationFailed);
        }
        let params = params_of(&record)?;
        let salt = record.salt.clone();
        let master = derive_master_key(password, &salt, &params)?;
        let keys = ExpandedKeys::derive(&master)?;
        let verifier = auth_verifier(&keys.auth_key);
        if !verifiers_match(&record.verifier, &verifier)? {
            return Err(AcuyeError::AuthenticationFailed);
        }

        let wrapped = Sealed {
            nonce: record.vault_key_nonce.clone(),
            ciphertext: record.wrapped_vault_key.clone(),
        };
        let vault_key = unwrap_vault_key(&keys.wrapping_key, &record.vault_id, &wrapped)?;

        let mut vault = VaultModel::restore(
            record.vault_id.clone(),
            record.vault_name.clone(),
            record.created_at,
        );
        let stored = self.db.load_items(&record.vault_id)?;
        let pairs = stored
            .into_iter()
            .map(|row| {
                (
                    row.id,
                    Sealed {
                        nonce: row.nonce,
                        ciphertext: row.ciphertext,
                    },
                )
            })
            .collect::<Vec<_>>();
        acuye_vault::decrypt_all(&vault_key, &mut vault, pairs)?;

        Ok(UnlockedVault {
            username: record.username,
            vault,
            vault_key,
        })
    }

    /// Full password + key rotation.
    ///
    /// A new salt, new password-derived keys and a brand-new vault key are
    /// generated; every item is re-encrypted and the account record is updated
    /// in a single SQLite transaction. The old password stops working.
    pub fn change_master_password(
        &mut self,
        current_password: &str,
        new_password: &str,
    ) -> Result<UnlockedVault> {
        let record = self
            .db
            .load_account()?
            .ok_or_else(|| AcuyeError::NotFound("account".into()))?;
        let params = params_of(&record)?;
        let master = derive_master_key(current_password, &record.salt, &params)?;
        let keys = ExpandedKeys::derive(&master)?;
        if !verifiers_match(&record.verifier, &auth_verifier(&keys.auth_key))? {
            return Err(AcuyeError::AuthenticationFailed);
        }
        let old_wrapped = Sealed {
            nonce: record.vault_key_nonce.clone(),
            ciphertext: record.wrapped_vault_key.clone(),
        };
        let old_vault_key = unwrap_vault_key(&keys.wrapping_key, &record.vault_id, &old_wrapped)?;

        validate_master_password(new_password, &record.username)?;
        if new_password == current_password {
            return Err(AcuyeError::Validation(
                "The new password must be different".into(),
            ));
        }

        // Decrypt everything with the old key first; abort on any failure.
        let stored = self.db.load_items(&record.vault_id)?;
        let mut vault = VaultModel::restore(
            record.vault_id.clone(),
            record.vault_name.clone(),
            record.created_at,
        );
        for row in &stored {
            let item = codec::decrypt_item(
                &old_vault_key,
                &record.vault_id,
                &row.id,
                &Sealed {
                    nonce: row.nonce.clone(),
                    ciphertext: row.ciphertext.clone(),
                },
            )?;
            vault.items.push(item);
        }

        // Fresh salt, fresh vault key, fresh wrapping.
        let new_salt = random_salt();
        let new_master = derive_master_key(new_password, &new_salt, &self.kdf)?;
        let new_keys = ExpandedKeys::derive(&new_master)?;
        let new_vault_key = SecretKey::generate();
        let wrapped = wrap_vault_key(&new_keys.wrapping_key, &new_vault_key, &record.vault_id)?;
        let now = acuye_core::time::now();
        let new_record = AccountRecord {
            username: record.username.clone(),
            kdf_algorithm: "argon2id".into(),
            kdf_memory_kib: self.kdf.memory_kib,
            kdf_iterations: self.kdf.iterations,
            kdf_parallelism: self.kdf.parallelism,
            salt: new_salt.to_vec(),
            verifier: auth_verifier(&new_keys.auth_key).to_vec(),
            wrapped_vault_key: wrapped.ciphertext,
            vault_key_nonce: wrapped.nonce,
            vault_id: record.vault_id.clone(),
            vault_name: record.vault_name.clone(),
            created_at: record.created_at,
            updated_at: now,
        };

        let mut resealed = Vec::with_capacity(vault.items.len());
        for item in &vault.items {
            let sealed = codec::encrypt_item(&new_vault_key, &record.vault_id, item)?;
            resealed.push(StoredItem {
                id: item.id.clone(),
                vault_id: record.vault_id.clone(),
                nonce: sealed.nonce,
                ciphertext: sealed.ciphertext,
                updated_at: item.updated_at,
            });
        }
        self.db.replace_vault_items(&new_record, &resealed)?;

        Ok(UnlockedVault {
            username: record.username,
            vault,
            vault_key: new_vault_key,
        })
    }

    /// Update the stored vault name. Requires proof that the caller holds an
    /// unlocked session (`vault_key`) even though the name itself is metadata.
    pub fn rename_vault(&mut self, vault_key: &SecretKey, name: &str) -> Result<()> {
        let trimmed = name.trim();
        if trimmed.is_empty() || trimmed.chars().count() > 64 {
            return Err(AcuyeError::Validation("Invalid vault name".into()));
        }
        // Touch the key so an uninitialized key can never be used here.
        if vault_key.as_bytes().iter().all(|b| *b == 0) {
            return Err(AcuyeError::AuthenticationFailed);
        }
        let mut record = self
            .db
            .load_account()?
            .ok_or_else(|| AcuyeError::NotFound("account".into()))?;
        record.vault_name = trimmed.to_string();
        record.updated_at = acuye_core::time::now();
        self.db.update_account(&record)?;
        Ok(())
    }

    pub fn now(&self) -> Timestamp {
        acuye_core::time::now()
    }
}

fn params_of(record: &AccountRecord) -> Result<KdfParams> {
    if record.kdf_algorithm != "argon2id" {
        return Err(AcuyeError::Unsupported(
            "unknown key derivation algorithm".into(),
        ));
    }
    let params = KdfParams {
        memory_kib: record.kdf_memory_kib,
        iterations: record.kdf_iterations,
        parallelism: record.kdf_parallelism,
    };
    params.validate()?;
    Ok(params)
}

pub fn normalize_username(username: &str) -> Result<String> {
    let trimmed = username.trim();
    let len = trimmed.chars().count();
    if !(MIN_USERNAME_LEN..=MAX_USERNAME_LEN).contains(&len) {
        return Err(AcuyeError::Validation(format!(
            "Username must be {MIN_USERNAME_LEN}-{MAX_USERNAME_LEN} characters"
        )));
    }
    let allowed = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '@' | '+'));
    if !allowed {
        return Err(AcuyeError::Validation(
            "Username may only contain letters, numbers and . _ - @ +".into(),
        ));
    }
    Ok(trimmed.to_string())
}

pub fn validate_master_password(password: &str, username: &str) -> Result<()> {
    let len = password.chars().count();
    if len < MIN_MASTER_PASSWORD_LEN {
        return Err(AcuyeError::Validation(format!(
            "The master password must be at least {MIN_MASTER_PASSWORD_LEN} characters"
        )));
    }
    if len > MAX_MASTER_PASSWORD_LEN {
        return Err(AcuyeError::Validation(
            "The master password is too long".into(),
        ));
    }
    if password.eq_ignore_ascii_case(username) {
        return Err(AcuyeError::Validation(
            "The master password cannot be your username".into(),
        ));
    }
    if strength::looks_common(password) {
        return Err(AcuyeError::Validation(
            "That password is a common pattern. Choose something unique to this vault.".into(),
        ));
    }
    let evaluation = strength::evaluate(password);
    if evaluation.score < 2 || strength::character_class_count(password) < 3 {
        return Err(AcuyeError::Validation(format!(
            "Choose a stronger master password: at least {MIN_MASTER_PASSWORD_LEN} characters with mixed character types"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use acuye_core::ItemFields;

    fn service() -> AuthService {
        AuthService::new(
            Database::open_in_memory().unwrap(),
            KdfParams {
                memory_kib: 19_456,
                iterations: 2,
                parallelism: 1,
            },
        )
    }

    const PASSWORD: &str = "correct-horse-battery-staple-42";

    fn login() -> acuye_core::Item {
        acuye_core::Item::new(
            ItemFields::Login {
                username: "ada@example.com".into(),
                password: "server-password-123".into(),
                url: "https://example.com".into(),
                totp: String::new(),
                password_changed_at: None,
            },
            "Example",
        )
    }

    #[test]
    fn create_then_unlock_with_same_credentials() {
        let auth = service();
        assert!(!auth.has_account().unwrap());
        let mut unlocked = auth.create_account("ada", PASSWORD).unwrap();
        let item = unlocked.vault.add(login()).unwrap();
        let stored = unlocked.encrypt_item(&item).unwrap();
        auth.db.upsert_item(&stored).unwrap();

        assert!(auth.has_account().unwrap());
        let reopened = auth.unlock("ADA", PASSWORD).unwrap();
        assert_eq!(reopened.vault.items.len(), 1);
        assert_eq!(reopened.vault.items[0].title, "Example");
        assert_eq!(auth.account_summary().unwrap().unwrap().username, "ada");
    }

    #[test]
    fn wrong_password_is_rejected() {
        let auth = service();
        auth.create_account("ada", PASSWORD).unwrap();
        assert!(matches!(
            auth.unlock("ada", "not-the-password-123"),
            Err(AcuyeError::AuthenticationFailed)
        ));
        assert!(matches!(
            auth.unlock("grace", PASSWORD),
            Err(AcuyeError::AuthenticationFailed)
        ));
    }

    #[test]
    fn second_account_creation_is_refused() {
        let auth = service();
        auth.create_account("ada", PASSWORD).unwrap();
        assert!(matches!(
            auth.create_account("other", PASSWORD),
            Err(AcuyeError::Conflict(_))
        ));
    }

    #[test]
    fn weak_or_invalid_credentials_are_rejected() {
        let auth = service();
        assert!(auth.create_account("ada", "short").is_err());
        assert!(auth.create_account("a", PASSWORD).is_err());
        assert!(auth.create_account("bad name", PASSWORD).is_err());
        assert!(auth.create_account("ada", "passwordpassword").is_err());
        assert!(auth.create_account("ada", "adaadaadaada").is_err());
        assert!(!auth.has_account().unwrap());
    }

    #[test]
    fn master_password_change_rotates_keys_and_keeps_items() {
        let mut auth = service();
        let mut unlocked = auth.create_account("ada", PASSWORD).unwrap();
        let item = unlocked.vault.add(login()).unwrap();
        auth.db
            .upsert_item(&unlocked.encrypt_item(&item).unwrap())
            .unwrap();
        let old_ciphertext = auth.db.load_items(&unlocked.vault.id).unwrap()[0]
            .ciphertext
            .clone();

        let new_password = "an-even-better-passphrase-99";
        let rotated = auth.change_master_password(PASSWORD, new_password).unwrap();
        assert_eq!(rotated.vault.items.len(), 1);
        let new_ciphertext = auth.db.load_items(&unlocked.vault.id).unwrap()[0]
            .ciphertext
            .clone();
        assert_ne!(old_ciphertext, new_ciphertext, "vault key must rotate");

        assert!(matches!(
            auth.unlock("ada", PASSWORD),
            Err(AcuyeError::AuthenticationFailed)
        ));
        let unlocked = auth.unlock("ada", new_password).unwrap();
        assert_eq!(unlocked.vault.items[0].title, "Example");
    }

    #[test]
    fn password_change_requires_current_password() {
        let mut auth = service();
        auth.create_account("ada", PASSWORD).unwrap();
        assert!(matches!(
            auth.change_master_password("wrong-password-here", "another-good-password-1"),
            Err(AcuyeError::AuthenticationFailed)
        ));
        assert!(auth.change_master_password(PASSWORD, PASSWORD).is_err());
    }

    #[test]
    fn tampered_item_ciphertext_blocks_unlock() {
        let auth = service();
        let mut unlocked = auth.create_account("ada", PASSWORD).unwrap();
        let item = unlocked.vault.add(login()).unwrap();
        let mut stored = unlocked.encrypt_item(&item).unwrap();
        stored.ciphertext[0] ^= 0xff;
        auth.db.upsert_item(&stored).unwrap();
        assert!(auth.unlock("ada", PASSWORD).is_err());
    }

    #[test]
    fn database_contains_no_plaintext_item_data() {
        let auth = service();
        let mut unlocked = auth.create_account("ada", PASSWORD).unwrap();
        let item = unlocked.vault.add(login()).unwrap();
        auth.db
            .upsert_item(&unlocked.encrypt_item(&item).unwrap())
            .unwrap();
        let row = &auth.db.load_items(&unlocked.vault.id).unwrap()[0];
        let haystack = String::from_utf8_lossy(&row.ciphertext).to_string();
        assert!(!haystack.contains("server-password-123"));
        assert!(!haystack.contains("Example"));
        assert!(!haystack.contains("ada@example.com"));
        let account = auth.db.load_account().unwrap().unwrap();
        assert!(!String::from_utf8_lossy(&account.verifier).contains(PASSWORD));
    }

    #[test]
    fn unlock_without_account_fails() {
        let auth = service();
        assert!(matches!(
            auth.unlock("ada", PASSWORD),
            Err(AcuyeError::AuthenticationFailed)
        ));
    }

    #[test]
    fn rename_vault_persists() {
        let mut auth = service();
        let unlocked = auth.create_account("ada", PASSWORD).unwrap();
        auth.rename_vault(&unlocked.vault_key, "Work").unwrap();
        assert_eq!(auth.account_summary().unwrap().unwrap().vault_name, "Work");
        assert!(auth.rename_vault(&unlocked.vault_key, "  ").is_err());
    }
}
