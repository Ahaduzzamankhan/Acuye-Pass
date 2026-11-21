/**
 * Typed wrapper around the Rust core.
 *
 * `NativeModules.Acuye` is implemented by `AcuyeModule.kt`, which forwards each
 * call to the JNI functions in `crates/acuye-ffi` and resolves with the JSON
 * string the Rust core produced. Nothing here decrypts anything in JS.
 */

import { NativeModules } from "react-native";

export interface VaultAccount {
  vaultId: string;
  username: string;
  vaultName: string;
}

export interface VaultSession {
  vaultId: string;
  username: string;
  vaultName: string;
  itemCount: number;
}

export interface StatusResult {
  ok: true;
  version: string;
  accounts: VaultAccount[];
  unlocked: boolean;
  session: VaultSession | null;
}

export interface ItemSummary {
  id: string;
  title: string;
  subtitle: string;
  type: string;
  typeLabel: string;
  favorite: boolean;
  host: string;
  hasPassword: boolean;
  updatedAt: number;
}

export interface VaultItem {
  id: string;
  title: string;
  notes: string;
  tags: string[];
  kind: string;
  favorite: boolean;
  updated_at: number;
  username?: string;
  password?: string;
  url?: string;
  totp?: string;
  cardholder?: string;
  number?: string;
  fields?: { label: string; value: string; concealed: boolean }[];
  secret?: string;
}

export interface TotpCode {
  code: string;
  remaining: number;
  period: number;
}

interface JniBridge {
  status(dbPath: string): Promise<string>;
  createAccount(dbPath: string, username: string, password: string): Promise<string>;
  unlock(dbPath: string, vaultId: string, username: string, password: string): Promise<string>;
  lock(): Promise<string>;
  list(dbPath: string, query: string): Promise<string>;
  item(dbPath: string, id: string): Promise<string>;
  secret(dbPath: string, id: string, field: string): Promise<string>;
  totp(dbPath: string, id: string): Promise<string>;
  createLogin(
    dbPath: string,
    title: string,
    username: string,
    password: string,
    url: string,
    notes: string,
  ): string;
  generate(optionsJson: string): Promise<string>;
}

interface DirectoryModule {
  dataDir(): Promise<string>;
}

const nativeModule = NativeModules.Acuye as (JniBridge & DirectoryModule) | undefined;
const bridge = nativeModule;

/** False in a JS-only preview and in any build without the Rust library. */
export const nativeAvailable = Boolean(
  nativeModule &&
    typeof nativeModule.status === "function" &&
    typeof nativeModule.dataDir === "function",
);

let dbPath: string | null = null;

function jni(): JniBridge {
  if (!bridge) {
    throw new Error("The native vault library is not available in this build.");
  }
  return bridge;
}

async function path(): Promise<string> {
  if (dbPath) return dbPath;
  if (!nativeModule) {
    throw new Error("The app data directory is unavailable.");
  }
  dbPath = `${await nativeModule.dataDir()}/acuye.db`;
  return dbPath;
}

function parse<T>(raw: string): T {
  let value: { ok?: boolean; message?: string } & Record<string, unknown>;
  try {
    value = JSON.parse(raw) as { ok?: boolean; message?: string } & Record<string, unknown>;
  } catch {
    throw new Error("The vault returned an unreadable answer.");
  }
  if (!value.ok) {
    throw new Error(typeof value.message === "string" ? value.message : "The vault refused the request.");
  }
  return value as unknown as T;
}

export const vault = {
  async status(): Promise<StatusResult> {
    return parse<StatusResult>(await jni().status(await path()));
  },

  async createAccount(username: string, password: string): Promise<StatusResult> {
    return parse<StatusResult>(await jni().createAccount(await path(), username, password));
  },

  async unlock(vaultId: string | null, username: string, password: string): Promise<StatusResult> {
    return parse<StatusResult>(
      await jni().unlock(await path(), vaultId ?? "", username, password),
    );
  },

  async lock(): Promise<void> {
    parse<{ ok: true }>(await jni().lock());
  },

  async list(query = ""): Promise<ItemSummary[]> {
    return parse<{ items: ItemSummary[] }>(await jni().list(await path(), query)).items;
  },

  async item(id: string): Promise<VaultItem> {
    return parse<{ item: VaultItem }>(await jni().item(await path(), id)).item;
  },

  async secret(id: string, field: string): Promise<string> {
    return parse<{ value: string }>(await jni().secret(await path(), id, field)).value;
  },

  async totp(id: string): Promise<TotpCode> {
    return parse<TotpCode>(await jni().totp(await path(), id));
  },

  async createLogin(input: {
    title: string;
    username: string;
    password: string;
    url: string;
    notes: string;
  }): Promise<VaultItem> {
    return parse<{ item: VaultItem }>(
      await jni().createLogin(
        await path(),
        input.title,
        input.username,
        input.password,
        input.url,
        input.notes,
      ),
    ).item;
  },

  async generatePassword(length = 24): Promise<string> {
    return parse<{ password: string }>(await jni().generate(JSON.stringify({ length }))).password;
  },
};
