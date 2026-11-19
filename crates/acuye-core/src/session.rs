use serde::{Deserialize, Serialize};

use crate::time::{now, Timestamp};

/// An unlocked local session. Holds no key material: the key lives in the
/// backend state only, so this struct is safe to serialize to the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    pub username: String,
    pub vault_id: String,
    pub unlocked_at: Timestamp,
    pub last_activity: Timestamp,
    /// Idle timeout in seconds. `0` disables automatic locking.
    pub idle_timeout_secs: u64,
}

impl Session {
    pub fn new(
        username: impl Into<String>,
        vault_id: impl Into<String>,
        idle_timeout_secs: u64,
    ) -> Self {
        let ts = now();
        Self {
            username: username.into(),
            vault_id: vault_id.into(),
            unlocked_at: ts,
            last_activity: ts,
            idle_timeout_secs,
        }
    }

    pub fn touch(&mut self) {
        self.last_activity = now();
    }

    pub fn is_expired_at(&self, at: Timestamp) -> bool {
        if self.idle_timeout_secs == 0 {
            return false;
        }
        at.saturating_sub(self.last_activity) >= self.idle_timeout_secs as i64
    }

    pub fn is_expired(&self) -> bool {
        self.is_expired_at(now())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_disabled_never_expires() {
        let mut s = Session::new("ada", "vault", 0);
        s.last_activity = 0;
        assert!(!s.is_expired_at(9_999_999_999));
    }

    #[test]
    fn idle_timeout_expires() {
        let mut s = Session::new("ada", "vault", 300);
        s.last_activity = 1_000;
        assert!(!s.is_expired_at(1_299));
        assert!(s.is_expired_at(1_300));
    }
}
