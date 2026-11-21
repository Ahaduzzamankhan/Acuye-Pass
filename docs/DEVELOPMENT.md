# Development

## Prerequisites

- Rust 1.84+ (`rustup default stable`)
- Node.js 20+ and pnpm 9
- Windows: Visual Studio 2022 C++ build tools and the WebView2 runtime
- Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`
  (only needed to build the Tauri shell locally)

## Install

```bash
pnpm install
```

## Run

```bash
pnpm desktop:dev     # Tauri app with the real Rust backend
pnpm dev             # browser preview at http://localhost:1420
```

The browser preview runs `DemoBackend`: no encryption, demo credentials, a
"Browser preview" badge in the title bar. Use it for layout work; use
`desktop:dev` for anything touching data.

## Checks

```bash
pnpm lint            # eslint, zero warnings tolerated
pnpm typecheck       # tsc --noEmit
pnpm test            # vitest + Testing Library (jsdom)
cargo fmt --all --check
cargo clippy --workspace --exclude acuye-pass --all-targets
cargo test --workspace --exclude acuye-pass
```

`cargo test --workspace` also builds the Tauri crate, which needs the desktop
system libraries. On a headless Linux machine, exclude it as shown above; the
Windows CI job compiles it. The browser extension host is an ordinary workspace
member, so the same commands build and test it.

For the extension itself there is no bundler: `apps/browser-extension` is loaded
unpacked. Build the host with `cargo build --release -p acuye-browser-host`, then
follow [BROWSER_EXTENSION.md](BROWSER_EXTENSION.md) to register it.

## Benchmarks

The numbers in the README come from a benchmark that ships in the repository:

```bash
cargo run --release --example bench -p acuye-vault
```

It measures:

- Argon2id unlock cost (KDF only and the full unlock path),
- equivalent PBKDF2 work at Bitwarden (600k) and 1Password (650k) defaults, plus
  Bitwarden's Argon2id option,
- encrypt, persist, reload-and-decrypt, search and security-report timings at
  100 / 1,000 / 5,000 / 20,000 items.

If you change a hot path in `acuye-vault`, `acuye-crypto` or `acuye-storage`, run
it before and after and mention both numbers in the pull request. Do not quote
an unmeasured speedup.

## Where things live

- `crates/acuye-*` — Rust domain logic and tests
- `apps/desktop/src/lib/backend.ts` — the typed IPC surface
- `apps/desktop/src/lib/app-context.tsx` — application state and actions
- `apps/desktop/src/pages/` — route-level screens
- `apps/desktop/src/components/ui.tsx` — shared primitives
- `apps/desktop/src/index.css` — theme tokens
- `apps/desktop/src-tauri/src/advanced.rs` — authenticator, secrets, breach, LAN
- `crates/acuye-browser-host` — native messaging host for the extension
- `apps/browser-extension/` — Manifest V3 popup, service worker, install scripts
- `docs/` — architecture, security, privacy, features, sync, release, updater,
  browser extension

## Coding rules

- Never reimplement cryptography, vault rules or authentication in TypeScript.
  Add a Rust command and expose it through `Backend`.
- Keep domain structs snake_case and Tauri view structs camelCase.
- New persisted fields require a forward-only migration in `acuye-storage`.
- New item fields must remain compatible with the `kind` tagged `ItemFields`
  enum, which is stable on disk.
- Tauri commands run on the main thread unless they are `async` or annotated
  `#[tauri::command(async)]`. Anything that waits on the network, a socket or a
  multi-second disk operation — LAN pairing/sync, breach scans, favicon fetches,
  imports/exports, backups, update downloads — must be marked `(async)`, or the
  whole window freezes while it runs.
- New network access must be host-restricted, size-capped and documented in
  `docs/SECURITY.md` and `docs/PRIVACY.md`. Adding telemetry, analytics, a
  third-party favicon service or an account system is out of scope for this
  project.
- Run `cargo fmt` and the checks above before opening a pull request.

## Tests

Rust unit tests cover KDF/AEAD, verifier behaviour, rotation, storage
migrations, import/export, protocol, sync, updater selection, TOTP, breach
parsing, LAN pairing and URL validation.
`crates/acuye-auth/tests/workflow.rs` covers the full create → persist → restart
→ unlock → rotate lifecycle on a real SQLite file.

Frontend tests exercise the UI against `DemoBackend`: onboarding, unlock,
lockout errors, CRUD, search, favorites, theme persistence, settings navigation,
prerelease consent, sidebar collapse.

## Adding a Tauri command

1. Implement it in `apps/desktop/src-tauri/src/commands.rs` (or `data.rs`,
   `updates.rs`, `advanced.rs`).
2. Return a serializable view struct; convert camelCase at the boundary.
3. Add the method to `Backend` in `src/lib/backend.ts`.
4. Implement it in both `tauri-backend.ts` and `demo-backend.ts`.
5. Add tests where the logic is not purely presentational.
6. Register it in the `invoke_handler` list in `src-tauri/src/lib.rs`.

## Mobile

`apps/mobile` is an empty React Native scaffold. Do not build a second
implementation of the security model there — a future client should consume the
Rust core through `acuye-ffi`.

## Troubleshooting

- **`cargo test` fails on a missing `webkit2gtk` / `gtk` library**: exclude the
  Tauri crate as shown above, or install the Linux packages listed at the top.
- **The browser preview shows demo data**: expected. `DemoBackend` is in-memory
  and performs no encryption.
- **Windows Defender flags a local build**: expected for unsigned development
  binaries.
