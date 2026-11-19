use serde::{Deserialize, Serialize};

use crate::time::Timestamp;

/// Persisted account material. Contains no plaintext password: only a salt,
/// KDF parameters, an authentication verifier derived from the master key and
/// the vault key wrapped under the master key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountRecord {
    pub username: String,
    pub kdf_algorithm: String,
    pub kdf_memory_kib: u32,
    pub kdf_iterations: u32,
    pub kdf_parallelism: u32,
    pub salt: Vec<u8>,
    pub verifier: Vec<u8>,
    pub wrapped_vault_key: Vec<u8>,
    pub vault_key_nonce: Vec<u8>,
    pub vault_id: String,
    pub vault_name: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// Non-secret account information for the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountSummary {
    pub username: String,
    pub vault_id: String,
    pub vault_name: String,
    pub kdf_algorithm: String,
    pub kdf_memory_kib: u32,
    pub kdf_iterations: u32,
    pub created_at: Timestamp,
}
