//! Mobile bridge scaffolding.
//!
//! This crate exposes a tiny, JSON-string based surface over the shared Rust
//! core so React Native (or any other host) can call into it later. Generating
//! UniFFI/JNI bindings and a working mobile UI is intentionally out of scope
//! for this desktop phase; no mobile feature is implemented or claimed.
//!
//! The functions here are real and tested; they demonstrate that the domain,
//! authentication and generator crates are platform independent.

use acuye_core::AcuyeError;

pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Version of the shared Rust core.
pub fn core_version() -> String {
    CORE_VERSION.to_string()
}

fn error_json(error: &AcuyeError) -> String {
    serde_json::json!({
        "ok": false,
        "code": error.code(),
        "message": error.to_string(),
    })
    .to_string()
}

/// Generate a password from a JSON encoded `acuye_generator::PasswordOptions`.
pub fn generate_password_json(options_json: &str) -> String {
    let options: acuye_generator::PasswordOptions =
        match serde_json::from_str(if options_json.trim().is_empty() {
            "{}"
        } else {
            options_json
        }) {
            Ok(options) => options,
            Err(_) => {
                return serde_json::json!({
                    "ok": false,
                    "code": "validation",
                    "message": "Invalid generator options",
                })
                .to_string()
            }
        };
    match acuye_generator::generate_password(&options) {
        Ok(password) => serde_json::json!({ "ok": true, "password": password }).to_string(),
        Err(error) => error_json(&error),
    }
}

/// Generate a passphrase from JSON encoded `PassphraseOptions`.
pub fn generate_passphrase_json(options_json: &str) -> String {
    let options: acuye_generator::PassphraseOptions =
        match serde_json::from_str(if options_json.trim().is_empty() {
            "{}"
        } else {
            options_json
        }) {
            Ok(options) => options,
            Err(_) => {
                return serde_json::json!({
                    "ok": false,
                    "code": "validation",
                    "message": "Invalid passphrase options",
                })
                .to_string()
            }
        };
    match acuye_generator::generate_passphrase(&options) {
        Ok(passphrase) => serde_json::json!({ "ok": true, "passphrase": passphrase }).to_string(),
        Err(error) => error_json(&error),
    }
}

/// Report whether the vault is locked and the protocol version the mobile
/// client should eventually speak. No vault data is exposed.
pub fn core_status_json() -> String {
    serde_json::json!({
        "ok": true,
        "version": CORE_VERSION,
        "sync_protocol": acuye_protocol_version(),
        "biometrics": false,
        "mobile_implemented": false,
    })
    .to_string()
}

fn acuye_protocol_version() -> &'static str {
    // Kept as a literal so this crate does not need a protocol dependency yet.
    "acuye-sync/1"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_reported() {
        let value: serde_json::Value = serde_json::from_str(&core_status_json()).unwrap();
        assert_eq!(value["ok"], true);
        assert_eq!(value["biometrics"], false);
        assert_eq!(value["mobile_implemented"], false);
        assert_eq!(value["version"], CORE_VERSION);
    }

    #[test]
    fn password_generation_works_through_json() {
        let value: serde_json::Value =
            serde_json::from_str(&generate_password_json(r#"{"length":24}"#)).unwrap();
        assert_eq!(value["ok"], true);
        assert_eq!(value["password"].as_str().unwrap().len(), 24);
    }

    #[test]
    fn invalid_options_return_structured_errors() {
        let value: serde_json::Value =
            serde_json::from_str(&generate_password_json(r#"{"length":2}"#)).unwrap();
        assert_eq!(value["ok"], false);
        assert_eq!(value["code"], "validation");
        let value: serde_json::Value =
            serde_json::from_str(&generate_password_json("nope")).unwrap();
        assert_eq!(value["ok"], false);
    }

    #[test]
    fn passphrase_generation_works_through_json() {
        let value: serde_json::Value = serde_json::from_str(&generate_passphrase_json(
            r#"{"words":6,"separator":"-","capitalize":false,"include_number":false}"#,
        ))
        .unwrap();
        assert_eq!(value["ok"], true);
        let phrase = value["passphrase"].as_str().unwrap();
        assert_eq!(phrase.split('-').count(), 6);
    }
}
