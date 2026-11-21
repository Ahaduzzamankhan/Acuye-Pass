/**
 * Locked state: create the first vault, unlock an existing one, add another
 * account, or get back in with a recovery code / security answers.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useApp } from "../app-context";
import { Badge, Btn, Chip, ErrorBox, Field, Loading, Sheet, StrengthBar } from "../components/ui";
import { api, errorMessage, type PasswordStrength, type StatusResult } from "../native";

export function UnlockScreen(props: { status: StatusResult; onUnlocked: (next: StatusResult) => void }) {
  const { theme, notify } = useApp();
  const accounts = props.status.accounts;
  const [mode, setMode] = useState<"unlock" | "create" | "recovery">(accounts.length === 0 ? "create" : "unlock");
  const [selected, setSelected] = useState<string | null>(accounts[0]?.vaultId ?? null);
  const [username, setUsername] = useState("");
  const [vaultName, setVaultName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strength, setStrength] = useState<PasswordStrength | null>(null);

  const creating = mode === "create";

  useEffect(() => {
    if (!creating || password.length === 0) {
      setStrength(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .evaluatePassword(password)
        .then((value) => {
          if (!cancelled) setStrength(value);
        })
        .catch(() => undefined);
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [creating, password]);

  const canSubmit = creating
    ? Boolean(username.trim() && vaultName.trim() && password.length >= 10 && password === confirm)
    : Boolean(password);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = creating
        ? accounts.length === 0
          ? await api.createAccount(username.trim(), password)
          : await api.addAccount(username.trim(), password, vaultName.trim() || undefined)
        : await api.unlock(selected, accounts.find((account) => account.vaultId === selected)?.username ?? username, password);
      setPassword("");
      setConfirm("");
      notify(creating ? "Vault created" : "Vault unlocked");
      props.onUnlocked(next);
    } catch (cause) {
      setError(errorMessage(cause, "Could not open the vault"));
    } finally {
      setBusy(false);
    }
  };

  const header = useMemo(
    () =>
      creating
        ? {
            title: accounts.length === 0 ? "Create your vault" : "Add another vault",
            body: "One master password, stored nowhere. It derives the only key that decrypts this vault.",
            action: accounts.length === 0 ? "Create vault" : "Create account",
          }
        : { title: "Unlock your vault", body: "Everything is decrypted on this device. Nothing leaves it.", action: "Unlock" },
    [accounts.length, creating],
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <View style={[styles.logo, { backgroundColor: theme.accentSoft, borderColor: theme.accent }]}>
            <Text style={[styles.logoGlyph, { color: theme.accent }]}>A</Text>
          </View>
          <Text style={[styles.brandName, { color: theme.text }]}>Acuye Pass</Text>
          <Text style={[styles.brandMeta, { color: theme.muted }]}>
            Core {props.status.version} · Argon2id · XChaCha20-Poly1305
          </Text>
        </View>

        <Text style={[styles.title, { color: theme.text }]}>{header.title}</Text>
        <Text style={[styles.subtitle, { color: theme.muted }]}>{header.body}</Text>

        {!creating && accounts.length > 1 ? (
          <View style={{ gap: 8 }}>
            <Text style={[styles.caption, { color: theme.muted }]}>CHOOSE A VAULT</Text>
            {accounts.map((account) => (
              <Pressable
                key={account.vaultId}
                onPress={() => setSelected(account.vaultId)}
                style={[
                  styles.account,
                  {
                    backgroundColor: selected === account.vaultId ? theme.accentSoft : theme.surface,
                    borderColor: selected === account.vaultId ? theme.accent : theme.border,
                  },
                ]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.accountName, { color: theme.text }]}>{account.username}</Text>
                  <Text style={[styles.accountMeta, { color: theme.muted }]}>{account.vaultName}</Text>
                </View>
                {selected === account.vaultId ? <Badge label="Selected" tone="accent" /> : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        {creating ? (
          <>
            <Field label="Account name" value={username} onChangeText={setUsername} placeholder="you@example.com" />
            <Field
              label="Vault name"
              value={vaultName}
              onChangeText={setVaultName}
              placeholder="Personal"
              hint="Shown in the app header; it can be renamed later."
            />
          </>
        ) : null}

        <Field
          label="Master password"
          value={password}
          onChangeText={setPassword}
          secure
          placeholder={creating ? "At least 10 characters" : "Your master password"}
          hint={creating ? undefined : "Auto-lock and recovery can be set up in Settings."}
        />
        {creating ? <StrengthBar score={strength?.score ?? 0} label={strength?.label ?? "Start typing"} bits={strength?.bits} /> : null}
        {creating ? <Field label="Confirm password" value={confirm} onChangeText={setConfirm} secure /> : null}
        {creating && strength?.feedback.length ? (
          <Text style={[styles.feedback, { color: theme.muted }]}>Tip: {strength.feedback[0]}</Text>
        ) : null}

        {error ? <ErrorBox message={error} /> : null}

        <Btn label={header.action} onPress={() => void submit()} busy={busy} disabled={!canSubmit} />

        <View style={styles.switchers}>
          {accounts.length > 0 ? (
            <Pressable onPress={() => setMode(creating ? "unlock" : "create")} hitSlop={8}>
              <Text style={[styles.link, { color: theme.accent }]}>
                {creating ? "Back to unlock" : "Add another account"}
              </Text>
            </Pressable>
          ) : null}
          {accounts.length > 0 && !creating ? (
            <Pressable onPress={() => setMode("recovery")} hitSlop={8}>
              <Text style={[styles.link, { color: theme.accent }]}>Forgot password?</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={[styles.footer, { color: theme.muted }]}>
          MIT © 2026 Fluxenite · your vault never leaves this phone
        </Text>
      </ScrollView>

      <RecoverySheet
        visible={mode === "recovery"}
        accounts={accounts}
        onClose={() => setMode("unlock")}
        onRecovered={(next) => {
          setMode("unlock");
          props.onUnlocked(next);
        }}
      />
    </KeyboardAvoidingView>
  );
}

function RecoverySheet(props: {
  visible: boolean;
  accounts: StatusResult["accounts"];
  onClose: () => void;
  onRecovered: (next: StatusResult) => void;
}) {
  const { theme, notify } = useApp();
  const [tab, setTab] = useState<"code" | "questions">("code");
  const [code, setCode] = useState("");
  const [vaultId, setVaultId] = useState(props.accounts[0]?.vaultId ?? "");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotated, setRotated] = useState<string | null>(null);

  useEffect(() => {
    if (!props.visible || tab !== "questions" || !vaultId) return;
    let cancelled = false;
    api.recovery
      .questions(vaultId)
      .then((list) => {
        if (cancelled) return;
        setQuestions(list);
        setAnswers(list.map(() => ""));
      })
      .catch((cause: unknown) => setError(errorMessage(cause, "Could not load the questions")));
    return () => {
      cancelled = true;
    };
  }, [props.visible, tab, vaultId]);

  const reset = () => {
    setCode("");
    setAnswers(questions.map(() => ""));
    setNewPassword("");
    setConfirm("");
    setError(null);
    setRotated(null);
  };

  const recover = async () => {
    setBusy(true);
    setError(null);
    try {
      const result =
        tab === "code"
          ? await api.recovery.recoverWithCode(code, newPassword)
          : await api.recovery.recoverWithAnswers(vaultId, answers, newPassword);
      setRotated(result.recoveryCode);
      notify("Vault recovered");
    } catch (cause) {
      setError(errorMessage(cause, "Recovery failed"));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    reset();
    const next = await api.status();
    props.onRecovered(next);
  };

  const ready = newPassword.length >= 10 && newPassword === confirm && (tab === "code" ? code.trim().length > 0 : answers.every((answer) => answer.trim().length >= 2));

  return (
    <Sheet visible={props.visible} title="Account recovery" onClose={props.onClose} subtitle="A one-time code, or the security answers you enrolled.">
      {rotated ? (
        <View style={{ gap: 14 }}>
          <View style={[styles.codeBox, { backgroundColor: theme.accentSoft, borderColor: theme.accent }]}>
            <Text style={[styles.caption, { color: theme.muted }]}>YOUR NEW RECOVERY CODE</Text>
            <Text style={[styles.code, { color: theme.text }]} selectable>
              {rotated}
            </Text>
          </View>
          <Text style={[styles.body, { color: theme.muted }]}>
            The old code no longer works and any security questions were cleared. Save this code somewhere offline.
          </Text>
          <Btn label="I saved it — continue" onPress={() => void finish()} />
        </View>
      ) : (
        <>
          <View style={styles.tabs}>
            <Chip label="Recovery code" active={tab === "code"} onPress={() => setTab("code")} />
            <Chip label="Security questions" active={tab === "questions"} onPress={() => setTab("questions")} />
          </View>

          {tab === "code" ? (
            <Field
              label="Recovery code"
              value={code}
              onChangeText={setCode}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              hint="Case and dashes do not matter."
            />
          ) : (
            <>
              {props.accounts.length > 1 ? (
                <View style={{ gap: 8 }}>
                  <Text style={[styles.caption, { color: theme.muted }]}>VAULT</Text>
                  <View style={styles.tabs}>
                    {props.accounts.map((account) => (
                      <Chip
                        key={account.vaultId}
                        label={account.username}
                        active={vaultId === account.vaultId}
                        onPress={() => setVaultId(account.vaultId)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
              {questions.length === 0 ? (
                <Loading label="Loading your questions" />
              ) : (
                questions.map((question, index) => (
                  <Field
                    key={question + index}
                    label={question}
                    value={answers[index] ?? ""}
                    onChangeText={(value) => setAnswers((current) => current.map((entry, position) => (position === index ? value : entry)))}
                  />
                ))
              )}
            </>
          )}

          <Field label="New master password" value={newPassword} onChangeText={setNewPassword} secure />
          <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secure />
          {error ? <ErrorBox message={error} /> : null}
          <Btn label="Recover vault" onPress={() => void recover()} busy={busy} disabled={!ready} />
          <Text style={[styles.body, { color: theme.muted }]}>
            Recovering rotates the vault key and hands you a fresh recovery code. Your items are kept.
          </Text>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 36, gap: 14 },
  brand: { alignItems: "center", gap: 6, marginBottom: 8 },
  logo: {
    width: 66,
    height: 66,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logoGlyph: { fontSize: 30, fontWeight: "800" },
  brandName: { fontSize: 18, fontWeight: "800", letterSpacing: 0.2 },
  brandMeta: { fontSize: 10.5 },
  title: { fontSize: 23, fontWeight: "800", textAlign: "center" },
  subtitle: { fontSize: 12.5, lineHeight: 18, textAlign: "center", marginBottom: 4 },
  caption: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.8 },
  account: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 12 },
  accountName: { fontSize: 14, fontWeight: "700" },
  accountMeta: { fontSize: 11.5 },
  feedback: { fontSize: 11.5, lineHeight: 16 },
  switchers: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  link: { fontSize: 12.5, fontWeight: "700" },
  footer: { fontSize: 10.5, textAlign: "center", marginTop: 18 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  body: { fontSize: 12, lineHeight: 18 },
  codeBox: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  code: { fontSize: 18, fontWeight: "700", letterSpacing: 1.5 },
});
