//! Versioned synchronization protocol (`acuye-sync/1`).
//!
//! The desktop client is local-first. This crate defines the wire contract for
//! a future Bring Your Own Backend sync engine: users point Acuye Pass at their
//! own HTTPS endpoint (a self-hosted service, a Cloudflare Worker with R2 or
//! Durable Objects, or their own database). No Fluxenite infrastructure is
//! required or assumed.
//!
//! Security invariants encoded in the types:
//! * only ciphertext travels over the wire (base64 encoded);
//! * every operation carries revisions so conflicts are detectable;
//! * the protocol string is mandatory and checked before anything else.
//!
//! See SYNC_PROTOCOL.md for the full specification.

use std::collections::HashMap;

use acuye_core::{AcuyeError, Result};
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: &str = "acuye-sync/1";
pub const MAX_OPERATIONS_PER_PUSH: usize = 500;
pub const MAX_CIPHERTEXT_B64_LEN: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    Upsert,
    Delete,
}

/// One encrypted mutation. There is intentionally no plaintext item field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncOperation {
    pub kind: OperationKind,
    pub item_id: String,
    /// New revision produced by the client (monotonic, >= 1).
    pub revision: u64,
    /// Revision the client based this change on (0 for a new item).
    pub base_revision: u64,
    pub nonce_b64: Option<String>,
    pub ciphertext_b64: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncPush {
    pub protocol: String,
    pub device_id: String,
    pub vault_id: String,
    pub operations: Vec<SyncOperation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncPull {
    pub protocol: String,
    pub device_id: String,
    pub vault_id: String,
    #[serde(default)]
    pub since_revision: u64,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Conflict {
    pub item_id: String,
    pub client_revision: u64,
    pub server_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncPullResponse {
    pub protocol: String,
    pub vault_id: String,
    pub current_revision: u64,
    pub operations: Vec<SyncOperation>,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncPushResponse {
    pub protocol: String,
    pub accepted_revision: u64,
    #[serde(default)]
    pub conflicts: Vec<Conflict>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceRegistration {
    pub protocol: String,
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    /// Public verification key (base64) for future per-device attestation.
    pub verification_key_b64: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceRevocation {
    pub protocol: String,
    pub device_id: String,
    pub revoked_device_id: String,
    pub reason: Option<String>,
}

fn valid_id(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 128 && !value.contains(char::is_whitespace)
}

fn check_protocol(protocol: &str) -> Result<()> {
    if protocol == PROTOCOL_VERSION {
        Ok(())
    } else {
        Err(AcuyeError::Unsupported(format!(
            "unsupported sync protocol {protocol}; this build speaks {PROTOCOL_VERSION}"
        )))
    }
}

fn validate_operation(op: &SyncOperation) -> Result<()> {
    if !valid_id(&op.item_id) {
        return Err(AcuyeError::Validation("invalid item id".into()));
    }
    if op.revision == 0 {
        return Err(AcuyeError::Validation("revision must be >= 1".into()));
    }
    if op.base_revision > op.revision {
        return Err(AcuyeError::Validation(
            "base revision cannot exceed revision".into(),
        ));
    }
    match op.kind {
        OperationKind::Upsert => {
            let nonce = op
                .nonce_b64
                .as_deref()
                .ok_or_else(|| AcuyeError::Validation("missing nonce".into()))?;
            let ciphertext = op
                .ciphertext_b64
                .as_deref()
                .ok_or_else(|| AcuyeError::Validation("missing ciphertext".into()))?;
            if nonce.len() != 32 {
                // 24 bytes, url-safe base64 without padding.
                return Err(AcuyeError::Validation("invalid nonce length".into()));
            }
            if ciphertext.is_empty() || ciphertext.len() > MAX_CIPHERTEXT_B64_LEN {
                return Err(AcuyeError::Validation("invalid ciphertext length".into()));
            }
            if ciphertext.contains(char::is_whitespace) {
                return Err(AcuyeError::Validation("invalid ciphertext encoding".into()));
            }
        }
        OperationKind::Delete => {
            if op.ciphertext_b64.is_some() || op.nonce_b64.is_some() {
                return Err(AcuyeError::Validation(
                    "delete operations must not carry ciphertext".into(),
                ));
            }
        }
    }
    Ok(())
}

pub fn validate_push(push: &SyncPush) -> Result<()> {
    check_protocol(&push.protocol)?;
    if !valid_id(&push.device_id) || !valid_id(&push.vault_id) {
        return Err(AcuyeError::Validation("invalid device or vault id".into()));
    }
    if push.operations.is_empty() {
        return Err(AcuyeError::Validation("no operations to push".into()));
    }
    if push.operations.len() > MAX_OPERATIONS_PER_PUSH {
        return Err(AcuyeError::Validation("too many operations".into()));
    }
    for op in &push.operations {
        validate_operation(op)?;
    }
    Ok(())
}

pub fn validate_pull(pull: &SyncPull) -> Result<()> {
    check_protocol(&pull.protocol)?;
    if !valid_id(&pull.device_id) || !valid_id(&pull.vault_id) {
        return Err(AcuyeError::Validation("invalid device or vault id".into()));
    }
    if pull.limit.map(|l| l == 0 || l > 1000).unwrap_or(false) {
        return Err(AcuyeError::Validation("invalid page size".into()));
    }
    Ok(())
}

pub fn validate_push_response(response: &SyncPushResponse) -> Result<()> {
    check_protocol(&response.protocol)?;
    for conflict in &response.conflicts {
        if !valid_id(&conflict.item_id) {
            return Err(AcuyeError::Validation("invalid conflict item id".into()));
        }
    }
    Ok(())
}

pub fn validate_pull_response(response: &SyncPullResponse) -> Result<()> {
    check_protocol(&response.protocol)?;
    for op in &response.operations {
        validate_operation(op)?;
    }
    Ok(())
}

pub fn validate_device_registration(reg: &DeviceRegistration) -> Result<()> {
    check_protocol(&reg.protocol)?;
    if !valid_id(&reg.device_id) {
        return Err(AcuyeError::Validation("invalid device id".into()));
    }
    if reg.device_name.trim().is_empty() || reg.device_name.len() > 120 {
        return Err(AcuyeError::Validation("invalid device name".into()));
    }
    Ok(())
}

pub fn validate_device_revocation(rev: &DeviceRevocation) -> Result<()> {
    check_protocol(&rev.protocol)?;
    if !valid_id(&rev.device_id) || !valid_id(&rev.revoked_device_id) {
        return Err(AcuyeError::Validation("invalid device id".into()));
    }
    if rev.device_id == rev.revoked_device_id {
        return Err(AcuyeError::Validation(
            "a device cannot revoke itself".into(),
        ));
    }
    Ok(())
}

/// Detect operations whose base revision no longer matches the server. The
/// policy is conservative: conflicts are surfaced to the user, never silently
/// overwritten.
pub fn detect_conflicts(
    operations: &[SyncOperation],
    server_revisions: &HashMap<String, u64>,
) -> Vec<Conflict> {
    let mut conflicts = Vec::new();
    for op in operations {
        if let Some(server) = server_revisions.get(&op.item_id) {
            if *server != op.base_revision && *server != 0 {
                conflicts.push(Conflict {
                    item_id: op.item_id.clone(),
                    client_revision: op.revision,
                    server_revision: *server,
                });
            }
        }
    }
    conflicts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn upsert() -> SyncOperation {
        SyncOperation {
            kind: OperationKind::Upsert,
            item_id: "item-1".into(),
            revision: 2,
            base_revision: 1,
            nonce_b64: Some("A".repeat(32)),
            ciphertext_b64: Some("abcDEF123".into()),
            updated_at: 42,
        }
    }

    fn sample_push() -> SyncPush {
        SyncPush {
            protocol: PROTOCOL_VERSION.into(),
            device_id: "device-1".into(),
            vault_id: "vault-1".into(),
            operations: vec![upsert()],
        }
    }

    #[test]
    fn valid_push_passes_and_roundtrips() {
        let push = sample_push();
        validate_push(&push).unwrap();
        let json = serde_json::to_string(&push).unwrap();
        let back: SyncPush = serde_json::from_str(&json).unwrap();
        assert_eq!(push, back);
    }

    #[test]
    fn version_mismatch_is_rejected() {
        let mut push = sample_push();
        push.protocol = "acuye-sync/99".into();
        assert!(matches!(
            validate_push(&push),
            Err(AcuyeError::Unsupported(_))
        ));
    }

    #[test]
    fn empty_or_oversized_operations_are_rejected() {
        let mut push = sample_push();
        push.operations.clear();
        assert!(validate_push(&push).is_err());

        let mut push = sample_push();
        push.operations = vec![upsert(); MAX_OPERATIONS_PER_PUSH + 1];
        assert!(validate_push(&push).is_err());
    }

    #[test]
    fn upsert_requires_ciphertext_and_nonce() {
        let mut op = upsert();
        op.ciphertext_b64 = None;
        let mut push = sample_push();
        push.operations = vec![op];
        assert!(validate_push(&push).is_err());

        let mut op = upsert();
        op.nonce_b64 = Some("short".into());
        let mut push = sample_push();
        push.operations = vec![op];
        assert!(validate_push(&push).is_err());
    }

    #[test]
    fn delete_must_not_carry_ciphertext() {
        let mut op = upsert();
        op.kind = OperationKind::Delete;
        let mut push = sample_push();
        push.operations = vec![op];
        assert!(validate_push(&push).is_err());

        let mut push = sample_push();
        push.operations = vec![SyncOperation {
            kind: OperationKind::Delete,
            item_id: "item-1".into(),
            revision: 3,
            base_revision: 2,
            nonce_b64: None,
            ciphertext_b64: None,
            updated_at: 1,
        }];
        validate_push(&push).unwrap();
    }

    #[test]
    fn revisions_are_validated() {
        let mut push = sample_push();
        push.operations[0].revision = 0;
        assert!(validate_push(&push).is_err());

        let mut push = sample_push();
        push.operations[0].base_revision = 9;
        assert!(validate_push(&push).is_err());
    }

    #[test]
    fn conflicts_are_detected_against_server_state() {
        let mut server = HashMap::new();
        server.insert("item-1".to_string(), 1u64);
        assert!(detect_conflicts(&[upsert()], &server).is_empty());

        server.insert("item-1".to_string(), 7u64);
        let conflicts = detect_conflicts(&[upsert()], &server);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].server_revision, 7);
    }

    #[test]
    fn pull_validation_and_response_roundtrip() {
        let pull = SyncPull {
            protocol: PROTOCOL_VERSION.into(),
            device_id: "device-1".into(),
            vault_id: "vault-1".into(),
            since_revision: 4,
            limit: Some(100),
        };
        validate_pull(&pull).unwrap();

        let response = SyncPullResponse {
            protocol: PROTOCOL_VERSION.into(),
            vault_id: "vault-1".into(),
            current_revision: 9,
            operations: vec![upsert()],
            has_more: false,
        };
        validate_pull_response(&response).unwrap();
        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("ciphertext_b64"));
        assert!(!json.contains("password"));
    }

    #[test]
    fn device_messages_are_validated() {
        let reg = DeviceRegistration {
            protocol: PROTOCOL_VERSION.into(),
            device_id: "device-2".into(),
            device_name: "Desktop".into(),
            platform: "windows".into(),
            verification_key_b64: None,
        };
        validate_device_registration(&reg).unwrap();

        let rev = DeviceRevocation {
            protocol: PROTOCOL_VERSION.into(),
            device_id: "device-1".into(),
            revoked_device_id: "device-2".into(),
            reason: Some("lost".into()),
        };
        validate_device_revocation(&rev).unwrap();

        let self_revoke = DeviceRevocation {
            revoked_device_id: "device-1".into(),
            ..rev
        };
        assert!(validate_device_revocation(&self_revoke).is_err());
    }
}
