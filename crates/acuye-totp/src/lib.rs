//! Time-based one-time passwords (RFC 6238) and `otpauth://` setup URIs.
//!
//! Everything here is local: a TOTP secret never leaves the process, and the
//! generated codes are derived from the clock alone. Secrets are handled as
//! `String`s owned by the caller (vault items are encrypted at rest by
//! `acuye-vault`), and temporary secret buffers are zeroized after use.

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

use acuye_core::{AcuyeError, Result};

/// Default RFC 6238 time step, in seconds.
pub const DEFAULT_PERIOD: u32 = 30;
/// Default number of digits in a generated code.
pub const DEFAULT_DIGITS: u32 = 6;
/// Shortest accepted period. Providers use 30 or 60 seconds.
pub const MIN_PERIOD: u32 = 15;
/// Longest accepted period (some legacy providers use 5 minutes).
pub const MAX_PERIOD: u32 = 300;
/// Accepted digit counts: 6 is universal, 7 and 8 appear in the wild.
pub const MIN_DIGITS: u32 = 6;
pub const MAX_DIGITS: u32 = 8;
/// A secret shorter than 80 bits is brute-forceable from a single code.
pub const MIN_SECRET_BYTES: usize = 10;
/// How many neighbouring steps a verification accepts, to tolerate clock skew.
pub const VERIFY_SKEW_STEPS: i64 = 1;

/// Hash used by the provider. SHA-1 is what almost every service uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TotpAlgorithm {
    #[default]
    Sha1,
    Sha256,
    Sha512,
}

impl TotpAlgorithm {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sha1 => "SHA1",
            Self::Sha256 => "SHA256",
            Self::Sha512 => "SHA512",
        }
    }

    pub fn parse(value: &str) -> Result<Self> {
        match value.trim().to_ascii_uppercase().replace('-', "").as_str() {
            "" | "SHA1" => Ok(Self::Sha1),
            "SHA256" => Ok(Self::Sha256),
            "SHA512" => Ok(Self::Sha512),
            _ => Err(AcuyeError::Validation(
                "Unsupported TOTP algorithm (use SHA1, SHA256 or SHA512)".into(),
            )),
        }
    }
}

/// A stored authenticator entry.
///
/// `secret` is the RFC 4648 base32 shared secret exactly as the provider
/// displayed it (normalised to uppercase without padding).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TotpConfig {
    pub secret: String,
    #[serde(default)]
    pub issuer: String,
    #[serde(default)]
    pub account: String,
    #[serde(default)]
    pub algorithm: TotpAlgorithm,
    #[serde(default = "default_digits")]
    pub digits: u32,
    #[serde(default = "default_period")]
    pub period: u32,
}

fn default_digits() -> u32 {
    DEFAULT_DIGITS
}

fn default_period() -> u32 {
    DEFAULT_PERIOD
}

impl TotpConfig {
    /// Validate the shape of a configuration before it is stored.
    pub fn validate(&self) -> Result<()> {
        let bytes = decode_base32(&self.secret)?;
        if bytes.len() < MIN_SECRET_BYTES {
            return Err(AcuyeError::Validation(
                "The authenticator secret is too short".into(),
            ));
        }
        if !(MIN_DIGITS..=MAX_DIGITS).contains(&self.digits) {
            return Err(AcuyeError::Validation(format!(
                "TOTP digits must be between {MIN_DIGITS} and {MAX_DIGITS}"
            )));
        }
        if !(MIN_PERIOD..=MAX_PERIOD).contains(&self.period) {
            return Err(AcuyeError::Validation(format!(
                "TOTP period must be between {MIN_PERIOD} and {MAX_PERIOD} seconds"
            )));
        }
        if self.issuer.chars().count() > 128 || self.account.chars().count() > 256 {
            return Err(AcuyeError::Validation(
                "Issuer or account name is too long".into(),
            ));
        }
        Ok(())
    }

    /// Normalise the secret so equal secrets compare and dedupe correctly.
    pub fn normalize(&mut self) {
        self.secret = self
            .secret
            .trim()
            .to_ascii_uppercase()
            .replace([' ', '-'], "");
        self.issuer = self.issuer.trim().to_string();
        self.account = self.account.trim().to_string();
    }

    /// The six-digit (or configured length) code for a UNIX timestamp.
    pub fn code_at(&self, unix_time: u64) -> Result<String> {
        self.validate()?;
        let mut secret = decode_base32(&self.secret)?;
        let code = hotp(
            &secret,
            unix_time / u64::from(self.period),
            self.digits,
            self.algorithm,
        );
        secret.zeroize();
        code
    }

    /// Whole seconds until the current code rolls over.
    pub fn remaining_secs(&self, unix_time: u64) -> u32 {
        let period = u64::from(self.period.max(1));
        let elapsed = unix_time % period;
        // A code that expires this very second still counts as one second left.
        (period - elapsed) as u32
    }

    /// Number of steps already used in the current window (0.0 ..= 1.0 ratio is
    /// derived by the UI from `remaining_secs` and `period`).
    pub fn step(&self, unix_time: u64) -> u64 {
        unix_time / u64::from(self.period.max(1))
    }

    /// Constant-time-ish comparison against a user supplied code, accepting one
    /// step of clock skew in either direction.
    pub fn verify(&self, candidate: &str, unix_time: u64) -> Result<bool> {
        with_window(self, unix_time, |config, t| config.code_at(t))
            .map(|codes| codes.iter().any(|code| code == candidate))
    }

    /// `otpauth://totp/...` URI for QR export.
    pub fn to_uri(&self) -> String {
        let label = if self.issuer.is_empty() {
            url_encode(&self.account)
        } else if self.account.is_empty() {
            url_encode(&self.issuer)
        } else {
            format!("{}:{}", url_encode(&self.issuer), url_encode(&self.account))
        };
        let mut uri = format!(
            "otpauth://totp/{label}?secret={}&digits={}&period={}",
            url_encode(&self.secret),
            self.digits,
            self.period
        );
        if !self.issuer.is_empty() {
            uri.push_str(&format!("&issuer={}", url_encode(&self.issuer)));
        }
        if self.algorithm != TotpAlgorithm::Sha1 {
            uri.push_str(&format!("&algorithm={}", self.algorithm.as_str()));
        }
        uri
    }

    /// Parse an `otpauth://totp/...` URI (what a setup QR code contains).
    pub fn parse_uri(uri: &str) -> Result<Self> {
        let trimmed = uri.trim();
        let rest = trimmed
            .strip_prefix("otpauth://totp/")
            .or_else(|| trimmed.strip_prefix("OTPAUTH://TOTP/"))
            .ok_or_else(|| {
                AcuyeError::Validation("That is not an otpauth://totp/ setup URI".into())
            })?;
        let (label, query) = match rest.split_once('?') {
            Some((label, query)) => (label, query),
            None => (rest, ""),
        };
        let mut config = TotpConfig {
            secret: String::new(),
            issuer: String::new(),
            account: String::new(),
            algorithm: TotpAlgorithm::Sha1,
            digits: DEFAULT_DIGITS,
            period: DEFAULT_PERIOD,
        };
        let decoded_label = url_decode(label);
        match decoded_label.split_once(':') {
            Some((issuer, account)) => {
                config.issuer = issuer.trim().to_string();
                config.account = account.trim().to_string();
            }
            None => config.account = decoded_label.trim().to_string(),
        }
        let mut saw_secret = false;
        for pair in query.split('&') {
            let (key, value) = match pair.split_once('=') {
                Some(kv) => kv,
                None => continue,
            };
            let value = url_decode(value);
            match key.to_ascii_lowercase().as_str() {
                "secret" => {
                    saw_secret = true;
                    config.secret = value;
                }
                "issuer" => {
                    if config.issuer.is_empty() {
                        config.issuer = value.trim().to_string();
                    }
                }
                "algorithm" => config.algorithm = TotpAlgorithm::parse(&value)?,
                "digits" => {
                    config.digits = value.trim().parse().map_err(|_| {
                        AcuyeError::Validation("Invalid digit count in the setup URI".into())
                    })?
                }
                "period" => {
                    config.period = value.trim().parse().map_err(|_| {
                        AcuyeError::Validation("Invalid period in the setup URI".into())
                    })?
                }
                _ => {}
            }
        }
        if !saw_secret {
            return Err(AcuyeError::Validation("The setup URI has no secret".into()));
        }
        config.normalize();
        config.validate()?;
        Ok(config)
    }
}

/// Codes for the current step and its two neighbours, oldest first.
fn with_window<F>(config: &TotpConfig, unix_time: u64, mut code: F) -> Result<Vec<String>>
where
    F: FnMut(&TotpConfig, u64) -> Result<String>,
{
    let step_secs = u64::from(config.period.max(1));
    let mut codes = Vec::with_capacity(3);
    for offset in -VERIFY_SKEW_STEPS..=VERIFY_SKEW_STEPS {
        let shifted = unix_time as i128 + offset as i128 * step_secs as i128;
        if shifted < 0 {
            continue;
        }
        codes.push(code(config, shifted as u64)?);
    }
    Ok(codes)
}

fn hotp(secret: &[u8], counter: u64, digits: u32, algorithm: TotpAlgorithm) -> Result<String> {
    let counter = counter.to_be_bytes();
    let invalid = || AcuyeError::Validation("The authenticator secret is invalid".into());
    // Keep the real digest length: RFC 6238 truncates from *its* last byte.
    let mut mac: Vec<u8> = match algorithm {
        TotpAlgorithm::Sha1 => {
            let mut hmac = Hmac::<sha1::Sha1>::new_from_slice(secret).map_err(|_| invalid())?;
            hmac.update(&counter);
            hmac.finalize().into_bytes().to_vec()
        }
        TotpAlgorithm::Sha256 => {
            let mut hmac = Hmac::<sha2::Sha256>::new_from_slice(secret).map_err(|_| invalid())?;
            hmac.update(&counter);
            hmac.finalize().into_bytes().to_vec()
        }
        TotpAlgorithm::Sha512 => {
            let mut hmac = Hmac::<sha2::Sha512>::new_from_slice(secret).map_err(|_| invalid())?;
            hmac.update(&counter);
            hmac.finalize().into_bytes().to_vec()
        }
    };
    let offset = usize::from(mac[mac.len() - 1] & 0x0f);
    let slice = &mac[offset..offset + 4];
    let binary = (u32::from(slice[0]) & 0x7f) << 24
        | u32::from(slice[1]) << 16
        | u32::from(slice[2]) << 8
        | u32::from(slice[3]);
    let value = binary % 10u32.pow(digits);
    mac.zeroize();
    Ok(format!("{value:0width$}", width = digits as usize))
}

/// Decode RFC 4648 base32, tolerating lowercase, spaces, dashes and missing
/// padding — providers format secrets inconsistently in their setup pages.
pub fn decode_base32(input: &str) -> Result<Vec<u8>> {
    let cleaned: String = input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '=')
        .collect();
    if cleaned.is_empty() {
        return Err(AcuyeError::Validation(
            "The authenticator secret is empty".into(),
        ));
    }
    let mut out = Vec::with_capacity(cleaned.len() * 5 / 8);
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;
    for ch in cleaned.chars() {
        let value = match ch.to_ascii_uppercase() {
            c @ 'A'..='Z' => c as u32 - 'A' as u32,
            c @ '2'..='7' => c as u32 - '2' as u32 + 26,
            _ => {
                return Err(AcuyeError::Validation(
                    "The authenticator secret is not valid base32".into(),
                ))
            }
        };
        buffer = (buffer << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

/// Encode bytes as unpadded RFC 4648 base32 (what providers expect in URIs).
pub fn encode_base32(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut out = String::with_capacity((bytes.len() * 8).div_ceil(5));
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;
    for byte in bytes {
        buffer = (buffer << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(ALPHABET[((buffer >> bits) & 0x1f) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(ALPHABET[((buffer << (5 - bits)) & 0x1f) as usize] as char);
    }
    out
}

fn url_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn url_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rfc_secret_base32() -> String {
        // "12345678901234567890" from RFC 6238 appendix B.
        encode_base32(b"12345678901234567890")
    }

    #[test]
    fn base32_matches_rfc4648_vectors() {
        assert_eq!(encode_base32(b"f"), "MY");
        assert_eq!(encode_base32(b"fo"), "MZXQ");
        assert_eq!(encode_base32(b"foo"), "MZXW6");
        assert_eq!(encode_base32(b"foob"), "MZXW6YQ");
        assert_eq!(encode_base32(b"fooba"), "MZXW6YTB");
        assert_eq!(encode_base32(b"foobar"), "MZXW6YTBOI");
        assert_eq!(decode_base32("MZXW6YTBOI").unwrap(), b"foobar");
        // Tolerant of lowercase, spaces, dashes and padding.
        assert_eq!(decode_base32("mzxw 6ytb-oi====").unwrap(), b"foobar");
        assert!(decode_base32("not base32!").is_err());
    }

    #[test]
    fn sha1_matches_rfc6238_vectors() {
        let config = TotpConfig {
            secret: rfc_secret_base32(),
            issuer: "Acuye".into(),
            account: "ada@example.com".into(),
            algorithm: TotpAlgorithm::Sha1,
            digits: 8,
            period: 30,
        };
        for (time, expected) in [
            (59u64, "94287082"),
            (1_111_111_109, "07081804"),
            (1_111_111_111, "14050471"),
            (1_234_567_890, "89005924"),
            (2_000_000_000, "69279037"),
            (20_000_000_000, "65353130"),
        ] {
            assert_eq!(config.code_at(time).unwrap(), expected, "T={time}");
        }
    }

    #[test]
    fn sha256_and_sha512_match_rfc6238_vectors() {
        // RFC 6238 appendix B uses a different seed per hash: 32 bytes for
        // SHA-256 and 64 bytes for SHA-512.
        let sha256 = TotpConfig {
            secret: encode_base32(b"12345678901234567890123456789012"),
            issuer: String::new(),
            account: String::new(),
            algorithm: TotpAlgorithm::Sha256,
            digits: 8,
            period: 30,
        };
        assert_eq!(sha256.code_at(59).unwrap(), "46119246");
        assert_eq!(sha256.code_at(20_000_000_000).unwrap(), "77737706");

        let sha512 = TotpConfig {
            secret: encode_base32(
                b"1234567890123456789012345678901234567890123456789012345678901234",
            ),
            algorithm: TotpAlgorithm::Sha512,
            ..sha256
        };
        assert_eq!(sha512.code_at(59).unwrap(), "90693936");
        assert_eq!(sha512.code_at(20_000_000_000).unwrap(), "47863826");
    }

    #[test]
    fn six_digit_codes_are_the_rfc_vectors_truncated() {
        let config = TotpConfig {
            secret: rfc_secret_base32(),
            issuer: String::new(),
            account: String::new(),
            algorithm: TotpAlgorithm::Sha1,
            digits: 6,
            period: 30,
        };
        assert_eq!(config.code_at(59).unwrap(), "287082");
    }

    #[test]
    fn sixty_second_period_is_supported() {
        let config = TotpConfig {
            secret: rfc_secret_base32(),
            issuer: String::new(),
            account: String::new(),
            algorithm: TotpAlgorithm::Sha1,
            digits: 6,
            period: 60,
        };
        // A 60s window opens at multiples of 60, so 30s and 59s share a code.
        assert_eq!(config.code_at(30).unwrap(), config.code_at(59).unwrap());
        assert_ne!(config.code_at(59).unwrap(), config.code_at(61).unwrap());
        assert_eq!(config.remaining_secs(60), 60);
        assert_eq!(config.remaining_secs(119), 1);
    }

    #[test]
    fn verification_accepts_one_step_of_skew() {
        let config = TotpConfig {
            secret: rfc_secret_base32(),
            issuer: String::new(),
            account: String::new(),
            algorithm: TotpAlgorithm::Sha1,
            digits: 6,
            period: 30,
        };
        let now = 1_111_111_111u64;
        let current = config.code_at(now).unwrap();
        let previous = config.code_at(now - 30).unwrap();
        let next = config.code_at(now + 30).unwrap();
        assert!(config.verify(&current, now).unwrap());
        assert!(config.verify(&previous, now).unwrap());
        assert!(config.verify(&next, now).unwrap());
        assert!(!config
            .verify(&config.code_at(now + 300).unwrap(), now)
            .unwrap());
        assert!(!config.verify("000000", now).unwrap() || current == "000000");
    }

    #[test]
    fn uri_roundtrip_preserves_settings() {
        let uri = "otpauth://totp/GitHub:ada%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DP&issuer=GitHub&algorithm=SHA256&digits=7&period=60";
        let config = TotpConfig::parse_uri(uri).unwrap();
        assert_eq!(config.issuer, "GitHub");
        assert_eq!(config.account, "ada@example.com");
        assert_eq!(config.digits, 7);
        assert_eq!(config.period, 60);
        assert_eq!(config.algorithm, TotpAlgorithm::Sha256);
        let again = TotpConfig::parse_uri(&config.to_uri()).unwrap();
        assert_eq!(again, config);
    }

    #[test]
    fn uri_without_secret_or_wrong_scheme_is_rejected() {
        assert!(TotpConfig::parse_uri("otpauth://totp/a?issuer=x").is_err());
        assert!(TotpConfig::parse_uri("https://example.com").is_err());
        assert!(TotpConfig::parse_uri("otpauth://hotp/a?secret=JBSWY3DPEHPK3PXP").is_err());
    }

    #[test]
    fn short_secrets_and_bad_parameters_are_rejected() {
        let mut config = TotpConfig {
            secret: "JBSWY3DP".into(),
            issuer: String::new(),
            account: String::new(),
            algorithm: TotpAlgorithm::Sha1,
            digits: 6,
            period: 30,
        };
        assert!(
            config.validate().is_err(),
            "8 base32 chars is below 80 bits"
        );
        config.secret = rfc_secret_base32();
        config.digits = 9;
        assert!(config.validate().is_err());
        config.digits = 6;
        config.period = 5;
        assert!(config.validate().is_err());
    }

    #[test]
    fn normalize_strips_formatting() {
        let mut config = TotpConfig {
            secret: " jbsw y3dp-ehpk3pxp ".into(),
            issuer: "  GitHub ".into(),
            account: " ada ".into(),
            algorithm: TotpAlgorithm::Sha1,
            digits: 6,
            period: 30,
        };
        config.normalize();
        assert_eq!(config.secret, "JBSWY3DPEHPK3PXP");
        assert_eq!(config.issuer, "GitHub");
        assert_eq!(config.account, "ada");
    }
}
