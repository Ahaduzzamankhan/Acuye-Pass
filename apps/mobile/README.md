# Acuye Pass for Android

A React Native client over the **same Rust crates as the desktop app**. There is
no second implementation of the security model: `apps/mobile/android` loads
`libacuye_ffi.so`, which opens the vault, derives keys (Argon2id), unwraps the
vault key and decrypts items. JavaScript only receives JSON for display.

Every desktop feature is reachable through one JSON command router
(`crates/acuye-ffi/src/mobile.rs`), so the two apps share item CRUD, imports,
exports, recovery, TOTP and the security scan.

## What works

- First-run account creation, unlock with a master password, lock, auto-lock
  (enforced in Rust and mirrored by the UI), multiple local accounts.
- All eight item types — login, secure note, card, identity, document, custom,
  authenticator and secret — with create, edit, delete, duplicate, favourite,
  tags and notes.
- Search across titles, usernames, sites, tags and notes, plus category filters.
- Live TOTP/HOTP codes for authenticator items and for logins with an
  `otpauth` secret, counter advance, setup-URI export and duplicate detection.
- Secret manager entries with reveal/copy, per-field concealment, access
  history, expiry and rotation reminders.
- Local security report: weak, reused, old and empty passwords with a 0-100
  hygiene score. No password leaves the phone.
- Password and passphrase generators with the desktop options and a strength
  meter.
- Recovery: enrol a one-time code and three security questions, get back in
  with either, and receive a rotated code afterwards.
- Devices list with revocation, database backups (create/list/restore),
  encrypted JSON export, plaintext CSV export behind an explicit warning, and
  import from Acuye, Bitwarden (JSON/CSV), Chrome, 1Password and generic CSV.
- Appearance: light/dark/system, the six desktop accent colours, compact
  density and reduced motion.
- Clipboard auto-clear for every copied secret.
- `minSdk 24` (Android 7), `targetSdk 36`, ABIs `armeabi-v7a` and `arm64-v8a`.

## Not implemented on Android

- Autofill service (the Rust host-matching helper exists, no `AutofillService`
  is registered), biometric unlock, cloud sync, LAN pairing and the in-app
  updater. Those remain desktop-only or future work.
- Online breach lookup: the mobile build ships the local scan only, so it makes
  no network requests at all.
- A Play Store listing; the APK is a CI artifact.

## Build

The APK is built by CI (`.github/workflows/android.yml`):

1. `npm install` in this folder,
2. `cargo ndk -t arm64-v8a -t armeabi-v7a -o android/app/src/main/jniLibs build -p acuye-ffi --release`,
3. `gradle assembleRelease` in `android/`.

Locally you need JDK 17, Android SDK 36, NDK 27, Rust targets
`aarch64-linux-android` and `armv7-linux-androideabi`, and `cargo-ndk`.

Locally you can sign with your own key by exporting `ACUYE_KEYSTORE_PATH`,
`ACUYE_KEYSTORE_PASSWORD`, `ACUYE_KEY_ALIAS` and `ACUYE_KEY_PASSWORD` before
`gradle assembleRelease`.

## Release builds

`.github/workflows/android-release.yml` builds a signed release APK on every
`v*` tag and can also be started by hand from the Actions tab (workflow dispatch,
with an optional version name). A tag run attaches the APK
(`acuye-pass-<version>.apk`) to a GitHub release; a manual run leaves it as the
`acuye-pass-android-release` artifact.

The version name and code come from the tag (or the dispatch input) and
`apps/mobile/package.json`, and are passed to Gradle as `acuyeVersionName` and
`acuyeVersionCode`.

To sign with a real key, add these repository secrets:

| Secret | Value |
| --- | --- |
| `ACUYE_KEYSTORE_BASE64` | base64 of the `.keystore` file (`base64 -w0 release.keystore`) |
| `ACUYE_KEYSTORE_PASSWORD` | keystore password |
| `ACUYE_KEY_ALIAS` | key alias |
| `ACUYE_KEY_PASSWORD` | key password |

Without them the workflow generates a throwaway key so the build still
succeeds; that APK installs for testing but is **not** a store identity.
