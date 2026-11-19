# Acuye Pass

A local-first, privacy-focused password manager for Windows by **Fluxenite**.

Acuye Pass stores every item encrypted on your own device. There is no account
server, no telemetry, no analytics and no third-party favicon service. Your
vault leaves the machine only when you export it yourself.

> **Status:** pre-1.0. The Windows desktop app is functionally complete but has
> not yet been through an external security audit. Do not use it as the only
> copy of credentials you cannot afford to lose.

## Highlights

- **Username + master password only.** No biometrics, no Windows Hello, no PIN.
- **Rust owns the cryptography.** Argon2id → HKDF-SHA256 → XChaCha20-Poly1305
  with per-item AAD binding. The TypeScript layer never sees keys or plaintext
  at rest; SQLite stores ciphertext only.
- **Full rotation on master-password change.** New salt, new password-derived
  keys, new vault key, all items re-encrypted inside one SQLite transaction.
- **Three-panel workspace** with an animated, collapsible sidebar, six accent
  themes (Blue, White, Red, Green, Yellow, Monochrome) in light/dark/system
  mode, Motion animations and reduced-motion support.
- **Custom Windows title bar** (frameless) with drag region, double-click
  maximize, minimize/maximize/restore/close and theme-aware styling.
- **Signed updates only** from `Ahaduzzamankhan/Acuye-Pass`, verified with
  minisign/Tauri signatures, stable by default, beta/alpha strictly opt-in,
  downgrades rejected, nothing installed without consent.
- **Import from** Acuye JSON, Bitwarden JSON/CSV, Chrome, 1Password and generic
  CSV. **Encrypted export** plus plaintext CSV/JSON when you ask for it.
- **Encrypted backups** and atomic restore. The app never silently resets a
  vault.

## Layout

```
apps/desktop            React + TypeScript + Vite + Tauri 2 frontend
apps/desktop/src-tauri  Tauri commands, window control, updater wiring
apps/mobile             Empty React Native scaffold (future work)
crates/acuye-*          Rust workspace: core, crypto, vault, storage, auth,
                        generator, sync, protocol, import, export, updater,
                        platform, ffi
docs/                   Architecture, security, development, release docs
```

## Getting started

Prerequisites: Rust 1.84+, Node.js 20+, pnpm 9. On Windows, install the
[WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
and the Visual Studio C++ build tools.

```bash
pnpm install
pnpm desktop:dev        # Tauri window with the real Rust backend
pnpm dev                # browser preview only (DemoBackend, no encryption)
pnpm lint
pnpm typecheck
pnpm test
cargo test --workspace
```

The browser preview is explicitly labelled and uses an in-memory backend so the
UI can be reviewed without a Tauri runtime. It performs **no encryption** and is
never shipped.

## Security

Read [SECURITY.md](docs/SECURITY.md) and [ARCHITECTURE.md](docs/ARCHITECTURE.md).
Back up your vault; a forgotten master password cannot be recovered by design.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Development](docs/DEVELOPMENT.md)
- [Security model](docs/SECURITY.md)
- [Privacy](docs/PRIVACY.md)
- [Release process](docs/RELEASE.md)
- [Updater](docs/UPDATER.md)
- [Sync protocol](docs/SYNC_PROTOCOL.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT © 2026 Fluxenite. See [LICENSE](LICENSE).
