# Acuye Pass

A local-first, privacy-focused password manager for Windows, written in Rust and
TypeScript. Your vault is a single encrypted SQLite file on your own disk. There
is no account server, no telemetry, no analytics and no third-party favicon
service.

> **Status: pre-1.0.** The Windows desktop app is functionally complete but has
> not been independently audited. Do not make it the only copy of credentials
> you cannot afford to lose. A forgotten master password cannot be recovered
> unless you enrolled the optional recovery code (or the three security
> questions) before losing it — there is no server-side reset.

---

## Speed

Acuye Pass has no server to talk to, so almost every operation is bound by local
CPU rather than by a network round trip. The numbers below were produced by the
benchmark that ships with this repository
([`crates/acuye-vault/examples/bench.rs`](crates/acuye-vault/examples/bench.rs))
on an x86_64 Linux VM, release build, median of repeated runs:

```bash
cargo run --release --example bench -p acuye-vault
```

### Unlock cost compared with the other managers' key derivation

Unlocking any password manager is dominated by one deliberately slow key
derivation. Acuye Pass uses memory-hard Argon2id; Bitwarden and 1Password use
PBKDF2-HMAC-SHA256 by default. Measured on the same machine:

| Derivation | Time |
| --- | --- |
| **Acuye Pass** — Argon2id, 64 MiB, t=3, p=1 (KDF only) | **~245 ms** |
| **Acuye Pass** — full unlock (KDF + HKDF + verifier + vault-key unwrap) | **~245 ms** |
| Bitwarden (Argon2id option) — 32 MiB, t=6, p=4 | ~215 ms |
| Bitwarden (PBKDF2 default) — 600,000 iterations | ~181 ms |
| 1Password — PBKDF2, 650,000 iterations | ~196 ms |

Two things to read from this table:

1. **Acuye Pass is not slower to unlock than the products it is measured
   against.** All four derivations land within about 1.35× of each other, and
   Acuye gets memory-hard Argon2id for that price, which is the strongest of the
   three against GPU and ASIC cracking.
2. **Everything after the KDF is effectively free.** The full unlock — KDF,
   HKDF domain separation, constant-time verifier comparison and vault-key
   unwrapping — costs the same as the KDF alone (the small difference between the
   two rows is run-to-run noise). There is no second network call hiding in the
   unlock path.

Numbers drift by roughly ±10% between runs, so the values are rounded. The
ordering in this table is stable; the exact milliseconds depend on your CPU.

### What the vault does once it is open

| Items | Encrypt all | Persist to SQLite | Reload + decrypt all | Search | Security report |
| --- | --- | --- | --- | --- | --- |
| 100 | 0.7 ms | 0.3 ms | 0.9 ms | <0.1 ms | 0.1 ms |
| 1,000 | 6.2 ms | 3 ms | 9 ms | 0.5 ms | 1.0 ms |
| 5,000 | 31 ms | 16 ms | 51 ms | 2.5 ms | 5.3 ms |
| 20,000 | 130 ms | 66 ms | 193 ms | 11 ms | 26 ms |

An encrypted login item is ~390 bytes on disk. A typical vault of 1,000 items
opens, decrypts and becomes searchable in roughly 255 ms end to end; a 20,000
item vault in roughly 440 ms. Search re-runs on every keystroke in under 3 ms
for 5,000 items, so results keep up with typing.

### Where the speed gap actually comes from

The interesting difference is not the cryptography — it is the absence of
everything around it:

| | **Acuye Pass** | **Bitwarden / 1Password** |
| --- | --- | --- |
| Unlock | Argon2id + local decrypt only | KDF + authenticate against the account server + fetch/sync vault |
| Network on unlock | **None** | HTTPS round trip to the vendor's cloud (or your server) |
| Vault storage | Local SQLite, WAL mode, in-process | Server-side encrypted blobs, cached locally |
| Search | In-memory over decrypted items in the same process | In the app/extension, after cache hydration |
| Browser integration | Optional Chrome extension; content script fills a form when exactly one login matches | Extension injects scripts and messages the native app per fill |
| Viewing an item | Rust function call | Depending on product: cached, or a round trip for attachments/sharing |

Those extra hops are what you feel as "waiting for the password manager".
They are also exactly what buys multi-device sync, sharing, passkeys and
automatic autofill — features this app only partly has (an optional
popup-triggered extension fills a page when you ask it to). The trade is
deliberate: Acuye Pass is fast because it does one thing locally.

> **Honesty note.** The Acuye Pass rows are measured. The Bitwarden and 1Password
> *KDF* rows are equivalent local work measured on the same machine (same
> iteration counts those products ship by default). Their *network* overhead is
> **not measured here** — no Bitwarden or 1Password account or app was run for
> this table, and the real cost depends on your latency to their servers. Treat
> the last table as architecture, not as a benchmark result. See
> [benchmark.md](benchmark.md) for the full product comparison.

---

## Security

### The model in one paragraph

The master password is stretched with Argon2id into a master key. HKDF-SHA256
splits that key into an authentication key and a wrapping key. The authentication
key produces an HMAC verifier that is compared in constant time *before* any
vault key is unwrapped. The wrapping key unwraps a random 32-byte vault key,
which never derives from the password and is itself bound to the vault id. Every
item is encrypted with XChaCha20-Poly1305 under a fresh 24-byte nonce, with the
vault id and item id as associated data, so ciphertexts cannot be swapped,
moved, or tampered with without failing closed.

### Primitives

| Stage | Choice |
| --- | --- |
| KDF | Argon2id, 64 MiB memory, 3 iterations, 1 lane, per-account random 16-byte salt |
| Key expansion | HKDF-SHA256 with separate `auth` and `vault-wrap` domain labels |
| Password check | HMAC-SHA256 verifier, constant-time comparison, before key unwrap |
| Vault key | 32 random bytes, wrapped with XChaCha20-Poly1305 and bound to the vault id |
| Items | XChaCha20-Poly1305, random nonce per write, AAD = vault id + item id |
| Export envelope | Separate Argon2id + XChaCha20-Poly1305 key, domain-separated from login keys |
| Memory | Zeroizing key wrappers; decrypted items exist only in the Rust process while unlocked |

No cryptography is implemented in TypeScript. The webview speaks to Rust through
typed commands and never sees a key or plaintext at rest.

### What the database contains

Usernames, KDF parameters, salts, verifiers, settings and ciphertext. It never
contains titles, usernames inside items, passwords, URLs, notes, card numbers or
TOTP secrets in plaintext — and a regression test asserts exactly that.

### Master-password rotation

Changing the master password generates a new salt, new password-derived keys and
**a new vault key**, then re-encrypts every item inside a single SQLite
transaction (`replace_vault_items`). A crash cannot leave half the vault on the
old key.

### Update integrity

Updates come only from `Ahaduzzamankhan/Acuye-Pass` on GitHub. URLs must live
under that repository's release download path, redirects are disabled, the
installer must verify against the embedded minisign/Tauri public key, downgrades
are rejected, and nothing installs without explicit consent. Full rules in
[docs/UPDATER.md](docs/UPDATER.md).

### Network surface

Outbound traffic is limited to four, all opt-in or host-restricted:

1. Signed update checks (`api.github.com`) and installer downloads (`github.com`).
2. On-demand favicon fetch from the item's own site — HTTPS only, no redirects,
   256 KiB cap, raster formats only, public IPs only, cached locally.
3. Breach lookups you trigger against the Pwned Passwords **range** API, sending
   only the first five hex characters of a SHA-1 computed inside the process.
4. Hostless LAN pairing and sync, only with devices you explicitly pair over your
   own network.

No telemetry, analytics, crash reporting or account endpoint exists in the build.

### What this does *not* protect against

- Malware already running on your machine with access to the process, clipboard
  or screen while the vault is unlocked.
- Clipboard snooping before the auto-clear timer fires.
- Anyone who knows your master password.
- A deleted or lost vault file with no backup. A recovery code restores access
  to a vault whose master password is forgotten — it cannot undelete a file.
- An unaudited implementation. The cryptography is documented and tested, not
  externally audited — see [docs/SECURITY.md](docs/SECURITY.md).

---

## Privacy

**Nothing is collected.** There is no telemetry endpoint, no analytics SDK, no
crash reporting, no advertising identifier and no account system. The app does
not contact Fluxenite servers because there are none.

| Data | Where it lives |
| --- | --- |
| Vault database | `%APPDATA%\com.fluxenite.acuyepass\acuye.db` (platform equivalent on Linux/macOS) |
| Backups | `backups/` beside the database, encrypted copies of the same file |
| Exports | Only the location you choose |
| Favicon cache | Local, cleared with the app data |
| Secret access log | Inside the encrypted database |

Uninstalling does not delete the vault — remove the application data folder
yourself if you want it gone.

Plaintext CSV/JSON export exists because interoperability requires it, and the
UI warns that anyone can read the file. Encrypted export is the recommended path
and uses the same key hierarchy as the vault.

Full details: [docs/PRIVACY.md](docs/PRIVACY.md).

---

## Features

- **Username + master password only.** No biometrics, no Windows Hello, no PIN.
- **Account recovery, optional and local.** A one-time Crockford-base32 recovery
  code, plus three security questions if you want them, wrap the vault key with
  Argon2id-derived keys. Recovery sets a new master password, rotates the vault
  key and issues a fresh code. See [docs/SECURITY.md](docs/SECURITY.md).
- **Starts at login, hidden in the tray.** Registered on first run; closing the
  window keeps the app in the tray so the vault stays a keystroke away. Locking
  and the idle timeout still apply. Toggle it in Settings → Preferences.
- **Multiple accounts.** Each account is a separate vault with its own username,
  master password and key, all inside the same encrypted database. Pick one on
  the unlock screen or add another from there, the account menu or Vaults.
- **Eight item types** — logins, secure notes, cards, identities, documents,
  custom items, authenticator entries and secret-manager entries.
- **Built-in authenticator.** RFC 6238 TOTP and RFC 4226 HOTP generated in Rust;
  secrets never leave the process.
- **Secret manager entries.** Environment-scoped API keys and tokens with expiry
  and rotation-due alerts plus a local secret-access history.
- **Security Center.** A local hygiene score with weak, reused, old and
  empty-password findings, plus opt-in breach scanning by k-anonymity.
- **Hostless LAN sync.** Pair two PCs over your own network with a QR offer,
  signed mutual authentication and a revocable peer list. No server involved.
- **Import** from Acuye JSON, Bitwarden JSON/CSV, Chrome/Edge CSV, 1Password CSV
  and generic CSV. **Export** encrypted, or plaintext CSV/JSON on request.
- **Chrome/Chromium extension.** Unlocks a vault through a native messaging
  host, fills the page's login form automatically when exactly one saved login
  matches the host, fills on demand from the popup, and copies current 2FA
  codes. No save prompts, no passkeys; unpacked, not in a store — see
  [docs/BROWSER_EXTENSION.md](docs/BROWSER_EXTENSION.md).
- **Encrypted backups and atomic restore.** The app never silently resets a vault.
- **Three-panel workspace** with a collapsible animated sidebar, six accent
  themes in light/dark/system mode, reduced-motion support, command palette and
  custom frameless Windows title bar.
- **Signed updates only**, channels with stable default, downgrades rejected.

### How it compares

A detailed, honest comparison against Bitwarden and 1Password — including where
this app loses — is in [benchmark.md](benchmark.md). The short version:

| | Acuye Pass | Bitwarden | 1Password |
| --- | --- | --- | --- |
| Price | Free (MIT) | Free tier; Premium $19.80/yr | No free tier; $3.99/mo yearly |
| Open source | Yes, MIT, whole codebase | Yes | No |
| Account / cloud | None | Yes (or self-host) | Yes |
| Browser autofill | **Extension** (auto-fills one matching login) | Yes | Yes |
| Passkeys | **No** | Yes | Yes |
| Cloud sync / mobile | **No sync; Android app (CI APK)** | Yes | Yes |
| Sharing / emergency access | **No** | Yes | Yes |
| Independent audit | **None yet** | Multiple | Yes |

---

## Getting started

Prerequisites: Rust 1.84+, Node.js 20+, pnpm 9. On Windows, install the WebView2
runtime and the Visual Studio C++ build tools.

```bash
pnpm install
pnpm desktop:dev        # Tauri window with the real Rust backend
```

Other tasks:

```bash
pnpm dev                    # browser preview only (DemoBackend, no encryption)
pnpm lint                   # eslint, zero warnings tolerated
pnpm typecheck              # tsc --noEmit
pnpm test                   # vitest + Testing Library
cargo test --workspace      # Rust tests
cargo build --release -p acuye-browser-host          # extension native host
cargo run --release --example bench -p acuye-vault   # speed numbers above
```

The browser preview is labelled in the title bar and uses an in-memory backend so
the UI can be reviewed without a Tauri runtime. It performs **no encryption** and
is never shipped.

## Layout

```
apps/desktop            React + TypeScript + Vite + Tauri 2 frontend
apps/desktop/src-tauri  Tauri commands, window control, updater wiring
apps/browser-extension  Manifest V3 popup + native messaging bridge
apps/mobile             React Native Android client over the Rust core (JNI)
crates/acuye-*          Rust workspace: core, crypto, vault, storage, auth,
                        generator, totp, breach, lan, sync, protocol, import,
                        export, updater, platform, ffi, browser-host
benchmark.md            Product comparison against Bitwarden and 1Password
docs/                   Architecture, security, privacy, development, features,
                        sync, release, updater
```

## Documentation

- [Benchmark vs. Bitwarden and 1Password](benchmark.md)
- [Features](docs/FEATURES.md)
- [Browser extension](docs/BROWSER_EXTENSION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [Privacy](docs/PRIVACY.md)
- [Development](docs/DEVELOPMENT.md)
- [Sync protocol](docs/SYNC_PROTOCOL.md)
- [Release process](docs/RELEASE.md)
- [Updater](docs/UPDATER.md)
- [Contributing](CONTRIBUTING.md)

## Known limitations

- Pre-1.0, unaudited, single maintainer.
- Windows is the only shipped target. The Tauri shell builds elsewhere, but the
  release pipeline and updater are Windows-only.
- The browser extension is Chrome/Chromium only and loaded unpacked (not in a
  store). It fills one matching login form and never saves, prompts or creates
  passkeys; automatic filling needs the vault to be unlocked first.
- No cloud sync, sharing or emergency access.
- The Android client is built by CI as an installable APK (not a store listing)
  and is read-mostly: unlock, search, reveal/copy, TOTP and create logins. No
  editing, deletion, import/export, sync or Android autofill service.
- Security questions are weaker than the master password. They are optional and
  only protect as well as the answers you choose.
- `acuye-sync/1` is a specification plus a transport trait; no provider ships.
- Clipboard contents remain readable by other applications until the clear timer
  fires.

## License

MIT © 2026 Fluxenite. See [LICENSE](LICENSE).
