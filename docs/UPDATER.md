# Updater

The updater is implemented in Rust (`crates/acuye-updater`) and wired through
`apps/desktop/src-tauri/src/updates.rs`. It deliberately does not use a generic
update endpoint and does not trust a `latest` pointer.

## Trust rules

1. Release metadata comes only from
   `https://api.github.com/repos/Ahaduzzamankhan/Acuye-Pass/releases`.
2. Download and signature URLs must begin with
   `https://github.com/Ahaduzzamankhan/Acuye-Pass/releases/download/<tag>/`.
3. Redirects are disabled (ureq `redirects(0)`).
4. The installer must verify against the embedded minisign/Tauri public key
   (`ACUYE_UPDATER_PUBKEY` at compile time). No key means no updates.
5. The offered version must be strictly greater than the installed version.
6. Nothing is installed automatically; the user reviews notes, downloads, and
   explicitly installs.

Development builds may read a public key from `ACUYE_UPDATER_PUBKEY_FILE` or an
environment variable; this fallback is compiled only with `cfg!(debug_assertions)`.

### Limits

| Item | Cap |
| --- | --- |
| Release metadata | 4 MiB |
| Signature asset | 8 KiB |
| Installer | 256 MiB |

Assets outside these limits are rejected rather than truncated.

## Channels

| Channel | Accepts |
| --- | --- |
| Stable (default) | `x.y.z` only |
| Beta | stable + `-beta.N` |
| Alpha | stable + beta + alpha |

Beta and alpha are opt-in. Changing to a prerelease channel requires an explicit
confirmation in Settings → Updates.

## Stages

`idle → checking → up_to_date | available → downloading → downloaded →
verified → installing` with `failed` on error. Progress events are emitted as
`update://progress` and `update://finished`; the settings screen renders a
progress bar, version, notes, checksum and size.

Each stage is separately abortable. Discarding a download removes the partial
file; a verification failure leaves the installed version untouched.

## Assets

Only Windows installers (`.exe`, `.msi`) whose names contain `x64`/`x86_64` and
start with an allowed prefix are considered. Each installer must have a
same-named `.sig` asset.

## Auto-check

When enabled, the app checks at most once every six hours, and only when the
Updates settings section is opened. There is no background polling service.

## Key rotation

To rotate the updater key:

1. Generate a new key pair.
2. Sign a release with the new key.
3. Ship a build that embeds the new public key **before** the release that
   requires it, or publish the new key in a trusted channel.
4. Keep the old key available long enough for users to move forward.

Because downgrades are rejected, a broken release must be fixed with a higher
version.

## What the updater never does

- It never installs without user consent.
- It never follows a redirect to a URL outside the official release path.
- It never accepts a signature from an unknown key.
- It never downgrades, even if a newer tag is deleted or a release is unpublished.
- It never sends vault data, usage data or an identifier in an update request.
