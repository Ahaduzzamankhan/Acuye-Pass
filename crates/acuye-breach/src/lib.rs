//! Password breach monitoring through the Pwned Passwords range API.
//!
//! Privacy model (k-anonymity):
//! * the password is hashed with SHA-1 **inside this process**;
//! * only the first five hexadecimal characters of that hash are sent;
//! * the response holds every hash suffix sharing that prefix, and the match is
//!   performed locally.
//!
//! The full hash, the password and any derived secret never leave the process,
//! and nothing here logs a password or a hash.

use serde::Serialize;
use sha1::{Digest, Sha1};
use zeroize::Zeroize;

use acuye_core::{AcuyeError, Result};

/// Official Pwned Passwords range endpoint (no API key, no account).
pub const RANGE_ENDPOINT: &str = "https://api.pwnedpasswords.com/range/";
/// Only the prefix is ever transmitted; the suffix stays local.
pub const PREFIX_LEN: usize = 5;
const HTTP_TIMEOUT_SECS: u64 = 15;
const MAX_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;

/// Outcome of a check. `Unavailable` is deliberately distinct from `Clean`:
/// an offline or failing lookup must never be reported as "not breached".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum BreachStatus {
    /// The password does not appear in any known breach.
    Clean,
    /// The password appears `count` times across known breaches.
    Breached { count: u64 },
    /// The check could not be completed; the password was not verified.
    Unavailable { reason: String },
}

impl BreachStatus {
    pub fn is_breached(&self) -> bool {
        matches!(self, Self::Breached { .. })
    }

    pub fn is_conclusive(&self) -> bool {
        !matches!(self, Self::Unavailable { .. })
    }
}

/// Transport used to fetch a hash prefix range. Implemented over HTTP for the
/// app and with a fake in tests.
pub trait RangeTransport {
    fn range(&self, prefix: &str) -> Result<String>;
}

/// HTTPS transport to the official range API.
pub struct HttpTransport {
    agent: ureq::Agent,
}

impl HttpTransport {
    pub fn new() -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
            .redirects(0)
            .user_agent("AcuyePass/0.1 (breach-check)")
            .build();
        Self { agent }
    }
}

impl Default for HttpTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl RangeTransport for HttpTransport {
    fn range(&self, prefix: &str) -> Result<String> {
        if prefix.len() != PREFIX_LEN || !prefix.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(AcuyeError::Validation("Invalid breach-check prefix".into()));
        }
        let url = format!("{RANGE_ENDPOINT}{prefix}");
        let response = self
            .agent
            .get(&url)
            .call()
            .map_err(|_| AcuyeError::Network("The breach service is unreachable".into()))?;
        if response.status() != 200 {
            return Err(AcuyeError::Network(format!(
                "The breach service answered with status {}",
                response.status()
            )));
        }
        use std::io::Read;
        let mut body = String::new();
        response
            .into_reader()
            .take(MAX_RESPONSE_BYTES)
            .read_to_string(&mut body)
            .map_err(|_| AcuyeError::Network("The breach response could not be read".into()))?;
        Ok(body)
    }
}

/// Uppercase SHA-1 of the password bytes, as used by Pwned Passwords.
pub fn sha1_hex(password: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(password.as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{b:02X}")).collect()
}

/// Split a hash into the transmitted prefix and the locally kept suffix.
fn split_hash(hash: &str) -> (String, String) {
    let upper = hash.to_ascii_uppercase();
    (
        upper[..PREFIX_LEN].to_string(),
        upper[PREFIX_LEN..].to_string(),
    )
}

/// Look up one hash suffix in a range response.
///
/// The API answers with `SUFFIX:COUNT` lines (case-insensitive, `\r\n`
/// separated) and pads the list with counts of `0` for traffic analysis
/// resistance — padded entries must never be reported as breaches.
pub fn parse_range(body: &str, suffix: &str) -> Option<u64> {
    let wanted = suffix.trim().to_ascii_uppercase();
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let (candidate, count) = match line.split_once(':') {
            Some(parts) => parts,
            None => continue,
        };
        if candidate.trim().to_ascii_uppercase() != wanted {
            continue;
        }
        let count: u64 = count.trim().parse().unwrap_or(0);
        return (count > 0).then_some(count);
    }
    None
}

/// Check a password. Only a five-character hash prefix leaves the process.
pub fn check_password(password: &str, transport: &dyn RangeTransport) -> BreachStatus {
    if password.is_empty() {
        return BreachStatus::Unavailable {
            reason: "There is no password to check".into(),
        };
    }
    let mut hash = sha1_hex(password);
    let (prefix, suffix) = split_hash(&hash);
    hash.zeroize();
    match transport.range(&prefix) {
        Ok(body) => match parse_range(&body, &suffix) {
            Some(count) => BreachStatus::Breached { count },
            None => BreachStatus::Clean,
        },
        Err(err) => BreachStatus::Unavailable {
            reason: match err {
                AcuyeError::Network(message) => message,
                _ => "The breach service could not be queried".into(),
            },
        },
    }
}

/// Check against the official service.
pub fn check_password_online(password: &str) -> BreachStatus {
    check_password(password, &HttpTransport::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct FakeTransport {
        body: String,
        seen: RefCell<Vec<String>>,
        fail: bool,
    }

    impl FakeTransport {
        fn ok(body: &str) -> Self {
            Self {
                body: body.to_string(),
                seen: RefCell::new(Vec::new()),
                fail: false,
            }
        }

        fn failing() -> Self {
            Self {
                body: String::new(),
                seen: RefCell::new(Vec::new()),
                fail: true,
            }
        }
    }

    impl RangeTransport for FakeTransport {
        fn range(&self, prefix: &str) -> Result<String> {
            self.seen.borrow_mut().push(prefix.to_string());
            if self.fail {
                return Err(AcuyeError::Network("offline".into()));
            }
            Ok(self.body.clone())
        }
    }

    #[test]
    fn sha1_matches_the_published_vector() {
        assert_eq!(
            sha1_hex("password"),
            "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8"
        );
    }

    #[test]
    fn only_the_five_character_prefix_is_transmitted() {
        let suffix = &sha1_hex("password")[PREFIX_LEN..];
        let transport = FakeTransport::ok(&format!(
            "{suffix}:42\r\n0000000000000000000000000000000000A:3"
        ));
        let status = check_password("password", &transport);
        assert_eq!(status, BreachStatus::Breached { count: 42 });
        let seen = transport.seen.borrow();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0], "5BAA6");
        assert_eq!(seen[0].len(), PREFIX_LEN);
    }

    #[test]
    fn absent_suffix_is_clean_and_padding_is_not_a_breach() {
        let suffix = &sha1_hex("password")[PREFIX_LEN..];
        let transport = FakeTransport::ok(&format!(
            "0000000000000000000000000000000000A:0\r\n{suffix}:0\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:9"
        ));
        assert_eq!(check_password("password", &transport), BreachStatus::Clean);
    }

    #[test]
    fn unavailable_is_distinct_from_clean() {
        let status = check_password("password", &FakeTransport::failing());
        assert!(matches!(status, BreachStatus::Unavailable { .. }));
        assert!(!status.is_conclusive());
        assert!(!status.is_breached());
    }

    #[test]
    fn range_parsing_tolerates_case_and_formatting() {
        let body = "  abcdef0123456789abcdef0123456789abc: 7 \r\nother:1";
        assert_eq!(
            parse_range(body, "ABCDEF0123456789ABCDEF0123456789ABC"),
            Some(7)
        );
        assert_eq!(
            parse_range(body, "abcdef0123456789abcdef0123456789abc"),
            Some(7)
        );
        assert_eq!(parse_range(body, "doesnotexist"), None);
        assert_eq!(parse_range("garbage-without-colon", "AB"), None);
    }

    #[test]
    fn empty_password_is_never_queried() {
        let transport = FakeTransport::ok("whatever");
        assert!(matches!(
            check_password("", &transport),
            BreachStatus::Unavailable { .. }
        ));
        assert!(transport.seen.borrow().is_empty());
    }
}
