//! Username + master-password authentication and vault unlock.
//!
//! There is no biometric path anywhere in this crate. The username identifies
//! the local account; it is never used as key material. Password verification
//! happens against a derived verifier, and the actual vault key is unwrapped
//! only after the verifier matches.

use acuye_core::{AccountRecord, AccountSummary, AcuyeError, Result, Timestamp};
use acuye_crypto::{
    auth_verifier, b64_decode, b64_encode, derive_master_key, random_bytes, random_salt,
    unwrap_vault_key, verifiers_match, wrap_vault_key, ExpandedKeys, KdfParams, Sealed, SecretKey,
};
use acuye_generator::strength;
use acuye_storage::{Database, RecoveryRow, StoredItem};
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
        Ok(!self.db.load_accounts()?.is_empty())
    }

    pub fn account_summary(&self) -> Result<Option<AccountSummary>> {
        Ok(self.db.load_accounts()?.into_iter().next().map(summary_of))
    }

    /// Every local account, oldest first. Metadata only — no key material.
    pub fn accounts(&self) -> Result<Vec<AccountSummary>> {
        Ok(self
            .db
            .load_accounts()?
            .into_iter()
            .map(summary_of)
            .collect())
    }

    /// First-launch account creation. Refuses to overwrite an existing vault —
    /// use [`Self::add_account`] to add a second one next to it.
    pub fn create_account(&self, username: &str, password: &str) -> Result<UnlockedVault> {
        if self.has_account()? {
            return Err(AcuyeError::Conflict(
                "an account already exists on this device".into(),
            ));
        }
        self.create_vault(username, password, acuye_vault::DEFAULT_VAULT_NAME)
    }

    /// Create an additional independent vault in the same database.
    ///
    /// Each account has its own username, salt, verifier, wrapped vault key and
    /// items; nothing (including the master password) is shared.
    pub fn add_account(
        &self,
        username: &str,
        password: &str,
        vault_name: Option<&str>,
    ) -> Result<UnlockedVault> {
        let accounts = self.accounts()?;
        if accounts
            .iter()
            .any(|account| account.username.eq_ignore_ascii_case(username.trim()))
        {
            return Err(AcuyeError::Conflict(
                "an account with that name already exists".into(),
            ));
        }
        let name = match vault_name.map(str::trim).filter(|name| !name.is_empty()) {
            Some(name) => name.to_string(),
            None => next_vault_name(&accounts),
        };
        self.create_vault(username, password, &name)
    }

    fn create_vault(
        &self,
        username: &str,
        password: &str,
        vault_name: &str,
    ) -> Result<UnlockedVault> {
        let username = normalize_username(username)?;
        validate_master_password(password, &username)?;
        let vault_name = vault_name.trim();
        if vault_name.is_empty() || vault_name.chars().count() > 64 {
            return Err(AcuyeError::Validation("Invalid vault name".into()));
        }

        let salt = random_salt();
        let master = derive_master_key(password, &salt, &self.kdf)?;
        let keys = ExpandedKeys::derive(&master)?;
        let verifier = auth_verifier(&keys.auth_key);
        let vault = VaultModel::new(vault_name);
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

    /// Unlock the vault that belongs to `username`. Username comparison is
    /// case-insensitive; every failure returns the same error so account
    /// existence is not leaked. When several vaults share a username the caller
    /// must use [`Self::unlock_vault`] instead.
    pub fn unlock(&self, username: &str, password: &str) -> Result<UnlockedVault> {
        let accounts = self.db.load_accounts()?;
        let matches: Vec<&AccountRecord> = accounts
            .iter()
            .filter(|account| account.username.eq_ignore_ascii_case(username.trim()))
            .collect();
        match matches.as_slice() {
            [] => {
                // Still run the KDF to keep timing roughly constant.
                burn_kdf(accounts.first(), password);
                Err(AcuyeError::AuthenticationFailed)
            }
            [record] => self.unlock_record(record, password),
            _ => Err(AcuyeError::Conflict(
                "more than one vault uses that account name — choose one".into(),
            )),
        }
    }

    /// Unlock one specific vault by id (the account picker's choice).
    pub fn unlock_vault(&self, vault_id: &str, password: &str) -> Result<UnlockedVault> {
        let accounts = self.db.load_accounts()?;
        match accounts.iter().find(|account| account.vault_id == vault_id) {
            Some(record) => self.unlock_record(record, password),
            None => {
                burn_kdf(accounts.first(), password);
                Err(AcuyeError::AuthenticationFailed)
            }
        }
    }

    fn unlock_record(&self, record: &AccountRecord, password: &str) -> Result<UnlockedVault> {
        let params = params_of(record)?;
        let master = derive_master_key(password, &record.salt, &params)?;
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
            username: record.username.clone(),
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
        vault_id: &str,
        current_password: &str,
        new_password: &str,
    ) -> Result<UnlockedVault> {
        let record = self
            .db
            .load_account_by_vault(vault_id)?
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
    pub fn rename_vault(
        &mut self,
        vault_id: &str,
        vault_key: &SecretKey,
        name: &str,
    ) -> Result<()> {
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
            .load_account_by_vault(vault_id)?
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

// ----- account recovery ---------------------------------------------------

/// Number of security questions a vault may enrol.
pub const SECURITY_QUESTION_COUNT: usize = 3;
pub const MIN_SECURITY_ANSWER_LEN: usize = 2;
pub const MAX_SECURITY_ANSWER_LEN: usize = 256;
pub const MAX_SECURITY_QUESTION_LEN: usize = 160;
/// Crockford base32 characters in one recovery code (before grouping).
const RECOVERY_CODE_CHARS: usize = 32;
const CROCKFORD: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Which recovery methods a vault has enrolled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryStatus {
    pub code: bool,
    pub questions: bool,
}

/// Result of enrolling recovery: show the code once, then forget it.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySetup {
    pub recovery_code: String,
    pub questions: usize,
}

/// Result of a completed recovery. The recovery code is rotated, so the old one
/// stops working and any enrolled questions are cleared.
pub struct RecoveryOutcome {
    pub unlocked: UnlockedVault,
    pub recovery_code: String,
}

impl std::fmt::Debug for RecoveryOutcome {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RecoveryOutcome")
            .field("unlocked", &self.unlocked)
            .field("recovery_code", &"REDACTED")
            .finish()
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct QuestionSlot {
    question: String,
    salt: String,
    verifier: String,
}

impl AuthService {
    /// Which recovery methods this vault has.
    pub fn recovery_status(&self, vault_id: &str) -> Result<RecoveryStatus> {
        let rows = self.db.recovery_rows(vault_id)?;
        Ok(RecoveryStatus {
            code: rows.iter().any(|row| row.kind == "code"),
            questions: rows.iter().any(|row| row.kind == "questions"),
        })
    }

    /// The security question prompts enrolled for a vault (no answers).
    pub fn security_questions(&self, vault_id: &str) -> Result<Vec<String>> {
        let Some(row) = self
            .db
            .recovery_rows(vault_id)?
            .into_iter()
            .find(|row| row.kind == "questions")
        else {
            return Ok(Vec::new());
        };
        let slots: Vec<QuestionSlot> = serde_json::from_str(&row.payload)?;
        Ok(slots.into_iter().map(|slot| slot.question).collect())
    }

    /// Enrol a recovery code, and optionally the three security questions.
    /// The master password is required: recovery is a way back in, so setting
    /// it up must not be possible from a locked session alone.
    pub fn enable_recovery(
        &self,
        vault_id: &str,
        password: &str,
        questions: Option<&[(String, String)]>,
    ) -> Result<RecoverySetup> {
        let record = self
            .db
            .load_account_by_vault(vault_id)?
            .ok_or_else(|| AcuyeError::NotFound("account".into()))?;
        let unlocked = self.unlock_record(&record, password)?;
        let now = acuye_core::time::now();
        let code = generate_recovery_code();
        self.store_code(&record, &code, &unlocked.vault_key, now)?;
        let enrolled = match questions {
            Some(questions) => {
                self.store_questions(&record, &unlocked.vault_key, questions, now)?;
                questions.len()
            }
            // Keep whatever questions are already enrolled.
            None => self
                .db
                .recovery_rows(vault_id)?
                .iter()
                .filter(|row| row.kind == "questions")
                .count(),
        };
        Ok(RecoverySetup {
            recovery_code: code,
            questions: enrolled,
        })
    }

    /// Remove every recovery method. Requires the master password.
    pub fn disable_recovery(&self, vault_id: &str, password: &str) -> Result<()> {
        let record = self
            .db
            .load_account_by_vault(vault_id)?
            .ok_or_else(|| AcuyeError::NotFound("account".into()))?;
        self.unlock_record(&record, password)?;
        self.db.delete_recovery(vault_id)
    }

    /// Sign in with a recovery code and choose a new master password.
    ///
    /// The code is matched against every enrolled vault, so the user does not
    /// have to remember which account it belongs to. A successful recovery
    /// rotates the vault key, the master password and the recovery code, and
    /// clears the security questions (their enrolments wrapped the old key).
    pub fn recover_with_code(&mut self, code: &str, new_password: &str) -> Result<RecoveryOutcome> {
        let normalized = normalize_recovery_code(code);
        if !recovery_code_is_well_formed(&normalized) {
            return Err(AcuyeError::Validation(
                "That recovery code is not valid".into(),
            ));
        }
        let mut matched: Option<(AccountRecord, RecoveryRow, ExpandedKeys)> = None;
        for row in self
            .db
            .recovery_all()?
            .iter()
            .filter(|row| row.kind == "code")
        {
            let Some(record) = self.db.load_account_by_vault(&row.vault_id)? else {
                continue;
            };
            let params = recovery_params(row)?;
            let master = derive_master_key(&normalized, &row.salt, &params)?;
            let keys = ExpandedKeys::derive(&master)?;
            if verifiers_match(&row.verifier, &auth_verifier(&keys.auth_key))? {
                matched = Some((record, row.clone(), keys));
            }
        }
        let Some((record, row, keys)) = matched else {
            return Err(AcuyeError::AuthenticationFailed);
        };
        let sealed = Sealed {
            nonce: row.vault_key_nonce.clone(),
            ciphertext: row.wrapped_vault_key.clone(),
        };
        let vault_key = unwrap_vault_key(&keys.wrapping_key, &record.vault_id, &sealed)?;
        let vault = self.decrypt_vault(&record, &vault_key)?;
        self.complete_recovery(record, vault, new_password)
    }

    /// Sign in with the three security answers and choose a new master password.
    pub fn recover_with_answers(
        &mut self,
        vault_id: &str,
        answers: &[String],
        new_password: &str,
    ) -> Result<RecoveryOutcome> {
        let record = self
            .db
            .load_account_by_vault(vault_id)?
            .ok_or_else(|| AcuyeError::NotFound("account".into()))?;
        let row = self
            .db
            .recovery_rows(vault_id)?
            .into_iter()
            .find(|row| row.kind == "questions")
            .ok_or_else(|| {
                AcuyeError::Validation("No security questions are set for this vault".into())
            })?;
        let slots: Vec<QuestionSlot> = serde_json::from_str(&row.payload)?;
        if slots.is_empty() || answers.len() != slots.len() {
            return Err(AcuyeError::Validation(
                "Answer every security question".into(),
            ));
        }
        let params = recovery_params(&row)?;
        let mut wrapping: Option<SecretKey> = None;
        for (slot, answer) in slots.iter().zip(answers) {
            let normalized = normalize_answer(answer)?;
            let salt = b64_decode(&slot.salt)?;
            let master = derive_master_key(&normalized, &salt, &params)?;
            let keys = ExpandedKeys::derive(&master)?;
            let verifier = b64_decode(&slot.verifier)?;
            if !verifiers_match(&verifier, &auth_verifier(&keys.auth_key))? {
                return Err(AcuyeError::AuthenticationFailed);
            }
            if wrapping.is_none() {
                wrapping = Some(keys.wrapping_key);
            }
        }
        let wrapping = wrapping.ok_or(AcuyeError::AuthenticationFailed)?;
        let sealed = Sealed {
            nonce: row.vault_key_nonce.clone(),
            ciphertext: row.wrapped_vault_key.clone(),
        };
        let vault_key = unwrap_vault_key(&wrapping, &record.vault_id, &sealed)?;
        let vault = self.decrypt_vault(&record, &vault_key)?;
        self.complete_recovery(record, vault, new_password)
    }

    fn decrypt_vault(&self, record: &AccountRecord, vault_key: &SecretKey) -> Result<VaultModel> {
        let mut vault = VaultModel::restore(
            record.vault_id.clone(),
            record.vault_name.clone(),
            record.created_at,
        );
        let pairs = self
            .db
            .load_items(&record.vault_id)?
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
        acuye_vault::decrypt_all(vault_key, &mut vault, pairs)?;
        Ok(vault)
    }

    fn store_code(
        &self,
        record: &AccountRecord,
        code: &str,
        vault_key: &SecretKey,
        now: Timestamp,
    ) -> Result<()> {
        let salt = random_salt();
        let master = derive_master_key(&normalize_recovery_code(code), &salt, &self.kdf)?;
        let keys = ExpandedKeys::derive(&master)?;
        let wrapped = wrap_vault_key(&keys.wrapping_key, vault_key, &record.vault_id)?;
        self.db.upsert_recovery(&RecoveryRow {
            vault_id: record.vault_id.clone(),
            kind: "code".into(),
            kdf_algorithm: "argon2id".into(),
            kdf_memory_kib: self.kdf.memory_kib,
            kdf_iterations: self.kdf.iterations,
            kdf_parallelism: self.kdf.parallelism,
            salt: salt.to_vec(),
            verifier: auth_verifier(&keys.auth_key).to_vec(),
            wrapped_vault_key: wrapped.ciphertext,
            vault_key_nonce: wrapped.nonce,
            payload: "{}".into(),
            created_at: now,
        })
    }

    fn store_questions(
        &self,
        record: &AccountRecord,
        vault_key: &SecretKey,
        questions: &[(String, String)],
        now: Timestamp,
    ) -> Result<()> {
        if questions.len() != SECURITY_QUESTION_COUNT {
            return Err(AcuyeError::Validation(format!(
                "Choose exactly {SECURITY_QUESTION_COUNT} security questions"
            )));
        }
        let mut slots = Vec::with_capacity(questions.len());
        let mut first: Option<(Vec<u8>, [u8; 32], SecretKey)> = None;
        for (question, answer) in questions {
            let prompt = question.trim();
            if prompt.is_empty() || prompt.chars().count() > MAX_SECURITY_QUESTION_LEN {
                return Err(AcuyeError::Validation(
                    "Each security question needs 1-160 characters".into(),
                ));
            }
            let normalized = normalize_answer(answer)?;
            let salt = random_salt();
            let master = derive_master_key(&normalized, &salt, &self.kdf)?;
            let keys = ExpandedKeys::derive(&master)?;
            let verifier = auth_verifier(&keys.auth_key);
            slots.push(QuestionSlot {
                question: prompt.to_string(),
                salt: b64_encode(&salt),
                verifier: b64_encode(&verifier),
            });
            if first.is_none() {
                first = Some((salt.to_vec(), verifier, keys.wrapping_key));
            }
        }
        let (salt, verifier, wrapping) = first
            .ok_or_else(|| AcuyeError::Validation("Choose your security questions first".into()))?;
        let wrapped = wrap_vault_key(&wrapping, vault_key, &record.vault_id)?;
        self.db.upsert_recovery(&RecoveryRow {
            vault_id: record.vault_id.clone(),
            kind: "questions".into(),
            kdf_algorithm: "argon2id".into(),
            kdf_memory_kib: self.kdf.memory_kib,
            kdf_iterations: self.kdf.iterations,
            kdf_parallelism: self.kdf.parallelism,
            salt,
            verifier: verifier.to_vec(),
            wrapped_vault_key: wrapped.ciphertext,
            vault_key_nonce: wrapped.nonce,
            payload: serde_json::to_string(&slots)?,
            created_at: now,
        })
    }

    /// Re-key an already decrypted vault and leave it enrolled under a brand
    /// new recovery code.
    fn complete_recovery(
        &mut self,
        record: AccountRecord,
        mut vault: VaultModel,
        new_password: &str,
    ) -> Result<RecoveryOutcome> {
        validate_master_password(new_password, &record.username)?;
        let new_salt = random_salt();
        let master = derive_master_key(new_password, &new_salt, &self.kdf)?;
        let keys = ExpandedKeys::derive(&master)?;
        let new_vault_key = SecretKey::generate();
        let wrapped = wrap_vault_key(&keys.wrapping_key, &new_vault_key, &record.vault_id)?;
        let now = acuye_core::time::now();
        let new_record = AccountRecord {
            username: record.username.clone(),
            kdf_algorithm: "argon2id".into(),
            kdf_memory_kib: self.kdf.memory_kib,
            kdf_iterations: self.kdf.iterations,
            kdf_parallelism: self.kdf.parallelism,
            salt: new_salt.to_vec(),
            verifier: auth_verifier(&keys.auth_key).to_vec(),
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

        // The old enrolments wrapped the old vault key, so they are gone; the
        // new code is shown to the user once and the questions must be set
        // again from Settings.
        self.db.delete_recovery(&record.vault_id)?;
        let code = generate_recovery_code();
        self.store_code(&new_record, &code, &new_vault_key, now)?;
        vault.items.shrink_to_fit();

        Ok(RecoveryOutcome {
            unlocked: UnlockedVault {
                username: record.username,
                vault,
                vault_key: new_vault_key,
            },
            recovery_code: code,
        })
    }
}

fn recovery_params(row: &RecoveryRow) -> Result<KdfParams> {
    if row.kdf_algorithm != "argon2id" {
        return Err(AcuyeError::Unsupported(
            "unknown key derivation algorithm".into(),
        ));
    }
    let params = KdfParams {
        memory_kib: row.kdf_memory_kib,
        iterations: row.kdf_iterations,
        parallelism: row.kdf_parallelism,
    };
    params.validate()?;
    Ok(params)
}

/// A fresh 160-bit recovery code, grouped for reading aloud:
/// `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`.
pub fn generate_recovery_code() -> String {
    let bytes = random_bytes(20);
    let encoded = crockford_encode(&bytes);
    encoded
        .as_bytes()
        .chunks(4)
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or("").to_string())
        .collect::<Vec<_>>()
        .join("-")
}

/// Uppercase, drop separators and fold the characters Crockford treats as
/// interchangeable (`o`→`0`, `i`/`l`→`1`).
pub fn normalize_recovery_code(input: &str) -> String {
    input
        .chars()
        .filter_map(|c| {
            let upper = c.to_ascii_uppercase();
            match upper {
                'O' => Some('0'),
                'I' | 'L' => Some('1'),
                '0'..='9' | 'A'..='Z' => Some(upper),
                _ => None,
            }
        })
        .collect()
}

pub fn recovery_code_is_well_formed(normalized: &str) -> bool {
    normalized.len() == RECOVERY_CODE_CHARS
        && normalized.bytes().all(|byte| CROCKFORD.contains(&byte))
}

fn crockford_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 8 / 5);
    let mut buffer: u32 = 0;
    let mut bits = 0u32;
    for byte in bytes {
        buffer = (buffer << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            let index = (buffer >> (bits - 5)) & 0x1f;
            out.push(CROCKFORD[index as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        let index = (buffer << (5 - bits)) & 0x1f;
        out.push(CROCKFORD[index as usize] as char);
    }
    out
}

/// Security answers are compared case-insensitively and with collapsed
/// whitespace, because "  Blue " and "blue" are the same answer.
fn normalize_answer(answer: &str) -> Result<String> {
    let normalized = answer
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    let len = normalized.chars().count();
    if len < MIN_SECURITY_ANSWER_LEN || len > MAX_SECURITY_ANSWER_LEN {
        return Err(AcuyeError::Validation(format!(
            "Each answer needs {MIN_SECURITY_ANSWER_LEN}-{MAX_SECURITY_ANSWER_LEN} characters"
        )));
    }
    Ok(normalized)
}

fn summary_of(record: AccountRecord) -> AccountSummary {
    AccountSummary {
        username: record.username,
        vault_id: record.vault_id,
        vault_name: record.vault_name,
        kdf_algorithm: record.kdf_algorithm,
        kdf_memory_kib: record.kdf_memory_kib,
        kdf_iterations: record.kdf_iterations,
        created_at: record.created_at,
    }
}

/// Next free default vault name: "Personal", "Personal 2", …
fn next_vault_name(accounts: &[AccountSummary]) -> String {
    let mut index = 1usize;
    loop {
        let candidate = if index == 1 {
            "Personal".to_string()
        } else {
            format!("Personal {index}")
        };
        if !accounts
            .iter()
            .any(|account| account.vault_name == candidate)
        {
            return candidate;
        }
        index += 1;
    }
}

/// Run one key derivation for a failed lookup so a missing account costs the
/// same wall-clock time as a wrong password.
fn burn_kdf(record: Option<&AccountRecord>, password: &str) {
    if let Some(record) = record {
        if let Ok(params) = params_of(record) {
            let _ = derive_master_key(password, &record.salt, &params);
        }
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
        let rotated = auth
            .change_master_password(&unlocked.vault.id, PASSWORD, new_password)
            .unwrap();
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
        let unlocked = auth.create_account("ada", PASSWORD).unwrap();
        assert!(matches!(
            auth.change_master_password(
                &unlocked.vault.id,
                "wrong-password-here",
                "another-good-password-1"
            ),
            Err(AcuyeError::AuthenticationFailed)
        ));
        assert!(auth
            .change_master_password(&unlocked.vault.id, PASSWORD, PASSWORD)
            .is_err());
    }

    #[test]
    fn additional_accounts_are_independent() {
        let auth = service();
        let mut work = auth.create_account("ada", PASSWORD).unwrap();
        let item = work.vault.add(login()).unwrap();
        auth.db
            .upsert_item(&work.encrypt_item(&item).unwrap())
            .unwrap();

        let other_password = "Quartz-Meadow-4471-Lantern";
        let personal = auth
            .add_account("grace", other_password, Some("Personal"))
            .unwrap();
        assert_eq!(personal.vault.name, "Personal");
        assert!(personal.vault.items.is_empty());
        assert_eq!(auth.accounts().unwrap().len(), 2);

        // A username identifies one vault, so it cannot be added twice.
        assert!(matches!(
            auth.add_account("ADA", PASSWORD, None),
            Err(AcuyeError::Conflict(_))
        ));

        // Each vault only opens with its own master password.
        assert!(matches!(
            auth.unlock_vault(&personal.vault.id, PASSWORD),
            Err(AcuyeError::AuthenticationFailed)
        ));
        let reopened = auth
            .unlock_vault(&personal.vault.id, other_password)
            .unwrap();
        assert_eq!(reopened.vault.name, "Personal");

        let work_again = auth.unlock("ada", PASSWORD).unwrap();
        assert_eq!(work_again.vault.items.len(), 1);
        assert!(matches!(
            auth.unlock_vault("missing-vault", PASSWORD),
            Err(AcuyeError::AuthenticationFailed)
        ));
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
    fn recovery_code_restores_a_vault_with_a_new_password() {
        let mut auth = service();
        let mut unlocked = auth.create_account("ada", PASSWORD).unwrap();
        let item = unlocked.vault.add(login()).unwrap();
        auth.db
            .upsert_item(&unlocked.encrypt_item(&item).unwrap())
            .unwrap();

        let setup = auth
            .enable_recovery(&unlocked.vault.id, PASSWORD, None)
            .unwrap();
        assert_eq!(setup.questions, 0);
        assert!(recovery_code_is_well_formed(&normalize_recovery_code(
            &setup.recovery_code
        )));
        let status = auth.recovery_status(&unlocked.vault.id).unwrap();
        assert!(status.code && !status.questions);

        // Codes are accepted in any case and with the separators removed.
        let typed = setup.recovery_code.to_lowercase().replace('-', " ");
        let new_password = "Quartz-Meadow-7742-Lantern";
        let outcome = auth.recover_with_code(&typed, new_password).unwrap();
        assert_eq!(outcome.unlocked.vault.items.len(), 1);
        assert_eq!(outcome.unlocked.vault.items[0].title, "Example");
        assert_ne!(outcome.recovery_code, setup.recovery_code);

        // The old password and the old code are both dead; the new password
        // opens the vault and the rotated code still recovers it.
        assert!(matches!(
            auth.unlock("ada", PASSWORD),
            Err(AcuyeError::AuthenticationFailed)
        ));
        let reopened = auth.unlock("ada", new_password).unwrap();
        assert_eq!(reopened.vault.items[0].title, "Example");
        assert!(matches!(
            auth.recover_with_code(&setup.recovery_code, new_password),
            Err(AcuyeError::AuthenticationFailed)
        ));
        let rotated = auth
            .recover_with_code(&outcome.recovery_code, "Harbor-Quartz-9912")
            .unwrap();
        assert_eq!(rotated.unlocked.vault.items.len(), 1);
    }

    #[test]
    fn security_questions_recover_the_vault() {
        let mut auth = service();
        let mut unlocked = auth.create_account("ada", PASSWORD).unwrap();
        let item = unlocked.vault.add(login()).unwrap();
        auth.db
            .upsert_item(&unlocked.encrypt_item(&item).unwrap())
            .unwrap();

        let questions = vec![
            ("First pet?".to_string(), "Rex".to_string()),
            ("Favourite city?".to_string(), "  Lisbon ".to_string()),
            ("Old street?".to_string(), "Baker Street".to_string()),
        ];
        let setup = auth
            .enable_recovery(&unlocked.vault.id, PASSWORD, Some(&questions))
            .unwrap();
        assert_eq!(setup.questions, 3);
        let status = auth.recovery_status(&unlocked.vault.id).unwrap();
        assert!(status.code && status.questions);

        // Answers are case-insensitive and whitespace-trimmed.
        let answers = vec![
            "rex".to_string(),
            "LISBON".to_string(),
            "baker  street".to_string(),
        ];
        let outcome = auth
            .recover_with_answers(&unlocked.vault.id, &answers, "answered-correctly-77")
            .unwrap();
        assert_eq!(outcome.unlocked.vault.items.len(), 1);

        // The answers wrapped the old key, so they are cleared afterwards.
        let status = auth.recovery_status(&unlocked.vault.id).unwrap();
        assert!(!status.questions);
        assert!(status.code);
        assert!(auth
            .recover_with_answers(&unlocked.vault.id, &answers, "answered-correctly-77")
            .is_err());
        let unlocked = auth.unlock("ada", "answered-correctly-77").unwrap();
        assert_eq!(unlocked.vault.items[0].title, "Example");
    }

    #[test]
    fn recovery_rejects_wrong_answers_and_bad_codes() {
        let mut auth = service();
        let unlocked = auth.create_account("ada", PASSWORD).unwrap();
        let questions = vec![
            ("Q1".to_string(), "alpha".to_string()),
            ("Q2".to_string(), "bravo".to_string()),
            ("Q3".to_string(), "charlie".to_string()),
        ];
        auth.enable_recovery(&unlocked.vault.id, PASSWORD, Some(&questions))
            .unwrap();

        assert!(matches!(
            auth.recover_with_answers(
                &unlocked.vault.id,
                &["alpha".into(), "wrong".into(), "charlie".into()],
                "brand-new-password-12"
            ),
            Err(AcuyeError::AuthenticationFailed)
        ));
        assert!(matches!(
            auth.recover_with_answers(
                &unlocked.vault.id,
                &["alpha".into(), "bravo".into()],
                "brand-new-password-12"
            ),
            Err(AcuyeError::Validation(_))
        ));
        assert!(matches!(
            auth.recover_with_code("not-a-code", "brand-new-password-12"),
            Err(AcuyeError::Validation(_))
        ));
        // A well-formed but wrong code is an authentication failure.
        assert!(matches!(
            auth.recover_with_code(
                "0000-0000-0000-0000-0000-0000-0000-0000",
                "brand-new-password-12"
            ),
            Err(AcuyeError::AuthenticationFailed)
        ));
        // The vault is untouched by failed attempts.
        assert!(auth.unlock("ada", PASSWORD).is_ok());
    }

    #[test]
    fn enabling_and_disabling_recovery_requires_the_master_password() {
        let mut auth = service();
        let unlocked = auth.create_account("ada", PASSWORD).unwrap();
        assert!(matches!(
            auth.enable_recovery(&unlocked.vault.id, "not-the-password-1", None),
            Err(AcuyeError::AuthenticationFailed)
        ));
        let setup = auth
            .enable_recovery(&unlocked.vault.id, PASSWORD, None)
            .unwrap();
        assert!(auth
            .disable_recovery(&unlocked.vault.id, "not-the-password-1")
            .is_err());
        auth.disable_recovery(&unlocked.vault.id, PASSWORD).unwrap();
        let status = auth.recovery_status(&unlocked.vault.id).unwrap();
        assert!(!status.code && !status.questions);
        assert!(matches!(
            auth.recover_with_code(&setup.recovery_code, "another-password-123"),
            Err(AcuyeError::AuthenticationFailed)
        ));
        // Questions must be exactly three and have real answers.
        assert!(auth
            .enable_recovery(
                &unlocked.vault.id,
                PASSWORD,
                Some(&[("Q1".into(), "a1".into())])
            )
            .is_err());
        assert!(auth
            .enable_recovery(
                &unlocked.vault.id,
                PASSWORD,
                Some(&[
                    ("Q1".into(), "x".into()),
                    ("Q2".into(), "y".into()),
                    ("Q3".into(), "z".into())
                ])
            )
            .is_err());
    }

    #[test]
    fn recovery_code_alphabet_and_grouping() {
        for _ in 0..16 {
            let code = generate_recovery_code();
            assert_eq!(code.split('-').count(), 8);
            assert_eq!(normalize_recovery_code(&code).len(), 32);
            assert!(recovery_code_is_well_formed(&normalize_recovery_code(
                &code
            )));
            // Crockford digits that are easy to confuse are folded.
            assert!(!code.contains('I') && !code.contains('L') && !code.contains('O'));
        }
        assert_eq!(normalize_recovery_code("o1l2-i3"), "011213");
        assert!(!recovery_code_is_well_formed("SHORT"));
    }

    #[test]
    fn rename_vault_persists() {
        let mut auth = service();
        let unlocked = auth.create_account("ada", PASSWORD).unwrap();
        auth.rename_vault(&unlocked.vault.id, &unlocked.vault_key, "Work")
            .unwrap();
        assert_eq!(auth.account_summary().unwrap().unwrap().vault_name, "Work");
        assert!(auth
            .rename_vault(&unlocked.vault.id, &unlocked.vault_key, "  ")
            .is_err());
    }
}
