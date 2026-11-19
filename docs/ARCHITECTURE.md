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
│  commands.rs  state.rs  window.rs  updates.rs  data.rs                   │
│  Holds the only decrypted Vault + vault key in memory                    │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ Rust crates
┌───────────────────────────────▼──────────────────────────────────────────┐
│ acuye-auth → acuye-vault → acuye-crypto → acuye-core                     │
│ acuye-storage (SQLite)   acuye-updater   acuye-platform   acuye-import…  │
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
| `acuye-storage` | SQLite (WAL) with forward-only migrations, encrypted item rows, backups, atomic replacements |
| `acuye-auth` | Account creation, unlock, master-password rotation, rename |
| `acuye-generator` | CSPRNG passwords and EFF-wordlist passphrases |
| `acuye-protocol` | `acuye-sync/1` wire types and limits |
| `acuye-sync` | Transport trait and push/pull engine (provider-agnostic) |
| `acuye-import` | Bitwarden/Chrome/1Password/generic CSV and JSON parsing |
| `acuye-export` | Encrypted envelope and CSV/JSON export |
| `acuye-updater` | Channel selection, asset allowlists, minisign verification, downloads |
| `acuye-platform` | Data paths, URL validation/SSRF guards, favicon fetching |
| `acuye-ffi` | JSON helpers for future non-Tauri shells |

## Data model

SQLite tables (schema version 2):

- `accounts` — username, KDF parameters, salt, verifier, wrapped vault key
- `items` — id, vault id, nonce, ciphertext, updated_at (**no plaintext**)
- `settings` — JSON app settings
- `devices` — device records for sync
- `sync_state`, `sync_outbox` — resumable sync metadata

Timestamps are unix seconds (`i64`). Domain structs are snake_case; Tauri view
structs are camelCase.

## Unlock and key flow

1. Argon2id(master password, salt, 64 MiB, t=3, p=1) → master key.
2. HKDF-SHA256 expands it into an auth key and a wrapping key.
3. HMAC verifier authenticates the password before any vault key is unwrapped.
4. The random vault key is unwrapped from the account record.
5. Encrypted rows are decrypted into an in-memory `Vault` with per-item AAD
   binding (`vault_id || item_id`).

Changing the master password rotates salt, keys, and vault key and re-encrypts
every item in a single SQLite transaction (`replace_vault_items`).

## UI structure

`AppShell` renders the custom title bar, sidebar, list, detail pane and status
bar. Theme is driven by `data-theme` / `data-mode` attributes and CSS variables,
so accent colour is independent of light/dark mode. Routes are hash-based
(`/vault`, `/security`, `/vaults`, `/settings/:section`) so the packaged app
does not depend on server-side routing.

## Failure policy

- Decryption or authentication failures fail closed.
- Backups are copied before restore; restore replaces the database atomically
  and clears the in-memory session.
- Migrations are forward-only and transactional.
- A locked vault clears decrypted items from memory.
