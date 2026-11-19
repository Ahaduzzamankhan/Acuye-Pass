//! Cryptography for Acuye Pass.
//!
//! Design (see ARCHITECTURE.md):
//!
//! ```text
//! master password
//!   └─ Argon2id(password, random 16-byte salt, params)  -> master key (32B)
//!        └─ HKDF-SHA256(domain "acuye/v1/auth")         -> auth key
//!        │     └─ HMAC-SHA256(label)                     -> stored verifier
//!        └─ HKDF-SHA256(domain "acuye/v1/vault-wrap")   -> wrapping key
//!              └─ XChaCha20-Poly1305                       -> wrapped vault key
//!                                                    vault key (32B, random)
//!                                                      └─ XChaCha20-Poly1305 per item
//! ```
//!
//! Only reviewed primitives from RustCrypto are used; nothing here is custom
//! cryptography. All key material is zeroized on drop.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use subtle::ConstantTimeEq;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use acuye_core::{AcuyeError, Result};

pub const KEY_LEN: usize = 32;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 24;

pub const DEFAULT_KDF_MEMORY_KIB: u32 = 65_536; // 64 MiB
pub const DEFAULT_KDF_ITERATIONS: u32 = 3;
pub const DEFAULT_KDF_PARALLELISM: u32 = 1;
pub const MIN_KDF_MEMORY_KIB: u32 = 19_456;
pub const MAX_KDF_MEMORY_KIB: u32 = 1_048_576;
pub const MIN_KDF_ITERATIONS: u32 = 1;
pub const MAX_KDF_ITERATIONS: u32 = 16;
pub const MAX_KDF_PARALLELISM: u32 = 8;

const AUTH_DOMAIN: &[u8] = b"acuye/v1/auth";
const WRAP_DOMAIN: &[u8] = b"acuye/v1/vault-wrap";
const EXPORT_DOMAIN: &[u8] = b"acuye/v1/export";
const VERIFIER_LABEL: &[u8] = b"acuye/auth-verifier/v1";

/// Argon2id parameters persisted with the account so future versions can
/// migrate parameters without breaking existing vaults.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdfParams {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            memory_kib: DEFAULT_KDF_MEMORY_KIB,
            iterations: DEFAULT_KDF_ITERATIONS,
            parallelism: DEFAULT_KDF_PARALLELISM,
        }
    }
}

impl KdfParams {
    pub fn validate(&self) -> Result<()> {
        if self.memory_kib < MIN_KDF_MEMORY_KIB || self.memory_kib > MAX_KDF_MEMORY_KIB {
            return Err(AcuyeError::Validation("Unsupported KDF memory cost".into()));
        }
        if self.iterations < MIN_KDF_ITERATIONS || self.iterations > MAX_KDF_ITERATIONS {
            return Err(AcuyeError::Validation(
                "Unsupported KDF iteration count".into(),
            ));
        }
        if self.parallelism == 0 || self.parallelism > MAX_KDF_PARALLELISM {
            return Err(AcuyeError::Validation("Unsupported KDF parallelism".into()));
        }
        Ok(())
    }

    fn argon2(&self) -> Result<Argon2<'static>> {
        self.validate()?;
        let params = Params::new(
            self.memory_kib,
            self.iterations,
            self.parallelism,
            Some(KEY_LEN),
        )
        .map_err(|_| AcuyeError::Crypto)?;
        Argon2::new_with_secret(
            b"acuye-pass-kdf-v1",
            Algorithm::Argon2id,
            Version::V0x13,
            params,
        )
        .map_err(|_| AcuyeError::Crypto)
    }
}

/// 32-byte key material that zeroizes on drop.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SecretKey {
    bytes: [u8; KEY_LEN],
}

impl std::fmt::Debug for SecretKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretKey(REDACTED)")
    }
}

impl SecretKey {
    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self {
        Self { bytes }
    }

    /// Generate a fresh random key from the OS CSPRNG.
    pub fn generate() -> Self {
        let mut bytes = [0u8; KEY_LEN];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        Self { bytes }
    }

    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.bytes
    }

    pub fn to_vec(&self) -> Vec<u8> {
        self.bytes.to_vec()
    }

    fn hkdf_expand(&self, domain: &[u8]) -> Result<SecretKey> {
        let hk = Hkdf::<Sha256>::new(None, &self.bytes);
        let mut out = [0u8; KEY_LEN];
        hk.expand(domain, &mut out)
            .map_err(|_| AcuyeError::Crypto)?;
        Ok(SecretKey { bytes: out })
    }
}

/// Keys derived from the master key. Never persisted.
pub struct ExpandedKeys {
    pub auth_key: SecretKey,
    pub wrapping_key: SecretKey,
}

impl ExpandedKeys {
    pub fn derive(master: &SecretKey) -> Result<Self> {
        Ok(Self {
            auth_key: master.hkdf_expand(AUTH_DOMAIN)?,
            wrapping_key: master.hkdf_expand(WRAP_DOMAIN)?,
        })
    }
}

/// Random salt for Argon2id.
pub fn random_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    salt
}

/// Derive the master key from the master password.
pub fn derive_master_key(password: &str, salt: &[u8], params: &KdfParams) -> Result<SecretKey> {
    if password.is_empty() {
        return Err(AcuyeError::Validation("Password cannot be empty".into()));
    }
    if salt.len() < SALT_LEN {
        return Err(AcuyeError::Validation("Salt is too short".into()));
    }
    let argon = params.argon2()?;
    let mut out = [0u8; KEY_LEN];
    // Password bytes are copied into zeroizing memory immediately.
    let password_bytes = Zeroizing::new(password.as_bytes().to_vec());
    argon
        .hash_password_into(&password_bytes, salt, &mut out)
        .map_err(|_| AcuyeError::Crypto)?;
    Ok(SecretKey { bytes: out })
}

/// Authentication verifier stored on disk. Reveals nothing about the password
/// beyond "the derived key matches" during a constant-time comparison.
pub fn auth_verifier(auth_key: &SecretKey) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(auth_key.as_bytes())
        .expect("HMAC accepts any key length");
    mac.update(VERIFIER_LABEL);
    let out = mac.finalize().into_bytes();
    let mut verifier = [0u8; 32];
    verifier.copy_from_slice(&out);
    verifier
}

pub fn verifiers_match(stored: &[u8], candidate: &[u8]) -> Result<bool> {
    if stored.len() != candidate.len() || stored.len() != 32 {
        return Ok(false);
    }
    Ok(stored.ct_eq(candidate).into())
}

/// AEAD ciphertext bundle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sealed {
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

/// Encrypt with XChaCha20-Poly1305 using a random 24-byte nonce.
/// `aad` binds the ciphertext to its context (vault id, item id, ...).
pub fn seal(key: &SecretKey, aad: &[u8], plaintext: &[u8]) -> Result<Sealed> {
    let cipher =
        XChaCha20Poly1305::new_from_slice(key.as_bytes()).map_err(|_| AcuyeError::Crypto)?;
    let mut nonce = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| AcuyeError::Crypto)?;
    Ok(Sealed {
        nonce: nonce.to_vec(),
        ciphertext,
    })
}

/// Decrypt and authenticate. Any tampering (including a swapped AAD) fails.
pub fn open(key: &SecretKey, aad: &[u8], sealed: &Sealed) -> Result<Vec<u8>> {
    if sealed.nonce.len() != NONCE_LEN {
        return Err(AcuyeError::Crypto);
    }
    let cipher =
        XChaCha20Poly1305::new_from_slice(key.as_bytes()).map_err(|_| AcuyeError::Crypto)?;
    cipher
        .decrypt(
            XNonce::from_slice(&sealed.nonce),
            Payload {
                msg: &sealed.ciphertext,
                aad,
            },
        )
        .map_err(|_| AcuyeError::Crypto)
}

/// Wrap (encrypt) a vault key under the master key's wrapping key.
pub fn wrap_vault_key(
    wrapping_key: &SecretKey,
    vault_key: &SecretKey,
    vault_id: &str,
) -> Result<Sealed> {
    seal(
        wrapping_key,
        format!("acuye:vault-key:{vault_id}").as_bytes(),
        vault_key.as_bytes(),
    )
}

/// Unwrap the vault key. Fails closed on tampering or wrong password.
pub fn unwrap_vault_key(
    wrapping_key: &SecretKey,
    vault_id: &str,
    sealed: &Sealed,
) -> Result<SecretKey> {
    let bytes = open(
        wrapping_key,
        format!("acuye:vault-key:{vault_id}").as_bytes(),
        sealed,
    )?;
    if bytes.len() != KEY_LEN {
        return Err(AcuyeError::Crypto);
    }
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&bytes);
    Ok(SecretKey { bytes: key })
}

/// Key derived from an export password, domain separated from login keys.
pub fn derive_export_key(password: &str, salt: &[u8], params: &KdfParams) -> Result<SecretKey> {
    let master = derive_master_key(password, salt, params)?;
    master.hkdf_expand(EXPORT_DOMAIN)
}

/// Reject empty passwords early so key derivation is never attempted with
/// empty input.
pub fn verify_password_not_empty(password: &str) -> Result<()> {
    if password.is_empty() {
        return Err(AcuyeError::Validation("Password cannot be empty".into()));
    }
    Ok(())
}

/// Cryptographically secure random bytes (OS CSPRNG).
pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut buf = vec![0u8; len];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    buf
}

/// Uniform random index in `0..bound` without modulo bias.
pub fn random_below(bound: u32) -> u32 {
    assert!(bound > 0, "bound must be positive");
    let zone = (u32::MAX / bound) * bound;
    loop {
        let mut buf = [0u8; 4];
        rand::rngs::OsRng.fill_bytes(&mut buf);
        let value = u32::from_le_bytes(buf);
        if value < zone {
            return value % bound;
        }
    }
}

/// URL-safe base64 without padding, used for serialized signatures and salts.
pub fn b64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD_NO_PAD.encode(data)
}

pub fn b64_decode(data: &str) -> Result<Vec<u8>> {
    use base64::Engine;
    let trimmed = data.trim();
    base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(trimmed)
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(trimmed))
        .map_err(|_| AcuyeError::Validation("Invalid base64 data".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Deliberately fast parameters for unit tests only. Production defaults
    // (64 MiB / 3 iterations) are exercised in one dedicated test.
    fn test_params() -> KdfParams {
        KdfParams {
            memory_kib: 19_456,
            iterations: 2,
            parallelism: 1,
        }
    }

    #[test]
    fn derives_stable_key_for_same_password_and_salt() {
        let salt = random_salt();
        let a = derive_master_key("correct horse battery staple", &salt, &test_params()).unwrap();
        let b = derive_master_key("correct horse battery staple", &salt, &test_params()).unwrap();
        assert_eq!(a.as_bytes(), b.as_bytes());
    }

    #[test]
    fn different_salt_or_password_changes_key() {
        let salt = random_salt();
        let other_salt = random_salt();
        let a = derive_master_key("password-one-long", &salt, &test_params()).unwrap();
        let b = derive_master_key("password-one-long", &other_salt, &test_params()).unwrap();
        let c = derive_master_key("password-two-long", &salt, &test_params()).unwrap();
        assert_ne!(a.as_bytes(), b.as_bytes());
        assert_ne!(a.as_bytes(), c.as_bytes());
    }

    #[test]
    fn verifier_matches_only_for_correct_password() {
        let salt = random_salt();
        let master = derive_master_key("a-very-long-password", &salt, &test_params()).unwrap();
        let keys = ExpandedKeys::derive(&master).unwrap();
        let stored = auth_verifier(&keys.auth_key);

        let wrong = derive_master_key("a-very-long-password!", &salt, &test_params()).unwrap();
        let wrong_keys = ExpandedKeys::derive(&wrong).unwrap();
        let candidate = auth_verifier(&wrong_keys.auth_key);
        assert!(!verifiers_match(&stored, &candidate).unwrap());
        assert!(verifiers_match(&stored, &stored).unwrap());
        assert!(!verifiers_match(&stored, &[0u8; 31]).unwrap());
    }

    #[test]
    fn seal_and_open_roundtrip_with_aad_binding() {
        let key = SecretKey::generate();
        let sealed = seal(&key, b"vault:123", b"attack at dawn").unwrap();
        assert_ne!(sealed.ciphertext, b"attack at dawn");
        let plain = open(&key, b"vault:123", &sealed).unwrap();
        assert_eq!(plain, b"attack at dawn");
        assert!(open(&key, b"vault:124", &sealed).is_err());
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let key = SecretKey::generate();
        let mut sealed = seal(&key, b"aad", b"secret").unwrap();
        let last = sealed.ciphertext.len() - 1;
        sealed.ciphertext[last] ^= 0x01;
        assert!(open(&key, b"aad", &sealed).is_err());

        let mut sealed = seal(&key, b"aad", b"secret").unwrap();
        sealed.nonce[0] ^= 0xff;
        assert!(open(&key, b"aad", &sealed).is_err());
    }

    #[test]
    fn wrong_key_cannot_open() {
        let key = SecretKey::generate();
        let other = SecretKey::generate();
        let sealed = seal(&key, b"", b"data").unwrap();
        assert!(open(&other, b"", &sealed).is_err());
    }

    #[test]
    fn vault_key_wrap_roundtrip_and_wrong_password_rejected() {
        let vault_key = SecretKey::generate();
        let salt = random_salt();
        let master = derive_master_key("master-password-1", &salt, &test_params()).unwrap();
        let keys = ExpandedKeys::derive(&master).unwrap();
        let wrapped = wrap_vault_key(&keys.wrapping_key, &vault_key, "vault-a").unwrap();
        let unwrapped = unwrap_vault_key(&keys.wrapping_key, "vault-a", &wrapped).unwrap();
        assert_eq!(unwrapped.as_bytes(), vault_key.as_bytes());
        assert!(unwrap_vault_key(&keys.wrapping_key, "vault-b", &wrapped).is_err());

        let wrong = derive_master_key("master-password-2", &salt, &test_params()).unwrap();
        let wrong_keys = ExpandedKeys::derive(&wrong).unwrap();
        assert!(unwrap_vault_key(&wrong_keys.wrapping_key, "vault-a", &wrapped).is_err());
    }

    #[test]
    fn kdf_parameters_are_bounded() {
        let weak = KdfParams {
            memory_kib: 1024,
            iterations: 1,
            parallelism: 1,
        };
        assert!(weak.validate().is_err());
        let ok = KdfParams::default();
        assert!(ok.validate().is_ok());
        let zero_parallel = KdfParams {
            parallelism: 0,
            ..Default::default()
        };
        assert!(zero_parallel.validate().is_err());
    }

    #[test]
    fn production_parameters_derive_a_key() {
        let salt = random_salt();
        let key =
            derive_master_key("production-parameters-test", &salt, &KdfParams::default()).unwrap();
        assert_eq!(key.as_bytes().len(), KEY_LEN);
    }

    #[test]
    fn random_indices_stay_in_range_and_cover_bounds() {
        let mut seen = [false; 16];
        for _ in 0..1_000 {
            let v = random_below(16);
            assert!(v < 16);
            seen[v as usize] = true;
        }
        assert!(seen.iter().all(|&s| s));
    }

    #[test]
    fn base64_roundtrip() {
        let data = random_bytes(48);
        assert_eq!(b64_decode(&b64_encode(&data)).unwrap(), data);
        assert!(b64_decode("not base64!!").is_err());
    }

    #[test]
    fn debug_never_prints_key_bytes() {
        let key = SecretKey::generate();
        let rendered = format!("{key:?}");
        assert!(rendered.contains("REDACTED"));
        assert!(!rendered.contains(&format!("{:?}", key.as_bytes())));
    }
}
