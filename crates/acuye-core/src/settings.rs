use serde::{Deserialize, Serialize};

use crate::error::{AcuyeError, Result};
use crate::time::Timestamp;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ThemeColor {
    #[default]
    Blue,
    White,
    Red,
    Green,
    Yellow,
    Monochrome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum AppearanceMode {
    Light,
    Dark,
    #[default]
    System,
}

/// User supplied bring-your-own-backend configuration.
///
/// Acuye Pass never ships or requires Fluxenite-run sync infrastructure. In
/// this desktop phase the configuration is validated and stored but no traffic
/// is sent; the `acuye-sync` crate defines the transport contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncProviderConfig {
    pub endpoint: String,
    pub device_name: String,
    pub enabled: bool,
}

impl SyncProviderConfig {
    pub fn validate(&self) -> Result<()> {
        if !self.enabled {
            return Ok(());
        }
        let endpoint = self.endpoint.trim();
        if !endpoint.starts_with("https://") {
            return Err(AcuyeError::Validation(
                "Sync endpoints must use HTTPS".into(),
            ));
        }
        if endpoint.chars().count() > 2048 || endpoint.contains(char::is_whitespace) {
            return Err(AcuyeError::Validation("Invalid sync endpoint".into()));
        }
        // Reject obvious loopback targets so a misconfigured provider does not
        // silently ship ciphertext to the local machine.
        let host = endpoint
            .trim_start_matches("https://")
            .split(['/', ':', '?'])
            .next()
            .unwrap_or("")
            .to_lowercase();
        if host.is_empty() || host == "localhost" || host.ends_with(".local") {
            return Err(AcuyeError::Validation(
                "Sync endpoint host is not allowed".into(),
            ));
        }
        if self.device_name.trim().is_empty() {
            return Err(AcuyeError::Validation("A device name is required".into()));
        }
        Ok(())
    }
}

/// Persisted application settings. All fields have defaults so that older
/// installations keep working after upgrades.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub theme_color: ThemeColor,
    pub appearance_mode: AppearanceMode,
    pub sidebar_collapsed: bool,
    pub reduce_motion: bool,
    pub density_compact: bool,
    /// Idle seconds before the vault locks itself. `0` disables auto-lock.
    pub auto_lock_secs: u64,
    /// Seconds after which copied secrets are cleared from the clipboard.
    pub clipboard_clear_secs: u64,
    pub confirm_delete: bool,
    pub favicon_enabled: bool,
    pub shortcuts_enabled: bool,
    pub update_channel: String,
    pub update_auto_check: bool,
    pub last_update_check: Option<Timestamp>,
    pub sync_provider: Option<SyncProviderConfig>,
    pub telemetry: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme_color: ThemeColor::Blue,
            appearance_mode: AppearanceMode::System,
            sidebar_collapsed: false,
            reduce_motion: false,
            density_compact: false,
            auto_lock_secs: 300,
            clipboard_clear_secs: 30,
            confirm_delete: true,
            favicon_enabled: true,
            shortcuts_enabled: true,
            update_channel: "stable".into(),
            update_auto_check: true,
            last_update_check: None,
            sync_provider: None,
            telemetry: false,
        }
    }
}

impl AppSettings {
    pub fn validate(&self) -> Result<()> {
        if self.auto_lock_secs > 86_400 {
            return Err(AcuyeError::Validation(
                "Auto-lock timeout cannot exceed 24 hours".into(),
            ));
        }
        if self.clipboard_clear_secs > 3_600 {
            return Err(AcuyeError::Validation(
                "Clipboard timeout cannot exceed 1 hour".into(),
            ));
        }
        match self.update_channel.as_str() {
            "stable" | "beta" | "alpha" => {}
            _ => return Err(AcuyeError::Validation("Unknown release channel".into())),
        }
        if self.telemetry {
            // No telemetry endpoint exists in this build. Reject the setting so
            // the UI cannot imply a capability that is not implemented.
            return Err(AcuyeError::Validation(
                "Telemetry is not available in this build".into(),
            ));
        }
        if let Some(sync) = &self.sync_provider {
            sync.validate()?;
        }
        Ok(())
    }

    pub fn with_update_channel(mut self, channel: &str) -> Result<Self> {
        self.update_channel = channel.to_string();
        self.validate()?;
        Ok(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_private_and_sane() {
        let s = AppSettings::default();
        assert!(!s.telemetry);
        assert_eq!(s.update_channel, "stable");
        assert_eq!(s.appearance_mode, AppearanceMode::System);
        assert!(s.validate().is_ok());
    }

    #[test]
    fn unknown_channel_rejected() {
        let s = AppSettings {
            update_channel: "nightly".into(),
            ..Default::default()
        };
        assert!(s.validate().is_err());
    }

    #[test]
    fn sync_endpoint_requires_https() {
        let cfg = SyncProviderConfig {
            endpoint: "http://example.com".into(),
            device_name: "Laptop".into(),
            enabled: true,
        };
        assert!(cfg.validate().is_err());
        let ok = SyncProviderConfig {
            endpoint: "https://sync.example.com/v1".into(),
            device_name: "Laptop".into(),
            enabled: true,
        };
        assert!(ok.validate().is_ok());
    }

    #[test]
    fn settings_roundtrip_with_unknown_fields_ignored() {
        let mut value = serde_json::to_value(AppSettings::default()).unwrap();
        value["future_field"] = serde_json::json!(true);
        let parsed: AppSettings = serde_json::from_value(value).unwrap();
        assert_eq!(parsed.theme_color, ThemeColor::Blue);
    }
}
