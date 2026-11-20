# Privacy

Acuye Pass is local-first. The vault is a SQLite file on your device, encrypted
with a key derived from your master password.

## What we collect

Nothing. There is no telemetry, analytics, crash reporting, advertising or
account system. The application does not contact Fluxenite servers, because no
such servers exist for this product.

This is enforced in code, not just policy: the settings model rejects telemetry
and analytics keys, there is no SDK that could phone home, and the only four
network paths in the codebase are listed below.

## Network requests the app can make

1. **Update checks** — only when you check manually or automatic checks are
   enabled. Requests go to `api.github.com` for the official repository and,
   after your approval, `github.com` for the installer and signature. Nothing
   identifying is sent beyond a standard HTTP client and the current version.
2. **Favicons** — only when you explicitly request one for an item. The request
   goes to the item's own host, HTTPS only, no redirects, size-capped. No
   third-party favicon aggregation service is used, so no one learns which sites
   are in your vault.
3. **Breach checks** — only when you run a scan, and only for passwords you ask
   about. The password is SHA-1 hashed locally; the first five hex characters of
   that hash are sent to the Pwned Passwords range API; the returned range is
   matched locally. The full hash, the password and anything derived from it stay
   in the process. The API sees a 5-character prefix that is shared by thousands
   of passwords, not your password or your identity.
4. **LAN pairing and sync** — only with devices you explicitly pair, only over
   your own network. No discovery service or relay is involved.

Everything else happens offline.

## Local data

- Vault database: `%APPDATA%\com.fluxenite.acuyepass\acuye.db` (or the platform
  equivalent).
- Backups: `backups/` beside the database, encrypted copies of the same file.
- Exports: only in the location you choose.
- Favicon cache: local files, cleared with the application data.
- Secret access history: inside the encrypted database.

Uninstalling does not automatically delete the vault; remove the application
data folder yourself if you want it gone.

## What the database reveals

The encrypted file exposes only what encrypted-at-rest storage inherently must:
an account username, KDF parameters, a salt, a verifier, and the number and
approximate size of items with timestamps. It does not expose titles, URLs,
usernames inside items, notes, passwords, card data or secrets.

## Exports

Encrypted exports use the same key hierarchy as the vault and a separate export
password. Plaintext CSV/JSON exports are available because interoperability
requires them, but the UI warns that the file will be readable by anyone. Choose
encrypted exports unless you have a specific reason not to.

## Sharing

There is no sharing feature, so nothing about your vault is ever disclosed to
another person or organisation by the application. LAN sync transfers encrypted
items to a device you approved; the peer never receives your vault key.

## Children and accounts

There are no accounts, no sign-up, no email address and no age-gated data
collection, because there is no service to collect it.

## Changes

If a future version adds any network feature beyond the four above, it must be
opt-in, documented here, and visible in Settings → Privacy Center.
