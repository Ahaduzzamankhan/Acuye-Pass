//! User-controlled data portability.
//!
//! Two export paths exist:
//! * `encrypt_export` — a password protected envelope (Argon2id + XChaCha20-
//!   Poly1305) that is safe to store in cloud storage. This is the recommended
//!   path and the only one offered without an explicit warning.
//! * `to_csv` — plaintext CSV for interoperability. Callers must require an
//!   explicit acknowledgement before writing it to disk.

use acuye_core::{AcuyeError, Item, ItemFields, Result};
use acuye_crypto::{
    b64_decode, b64_encode, derive_export_key, open, random_salt, seal, verify_password_not_empty,
    KdfParams, Sealed, SecretKey,
};
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

pub const EXPORT_FORMAT: &str = "acuye-export";
pub const EXPORT_VERSION: u32 = 1;
const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedExportEnvelope {
    pub format: String,
    pub version: u32,
    pub kdf_algorithm: String,
    pub kdf_memory_kib: u32,
    pub kdf_iterations: u32,
    pub kdf_parallelism: u32,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
    pub created_at: i64,
    pub item_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedExport {
    pub items: Vec<Item>,
    pub created_at: i64,
}

/// Encrypt items into a portable JSON envelope.
pub fn encrypt_export(items: &[Item], password: &str, params: KdfParams) -> Result<String> {
    verify_password_not_empty(password)?;
    if password.chars().count() < 8 {
        return Err(AcuyeError::Validation(
            "Use at least 8 characters for the export password".into(),
        ));
    }
    params.validate()?;
    let salt = random_salt();
    let key = derive_export_key(password, &salt, &params)?;
    let mut plaintext = serde_json::to_vec(items)?;
    let sealed = seal(
        &key,
        format!("acuye:export:v{EXPORT_VERSION}").as_bytes(),
        &plaintext,
    )?;
    plaintext.zeroize();

    let envelope = EncryptedExportEnvelope {
        format: EXPORT_FORMAT.into(),
        version: EXPORT_VERSION,
        kdf_algorithm: "argon2id".into(),
        kdf_memory_kib: params.memory_kib,
        kdf_iterations: params.iterations,
        kdf_parallelism: params.parallelism,
        salt: b64_encode(&salt),
        nonce: b64_encode(&sealed.nonce),
        ciphertext: b64_encode(&sealed.ciphertext),
        created_at: acuye_core::time::now(),
        item_count: items.len(),
    };
    Ok(serde_json::to_string_pretty(&envelope)?)
}

/// Decrypt a portable export. Fails closed on wrong password or tampering.
pub fn decrypt_export(payload: &str, password: &str) -> Result<ImportedExport> {
    if payload.len() > MAX_EXPORT_BYTES {
        return Err(AcuyeError::Validation("Export file is too large".into()));
    }
    let envelope: EncryptedExportEnvelope =
        serde_json::from_str(payload).map_err(|_| AcuyeError::Format)?;
    if envelope.format != EXPORT_FORMAT {
        return Err(AcuyeError::Validation("Not an Acuye Pass export".into()));
    }
    if envelope.version != EXPORT_VERSION {
        return Err(AcuyeError::Unsupported(
            "This export was created by an unsupported version".into(),
        ));
    }
    if envelope.kdf_algorithm != "argon2id" {
        return Err(AcuyeError::Unsupported(
            "Unsupported key derivation in export".into(),
        ));
    }
    let params = KdfParams {
        memory_kib: envelope.kdf_memory_kib,
        iterations: envelope.kdf_iterations,
        parallelism: envelope.kdf_parallelism,
    };
    params.validate()?;
    let salt = b64_decode(&envelope.salt)?;
    let key = derive_export_key(password, &salt, &params)?;
    let sealed = Sealed {
        nonce: b64_decode(&envelope.nonce)?,
        ciphertext: b64_decode(&envelope.ciphertext)?,
    };
    let mut plaintext = open(
        &key,
        format!("acuye:export:v{EXPORT_VERSION}").as_bytes(),
        &sealed,
    )?;
    let items: Vec<Item> = serde_json::from_slice(&plaintext).map_err(|_| AcuyeError::Format)?;
    plaintext.zeroize();
    // `item_count` is unauthenticated envelope metadata; a mismatch means the
    // file was edited by hand or produced by something else, so fail closed
    // instead of importing a partial vault.
    if envelope.item_count != items.len() {
        return Err(AcuyeError::Format);
    }
    Ok(ImportedExport {
        items,
        created_at: envelope.created_at,
    })
}

fn csv_escape(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Plaintext CSV export. Contains secrets in the clear: the UI must ask for an
/// explicit acknowledgement before calling this.
pub fn to_csv(items: &[Item]) -> String {
    let mut out = String::from("type,name,username,password,url,notes,tags,favorite\n");
    for item in items {
        let (username, password, url) = match &item.fields {
            ItemFields::Login {
                username,
                password,
                url,
                ..
            } => (username.as_str(), password.as_str(), url.as_str()),
            _ => ("", "", ""),
        };
        let row = [
            csv_escape(item.item_type().label()),
            csv_escape(&item.title),
            csv_escape(username),
            csv_escape(password),
            csv_escape(url),
            csv_escape(&item.notes),
            csv_escape(&item.tags.join(";")),
            if item.favorite { "true" } else { "false" }.to_string(),
        ];
        out.push_str(&row.join(","));
        out.push('\n');
    }
    out
}

/// Strength-checked export password helper used by the UI.
pub fn validate_export_password(password: &str) -> Result<()> {
    if password.chars().count() < 8 {
        return Err(AcuyeError::Validation(
            "Use at least 8 characters for the export password".into(),
        ));
    }
    Ok(())
}

/// A randomly generated export password (for users without a password manager
/// handy), using the OS CSPRNG.
pub fn suggest_export_password() -> Result<String> {
    let options = acuye_generator::PasswordOptions {
        length: 32,
        ..Default::default()
    };
    acuye_generator::generate_password(&options)
}

/// Keep the compiler honest about the unused key helper on non-test builds.
#[allow(dead_code)]
fn _assert_key_type(_: &SecretKey) {}

#[cfg(test)]
mod tests {
    use super::*;
    use acuye_generator::PasswordOptions;
    use acuye_vault::Vault;

    fn test_kdf() -> KdfParams {
        KdfParams {
            memory_kib: 19_456,
            iterations: 2,
            parallelism: 1,
        }
    }

    fn items() -> Vec<Item> {
        let mut vault = Vault::new("Personal");
        vault
            .add(Item::new(
                ItemFields::Login {
                    username: "ada".into(),
                    password: "secret-value".into(),
                    url: "https://example.com".into(),
                    totp: String::new(),
                    password_changed_at: None,
                },
                "Example, Inc.",
            ))
            .unwrap();
        let mut note = Item::new(ItemFields::SecureNote {}, "Note \"quoted\"");
        note.notes = "line one\nline two".into();
        vault.add(note).unwrap();
        vault.items
    }

    #[test]
    fn encrypted_export_roundtrips() {
        let source = items();
        let payload = encrypt_export(&source, "export-password-123", test_kdf()).unwrap();
        assert!(!payload.contains("secret-value"));
        assert!(!payload.contains("Example"));
        let restored = decrypt_export(&payload, "export-password-123").unwrap();
        assert_eq!(restored.items.len(), 2);
        assert_eq!(restored.items[0].title, "Example, Inc.");
    }

    #[test]
    fn wrong_password_and_tampering_are_rejected() {
        let payload = encrypt_export(&items(), "export-password-123", test_kdf()).unwrap();
        assert!(decrypt_export(&payload, "wrong-password-123").is_err());

        let mut envelope: EncryptedExportEnvelope = serde_json::from_str(&payload).unwrap();
        let mut bytes = b64_decode(&envelope.ciphertext).unwrap();
        bytes[0] ^= 0xff;
        envelope.ciphertext = b64_encode(&bytes);
        let tampered = serde_json::to_string(&envelope).unwrap();
        assert!(decrypt_export(&tampered, "export-password-123").is_err());
    }

    #[test]
    fn unknown_format_or_version_is_rejected() {
        let mut envelope: EncryptedExportEnvelope = serde_json::from_str(
            &encrypt_export(&items(), "export-password-123", test_kdf()).unwrap(),
        )
        .unwrap();
        envelope.version = 99;
        assert!(decrypt_export(
            &serde_json::to_string(&envelope).unwrap(),
            "export-password-123"
        )
        .is_err());

        envelope.version = 1;
        envelope.format = "other".into();
        assert!(decrypt_export(
            &serde_json::to_string(&envelope).unwrap(),
            "export-password-123"
        )
        .is_err());
    }

    #[test]
    fn mismatched_item_count_is_rejected() {
        let payload = encrypt_export(&items(), "export-password-123", test_kdf()).unwrap();
        let mut envelope: EncryptedExportEnvelope = serde_json::from_str(&payload).unwrap();
        envelope.item_count = 5;
        assert!(decrypt_export(
            &serde_json::to_string(&envelope).unwrap(),
            "export-password-123"
        )
        .is_err());
    }

    #[test]
    fn short_export_password_rejected() {
        assert!(encrypt_export(&items(), "short", test_kdf()).is_err());
        assert!(encrypt_export(&items(), "", test_kdf()).is_err());
    }

    #[test]
    fn csv_escapes_special_characters() {
        let csv = to_csv(&items());
        assert!(csv.starts_with("type,name,username,password,url,notes,tags,favorite"));
        assert!(csv.contains("\"Example, Inc.\""));
        assert!(csv.contains("\"Note \"\"quoted\"\"\""));
        assert!(csv.contains("secret-value"));
    }

    #[test]
    fn suggested_export_password_is_strong() {
        let password = suggest_export_password().unwrap();
        assert_eq!(password.chars().count(), 32);
        let strength = acuye_generator::strength::evaluate(&password);
        assert_eq!(strength.score, 4);
        let options = PasswordOptions::default();
        assert!(acuye_generator::generate_password(&options).is_ok());
    }
}
