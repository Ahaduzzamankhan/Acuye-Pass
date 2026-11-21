# Architecture

## Process split

```
┌──────────────────────────── Windows WebView2 ────────────────────────────┐
│ React 18 + TypeScript + Vite + Tailwind + Motion                         │
│  pages/  components/  lib/backend.ts  lib/app-context.tsx                │
│  No cryptography: commands only, via @tauri-apps/api invoke              │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ IPC (Tauri commands, camelCase views)
┌───────────────────────────────▼──────────────────────────────────────────┐
│ apps/desktop/src-tauri  (Rust)                                           │
│  commands.rs  state.rs  window.rs  updates.rs  data.rs  advanced.rs      │
│  Holds the only decrypted Vault + vault key in memory                    │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ Rust crates
┌───────────────────────────────▼──────────────────────────────────────────┐
│ acuye-auth → acuye-vault → acuye-crypto → acuye-core                     │
│ acuye-storage (SQLite)   acuye-generator   acuye-totp   acuye-breach     │
│ acuye-lan   acuye-sync   acuye-protocol   acuye-import   acuye-export    │
│ acuye-updater   acuye-platform   acuye-ffi                               │
│ acuye-browser-host (separate stdio process, same crates, same database)   │
└──────────────────────────────────────────────────────────────────────────┘
```

The frontend is a consumer of a typed command surface (`src/lib/backend.ts`).
Two implementations exist:

- `TauriBackend` — the shipped path, every call goes to Rust.
- `DemoBackend` — browser-preview only, in memory, clearly labelled in the title
  bar. It contains no encryption code and is not part of the installer.

## Crates

| Crate | Responsibility |
| --- | --- |
| `acuye-core` | Domain models (items, vault metadata, settings, session), errors, time, strength helpers |
| `acuye-crypto` | Argon2id KDF, HKDF domain keys, XChaCha20-Poly1305 seal/open, verifier, vault-key wrapping |
| `acuye-vault` | In-memory vault operations, search, security report, item codec (AAD = vault id + item id) |
| `acuye-storage` | SQLite (WAL) with forward-only migrations, encrypted item rows, backups, atomic replacement |
| `acuye-auth` | Account creation, unlock, master-password rotation, rename |
| `acuye-generator` | CSPRNG passwords and EFF-wordlist passphrases, local strength estimation |
| `acuye-totp` | RFC 6238 TOTP and RFC 4226 HOTP engine, otpauth URI import/export |
| `acuye-breach` | Pwned Passwords range lookups with k-anonymity and tri-state results |
| `acuye-lan` | Hostless LAN pairing: Noise XX handshake, signed offers, trust store, sealed sync bundles |
| `acuye-protocol` | `acuye-sync/1` wire types and limits |
| `acuye-sync` | Transport trait and push/pull engine (provider-agnostic, not enabled in the desktop build) |
| `acuye-import` | Bitwarden/Chrome/1Password/generic CSV and JSON parsing |
| `acuye-export` | Encrypted envelope and CSV/JSON export |
| `acuye-updater` | Channel selection, asset allowlists, minisign verification, downloads |
| `acuye-platform` | Data paths, URL validation/SSRF guards, favicon fetching |
| `acuye-ffi` | JSON helpers for future non-Tauri shells (no mobile UI yet) |
| `acuye-browser-host` | Chrome native-messaging host: reads the database, unlocks one vault in memory, answers popup `list`/`fill` requests |

Dependency direction is one-way: `core` knows nothing about crypto or storage;
`crypto` knows nothing about items; `vault` uses `core` + `crypto`; `storage`
uses `core`; the Tauri crate wires everything together. Any new crate must keep
that ordering so `acuye-ffi` can reuse the core unchanged.

## Data model

SQLite tables (schema version 4, `PRAGMA user_version`):

- `accounts` — one row per vault, keyed by vault id: username, KDF parameters,
  salt, verifier, wrapped vault key, vault name
- `items` — id, vault id, nonce, ciphertext, updated_at (**no plaintext**)
- `settings` — JSON app settings
- `devices` — device records for sync
- `sync_state`, `sync_outbox` — resumable sync metadata
- `lan_peers` — approved LAN peers, keys, address, revocation flag
- `secret_access` — local secret reveal/copy history, encrypted with the vault

Timestamps are unix seconds (`i64`). Domain structs are snake_case; Tauri view
structs are camelCase. Migrations are append-only and transactional: an index
`i` in the migration list produces `user_version = i + 1`, and an unknown higher
version refuses to open rather than truncating data.

## Unlock and key flow

1. Argon2id(master password, salt, 64 MiB, t=3, p=1) → master key.
2. HKDF-SHA256 expands it into an auth key and a wrapping key.
3. HMAC verifier authenticates the password before any vault key is unwrapped.
4. The random vault key is unwrapped from the account record, bound to the vault id.
5. Encrypted rows are decrypted into an in-memory `Vault` with per-item AAD
   binding (`vault_id || item_id`), then summaries are sorted for the list.

Changing the master password rotates salt, keys, and vault key and re-encrypts
every item in a single SQLite transaction (`replace_vault_items`).

## Background and network work

Nothing runs in the background by default. The only Rust code that opens a
socket is:

- `acuye-updater` — GitHub release API and signed installer download.
- `acuye-platform` — on-demand favicon fetch from the item's own host.
- `acuye-breach` — opt-in range query to the Pwned Passwords API.
- `acuye-lan` — pairing and sync with explicitly approved peers on the LAN.

All four are host-restricted and size-capped. There is no polling loop, no
telemetry timer and no sync client.

## UI structure

`AppShell` renders the custom title bar, sidebar, list, detail pane and status
bar. Theme is driven by `data-theme` / `data-mode` attributes and CSS variables,
so accent colour is independent of light/dark mode. Routes are hash-based
(`/vault`, `/security`, `/vaults`, `/settings/:section`) so the packaged app does
not depend on server-side routing.

Pages: `Onboarding`, `Unlock`, `VaultPage`, `SecurityCenter`,
`AuthenticatorPage`, `SecretsPage`, `VaultsPage`, `DevicesPage`, `SettingsPage`.

## Performance

Measured with `cargo run --release --example bench -p acuye-vault`:

- Full unlock (Argon2id + HKDF + verifier + unwrap): ~243 ms on the reference
  machine — the same as the KDF alone, because everything after it is sub-millisecond.
- 1,000 items: encrypt 6 ms, persist 3 ms, reload + decrypt 8 ms, search 0.5 ms.
- 5,000 items: encrypt 30 ms, persist 17 ms, reload + decrypt 51 ms, search 2.4 ms.
- 20,000 items: reload + decrypt 190 ms, search 10 ms.

Search is a linear scan over decrypted items with a lowercase haystack built per
query. That is comfortably fast to 20k items and simpler to audit than an index;
if it ever becomes a bottleneck, the fix belongs in `acuye-vault::search`.

## Failure policy

- Decryption or authentication failures fail closed.
- Backups are copied before restore; restore replaces the database atomically
  and clears the in-memory session.
- Migrations are forward-only and transactional.
- A locked vault clears decrypted items from memory.
- Update failures never leave a partially installed binary: download, verify and
  install are separate stages with explicit user consent between them.
