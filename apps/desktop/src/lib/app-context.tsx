import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useBackend } from "./backend-context";
import { useToast } from "@/components/toast";
import type {
  AccountSummary,
  AppSettings,
  AppStatus,
  Item,
  ItemFieldsInput,
  ItemSummary,
  ItemType,
  PasswordStrength,
  SecurityReport,
  SessionView,
  TypedItem,
  VaultCounts,
} from "./types";
import { DEFAULT_SETTINGS, BackendError } from "./types";

export type AuthMode = "unlock" | "add";

export type VaultFilter =
  | "all"
  | "favorites"
  | "login"
  | "secure_note"
  | "card"
  | "identity"
  | "document"
  | "custom";

const EMPTY_COUNTS: VaultCounts = {
  total: 0,
  favorites: 0,
  logins: 0,
  notes: 0,
  cards: 0,
  identities: 0,
  documents: 0,
  custom: 0,
};

interface AppContextValue {
  status: AppStatus | null;
  session: SessionView | null;
  /** Local accounts (one per vault) for the unlock screen's picker. */
  accounts: AccountSummary[];
  authMode: AuthMode;
  setAuthMode: (mode: AuthMode) => void;
  settings: AppSettings;
  items: ItemSummary[];
  counts: VaultCounts;
  report: SecurityReport | null;
  loading: boolean;
  booting: boolean;
  error: string | null;
  filter: VaultFilter;
  setFilter: (filter: VaultFilter) => void;
  query: string;
  setQuery: (query: string) => void;
  selectedId: string | null;
  selectedItem: TypedItem | null;
  selectItem: (id: string | null) => Promise<void>;
  createAccount: (username: string, password: string) => Promise<void>;
  addAccount: (username: string, password: string, vaultName: string) => Promise<void>;
  requestAddAccount: () => Promise<void>;
  unlock: (vaultId: string | null, username: string, password: string) => Promise<void>;
  /** Adopt a session the backend opened itself (account recovery). */
  adoptSession: (session: SessionView) => Promise<void>;
  lock: (reason?: string) => Promise<void>;
  logout: () => Promise<void>;
  createItem: (input: ItemFieldsInput) => Promise<Item>;
  updateItem: (item: TypedItem) => Promise<Item>;
  deleteItem: (id: string) => Promise<void>;
  duplicateItem: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  copyField: (id: string, field: string) => Promise<number>;
  openWebsite: (url: string) => Promise<void>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<boolean>;
  setUpdateChannel: (channel: AppSettings["update_channel"], acknowledge: boolean) => Promise<boolean>;
  renameVault: (name: string) => Promise<boolean>;
  changeMasterPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refresh: () => Promise<void>;
  recheckSecurity: () => Promise<void>;
  evaluatePassword: (password: string) => Promise<PasswordStrength | null>;
  isPreview: boolean;
  showToast: (toast: { title: string; description?: string; tone?: "info" | "success" | "error" }) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const FILTER_TYPES: Record<VaultFilter, ItemType | null> = {
  all: null,
  favorites: null,
  login: "login",
  secure_note: "secure_note",
  card: "card",
  identity: "identity",
  document: "document",
  custom: "custom",
};

export function AppProvider({ children }: { children: ReactNode }) {
  const backend = useBackend();
  const { push } = useToast();
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [session, setSession] = useState<SessionView | null>(null);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [authMode, setAuthMode] = useState<AuthMode>("unlock");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [counts, setCounts] = useState<VaultCounts>(EMPTY_COUNTS);
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<VaultFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<TypedItem | null>(null);

  const lastActivity = useRef(Date.now());
  const lastSync = useRef(0);
  const sessionRef = useRef<SessionView | null>(null);
  sessionRef.current = session;

  const preview = backend.kind === "preview";
  const isPreview = preview;

  const showToast = useCallback(
    (toast: { title: string; description?: string; tone?: "info" | "success" | "error" }) => {
      push(toast);
    },
    [push],
  );

  const refresh = useCallback(async () => {
    if (!sessionRef.current) return;
    setLoading(true);
    try {
      const [list, nextCounts] = await Promise.all([
        backend.listItems(query, FILTER_TYPES[filter], filter === "favorites"),
        backend.vaultCounts(),
      ]);
      setItems(list);
      setCounts(nextCounts);
      setError(null);
    } catch (cause) {
      if (cause instanceof BackendError && cause.code === "locked") {
        setSession(null);
        setItems([]);
        setSelectedItem(null);
      } else {
        setError(cause instanceof Error ? cause.message : "Could not load the vault");
      }
    } finally {
      setLoading(false);
    }
  }, [backend, filter, query]);

  const refreshSecurity = useCallback(async () => {
    if (!sessionRef.current) return;
    try {
      setReport(await backend.securityReport());
    } catch {
      setReport(null);
    }
  }, [backend]);

  // Boot: read status, settings and (if the process is still unlocked) data.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nextStatus, nextSettings, nextAccounts] = await Promise.all([
          backend.appStatus(),
          backend.getSettings(),
          backend.listAccounts().catch(() => [] as AccountSummary[]),
        ]);
        if (cancelled) return;
        setStatus(nextStatus);
        setSettings(nextSettings);
        setAccounts(nextAccounts);
        if (nextStatus.hasAccount && !nextStatus.locked && nextStatus.session) {
          setSession(nextStatus.session);
        }
      } catch {
        if (!cancelled) setError("Could not start Acuye Pass");
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend]);

  // Load list whenever the filter/query/session changes.
  useEffect(() => {
    if (!session) {
      setItems([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void refresh();
    }, query ? 120 : 0);
    return () => window.clearTimeout(timer);
  }, [session, refresh, query]);

  useEffect(() => {
    if (session) void refreshSecurity();
    else setReport(null);
  }, [session, refreshSecurity]);

  const reloadAll = useCallback(async () => {
    await refresh();
    await refreshSecurity();
  }, [refresh, refreshSecurity]);

  // Idle auto-lock and periodic backend session touch.
  useEffect(() => {
    if (!session) return;
    const markActivity = () => {
      lastActivity.current = Date.now();
      const now = Date.now();
      if (now - lastSync.current > 45_000) {
        lastSync.current = now;
        void backend.sessionTouch().then((live) => {
          if (!live) setSession(null);
        });
      }
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "wheel", "focus"];
    events.forEach((event) => window.addEventListener(event, markActivity, { passive: true }));

    const timer = window.setInterval(() => {
      const timeout = settings.auto_lock_secs;
      if (timeout > 0 && Date.now() - lastActivity.current >= timeout * 1000) {
        void backend.lock();
        setSession(null);
        setSelectedId(null);
        setSelectedItem(null);
        setItems([]);
        setReport(null);
        push({ title: "Vault locked", description: "Locked automatically after inactivity.", tone: "info" });
      }
    }, 2000);

    return () => {
      events.forEach((event) => window.removeEventListener(event, markActivity));
      window.clearInterval(timer);
    };
  }, [backend, session, settings.auto_lock_secs, push]);

  const createAccount = useCallback(
    async (username: string, password: string) => {
      const next = await backend.createAccount(username, password);
      setSession(next);
      setAuthMode("unlock");
      lastActivity.current = Date.now();
      setStatus((current) => (current ? { ...current, hasAccount: true, username: next.username, locked: false, session: next } : current));
      setAccounts(await backend.listAccounts().catch(() => [] as AccountSummary[]));
    },
    [backend],
  );

  const addAccount = useCallback(
    async (username: string, password: string, vaultName: string) => {
      const next = await backend.addAccount(username, password, vaultName.trim() || null);
      setSession(next);
      setAuthMode("unlock");
      lastActivity.current = Date.now();
      setStatus((current) => (current ? { ...current, hasAccount: true, username: next.username, locked: false, session: next } : current));
      setAccounts(await backend.listAccounts().catch(() => [] as AccountSummary[]));
    },
    [backend],
  );

  const unlock = useCallback(
    async (vaultId: string | null, username: string, password: string) => {
      const next = await backend.unlock(vaultId, username, password);
      setSession(next);
      setAuthMode("unlock");
      lastActivity.current = Date.now();
      setStatus((current) => (current ? { ...current, locked: false, session: next } : current));
    },
    [backend],
  );

  const adoptSession = useCallback(
    async (next: SessionView) => {
      setSession(next);
      setAuthMode("unlock");
      lastActivity.current = Date.now();
      setStatus((current) =>
        current ? { ...current, hasAccount: true, username: next.username, locked: false, session: next } : current,
      );
      setAccounts(await backend.listAccounts().catch(() => [] as AccountSummary[]));
    },
    [backend],
  );

  const lock = useCallback(
    async (reason?: string) => {
      await backend.lock();
      setSession(null);
      setSelectedId(null);
      setSelectedItem(null);
      setItems([]);
      setReport(null);
      setQuery("");
      setStatus((current) => (current ? { ...current, locked: true, session: null } : current));
      if (reason) push({ title: "Vault locked", description: reason });
    },
    [backend, push],
  );

  const logout = useCallback(async () => {
    await backend.logout();
    await lock();
    push({ title: "Signed out", description: "Your vault is locked." });
  }, [backend, lock, push]);

  /// Lock the open vault and open the unlock screen in "add account" mode.
  const requestAddAccount = useCallback(async () => {
    setAuthMode("add");
    await lock();
  }, [lock]);

  const selectItem = useCallback(
    async (id: string | null) => {
      setSelectedId(id);
      if (!id) {
        setSelectedItem(null);
        return;
      }
      try {
        setSelectedItem((await backend.getItem(id)) as TypedItem);
      } catch {
        setSelectedItem(null);
        setSelectedId(null);
      }
    },
    [backend],
  );

  const createItem = useCallback(
    async (input: ItemFieldsInput) => {
      const item = await backend.createItem(input);
      await reloadAll();
      await selectItem(item.id);
      return item;
    },
    [backend, reloadAll, selectItem],
  );

  const updateItem = useCallback(
    async (item: TypedItem) => {
      const updated = await backend.updateItem(item as unknown as Item);
      await reloadAll();
      await selectItem(updated.id);
      return updated;
    },
    [backend, reloadAll, selectItem],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      await backend.deleteItem(id);
      if (selectedId === id) {
        setSelectedId(null);
        setSelectedItem(null);
      }
      await reloadAll();
    },
    [backend, reloadAll, selectedId],
  );

  const duplicateItem = useCallback(
    async (id: string) => {
      const copy = await backend.duplicateItem(id);
      await reloadAll();
      await selectItem(copy.id);
    },
    [backend, reloadAll, selectItem],
  );

  const toggleFavorite = useCallback(
    async (id: string) => {
      await backend.toggleFavorite(id);
      await reloadAll();
      setSelectedItem((current) => (current && current.id === id ? { ...current, favorite: !current.favorite } : current));
    },
    [backend, reloadAll],
  );

  const copyField = useCallback(
    async (id: string, field: string) => {
      const result = await backend.copyField(id, field);
      return result.clearAfterSecs;
    },
    [backend],
  );

  const openWebsite = useCallback(
    async (url: string) => {
      await backend.openWebsite(url);
    },
    [backend],
  );

  const saveSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const previous = settings;
      const next = { ...settings, ...patch };
      setSettings(next);
      try {
        const saved = await backend.saveSettings(next);
        setSettings(saved);
        return true;
      } catch (cause) {
        setSettings(previous);
        push({
          title: "Could not save settings",
          description: cause instanceof Error ? cause.message : undefined,
          tone: "error",
        });
        return false;
      }
    },
    [backend, settings, push],
  );

  const setUpdateChannel = useCallback(
    async (channel: AppSettings["update_channel"], acknowledge: boolean) => {
      try {
        const saved = await backend.setUpdateChannel(channel, acknowledge);
        setSettings(saved);
        return true;
      } catch (cause) {
        push({
          title: "Could not change the release channel",
          description: cause instanceof Error ? cause.message : undefined,
          tone: "error",
        });
        return false;
      }
    },
    [backend, push],
  );

  const renameVault = useCallback(
    async (name: string) => {
      try {
        const saved = await backend.renameVault(name);
        setSession((current) => (current ? { ...current, vaultName: saved } : current));
        push({ title: "Vault renamed", tone: "success" });
        return true;
      } catch (cause) {
        push({
          title: "Could not rename the vault",
          description: cause instanceof Error ? cause.message : undefined,
          tone: "error",
        });
        return false;
      }
    },
    [backend, push],
  );

  const changeMasterPassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const next = await backend.changeMasterPassword(currentPassword, newPassword);
      setSession(next);
      push({
        title: "Master password changed",
        description: "A new vault key was generated and every item was re-encrypted.",
        tone: "success",
      });
    },
    [backend, push],
  );

  const evaluatePassword = useCallback(
    async (password: string) => {
      if (!password) return null;
      try {
        return await backend.evaluatePassword(password);
      } catch {
        return null;
      }
    },
    [backend],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      status,
      session,
      accounts,
      authMode,
      setAuthMode,
      settings,
      items,
      counts,
      report,
      loading,
      booting,
      error,
      filter,
      setFilter,
      query,
      setQuery,
      selectedId,
      selectedItem,
      selectItem,
      createAccount,
      addAccount,
      requestAddAccount,
      unlock,
      adoptSession,
      lock,
      logout,
      createItem,
      updateItem,
      deleteItem,
      duplicateItem,
      toggleFavorite,
      copyField,
      openWebsite,
      saveSettings,
      setUpdateChannel,
      renameVault,
      changeMasterPassword,
      refresh,
      recheckSecurity: refreshSecurity,
      evaluatePassword,
      isPreview,
      showToast,
    }),
    [
      status,
      session,
      accounts,
      authMode,
      settings,
      items,
      counts,
      report,
      loading,
      booting,
      error,
      filter,
      query,
      selectedId,
      selectedItem,
            selectItem,
      createAccount,
      addAccount,
      requestAddAccount,
      unlock,
      adoptSession,
      lock,
      logout,
      createItem,
      updateItem,
      deleteItem,
      duplicateItem,
      toggleFavorite,
      copyField,
      openWebsite,
      saveSettings,
      setUpdateChannel,


      renameVault,
      changeMasterPassword,
      refresh,
      refreshSecurity,
      evaluatePassword,
      isPreview,
      showToast,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}

export function filterToType(filter: VaultFilter): ItemType | null {
  return FILTER_TYPES[filter];
}
