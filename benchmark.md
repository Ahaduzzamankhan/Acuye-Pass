# Benchmark: Acuye Pass vs. Bitwarden vs. 1Password

A factual, feature-by-feature comparison of this repository (Acuye Pass 0.1.6,
pre-1.0) against the two most commonly recommended password managers.

Scope: what each product actually does today, not marketing. Acuye Pass claims
are taken from this codebase (`README.md`, `docs/`, `crates/acuye-*`,
`apps/desktop`). Bitwarden and 1Password claims are taken from their public
pricing, features and help pages, checked **November 2026**; prices change, so
treat the figures below as a snapshot.

> **Read this first.** Acuye Pass is not a drop-in replacement for either
> product yet. It is a Windows-only, local-first desktop vault. It has an
> optional Chrome extension that autofills a matching login, but no save
> prompts, no passkeys, no cloud sync and no sharing.
> Where it wins is the security model and the absence of a server. Where it loses
> is everything that makes a password manager usable day to day.

## At a glance

| | **Acuye Pass** | **Bitwarden** | **1Password** |
| --- | --- | --- | --- |
| Category | Local-first desktop vault | Cloud (or self-hosted) password manager | Cloud-only password manager |
| Platforms | Windows desktop (Tauri 2) | Windows, macOS, Linux, iOS, Android, web, CLI, all major browsers | Windows, macOS, Linux, iOS, Android, web, CLI, all major browsers |
| Browser extension / autofill | Chrome/Chromium MV3 extension: autofill for a matching login, 2FA codes, unpacked | Yes, full autofill | Yes, best-in-class autofill |
| Price | Free (MIT) | Free tier; Premium $19.80/yr; Families $47.88/yr (6 users) | No free tier; Individual $3.99/mo yearly; Families $5.99/mo yearly (5 users) |
| Account required | No | Yes (cloud) / yes (self-host) | Yes |
| Data leaves the device | Only on manual export (plus opt-in update check and favicon fetch) | Synced to Bitwarden cloud or your server | Synced to 1Password cloud |
| Source code | Fully open (MIT) | Fully open (AGPL v3 / Bitwarden License) | Closed source |
| Independent audit | **None yet** | Multiple, public reports since 2018 | Yes, published in Trust Center |
| Team / family sharing | **None** | Yes, organizations and collections | Yes, vaults and permissions |
| Maturity | Pre-1.0, single maintainer | 10+ years, large team | 20 years, large team |

## Speed

Measured with the repository benchmark (`cargo run --release --example bench -p
acuye-vault`) on an x86_64 Linux VM, release build, medians. Full methodology and
the per-vault-size table are in the [README](README.md#speed).

Unlock key derivation, same machine:

| Product | Derivation | Time |
| --- | --- | --- |
| Acuye Pass | Argon2id 64 MiB, t=3, p=1 (full unlock incl. verifier + unwrap) | ~245 ms |
| Bitwarden | Argon2id option 32 MiB, t=6, p=4 | ~215 ms |
| Bitwarden | PBKDF2 600,000 iterations (default) | ~181 ms |
| 1Password | PBKDF2 650,000 iterations | ~196 ms |

All four land within ~1.35× of each other, so no product has a meaningful
cryptographic-unlock advantage — by design, since a slow KDF is the security
property being bought. Acuye passes the same budget through memory-hard Argon2id.

Vault work after unlock (Acuye Pass, measured):

| Items | Reload + decrypt all | Search | Security report |
| --- | --- | --- | --- |
| 1,000 | 9 ms | 0.5 ms | 1.0 ms |
| 5,000 | 51 ms | 2.5 ms | 5.3 ms |
| 20,000 | 193 ms | 11 ms | 26 ms |

Timings vary by roughly ±10% between runs; values are rounded.

Where the felt difference lives is architecture, not crypto: Acuye Pass has no
server call in the unlock path, no vault sync, no extension content script and no
native-messaging hop. Bitwarden authenticates against its server (or yours) and
syncs the vault; 1Password validates a session and hydrates from its cloud. Those
hops buy sync, sharing, passkeys and autofill — the features Acuye Pass lacks.

> Competitor *KDF* rows are equivalent local work measured on the same machine at
> each vendor's default parameters. Competitor *network* overhead was **not**
> measured for this document (no Bitwarden/1Password account or app was run) and
> depends on your latency to their servers.

## Security model

This is the most interesting axis, because all three make defensible but
different choices.

| | **Acuye Pass** | **Bitwarden** | **1Password** |
| --- | --- | --- | --- |
| Key derivation | Argon2id, 64 MiB, t=3, p=1, per-account salt | PBKDF2-SHA256 (600k iterations) or Argon2id, per-account salt | PBKDF2-SHA256, 2SKD (derived key + 128-bit Secret Key) |
| Item encryption | XChaCha20-Poly1305, random 24-byte nonce, AAD binds vault id + item id | AES-256-CBC + HMAC-SHA256 | AES-256-GCM |
| Extra account secret | No — master password only | No | Yes — 128-bit Secret Key stored on device |
| Where keys live | Rust process only; frontend never sees keys or plaintext | Client-side in the app/extension | Client-side in the app/extension |
| Master-password change | New salt, new derived keys, **new vault key**, full re-encrypt in one SQLite transaction | Re-wraps keys, full re-encrypt of vault | Re-wraps keys, full re-encrypt |
| Biometric unlock | None, by design | Windows Hello / Touch ID / Face ID | Biometrics on all supported platforms |
| Verified never-plaintext-on-disk | Yes — regression test asserts no titles, passwords, URLs, notes, card numbers or TOTP secrets in the database | Yes (same property, cloud-stored ciphertext) | Yes |
| Threat model | Protects the vault file/backup against someone without the master password. Does **not** defend a compromised machine, clipboard or screen | Cloud breach, server compromise, device theft | Same as Bitwarden, plus Secret Key defeats credential-stuffing of a stolen master password |
| Audits | **None** | Public reports, repeated third-party audits | Public Trust Center reports |

Notes that matter:

- **Argon2id vs PBKDF2.** Argon2id is the modern memory-hard choice and Acuye
  Pass uses it with sane parameters (64 MiB, 3 passes, including on encrypted
  exports). Bitwarden also offers Argon2id; 1Password still uses PBKDF2 but
  compensates with the Secret Key, which means an attacker who steals the
  encrypted vault and the master password *still* cannot decrypt it without a
  device that holds the Secret Key.
- **XChaCha20-Poly1305 vs AES.** Both are sound. XChaCha20's 24-byte nonce makes
  random nonces safe without counters, and per-item AAD means a ciphertext
  cannot be moved between items or vaults — tampering fails closed.
- **The gap that matters most:** Acuye Pass has had **no external audit**. Its
  crypto design is documented and tested, but "documented and tested" is not
  "audited". Bitwarden and 1Password have had many.

## Feature comparison

| Feature | **Acuye Pass** | **Bitwarden** | **1Password** |
| --- | --- | --- | --- |
| Logins, notes, cards, identities | Yes | Yes | Yes |
| Documents / file attachments | Yes (document item type) | Yes (1 GB, paid) | Yes |
| Custom fields and tags | Yes | Yes | Yes |
| Built-in TOTP authenticator | Yes (TOTP + HOTP, codes computed in Rust) | Yes (paid plans) | Yes (all plans) |
| TOTP autofill into sites | No | Yes | Yes |
| Secret manager (API keys, env-scoped, rotation/expiry alerts, access history) | Yes, local | Yes (Secrets Manager, separate paid product) | Yes (Service accounts / Developer tools) |
| Password generator | Yes (CSPRNG passwords + EFF passphrase) | Yes | Yes |
| Password strength / reuse / age report | Yes (Security Center score) | Yes (vault health reports) | Yes (Watchtower) |
| Breach monitoring | Yes (HIBP Pwned Passwords, k-anonymity, only 5 hash chars sent) | Yes (paid) | Yes (Watchtower alerts) |
| Passkeys | **No** | Yes, including native Windows 11 / macOS providers | Yes |
| Browser autofill | Fills when a page host matches one saved login (or from the popup); no save prompts | Yes | Yes (best in class) |
| SSH agent | No (stores SSH keys as secret items only) | Yes | Yes |
| Import | Acuye JSON, Bitwarden JSON/CSV, Chrome/Edge CSV, 1Password CSV, generic CSV | Broad, incl. direct 1Password import | Broad |
| Encrypted export | Yes (Argon2id + XChaCha20-Poly1305 envelope) | Yes | Yes (1PUX) |
| Plaintext export | Yes, with explicit warning | Yes, with warning | Yes, with warning |
| Encrypted backups / atomic restore | Yes | n/a (server-held) | n/a (server-held) |
| Sync across devices | **No cloud sync.** Hostless LAN pairing + sync to another PC is implemented; `acuye-sync/1` BYO-backend protocol is specified but has **no provider** | Cloud sync or self-hosted server | Cloud sync |
| Conflict handling | Per-item, newest revision wins, conflicts retained in a log | Per-item | Per-item |
| Multiple users / sharing | **None** | Yes | Yes |
| Emergency access | **No** | Yes (paid) | Yes (paid, family/business) |
| Secure link / Send to non-users | **No** | Yes (Bitwarden Send) | Yes (item links) |
| Per-item sharing with another person | **No** | Yes, free | Yes |
| Self-hosting | N/A — no server | Yes (Enterprise, Docker) | No |
| CLI | No | Yes | Yes |
| Mobile apps | **Yes** (Android APK, CI-built) | Yes | Yes |
| Linux / macOS desktop | Tauri code is cross-platform-capable; **Windows is the shipped, supported target** | Yes | Yes |
| Travel Mode / deniable vaults | No | No | Yes |
| Themes / UI polish | Six accent themes, light/dark/system, reduced-motion, custom title bar, command palette | Polished, conventional | Most polished of the three |
| Updates | Signed, from project GitHub only, downgrades rejected, nothing auto-installs without consent | Standard app-store/auto-update | Standard auto-update |
| Telemetry / analytics | **None** | Some product analytics (opt-out / policy-controlled) | Some product analytics (policy-controlled) |

## Cost

| | **Acuye Pass** | **Bitwarden** | **1Password** |
| --- | --- | --- | --- |
| Free use | Everything, forever | Free plan (unlimited passwords/devices, no TOTP, no attachments, no emergency access) | None — 14-day trial only |
| Individual | $0 | $19.80/yr (~$1.65/mo) | $47.88/yr (~$3.99/mo); promo ~$35.88 first year |
| Family | $0 (no sharing, so not comparable) | $47.88/yr, 6 users | $71.88/yr (~$5.99/mo), 5 users |
| Small team | Not supported | Teams $4/user/mo | Teams Starter Pack $24.95/mo, up to 10 users |
| Business / enterprise | Not supported | Enterprise $6/user/mo | Business $8.99/user/mo |
| Hidden cost | Your time: manual popup fill, no sync, manual backups | Free tier upsells TOTP and attachments | No free tier at all |

Acuye Pass is free because it is a single-developer MIT project with no
infrastructure to pay for. That is also its biggest risk: no revenue means no
security team, no audit budget and no support contract.

## Where each one wins

**Acuye Pass wins on:**

1. **Attack surface.** No server, no account, no telemetry, no third-party
   favicon service. The optional extension adds a local native-messaging host
   and no network code. Two outbound request types exist at all (signed update
   check, opt-in favicon fetch), both host-restricted.
2. **Zero-knowledge without trust in a vendor.** Nothing to breach, nothing to
   subpoena, nothing to leak. The vault is a SQLite file you own.
3. **Transparency.** Full MIT source, including the cryptography; every
   primitive and parameter is documented in `docs/SECURITY.md`.
4. **Master-password rotation.** Rotating generates a new vault key and
   re-encrypts every item in one transaction — a stronger property than most
   managers advertise.
5. **Price.** $0 with no feature gating.
6. **Auditability of behaviour.** Update signing, downgrade rejection, SSRF
   guards on URL opening/favicons, and a test that asserts no plaintext reaches
   the database.

**Bitwarden wins on:**

1. **Openness plus scale.** Open source like Acuye Pass, but audited, with a
   paid team, a free tier that actually covers daily use, and years of
   hardening.
2. **Self-hosting.** You can own the server as well as the client.
3. **Sharing.** Organizations, collections, Send links and emergency access.
4. **Price for what you get.** $19.80/yr for TOTP, attachments, emergency
   access and health reports is the best value in the category.
5. **Passkeys**, including native Windows 11 / macOS providers.

**1Password wins on:**

1. **Usability.** Autofill, save prompts and passkey flows are the smoothest of
   the three, and that is what actually keeps people using a password manager.
2. **Secret Key model.** A stolen master password alone is not enough to
   decrypt a stolen vault.
3. **Extras that remove real work.** SSH agent, Travel Mode, Watchtower, item
   links to non-users, developer tools.
4. **Support and accountability.** Paid support, published audits, compliance
   certifications.

## Honest verdict

- **If you need a password manager today, for real accounts:** use Bitwarden.
  It is open source, cheap, audited, and Acuye Pass has no automatic autofill,
  no passkeys and no sync to your phone.
- **If you value polish and will pay for it:** 1Password. The Secret Key and the
  autofill quality justify the price for many people.
- **If you want a Windows-only, offline, no-account vault and you are willing to
  copy passwords by hand and manage your own backups:** Acuye Pass is a
  credible, unusually well-documented option — with the explicit caveats that
  it is pre-1.0, unaudited, and has no browser integration.

### What Acuye Pass would need to become competitive

In rough priority order, based on the gaps above:

1. An independent security audit, published.
2. A browser extension with autofill (the single largest usability gap).
3. A real sync provider for `acuye-sync/1`, or LAN sync promoted from
   hostless pairing to a supported daily workflow.
4. Passkey storage and use.
5. A macOS/Linux release, then mobile.
6. Sharing, emergency access, and a way to send a secret to someone without an
   account.
7. A second maintainer, so the project does not depend on one person.

Items 1–3 are the difference between "interesting local vault" and "password
manager most people could switch to".

## Sources

- Acuye Pass: `README.md`, `docs/SECURITY.md`, `docs/ARCHITECTURE.md`,
  `docs/PRIVACY.md`, `docs/SYNC_PROTOCOL.md`, `crates/*`, `apps/desktop/*` in
  this repository (v0.1.6).
- Bitwarden: <https://bitwarden.com/pricing>, <https://bitwarden.com/tools-and-features/>,
  <https://bitwarden.com/open-source>, <https://bitwarden.com/help/self-host-bitwarden/>,
  <https://bitwarden.com/blog/bitwarden-2026-product-roundup/>.
- 1Password: <https://1password.com/pricing/personal>, <https://1password.com/pricing/business>,
  <https://1password.com/features>, <https://www.1password.dev/ssh/agent>.
- Pricing and features checked November 2026. Vendor promotional pricing may
  differ from renewal pricing; verify before purchasing.
