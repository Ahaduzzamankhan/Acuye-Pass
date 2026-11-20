# Features

A complete reference of what Acuye Pass 0.1.4 does. Anything not listed here is
either not implemented or explicitly noted as a limitation. For how these
features compare with other products, see [../benchmark.md](../benchmark.md).

## Vault model

- **One vault per device.** Its name is metadata and can be renamed; renaming
  does not touch item encryption.
- **Local-first.** The vault is a SQLite file. It exists decrypted only in the
  Rust process, only while unlocked.
- **Eight item types**, each with its own fields:

| Type | Fields |
| --- | --- |
| Login | username, password, URL, TOTP secret, password-changed timestamp |
| Secure note | free text body plus notes, tags, favourite |
| Card | cardholder, number, expiry month/year, CVV, brand, PIN |
| Identity | name, email, phone, address, city, state, postal code, country, company |
| Document | filename, MIME type, size, SHA-256 |
| Custom | arbitrary label/value pairs, each independently concealable |
| Authenticator | secret, issuer, account, algorithm, digits, period, TOTP or HOTP, counter |
| Secret | environment, category, labelled fields, expiry, rotation interval, last rotated |

- **Per-item metadata:** title, notes, tags (max 32), favourite flag, created and
  updated timestamps.
- **Limits:** title 256 chars, notes 100,000 chars, secret values 32,768 bytes,
  100 custom fields per item.

## Workspace

- Three panels: sidebar, item list, detail pane.
- Collapsible animated sidebar with reduced-motion support.
- Six accent themes (blue, white, red, green, yellow, monochrome), each in light,
  dark and system modes. Accent colour is independent of light/dark mode.
- Frameless custom Windows title bar: drag region, double-click maximize,
  minimize/maximize/restore/close, theme-aware styling.
- Command palette (`Ctrl+K`) for jumping to items and actions.
- Toast notifications, custom context menus on item rows, status bar.
- Hash-based routing (`/vault`, `/security`, `/vaults`, `/settings/:section`) so
  the packaged app never needs a web server.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+K` | Command palette |
| `Ctrl+N` | New item |
| `Ctrl+G` | Password generator |
| `Ctrl+L` | Lock the vault |
| `Ctrl+,` | Settings |
| `Esc` | Close dialog or menu |
| `Enter` | Submit focused form |

Shortcuts can be disabled in Settings. Text selection, `Ctrl+C`, `Ctrl+V` and
`Ctrl+A` continue to work normally.

## Password generator

- CSPRNG passwords (OS entropy only) with configurable length and character sets.
- EFF-wordlist passphrases.
- Local strength estimation with a small common-password blocklist.
- Generation happens in Rust (`acuye-generator`); no network involved.

## Security Center

Local analysis only — no password or hash leaves the device during the scan.

- Vault hygiene score (0–100) with per-issue drill-down.
- Findings: weak passwords (below ~60 bits of estimated entropy), reused
  passwords (grouped by identical value), old passwords (unchanged past the age
  threshold) and logins with no password stored.
- **Breach scan** against the Pwned Passwords range API using k-anonymity: SHA-1
  is computed in-process, only the first five hex characters are sent, and the
  match is done locally. A failed lookup is never reported as "not breached".
- Scan results carry the time they were produced so stale results are visible.

## Authenticator

- RFC 6238 TOTP and RFC 4226 HOTP.
- Algorithm, digit count and period are configurable per entry.
- HOTP counters advance explicitly, and an exported authenticator list is
  available for migration.
- Codes are computed inside the Rust process; secrets never reach the webview in
  plaintext outside the unlocked session.

## Secret manager

- Entries tagged `development`, `testing` or `production`, with a category and
  labelled fields (API key, token, SSH key, database URL, …).
- Expiry timestamps produce `expired` / `expiring` alerts.
- Rotation intervals produce `rotation_due` / `rotation_soon` alerts.
- Revealing or copying a secret records an access entry (item, action, time) in
  the encrypted database. History can be cleared per item.

## Breach monitoring

See Security Center. The privacy properties are the interesting part: prefix-only
queries, local matching, and a tri-state result (`found`, `not found`, `unknown`)
so an offline machine never produces a false all-clear.

## LAN sync (hostless)

Two PCs on the same network trust each other directly. There is no account, no
discovery service and no server.

- Device identity is derived from the vault key with HKDF, so it is stable per
  vault and never stored as a standalone secret.
- Pairing uses a short-lived signed offer carried in a QR code containing the
  device's public keys, LAN address and a one-time token.
- Approved peers are stored locally and can be revoked or forgotten at any time.
- A revoked device cannot sync.
- Sync bundles carry encrypted items only; the peer never receives the vault key.
- See [SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) for the protocol and trust model.

## Import and export

| Import format | Notes |
| --- | --- |
| Acuye JSON | Round-trips this app's own export |
| Bitwarden JSON | Folder, favourite, type, notes, custom fields, login fields |
| Bitwarden CSV | Column detection including `login_totp` |
| Chrome / Edge CSV | `name,url,username,password,note` |
| 1Password CSV | `Title,Url,Username,Password,OTPAuth` |
| Generic CSV | Header detection for title/username/password/url |

- Import is two-phase: preview first, then explicit apply.
- **Encrypted export** uses its own Argon2id-derived key, domain-separated from
  login keys, and produces a password-protected envelope.
- **Plaintext CSV/JSON** is available for interoperability behind an explicit
  warning dialog.
- Encrypted exports can be inspected and re-imported.

## Backups and restore

- One-click encrypted backup of the database with verification.
- Restore is atomic: the current database is copied aside first, the replacement
  is validated, and the in-memory session is cleared.
- Backup and export folders are reachable from Settings.

## Locking and session behaviour

- Auto-lock after a configurable idle period, enforced in Rust as well as in the
  UI — disabling the UI timer does not extend the session.
- Manual lock clears decrypted items and the vault key from memory.
- Configurable clipboard clear delay for copied secrets.
- No biometric unlock, no Windows Hello, no PIN, no password recovery, no
  server-side reset.

## Updates

- Signed updates only, from `Ahaduzzamankhan/Acuye-Pass`.
- Channels: stable (default), beta, alpha. Prereleases require explicit consent.
- Downgrades rejected; installers launched only after explicit user action.
- Progress, checksum, size and release notes shown before installing.
- See [UPDATER.md](UPDATER.md).

## Data and diagnostics

- Encrypted database path shown in Settings.
- SQLite `quick_check` integrity check on demand.
- Schema version and encrypted item count visible.
- No telemetry, analytics or crash reporting exists in the build; the settings
  model rejects those keys.

## Not implemented

- Browser extension, autofill, passkey creation/use.
- Cloud sync provider (the `acuye-sync/1` protocol ships as a spec plus a
  transport trait only).
- Multiple users, sharing, collections, emergency access, secure send links.
- Mobile app (`apps/mobile` is an empty scaffold).
- macOS/Linux release artifacts, CLI, SSH agent.
