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

## Checklist

1. `pnpm lint && pnpm typecheck && pnpm test`
2. `cargo fmt --all --check && cargo test --workspace` (on Windows, or with the
   Tauri crate excluded on Linux).
3. If crypto, storage or vault code changed, rerun
   `cargo run --release --example bench -p acuye-vault` and update the numbers in
   `README.md` and `benchmark.md` if they moved materially.
4. Update `docs/FEATURES.md` for new or changed user-visible behaviour, and
   `docs/SECURITY.md` / `docs/PRIVACY.md` for any change to the crypto, network
   surface or stored data.
5. `node scripts/set-version.mjs vX.Y.Z`
6. Commit, tag `vX.Y.Z`, push the tag.
7. `.github/workflows/release.yml` builds on `windows-latest`, runs the checks,
   produces NSIS and MSI bundles plus `.sig` files, and publishes a GitHub
   release. Pre-release tags are published as prereleases.

You can also run the same workflow by hand from **Actions → Release → Run
workflow**, passing the version (for example `v0.1.0`) as the only input. Nothing
else changes: the version is validated by `scripts/set-version.mjs` exactly as
with a tag, and the release is attached to that tag, which is created at the
built commit if it does not exist yet. Dispatch it from `main` so the tag lands
on the commit you intend to ship.

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

## What a release does not do

- It does not reset or migrate user vaults beyond the forward-only schema
  migrations shipped in `acuye-storage`.
- It does not change the updater public key. Key rotation has its own procedure
  in [UPDATER.md](UPDATER.md) and must ship in a build *before* the release that
  depends on the new key.
