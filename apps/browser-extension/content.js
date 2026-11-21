// Content script: detects login forms and fills them from the local vault.
//
// It never sees the vault key and never asks for the master password; it asks
// the background worker, which only answers while the native host has an
// unlocked session. With no session it shows a small badge instead.

const BADGE_ID = "acuye-pass-autofill-badge";
let attempted = false;

function send(command, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ target: "background", command, payload: payload || {} }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response || !response.ok) {
        reject(new Error((response && response.error) || "The vault did not answer."));
      } else {
        resolve(response.data);
      }
    });
  });
}

function isVisible(node) {
  const style = window.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden" || node.disabled) return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 2 && rect.height > 2;
}

function loginFields() {
  const password = Array.from(document.querySelectorAll('input[type="password"]')).find(isVisible);
  if (!password) return null;
  let username = null;
  for (const candidate of Array.from(document.querySelectorAll("input"))) {
    if (candidate === password || !isVisible(candidate)) continue;
    const type = (candidate.getAttribute("type") || "text").toLowerCase();
    const autocomplete = (candidate.getAttribute("autocomplete") || "").toLowerCase();
    if (type !== "text" && type !== "email" && type !== "tel") continue;
    if (autocomplete.includes("username") || type === "email") {
      username = candidate;
      break;
    }
    const before = candidate.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (before && !username) username = candidate;
  }
  return { username, password };
}

function setValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillForm(username, password) {
  const fields = loginFields();
  if (!fields) return false;
  if (fields.username && username) setValue(fields.username, username);
  setValue(fields.password, password);
  fields.password.focus();
  return true;
}

function otpField() {
  const selectors = [
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[name*="totp" i]',
    'input[id*="otp" i]',
    'input[inputmode="numeric"]',
  ];
  for (const selector of selectors) {
    const node = Array.from(document.querySelectorAll(selector)).find(isVisible);
    if (node) return node;
  }
  return null;
}

function badge(text, tone, onClick, autoHide) {
  let node = document.getElementById(BADGE_ID);
  if (!node) {
    node = document.createElement("div");
    node.id = BADGE_ID;
    node.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "gap:6px",
      "padding:7px 11px",
      "border-radius:999px",
      "font:12px/1.2 system-ui,-apple-system,'Segoe UI',sans-serif",
      "box-shadow:0 6px 24px rgba(0,0,0,.22)",
      "cursor:pointer",
      "user-select:none",
      "border:1px solid rgba(255,255,255,.16)",
    ].join(";");
    document.documentElement.append(node);
  }
  node.textContent = text;
  node.style.background = tone === "error" ? "#7f1d1d" : tone === "ok" ? "#065f46" : "#111827";
  node.style.color = "#f9fafb";
  node.onclick = onClick || null;
  if (autoHide) {
    window.setTimeout(() => {
      if (node && node.textContent === text) node.remove();
    }, autoHide);
  } else {
    window.setTimeout(() => node && node.remove(), 8000);
  }
}

async function autofill() {
  if (attempted || window.top !== window.self) return;
  if (!loginFields()) return;
  const settings = await chrome.storage.local.get({ autofill: true });
  if (!settings.autofill) return;
  attempted = true;

  let matches;
  try {
    const result = await send("match", { host: location.hostname });
    matches = result.items || [];
  } catch {
    // Host not installed, no account, or the vault is locked: stay silent
    // rather than nagging on every page load.
    return;
  }

  if (matches.length === 0) return;
  if (matches.length > 1) {
    badge(`${matches.length} Acuye logins`, "info", () => fillFirst(matches[0]));
    return;
  }
  await fillFirst(matches[0]);
}

async function fillFirst(match) {
  try {
    const credentials = await send("fill", { itemId: match.id });
    if (!fillForm(credentials.username || "", credentials.password || "")) return;
    const field = otpField();
    if (field) {
      try {
        const { code } = await send("totp", { itemId: match.id });
        if (code) setValue(field, code);
      } catch {
        // No authenticator attached to this login.
      }
    }
    badge(`Filled from Acuye Pass · ${match.title}`, "ok", null, 2500);
  } catch (error) {
    badge(error.message, "error", null, 4000);
  }
}

const start = () => {
  void autofill();
  // Single-page apps often mount the form after load.
  window.setTimeout(() => {
    attempted = false;
    void autofill();
  }, 1500);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
