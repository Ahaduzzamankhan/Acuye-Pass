//! Platform integration and network hardening.
//!
//! Windows is the primary desktop target. This crate owns:
//! * the default on-disk location for the encrypted database and backups;
//! * strict validation before opening an external URL;
//! * favicon retrieval with SSRF protections (public hosts only, HTTPS only,
//!   no redirects, size and format limits, no SVG).
//!
//! No third-party favicon service is ever contacted.

use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, ToSocketAddrs};
use std::time::Duration;

use acuye_core::{AcuyeError, Result};

pub const APP_DIR_NAME: &str = "AcuyePass";
pub const MAX_FAVICON_BYTES: usize = 256 * 1024;
pub const FAVICON_TIMEOUT_SECS: u64 = 8;

/// Directory used for the database, backups and cache.
///
/// * Windows: `%APPDATA%\AcuyePass`
/// * macOS: `~/Library/Application Support/AcuyePass`
/// * Linux: `$XDG_DATA_HOME/acuye-pass` or `~/.local/share/acuye-pass`
pub fn default_data_dir() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("ACUYE_PASS_DATA_DIR") {
        if !dir.trim().is_empty() {
            return std::path::PathBuf::from(dir);
        }
    }
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return std::path::PathBuf::from(appdata).join(APP_DIR_NAME);
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return std::path::PathBuf::from(home)
                .join("Library/Application Support")
                .join(APP_DIR_NAME);
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            if !xdg.trim().is_empty() {
                return std::path::PathBuf::from(xdg).join("acuye-pass");
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            return std::path::PathBuf::from(home).join(".local/share/acuye-pass");
        }
    }
    std::env::temp_dir().join("acuye-pass")
}

pub fn platform_name() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// Validate a URL the user explicitly asked to open in their browser.
///
/// Only `http` and `https` are accepted, credentials are rejected and control
/// characters are refused, so an item URL cannot smuggle a `file:`/`javascript:`
/// scheme into the OS handler.
pub fn validate_external_url(url: &str) -> Result<String> {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.len() > 2048 {
        return Err(AcuyeError::Validation("Invalid website URL".into()));
    }
    if trimmed.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(AcuyeError::Validation("Invalid website URL".into()));
    }
    let lower = trimmed.to_ascii_lowercase();
    let rest = if let Some(rest) = lower.strip_prefix("https://") {
        rest
    } else if let Some(rest) = lower.strip_prefix("http://") {
        rest
    } else {
        return Err(AcuyeError::Validation(
            "Only http and https links can be opened".into(),
        ));
    };
    if rest.is_empty() || rest.starts_with('/') {
        return Err(AcuyeError::Validation("Invalid website URL".into()));
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.contains('@') {
        return Err(AcuyeError::Validation(
            "URLs with embedded credentials are not allowed".into(),
        ));
    }
    let host = match authority.rsplit_once(':') {
        Some((host, port)) if !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) => {
            if port.len() > 5 || port.parse::<u32>().map(|p| p == 0).unwrap_or(true) {
                return Err(AcuyeError::Validation("Invalid port".into()));
            }
            host
        }
        Some(_) => return Err(AcuyeError::Validation("Invalid website host".into())),
        None => authority,
    };
    if host.is_empty()
        || host.len() > 253
        || host.starts_with('.')
        || host.ends_with('.')
        || host.contains("..")
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return Err(AcuyeError::Validation("Invalid website host".into()));
    }
    Ok(trimmed.to_string())
}

/// Idempotent conversion of user input into an openable URL.
pub fn normalize_website(url: &str) -> Option<String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }
    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    validate_external_url(&candidate).ok()
}

/// True when the address is globally routable and therefore not part of a
/// private, loopback, link-local or otherwise special-purpose range.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_ipv4(v4),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_public_ipv4(mapped);
            }
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
                || (v6.segments()[0] & 0xffc0) == 0xfe80)
        }
    }
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || ip.is_multicast()
        || o[0] == 0
        || (o[0] == 100 && (64..=127).contains(&o[1])) // CGNAT
        || (o[0] == 192 && o[1] == 0 && o[2] == 0)
        || (o[0] == 198 && (o[1] == 18 || o[1] == 19)) // benchmarking
        || o[0] >= 240)
}

fn parse_https_target(url: &str) -> Result<(String, String)> {
    let valid = validate_external_url(url)?;
    let without_scheme = valid
        .split_once("://")
        .map(|(_, rest)| rest)
        .ok_or_else(|| AcuyeError::Validation("Invalid URL".into()))?;
    let (authority, path) = match without_scheme.find('/') {
        Some(index) => (&without_scheme[..index], &without_scheme[index..]),
        None => (without_scheme, "/"),
    };
    let authority = authority.split(['?', '#']).next().unwrap_or(authority);
    let host = authority
        .rsplit_once(':')
        .filter(|(h, p)| !h.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
        .map(|(h, _)| h)
        .unwrap_or(authority)
        .to_ascii_lowercase();
    if host.is_empty()
        || host == "localhost"
        || host.ends_with(".local")
        || host.ends_with(".internal")
    {
        return Err(AcuyeError::Validation("Host is not allowed".into()));
    }
    if !valid.to_ascii_lowercase().starts_with("https://") {
        return Err(AcuyeError::Validation(
            "Favicons are fetched over HTTPS only".into(),
        ));
    }
    Ok((host, path.to_string()))
}

/// Resolve the host and reject the request if any resolved address is not
/// publicly routable. This blocks `169.254.169.254`, RFC1918 targets and
/// DNS names that point at loopback.
fn assert_public_host(host: &str) -> Result<()> {
    let addrs = (host, 443u16)
        .to_socket_addrs()
        .map_err(|_| AcuyeError::Network("Could not resolve the website host".into()))?;
    let mut any = false;
    for addr in addrs {
        any = true;
        if !is_public_ip(addr.ip()) {
            return Err(AcuyeError::Validation(
                "The website host resolves to a private address".into(),
            ));
        }
    }
    if !any {
        return Err(AcuyeError::Network(
            "Could not resolve the website host".into(),
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Favicon {
    pub bytes: Vec<u8>,
    pub mime: String,
}

impl Favicon {
    pub fn to_data_url(&self) -> String {
        format!(
            "data:{};base64,{}",
            self.mime,
            acuye_crypto_b64(&self.bytes)
        )
    }
}

fn acuye_crypto_b64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        return Some("image/x-icon");
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"BM") {
        return Some("image/bmp");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    // SVG is intentionally not accepted: it can carry script content and the
    // UI falls back to generated initials instead.
    None
}

/// Fetch `https://host/favicon.ico` with SSRF and size protections.
///
/// Redirects are disabled so a public host cannot bounce the request to a
/// private address or an unexpected domain.
pub fn fetch_favicon(website_url: &str) -> Result<Favicon> {
    let (host, _path) = parse_https_target(website_url)?;
    assert_public_host(&host)?;

    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(FAVICON_TIMEOUT_SECS))
        .redirects(0)
        .build();
    let url = format!("https://{host}/favicon.ico");
    let response = agent
        .get(&url)
        .set("User-Agent", "AcuyePass/0.1 (favicon; privacy-first)")
        .set("Accept", "image/png,image/x-icon,image/*;q=0.5")
        .call()
        .map_err(|_| AcuyeError::Network("No favicon is available for this site".into()))?;

    if response.status() != 200 {
        return Err(AcuyeError::Network(
            "No favicon is available for this site".into(),
        ));
    }
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_FAVICON_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| AcuyeError::Network("Could not read the favicon".into()))?;
    if bytes.len() > MAX_FAVICON_BYTES {
        return Err(AcuyeError::Validation(
            "The favicon is larger than 256 KB".into(),
        ));
    }
    if bytes.is_empty() {
        return Err(AcuyeError::Network("The favicon was empty".into()));
    }
    let mime = sniff_image(&bytes).ok_or_else(|| {
        AcuyeError::Validation("The website returned an unsupported image format".into())
    })?;
    Ok(Favicon {
        bytes,
        mime: mime.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_url_validation() {
        assert!(validate_external_url("https://example.com/path").is_ok());
        assert!(validate_external_url("http://example.com").is_ok());
        for bad in [
            "javascript:alert(1)",
            "file:///C:/Windows/System32",
            "data:text/html,<script>",
            "https://user:pass@example.com",
            "https://",
            "https://exa mple.com",
            "",
        ] {
            assert!(
                validate_external_url(bad).is_err(),
                "{bad} should be rejected"
            );
        }
    }

    #[test]
    fn website_normalization_adds_scheme() {
        assert_eq!(
            normalize_website("example.com/login").unwrap(),
            "https://example.com/login"
        );
        assert!(normalize_website("").is_none());
        assert!(normalize_website("javascript:alert(1)").is_none());
    }

    #[test]
    fn private_addresses_are_not_public() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "::1",
            "fc00::1",
            "fe80::1",
        ] {
            assert!(!is_public_ip(ip.parse().unwrap()), "{ip} must be private");
        }
        for ip in ["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"] {
            assert!(is_public_ip(ip.parse().unwrap()), "{ip} must be public");
        }
    }

    #[test]
    fn favicon_targets_must_be_https_public_hosts() {
        assert!(super::parse_https_target("http://example.com").is_err());
        assert!(super::parse_https_target("https://localhost/").is_err());
        assert!(super::parse_https_target("https://machine.local/").is_err());
        assert!(super::parse_https_target("https://example.com").is_ok());
        assert!(
            super::parse_https_target("https://127.0.0.1").is_ok(),
            "host parse only; DNS check is separate"
        );
    }

    #[test]
    fn image_sniffing_rejects_svg_and_html() {
        assert_eq!(sniff_image(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(sniff_image(&[0, 0, 1, 0, 9]), Some("image/x-icon"));
        assert_eq!(
            sniff_image(b"<svg xmlns=\"http://www.w3.org/2000/svg\">"),
            None
        );
        assert_eq!(sniff_image(b"<html>"), None);
    }

    #[test]
    fn data_dir_is_under_a_user_location() {
        let dir = default_data_dir();
        assert!(dir.to_string_lossy().len() > 3);
        assert!(
            platform_name() == "windows"
                || platform_name() == "macos"
                || platform_name() == "linux"
        );
    }
}
