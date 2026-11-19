# Security model

## Threat model

Acuye Pass protects vault contents at rest against someone who obtains the
SQLite file, a backup, or an exported encrypted archive, and who does not know
the master password. It does not defend a machine already compromised by
malware with access to the running process, the clipboard, or the screen.

## Cryptography

- **KDF:** Argon2id, 64 MiB memory, 3 iterations, 1 lane, per-account random
  16-byte salt. Parameters are stored with the account so future increases can
  be migrated.
- **Key expansion:** HKDF-SHA256 with separate `auth` and `wrap` domain labels.
- **Password verification:** HMAC-SHA256 verifier compared in constant time
  before unwrapping the vault key.
- **Vault key:** 32 random bytes, wrapped with XChaCha20-Poly1305 bound to the
  vault id; never derived from the master password.
- **Items:** XChaCha20-Poly1305, random 24-byte nonce per write, AAD binds the
  vault id and item id. Tampering fails closed.
- **Rotation:** changing the master password generates a new salt, new derived
  keys and a new vault key, and re-encrypts every item in one transaction.
- **Memory:** keys use zeroizing wrappers; decrypted items live only in the Rust
  process while unlocked and are dropped on lock.

## What the database contains

Usernames, KDF parameters, salts, verifiers and ciphertext. It never contains
titles, usernames inside items, passwords, URLs, notes, card numbers or TOTP
secrets in plaintext. A regression test asserts this.

## Updates

Updates are fetched only from the official GitHub repository
`Ahaduzzamankhan/Acuye-Pass`. Installer URLs must live under that repository's
release download path; redirects are disabled. The installer must verify against
the embedded minisign/Tauri public key. Downgrades are rejected, and installers
are launched only after explicit user action. See [UPDATER.md](UPDATER.md).

## Network behaviour

Outbound requests are limited to: the update release API/asset host, and
favicon fetches you trigger from an item (HTTPS only, no redirects, 256 KiB cap,
raster images only, public IPs only). There is no telemetry, crash reporting or
analytics endpoint.

## SSRF protections

Website opening and favicon fetching validate the URL scheme, host and resolved
address. Loopback, link-local, private, multicast and unspecified addresses are
rejected. See `acuye-platform`.

## Reporting a vulnerability

Email the maintainers privately rather than opening a public issue. Include the
version, reproduction steps and impact. Please allow reasonable time for a fix
before disclosure.

## Known limitations

- No independent security audit has been performed yet.
- Clipboard contents are cleared after a configurable delay, but other
  applications can still read the clipboard before that.
- Windows Defender/AV heuristics may flag freshly built unsigned development
  binaries.
- The browser preview (`DemoBackend`) performs no encryption by design; it is
  developer tooling, not a shipped security boundary.
