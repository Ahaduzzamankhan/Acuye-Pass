// Service worker: the only place that talks to the native host.
//
// The popup cannot call chrome.runtime.connectNative itself, so it sends
// { command, payload } messages here and gets { ok, data | error } back. One
// native port is shared, and every in-flight request is matched by id.

const HOST_NAME = "com.fluxenite.acuyepass";

let port = null;
let nextId = 0;
const pending = new Map();

function failAll(reason) {
  for (const entry of pending.values()) entry.reject(new Error(reason));
  pending.clear();
}

function ensurePort() {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST_NAME);
  port.onMessage.addListener((message) => {
    const entry = pending.get(message && message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.ok) entry.resolve(message.data);
    else entry.reject(new Error(message.error || "The Acuye Pass host refused the request."));
  });
  port.onDisconnect.addListener(() => {
    const reason =
      (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
      "The Acuye Pass native host is not installed or the desktop app is not available.";
    port = null;
    failAll(reason);
  });
  return port;
}

function call(command, payload = {}) {
  return new Promise((resolve, reject) => {
    let channel;
    try {
      channel = ensurePort();
    } catch (cause) {
      reject(new Error(`Could not start the Acuye Pass native host: ${cause.message}`));
      return;
    }
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    try {
      channel.postMessage({ id, command, ...payload });
    } catch (cause) {
      pending.delete(id);
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    }
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== "background") return undefined;
  call(message.command, message.payload)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  // Keep the message channel open for the async reply.
  return true;
});

// Drop the in-memory vault when the extension is updated or the browser shuts
// down; the host process also exits when its port closes.
chrome.runtime.onSuspend.addListener(() => {
  if (port) {
    try {
      port.postMessage({ id: ++nextId, command: "lock" });
    } catch {
      // The port is already gone.
    }
  }
});
