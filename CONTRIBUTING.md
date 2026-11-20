# Contributing

Thanks for helping improve Acuye Pass.

## Before you start

- Open an issue for non-trivial changes so the approach can be agreed first.
- Security issues must not be reported in public issues; see
  [docs/SECURITY.md](docs/SECURITY.md).

## Setup

```bash
pnpm install
pnpm desktop:dev
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for prerequisites and checks.

## Pull requests

1. Keep changes focused; one concern per pull request.
2. Include tests for behavioural changes. Rust logic belongs in Rust tests; UI
   flows in Vitest + Testing Library.
3. Run before pushing:

   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   cargo fmt --all --check
   cargo test --workspace
   ```

4. Do not add telemetry, analytics, third-party favicon services, biometric
   authentication or accounts.
5. Do not reimplement cryptography or vault rules in TypeScript.
6. Do not silently change encryption formats, the `ItemFields` tag, migrations
   or the updater trust rules; these need a documented version bump.
7. Update documentation when behaviour or configuration changes. The docs that
   must stay true are listed below.
8. If you touch a hot path, run
   `cargo run --release --example bench -p acuye-vault` before and after and put
   both numbers in the pull request.

## Documentation map

| File | Keep it in sync with |
| --- | --- |
| `README.md` | Anything user-visible: features, limitations, benchmark numbers |
| `benchmark.md` | Comparison claims, pricing snapshots, measured numbers |
| `docs/FEATURES.md` | Every shipped screen, item type, setting and shortcut |
| `docs/ARCHITECTURE.md` | Crates, schema, key flow, network paths, performance |
| `docs/SECURITY.md` | Crypto, threat model, network surface, audit status |
| `docs/PRIVACY.md` | Every outbound request and every local file |
| `docs/SYNC_PROTOCOL.md` | LAN sync and `acuye-sync/1` behaviour |
| `docs/RELEASE.md` | Tagging, signing, CI workflow |
| `docs/UPDATER.md` | Update trust rules, channels, asset allowlists |

Claims in the README about speed must be measured, and claims about other
products must be attributed and dated. Do not add a comparison figure that has
not been checked against the vendor's own page.

## Commit style

Use short imperative subjects, for example `fix: reject expired update
signatures`. Reference issues where useful.

## License

By contributing you agree your work is licensed under the MIT license.
