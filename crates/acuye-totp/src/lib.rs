//! Authenticator engine: RFC 6238 TOTP and RFC 4226 HOTP.
//!
//! The engine owns everything an authenticator needs — entry metadata (name,
//! issuer, account), the shared secret, algorithm, digit count, time interval
//! and code type — and computes codes locally from the clock or a counter.
//! Nothing here touches the network or the webview: secrets never leave the
//! process, and temporary buffers are zeroized.

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
/// How many neighbouring steps a TOTP verification accepts.
pub const VERIFY_SKEW_STEPS: i64 = 1;
/// How many counter values an HOTP verification looks ahead (RFC 4226 §7.4).
pub const HOTP_LOOKAHEAD: u64 = 10;

/// Code type. TOTP derives the counter from the clock, HOTP from a stored one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum OtpType {
    #[default]
    Totp,
    Hotp,
}

impl OtpType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Totp => "totp",
            Self::Hotp => "hotp",
        }
    }

    pub fn parse(value: &str) -> Result<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "" | "totp" | "time" | "time_based" => Ok(Self::Totp),
            "hotp" | "counter" | "counter_based" => Ok(Self::Hotp),
            _ => Err(AcuyeError::Validation(
                "Unsupported code type (use TOTP or HOTP)".into(),
            )),
        }
    }
}

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

/// One authenticator entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OtpConfig {
    /// RFC 4648 base32 shared secret, normalised to uppercase without padding.
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
    #[serde(default)]
    pub otp_type: OtpType,
    #[serde(default)]
    pub counter: u64,
}

fn default_digits() -> u32 {
    DEFAULT_DIGITS
}

fn default_period() -> u32 {
    DEFAULT_PERIOD
}

impl Default for OtpConfig {
    fn default() -> Self {
        Self {
            secret: String::new(),
            issuer: String::new(),
            account: String::new(),
            algorithm: TotpAlgorithm::Sha1,
            digits: DEFAULT_DIGITS,
            period: DEFAULT_PERIOD,
            otp_type: OtpType::Totp,
            counter: 0,
        }
    }
}

/// Backwards-compatible name for the engine entry.
pub type TotpConfig = OtpConfig;

impl OtpConfig {
    /// Build an entry from user supplied parts, normalising and validating it.
    #[allow(clippy::too_many_arguments)]
    pub fn from_parts(
        secret: &str,
        issuer: &str,
        account: &str,
        algorithm: &str,
        digits: u32,
        period: u32,
        otp_type: &str,
        counter: u64,
    ) -> Result<Self> {
        let mut entry = Self {
            secret: secret.to_string(),
            issuer: issuer.to_string(),
            account: account.to_string(),
            algorithm: TotpAlgorithm::parse(algorithm)?,
            digits,
            period,
            otp_type: OtpType::parse(otp_type)?,
            counter,
        };
        entry.normalize();
        entry.validate()?;
        Ok(entry)
    }

    /// Display label: `Issuer · account` like Google Authenticator shows.
    pub fn label(&self) -> String {
        match (self.issuer.trim(), self.account.trim()) {
            ("", "") => "Authenticator".to_string(),
            ("", account) => account.to_string(),
            (issuer, "") => issuer.to_string(),
            (issuer, account) => format!("{issuer} · {account}"),
        }
    }

    pub fn is_counter_based(&self) -> bool {
        self.otp_type == OtpType::Hotp
    }

    /// Validate the shape of an entry before it is stored.
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

    /// The code for a UNIX timestamp (TOTP) or the stored counter (HOTP).
    pub fn code_at(&self, unix_time: u64) -> Result<String> {
        self.validate()?;
        let counter = match self.otp_type {
            OtpType::Totp => unix_time / u64::from(self.period),
            OtpType::Hotp => self.counter,
        };
        self.code_for_counter(counter)
    }

    /// The code for an explicit counter value.
    pub fn code_for_counter(&self, counter: u64) -> Result<String> {
        self.validate()?;
        let mut secret = decode_base32(&self.secret)?;
        let code = hotp(&secret, counter, self.digits, self.algorithm);
        secret.zeroize();
        code
    }

    /// Whole seconds until the current TOTP code rolls over (0 for HOTP).
    pub fn remaining_secs(&self, unix_time: u64) -> u32 {
        if self.is_counter_based() {
            return 0;
        }
        let period = u64::from(self.period.max(1));
        let elapsed = unix_time % period;
        (period - elapsed) as u32
    }

    /// Fraction of the current window already used, 0.0 ..= 1.0.
    pub fn progress(&self, unix_time: u64) -> f32 {
        if self.is_counter_based() {
            return 0.0;
        }
        let period = f32::from(self.period.max(1) as u16);
        let remaining = self.remaining_secs(unix_time) as f32;
        1.0 - (remaining / period).clamp(0.0, 1.0)
    }

    /// Current step (time window index or counter value).
    pub fn step(&self, unix_time: u64) -> u64 {
        match self.otp_type {
            OtpType::Totp => unix_time / u64::from(self.period.max(1)),
            OtpType::Hotp => self.counter,
        }
    }

    /// Verify a user supplied code. TOTP accepts one step of clock skew; HOTP
    /// searches the next `HOTP_LOOKAHEAD` counters and returns the matched one so
    /// the caller can advance the stored counter.
    pub fn verify(&self, candidate: &str, unix_time: u64) -> Result<bool> {
        Ok(self.matched_counter(candidate, unix_time)?.is_some())
    }

    /// The counter value that produced `candidate`, if any.
    pub fn matched_counter(&self, candidate: &str, unix_time: u64) -> Result<Option<u64>> {
        let candidate = candidate.trim();
        match self.otp_type {
            OtpType::Totp => {
                let step_secs = u64::from(self.period.max(1));
                for offset in -VERIFY_SKEW_STEPS..=VERIFY_SKEW_STEPS {
                    let shifted = unix_time as i128 + offset as i128 * step_secs as i128;
                    if shifted < 0 {
                        continue;
                    }
                    let time = shifted as u64;
                    if self.code_at(time)? == candidate {
                        return Ok(Some(time / step_secs));
                    }
                }
                Ok(None)
            }
            OtpType::Hotp => {
                for offset in 0..=HOTP_LOOKAHEAD {
                    let counter = self.counter.saturating_add(offset);
                    if self.code_for_counter(counter)? == candidate {
                        return Ok(Some(counter));
                    }
                }
                Ok(None)
            }
        }
    }

    /// `otpauth://` URI for QR export or transfer to another authenticator app.
    pub fn to_uri(&self) -> String {
        let label = if self.issuer.is_empty() {
            url_encode(&self.account)
        } else if self.account.is_empty() {
            url_encode(&self.issuer)
        } else {
            format!("{}:{}", url_encode(&self.issuer), url_encode(&self.account))
        };
        let mut uri = format!(
            "otpauth://{}/{label}?secret={}&digits={}",
            self.otp_type.as_str(),
            url_encode(&self.secret),
            self.digits
        );
        if self.is_counter_based() {
            uri.push_str(&format!("&counter={}", self.counter));
        } else {
            uri.push_str(&format!("&period={}", self.period));
        }
        if !self.issuer.is_empty() {
            uri.push_str(&format!("&issuer={}", url_encode(&self.issuer)));
        }
        if self.algorithm != TotpAlgorithm::Sha1 {
            uri.push_str(&format!("&algorithm={}", self.algorithm.as_str()));
        }
        uri
    }

    /// Parse an `otpauth://totp/…` or `otpauth://hotp/…` setup URI.
    pub fn parse_uri(uri: &str) -> Result<Self> {
        let trimmed = uri.trim();
        let lower = trimmed.to_ascii_lowercase();
        let (otp_type, rest) = if let Some(rest) = lower
            .starts_with("otpauth://totp/")
            .then(|| &trimmed["otpauth://totp/".len()..])
        {
            (OtpType::Totp, rest)
        } else if let Some(rest) = lower
            .starts_with("otpauth://hotp/")
            .then(|| &trimmed["otpauth://hotp/".len()..])
        {
            (OtpType::Hotp, rest)
        } else {
            return Err(AcuyeError::Validation(
                "That is not an otpauth:// setup URI".into(),
            ));
        };

        let (label, query) = match rest.split_once('?') {
            Some((label, query)) => (label, query),
            None => (rest, ""),
        };
        let mut config = OtpConfig {
            otp_type,
            ..OtpConfig::default()
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
                "counter" => {
                    config.counter = value.trim().parse().map_err(|_| {
                        AcuyeError::Validation("Invalid counter in the setup URI".into())
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

/// Batch view of an entry, handy for list UIs that should not expose secrets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OtpSummary {
    pub label: String,
    pub issuer: String,
    pub account: String,
    pub otp_type: OtpType,
    pub algorithm: TotpAlgorithm,
    pub digits: u32,
    pub period: u32,
    pub counter: u64,
}

impl OtpConfig {
    pub fn summary(&self) -> OtpSummary {
        OtpSummary {
            label: self.label(),
            issuer: self.issuer.clone(),
            account: self.account.clone(),
            otp_type: self.otp_type,
            algorithm: self.algorithm,
            digits: self.digits,
            period: self.period,
            counter: self.counter,
        }
    }
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
        // "12345678901234567890" from RFC 6238 / RFC 4226.
        encode_base32(b"12345678901234567890")
    }

    fn totp(digits: u32, period: u32) -> OtpConfig {
        OtpConfig {
            secret: rfc_secret_base32(),
            digits,
            period,
            ..OtpConfig::default()
        }
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
        assert_eq!(decode_base32("mzxw 6ytb-oi====").unwrap(), b"foobar");
        assert!(decode_base32("not base32!").is_err());
    }

    #[test]
    fn sha1_matches_rfc6238_vectors() {
        let config = totp(8, 30);
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
        let sha256 = OtpConfig {
            secret: encode_base32(b"12345678901234567890123456789012"),
            digits: 8,
            algorithm: TotpAlgorithm::Sha256,
            ..OtpConfig::default()
        };
        assert_eq!(sha256.code_at(59).unwrap(), "46119246");
        assert_eq!(sha256.code_at(20_000_000_000).unwrap(), "77737706");

        let sha512 = OtpConfig {
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
    fn hotp_matches_rfc4226_vectors() {
        let config = OtpConfig {
            secret: rfc_secret_base32(),
            digits: 6,
            otp_type: OtpType::Hotp,
            ..OtpConfig::default()
        };
        let expected = [
            "755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583",
            "399871", "520489",
        ];
        for (counter, code) in expected.iter().enumerate() {
            assert_eq!(
                config.code_for_counter(counter as u64).unwrap(),
                *code,
                "counter={counter}"
            );
        }
        // Counter 0 is the code at counter 0, and `code_at` ignores the clock.
        assert_eq!(config.code_at(1_700_000_000).unwrap(), "755224");
    }

    #[test]
    fn six_digit_codes_are_the_rfc_vectors_truncated() {
        assert_eq!(totp(6, 30).code_at(59).unwrap(), "287082");
    }

    #[test]
    fn sixty_second_period_is_supported() {
        let config = totp(6, 60);
        assert_eq!(config.code_at(30).unwrap(), config.code_at(59).unwrap());
        assert_ne!(config.code_at(59).unwrap(), config.code_at(61).unwrap());
        assert_eq!(config.remaining_secs(60), 60);
        assert_eq!(config.remaining_secs(119), 1);
        assert!(config.progress(60) < 0.01);
    }

    #[test]
    fn totp_verification_accepts_one_step_of_skew() {
        let config = totp(6, 30);
        let now = 1_111_111_111u64;
        assert!(config.verify(&config.code_at(now).unwrap(), now).unwrap());
        assert!(config
            .verify(&config.code_at(now - 30).unwrap(), now)
            .unwrap());
        assert!(config
            .verify(&config.code_at(now + 30).unwrap(), now)
            .unwrap());
        assert!(!config
            .verify(&config.code_at(now + 300).unwrap(), now)
            .unwrap());
    }

    #[test]
    fn hotp_verification_reports_the_matched_counter() {
        let config = OtpConfig {
            secret: rfc_secret_base32(),
            digits: 6,
            otp_type: OtpType::Hotp,
            counter: 3,
            ..OtpConfig::default()
        };
        // A code from the next few counters is accepted and returns that value.
        assert_eq!(
            config.matched_counter("338314", 1_700_000_000).unwrap(),
            Some(4)
        );
        assert_eq!(
            config.matched_counter("999999", 1_700_000_000).unwrap(),
            None
        );
        // Far-future codes are outside the look-ahead window.
        let far = config.code_for_counter(40).unwrap();
        assert_eq!(config.matched_counter(&far, 1_700_000_000).unwrap(), None);
        assert_eq!(config.remaining_secs(1_700_000_000), 0);
    }

    #[test]
    fn uri_roundtrip_preserves_settings() {
        let uri = "otpauth://totp/GitHub:ada%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DP&issuer=GitHub&algorithm=SHA256&digits=7&period=60";
        let config = OtpConfig::parse_uri(uri).unwrap();
        assert_eq!(config.issuer, "GitHub");
        assert_eq!(config.account, "ada@example.com");
        assert_eq!(config.digits, 7);
        assert_eq!(config.period, 60);
        assert_eq!(config.otp_type, OtpType::Totp);
        assert_eq!(OtpConfig::parse_uri(&config.to_uri()).unwrap(), config);

        let hotp_uri =
            "otpauth://hotp/Bank:ada?secret=JBSWY3DPEHPK3PXPJBSWY3DP&counter=12&issuer=Bank";
        let hotp = OtpConfig::parse_uri(hotp_uri).unwrap();
        assert_eq!(hotp.otp_type, OtpType::Hotp);
        assert_eq!(hotp.counter, 12);
        assert_eq!(OtpConfig::parse_uri(&hotp.to_uri()).unwrap(), hotp);
        assert!(hotp.to_uri().contains("counter=12"));
    }

    #[test]
    fn uri_without_secret_or_wrong_scheme_is_rejected() {
        assert!(OtpConfig::parse_uri("otpauth://totp/a?issuer=x").is_err());
        assert!(OtpConfig::parse_uri("https://example.com").is_err());
        assert!(OtpConfig::parse_uri("otpauth://yandex/a?secret=JBSWY3DPEHPK3PXP").is_err());
    }

    #[test]
    fn entries_validate_their_parts() {
        assert!(OtpConfig::from_parts(
            "JBSWY3DPEHPK3PXP",
            "GitHub",
            "ada",
            "sha256",
            6,
            30,
            "totp",
            0
        )
        .is_ok());
        assert!(OtpConfig::from_parts(
            "JBSWY3DPEHPK3PXP",
            "GitHub",
            "ada",
            "md5",
            6,
            30,
            "totp",
            0
        )
        .is_err());
        assert!(OtpConfig::from_parts(
            "JBSWY3DPEHPK3PXP",
            "GitHub",
            "ada",
            "sha1",
            6,
            30,
            "sms",
            0
        )
        .is_err());
        // Short secret, bad digits, bad interval.
        assert!(OtpConfig::from_parts("JBSWY3DP", "x", "y", "sha1", 6, 30, "totp", 0).is_err());
        assert!(
            OtpConfig::from_parts("JBSWY3DPEHPK3PXP", "x", "y", "sha1", 9, 30, "totp", 0).is_err()
        );
        assert!(
            OtpConfig::from_parts("JBSWY3DPEHPK3PXP", "x", "y", "sha1", 6, 5, "totp", 0).is_err()
        );
    }

    #[test]
    fn labels_and_summaries_never_include_the_secret() {
        let config = OtpConfig {
            secret: rfc_secret_base32(),
            issuer: "GitHub".into(),
            account: "ada@example.com".into(),
            ..OtpConfig::default()
        };
        assert_eq!(config.label(), "GitHub · ada@example.com");
        let summary = config.summary();
        let json = serde_json::to_string(&summary).unwrap();
        assert!(!json.contains(&config.secret));
        assert!(json.contains("ada@example.com"));
        assert_eq!(summary.otp_type, OtpType::Totp);
    }

    #[test]
    fn normalize_strips_formatting() {
        let mut config = OtpConfig {
            secret: " jbsw y3dp-ehpk3pxp ".into(),
            issuer: "  GitHub ".into(),
            account: " ada ".into(),
            ..OtpConfig::default()
        };
        config.normalize();
        assert_eq!(config.secret, "JBSWY3DPEHPK3PXP");
        assert_eq!(config.issuer, "GitHub");
        assert_eq!(config.account, "ada");
    }
}
