# Security model

## Threat model

Acuye Pass protects vault contents at rest against someone who obtains the
SQLite file, a backup, or an exported encrypted archive, and who does not know
the master password. It also protects against a stolen LAN sync bundle, since
those carry ciphertext only.

It does not defend a machine already compromised by malware with access to the
running process, the clipboard, or the screen while the vault is unlocked.

## Cryptography

- **KDF:** Argon2id, 64 MiB memory, 3 iterations, 1 lane, per-account random
  16-byte salt. Parameters are stored with the account so future increases can
  be migrated. Bounds are enforced (19 MiB–1 GiB memory, 1–16 iterations,
  1–8 lanes) so a tampered database cannot request absurd work.
- **Key expansion:** HKDF-SHA256 with separate `auth` and `wrap` domain labels.
- **Password verification:** HMAC-SHA256 verifier compared in constant time
  before unwrapping the vault key, so a wrong password never reaches the
  unwrapping step.
- **Vault key:** 32 random bytes, wrapped with XChaCha20-Poly1305 bound to the
  vault id; never derived from the master password.
- **Items:** XChaCha20-Poly1305, random 24-byte nonce per write, AAD binds the
  vault id and item id. Tampering, truncation or ciphertext swapping fails closed.
- **Rotation:** changing the master password generates a new salt, new derived
  keys and a new vault key, and re-encrypts every item in one transaction.
- **Exports:** encrypted exports derive a separate key with an `export` domain
  label from a user-supplied export password, so an export password never
  unlocks the vault and vice versa.
- **Memory:** keys use zeroizing wrappers; decrypted items live only in the Rust
  process while unlocked and are dropped on lock.
- **Randomness:** everything comes from the OS CSPRNG. No `thread_rng`,
  `Math.random` or modulo-biased index selection.

Only reviewed RustCrypto primitives are used. Nothing here is custom
cryptography, and no cryptography is implemented in TypeScript.

## What the database contains

Usernames, KDF parameters, salts, verifiers, settings, LAN peer records and
ciphertext. It never contains titles, usernames inside items, passwords, URLs,
notes, card numbers, TOTP secrets or secret-manager values in plaintext. A
regression test asserts this.

The database file is the security boundary. Deleting the WAL sidecar does not
reveal items; a torn write surfaces as an integrity failure, not as plaintext.

## Authentication surface

There is no server, therefore no login endpoint, no session token, no password
reset and no account enumeration surface. The only authentication that exists is
local:

1. Password → Argon2id → verifier comparison.
2. Optional LAN pairing: Noise XX handshake plus a vault-key-derived proof.

Failure is uniform: the unlock screen reports "incorrect username or password"
without distinguishing which part was wrong.

## Updates

Updates are fetched only from the official GitHub repository
`Ahaduzzamankhan/Acuye-Pass`. Installer URLs must live under that repository's
release download path; redirects are disabled. The installer must verify against
the embedded minisign/Tauri public key. Downgrades are rejected, and installers
are launched only after explicit user action. See [UPDATER.md](UPDATER.md).

## Network behaviour

Outbound requests are limited to:

1. **Update checks and downloads** — `api.github.com` release metadata and
   `github.com` release assets, only when you check manually or automatic checks
   are enabled.
2. **Favicons** — only when you explicitly request one for an item: HTTPS only,
   no redirects, 256 KiB cap, raster images only, public IPs only, cached locally.
   No third-party favicon aggregation service is used.
3. **Breach checks** — only when you run a scan. The password is SHA-1 hashed
   inside the process and only the first five hex characters are sent to the
   Pwned Passwords range API. Matching happens locally, and an unreachable API is
   reported as `unknown`, never as "not breached".
4. **LAN pairing and sync** — only with peers you approve, only on your network.

There is no telemetry, crash reporting or analytics endpoint.

## SSRF and address validation

Website opening and favicon fetching validate the URL scheme, host and resolved
address. Loopback, link-local, private, multicast and unspecified addresses are
rejected, redirects are not followed, and response size and content type are
capped. See `acuye-platform`.

## LAN sync trust model

- A device identity is derived from the vault key with HKDF, so it is stable for
  a vault and unique per vault. It is never stored as a standalone secret.
- Pairing is a signed, short-lived (5 minute) offer carried in a QR code holding
  the device's public keys, LAN address and a one-time token.
- The session handshake is `Noise_XX_25519_ChaChaPoly_BLAKE2s`. Each side proves
  knowledge of the vault key over the handshake hash, so pairing a device that
  cannot prove vault possession fails.
- Approved peers are stored locally and can be revoked or forgotten at any time.
  A revoked device cannot sync.
- Sync bundles are sealed with the vault key and only contain encrypted items;
  the vault key itself is never transmitted.
- Frames are capped at 1 MiB and addresses are validated before dialling, which
  keeps the pairing path from being usable as a relay.

## Clipboard

Copied secrets are cleared after a configurable delay. Other applications can
still read the clipboard before that fires — the timer reduces the window, it
does not close it.

## Audit status

**No independent security audit has been performed.** The design is documented,
the primitives are standard, and the test suite covers KDF, AEAD, verifier,
rotation, migrations, import/export, protocol, sync, updater selection and URL
validation. That is not a substitute for external review, and the README says so.

## Reporting a vulnerability

Email the maintainers privately rather than opening a public issue. Include the
version, reproduction steps and impact. Please allow reasonable time for a fix
before disclosure.

## Known limitations

- No independent security audit yet.
- Clipboard contents are readable by other applications until the clear timer fires.
- Screenshots, screen recording and memory inspection of an unlocked vault are
  outside the threat model.
- Windows Defender/AV heuristics may flag freshly built unsigned development
  binaries.
- The browser preview (`DemoBackend`) performs no encryption by design; it is
  developer tooling, not a shipped security boundary.
- A forgotten master password cannot be recovered. Backups are the only safety
  net, and they are encrypted with the same password.
