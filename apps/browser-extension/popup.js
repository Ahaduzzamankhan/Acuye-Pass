// Popup UI. All vault work happens in the native host; this file only renders
// non-secret fields and, on request, injects a chosen login into the tab.

const el = (id) => document.getElementById(id);

const views = {
  unlock: el("unlock-view"),
  vault: el("vault-view"),
  error: el("error-view"),
};

const state = {
  items: [],
  busy: false,
};

async function request(command, payload) {
  const response = await chrome.runtime.sendMessage({
    target: "background",
    command,
    payload: payload || {},
  });
  if (!response || !response.ok) {
    throw new Error((response && response.error) || "The Acuye Pass host did not answer.");
  }
  return response.data;
}

function show(name) {
  Object.entries(views).forEach(([key, node]) => {
    node.hidden = key !== name;
  });
}

function showError(error) {
  el("error").textContent =
    error instanceof Error ? error.message : String(error || "Something went wrong.");
  show("error");
}

function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = busy;
  });
}

function setSubtitle(text) {
  el("subtitle").textContent = text;
}

async function loadAccounts() {
  const data = await request("accounts");
  const select = el("account");
  select.replaceChildren();
  for (const account of data.accounts) {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent = `${account.username} — ${account.vaultName}`;
    select.append(option);
  }
  if (data.accounts.length === 0) {
    throw new Error("No account exists yet. Create one in the Acuye Pass desktop app first.");
  }
  return data.accounts[0].id;
}

async function showUnlock() {
  const accountId = await loadAccounts();
  el("lock").hidden = true;
  setSubtitle("Locked");
  el("account").value = accountId;
  show("unlock");
  el("password").focus();
}

async function renderItems(query) {
  const data = await request("list", { query: query || "" });
  state.items = data.items;
  const list = el("items");
  list.replaceChildren();
  for (const item of state.items) {
    const li = document.createElement("li");
    li.className = "item";

    const text = document.createElement("div");
    text.className = "item-text";
    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = item.title;
    const sub = document.createElement("span");
    sub.className = "item-sub";
    sub.textContent = [item.username, item.host].filter(Boolean).join(" · ");
    text.append(title, sub);

    li.append(text);

    if (item.hasTotp) {
      const totp = document.createElement("button");
      totp.type = "button";
      totp.className = "fill";
      totp.textContent = "2FA";
      totp.title = "Copy the current one-time code";
      totp.addEventListener("click", () => {
        void copyTotp(item.id, totp);
      });
      li.append(totp);
    }

    const fill = document.createElement("button");
    fill.type = "button";
    fill.className = "fill";
    fill.textContent = "Fill";
    fill.addEventListener("click", () => {
      void fillItem(item.id);
    });

    li.append(fill);
    list.append(li);
  }
  el("empty").hidden = state.items.length > 0;
}

async function showVault(status) {
  setSubtitle(`${status.username} · ${status.vaultName}`);
  el("lock").hidden = false;
  show("vault");
  await renderItems("");
  el("search").focus();
}

/** Injected into the page: fill the first visible login form. */
function fillLoginForm(username, password) {
  const isVisible = (node) => {
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || node.disabled) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  };
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const passwords = Array.from(document.querySelectorAll('input[type="password"]')).filter(
    isVisible,
  );
  const target = passwords[0];
  if (!target) return false;

  let usernameInput = null;
  for (const candidate of Array.from(document.querySelectorAll("input"))) {
    if (candidate === target || !isVisible(candidate)) continue;
    const type = (candidate.getAttribute("type") || "text").toLowerCase();
    const autocomplete = (candidate.getAttribute("autocomplete") || "").toLowerCase();
    if (type !== "text" && type !== "email" && type !== "tel") continue;
    if (autocomplete.includes("username") || type === "email") {
      usernameInput = candidate;
      break;
    }
    const beforeTarget =
      candidate.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (beforeTarget && !usernameInput) usernameInput = candidate;
  }

  if (usernameInput && username) setValue(usernameInput, username);
  setValue(target, password);
  target.focus();
  return true;
}

async function copyTotp(itemId, button) {
  try {
    const { code } = await request("totp", { itemId });
    await navigator.clipboard.writeText(code);
    button.textContent = code;
    window.setTimeout(() => {
      button.textContent = "2FA";
    }, 2000);
  } catch (error) {
    showError(error);
  }
}

async function fillItem(itemId) {
  if (state.busy) return;
  setBusy(true);
  try {
    const credentials = await request("fill", { itemId });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id !== "number") throw new Error("No active tab to fill.");
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: fillLoginForm,
      args: [credentials.username || "", credentials.password || ""],
    });
    if (!results.some((result) => result.result === true)) {
      throw new Error("No login form was found on this page.");
    }
    window.close();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function unlock() {
  if (state.busy) return;
  setBusy(true);
  el("host-state").textContent = "Unlocking…";
  try {
    const password = el("password").value;
    if (!password) throw new Error("Enter your master password.");
    await request("unlock", { accountId: el("account").value, password });
    el("password").value = "";
    const status = await request("status");
    el("host-state").textContent = "Host connected";
    await showVault(status);
  } catch (error) {
    el("password").value = "";
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function boot() {
  try {
    const status = await request("status");
    el("host-state").textContent = "Host connected";
    if (status.locked) await showUnlock();
    else await showVault(status);
  } catch (error) {
    showError(error);
  }
}

el("unlock").addEventListener("click", () => void unlock());
el("password").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void unlock();
  }
});
el("retry").addEventListener("click", () => {
  el("host-state").textContent = "Native host";
  void boot();
});
el("lock").addEventListener("click", async () => {
  el("lock").disabled = true;
  try {
    await request("lock");
  } catch {
    // The host is gone, which also clears the session.
  }
  el("lock").disabled = false;
  el("host-state").textContent = "Host connected";
  await showUnlock();
});
el("search").addEventListener("input", (event) => {
  void renderItems(event.target.value).catch(showError);
});

void boot();
