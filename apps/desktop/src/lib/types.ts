// Types mirroring the Rust command surface. Rust models use snake_case for
// domain objects and camelCase for command view structs.

export type ItemType =
  | "login"
  | "secure_note"
  | "card"
  | "identity"
  | "document"
  | "custom"
  | "totp"
  | "secret";

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
  | {
      kind: "document";
      filename: string;
      mime_type: string;
      size_bytes: number;
      sha256: string;
    }
  | { kind: "custom"; fields: CustomField[] }
  | {
      kind: "totp";
      secret: string;
      issuer: string;
      account: string;
      algorithm: string;
      digits: number;
      period: number;
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

export interface Item {
  id: string;
  title: string;
  notes: string;
  tags: string[];
  favorite: boolean;
  created_at: number;
  updated_at: number;
  kind: ItemType;
  [key: string]: unknown;
}

/** Item with typed fields (backend flattens fields into the item object). */
export type TypedItem = Item & ItemFields;

export interface ItemSummary {
  id: string;
  title: string;
  item_type: ItemType;
  subtitle: string;
  favorite: boolean;
  tags: string[];
  updated_at: number;
  host: string;
  has_password: boolean;
}

export interface ItemFieldsInput {
  fields: ItemFields;
  title: string;
  notes?: string;
  tags?: string[];
  favorite?: boolean;
}

export type CreateResult = Item;

export type ThemeColor = "blue" | "white" | "red" | "green" | "yellow" | "monochrome";
export type AppearanceMode = "light" | "dark" | "system";

export interface SyncProviderConfig {
  endpoint: string;
  device_name: string;
  enabled: boolean;
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
  sync_provider: SyncProviderConfig | null;
  telemetry: boolean;
}

export interface SessionView {
  username: string;
  vaultId: string;
  vaultName: string;
  itemCount: number;
  idleTimeoutSecs: number;
}

export interface AppStatus {
  hasAccount: boolean;
  username: string | null;
  locked: boolean;
  appVersion: string;
  platform: string;
  dataDir: string;
  databaseSize: number;
  repository: string;
  kdfMemoryKib: number;
  kdfIterations: number;
  session: SessionView | null;
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
}

export type SecurityIssueKind =
  | "weak_password"
  | "reused_password"
  | "old_password"
  | "empty_password";

export interface VaultSecurityItem {
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
  issues: VaultSecurityItem[];
  scanned_at: number;
}

export interface CopyResult {
  field: string;
  clearAfterSecs: number;
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

export interface PasswordStrength {
  bits: number;
  score: number;
  label: string;
  feedback: string[];
}

export interface DeviceView {
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
  items: TypedItem[];
  skipped: number;
  warnings: string[];
}

export interface ImportResult {
  imported: number;
  renamed: number;
}

export interface AccountSummary {
  username: string;
  vault_id: string;
  vault_name: string;
  kdf_algorithm: string;
  kdf_memory_kib: number;
  kdf_iterations: number;
  created_at: number;
}

export type ReleaseChannel = "stable" | "beta" | "alpha";

export interface UpdateAsset {
  name: string;
  url: string;
  size: number;
  signature_url: string;
}

export interface UpdateCandidate {
  version: string;
  tag_name: string;
  notes: string;
  published_at: string;
  prerelease: boolean;
  channel: ReleaseChannel;
  asset: UpdateAsset;
}

export type UpdateStage =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "verified"
  | "installing"
  | "up_to_date"
  | "failed";

export interface VerifiedUpdate {
  version: string;
  path: string;
  sha256: string;
  size: number;
}

export interface UpdateStatusView {
  currentVersion: string;
  channel: ReleaseChannel;
  stage: UpdateStage;
  available: UpdateCandidate | null;
  verified: VerifiedUpdate | null;
  progress: number | null;
  total: number | null;
  error: string | null;
  signingConfigured: boolean;
  repository: string;
  lastCheck: number | null;
  downloadPath: string | null;
}

export class BackendError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BackendError";
    this.code = code;
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme_color: "blue",
  appearance_mode: "system",
  sidebar_collapsed: false,
  reduce_motion: false,
  density_compact: false,
  auto_lock_secs: 300,
  clipboard_clear_secs: 30,
  confirm_delete: true,
  favicon_enabled: true,
  shortcuts_enabled: true,
  update_channel: "stable",
  update_auto_check: true,
  last_update_check: null,
  sync_provider: null,
  telemetry: false,
};

export const emptyFields = (kind: ItemType): ItemFields => {
  switch (kind) {
    case "login":
      return {
        kind: "login",
        username: "",
        password: "",
        url: "",
        totp: "",
        password_changed_at: null,
      };
    case "secure_note":
      return { kind: "secure_note" };
    case "card":
      return {
        kind: "card",
        cardholder: "",
        number: "",
        expiry_month: "",
        expiry_year: "",
        cvv: "",
        brand: "",
        pin: "",
      };
    case "identity":
      return {
        kind: "identity",
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        address: "",
        city: "",
        state: "",
        postal_code: "",
        country: "",
        company: "",
      };
    case "document":
      return { kind: "document", filename: "", mime_type: "", size_bytes: 0, sha256: "" };
    case "custom":
      return { kind: "custom", fields: [{ label: "", value: "", concealed: false }] };
    case "totp":
      return {
        kind: "totp",
        secret: "",
        issuer: "",
        account: "",
        algorithm: "sha1",
        digits: 6,
        period: 30,
      };
    case "secret":
      return {
        kind: "secret",
        environment: "development",
        category: "",
        fields: [{ label: "", value: "", concealed: true }],
        expires_at: null,
        rotate_every_days: null,
        last_rotated_at: null,
      };
  }
};

export const itemTypeLabel = (kind: ItemType): string => {
  switch (kind) {
    case "login":
      return "Password";
    case "secure_note":
      return "Secure Note";
    case "card":
      return "Card";
    case "identity":
      return "Identity";
    case "document":
      return "Document";
    case "custom":
      return "Custom";
    case "totp":
      return "Authenticator";
    case "secret":
      return "Secret";
  }
};

// ---------------------------------------------------------------------------
// Advanced security features
// ---------------------------------------------------------------------------

export type SecretEnvironment = "development" | "testing" | "production";

/** One authenticator entry with its current code, computed in Rust. */
export interface TotpEntry {
  id: string;
  title: string;
  issuer: string;
  account: string;
  code: string;
  digits: number;
  period: number;
  remaining: number;
  algorithm: string;
  error: string | null;
}

export interface SecretAccessEntry {
  action: string;
  at: number;
}

export interface SecretAlert {
  id: string;
  title: string;
  kind: "expired" | "expiring" | "rotation_due" | "rotation_soon";
  dueAt: number;
}

export type BreachStatusKind = "clean" | "breached" | "unavailable";

export interface BreachItemResult {
  id: string;
  title: string;
  status: BreachStatusKind;
  count: number;
  detail: string;
}

export interface BreachScanResult {
  checked: number;
  breached: number;
  clean: number;
  unavailable: number;
  results: BreachItemResult[];
  scannedAt: number;
}

export interface LanIdentity {
  deviceId: string;
  address: string;
  port: number;
}

export interface LanOffer {
  deviceId: string;
  address: string;
  uri: string;
  expiresAt: number;
}

export interface LanPeer {
  id: string;
  name: string;
  platform: string;
  address: string;
  pairedAt: number;
  lastSeenAt: number;
  revoked: boolean;
}

export interface LanPairResult {
  peer: LanPeer;
  sas: string;
}

export interface LanSyncResult {
  peerName: string;
  received: number;
  sent: number;
  merged: number;
  sas: string;
}
