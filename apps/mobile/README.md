# Acuye Pass for Android

A React Native client over the **same Rust crates as the desktop app**. There is
no second implementation of the security model: `apps/mobile/android` loads
`libacuye_ffi.so`, which opens the vault, derives keys (Argon2id), unwraps the
vault key and decrypts items. JavaScript only receives JSON for display.

## What works

- First-run account creation, unlock with a master password, lock.
- Multiple local accounts in one database (account picker).
- Search across titles, usernames and sites.
- Item detail: username, password, website, card number, secret, notes — each
  reveal/copy is explicit.
- Live TOTP codes for logins with an `otpauth` secret and for authenticator items.
- Create a login, with the desktop password generator.
- `minSdk 24` (Android 7), `targetSdk 36`, ABIs `armeabi-v7a` and `arm64-v8a`.

## Not implemented yet

- Editing or deleting items, folders/tags management, import/export.
- Sync, breach checks, recovery settings, biometric unlock.
- Android autofill service (the host matching function exists in Rust but no
  `AutofillService` is registered).

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
