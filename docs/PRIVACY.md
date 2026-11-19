# Privacy

Acuye Pass is local-first. The vault is a SQLite file on your device, encrypted
with a key derived from your master password.

## What we collect

Nothing. There is no telemetry, analytics, crash reporting, advertising or
account system. The application does not contact Fluxenite servers.

## Network requests the app can make

1. **Update checks** — only when you check manually or automatic checks are
   enabled. Requests go to `api.github.com` for the official repository and,
   after your approval, `github.com` for the installer and signature.
2. **Favicons** — only when you explicitly request one for an item, only HTTPS,
   only public hosts, no redirects, size-capped. Results are cached locally.
   No third-party favicon aggregation service is used.

Everything else happens offline.

## Local data

- Vault database: `%APPDATA%\com.fluxenite.acuyepass\acuye.db` (or the platform
  equivalent).
- Backups: `backups/` beside the database, encrypted copies of the same file.
- Exports: only in the location you choose.

Uninstalling does not automatically delete the vault; remove the application
data folder yourself if you want it gone.

## Exports

Encrypted exports use the same key hierarchy as the vault. Plaintext CSV/JSON
exports are available because interoperability requires them, but the UI warns
that the file will be readable by anyone. Choose encrypted exports unless you
have a specific reason not to.
