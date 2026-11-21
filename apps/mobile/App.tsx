/**
 * Acuye Pass for Android.
 *
 * A thin, native-feeling client over the same Rust crates as the desktop app:
 * the vault is opened by `crates/acuye-ffi` over JNI, the master password never
 * leaves the device, and every secret shown here is decrypted in Rust.
 */

import Clipboard from "@react-native-clipboard/clipboard";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  nativeAvailable,
  vault,
  type ItemSummary,
  type StatusResult,
  type TotpCode,
  type VaultAccount,
  type VaultItem,
} from "./src/native";

const colors = {
  background: "#0b1220",
  surface: "#131c2e",
  surfaceAlt: "#1a2439",
  border: "#243049",
  text: "#f1f5f9",
  muted: "#94a3b8",
  accent: "#7c8cff",
  accentSoft: "rgba(124,140,255,0.16)",
  success: "#34d399",
  danger: "#f87171",
};

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: "default" | "email-address" | "url";
}) {
  const [hidden, setHidden] = useState(Boolean(props.secure));
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{props.label}</Text>
        {props.secure ? (
          <Pressable onPress={() => setHidden((current) => !current)} hitSlop={8}>
            <Text style={styles.link}>{hidden ? "Show" : "Hide"}</Text>
          </Pressable>
        ) : null}
      </View>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={hidden}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={props.keyboardType ?? "default"}
      />
    </View>
  );
}

function PrimaryButton(props: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "primary" | "ghost" | "danger";
}) {
  const toneStyle =
    props.tone === "ghost"
      ? styles.buttonGhost
      : props.tone === "danger"
        ? styles.buttonDanger
        : styles.buttonPrimary;
  const textStyle =
    props.tone === "ghost" ? styles.buttonGhostText : styles.buttonPrimaryText;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled || props.busy}
      style={({ pressed }) => [
        styles.button,
        toneStyle,
        (props.disabled || props.busy) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={colors.text} size="small" />
      ) : (
        <Text style={textStyle}>{props.label}</Text>
      )}
    </Pressable>
  );
}

function UnlockScreen(props: {
  accounts: VaultAccount[];
  status: StatusResult | null;
  onUnlocked: (status: StatusResult) => void;
}) {
  const [selected, setSelected] = useState<string | null>(props.accounts[0]?.vaultId ?? null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstRun = props.accounts.length === 0;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const status = firstRun || creating
        ? await vault.createAccount(username.trim(), password)
        : await vault.unlock(props.accounts.length > 0 ? selected : null, username, password);
      setPassword("");
      setConfirm("");
      props.onUnlocked(status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = creating || firstRun
    ? Boolean(username.trim() && password && password === confirm)
    : Boolean(password);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.lockedContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logo}>
          <Text style={styles.logoGlyph}>A</Text>
        </View>
        <Text style={styles.title}>{firstRun || creating ? "Create your vault" : "Unlock your vault"}</Text>
        <Text style={styles.subtitle}>
          {firstRun || creating
            ? "One master password, stored nowhere. It derives the only key that decrypts this vault."
            : "Everything is decrypted on this device. Nothing leaves it."}
        </Text>

        {!creating && !firstRun ? (
          <View style={styles.accountList}>
            {props.accounts.map((account) => {
              const active = account.vaultId === selected;
              return (
                <Pressable
                  key={account.vaultId}
                  onPress={() => setSelected(account.vaultId)}
                  style={[styles.accountChip, active && styles.accountChipActive]}
                >
                  <Text style={[styles.accountName, active && styles.accountNameActive]}>
                    {account.username}
                  </Text>
                  <Text style={styles.accountVault}>{account.vaultName}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {creating || firstRun ? (
          <Field label="Account name" value={username} onChangeText={setUsername} placeholder="you@example.com" />
        ) : null}

        <Field
          label={creating || firstRun ? "Master password" : "Master password"}
          value={password}
          onChangeText={setPassword}
          secure
          placeholder="At least 10 characters"
        />

        {creating || firstRun ? (
          <Field label="Confirm password" value={confirm} onChangeText={setConfirm} secure />
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <PrimaryButton
          label={firstRun || creating ? "Create vault" : "Unlock"}
          onPress={() => void submit()}
          busy={busy}
          disabled={!canSubmit}
        />

        {props.accounts.length > 0 ? (
          <Pressable onPress={() => setCreating((current) => !current)} hitSlop={8}>
            <Text style={styles.linkCenter}>
              {creating ? "Back to unlock" : "Add another account"}
            </Text>
          </Pressable>
        ) : null}

        <Text style={styles.footer}>
          {props.status ? `Core ${props.status.version} · Argon2id · XChaCha20-Poly1305` : ""}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function DetailRow(props: { label: string; value: string; secret?: boolean }) {
  const [revealed, setRevealed] = useState(!props.secret);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    Clipboard.setString(props.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <View style={styles.detailRow}>
      <View style={styles.flex}>
        <Text style={styles.detailLabel}>{props.label}</Text>
        <Text style={styles.detailValue} selectable={revealed} numberOfLines={revealed ? 4 : 1}>
          {revealed ? props.value : "••••••••••••"}
        </Text>
      </View>
      <View style={styles.detailActions}>
        {props.secret ? (
          <Pressable onPress={() => setRevealed((current) => !current)} hitSlop={8}>
            <Text style={styles.link}>{revealed ? "Hide" : "Show"}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={copy} hitSlop={8}>
          <Text style={styles.link}>{copied ? "Copied" : "Copy"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function AuthenticatorBlock(props: { itemId: string }) {
  const [code, setCode] = useState<TotpCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const itemId = props.itemId;

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await vault.totp(itemId);
        if (!cancelled) {
          setCode(next);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "No authenticator");
        }
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [itemId]);

  if (error) return null;
  if (!code) return null;

  return (
    <View style={styles.totpBox}>
      <View style={styles.flex}>
        <Text style={styles.detailLabel}>Authenticator code</Text>
        <Text style={styles.totpCode}>
          {code.code.slice(0, 3)} {code.code.slice(3)}
        </Text>
      </View>
      <View style={styles.totpMeta}>
        <Text style={styles.totpRemaining}>{code.remaining}s</Text>
        <Pressable onPress={() => Clipboard.setString(code.code)} hitSlop={8}>
          <Text style={styles.link}>Copy</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ItemSheet(props: { itemId: string | null; onClose: () => void }) {
  const [item, setItem] = useState<VaultItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.itemId) {
      setItem(null);
      return;
    }
    let cancelled = false;
    vault
      .item(props.itemId)
      .then((loaded) => {
        if (!cancelled) setItem(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not open the item");
      });
    return () => {
      cancelled = true;
    };
  }, [props.itemId]);

  return (
    <Modal visible={Boolean(props.itemId)} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={styles.sheetRoot}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {item?.title ?? "Item"}
          </Text>
          <Pressable onPress={props.onClose} hitSlop={10}>
            <Text style={styles.link}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetContent}>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {item ? (
            <>
              <Text style={styles.detailLabel}>
                {item.kind === "login" ? "Password" : item.kind === "totp" ? "Authenticator" : "Item"}
              </Text>
              {typeof item.username === "string" && item.username ? (
                <DetailRow label="Username" value={item.username} />
              ) : null}
              {typeof item.password === "string" && item.password ? (
                <DetailRow label="Password" value={item.password} secret />
              ) : null}
              {typeof item.url === "string" && item.url ? (
                <DetailRow label="Website" value={item.url} />
              ) : null}
              {typeof item.number === "string" && item.number ? (
                <DetailRow label="Card number" value={item.number} secret />
              ) : null}
              {typeof item.secret === "string" && item.secret ? (
                <DetailRow label="Secret" value={item.secret} secret />
              ) : null}
              {item.totp || item.kind === "totp" ? <AuthenticatorBlock itemId={item.id} /> : null}
              {item.fields?.map((field) => (
                <DetailRow key={field.label} label={field.label} value={field.value} secret={field.concealed} />
              ))}
              {item.notes ? (
                <View style={styles.notesBox}>
                  <Text style={styles.detailLabel}>Notes</Text>
                  <Text style={styles.notes} selectable>
                    {item.notes}
                  </Text>
                </View>
              ) : null}
            </>
          ) : (
            <ActivityIndicator color={colors.accent} style={styles.loader} />
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function CreateLoginSheet(props: { visible: boolean; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setUsername("");
    setPassword("");
    setUrl("");
    setNotes("");
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await vault.createLogin({ title: title.trim(), username, password, url, notes });
      reset();
      props.onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the login");
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    try {
      setPassword(await vault.generatePassword(24));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate a password");
    }
  };

  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={styles.sheetRoot}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>New login</Text>
            <Pressable onPress={props.onClose} hitSlop={10}>
              <Text style={styles.link}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <Field label="Title" value={title} onChangeText={setTitle} placeholder="GitHub" />
            <Field label="Username" value={username} onChangeText={setUsername} />
            <Field label="Password" value={password} onChangeText={setPassword} secure />
            <Field label="Website" value={url} onChangeText={setUrl} keyboardType="url" />
            <Field label="Notes" value={notes} onChangeText={setNotes} />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <PrimaryButton label="Generate a strong password" tone="ghost" onPress={() => void generate()} />
            <PrimaryButton
              label="Save login"
              onPress={() => void save()}
              busy={busy}
              disabled={!title.trim() || !password}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

export default function App() {
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [booted, setBooted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const unlocked = Boolean(status?.unlocked);

  const loadItems = useCallback(async (needle: string) => {
    try {
      setItems(await vault.list(needle));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the vault");
    }
  }, []);

  useEffect(() => {
    if (!nativeAvailable) {
      setBooted(true);
      return;
    }
    vault
      .status()
      .then((next) => {
        setStatus(next);
        if (next.unlocked) void loadItems("");
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "The vault could not be opened"),
      )
      .finally(() => setBooted(true));
  }, [loadItems]);

  useEffect(() => {
    if (!unlocked) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void loadItems(query), 150);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, unlocked, loadItems]);

  const onUnlocked = (next: StatusResult) => {
    setStatus(next);
    setError(null);
    setNotice(null);
    void loadItems("");
  };

  const lock = async () => {
    try {
      await vault.lock();
    } catch {
      // Locking always succeeds locally; ignore a bridge error.
    }
    setItems([]);
    setSelectedId(null);
    setQuery("");
    const next = await vault.status().catch(() => null);
    if (next) setStatus(next);
  };

  const refresh = async () => {
    setRefreshing(true);
    await loadItems(query);
    setRefreshing(false);
  };

  const header = useMemo(() => {
    if (!status?.session) return "Acuye Pass";
    return `${status.session.vaultName} · ${status.session.username}`;
  }, [status]);

  if (!nativeAvailable) {
    return (
      <>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <SafeAreaView style={[styles.flex, styles.center, styles.padded]}>
          <Text style={styles.title}>Acuye Pass</Text>
          <Text style={styles.subtitle}>
            This build has no native vault library. Install an APK built by the Android CI workflow
            (.github/workflows/android.yml) to use the app.
          </Text>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <SafeAreaView style={styles.root}>
        {!booted ? (
          <View style={[styles.flex, styles.center]}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        ) : unlocked ? (
          <View style={styles.flex}>
            <View style={styles.header}>
              <View style={styles.flex}>
                <Text style={styles.headerTitle}>{header}</Text>
                <Text style={styles.headerMeta}>
                  {status?.session?.itemCount ?? items.length} items · decrypted locally
                </Text>
              </View>
              <Pressable onPress={() => void lock()} style={styles.lockButton} hitSlop={8}>
                <Text style={styles.lockButtonText}>Lock</Text>
              </Pressable>
            </View>

            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Search titles, usernames, sites"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            {notice ? (
              <View style={styles.noticeBox}>
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            ) : null}

            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>No items yet</Text>
                  <Text style={styles.emptyBody}>
                    Add a login and it is encrypted with this vault's key before it touches disk.
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => setSelectedId(item.id)}
                  style={({ pressed }) => [styles.itemRow, pressed && styles.itemRowPressed]}
                >
                  <View style={styles.itemBadge}>
                    <Text style={styles.itemBadgeText}>
                      {item.title.trim().slice(0, 1).toUpperCase() || "?"}
                    </Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.itemSubtitle} numberOfLines={1}>
                      {item.subtitle || item.typeLabel}
                    </Text>
                  </View>
                  {item.hasPassword ? <Text style={styles.itemMeta}>•••</Text> : null}
                </Pressable>
              )}
            />

            <Pressable
              onPress={() => setCreating(true)}
              style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
            >
              <Text style={styles.fabGlyph}>+</Text>
            </Pressable>

            <ItemSheet itemId={selectedId} onClose={() => setSelectedId(null)} />
            <CreateLoginSheet
              visible={creating}
              onClose={() => setCreating(false)}
              onCreated={() => {
                setCreating(false);
                setNotice("Login saved");
                setTimeout(() => setNotice(null), 2000);
                void loadItems(query);
                void vault.status().then(setStatus).catch(() => null);
              }}
            />
          </View>
        ) : (
          <UnlockScreen
            accounts={status?.accounts ?? []}
            status={status}
            onUnlocked={onUnlocked}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  padded: { paddingHorizontal: 28 },
  lockedContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 40,
    gap: 14,
  },
  logo: {
    alignSelf: "center",
    width: 68,
    height: 68,
    borderRadius: 20,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: "rgba(124,140,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  logoGlyph: { color: colors.accent, fontSize: 30, fontWeight: "700" },
  title: { color: colors.text, fontSize: 24, fontWeight: "700", textAlign: "center" },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginBottom: 6,
  },
  accountList: { gap: 8 },
  accountChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  accountChipActive: { borderColor: "rgba(124,140,255,0.6)", backgroundColor: colors.accentSoft },
  accountName: { color: colors.text, fontSize: 14, fontWeight: "600" },
  accountNameActive: { color: colors.accent },
  accountVault: { color: colors.muted, fontSize: 11.5, marginTop: 2 },
  field: { gap: 6 },
  fieldHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  fieldLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 14 : 11,
    color: colors.text,
    fontSize: 15,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonGhost: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: "rgba(248,113,113,0.16)" },
  buttonPrimaryText: { color: "#0b1220", fontSize: 15, fontWeight: "700" },
  buttonGhostText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.45 },
  link: { color: colors.accent, fontSize: 12.5, fontWeight: "600" },
  linkCenter: { color: colors.muted, fontSize: 12.5, textAlign: "center", marginTop: 6 },
  errorBox: {
    backgroundColor: "rgba(248,113,113,0.12)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  errorText: { color: colors.danger, fontSize: 12.5, lineHeight: 18 },
  noticeBox: {
    backgroundColor: "rgba(52,211,153,0.12)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginBottom: 6,
  },
  noticeText: { color: colors.success, fontSize: 12.5 },
  footer: { color: colors.muted, fontSize: 10.5, textAlign: "center", marginTop: 14, opacity: 0.8 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  headerMeta: { color: colors.muted, fontSize: 11.5, marginTop: 2 },
  lockButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  lockButtonText: { color: colors.text, fontSize: 12.5, fontWeight: "600" },
  search: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 120, gap: 8 },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  itemRowPressed: { backgroundColor: colors.surfaceAlt },
  itemBadge: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  itemBadgeText: { color: colors.accent, fontWeight: "700", fontSize: 15 },
  itemTitle: { color: colors.text, fontSize: 14.5, fontWeight: "600" },
  itemSubtitle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  itemMeta: { color: colors.muted, fontSize: 12, letterSpacing: 2 },
  emptyState: { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  emptyBody: { color: colors.muted, fontSize: 12.5, textAlign: "center", lineHeight: 18 },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 26,
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  fabPressed: { opacity: 0.9 },
  fabGlyph: { color: "#0b1220", fontSize: 28, fontWeight: "600", marginTop: -2 },
  sheetRoot: { flex: 1, backgroundColor: colors.background },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: "700", flex: 1 },
  sheetContent: { padding: 18, gap: 12 },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
  },
  detailLabel: {
    color: colors.muted,
    fontSize: 10.5,
    letterSpacing: 0.7,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  detailValue: { color: colors.text, fontSize: 14, marginTop: 4 },
  detailActions: { alignItems: "flex-end", gap: 8 },
  totpBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(124,140,255,0.4)",
    backgroundColor: colors.accentSoft,
    padding: 12,
  },
  totpCode: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: 2,
    marginTop: 4,
    fontVariant: ["tabular-nums"],
  },
  totpMeta: { alignItems: "flex-end", gap: 6 },
  totpRemaining: { color: colors.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
  notesBox: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  notes: { color: colors.text, fontSize: 13, lineHeight: 19 },
  loader: { marginTop: 24 },
});
