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
Windows CI job compiles it.

## Where things live

- `crates/acuye-*` — Rust domain logic and tests
- `apps/desktop/src/lib/backend.ts` — the typed IPC surface
- `apps/desktop/src/lib/app-context.tsx` — application state and actions
- `apps/desktop/src/pages/` — route-level screens
- `apps/desktop/src/components/ui.tsx` — shared primitives
- `apps/desktop/src/index.css` — theme tokens

## Coding rules

- Never reimplement cryptography, vault rules or authentication in TypeScript.
  Add a Rust command and expose it through `Backend`.
- Keep domain structs snake_case and Tauri view structs camelCase.
- New persisted fields require a forward-only migration in `acuye-storage`.
- New item fields must remain compatible with the `kind` tagged `ItemFields`
  enum, which is stable on disk.
- Run `cargo fmt` and the checks above before opening a pull request.

## Tests

Rust unit tests cover KDF/AEAD, verifier behaviour, rotation, storage
migrations, import/export, protocol, sync, updater selection and URL validation.
`crates/acuye-auth/tests/workflow.rs` covers the full create → persist → restart
→ unlock → rotate lifecycle on a real SQLite file.

Frontend tests exercise the UI against `DemoBackend`: onboarding, unlock,
lockout errors, CRUD, search, favorites, theme persistence, settings navigation,
prerelease consent, sidebar collapse.

## Adding a Tauri command

1. Implement it in `apps/desktop/src-tauri/src/commands.rs` (or `data.rs`,
   `updates.rs`).
2. Return a serializable view struct; convert camelCase at the boundary.
3. Add the method to `Backend` in `src/lib/backend.ts`.
4. Implement it in both `tauri-backend.ts` and `demo-backend.ts`.
5. Add tests where the logic is not purely presentational.
