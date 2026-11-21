/**
 * Typed wrapper around the Rust core.
 *
 * `NativeModules.Acuye.call` forwards one command to the JSON router in
 * `crates/acuye-ffi/src/mobile.rs`, which reuses the same crates as the desktop
 * app. Nothing here decrypts anything in JavaScript.
 */

import { NativeModules } from "react-native";

import type { AppearanceMode, ThemeColor } from "./theme";

export interface Account {
  vaultId: string;
  username: string;
  vaultName: string;
  kdfAlgorithm: string;
  kdfMemoryKib: number;
  kdfIterations: number;
  createdAt: number;
}

export interface Session {
  username: string;
  vaultId: string;
  vaultName: string;
  itemCount: number;
  idleTimeoutSecs: number;
}

export interface AppSettings {
  theme_color: ThemeColor;
  appearance_mode: AppearanceMode;
  sidebar_collapsed: boolean;
  reduce_motion: boolean;
  density_compact: boolean;
  auto_lock_secs: number;
  clipboard_clear_secs: number;
  confirm_delete: boolean;
  favicon_enabled: boolean;
  shortcuts_enabled: boolean;
  update_channel: "stable" | "beta" | "alpha";
  update_auto_check: boolean;
  last_update_check: number | null;
  sync_provider: { endpoint: string; device_name: string; enabled: boolean } | null;
  telemetry: boolean;
}

export interface StatusResult {
  version: string;
  accounts: Account[];
  unlocked: boolean;
  session: Session | null;
  dataDir: string;
  databaseSize: number;
  repository: string;
  platform: string;
  settings: AppSettings;
}

export interface ItemSummary {
  id: string;
  title: string;
  item_type: string;
  subtitle: string;
  favorite: boolean;
  tags: string[];
  updated_at: number;
  host: string;
  has_password: boolean;
}

export interface CustomField {
  label: string;
  value: string;
  concealed: boolean;
}

export type ItemFields =
  | {
      kind: "login";
      username: string;
      password: string;
      url: string;
      totp: string;
      password_changed_at: number | null;
    }
  | { kind: "secure_note" }
  | {
      kind: "card";
      cardholder: string;
      number: string;
      expiry_month: string;
      expiry_year: string;
      cvv: string;
      brand: string;
      pin: string;
    }
  | {
      kind: "identity";
      first_name: string;
      last_name: string;
      email: string;
      phone: string;
      address: string;
      city: string;
      state: string;
      postal_code: string;
      country: string;
      company: string;
    }
  | { kind: "document"; filename: string; mime_type: string; size_bytes: number; sha256: string }
  | { kind: "custom"; fields: CustomField[] }
  | {
      kind: "totp";
      secret: string;
      issuer: string;
      account: string;
      algorithm: string;
      digits: number;
      period: number;
      otp_type: string;
      counter: number;
    }
  | {
      kind: "secret";
      environment: string;
      category: string;
      fields: CustomField[];
      expires_at: number | null;
      rotate_every_days: number | null;
      last_rotated_at: number | null;
    };

export interface VaultItem {
  id: string;
  title: string;
  notes: string;
  tags: string[];
  favorite: boolean;
  created_at: number;
  updated_at: number;
  fields: ItemFields;
}

export interface TotpCode {
  code: string;
  remaining: number;
  period: number;
  progress: number;
  otpType: string;
  counter: number;
}

export interface AuthenticatorEntry {
  id: string;
  title: string;
  issuer: string;
  account: string;
  code: string;
  digits: number;
  period: number;
  remaining: number;
  algorithm: string;
  otpType: string;
  counter: number;
  progress: number;
  error: string | null;
}

export type SecurityIssueKind = "weak_password" | "reused_password" | "old_password" | "empty_password";

export interface SecurityIssue {
  item_id: string;
  title: string;
  issue: SecurityIssueKind;
  detail: string;
}

export interface SecurityReport {
  total_items: number;
  login_items: number;
  weak: number;
  reused: number;
  old: number;
  empty: number;
  score: number;
  issues: SecurityIssue[];
  scanned_at: number;
}

export interface VaultCounts {
  total: number;
  favorites: number;
  logins: number;
  notes: number;
  cards: number;
  identities: number;
  documents: number;
  custom: number;
  authenticators: number;
  secrets: number;
}

export interface PasswordStrength {
  bits: number;
  score: number;
  label: string;
  feedback: string[];
}

export interface PasswordOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  exclude_chars: string;
}

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
  include_number: boolean;
}

export interface Device {
  id: string;
  name: string;
  platform: string;
  createdAt: number;
  lastSeenAt: number;
  revoked: boolean;
  syncRegistered: boolean;
  current: boolean;
}

export interface StorageInfo {
  dataDir: string;
  databasePath: string;
  databaseSize: number;
  schemaVersion: number;
  integrityOk: boolean;
  backupDir: string;
  exportDir: string;
  itemCount: number;
}

export interface BackupInfo {
  name: string;
  path: string;
  size: number;
  createdAt: number;
}

export interface ExportInfo {
  path: string;
  encrypted: boolean;
  itemCount: number;
  bytes: number;
}

export type ImportFormat =
  | "acuye_json"
  | "bitwarden_json"
  | "bitwarden_csv"
  | "chrome_csv"
  | "one_password_csv"
  | "generic_csv";

export interface ParsedImport {
  format: ImportFormat;
  items: VaultItem[];
  skipped: number;
  warnings: string[];
}

export interface ImportResult {
  imported: number;
  renamed: number;
}

export interface RecoveryStatus {
  code: boolean;
  questions: boolean;
}

export interface RecoverySetup {
  recoveryCode: string;
  questions: number;
}

export interface SecretAlert {
  id: string;
  title: string;
  kind: "expired" | "expiring" | "rotation_due" | "rotation_soon";
  dueAt: number;
}

export interface SecretAccessEntry {
  action: string;
  at: number;
}

interface Bridge {
  dataDir(): Promise<string>;
  call(dbPath: string, op: string, argsJson: string): Promise<string>;
  openUrl(url: string): Promise<boolean>;
}

const bridge = NativeModules.Acuye as (Bridge & Record<string, unknown>) | undefined;

/** False in a JS-only preview and in any build without the Rust library. */
export const nativeAvailable = Boolean(
  bridge && typeof bridge.call === "function" && typeof bridge.dataDir === "function",
);

export class NativeError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NativeError";
    this.code = code;
  }
}

let dbPath: string | null = null;

async function path(): Promise<string> {
  if (dbPath) return dbPath;
  if (!bridge) throw new NativeError("unavailable", "The app data directory is unavailable.");
  dbPath = `${await bridge.dataDir()}/acuye.db`;
  return dbPath;
}

async function invoke<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!bridge) {
    throw new NativeError("unavailable", "The native vault library is not available in this build.");
  }
  const raw = await bridge.call(await path(), op, JSON.stringify(args));
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new NativeError("format", "The vault returned an unreadable answer.");
  }
  if (value.ok !== true) {
    throw new NativeError(
      typeof value.code === "string" ? value.code : "unknown",
      typeof value.message === "string" ? value.message : "The vault refused the request.",
    );
  }
  return value as unknown as T;
}

export function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
}

const unwrap = <T,>(key: string) => (value: Record<string, unknown>): T => value[key] as T;

export const api = {
  async status(): Promise<StatusResult> {
    return invoke<StatusResult>("status");
  },

  async createAccount(username: string, password: string): Promise<StatusResult> {
    return invoke<StatusResult>("accounts.create", { username, password });
  },

  async addAccount(username: string, password: string, vaultName?: string): Promise<StatusResult> {
    return invoke<StatusResult>("accounts.add", { username, password, vaultName: vaultName ?? null });
  },

  async unlock(vaultId: string | null, username: string, password: string): Promise<StatusResult> {
    return invoke<StatusResult>("accounts.unlock", { vaultId, username, password });
  },

  async lock(): Promise<void> {
    await invoke("accounts.lock");
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<StatusResult> {
    return invoke<StatusResult>("accounts.changePassword", { currentPassword, newPassword });
  },

  async renameVault(name: string): Promise<void> {
    await invoke("accounts.renameVault", { name });
  },

  async getSettings(): Promise<AppSettings> {
    return invoke<{ settings: AppSettings }>("settings.get").then(unwrap("settings"));
  },

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    return invoke<{ settings: AppSettings }>("settings.save", { settings }).then(unwrap("settings"));
  },

  async setChannel(channel: AppSettings["update_channel"], acknowledge: boolean): Promise<AppSettings> {
    return invoke<{ settings: AppSettings }>("settings.channel", { channel, acknowledge }).then(
      unwrap("settings"),
    );
  },

  async touch(): Promise<Session | null> {
    return invoke<{ session: Session | null }>("session.touch").then((value) => value.session);
  },

  list(query = "", itemType: string | null = null, favoritesOnly = false): Promise<ItemSummary[]> {
    return invoke<{ items: ItemSummary[] }>("items.list", { query, itemType, favoritesOnly }).then(
      unwrap("items"),
    );
  },

  getItem(id: string): Promise<VaultItem> {
    return invoke<{ item: VaultItem }>("items.get", { id }).then(unwrap("item"));
  },

  secret(id: string, field: string): Promise<string> {
    return invoke<{ value: string }>("items.secret", { id, field }).then(unwrap("value"));
  },

  createItem(input: {
    fields: ItemFields;
    title: string;
    notes?: string;
    tags?: string[];
    favorite?: boolean;
  }): Promise<VaultItem> {
    return invoke<{ item: VaultItem }>("items.create", input).then(unwrap("item"));
  },

  updateItem(item: VaultItem): Promise<VaultItem> {
    return invoke<{ item: VaultItem }>("items.update", { item }).then(unwrap("item"));
  },

  async deleteItem(id: string): Promise<void> {
    await invoke("items.delete", { id });
  },

  duplicateItem(id: string): Promise<VaultItem> {
    return invoke<{ item: VaultItem }>("items.duplicate", { id }).then(unwrap("item"));
  },

  toggleFavorite(id: string): Promise<VaultItem> {
    return invoke<{ item: VaultItem }>("items.favorite", { id }).then(unwrap("item"));
  },

  counts(): Promise<VaultCounts> {
    return invoke<{ counts: VaultCounts }>("items.counts").then(unwrap("counts"));
  },

  totp(id: string): Promise<TotpCode> {
    return invoke<TotpCode>("totp", { id });
  },

  securityReport(): Promise<SecurityReport> {
    return invoke<{ report: SecurityReport }>("security.report").then(unwrap("report"));
  },

  generatePassword(options: Partial<PasswordOptions>): Promise<string> {
    return invoke<{ password: string }>("generator.password", { options }).then(unwrap("password"));
  },

  generatePassphrase(options: Partial<PassphraseOptions>): Promise<string> {
    return invoke<{ passphrase: string }>("generator.passphrase", { options }).then(
      unwrap("passphrase"),
    );
  },

  evaluatePassword(password: string): Promise<PasswordStrength> {
    return invoke<{ strength: PasswordStrength }>("generator.strength", { password }).then(
      unwrap("strength"),
    );
  },

  authenticator: {
    list(): Promise<AuthenticatorEntry[]> {
      return invoke<{ entries: AuthenticatorEntry[] }>("authenticator.list").then(unwrap("entries"));
    },
    addUri(uri: string): Promise<VaultItem> {
      return invoke<{ item: VaultItem }>("authenticator.addUri", { uri }).then(unwrap("item"));
    },
    addEntry(entry: {
      name: string;
      secret: string;
      issuer: string;
      account: string;
      otpType: string;
      algorithm: string;
      digits: number;
      period: number;
      counter: number;
    }): Promise<VaultItem> {
      return invoke<{ item: VaultItem }>("authenticator.addEntry", { entry }).then(unwrap("item"));
    },
    advance(id: string): Promise<number> {
      return invoke<{ counter: number }>("authenticator.advance", { id }).then(unwrap("counter"));
    },
    exportUri(id: string): Promise<string> {
      return invoke<{ uri: string }>("authenticator.export", { id }).then(unwrap("uri"));
    },
  },

  secrets: {
    reveal(id: string, index: number): Promise<string> {
      return invoke<{ value: string }>("secrets.reveal", { id, index }).then(unwrap("value"));
    },
    accessLog(id: string): Promise<SecretAccessEntry[]> {
      return invoke<{ entries: SecretAccessEntry[] }>("secrets.accessLog", { id }).then(
        unwrap("entries"),
      );
    },
    async clearHistory(id: string): Promise<void> {
      await invoke("secrets.clearHistory", { id });
    },
    alerts(): Promise<SecretAlert[]> {
      return invoke<{ alerts: SecretAlert[] }>("secrets.alerts").then(unwrap("alerts"));
    },
  },

  devices: {
    list(): Promise<Device[]> {
      return invoke<{ devices: Device[] }>("devices.list").then(unwrap("devices"));
    },
    async revoke(id: string): Promise<void> {
      await invoke("devices.revoke", { id });
    },
  },

  storageInfo(): Promise<StorageInfo> {
    return invoke<{ info: StorageInfo }>("storage.info").then(unwrap("info"));
  },

  backups: {
    list(): Promise<BackupInfo[]> {
      return invoke<{ backups: BackupInfo[] }>("backups.list").then(unwrap("backups"));
    },
    create(): Promise<BackupInfo> {
      return invoke<{ backup: BackupInfo }>("backups.create").then(unwrap("backup"));
    },
    async restore(name: string): Promise<void> {
      await invoke("backups.restore", { name });
    },
  },

  exportEncrypted(password: string): Promise<ExportInfo> {
    return invoke<{ export: ExportInfo }>("storage.exportEncrypted", { password }).then(
      unwrap("export"),
    );
  },

  exportCsv(acknowledge: boolean): Promise<ExportInfo> {
    return invoke<{ export: ExportInfo }>("storage.exportCsv", { acknowledge }).then(
      unwrap("export"),
    );
  },

  importPreview(payload: string, format?: ImportFormat | null): Promise<ParsedImport> {
    return invoke<{ preview: ParsedImport }>("import.preview", { payload, format: format ?? null }).then(
      unwrap("preview"),
    );
  },

  importApply(items: VaultItem[], format?: ImportFormat | null): Promise<ImportResult> {
    return invoke<{ result: ImportResult }>("import.apply", { items, format: format ?? null }).then(
      unwrap("result"),
    );
  },

  importEncrypted(payload: string, password: string): Promise<ImportResult> {
    return invoke<{ result: ImportResult }>("import.encrypted", { payload, password }).then(
      unwrap("result"),
    );
  },

  recovery: {
    status(vaultId: string): Promise<RecoveryStatus> {
      return invoke<{ status: RecoveryStatus }>("recovery.status", { vaultId }).then(unwrap("status"));
    },
    questions(vaultId: string): Promise<string[]> {
      return invoke<{ questions: string[] }>("recovery.questions", { vaultId }).then(
        unwrap("questions"),
      );
    },
    enable(
      vaultId: string,
      password: string,
      questions?: { question: string; answer: string }[] | null,
    ): Promise<RecoverySetup> {
      return invoke<{ setup: RecoverySetup }>("recovery.enable", {
        vaultId,
        password,
        questions: questions ?? null,
      }).then(unwrap("setup"));
    },
    async disable(vaultId: string, password: string): Promise<void> {
      await invoke("recovery.disable", { vaultId, password });
    },
    recoverWithCode(
      code: string,
      newPassword: string,
    ): Promise<{ session: Session | null; recoveryCode: string }> {
      return invoke("recovery.withCode", { code, newPassword });
    },
    recoverWithAnswers(
      vaultId: string,
      answers: string[],
      newPassword: string,
    ): Promise<{ session: Session | null; recoveryCode: string }> {
      return invoke("recovery.withAnswers", { vaultId, answers, newPassword });
    },
  },

  async openUrl(url: string): Promise<void> {
    if (!bridge || typeof bridge.openUrl !== "function") {
      throw new NativeError("unavailable", "This build cannot open links.");
    }
    await bridge.openUrl(url);
  },
};
