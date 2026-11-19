import type {
  AccountSummary,
  AppSettings,
  AppStatus,
  BackupInfo,
  CopyResult,
  DeviceView,
  ExportInfo,
  ImportFormat,
  ImportResult,
  Item,
  ItemFieldsInput,
  ItemSummary,
  ItemType,
  ParsedImport,
  PassphraseOptions,
  PasswordOptions,
  PasswordStrength,
  SecurityReport,
  SessionView,
  StorageInfo,
  UpdateStatusView,
  VaultCounts,
} from "./types";

/**
 * The complete backend contract. Every implementation is a thin adapter; all
 * security-sensitive behaviour lives in Rust for the shipped desktop app.
 */
export interface Backend {
  readonly kind: "tauri" | "preview";

  appStatus(): Promise<AppStatus>;
  createAccount(username: string, password: string): Promise<SessionView>;
  unlock(username: string, password: string): Promise<SessionView>;
  lock(): Promise<void>;
  logout(): Promise<void>;
  sessionTouch(): Promise<SessionView | null>;
  changeMasterPassword(currentPassword: string, newPassword: string): Promise<SessionView>;
  getAccount(): Promise<AccountSummary | null>;

  listItems(query?: string, itemType?: ItemType | null, favoritesOnly?: boolean): Promise<ItemSummary[]>;
  getItem(id: string): Promise<Item>;
  createItem(input: ItemFieldsInput): Promise<Item>;
  updateItem(item: Item): Promise<Item>;
  deleteItem(id: string): Promise<void>;
  duplicateItem(id: string): Promise<Item>;
  toggleFavorite(id: string): Promise<Item>;
  vaultCounts(): Promise<VaultCounts>;
  securityReport(): Promise<SecurityReport>;
  copyField(id: string, field: string): Promise<CopyResult>;
  openWebsite(url: string): Promise<void>;

  generatePassword(options: PasswordOptions): Promise<string>;
  generatePassphrase(options: PassphraseOptions): Promise<string>;
  evaluatePassword(password: string): Promise<PasswordStrength>;

  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  renameVault(name: string): Promise<string>;
  setUpdateChannel(channel: AppSettings["update_channel"], acknowledge: boolean): Promise<AppSettings>;
  listDevices(): Promise<DeviceView[]>;
  revokeDevice(id: string): Promise<void>;

  storageInfo(): Promise<StorageInfo>;
  createBackup(): Promise<BackupInfo>;
  listBackups(): Promise<BackupInfo[]>;
  restoreBackup(name: string): Promise<void>;
  openDataFolder(): Promise<void>;
  openBackupsFolder(): Promise<void>;
  openExportsFolder(): Promise<void>;

  importPreview(payload: string, format?: ImportFormat | null): Promise<ParsedImport>;
  importApply(items: Item[], format?: ImportFormat | null): Promise<ImportResult>;
  exportEncrypted(password: string): Promise<ExportInfo>;
  exportPlaintextCsv(acknowledge: boolean): Promise<ExportInfo>;
  importEncrypted(payload: string, password: string): Promise<ImportResult>;
  getFavicon(url: string): Promise<string | null>;

  updateStatus(): Promise<UpdateStatusView>;
  checkForUpdates(force: boolean): Promise<UpdateStatusView>;
  downloadUpdate(): Promise<UpdateStatusView>;
  verifyUpdate(): Promise<UpdateStatusView>;
  installUpdate(): Promise<UpdateStatusView>;
  discardUpdate(): Promise<void>;
  onUpdateProgress(handler: (received: number, total: number) => void): Promise<() => void>;

  windowMinimize(): Promise<void>;
  windowToggleMaximize(): Promise<boolean>;
  windowIsMaximized(): Promise<boolean>;
  windowClose(): Promise<void>;
}
