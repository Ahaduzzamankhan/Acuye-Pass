# Features

A complete reference of what Acuye Pass 0.1.4 does. Anything not listed here is
either not implemented or explicitly noted as a limitation. For how these
features compare with other products, see [../benchmark.md](../benchmark.md).

## Vault model

- **One vault per account, several accounts per device.** A vault's name is
  metadata and can be renamed; renaming does not touch item encryption.
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

## Accounts

- Every account is an independent vault: its own username, master password, salt,
  verifier and vault key. Items are stored per vault id, so two accounts never
  see each other's data.
- All accounts live in the same encrypted database file. Settings, devices and
  LAN peer approvals are shared by the device, not by the account.
- **Add account** from the unlock screen, the sidebar account menu, or Vaults.
  Creating one locks whatever vault was open — two vaults are never decrypted at
  the same time.
- The unlock screen lists every local account (username + vault name) so you pick
  the one to open; it falls back to a username field if a name is ambiguous.
- Account names are unique (case-insensitively). Removing an account is not
  implemented yet: lock out of it, or delete the database after backing up.

## Browser extension

An optional Manifest V3 extension for Chrome/Chromium, in
[`apps/browser-extension`](../apps/browser-extension), backed by the
`acuye-browser-host` native messaging host.

- Lists the local accounts, unlocks one with its master password, searches
  titles/usernames/hosts (at most 50 logins) and fills the active tab's first
  visible login form.
- A content script auto-fills on page load when the page host matches exactly
  one saved login and the host already has an unlocked session. It never prompts
  for the master password and never submits a form.
- A 2FA button copies the current RFC 6238 code for a login; the secret is used
  in the Rust host and never sent to the page.
- Autofill can be turned off from `chrome.storage.local` (`autofill: false`).
- The host reads the database; it never writes items and never creates accounts.
- Idle sessions lock after 10 minutes and the host exits when the browser closes
  its port.
- Full install steps, permissions and threat notes:
  [BROWSER_EXTENSION.md](BROWSER_EXTENSION.md).

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
- No biometric unlock, no Windows Hello, no PIN, no server-side reset.

## Account recovery (optional)

- A **recovery code** is a 160-bit Crockford-base32 secret (`XXXX-XXXX-…`, eight
  groups). It is shown once, when you enable recovery; the app stores only a
  salt, an Argon2id verifier and the vault key wrapped under the code.
- **Three security questions** can be enrolled alongside the code. Answers are
  normalised (case-insensitive, collapsed whitespace) and stored only as
  Argon2id verifiers; every answer must match.
- Both are set up in Settings → Authentication and require the master password.
  Turning recovery off deletes every enrolment.
- Recovering opens the vault, sets a new master password, rotates the KDF salt,
  the password-derived keys and the vault key, re-encrypts every item in one
  transaction, then issues a **fresh** recovery code and clears the questions.
- "Forgot your master password?" on the unlock screen takes either path. With
  no enrolment, there is still no way in — the vault key exists only wrapped by
  your password.

## Startup and tray

- Registered to start at login on first run (`tauri-plugin-autostart`), with
  `--hidden`, so no window appears and the vault stays locked.
- Closing the window hides it to the tray instead of quitting; the tray menu has
  **Open Acuye Pass**, **Lock vault** and **Quit**.
- Toggle "Start at login" in Settings → Preferences; it reads the real OS state.

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

- Save prompts, keyboard shortcut/context-menu fill, card/note filling from the
  extension, and passkey creation/use.
- Firefox and Safari builds of the extension; a store listing or signed package.
- Cloud sync provider (the `acuye-sync/1` protocol ships as a spec plus a
  transport trait only).
- Multiple users, sharing, collections, emergency access, secure send links.
- Android app features beyond unlock/search/reveal/copy/TOTP/create-login:
  editing, deleting, import/export, sync, recovery settings, autofill service.
- A Play Store listing or signed store-ready Android build.
- macOS/Linux release artifacts, CLI, SSH agent.
