//! Custom Windows updater for Acuye Pass.
//!
//! Trust model:
//! * release metadata is fetched only from the official GitHub repository;
//! * every download URL must live under that repository's release path;
//! * the installer must carry a valid minisign/Tauri updater signature made
//!   with the project's updater key;
//! * downgrades are rejected;
//! * nothing is installed without explicit user consent.
//!
//! Release channels: `stable` (default, prereleases ignored), `beta`
//! (prerelease label `beta`) and `alpha` (labels `alpha`/`beta`). Stable
//! releases are always acceptable on every channel.

use std::io::Read;
use std::path::Path;
use std::time::Duration;

use acuye_core::{AcuyeError, Result};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Official repository derived from this project's Git remote. Update checks
/// never accept another repository.
pub const OFFICIAL_OWNER: &str = "Ahaduzzamankhan";
pub const OFFICIAL_REPO: &str = "Acuye-Pass";
pub const OFFICIAL_REPO_SLUG: &str = "Ahaduzzamankhan/Acuye-Pass";
pub const ASSET_NAME_PREFIXES: [&str; 3] = ["Acuye Pass", "Acuye-Pass", "acuye-pass"];
pub const MAX_RELEASE_JSON_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_UPDATE_BYTES: u64 = 256 * 1024 * 1024;
const HTTP_TIMEOUT_SECS: u64 = 30;

/// Update signing public key, injected at build time:
/// `ACUYE_UPDATER_PUBKEY=<base64 minisign public key>`.
pub fn embedded_public_key() -> Option<String> {
    option_env!("ACUYE_UPDATER_PUBKEY")
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ReleaseChannel {
    #[default]
    Stable,
    Beta,
    Alpha,
}

impl ReleaseChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
            Self::Alpha => "alpha",
        }
    }

    pub fn parse(value: &str) -> Result<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "stable" => Ok(Self::Stable),
            "beta" => Ok(Self::Beta),
            "alpha" => Ok(Self::Alpha),
            _ => Err(AcuyeError::Validation("Unknown release channel".into())),
        }
    }

    /// Beta and Alpha are opt-in: the settings layer must pass the channel the
    /// user explicitly selected.
    pub fn is_opt_in(self) -> bool {
        !matches!(self, Self::Stable)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateAsset {
    pub name: String,
    pub url: String,
    pub size: u64,
    pub signature_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateCandidate {
    pub version: String,
    pub tag_name: String,
    pub notes: String,
    pub published_at: String,
    pub prerelease: bool,
    pub channel: ReleaseChannel,
    pub asset: UpdateAsset,
}

#[derive(Debug, Deserialize, Clone)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
}

#[derive(Debug, Deserialize, Clone)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

fn releases_url() -> String {
    format!("https://api.github.com/repos/{OFFICIAL_REPO_SLUG}/releases?per_page=30")
}

/// Parse a release tag such as `v1.0.0`, `v1.1.0-beta.1`.
pub fn parse_release_version(tag: &str) -> Result<Version> {
    let trimmed = tag.trim();
    let stripped = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .ok_or_else(|| {
            AcuyeError::Update("release tags must use the v<semver> convention".into())
        })?;
    let version = Version::parse(stripped)
        .map_err(|_| AcuyeError::Update("invalid release version".into()))?;
    if !version.build.is_empty() {
        return Err(AcuyeError::Update(
            "release versions must not use build metadata".into(),
        ));
    }
    if !version.pre.is_empty() {
        let label = version.pre.split('.').next().unwrap_or("");
        if !matches!(label, "alpha" | "beta") {
            return Err(AcuyeError::Update(
                "only alpha and beta prerelease labels are supported".into(),
            ));
        }
    }
    Ok(version)
}

pub fn release_channel_of(version: &Version) -> ReleaseChannel {
    if version.pre.is_empty() {
        return ReleaseChannel::Stable;
    }
    if version.pre.split('.').next() == Some("alpha") {
        ReleaseChannel::Alpha
    } else {
        ReleaseChannel::Beta
    }
}

fn channel_accepts(version: &Version, channel: ReleaseChannel) -> bool {
    match channel {
        ReleaseChannel::Stable => version.pre.is_empty(),
        ReleaseChannel::Beta => matches!(
            release_channel_of(version),
            ReleaseChannel::Stable | ReleaseChannel::Beta
        ),
        ReleaseChannel::Alpha => true,
    }
}

fn compact_name(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// A Windows installer asset produced by the Tauri bundle step.
fn is_windows_installer(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if !(lower.ends_with(".exe") || lower.ends_with(".msi")) {
        return false;
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return false;
    }
    let has_platform = lower.contains("x64") || lower.contains("x86_64");
    // Tauri writes `Acuye.Pass_0.1.2_x64-setup.exe`, so compare a punctuation
    // free form of the name against the product name instead of a literal
    // prefix; otherwise no release ever looks newer than the installed build.
    let compact = compact_name(name);
    let has_prefix = ASSET_NAME_PREFIXES
        .iter()
        .any(|prefix| compact.starts_with(&compact_name(prefix)));
    has_platform && has_prefix
}

/// Only the official repository's release download path is trusted.
pub fn validate_download_url(url: &str, tag: &str) -> Result<()> {
    if tag.is_empty()
        || tag.contains('/')
        || tag.contains(char::is_whitespace)
        || tag.contains("..")
    {
        return Err(AcuyeError::Update("invalid release tag".into()));
    }
    let prefix = format!("https://github.com/{OFFICIAL_REPO_SLUG}/releases/download/{tag}/");
    if !url.starts_with(&prefix) {
        return Err(AcuyeError::Update(
            "update download does not come from the official repository".into(),
        ));
    }
    let remainder = &url[prefix.len()..];
    if remainder.is_empty()
        || remainder.contains('/')
        || remainder.contains(char::is_whitespace)
        || remainder.contains("..")
    {
        return Err(AcuyeError::Update("invalid update asset path".into()));
    }
    Ok(())
}

fn pick_asset(release: &GithubRelease) -> Option<UpdateAsset> {
    let names: Vec<&str> = release.assets.iter().map(|a| a.name.as_str()).collect();
    let candidate = release
        .assets
        .iter()
        .filter(|asset| is_windows_installer(&asset.name))
        .find(|asset| names.contains(&format!("{}.sig", asset.name).as_str()))?;
    let sig_name = format!("{}.sig", candidate.name);
    let signature = release
        .assets
        .iter()
        .find(|a| a.name == sig_name)
        .expect("checked above");
    Some(UpdateAsset {
        name: candidate.name.clone(),
        url: candidate.browser_download_url.clone(),
        size: candidate.size,
        signature_url: signature.browser_download_url.clone(),
    })
}

/// Pure release selection, independent of the network. Used by tests and by
/// `check_for_updates`.
pub fn select_update(
    releases_json: &str,
    current_version: &str,
    channel: ReleaseChannel,
) -> Result<Option<UpdateCandidate>> {
    let current = Version::parse(current_version.trim())
        .map_err(|_| AcuyeError::Update("installed version is invalid".into()))?;
    let releases: Vec<GithubRelease> = serde_json::from_str(releases_json)
        .map_err(|_| AcuyeError::Update("invalid release metadata".into()))?;

    let mut best: Option<(Version, UpdateCandidate)> = None;
    for release in releases {
        if release.draft {
            continue;
        }
        let Ok(version) = parse_release_version(&release.tag_name) else {
            continue;
        };
        if !channel_accepts(&version, channel) {
            continue;
        }
        if version <= current {
            continue;
        }
        let Some(asset) = pick_asset(&release) else {
            continue;
        };
        if validate_download_url(&asset.url, &release.tag_name).is_err()
            || validate_download_url(&asset.signature_url, &release.tag_name).is_err()
        {
            continue;
        }
        if asset.size > MAX_UPDATE_BYTES {
            continue;
        }
        let candidate = UpdateCandidate {
            version: version.to_string(),
            tag_name: release.tag_name.clone(),
            notes: release.body.unwrap_or_default(),
            published_at: release.published_at.unwrap_or_default(),
            prerelease: release.prerelease || !version.pre.is_empty(),
            channel: release_channel_of(&version),
            asset,
        };
        match &best {
            Some((best_version, _)) if best_version >= &version => {}
            _ => best = Some((version, candidate)),
        }
    }
    Ok(best.map(|(_, candidate)| candidate))
}

/// Fail closed if a candidate would be a downgrade or reinstall.
pub fn ensure_upgrade(current_version: &str, candidate: &UpdateCandidate) -> Result<()> {
    let current = Version::parse(current_version.trim())
        .map_err(|_| AcuyeError::Update("installed version is invalid".into()))?;
    let offered = Version::parse(&candidate.version)
        .map_err(|_| AcuyeError::Update("offered version is invalid".into()))?;
    if offered <= current {
        return Err(AcuyeError::Update(
            "the offered update is not newer than the installed version".into(),
        ));
    }
    Ok(())
}

/// Release discovery abstraction so tests never touch the network.
pub trait ReleaseSource {
    fn releases_json(&self) -> Result<String>;
}

/// HTTPS-only GitHub client with redirects disabled.
pub struct GithubReleaseSource;

impl ReleaseSource for GithubReleaseSource {
    fn releases_json(&self) -> Result<String> {
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
            .redirects(0)
            .build();
        let response = agent
            .get(&releases_url())
            .set("User-Agent", "AcuyePass-Updater/0.1")
            .set("Accept", "application/vnd.github+json")
            .call()
            .map_err(|_| AcuyeError::Network("Could not reach the release server".into()))?;
        if response.status() != 200 {
            return Err(AcuyeError::Network(format!(
                "release server returned status {}",
                response.status()
            )));
        }
        let mut body = String::new();
        response
            .into_reader()
            .take(MAX_RELEASE_JSON_BYTES as u64 + 1)
            .read_to_string(&mut body)
            .map_err(|_| AcuyeError::Network("Could not read release metadata".into()))?;
        if body.len() > MAX_RELEASE_JSON_BYTES {
            return Err(AcuyeError::Update("release metadata is too large".into()));
        }
        Ok(body)
    }
}

pub fn check_for_updates(
    source: &dyn ReleaseSource,
    current_version: &str,
    channel: ReleaseChannel,
    channel_enabled: bool,
) -> Result<Option<UpdateCandidate>> {
    if channel.is_opt_in() && !channel_enabled {
        return Err(AcuyeError::Update(format!(
            "the {} channel is disabled",
            channel.as_str()
        )));
    }
    let json = source.releases_json()?;
    select_update(&json, current_version, channel)
}

/// Download a verified-by-signature installer.
///
/// `progress` is called with `(downloaded, total)` where total is 0 when the
/// server does not report a length.
pub fn download_installer(
    candidate: &UpdateCandidate,
    destination: &Path,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<()> {
    validate_download_url(&candidate.asset.url, &candidate.tag_name)?;
    if candidate.asset.size > MAX_UPDATE_BYTES {
        return Err(AcuyeError::Update("the update package is too large".into()));
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .redirects(0)
        .build();
    let response = agent
        .get(&candidate.asset.url)
        .set("User-Agent", "AcuyePass-Updater/0.1")
        .set("Accept", "application/octet-stream")
        .call()
        .map_err(|_| AcuyeError::Network("Could not download the update".into()))?;
    if response.status() != 200 {
        return Err(AcuyeError::Network(format!(
            "update download failed with status {}",
            response.status()
        )));
    }
    let total = response
        .header("content-length")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(candidate.asset.size);
    if total > MAX_UPDATE_BYTES {
        return Err(AcuyeError::Update("the update package is too large".into()));
    }
    let mut reader = response.into_reader().take(MAX_UPDATE_BYTES + 1);
    let mut file = std::fs::File::create(destination)?;
    let mut buffer = [0u8; 64 * 1024];
    let mut received = 0u64;
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|_| AcuyeError::Network("update download was interrupted".into()))?;
        if read == 0 {
            break;
        }
        received += read as u64;
        if received > MAX_UPDATE_BYTES {
            let _ = std::fs::remove_file(destination);
            return Err(AcuyeError::Update("the update package is too large".into()));
        }
        std::io::Write::write_all(&mut file, &buffer[..read])?;
        progress(received, total);
    }
    if received == 0 {
        let _ = std::fs::remove_file(destination);
        return Err(AcuyeError::Update("the update download was empty".into()));
    }
    Ok(())
}

/// Download just the `.sig` file (max 4 KiB).
pub fn fetch_signature(candidate: &UpdateCandidate) -> Result<String> {
    validate_download_url(&candidate.asset.signature_url, &candidate.tag_name)?;
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .redirects(0)
        .build();
    let response = agent
        .get(&candidate.asset.signature_url)
        .set("User-Agent", "AcuyePass-Updater/0.1")
        .call()
        .map_err(|_| AcuyeError::Network("Could not fetch the update signature".into()))?;
    if response.status() != 200 {
        return Err(AcuyeError::Network(
            "Could not fetch the update signature".into(),
        ));
    }
    let mut body = String::new();
    response
        .into_reader()
        .take(8192)
        .read_to_string(&mut body)
        .map_err(|_| AcuyeError::Network("Could not read the update signature".into()))?;
    if body.trim().is_empty() {
        return Err(AcuyeError::Update("the update signature is empty".into()));
    }
    Ok(body.trim().to_string())
}

fn signature_text(raw: &str) -> Result<String> {
    let trimmed = raw.trim();
    if trimmed.contains("untrusted comment:") {
        return Ok(trimmed.to_string());
    }
    let decoded = acuye_crypto::b64_decode(trimmed)?;
    let text = String::from_utf8(decoded)
        .map_err(|_| AcuyeError::Update("the update signature is malformed".into()))?;
    if !text.contains("untrusted comment:") {
        return Err(AcuyeError::Update(
            "the update signature is malformed".into(),
        ));
    }
    Ok(text)
}

/// Normalise an updater public key to the single key line minisign expects.
///
/// Tauri's `plugins.updater.pubkey` and the `ACUYE_UPDATER_PUBKEY` build value
/// carry the whole public-key file base64-encoded, while minisign's parser
/// wants only the key line. Accept the blob, the key-file text and the bare
/// key line, so the key can be injected in whichever form the pipeline has.
fn public_key_text(raw: &str) -> Result<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AcuyeError::Update(
            "updater signing is not configured for this build".into(),
        ));
    }
    let text = if trimmed.contains("untrusted comment:") {
        trimmed.to_string()
    } else {
        match acuye_crypto::b64_decode(trimmed)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
        {
            Some(decoded) if decoded.contains("untrusted comment:") => decoded,
            _ => trimmed.to_string(),
        }
    };
    let key_line = text
        .lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty() && !line.starts_with("untrusted comment:"))
        .ok_or_else(|| AcuyeError::Update("invalid updater public key".into()))?;
    // A minisign public key is 42 raw bytes: algorithm, key id and ed25519 key.
    match acuye_crypto::b64_decode(key_line) {
        Ok(raw) if raw.len() == 42 => Ok(key_line.to_string()),
        _ => Err(AcuyeError::Update("invalid updater public key".into())),
    }
}

/// Verify a Tauri-compatible minisign signature over the installer bytes.
pub fn verify_minisign(public_key_base64: &str, signature: &str, artifact: &[u8]) -> Result<()> {
    let key_line = public_key_text(public_key_base64)?;
    let key = minisign_verify::PublicKey::from_base64(&key_line)
        .map_err(|_| AcuyeError::Update("invalid updater public key".into()))?;
    let text = signature_text(signature)?;
    let parsed = minisign_verify::Signature::decode(&text)
        .map_err(|_| AcuyeError::Update("the update signature is malformed".into()))?;
    key.verify(artifact, &parsed, false)
        .map_err(|_| AcuyeError::Update("the update signature is invalid".into()))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Result of verifying a downloaded installer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerifiedUpdate {
    pub version: String,
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

/// Verify a downloaded installer against the signature file content.
pub fn verify_installer(
    path: &Path,
    signature: &str,
    public_key_base64: &str,
    candidate: &UpdateCandidate,
) -> Result<VerifiedUpdate> {
    let metadata = std::fs::metadata(path)?;
    if metadata.len() == 0 || metadata.len() > MAX_UPDATE_BYTES {
        return Err(AcuyeError::Update(
            "the update package size is invalid".into(),
        ));
    }
    let bytes = std::fs::read(path)?;
    verify_minisign(public_key_base64, signature, &bytes)?;
    Ok(VerifiedUpdate {
        version: candidate.version.clone(),
        path: path.to_string_lossy().to_string(),
        sha256: sha256_hex(&bytes),
        size: metadata.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, prerelease: bool, asset_names: &[String]) -> serde_json::Value {
        serde_json::json!({
            "tag_name": tag,
            "name": tag,
            "body": format!("Notes for {tag}"),
            "prerelease": prerelease,
            "draft": false,
            "published_at": "2026-01-01T00:00:00Z",
            "assets": asset_names.iter().map(|name| {
                let encoded = name.replace(' ', "%20");
                serde_json::json!({
                    "name": name,
                    "browser_download_url": format!("https://github.com/{OFFICIAL_REPO_SLUG}/releases/download/{tag}/{encoded}"),
                    "size": 1024
                })
            }).collect::<Vec<_>>()
        })
    }

    fn releases_json(releases: Vec<serde_json::Value>) -> String {
        serde_json::to_string(&releases).unwrap()
    }

    fn with_assets(tag: &str, prerelease: bool) -> serde_json::Value {
        let name = format!("Acuye Pass_{}_x64-setup.exe", tag.trim_start_matches('v'));
        release(tag, prerelease, &[name.clone(), format!("{name}.sig")])
    }

    #[test]
    fn version_parsing_follows_tag_conventions() {
        assert_eq!(
            parse_release_version("v1.0.0").unwrap(),
            Version::parse("1.0.0").unwrap()
        );
        let beta = parse_release_version("v1.1.0-beta.1").unwrap();
        assert_eq!(release_channel_of(&beta), ReleaseChannel::Beta);
        let alpha = parse_release_version("v2.0.0-alpha.3").unwrap();
        assert_eq!(release_channel_of(&alpha), ReleaseChannel::Alpha);
        assert!(parse_release_version("1.0.0").is_err());
        assert!(parse_release_version("v1.0").is_err());
        assert!(parse_release_version("v1.0.0-rc.1").is_err());
        assert!(parse_release_version("v1.0.0+build").is_err());
        assert!(parse_release_version("nightly").is_err());
    }

    #[test]
    fn stable_channel_ignores_prereleases() {
        let json = releases_json(vec![
            with_assets("v1.1.0", false),
            with_assets("v2.0.0-beta.1", true),
        ]);
        let chosen = select_update(&json, "0.1.0", ReleaseChannel::Stable)
            .unwrap()
            .unwrap();
        assert_eq!(chosen.version, "1.1.0");
        assert!(!chosen.prerelease);
    }

    #[test]
    fn beta_channel_prefers_newest_beta() {
        let json = releases_json(vec![
            with_assets("v1.1.0", false),
            with_assets("v1.2.0-beta.1", true),
            with_assets("v1.3.0-beta.2", true),
            with_assets("v2.0.0-alpha.1", true),
        ]);
        let chosen = select_update(&json, "1.0.0", ReleaseChannel::Beta)
            .unwrap()
            .unwrap();
        assert_eq!(chosen.version, "1.3.0-beta.2");
        assert!(chosen.prerelease);
        assert_eq!(chosen.channel, ReleaseChannel::Beta);
    }

    #[test]
    fn alpha_channel_can_see_alphas() {
        let json = releases_json(vec![
            with_assets("v1.2.0-beta.1", true),
            with_assets("v2.0.0-alpha.1", true),
        ]);
        let chosen = select_update(&json, "1.0.0", ReleaseChannel::Alpha)
            .unwrap()
            .unwrap();
        assert_eq!(chosen.version, "2.0.0-alpha.1");
    }

    #[test]
    fn prerelease_channels_require_explicit_enablement() {
        struct Static(String);
        impl ReleaseSource for Static {
            fn releases_json(&self) -> Result<String> {
                Ok(self.0.clone())
            }
        }
        let source = Static(releases_json(vec![with_assets("v1.2.0-beta.1", true)]));
        assert!(check_for_updates(&source, "1.0.0", ReleaseChannel::Beta, false).is_err());
        assert!(
            check_for_updates(&source, "1.0.0", ReleaseChannel::Beta, true)
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn no_update_when_current_or_newer() {
        let json = releases_json(vec![with_assets("v1.0.0", false)]);
        assert!(select_update(&json, "1.0.0", ReleaseChannel::Stable)
            .unwrap()
            .is_none());
        assert!(select_update(&json, "1.5.0", ReleaseChannel::Stable)
            .unwrap()
            .is_none());
    }

    #[test]
    fn drafts_and_invalid_tags_are_ignored() {
        let mut draft = with_assets("v9.9.9", false);
        draft["draft"] = serde_json::json!(true);
        let mut bad_tag = with_assets("release-2.0.0", false);
        bad_tag["tag_name"] = serde_json::json!("release-2.0.0");
        let json = releases_json(vec![draft, bad_tag, with_assets("v1.1.0", false)]);
        let chosen = select_update(&json, "1.0.0", ReleaseChannel::Stable)
            .unwrap()
            .unwrap();
        assert_eq!(chosen.version, "1.1.0");
    }

    #[test]
    fn assets_without_signature_or_wrong_platform_are_rejected() {
        let unsigned = release(
            "v2.0.0",
            false,
            &["Acuye Pass_2.0.0_x64-setup.exe".to_string()],
        );
        let wrong_arch = release(
            "v2.1.0",
            false,
            &[
                "Acuye Pass_2.1.0_arm64-setup.exe".to_string(),
                "Acuye Pass_2.1.0_arm64-setup.exe.sig".to_string(),
            ],
        );
        let json = releases_json(vec![unsigned, wrong_arch]);
        assert!(select_update(&json, "1.0.0", ReleaseChannel::Stable)
            .unwrap()
            .is_none());
    }

    #[test]
    fn official_download_urls_only() {
        let tag = "v1.1.0";
        assert!(validate_download_url(
            "https://github.com/Ahaduzzamankhan/Acuye-Pass/releases/download/v1.1.0/Acuye%20Pass_1.1.0_x64-setup.exe",
            tag
        )
        .is_ok());
        assert!(validate_download_url(
            "https://github.com/Ahaduzzamankhan/Acuye-Pass/releases/download/v1.1.0/Acuye Pass.exe",
            tag
        )
        .is_err());
        assert!(validate_download_url(
            "https://evil.example.com/Acuye-Pass/releases/download/v1.1.0/x64-setup.exe",
            tag
        )
        .is_err());
        assert!(validate_download_url(
            "https://github.com/Attacker/Acuye-Pass/releases/download/v1.1.0/x64-setup.exe",
            tag
        )
        .is_err());
        assert!(validate_download_url(
            "https://github.com/Ahaduzzamankhan/Acuye-Pass/releases/download/v1.1.0/../evil.exe",
            tag
        )
        .is_err());
        assert!(validate_download_url(
            "http://github.com/Ahaduzzamankhan/Acuye-Pass/releases/download/v1.1.0/a.exe",
            tag
        )
        .is_err());
    }

    #[test]
    fn downgrades_are_rejected() {
        let json = releases_json(vec![with_assets("v1.1.0", false)]);
        let candidate = select_update(&json, "0.9.0", ReleaseChannel::Stable)
            .unwrap()
            .unwrap();
        assert!(ensure_upgrade("2.0.0", &candidate).is_err());
        assert!(ensure_upgrade("1.1.0", &candidate).is_err());
        assert!(ensure_upgrade("1.0.0", &candidate).is_ok());
    }

    #[test]
    fn updater_public_key_accepts_both_published_formats() {
        // The project's own public key, which the Tauri config and the release
        // secret carry as the base64 of the key file.
        const BLOB: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEZBRjkzMEUxOTU1N0ZGMUMKUldRYy8xZVY0VEQ1K2pnNnZxdkNDczhFZDNiazdmRkYrb3pkWnNxdTJTM1lLb2M4MmdQNmU0a1YK";
        const KEY_LINE: &str = "RWQc/1eV4TD5+jg6vqvCCs8Ed3bk7fFF+ozdZsqu2S3YKoc82gP6e4kV";
        let file_text = String::from_utf8(acuye_crypto::b64_decode(BLOB).unwrap()).unwrap();
        assert_eq!(public_key_text(BLOB).unwrap(), KEY_LINE);
        assert_eq!(public_key_text(KEY_LINE).unwrap(), KEY_LINE);
        assert_eq!(public_key_text(&file_text).unwrap(), KEY_LINE);
        assert_eq!(public_key_text(&format!("  {BLOB}\n")).unwrap(), KEY_LINE);
        assert!(public_key_text("").is_err());
        assert!(public_key_text("   ").is_err());
        assert!(public_key_text("not-base64").is_err());
    }

    #[test]
    fn tauri_installer_names_are_recognised() {
        // Names exactly as the release workflow publishes them.
        assert!(is_windows_installer("Acuye.Pass_0.1.2_x64-setup.exe"));
        assert!(is_windows_installer("Acuye.Pass_0.1.2_x64_en-US.msi"));
        assert!(is_windows_installer("Acuye Pass_0.1.2_x64-setup.exe"));
        assert!(is_windows_installer("acuye-pass_1.0.0_x64-setup.exe"));
        // Still refuses anything that is not our installer.
        assert!(!is_windows_installer("Acuye.Pass_0.1.2_x64-setup.exe.sig"));
        assert!(!is_windows_installer("evil_x64-setup.exe"));
        assert!(!is_windows_installer("Acuye.Pass_0.1.2_arm64-setup.exe"));
        assert!(!is_windows_installer(
            "Acuye.Pass_x64-setup.exe/../evil.exe"
        ));
    }

    #[test]
    fn release_assets_produce_an_update_candidate() {
        let names = vec![
            "Acuye.Pass_1.2.0_x64-setup.exe".to_string(),
            "Acuye.Pass_1.2.0_x64-setup.exe.sig".to_string(),
            "Acuye.Pass_1.2.0_x64_en-US.msi".to_string(),
            "Acuye.Pass_1.2.0_x64_en-US.msi.sig".to_string(),
        ];
        let json = releases_json(vec![release("v1.2.0", false, &names)]);
        let candidate = select_update(&json, "0.1.2", ReleaseChannel::Stable)
            .unwrap()
            .expect("a published release must yield a candidate");
        assert_eq!(candidate.version, "1.2.0");
        assert_eq!(candidate.asset.name, "Acuye.Pass_1.2.0_x64-setup.exe");
    }

    #[test]
    fn invalid_or_missing_signatures_are_rejected() {
        assert!(verify_minisign("", "sig", b"data").is_err());
        assert!(verify_minisign("not-base64", "sig", b"data").is_err());
        // A syntactically invalid signature can never be accepted.
        assert!(verify_minisign(
            "RWSGOq2NVecA2UPNdBUZykf1CCb147p1TYPFqHOmrESX0QlZ4J1LzD0=",
            "not a signature",
            b"data"
        )
        .is_err());
    }

    #[test]
    fn verify_installer_rejects_missing_or_empty_files() {
        let json = releases_json(vec![with_assets("v1.1.0", false)]);
        let candidate = select_update(&json, "1.0.0", ReleaseChannel::Stable)
            .unwrap()
            .unwrap();
        let dir = std::env::temp_dir().join(format!(
            "acuye-updater-test-{}-{}",
            std::process::id(),
            acuye_core::time::now()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("installer.exe");
        assert!(verify_installer(&path, "sig", "key", &candidate).is_err());
        std::fs::write(&path, b"").unwrap();
        assert!(verify_installer(&path, "sig", "key", &candidate).is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn sha256_is_stable() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
