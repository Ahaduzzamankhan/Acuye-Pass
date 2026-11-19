//! Synchronization engine scaffolding for the future Bring Your Own Backend
//! (BYOB) phase.
//!
//! This crate contains no network client and no hosted service. It provides:
//! * a transport trait a BYOB adapter implements (self-hosted server, Worker,
//!   R2, Durable Objects, plain database);
//! * a revision-aware engine that pushes and pulls encrypted envelopes;
//! * conflict surfacing instead of silent overwrites.
//!
//! The desktop build deliberately does not enable syncing: the settings UI can
//! store a provider endpoint, but nothing is transmitted until a transport is
//! implemented and the user enables it.

use acuye_core::{AcuyeError, Result};
use acuye_crypto::{b64_decode, b64_encode, Sealed};
use acuye_protocol::{
    detect_conflicts, validate_pull, validate_pull_response, validate_push, validate_push_response,
    Conflict, OperationKind, SyncOperation, SyncPull, SyncPullResponse, SyncPush, SyncPushResponse,
    PROTOCOL_VERSION,
};

/// Transport implemented by a user-supplied backend adapter.
pub trait SyncTransport {
    fn push(&mut self, push: &SyncPush) -> Result<SyncPushResponse>;
    fn pull(&mut self, pull: &SyncPull) -> Result<SyncPullResponse>;
}

/// Outcome of one synchronization round.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SyncOutcome {
    pub pushed: usize,
    pub pulled: usize,
    pub conflicts: Vec<Conflict>,
    pub revision: u64,
}

/// An item ready to be queued for sync. Only ciphertext can be constructed,
/// which makes accidental plaintext upload a type error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutgoingItem {
    pub item_id: String,
    pub sealed: Sealed,
    pub updated_at: i64,
    /// Last revision known for this item (0 if new).
    pub base_revision: u64,
}

pub struct SyncEngine<T: SyncTransport> {
    transport: T,
    device_id: String,
    vault_id: String,
    local_revision: u64,
}

impl<T: SyncTransport> SyncEngine<T> {
    pub fn new(transport: T, device_id: impl Into<String>, vault_id: impl Into<String>) -> Self {
        Self {
            transport,
            device_id: device_id.into(),
            vault_id: vault_id.into(),
            local_revision: 0,
        }
    }

    pub fn local_revision(&self) -> u64 {
        self.local_revision
    }

    pub fn transport(&self) -> &T {
        &self.transport
    }

    /// Push encrypted items and report conflicts. The local revision advances
    /// only after the server accepts the batch.
    pub fn push(&mut self, items: Vec<OutgoingItem>) -> Result<SyncOutcome> {
        if items.is_empty() {
            return Ok(SyncOutcome::default());
        }
        let mut operations = Vec::with_capacity(items.len());
        let base_revision = self.local_revision;
        for (offset, item) in items.into_iter().enumerate() {
            operations.push(SyncOperation {
                kind: OperationKind::Upsert,
                item_id: item.item_id,
                revision: base_revision + offset as u64 + 1,
                base_revision: item.base_revision,
                nonce_b64: Some(b64_encode(&item.sealed.nonce)),
                ciphertext_b64: Some(b64_encode(&item.sealed.ciphertext)),
                updated_at: item.updated_at,
            });
        }
        let push = SyncPush {
            protocol: PROTOCOL_VERSION.into(),
            device_id: self.device_id.clone(),
            vault_id: self.vault_id.clone(),
            operations,
        };
        validate_push(&push)?;
        let response = self.transport.push(&push)?;
        validate_push_response(&response)?;

        if response.conflicts.is_empty() {
            self.local_revision = response.accepted_revision.max(self.local_revision);
            Ok(SyncOutcome {
                pushed: push.operations.len(),
                pulled: 0,
                conflicts: Vec::new(),
                revision: self.local_revision,
            })
        } else {
            Ok(SyncOutcome {
                pushed: 0,
                pulled: 0,
                conflicts: response.conflicts,
                revision: self.local_revision,
            })
        }
    }

    /// Pull operations newer than the local revision and return them decoded
    /// for the caller to apply through the normal vault decrypt path.
    pub fn pull(&mut self) -> Result<(SyncOutcome, Vec<(String, Sealed)>)> {
        let pull = SyncPull {
            protocol: PROTOCOL_VERSION.into(),
            device_id: self.device_id.clone(),
            vault_id: self.vault_id.clone(),
            since_revision: self.local_revision,
            limit: Some(250),
        };
        validate_pull(&pull)?;
        let response = self.transport.pull(&pull)?;
        validate_pull_response(&response)?;

        let mut applied = Vec::new();
        let mut revision = self.local_revision;
        for op in &response.operations {
            if op.kind != OperationKind::Upsert {
                continue;
            }
            let (Some(nonce), Some(ciphertext)) = (&op.nonce_b64, &op.ciphertext_b64) else {
                continue;
            };
            let sealed = Sealed {
                nonce: b64_decode(nonce)?,
                ciphertext: b64_decode(ciphertext)?,
            };
            applied.push((op.item_id.clone(), sealed));
            revision = revision.max(op.revision);
        }
        self.local_revision = revision.max(response.current_revision);

        Ok((
            SyncOutcome {
                pushed: 0,
                pulled: applied.len(),
                conflicts: Vec::new(),
                revision: self.local_revision,
            },
            applied,
        ))
    }

    /// Compute conflicts for a local batch against a server revision map
    /// without transmitting anything (used by the future sync settings screen).
    pub fn preview_conflicts(
        items: &[OutgoingItem],
        server_revisions: &std::collections::HashMap<String, u64>,
    ) -> Vec<Conflict> {
        let operations: Vec<SyncOperation> = items
            .iter()
            .enumerate()
            .map(|(index, item)| SyncOperation {
                kind: OperationKind::Upsert,
                item_id: item.item_id.clone(),
                revision: index as u64 + 1,
                base_revision: item.base_revision,
                nonce_b64: Some(b64_encode(&item.sealed.nonce)),
                ciphertext_b64: Some(b64_encode(&item.sealed.ciphertext)),
                updated_at: item.updated_at,
            })
            .collect();
        detect_conflicts(&operations, server_revisions)
    }
}

/// Guard used before any sync attempt: encryption and a configured provider
/// are mandatory.
pub fn ensure_sync_ready(provider_enabled: bool, item_count: usize) -> Result<()> {
    if !provider_enabled {
        return Err(AcuyeError::Unsupported(
            "no sync provider is configured".into(),
        ));
    }
    if item_count == 0 {
        return Ok(());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MockTransport {
        pushed: Vec<SyncPush>,
        to_pull: Vec<SyncOperation>,
        reject_unknown: bool,
        conflicts: Vec<Conflict>,
    }

    impl SyncTransport for MockTransport {
        fn push(&mut self, push: &SyncPush) -> Result<SyncPushResponse> {
            self.pushed.push(push.clone());
            if self.reject_unknown {
                return Err(AcuyeError::AuthenticationFailed);
            }
            Ok(SyncPushResponse {
                protocol: PROTOCOL_VERSION.into(),
                accepted_revision: push.operations.last().map(|o| o.revision).unwrap_or(0),
                conflicts: self.conflicts.clone(),
            })
        }

        fn pull(&mut self, _pull: &SyncPull) -> Result<SyncPullResponse> {
            Ok(SyncPullResponse {
                protocol: PROTOCOL_VERSION.into(),
                vault_id: "vault-1".into(),
                current_revision: self.to_pull.iter().map(|o| o.revision).max().unwrap_or(0),
                operations: self.to_pull.clone(),
                has_more: false,
            })
        }
    }

    fn outgoing(id: &str, base: u64) -> OutgoingItem {
        OutgoingItem {
            item_id: id.into(),
            sealed: Sealed {
                nonce: vec![1u8; 24],
                ciphertext: vec![2u8; 32],
            },
            updated_at: 10,
            base_revision: base,
        }
    }

    #[test]
    fn push_sends_only_ciphertext_and_advances_revision() {
        let mut engine = SyncEngine::new(MockTransport::default(), "device-1", "vault-1");
        let outcome = engine
            .push(vec![outgoing("a", 0), outgoing("b", 0)])
            .unwrap();
        assert_eq!(outcome.pushed, 2);
        assert_eq!(engine.local_revision(), 2);
        let sent = &engine.transport().pushed[0];
        assert_eq!(sent.protocol, PROTOCOL_VERSION);
        assert!(sent.operations[0].ciphertext_b64.is_some());
    }

    #[test]
    fn empty_push_is_a_noop() {
        let mut engine = SyncEngine::new(MockTransport::default(), "device-1", "vault-1");
        let outcome = engine.push(vec![]).unwrap();
        assert_eq!(outcome, SyncOutcome::default());
    }

    #[test]
    fn conflicts_are_surfaced_and_revision_does_not_advance() {
        let transport = MockTransport {
            conflicts: vec![Conflict {
                item_id: "a".into(),
                client_revision: 1,
                server_revision: 5,
            }],
            ..Default::default()
        };
        let mut engine = SyncEngine::new(transport, "device-1", "vault-1");
        let outcome = engine.push(vec![outgoing("a", 1)]).unwrap();
        assert_eq!(outcome.pushed, 0);
        assert_eq!(outcome.conflicts.len(), 1);
        assert_eq!(engine.local_revision(), 0);
    }

    #[test]
    fn transport_errors_propagate() {
        let transport = MockTransport {
            reject_unknown: true,
            ..Default::default()
        };
        let mut engine = SyncEngine::new(transport, "device-1", "vault-1");
        assert!(engine.push(vec![outgoing("a", 0)]).is_err());
    }

    #[test]
    fn pull_decodes_ciphertext() {
        let transport = MockTransport {
            to_pull: vec![SyncOperation {
                kind: OperationKind::Upsert,
                item_id: "x".into(),
                revision: 3,
                base_revision: 0,
                nonce_b64: Some(b64_encode(&[3u8; 24])),
                ciphertext_b64: Some(b64_encode(&[4u8; 16])),
                updated_at: 1,
            }],
            ..Default::default()
        };
        let mut engine = SyncEngine::new(transport, "device-1", "vault-1");
        let (outcome, items) = engine.pull().unwrap();
        assert_eq!(outcome.pulled, 1);
        assert_eq!(items[0].0, "x");
        assert_eq!(items[0].1.nonce, vec![3u8; 24]);
        assert_eq!(engine.local_revision(), 3);
    }

    #[test]
    fn preview_conflicts_matches_server_revisions() {
        let mut server = HashMap::new();
        server.insert("a".to_string(), 4u64);
        let conflicts = SyncEngine::<MockTransport>::preview_conflicts(
            &[outgoing("a", 1), outgoing("b", 0)],
            &server,
        );
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].item_id, "a");
    }

    #[test]
    fn sync_requires_a_provider() {
        assert!(ensure_sync_ready(false, 3).is_err());
        assert!(ensure_sync_ready(true, 0).is_ok());
    }
}
