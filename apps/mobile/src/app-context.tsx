/**
 * App-wide state: theme, settings, session and the clipboard helper.
 *
 * Every secret copy goes through `copy`, so the clipboard auto-clear timeout
 * from Settings applies to passwords, TOTP codes and secret fields alike.
 */

import Clipboard from "@react-native-clipboard/clipboard";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, useColorScheme, View } from "react-native";

import { api, type AppSettings, type StatusResult } from "./native";
import { makeTheme, resolveScheme, type Theme } from "./theme";

interface AppContextValue {
  theme: Theme;
  settings: AppSettings;
  status: StatusResult | null;
  systemScheme: "light" | "dark";
  vaultVersion: number;
  applyStatus: (next: StatusResult) => void;
  saveSettings: (next: AppSettings) => Promise<void>;
  lock: (reason?: string) => Promise<void>;
  copy: (value: string, label?: string) => void;
  notify: (message: string) => void;
  bumpVault: () => void;
}

const fallbackSettings: AppSettings = {
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

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}

export function AppProvider(props: {
  status: StatusResult | null;
  onStatus: (next: StatusResult) => void;
  children: React.ReactNode;
}) {
  const systemPreference = useColorScheme();
  const systemScheme: "light" | "dark" = systemPreference === "light" ? "light" : "dark";
  const [toast, setToast] = useState<string | null>(null);
  const [vaultVersion, setVaultVersion] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settings = props.status?.settings ?? fallbackSettings;
  const theme = useMemo(
    () => makeTheme(resolveScheme(settings.appearance_mode, systemScheme), settings.theme_color, settings.density_compact),
    [settings.appearance_mode, settings.theme_color, settings.density_compact, systemScheme],
  );

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const copy = useCallback(
    (value: string, label = "Copied") => {
      Clipboard.setString(value);
      notify(settings.clipboard_clear_secs > 0 ? `${label} · clears in ${settings.clipboard_clear_secs}s` : label);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      if (settings.clipboard_clear_secs > 0) {
        clearTimer.current = setTimeout(() => {
          // Only clear what this app put there; the user may have copied
          // something else in the meantime.
          Clipboard.getString()
            .then((current) => {
              if (current === value) Clipboard.setString("");
            })
            .catch(() => undefined);
        }, settings.clipboard_clear_secs * 1000);
      }
    },
    [notify, settings.clipboard_clear_secs],
  );

  const lock = useCallback(
    async (reason?: string) => {
      try {
        await api.lock();
      } catch {
        // Locking is local; a bridge error must not keep the vault open in the UI.
      }
      try {
        props.onStatus(await api.status());
      } catch {
        // The caller still hides the vault by clearing the session view.
      }
      if (reason) notify(reason);
    },
    [notify, props],
  );

  const saveSettings = useCallback(
    async (next: AppSettings) => {
      const saved = await api.saveSettings(next);
      if (props.status) {
        props.onStatus({ ...props.status, settings: saved });
      }
    },
    [props],
  );

  const bumpVault = useCallback(() => setVaultVersion((current) => current + 1), []);

  const value = useMemo<AppContextValue>(
    () => ({
      theme,
      settings,
      status: props.status,
      systemScheme,
      vaultVersion,
      applyStatus: props.onStatus,
      saveSettings,
      lock,
      copy,
      notify,
      bumpVault,
    }),
    [bumpVault, copy, lock, notify, props.status, props.onStatus, saveSettings, settings, systemScheme, theme, vaultVersion],
  );

  return (
    <AppContext.Provider value={value}>
      {props.children}
      {toast ? (
        <View pointerEvents="none" style={styles.toastWrap}>
          <View style={[styles.toast, { backgroundColor: theme.text }]}>
            <Text style={[styles.toastText, { color: theme.bg }]}>{toast}</Text>
          </View>
        </View>
      ) : null}
    </AppContext.Provider>
  );
}

const styles = StyleSheet.create({
  toastWrap: { position: "absolute", left: 0, right: 0, bottom: 92, alignItems: "center" },
  toast: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, maxWidth: "86%" },
  toastText: { fontSize: 12.5, fontWeight: "600" },
});
