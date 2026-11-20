import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { Backend } from "./backend";
import { BackendError } from "./types";
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
  BreachItemResult,
  BreachScanResult,
  ParsedImport,
  LanIdentity,
  LanOffer,
  LanPairResult,
  LanPeer,
  LanSyncResult,
  SecretAccessEntry,
  SecretAlert,
  TotpEntry,
  PassphraseOptions,
  PasswordOptions,
  PasswordStrength,
  SecurityReport,
  SessionView,
  StorageInfo,
  UpdateStatusView,
  VaultCounts,
} from "./types";

function toError(value: unknown): BackendError {
  if (value && typeof value === "object" && "message" in value && "code" in value) {
    const record = value as { message?: unknown; code?: unknown };
    return new BackendError(String(record.code), String(record.message));
  }
  return new BackendError("internal", "Something went wrong");
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toError(error);
  }
}

export class TauriBackend implements Backend {
  readonly kind = "tauri" as const;

  appStatus() {
    return call<AppStatus>("app_status");
  }
  createAccount(username: string, password: string) {
    return call<SessionView>("create_account", { username, password });
  }
  unlock(username: string, password: string) {
    return call<SessionView>("unlock", { username, password });
  }
  lock() {
    return call<void>("lock");
  }
  logout() {
    return call<void>("logout");
  }
  sessionTouch() {
    return call<SessionView | null>("session_touch");
  }
  changeMasterPassword(currentPassword: string, newPassword: string) {
    return call<SessionView>("change_master_password", { currentPassword, newPassword });
  }
  getAccount() {
    return call<AccountSummary | null>("get_account");
  }

  listItems(query?: string, itemType?: ItemType | null, favoritesOnly?: boolean) {
    return call<ItemSummary[]>("list_items", {
      query: query ?? null,
      itemType: itemType ?? null,
      favoritesOnly: favoritesOnly ?? false,
    });
  }
  getItem(id: string) {
    return call<Item>("get_item", { id });
  }
  createItem(input: ItemFieldsInput) {
    return call<Item>("create_item", {
      fields: input.fields,
      title: input.title,
      notes: input.notes ?? null,
      tags: input.tags ?? null,
      favorite: input.favorite ?? false,
    });
  }
  updateItem(item: Item) {
    return call<Item>("update_item", { item });
  }
  deleteItem(id: string) {
    return call<void>("delete_item", { id });
  }
  duplicateItem(id: string) {
    return call<Item>("duplicate_item", { id });
  }
  toggleFavorite(id: string) {
    return call<Item>("toggle_favorite", { id });
  }
  vaultCounts() {
    return call<VaultCounts>("vault_counts");
  }
  securityReport() {
    return call<SecurityReport>("security_report");
  }
  copyField(id: string, field: string) {
    return call<CopyResult>("copy_field", { id, field });
  }
  openWebsite(url: string) {
    return call<void>("open_website", { url });
  }

  generatePassword(options: PasswordOptions) {
    return call<string>("generate_password", { options });
  }
  generatePassphrase(options: PassphraseOptions) {
    return call<string>("generate_passphrase", { options });
  }
  evaluatePassword(password: string) {
    return call<PasswordStrength>("evaluate_password", { password });
  }

  getSettings() {
    return call<AppSettings>("get_settings");
  }
  saveSettings(settings: AppSettings) {
    return call<AppSettings>("save_settings", { settings });
  }
  renameVault(name: string) {
    return call<string>("rename_vault", { name });
  }
  setUpdateChannel(channel: AppSettings["update_channel"], acknowledge: boolean) {
    return call<AppSettings>("set_update_channel", {
      channel,
      acknowledgePrerelease: acknowledge,
    });
  }
  listDevices() {
    return call<DeviceView[]>("list_devices");
  }
  revokeDevice(id: string) {
    return call<void>("revoke_device", { id });
  }

  storageInfo() {
    return call<StorageInfo>("storage_info");
  }
  createBackup() {
    return call<BackupInfo>("create_backup");
  }
  listBackups() {
    return call<BackupInfo[]>("list_backups");
  }
  restoreBackup(name: string) {
    return call<void>("restore_backup", { name });
  }
  openDataFolder() {
    return call<void>("open_data_folder");
  }
  openBackupsFolder() {
    return call<void>("open_backups_folder");
  }
  openExportsFolder() {
    return call<void>("open_exports_folder");
  }

  importPreview(payload: string, format?: ImportFormat | null) {
    return call<ParsedImport>("import_preview", { payload, format: format ?? null });
  }
  importApply(items: Item[], format?: ImportFormat | null) {
    return call<ImportResult>("import_apply", { items, format: format ?? null });
  }
  exportEncrypted(password: string) {
    return call<ExportInfo>("export_encrypted", { password });
  }
  exportPlaintextCsv(acknowledge: boolean) {
    return call<ExportInfo>("export_plaintext_csv", { acknowledgePlaintext: acknowledge });
  }
  importEncrypted(payload: string, password: string) {
    return call<ImportResult>("import_encrypted", { payload, password });
  }
  getFavicon(url: string) {
    return call<string | null>("get_favicon", { url });
  }

  updateStatus() {
    return call<UpdateStatusView>("update_status");
  }
  checkForUpdates(force: boolean) {
    return call<UpdateStatusView>("check_for_updates", { force });
  }
  downloadUpdate() {
    return call<UpdateStatusView>("download_update");
  }
  verifyUpdate() {
    return call<UpdateStatusView>("verify_update");
  }
  installUpdate() {
    return call<UpdateStatusView>("install_update");
  }
  discardUpdate() {
    return call<void>("discard_update");
  }
  async onUpdateProgress(handler: (received: number, total: number) => void) {
    const unlisten = await listen<{ received: number; total: number }>(
      "update://progress",
      (event) => handler(event.payload.received, event.payload.total),
    );
    return unlisten;
  }

  // advanced security features
  authenticatorEntries() {
    return call<TotpEntry[]>("authenticator_entries");
  }
  authenticatorAdd(uri: string) {
    return call<Item>("authenticator_add", { uri });
  }
  authenticatorExport(id: string) {
    return call<string>("authenticator_export", { id });
  }
  secretCopy(id: string, index: number) {
    return call<void>("secret_copy", { id, index });
  }
  secretReveal(id: string, index: number) {
    return call<string>("secret_reveal", { id, index });
  }
  secretAccessLog(id: string) {
    return call<SecretAccessEntry[]>("secret_access_log", { id });
  }
  secretClearHistory(id: string) {
    return call<void>("secret_clear_history", { id });
  }
  secretAlerts() {
    return call<SecretAlert[]>("secret_alerts");
  }
  breachScanVault() {
    return call<BreachScanResult>("breach_scan_vault");
  }
  breachCheckItem(id: string) {
    return call<BreachItemResult>("breach_check_item", { id });
  }
  lanIdentity() {
    return call<LanIdentity>("lan_identity");
  }
  lanPairingOffer() {
    return call<LanOffer>("lan_pairing_offer");
  }
  lanAwaitPairing(timeoutSecs: number) {
    return call<LanPairResult>("lan_await_pairing", { timeoutSecs });
  }
  lanPair(uri: string) {
    return call<LanPairResult>("lan_pair", { uri });
  }
  lanPeers() {
    return call<LanPeer[]>("lan_peers");
  }
  lanRevokePeer(id: string, revoke: boolean) {
    return call<void>("lan_revoke_peer", { id, revoke });
  }
  lanForgetPeer(id: string) {
    return call<void>("lan_forget_peer", { id });
  }
  lanTestPeer(id: string) {
    return call<LanPairResult>("lan_test_peer", { id });
  }
  lanSyncPeer(id: string) {
    return call<LanSyncResult>("lan_sync_peer", { id });
  }
  lanAcceptSync(timeoutSecs: number) {
    return call<LanSyncResult>("lan_accept_sync", { timeoutSecs });
  }

  windowMinimize() {
    return call<void>("window_minimize");
  }
  windowToggleMaximize() {
    return call<boolean>("window_toggle_maximize");
  }
  windowIsMaximized() {
    return call<boolean>("window_is_maximized");
  }
  windowClose() {
    return call<void>("window_close");
  }
}
