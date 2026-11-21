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

The release APK is signed with the CI keystore generated in the workflow; it is
installable for testing but **not** a store-ready signature. Provide
`ACUYE_KEYSTORE_PATH`, `ACUYE_KEYSTORE_PASSWORD`, `ACUYE_KEY_ALIAS` and
`ACUYE_KEY_PASSWORD` to sign with your own key.
