//! Reproducible micro-benchmarks for the numbers quoted in the README.
//!
//! Run with:
//!
//! ```bash
//! cargo run --release --example bench -p acuye-vault
//! ```
//!
//! The KDF section compares the unlock cost of Acuye Pass (Argon2id, 64 MiB,
//! t=3, p=1) against PBKDF2-HMAC-SHA256 at the iteration counts the other
//! managers ship by default: Bitwarden 600,000 and 1Password 650,000
//! (1Password additionally mixes in a 128-bit Secret Key, which is not part of
//! this measurement because it costs no meaningful time).
//!
//! Everything here runs against this machine, so absolute numbers vary with
//! CPU. Only the ratio matters when comparing products.

use std::time::{Duration, Instant};

use acuye_core::{Item, ItemFields};
use acuye_crypto::{
    auth_verifier, derive_master_key, random_salt, unwrap_vault_key, wrap_vault_key, ExpandedKeys,
    KdfParams, SecretKey,
};
use acuye_storage::{Database, StoredItem};
use acuye_vault::{codec, Vault};
use hmac::{Hmac, Mac};
use sha2::Sha256;

const PASSWORD: &str = "correct horse battery staple";
const VAULT_ID: &str = "11111111-1111-4111-8111-111111111111";

/// PBKDF2-HMAC-SHA256 with a single 32-byte output block.
fn pbkdf2_sha256(password: &[u8], salt: &[u8], iterations: u32) -> [u8; 32] {
    let prf = |data: &[u8]| -> [u8; 32] {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(password).expect("hmac key");
        mac.update(data);
        mac.finalize().into_bytes().into()
    };

    let mut salt_block = salt.to_vec();
    salt_block.extend_from_slice(&1u32.to_be_bytes());
    let mut u = prf(&salt_block);
    let mut out = u;
    for _ in 1..iterations {
        u = prf(&u);
        for (a, b) in out.iter_mut().zip(u.iter()) {
            *a ^= *b;
        }
    }
    out
}

fn median(mut samples: Vec<Duration>) -> Duration {
    samples.sort();
    samples[samples.len() / 2]
}

fn time_it<T>(runs: usize, mut f: impl FnMut() -> T) -> Duration {
    // One warm-up run keeps allocator and page-cache effects out of the sample.
    f();
    median(
        (0..runs)
            .map(|_| {
                let start = Instant::now();
                f();
                start.elapsed()
            })
            .collect(),
    )
}

fn ms(d: Duration) -> String {
    format!("{:.1}", d.as_secs_f64() * 1_000.0)
}

fn build_items(count: usize) -> Vec<Item> {
    (0..count)
        .map(|i| {
            let mut item = Item::new(
                ItemFields::Login {
                    username: format!("user{i}@example.com"),
                    password: format!("hunter2-{i}-Xq7pLm2vRt9wZb4n"),
                    url: format!("https://site{i}.example.com/login"),
                    totp: String::new(),
                    password_changed_at: None,
                },
                format!("Site {i} account"),
            );
            item.tags = vec![if i % 3 == 0 { "work" } else { "personal" }.to_string()];
            item.notes = format!("Recovery codes stored offline. Reference {i}.");
            item
        })
        .collect()
}

struct VaultTimings {
    items: usize,
    encrypt: Duration,
    persist: Duration,
    load_decrypt: Duration,
    search: Duration,
    security_report: Duration,
}

fn measure_vault(count: usize) -> VaultTimings {
    let key = SecretKey::generate();
    let items = build_items(count);

    let mut sealed = Vec::with_capacity(count);
    let start = Instant::now();
    for item in &items {
        sealed.push((
            item.id.clone(),
            codec::encrypt_item(&key, VAULT_ID, item).expect("encrypt"),
        ));
    }
    let encrypt = start.elapsed();

    let mut db = Database::open_in_memory().expect("open db");
    let rows: Vec<StoredItem> = sealed
        .iter()
        .map(|(id, s)| StoredItem {
            id: id.clone(),
            vault_id: VAULT_ID.to_string(),
            nonce: s.nonce.clone(),
            ciphertext: s.ciphertext.clone(),
            updated_at: 1_700_000_000,
        })
        .collect();
    let start = Instant::now();
    db.upsert_items(&rows).expect("persist");
    let persist = start.elapsed();

    let start = Instant::now();
    let loaded = db.load_items(VAULT_ID).expect("load");
    let mut vault = Vault::restore(VAULT_ID, "Personal", 1_700_000_000);
    let mut decrypted = Vec::with_capacity(loaded.len());
    for row in &loaded {
        decrypted.push(codec::decrypt_item(
            &key,
            VAULT_ID,
            &row.id,
            &acuye_crypto::Sealed {
                nonce: row.nonce.clone(),
                ciphertext: row.ciphertext.clone(),
            },
        ));
    }
    let load_decrypt = start.elapsed();
    for item in decrypted {
        vault.add(item.expect("decrypt")).expect("add");
    }
    let _ = vault.summaries();

    let search = time_it(20, || vault.search("bank", None, false));
    let security_report = time_it(3, || vault.security_report());

    VaultTimings {
        items: count,
        encrypt,
        persist,
        load_decrypt,
        search,
        security_report,
    }
}

fn main() {
    println!("Acuye Pass benchmark — {}", std::env::consts::ARCH);
    println!(
        "Vault size reference: an encrypted login item is ~{} bytes on disk.\n",
        {
            let key = SecretKey::generate();
            let item = build_items(1).remove(0);
            codec::encrypt_item(&key, VAULT_ID, &item)
                .expect("encrypt")
                .ciphertext
                .len()
        }
    );

    // ---- KDF: what a single unlock actually costs -------------------------
    let salt = random_salt();
    let acuye = KdfParams::default();
    let bw_argon2 = KdfParams {
        memory_kib: 32 * 1024,
        iterations: 6,
        parallelism: 4,
    };

    let acuye_full = time_it(3, || {
        let master = derive_master_key(PASSWORD, &salt, &acuye).expect("argon2");
        let keys = ExpandedKeys::derive(&master).expect("hkdf");
        let _verifier = auth_verifier(&keys.auth_key);
        let vault_key = SecretKey::generate();
        let wrapped = wrap_vault_key(&keys.wrapping_key, &vault_key, VAULT_ID).expect("wrap");
        unwrap_vault_key(&keys.wrapping_key, VAULT_ID, &wrapped).expect("unwrap")
    });
    let acuye_kdf_only = time_it(3, || {
        derive_master_key(PASSWORD, &salt, &acuye).expect("argon2")
    });
    let bw_argon2_kdf = time_it(3, || {
        derive_master_key(PASSWORD, &salt, &bw_argon2).expect("argon2")
    });
    let pbkdf2_600k = time_it(3, || pbkdf2_sha256(PASSWORD.as_bytes(), &salt, 600_000));
    let pbkdf2_650k = time_it(3, || pbkdf2_sha256(PASSWORD.as_bytes(), &salt, 650_000));

    println!("== Unlock key derivation ==");
    println!("| Derivation | Time |");
    println!("| --- | --- |");
    println!(
        "| Acuye Pass — Argon2id 64 MiB / t=3 / p=1 (KDF only) | {} ms |",
        ms(acuye_kdf_only)
    );
    println!(
        "| Acuye Pass — full unlock (KDF + HKDF + verifier + unwrap) | {} ms |",
        ms(acuye_full)
    );
    println!(
        "| Bitwarden Argon2id option — 32 MiB / t=6 / p=4 (KDF only) | {} ms |",
        ms(bw_argon2_kdf)
    );
    println!(
        "| Bitwarden PBKDF2 default — 600,000 iterations | {} ms |",
        ms(pbkdf2_600k)
    );
    println!(
        "| 1Password PBKDF2 — 650,000 iterations | {} ms |",
        ms(pbkdf2_650k)
    );
    println!();

    // ---- Vault operations at realistic and stress sizes -------------------
    println!("== Vault operations (encrypt → write SQLite → reload + decrypt → search) ==");
    println!("| Items | Encrypt all | Persist | Reload + decrypt | Search | Security report |");
    println!("| --- | --- | --- | --- | --- | --- |");
    for count in [100usize, 1_000, 5_000, 20_000] {
        let t = measure_vault(count);
        println!(
            "| {} | {} ms | {} ms | {} ms | {} ms | {} ms |",
            t.items,
            ms(t.encrypt),
            ms(t.persist),
            ms(t.load_decrypt),
            ms(t.search),
            ms(t.security_report)
        );
    }
    println!();
    println!(
        "Search and security-report timings are medians of repeated runs on an unlocked vault."
    );
}
