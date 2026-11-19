//! End-to-end backend workflow against a real SQLite file.
//!
//! The desktop UI cannot be driven with WebDriver in the CI Linux container, so
//! this test exercises the same command path the UI uses: create an account,
//! persist an encrypted item, reopen the database (application restart), unlock,
//! read the item back, rotate the master password and confirm failure modes.

use std::fs;
use std::path::PathBuf;

use acuye_auth::AuthService;
use acuye_core::{Item, ItemFields};
use acuye_crypto::KdfParams;
use acuye_storage::Database;

const PASSWORD: &str = "correct-horse-battery-staple-42";
const NEW_PASSWORD: &str = "an-even-better-passphrase-99";

fn temp_db_path() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("acuye-workflow-{}", uuid_like()));
    fs::create_dir_all(&dir).unwrap();
    dir.join("acuye.db")
}

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{}-{}", std::process::id(), nanos)
}

fn service(path: &PathBuf) -> AuthService {
    // Test-only KDF parameters keep the workflow fast while still exercising
    // the real derivation code path and stored parameters.
    AuthService::new(
        Database::open(path).unwrap(),
        KdfParams {
            memory_kib: 19_456,
            iterations: 2,
            parallelism: 1,
        },
    )
}

fn login(title: &str, username: &str, password: &str) -> Item {
    Item::new(
        ItemFields::Login {
            username: username.into(),
            password: password.into(),
            url: "https://example.com".into(),
            totp: String::new(),
            password_changed_at: None,
        },
        title,
    )
}

#[test]
fn full_lifecycle_survives_restart_and_password_rotation() {
    let path = temp_db_path();

    let item_id;
    {
        let auth = service(&path);
        assert!(!auth.has_account().unwrap());
        let mut unlocked = auth.create_account("ada", PASSWORD).unwrap();
        let item = unlocked
            .vault
            .add(login("Example", "ada@example.com", "server-password-123"))
            .unwrap();
        item_id = item.id.clone();
        auth.db()
            .upsert_item(&unlocked.encrypt_item(&item).unwrap())
            .unwrap();
    }

    // Simulate an application restart: everything is reloaded from disk.
    {
        let auth = service(&path);
        assert!(auth.has_account().unwrap());
        assert!(auth.unlock("ada", "definitely-the-wrong-password").is_err());

        let unlocked = auth.unlock("ada", PASSWORD).unwrap();
        assert_eq!(unlocked.vault.items.len(), 1);
        let item = unlocked.vault.get(&item_id).unwrap();
        match &item.fields {
            ItemFields::Login { password, .. } => assert_eq!(password, "server-password-123"),
            other => panic!("unexpected item kind: {other:?}"),
        }
        assert_eq!(auth.account_summary().unwrap().unwrap().username, "ada");
    }

    // The ciphertext on disk must never contain the plaintext secrets.
    let raw = fs::read(&path).unwrap();
    let haystack = String::from_utf8_lossy(&raw);
    assert!(!haystack.contains("server-password-123"));
    assert!(!haystack.contains("ada@example.com"));

    // Rotation re-encrypts the vault; the old password stops working.
    {
        let mut auth = service(&path);
        let rotated = auth.change_master_password(PASSWORD, NEW_PASSWORD).unwrap();
        assert_eq!(rotated.vault.get(&item_id).unwrap().title, "Example");
    }
    {
        let auth = service(&path);
        assert!(auth.unlock("ada", PASSWORD).is_err());
        let unlocked = auth.unlock("ada", NEW_PASSWORD).unwrap();
        assert_eq!(unlocked.vault.items.len(), 1);
    }

    let _ = fs::remove_file(&path);
    let _ = fs::remove_dir(path.parent().unwrap());
}
