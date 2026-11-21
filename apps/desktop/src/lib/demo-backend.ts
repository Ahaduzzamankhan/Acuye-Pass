/**
 * Browser-preview backend.
 *
 * The cloud/browser preview cannot run a Tauri webview, so this adapter keeps
 * the interface exercised with in-memory data and localStorage. It is NOT the
 * password manager: it performs no encryption and must never hold real secrets.
 * The shipped desktop application always uses `TauriBackend`.
 */

import type { Backend } from "./backend";
import {
  DEFAULT_SETTINGS,
  BackendError,
  type AccountSummary,
  type AppSettings,
  type AppStatus,
  type BackupInfo,
  type CopyResult,
  type DeviceView,
  type ExportInfo,
  type ImportResult,
  type Item,
  type ItemFields,
  type ItemFieldsInput,
  type ItemSummary,
  type ItemType,
  type ParsedImport,
  type PassphraseOptions,
  type PasswordOptions,
  type PasswordStrength,
  type SecurityReport,
  type SessionView,
  type StorageInfo,
  type TypedItem,
  type UpdateStatusView,
  type VaultCounts,
} from "./types";

import type {
  BreachItemResult,
  BreachScanResult,
  LanIdentity,
  LanOffer,
  LanPairResult,
  LanPeer,
  LanSyncResult,
  SecretAccessEntry,
  SecretAlert,
  TotpEntry,
} from "./types";

const STORAGE_KEY = "acuye-preview-state-v1";

interface PreviewAccount {
  vaultId: string;
  username: string;
  secret: string;
  vaultName: string;
}

interface PreviewState {
  username: string | null;
  secret: string | null;
  items: TypedItem[];
  settings: AppSettings;
  unlocked: boolean;
  accounts: PreviewAccount[];
  activeVaultId: string | null;
}

const now = () => Math.floor(Date.now() / 1000);

const DEMO_ITEMS: Array<{ title: string; fields: ItemFields; notes?: string; tags?: string[] }> = [
  {
    title: "GitHub",
    fields: {
      kind: "login",
      username: "ada@example.com",
      password: "Preview-Only-Pass-42!",
      url: "https://github.com",
      totp: "",
      password_changed_at: now() - 86_400 * 21,
    },
    tags: ["work", "code"],
  },
  {
    title: "Proton Mail",
    fields: {
      kind: "login",
      username: "ada@proton.me",
      password: "Preview-Only-Pass-42!",
      url: "https://mail.proton.me",
      totp: "",
      password_changed_at: now() - 86_400 * 400,
    },
    tags: ["email"],
  },
  {
    title: "Home Wi-Fi",
    fields: { kind: "secure_note" },
    notes: "Router admin lives under the desk. Guest network is separate.",
    tags: ["home"],
  },
  {
    title: "Travel Card",
    fields: {
      kind: "card",
      cardholder: "Ada Lovelace",
      number: "4111 1111 1111 1111",
      expiry_month: "09",
      expiry_year: "2029",
      cvv: "123",
      brand: "Visa",
      pin: "",
    },
  },
];

function loadState(): PreviewState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PreviewState;
      parsed.unlocked = false;
      if (!Array.isArray(parsed.accounts)) {
        parsed.accounts =
          parsed.username && parsed.secret
            ? [
                {
                  vaultId: "preview-vault",
                  username: parsed.username,
                  secret: parsed.secret,
                  vaultName: "Personal",
                },
              ]
            : [];
      }
      parsed.activeVaultId = parsed.accounts[0]?.vaultId ?? null;
      return parsed;
    }
  } catch {
    // fall through to seed
  }
  const seeded: PreviewState = {
    username: null,
    secret: null,
    items: [],
    settings: DEFAULT_SETTINGS,
    unlocked: false,
    accounts: [],
    activeVaultId: null,
  };
  return seeded;
}

function seedItems(vaultUnlocked: boolean): TypedItem[] {
  if (!vaultUnlocked) return [];
  return DEMO_ITEMS.map((demo) => ({
    id: crypto.randomUUID(),
    title: demo.title,
    notes: demo.notes ?? "",
    tags: demo.tags ?? [],
    favorite: false,
    created_at: now() - 86_400 * 30,
    updated_at: now() - 86_400,
    ...demo.fields,
  })) as TypedItem[];
}

function toSummary(item: TypedItem): ItemSummary {
  let subtitle = "";
  if (item.kind === "login") subtitle = item.username || hostOf(item.url);
  if (item.kind === "card") subtitle = item.brand || item.cardholder;
  if (item.kind === "identity") subtitle = item.email || `${item.first_name} ${item.last_name}`;
  if (item.kind === "document") subtitle = item.filename;
  if (item.kind === "custom") subtitle = item.fields[0]?.label ?? "";
  return {
    id: item.id,
    title: item.title,
    item_type: item.kind,
    subtitle,
    favorite: item.favorite,
    tags: item.tags,
    updated_at: item.updated_at,
    host: item.kind === "login" ? hostOf(item.url) : "",
    has_password: item.kind === "login" ? item.password.length > 0 : false,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function emptyCounts(): VaultCounts {
  return {
    total: 0,
    favorites: 0,
    logins: 0,
    notes: 0,
    cards: 0,
    identities: 0,
    documents: 0,
    custom: 0,
  };
}

function randomPassword(options: PasswordOptions): string {
  const sets = [
    options.uppercase ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ" : "",
    options.lowercase ? "abcdefghijklmnopqrstuvwxyz" : "",
    options.numbers ? "0123456789" : "",
    options.symbols ? "!@#$%^&*()-_=+[]{};:,.?/" : "",
  ].filter(Boolean);
  const excluded = new Set(options.exclude_chars.split(""));
  const filtered = sets.map((set) => set.split("").filter((c) => !excluded.has(c)));
  if (filtered.some((set) => set.length === 0)) {
    throw new BackendError("validation", "Excluded characters removed an entire character set");
  }
  if (options.length < 8 || options.length > 128) {
    throw new BackendError("validation", "Password length must be between 8 and 128");
  }
  const pool = filtered.flat();
  const bytes = new Uint32Array(options.length);
  crypto.getRandomValues(bytes);
  const chars: string[] = [];
  filtered.forEach((set) => chars.push(set[bytes[chars.length] % set.length]));
  while (chars.length < options.length) {
    const index = chars.length;
    chars.push(pool[bytes[index] % pool.length]);
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = bytes[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const DEMO_WORDS = [
  "amber",
  "bison",
  "canyon",
  "dragon",
  "ember",
  "falcon",
  "glacier",
  "harbor",
  "island",
  "jasmine",
  "kestrel",
  "lantern",
  "meadow",
  "nebula",
  "ocean",
  "pepper",
  "quartz",
  "ripple",
  "summit",
  "tundra",
  "ultra",
  "violet",
  "willow",
  "xenon",
  "yellow",
  "zephyr",
];

export class DemoBackend implements Backend {
  readonly kind = "preview" as const;
  private state: PreviewState;

  constructor() {
    this.state = loadState();
  }

  private persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.state, unlocked: false }));
  }

  private requireUnlocked() {
    if (!this.state.unlocked) throw new BackendError("locked", "The vault is locked");
  }

  private activeAccount(): PreviewAccount | null {
    return (
      this.state.accounts.find((account) => account.vaultId === this.state.activeVaultId) ??
      this.state.accounts[0] ??
      null
    );
  }

  private session(): SessionView {
    const account = this.activeAccount();
    return {
      username: account?.username ?? "preview",
      vaultId: account?.vaultId ?? "preview-vault",
      vaultName: account?.vaultName ?? "Personal",
      itemCount: this.state.items.length,
      idleTimeoutSecs: this.state.settings.auto_lock_secs,
    };
  }

  private findItem(id: string): TypedItem {
    const item = this.state.items.find((candidate) => candidate.id === id);
    if (!item) throw new BackendError("not_found", "That item no longer exists");
    return item;
  }

  async appStatus(): Promise<AppStatus> {
    return {
      hasAccount: this.state.accounts.length > 0,
      username: this.activeAccount()?.username ?? null,
      locked: !this.state.unlocked,
      appVersion: "0.1.0-preview",
      platform: "browser",
      dataDir: "Preview (not persisted encrypted)",
      databaseSize: 0,
      repository: "Ahaduzzamankhan/Acuye-Pass",
      kdfMemoryKib: 65536,
      kdfIterations: 3,
      session: this.state.unlocked ? this.session() : null,
    };
  }

  async createAccount(username: string, password: string): Promise<SessionView> {
    if (this.state.accounts.length > 0) {
      throw new BackendError("conflict", "An account already exists in this preview");
    }
    if (username.trim().length < 3) {
      throw new BackendError("validation", "Username must be at least 3 characters");
    }
    if (password.length < 12) {
      throw new BackendError("validation", "The master password must be at least 12 characters");
    }
    const account: PreviewAccount = {
      vaultId: "preview-vault",
      username: username.trim(),
      secret: password,
      vaultName: "Personal",
    };
    this.state.accounts = [account];
    this.state.activeVaultId = account.vaultId;
    this.state.username = account.username;
    this.state.secret = account.secret;
    this.state.unlocked = true;
    this.state.items = seedItems(true);
    this.persist();
    return this.session();
  }

  async addAccount(): Promise<SessionView> {
    throw new BackendError(
      "unsupported",
      "The browser preview keeps a single demo account. Add accounts in the desktop app.",
    );
  }

  async listAccounts(): Promise<AccountSummary[]> {
    return this.state.accounts.map((account) => ({
      username: account.username,
      vault_id: account.vaultId,
      vault_name: account.vaultName,
      kdf_algorithm: "argon2id",
      kdf_memory_kib: 65536,
      kdf_iterations: 3,
      created_at: now(),
    }));
  }

  async unlock(vaultId: string | null, username: string, password: string): Promise<SessionView> {
    const account = vaultId
      ? this.state.accounts.find((candidate) => candidate.vaultId === vaultId)
      : this.state.accounts.find(
          (candidate) => candidate.username.toLowerCase() === username.trim().toLowerCase(),
        );
    if (!account || password !== account.secret) {
      throw new BackendError("authentication_failed", "Authentication failed");
    }
    this.state.activeVaultId = account.vaultId;
    this.state.username = account.username;
    this.state.secret = account.secret;
    this.state.unlocked = true;
    if (this.state.items.length === 0) this.state.items = seedItems(true);
    this.persist();
    return this.session();
  }

  async lock() {
    this.state.unlocked = false;
  }

  async logout() {
    this.state.unlocked = false;
  }

  async sessionTouch() {
    return this.state.unlocked ? this.session() : null;
  }

  async changeMasterPassword(currentPassword: string, newPassword: string): Promise<SessionView> {
    this.requireUnlocked();
    if (currentPassword !== this.state.secret) {
      throw new BackendError("authentication_failed", "Authentication failed");
    }
    if (newPassword.length < 12) {
      throw new BackendError("validation", "Choose a stronger master password");
    }
    this.state.secret = newPassword;
    this.persist();
    return this.session();
  }

  async getAccount(): Promise<AccountSummary | null> {
    if (!this.state.username) return null;
    return {
      username: this.state.username,
      vault_id: "preview-vault",
      vault_name: "Personal",
      kdf_algorithm: "argon2id",
      kdf_memory_kib: 65536,
      kdf_iterations: 3,
      created_at: now() - 86400,
    };
  }

  async listItems(query?: string, itemType?: ItemType | null, favoritesOnly?: boolean) {
    this.requireUnlocked();
    const term = (query ?? "").trim().toLowerCase();
    return this.state.items
      .filter((item) => (itemType ? item.kind === itemType : true))
      .filter((item) => (favoritesOnly ? item.favorite : true))
      .filter((item) => {
        if (!term) return true;
        return [item.title, item.tags.join(" "), item.notes].join(" ").toLowerCase().includes(term);
      })
      .map(toSummary)
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title));
  }

  async getItem(id: string) {
    this.requireUnlocked();
    return this.findItem(id) as unknown as Item;
  }

  async createItem(input: ItemFieldsInput) {
    this.requireUnlocked();
    if (!input.title.trim()) throw new BackendError("validation", "A title is required");
    const item = {
      id: crypto.randomUUID(),
      title: input.title.trim(),
      notes: input.notes ?? "",
      tags: input.tags ?? [],
      favorite: input.favorite ?? false,
      created_at: now(),
      updated_at: now(),
      ...input.fields,
    } as TypedItem;
    this.state.items.unshift(item);
    this.persist();
    return item as unknown as Item;
  }

  async updateItem(item: Item) {
    this.requireUnlocked();
    const index = this.state.items.findIndex((candidate) => candidate.id === item.id);
    if (index < 0) throw new BackendError("not_found", "That item no longer exists");
    const updated = { ...item, updated_at: now() } as unknown as TypedItem;
    this.state.items[index] = updated;
    this.persist();
    return updated as unknown as Item;
  }

  async deleteItem(id: string) {
    this.requireUnlocked();
    this.state.items = this.state.items.filter((item) => item.id !== id);
    this.persist();
  }

  async duplicateItem(id: string) {
    this.requireUnlocked();
    const source = this.findItem(id);
    const copy: TypedItem = {
      ...source,
      id: crypto.randomUUID(),
      title: `${source.title} (copy)`,
      favorite: false,
      created_at: now(),
      updated_at: now(),
    };
    this.state.items.unshift(copy);
    this.persist();
    return copy as unknown as Item;
  }

  async toggleFavorite(id: string) {
    this.requireUnlocked();
    const item = this.findItem(id);
    item.favorite = !item.favorite;
    this.persist();
    return item as unknown as Item;
  }

  async vaultCounts(): Promise<VaultCounts> {
    if (!this.state.unlocked) return emptyCounts();
    const counts = emptyCounts();
    counts.total = this.state.items.length;
    counts.favorites = this.state.items.filter((item) => item.favorite).length;
    for (const item of this.state.items) {
      if (item.kind === "login") counts.logins += 1;
      if (item.kind === "secure_note") counts.notes += 1;
      if (item.kind === "card") counts.cards += 1;
      if (item.kind === "identity") counts.identities += 1;
      if (item.kind === "document") counts.documents += 1;
      if (item.kind === "custom") counts.custom += 1;
    }
    return counts;
  }

  async securityReport(): Promise<SecurityReport> {
    this.requireUnlocked();
    const issues: SecurityReport["issues"] = [];
    const logins = this.state.items.filter((item) => item.kind === "login");
    const byPassword = new Map<string, TypedItem[]>();
    for (const item of logins) {
      if (!item.password) {
        issues.push({
          item_id: item.id,
          title: item.title,
          issue: "empty_password",
          detail: "This login has no password stored.",
        });
        continue;
      }
      const list = byPassword.get(item.password) ?? [];
      list.push(item);
      byPassword.set(item.password, list);
      if (item.password.length < 14) {
        issues.push({
          item_id: item.id,
          title: item.title,
          issue: "weak_password",
          detail: "Estimated strength is below 60 bits.",
        });
      }
    }
    for (const group of byPassword.values()) {
      if (group.length > 1) {
        group.forEach((item) =>
          issues.push({
            item_id: item.id,
            title: item.title,
            issue: "reused_password",
            detail: `Shared by ${group.length} items.`,
          }),
        );
      }
    }
    const weak = issues.filter((i) => i.issue === "weak_password").length;
    const reused = issues.filter((i) => i.issue === "reused_password").length;
    const empty = issues.filter((i) => i.issue === "empty_password").length;
    return {
      total_items: this.state.items.length,
      login_items: logins.length,
      weak,
      reused,
      old: 0,
      empty,
      score: Math.max(0, 100 - weak * 6 - reused * 8 - empty * 10),
      issues,
      scanned_at: now(),
    };
  }

  async copyField(id: string, field: string): Promise<CopyResult> {
    this.requireUnlocked();
    const item = this.findItem(id);
    const value = (item as unknown as Record<string, unknown>)[field];
    if (typeof value !== "string" || !value) {
      throw new BackendError("validation", "That field is empty or cannot be copied");
    }
    await navigator.clipboard.writeText(value);
    return { field, clearAfterSecs: this.state.settings.clipboard_clear_secs };
  }

  async openWebsite(url: string) {
    const normalized = url.includes("://") ? url : `https://${url}`;
    window.open(normalized, "_blank", "noopener,noreferrer");
  }

  async generatePassword(options: PasswordOptions) {
    return randomPassword(options);
  }

  async generatePassphrase(options: PassphraseOptions) {
    const bytes = new Uint32Array(options.words + 1);
    crypto.getRandomValues(bytes);
    const words = Array.from({ length: options.words }, (_, index) => {
      const word = DEMO_WORDS[bytes[index] % DEMO_WORDS.length];
      return options.capitalize ? word[0].toUpperCase() + word.slice(1) : word;
    });
    const suffix = options.include_number ? `${bytes[options.words] % 100}` : "";
    return words.join(options.separator) + suffix;
  }

  async evaluatePassword(password: string): Promise<PasswordStrength> {
    if (!password) return { bits: 0, score: 0, label: "Very weak", feedback: [] };
    let pool = 0;
    if (/[a-z]/.test(password)) pool += 26;
    if (/[A-Z]/.test(password)) pool += 26;
    if (/[0-9]/.test(password)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(password)) pool += 33;
    const bits = password.length * Math.log2(Math.max(pool, 1));
    const score = bits < 28 ? 0 : bits < 36 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
    const label = ["Very weak", "Weak", "Fair", "Strong", "Very strong"][score];
    return { bits, score, label, feedback: [] };
  }

  async getSettings() {
    return this.state.settings;
  }

  async saveSettings(settings: AppSettings) {
    this.state.settings = { ...settings, update_channel: this.state.settings.update_channel };
    this.persist();
    return this.state.settings;
  }

  async renameVault(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new BackendError("validation", "Invalid vault name");
    return trimmed;
  }

  async setUpdateChannel(channel: AppSettings["update_channel"], acknowledge: boolean) {
    if (channel !== "stable" && !acknowledge) {
      throw new BackendError("validation", "Beta and alpha channels must be explicitly enabled");
    }
    this.state.settings = { ...this.state.settings, update_channel: channel };
    this.persist();
    return this.state.settings;
  }

  async listDevices(): Promise<DeviceView[]> {
    return [
      {
        id: "preview-device",
        name: "Browser preview",
        platform: "browser",
        createdAt: now() - 86400,
        lastSeenAt: now(),
        revoked: false,
        syncRegistered: false,
        current: true,
      } as unknown as DeviceView,
    ];
  }

  async revokeDevice() {
    throw new BackendError("validation", "This is the device you are using");
  }

  async storageInfo(): Promise<StorageInfo> {
    return {
      dataDir: "Preview — data lives in browser storage",
      databasePath: "—",
      databaseSize: 0,
      schemaVersion: 2,
      integrityOk: true,
      backupDir: "—",
      exportDir: "—",
      itemCount: this.state.items.length,
    };
  }

  async createBackup(): Promise<BackupInfo> {
    throw new BackendError("unsupported", "Backups require the desktop application");
  }

  async listBackups(): Promise<BackupInfo[]> {
    return [];
  }

  async restoreBackup() {
    throw new BackendError("unsupported", "Backups require the desktop application");
  }

  async openDataFolder() {
    throw new BackendError("unsupported", "Available in the desktop application");
  }

  async openBackupsFolder() {
    throw new BackendError("unsupported", "Available in the desktop application");
  }

  async openExportsFolder() {
    throw new BackendError("unsupported", "Available in the desktop application");
  }

  async importPreview(): Promise<ParsedImport> {
    throw new BackendError(
      "unsupported",
      "Import parsing runs in Rust. Use the desktop application.",
    );
  }

  async importApply(): Promise<ImportResult> {
    throw new BackendError("unsupported", "Import requires the desktop application");
  }

  async exportEncrypted(): Promise<ExportInfo> {
    throw new BackendError("unsupported", "Encrypted export requires the desktop application");
  }

  async exportPlaintextCsv(): Promise<ExportInfo> {
    throw new BackendError("unsupported", "Export requires the desktop application");
  }

  async importEncrypted(): Promise<ImportResult> {
    throw new BackendError("unsupported", "Import requires the desktop application");
  }

  async getFavicon() {
    return null;
  }

  private updateView(overrides: Partial<UpdateStatusView> = {}): UpdateStatusView {
    return {
      currentVersion: "0.1.0-preview",
      channel: this.state.settings.update_channel,
      stage: "idle",
      available: null,
      verified: null,
      progress: null,
      total: null,
      error: null,
      signingConfigured: false,
      repository: "Ahaduzzamankhan/Acuye-Pass",
      lastCheck: null,
      downloadPath: null,
      ...overrides,
    };
  }

  async updateStatus() {
    return this.updateView();
  }

  async checkForUpdates() {
    return this.updateView({
      stage: "failed",
      error: "Update checks run in the desktop application",
    });
  }

  async downloadUpdate(): Promise<UpdateStatusView> {
    throw new BackendError("unsupported", "Updates require the desktop application");
  }

  async verifyUpdate(): Promise<UpdateStatusView> {
    throw new BackendError("unsupported", "Updates require the desktop application");
  }

  async installUpdate(): Promise<UpdateStatusView> {
    throw new BackendError("unsupported", "Updates require the desktop application");
  }

  async discardUpdate() {}

  async onUpdateProgress() {
    return () => undefined;
  }

  // Advanced features need the Rust side; the preview keeps the shapes valid so
  // the pages render their empty states.
  async authenticatorEntries(): Promise<TotpEntry[]> {
    return [];
  }
  async authenticatorAdd(): Promise<Item> {
    throw new BackendError("unsupported", "The authenticator runs in the desktop app");
  }
  async authenticatorAddEntry(): Promise<Item> {
    throw new BackendError("unsupported", "The authenticator runs in the desktop app");
  }
  async authenticatorAdvanceCounter(): Promise<number> {
    throw new BackendError("unsupported", "The authenticator runs in the desktop app");
  }
  async authenticatorExport(): Promise<string> {
    throw new BackendError("unsupported", "The authenticator runs in the desktop app");
  }
  async secretCopy(): Promise<void> {
    throw new BackendError("unsupported", "Secrets are handled in the desktop app");
  }
  async secretReveal(): Promise<string> {
    throw new BackendError("unsupported", "Secrets are handled in the desktop app");
  }
  async secretAccessLog(): Promise<SecretAccessEntry[]> {
    return [];
  }
  async secretClearHistory(): Promise<void> {}
  async secretAlerts(): Promise<SecretAlert[]> {
    return [];
  }
  async breachScanVault(): Promise<BreachScanResult> {
    return {
      checked: 0,
      breached: 0,
      clean: 0,
      unavailable: 0,
      results: [],
      scannedAt: Math.floor(Date.now() / 1000),
    };
  }
  async breachCheckItem(): Promise<BreachItemResult> {
    throw new BackendError("unsupported", "Breach checks need the desktop app");
  }
  async lanIdentity(): Promise<LanIdentity> {
    return { deviceId: "preview-device", address: "127.0.0.1:47821", port: 47821 };
  }
  async lanPairingOffer(): Promise<LanOffer> {
    throw new BackendError("unsupported", "Pairing needs the desktop app");
  }
  async lanAwaitPairing(): Promise<LanPairResult> {
    throw new BackendError("unsupported", "Pairing needs the desktop app");
  }
  async lanPair(): Promise<LanPairResult> {
    throw new BackendError("unsupported", "Pairing needs the desktop app");
  }
  async lanPeers(): Promise<LanPeer[]> {
    return [];
  }
  async lanRevokePeer(): Promise<void> {}
  async lanForgetPeer(): Promise<void> {}
  async lanTestPeer(): Promise<LanPairResult> {
    throw new BackendError("unsupported", "Pairing needs the desktop app");
  }
  async lanSyncPeer(): Promise<LanSyncResult> {
    throw new BackendError("unsupported", "LAN sync needs the desktop app");
  }
  async lanAcceptSync(): Promise<LanSyncResult> {
    throw new BackendError("unsupported", "LAN sync needs the desktop app");
  }

  async windowMinimize() {}
  async windowToggleMaximize() {
    return false;
  }
  async windowIsMaximized() {
    return false;
  }
  async windowClose() {}
}

// The demo vault stays empty until an account is created so the preview starts
// at the onboarding flow.
export function resetPreview() {
  localStorage.removeItem(STORAGE_KEY);
}
