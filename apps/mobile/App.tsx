/**
 * Acuye Pass for Android.
 *
 * A native-feeling client over the same Rust crates as the desktop app: the
 * vault is opened by `crates/acuye-ffi` over JNI, the master password never
 * leaves the device, and every secret shown here is decrypted in Rust.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from "react-native";

import { AppProvider, useApp } from "./src/app-context";
import { Fade } from "./src/components/ui";
import { api, errorMessage, nativeAvailable, type ItemFields, type StatusResult, type VaultItem } from "./src/native";
import { AuthenticatorScreen } from "./src/screens/AuthenticatorScreen";
import { GeneratorScreen } from "./src/screens/GeneratorScreen";
import { ItemDetailScreen } from "./src/screens/ItemDetail";
import { ItemEditor } from "./src/screens/ItemEditor";
import { SecurityScreen } from "./src/screens/SecurityScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { UnlockScreen } from "./src/screens/Unlock";
import { VaultScreen } from "./src/screens/VaultScreen";

type Tab = "vault" | "codes" | "generate" | "security" | "settings";

const TABS: { key: Tab; label: string }[] = [
  { key: "vault", label: "Vault" },
  { key: "codes", label: "Codes" },
  { key: "generate", label: "Generate" },
  { key: "security", label: "Security" },
  { key: "settings", label: "Settings" },
];

export default function App() {
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    if (!nativeAvailable) {
      setBootError(
        "This build has no native vault library, so it cannot open a vault. Install an APK built by .github/workflows/android.yml or by a tagged release (.github/workflows/android-release.yml).",
      );
      setBooted(true);
      return;
    }
    api
      .status()
      .then(setStatus)
      .catch((cause: unknown) => setBootError(errorMessage(cause, "The vault could not be opened")))
      .finally(() => setBooted(true));
  }, []);

  return (
    <AppProvider status={status} onStatus={setStatus}>
      <Shell status={status} booted={booted} bootError={bootError} setStatus={setStatus} />
    </AppProvider>
  );
}

function Shell(props: {
  status: StatusResult | null;
  booted: boolean;
  bootError: string | null;
  setStatus: (next: StatusResult) => void;
}) {
  const { theme, status, lock, notify, bumpVault } = useApp();
  const [tab, setTab] = useState<Tab>("vault");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ item: VaultItem | null; kind?: ItemFields["kind"] } | null>(null);

  const activity = useRef(Date.now());
  const backgroundedAt = useRef<number | null>(null);
  const locked = useRef(false);

  const unlocked = Boolean(status?.unlocked);

  const doLock = useCallback(
    async (reason?: string) => {
      setDetailId(null);
      setEditor(null);
      await lock(reason);
    },
    [lock],
  );

  // Auto-lock: Rust enforces the idle timeout on every command; this timer
  // makes the UI follow immediately and also locks after backgrounding.
  useEffect(() => {
    if (!unlocked) return;
    const seconds = status?.settings.auto_lock_secs ?? 0;
    if (seconds <= 0) return;
    const timer = setInterval(() => {
      if (locked.current) return;
      const idleFor = (Date.now() - activity.current) / 1000;
      if (idleFor >= seconds) {
        locked.current = true;
        void doLock("Vault locked after inactivity");
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [doLock, status?.settings.auto_lock_secs, unlocked]);

  useEffect(() => {
    if (!unlocked) {
      locked.current = false;
      activity.current = Date.now();
      return;
    }
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        backgroundedAt.current = Date.now();
      } else if (next === "active") {
        const away = backgroundedAt.current ? (Date.now() - backgroundedAt.current) / 1000 : 0;
        const seconds = status?.settings.auto_lock_secs ?? 0;
        backgroundedAt.current = null;
        activity.current = Date.now();
        if (seconds > 0 && away >= seconds) {
          void doLock("Vault locked while you were away");
        }
      }
    });
    return () => subscription.remove();
  }, [doLock, status?.settings.auto_lock_secs, unlocked]);

  useEffect(() => {
    if (!unlocked) {
      setDetailId(null);
      setEditor(null);
    }
  }, [unlocked]);

  const openItem = useCallback((id: string) => {
    activity.current = Date.now();
    setDetailId(id);
  }, []);

  const create = useCallback((kind?: ItemFields["kind"]) => {
    activity.current = Date.now();
    setEditor({ item: null, kind });
  }, []);

  if (!props.booted) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]}>
        <StatusBar barStyle={theme.scheme === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <View style={styles.center}>
          <Text style={[styles.bootTitle, { color: theme.text }]}>Acuye Pass</Text>
          <Text style={[styles.bootBody, { color: theme.muted }]}>Opening your device vault…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!nativeAvailable) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]}>
        <StatusBar barStyle={theme.scheme === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <View style={[styles.center, styles.padded]}>
          <Text style={[styles.bootTitle, { color: theme.text }]}>Acuye Pass</Text>
          <Text style={[styles.bootBody, { color: theme.muted }]}>{props.bootError}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!props.status) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]}>
        <StatusBar barStyle={theme.scheme === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <View style={[styles.center, styles.padded]}>
          <Text style={[styles.bootTitle, { color: theme.text }]}>Could not open the vault</Text>
          <Text style={[styles.bootBody, { color: theme.muted }]}>{props.bootError ?? "Try restarting the app."}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!props.status.unlocked) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]}>
        <StatusBar barStyle={theme.scheme === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <UnlockScreen status={props.status} onUnlocked={props.setStatus} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={theme.scheme === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View
        style={styles.root}
        onStartShouldSetResponderCapture={() => {
          activity.current = Date.now();
          return false;
        }}
      >
        <Fade trigger={tab}>
          {tab === "vault" ? (
            <VaultScreen onOpenItem={openItem} onCreate={() => create()} onLock={() => void doLock()} />
          ) : null}
          {tab === "codes" ? <AuthenticatorScreen onOpenItem={openItem} onCreate={() => create("totp")} /> : null}
          {tab === "generate" ? <GeneratorScreen /> : null}
          {tab === "security" ? <SecurityScreen onOpenItem={openItem} /> : null}
          {tab === "settings" ? (
            <SettingsScreen
              onLock={() => void doLock()}
              onChanged={async () => {
                try {
                  bumpVault();
                  props.setStatus(await api.status());
                } catch (cause) {
                  notify(errorMessage(cause, "Could not refresh the session"));
                }
              }}
            />
          ) : null}
        </Fade>

        <View style={[styles.tabBar, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
          {TABS.map((entry) => {
            const active = tab === entry.key;
            return (
              <Pressable
                key={entry.key}
                onPress={() => {
                  activity.current = Date.now();
                  setTab(entry.key);
                }}
                style={styles.tab}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <View
                  style={[
                    styles.tabDot,
                    { backgroundColor: active ? theme.accent : "transparent", borderColor: theme.border },
                  ]}
                />
                <Text style={[styles.tabLabel, { color: active ? theme.accent : theme.muted }]}>{entry.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <ItemDetailScreen
          itemId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(item) => {
            setDetailId(null);
            setEditor({ item });
          }}
          onChanged={() => undefined}
        />
        <ItemEditor
          visible={Boolean(editor)}
          initial={editor?.item ?? null}
          initialKind={editor?.kind}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setTab("vault");
            bumpVault();
            void api
              .status()
              .then(props.setStatus)
              .catch(() => undefined);
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  padded: { paddingHorizontal: 28 },
  bootTitle: { fontSize: 22, fontWeight: "800" },
  bootBody: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  tabBar: { flexDirection: "row", borderTopWidth: 1, paddingTop: 8, paddingBottom: 10 },
  tab: { flex: 1, alignItems: "center", gap: 5 },
  tabDot: { width: 18, height: 3, borderRadius: 999, borderWidth: 0 },
  tabLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.2 },
});
