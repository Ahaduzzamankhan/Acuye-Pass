# Release process

Tags follow `v<semver>`:

- `v1.0.0` — stable
- `v1.1.0-beta.1` — beta prerelease
- `v2.0.0-alpha.1` — alpha prerelease

Only `alpha` and `beta` prerelease labels are accepted by the updater.

## Versioning

Run the version script before tagging so every manifest agrees:

```bash
node scripts/set-version.mjs v1.1.0-beta.1
```

It updates `Cargo.toml` (workspace), `apps/desktop/src-tauri/Cargo.toml`,
`apps/desktop/src-tauri/tauri.conf.json`, and both `package.json` files.

## One-time signing setup

```bash
pnpm --filter @acuye/desktop tauri signer generate -w ~/.tauri/acuye.key
```

Store these repository secrets:

| Secret | Purpose |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater/installer signing key (contents) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password (empty if none) |
| `ACUYE_UPDATER_PUBKEY` | Base64 minisign public key embedded in the binary |

Losing the private key means existing installations cannot verify future
updates; back it up offline.

## Cutting a release

1. `pnpm lint && pnpm typecheck && pnpm test`
2. `cargo fmt --all --check && cargo test --workspace` (on Windows or with the
   Tauri crate excluded on Linux).
3. `node scripts/set-version.mjs vX.Y.Z`
4. Commit, tag `vX.Y.Z`, push the tag.
5. `.github/workflows/release.yml` builds on `windows-latest`, runs the checks,
   produces NSIS and MSI bundles plus `.sig` files, and publishes a GitHub
   release. Pre-release tags are published as prereleases.

## Verifying a release

- The release must contain an `x64` NSIS `.exe` and/or `.msi` whose names start
  with `Acuye Pass`, `Acuye-Pass` or `acuye-pass`.
- Every installer must have a matching `.sig` asset.
- Signatures must verify against `ACUYE_UPDATER_PUBKEY`.
- `latest` is never used: the updater reads the releases list and selects by
  semver and channel.

## Rollback

Published releases are immutable from the updater's point of view: versions are
compared with semver and downgrades are rejected. To roll back, publish a new
higher version containing the fix (for example `1.1.1`). Deleting a release does
not uninstall it from users' machines.
