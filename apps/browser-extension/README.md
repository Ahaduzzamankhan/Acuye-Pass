# Acuye Pass browser extension

Manifest V3 popup for Chrome/Chromium. It unlocks a local Acuye Pass vault through
a native messaging host and fills the active page's login form when you press
**Fill**. No content scripts, no telemetry, no network requests.

Build and install instructions, the protocol and the security model are in
[docs/BROWSER_EXTENSION.md](../../docs/BROWSER_EXTENSION.md).

```bash
cargo build --release -p acuye-browser-host
# then: chrome://extensions → Developer mode → Load unpacked → this folder
apps/browser-extension/install/install-linux.sh <extension-id>
```
