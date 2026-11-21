# Browser extension

The repository ships a Manifest V3 extension for Chrome and other Chromium
browsers in [`apps/browser-extension`](../apps/browser-extension), plus a native
messaging host in [`crates/acuye-browser-host`](../crates/acuye-browser-host).

The popup unlocks one local vault, searches its logins and fills the active tab's
login form. A content script also fills logins automatically on page load when
the vault is already unlocked and the page host matches exactly one saved login.
There is no save prompt, no passkey support and no network code.

> **Status: not distributed.** The extension is loaded unpacked from this folder
> and the host has to be registered manually (see below). It is not in the Chrome
> Web Store and has not been reviewed by Google or audited by anyone else.

## How it fits together

```
popup.js ──chrome.runtime──▶ background.js ──native messaging──▶ acuye-browser-host
                                                                       │
                                                              acuye.db (SQLite)
```

- **popup.js** renders accounts, a master-password field, a search box and a list
  of logins (with a 2FA button that copies the current one-time code). It never
  sends the master password anywhere except to the service worker.
- **content.js** runs on http/https pages, detects a login form, asks for logins
  matching the page host and fills the form. It only fills when exactly one
  login matches, and only while the host has an unlocked session; otherwise it
  shows a small badge and does nothing.
- **background.js** is the only place that opens a native messaging port. It
  forwards `{ command, payload }` requests and matches replies by id.
- **acuye-browser-host** opens the same encrypted database as the desktop app,
  unlocks one vault in memory with the password you typed, and answers
  `accounts`, `status`, `unlock`, `list`, `match`, `fill`, `totp` and `lock`.
  `totp` generates the current RFC 6238 code in Rust; the secret never leaves
  the host.
- **Filling** happens in the popup: `chrome.scripting.executeScript` injects a
  single function into the active tab that writes the username/password into the
  first visible login form and dispatches `input`/`change` events.

## Install (development)

1. Build the host:

   ```bash
   cargo build --release -p acuye-browser-host
   ```

2. Load the extension: open `chrome://extensions`, enable **Developer mode**,
   choose **Load unpacked** and select `apps/browser-extension`. Copy the
   extension ID Chrome shows.

3. Register the host. The installer writes the host manifest with your extension
   ID and the absolute host path.

   ```bash
   # Linux
   apps/browser-extension/install/install-linux.sh <extension-id>

   # macOS
   apps/browser-extension/install/install-macos.sh <extension-id>
   ```

   ```powershell
   # Windows
   .\apps\browser-extension\install\install-windows.ps1 -ExtensionId <extension-id>
   ```

   Pass a second argument (or `-HostPath`) if the binary is not at
   `target/release/acuye-browser-host[.exe]`.

4. Reload the extension and open its popup. You need an existing vault: create
   one in the desktop app first.

`allowed_origins` lists exactly the extension ID you passed, so a different
extension cannot launch the host.

## Security model

| Concern | Behaviour |
| --- | --- |
| Network | None. The host opens a local SQLite file and writes to stdout only. |
| Key material | Lives in the short-lived host process, not in the extension. |
| Master password | Sent over the native pipe from the popup, used for one `unlock`, never persisted. |
| Session lifetime | The host exits when the browser closes the port; an idle session locks after 10 minutes. |
| Data written | Nothing. The host only reads; new items still come from the desktop app. |
| Extension permissions | `nativeMessaging`, `activeTab`, `scripting`, `storage`, plus `http://*/*` and `https://*/*` host access for the autofill content script. No `tabs`, no `webRequest`, no cookies. |
| Autofill trigger | Only when the page host matches exactly one saved login and the host already has an unlocked session. Never prompts for the master password. |
| Rendering | Item titles and usernames are set with `textContent`, never `innerHTML`. |
| Scope of fill | One visible login form in the active tab (all frames). No form submission, no reading of page data. |

What this does **not** protect against:

- Malware on the machine, or another extension with the same ID.
- Pages that render their login form inside a closed shadow root or a
  cross-origin iframe without a fillable password input.
- A browser profile that is already compromised while the host is unlocked.
- Anyone who knows the master password.

## Limitations

- Chrome/Chromium only. Firefox needs `browser_specific_settings` and a different
  native messaging manifest; Safari needs an Xcode project. Neither ships here.
- Autofill fills the first visible login form and submits nothing. Pages that
  render inside closed shadow roots, or that show the form only after a click,
  are not filled.
- There is no keyboard shortcut or context-menu entry yet.
- Logins only (`ItemFields::Login`). TOTP codes, cards, notes and secrets are not
  offered.
- Passwords are copied into the page; there is no isolated-world or privileged
  fill API, so a page script can read what was typed into its own inputs.
- No account creation, item editing or vault management from the popup.

## Protocol

Native messaging frames are a 4-byte little-endian length followed by UTF-8
JSON, in both directions. Requests carry an `id` that the response echoes.

```json
{ "id": 3, "command": "unlock", "accountId": "…", "password": "…" }
{ "id": 3, "ok": true, "data": { "accountId": "…", "username": "ada", "vaultName": "Personal" } }
```

`fill` returns `{ title, username, password, url }` for one login item; `totp`
returns `{ code, remaining, period }`; every other command returns metadata only.
