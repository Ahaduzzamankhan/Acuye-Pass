# Acuye Pass mobile (scaffold)

This package is an intentionally empty React Native scaffold. It renders a
single screen explaining that mobile is not available yet.

It contains **no** vault, cryptography, authentication, sync or network code.
Do not add a second implementation of the security model here: any future
mobile client should consume the Rust core through `acuye-ffi` (or an equivalent
audited binding) rather than reimplementing encryption in JavaScript.

## Running

```bash
pnpm --filter @acuye/mobile install
pnpm --filter @acuye/mobile start
```

Native projects (`android/`, `ios/`) are not committed. Generate them with the
React Native CLI if work on this target begins.
