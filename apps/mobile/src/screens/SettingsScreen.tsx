/**
 * Settings: appearance, auto-lock, clipboard, account security, recovery,
 * devices, backups, export and import — the desktop settings surface adapted
 * to a phone.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useApp } from "../app-context";
import { Badge, Btn, Card, Chip, ErrorBox, Field, LinkRow, Loading, SectionTitle, Sheet, Toggle } from "../components/ui";
import {
  api,
  errorMessage,
  type AppSettings,
  type BackupInfo,
  type Device,
  type ExportInfo,
  type ImportFormat,
  type ParsedImport,
  type RecoveryStatus,
  type StorageInfo,
} from "../native";
import { formatDate, relativeTime, type ThemeColor } from "../theme";

const APPEARANCES: { key: AppSettings["appearance_mode"]; label: string }[] = [
  { key: "system", label: "System" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
];

const THEMES: { key: ThemeColor; color: string; label: string }[] = [
  { key: "blue", color: "#4f6dff", label: "Blue" },
  { key: "white", color: "#94a3b8", label: "White" },
  { key: "red", color: "#e5484d", label: "Red" },
  { key: "green", color: "#12a594", label: "Green" },
  { key: "yellow", color: "#e2a336", label: "Yellow" },
  { key: "monochrome", color: "#64748b", label: "Mono" },
];

const LOCK_CHOICES = [
  { seconds: 0, label: "Never" },
  { seconds: 60, label: "1 min" },
  { seconds: 300, label: "5 min" },
  { seconds: 900, label: "15 min" },
  { seconds: 1800, label: "30 min" },
  { seconds: 3600, label: "1 hour" },
];

const CLIPBOARD_CHOICES = [
  { seconds: 0, label: "Never" },
  { seconds: 10, label: "10 s" },
  { seconds: 30, label: "30 s" },
  { seconds: 60, label: "1 min" },
];

export function SettingsScreen(props: { onLock: () => void; onChanged: () => void }) {
  const { theme, settings, status, saveSettings } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<
    "password" | "rename" | "recovery" | "devices" | "backups" | "export" | "import" | null
  >(null);

  const patch = async (changes: Partial<AppSettings>) => {
    setError(null);
    try {
      await saveSettings({ ...settings, ...changes });
    } catch (cause) {
      setError(errorMessage(cause, "Could not save that setting"));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Settings</Text>
        <Text style={[styles.meta, { color: theme.muted }]}>
          Everything here is stored in your encrypted database, not in the cloud.
        </Text>
      </View>

      <Card>
        <View style={styles.accountRow}>
          <View style={[styles.avatar, { backgroundColor: theme.accentSoft }]}>
            <Text style={[styles.avatarText, { color: theme.accent }]}>
              {(status?.session?.username ?? "A").slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[styles.accountName, { color: theme.text }]}>{status?.session?.username ?? "Locked"}</Text>
            <Text style={[styles.meta, { color: theme.muted }]}>
              {status?.session?.vaultName ?? ""} · {status?.session?.itemCount ?? 0} items
            </Text>
          </View>
          <Btn label="Lock" tone="ghost" compact onPress={props.onLock} />
        </View>
        <View style={styles.accountActions}>
          <Btn label="Change password" tone="soft" compact onPress={() => setSheet("password")} />
          <Btn label="Rename vault" tone="ghost" compact onPress={() => setSheet("rename")} />
        </View>
      </Card>

      {error ? <ErrorBox message={error} /> : null}

      <SectionTitle title="Appearance" caption="Accent colour and light/dark mode, the same palette as the desktop app." />
      <Card>
        <View style={styles.chips}>
          {APPEARANCES.map((entry) => (
            <Chip
              key={entry.key}
              label={entry.label}
              active={settings.appearance_mode === entry.key}
              onPress={() => void patch({ appearance_mode: entry.key })}
            />
          ))}
        </View>
        <View style={styles.swatches}>
          {THEMES.map((entry) => (
            <Pressable
              key={entry.key}
              onPress={() => void patch({ theme_color: entry.key })}
              accessibilityLabel={entry.label}
              style={[
                styles.swatch,
                {
                  backgroundColor: entry.color,
                  borderColor: settings.theme_color === entry.key ? theme.text : "transparent",
                },
              ]}
            />
          ))}
        </View>
        <Toggle
          label="Compact density"
          description="Tighter spacing for long lists."
          value={settings.density_compact}
          onChange={(value) => void patch({ density_compact: value })}
        />
        <Toggle
          label="Reduce motion"
          description="Skip the fade when switching tabs."
          value={settings.reduce_motion}
          onChange={(value) => void patch({ reduce_motion: value })}
        />
      </Card>

      <SectionTitle title="Security" caption="Auto-lock is enforced in the Rust core, not only by the screen." />
      <Card>
        <Text style={[styles.caption, { color: theme.muted }]}>AUTO-LOCK</Text>
        <View style={styles.chips}>
          {LOCK_CHOICES.map((choice) => (
            <Chip
              key={choice.seconds}
              label={choice.label}
              active={settings.auto_lock_secs === choice.seconds}
              onPress={() => void patch({ auto_lock_secs: choice.seconds })}
            />
          ))}
        </View>
        <Text style={[styles.caption, { color: theme.muted }]}>CLEAR CLIPBOARD AFTER</Text>
        <View style={styles.chips}>
          {CLIPBOARD_CHOICES.map((choice) => (
            <Chip
              key={choice.seconds}
              label={choice.label}
              active={settings.clipboard_clear_secs === choice.seconds}
              onPress={() => void patch({ clipboard_clear_secs: choice.seconds })}
            />
          ))}
        </View>
        <Toggle
          label="Confirm before deleting"
          description="Ask before an item leaves the vault."
          value={settings.confirm_delete}
          onChange={(value) => void patch({ confirm_delete: value })}
        />
      </Card>

      <SectionTitle title="Account" />
      <View style={{ gap: 8 }}>
        <LinkRow
          title="Recovery"
          subtitle="One-time code and security questions"
          glyph="↺"
          onPress={() => setSheet("recovery")}
        />
        <LinkRow title="Devices" subtitle="Phones and computers registered to this vault" glyph="▤" onPress={() => setSheet("devices")} />
        <LinkRow title="Backups" subtitle="Create or restore a copy of the vault" glyph="⌸" onPress={() => setSheet("backups")} />
        <LinkRow title="Export" subtitle="Encrypted JSON or plaintext CSV" glyph="↥" onPress={() => setSheet("export")} />
        <LinkRow title="Import" subtitle="Bitwarden, Chrome, 1Password, Acuye" glyph="↧" onPress={() => setSheet("import")} />
      </View>

      <SectionTitle title="About" />
      <Card>
        <Detail label="App version" value="0.1.6" />
        <Detail label="Rust core" value={status?.version ?? "—"} />
        <Detail label="Database" value={formatBytes(status?.databaseSize ?? 0)} />
        <Detail label="Repository" value={status?.repository ?? "—"} />
        <Detail label="License" value="MIT © 2026 Fluxenite" />
        <Text style={[styles.meta, { color: theme.muted }]}>
          No telemetry, no analytics and no accounts on a server. Mobile builds do not include the desktop updater or
          LAN pairing; everything else is shared with the desktop app through the same Rust crates.
        </Text>
        <Btn
          label={busy ? "Please wait" : "Lock now"}
          tone="danger"
          onPress={() => {
            setBusy(true);
            props.onLock();
            setBusy(false);
          }}
        />
      </Card>

      <ChangePasswordSheet visible={sheet === "password"} onClose={() => setSheet(null)} />
      <RenameSheet visible={sheet === "rename"} onClose={() => setSheet(null)} onRenamed={props.onChanged} />
      <RecoverySettingsSheet visible={sheet === "recovery"} onClose={() => setSheet(null)} />
      <DevicesSheet visible={sheet === "devices"} onClose={() => setSheet(null)} />
      <BackupsSheet visible={sheet === "backups"} onClose={() => setSheet(null)} onRestored={props.onChanged} />
      <ExportSheet visible={sheet === "export"} onClose={() => setSheet(null)} />
      <ImportSheet visible={sheet === "import"} onClose={() => setSheet(null)} onImported={props.onChanged} />
    </ScrollView>
  );
}

function Detail(props: { label: string; value: string }) {
  const { theme } = useApp();
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.meta, { color: theme.muted }]}>{props.label}</Text>
      <Text style={[styles.detailValue, { color: theme.text }]} numberOfLines={1}>
        {props.value}
      </Text>
    </View>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ChangePasswordSheet(props: { visible: boolean; onClose: () => void }) {
  const { theme, notify, applyStatus, status } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.changePassword(current, next);
      applyStatus(result);
      notify("Master password changed");
      setCurrent("");
      setNext("");
      setConfirm("");
      props.onClose();
    } catch (cause) {
      setError(errorMessage(cause, "Could not change the password"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={props.visible}
      title="Change master password"
      subtitle="Rotates the vault key and re-encrypts every item."
      onClose={props.onClose}
    >
      <Field label="Current password" value={current} onChangeText={setCurrent} secure />
      <Field label="New password" value={next} onChangeText={setNext} secure hint="At least 10 characters with mixed types." />
      <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secure />
      {status?.session ? (
        <Text style={[styles.meta, { color: theme.muted }]}>Signed in as {status.session.username}</Text>
      ) : null}
      {error ? <ErrorBox message={error} /> : null}
      <Btn
        label="Change password"
        onPress={() => void submit()}
        busy={busy}
        disabled={!current || next.length < 10 || next !== confirm}
      />
    </Sheet>
  );
}

function RenameSheet(props: { visible: boolean; onClose: () => void; onRenamed: () => void }) {
  const { status, applyStatus, notify } = useApp();
  const [name, setName] = useState(status?.session?.vaultName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (props.visible) setName(status?.session?.vaultName ?? "");
  }, [props.visible, status?.session?.vaultName]);

  return (
    <Sheet visible={props.visible} title="Rename vault" onClose={props.onClose}>
      <Field label="Vault name" value={name} onChangeText={setName} />
      {error ? <ErrorBox message={error} /> : null}
      <Btn
        label="Save"
        busy={busy}
        disabled={!name.trim()}
        onPress={async () => {
          setBusy(true);
          try {
            await api.renameVault(name.trim());
            applyStatus(await api.status());
            props.onRenamed();
            notify("Vault renamed");
            props.onClose();
          } catch (cause) {
            setError(errorMessage(cause, "Could not rename the vault"));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Sheet>
  );
}

function RecoverySettingsSheet(props: { visible: boolean; onClose: () => void }) {
  const { theme, status, notify } = useApp();
  const vaultId = status?.session?.vaultId ?? "";
  const [state, setState] = useState<RecoveryStatus | null>(null);
  const [password, setPassword] = useState("");
  const [questions, setQuestions] = useState([
    { question: "", answer: "" },
    { question: "", answer: "" },
    { question: "", answer: "" },
  ]);
  const [enrolling, setEnrolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    if (!props.visible || !vaultId) return;
    api.recovery
      .status(vaultId)
      .then(setState)
      .catch((cause: unknown) => setError(errorMessage(cause, "Could not read the recovery state")));
  }, [props.visible, vaultId]);

  return (
    <Sheet
      visible={props.visible}
      title="Recovery"
      subtitle="Get back in with a one-time code, or three security answers."
      onClose={props.onClose}
    >
      {code ? (
        <View style={{ gap: 12 }}>
          <View style={[styles.codeBox, { borderColor: theme.accent, backgroundColor: theme.accentSoft }]}>
            <Text style={[styles.caption, { color: theme.muted }]}>YOUR RECOVERY CODE</Text>
            <Text style={[styles.code, { color: theme.text }]} selectable>
              {code}
            </Text>
          </View>
          <Text style={[styles.body, { color: theme.muted }]}>
            Write this down. It is shown once and replaces any previous code.
          </Text>
          <Btn label="Done" onPress={() => { setCode(null); props.onClose(); }} />
        </View>
      ) : (
        <>
          {state ? (
            <View style={styles.chips}>
              <Badge label={state.code ? "Code enrolled" : "No code"} tone={state.code ? "success" : "muted"} />
              <Badge
                label={state.questions ? "Questions enrolled" : "No questions"}
                tone={state.questions ? "success" : "muted"}
              />
            </View>
          ) : null}

          {!enrolling ? (
            <>
              <Btn label={state?.code ? "New recovery code" : "Enrol a recovery code"} onPress={() => setEnrolling(true)} />
              <Field
                label="Master password"
                value={password}
                onChangeText={setPassword}
                secure
                hint="Recovery setup always requires the master password."
              />
              <Btn
                label="Enrol with security questions"
                tone="ghost"
                disabled={!password}
                busy={busy}
                onPress={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const setup = await api.recovery.enable(vaultId, password, questions);
                    setCode(setup.recoveryCode);
                    setState({ code: true, questions: setup.questions > 0 });
                    setPassword("");
                  } catch (cause) {
                    setError(errorMessage(cause, "Could not enrol recovery"));
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              {state?.code || state?.questions ? (
                <Btn
                  label="Disable recovery"
                  tone="danger"
                  busy={busy}
                  disabled={!password}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await api.recovery.disable(vaultId, password);
                      setState({ code: false, questions: false });
                      setPassword("");
                      notify("Recovery disabled");
                    } catch (cause) {
                      setError(errorMessage(cause, "Could not disable recovery"));
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              ) : null}
            </>
          ) : (
            <>
              {questions.map((entry, index) => (
                <View key={index} style={{ gap: 8 }}>
                  <Field
                    label={`Question ${index + 1}`}
                    value={entry.question}
                    onChangeText={(value) =>
                      setQuestions((current) => current.map((item, position) => (position === index ? { ...item, question: value } : item)))
                    }
                    placeholder="A question only you can answer"
                  />
                  <Field
                    label={`Answer ${index + 1}`}
                    value={entry.answer}
                    onChangeText={(value) =>
                      setQuestions((current) => current.map((item, position) => (position === index ? { ...item, answer: value } : item)))
                    }
                    secure
                  />
                </View>
              ))}
              <Field label="Master password" value={password} onChangeText={setPassword} secure />
              {error ? <ErrorBox message={error} /> : null}
              <Btn
                label="Enrol recovery"
                busy={busy}
                disabled={!password || questions.some((entry) => entry.question.trim().length < 1 || entry.answer.trim().length < 2)}
                onPress={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const setup = await api.recovery.enable(vaultId, password, questions);
                    setCode(setup.recoveryCode);
                    setState({ code: true, questions: true });
                    setPassword("");
                    setEnrolling(false);
                  } catch (cause) {
                    setError(errorMessage(cause, "Could not enrol recovery"));
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              <Btn label="Cancel" tone="ghost" onPress={() => setEnrolling(false)} />
            </>
          )}
          {error && !enrolling ? <ErrorBox message={error} /> : null}
        </>
      )}
    </Sheet>
  );
}

function DevicesSheet(props: { visible: boolean; onClose: () => void }) {
  const { theme, notify } = useApp();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDevices(await api.devices.list());
    } catch {
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (props.visible) void load();
  }, [load, props.visible]);

  return (
    <Sheet visible={props.visible} title="Devices" subtitle="This vault's registered devices." onClose={props.onClose}>
      {loading ? <Loading /> : null}
      {devices.map((device) => (
        <View key={device.id} style={[styles.device, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[styles.deviceName, { color: theme.text }]}>
              {device.name} {device.current ? "· this device" : ""}
            </Text>
            <Text style={[styles.meta, { color: theme.muted }]}>
              {device.platform} · added {formatDate(device.createdAt)} · seen {relativeTime(device.lastSeenAt)}
            </Text>
          </View>
          {device.revoked ? (
            <Badge label="Revoked" tone="danger" />
          ) : device.current ? (
            <Badge label="Current" tone="success" />
          ) : (
            <Btn
              label="Revoke"
              tone="danger"
              compact
              onPress={async () => {
                try {
                  await api.devices.revoke(device.id);
                  notify("Device revoked");
                  await load();
                } catch (cause) {
                  notify(errorMessage(cause, "Could not revoke the device"));
                }
              }}
            />
          )}
        </View>
      ))}
    </Sheet>
  );
}

function BackupsSheet(props: { visible: boolean; onClose: () => void; onRestored: () => void }) {
  const { theme, notify } = useApp();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [storage, list] = await Promise.all([api.storageInfo(), api.backups.list()]);
      setInfo(storage);
      setBackups(list);
    } catch {
      // Leave the previous list in place.
    }
  }, []);

  useEffect(() => {
    if (props.visible) void load();
  }, [load, props.visible]);

  return (
    <Sheet
      visible={props.visible}
      title="Backups"
      subtitle="A byte-for-byte copy of the encrypted database, kept on this phone."
      onClose={props.onClose}
    >
      {info ? (
        <View style={{ gap: 6 }}>
          <Detail label="Database" value={formatBytes(info.databaseSize)} />
          <Detail label="Items" value={String(info.itemCount)} />
          <Detail label="Integrity" value={info.integrityOk ? "OK" : "Check failed"} />
          <Detail label="Schema" value={`v${info.schemaVersion}`} />
        </View>
      ) : null}
      <Btn
        label="Create a backup now"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          try {
            const backup = await api.backups.create();
            notify(`Backup ${backup.name} created`);
            await load();
          } catch (cause) {
            notify(errorMessage(cause, "Could not create the backup"));
          } finally {
            setBusy(false);
          }
        }}
      />
      {backups.map((backup) => (
        <View key={backup.name} style={[styles.device, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[styles.deviceName, { color: theme.text }]} numberOfLines={1}>
              {backup.name}
            </Text>
            <Text style={[styles.meta, { color: theme.muted }]}>
              {formatBytes(backup.size)} · {formatDate(backup.createdAt)}
            </Text>
          </View>
          <Btn
            label="Restore"
            tone="ghost"
            compact
            onPress={() => {
              Alert.alert(
                "Restore this backup?",
                "The vault will be replaced by the backup and locked. You will need the master password that belongs to it.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Restore",
                    style: "destructive",
                    onPress: async () => {
                      try {
                        await api.backups.restore(backup.name);
                        notify("Backup restored — unlock again");
                        props.onRestored();
                        props.onClose();
                      } catch (cause) {
                        notify(errorMessage(cause, "Could not restore the backup"));
                      }
                    },
                  },
                ],
              );
            }}
          />
        </View>
      ))}
      {backups.length === 0 ? <Text style={[styles.meta, { color: theme.muted }]}>No backups yet.</Text> : null}
      {info ? <Detail label="Backup folder" value={info.backupDir} /> : null}
    </Sheet>
  );
}

function ExportSheet(props: { visible: boolean; onClose: () => void }) {
  const { notify } = useApp();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (encrypted: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const exportInfo = encrypted ? await api.exportEncrypted(password) : await api.exportCsv(true);
      setResult(exportInfo);
      notify(encrypted ? "Encrypted export written" : "CSV export written");
    } catch (cause) {
      setError(errorMessage(cause, "Could not export the vault"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={props.visible}
      title="Export"
      subtitle="Files are written to this app's private storage."
      onClose={props.onClose}
    >
      <Field
        label="Encryption password"
        value={password}
        onChangeText={setPassword}
        secure
        hint="Used only for this export; it can differ from your master password."
      />
      {error ? <ErrorBox message={error} /> : null}
      <Btn label="Export encrypted JSON" onPress={() => void run(true)} busy={busy} disabled={password.length < 10} />
      <Btn
        label="Export plaintext CSV"
        tone="danger"
        onPress={() => {
          Alert.alert(
            "Export unencrypted?",
            "The CSV contains every password in clear text. Anyone who can read the file can read your vault.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Export anyway", style: "destructive", onPress: () => void run(false) },
            ],
          );
        }}
        disabled={busy}
      />
      {result ? (
        <View style={{ gap: 6 }}>
          <Detail label="File" value={result.path} />
          <Detail label="Items" value={String(result.itemCount)} />
          <Detail label="Size" value={formatBytes(result.bytes)} />
          <Detail label="Encrypted" value={result.encrypted ? "yes" : "no"} />
        </View>
      ) : null}
    </Sheet>
  );
}

function ImportSheet(props: { visible: boolean; onClose: () => void; onImported: () => void }) {
  const { theme, notify } = useApp();
  const [payload, setPayload] = useState("");
  const [format, setFormat] = useState<ImportFormat | null>(null);
  const [preview, setPreview] = useState<ParsedImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formats: { key: ImportFormat; label: string }[] = [
    { key: "acuye_json", label: "Acuye JSON" },
    { key: "bitwarden_json", label: "Bitwarden JSON" },
    { key: "bitwarden_csv", label: "Bitwarden CSV" },
    { key: "chrome_csv", label: "Chrome" },
    { key: "one_password_csv", label: "1Password" },
    { key: "generic_csv", label: "Generic CSV" },
  ];

  return (
    <Sheet
      visible={props.visible}
      title="Import"
      subtitle="Paste an export; the format is detected when you leave it on Auto."
      onClose={props.onClose}
    >
      <View style={styles.chips}>
        <Chip label="Auto" active={format === null} onPress={() => setFormat(null)} />
        {formats.map((entry) => (
          <Chip key={entry.key} label={entry.label} active={format === entry.key} onPress={() => setFormat(entry.key)} />
        ))}
      </View>
      <Field
        label="Paste export"
        value={payload}
        onChangeText={setPayload}
        multiline
        placeholder="{ … } or name,url,username,password"
      />
      {error ? <ErrorBox message={error} /> : null}
      <Btn
        label="Preview"
        busy={busy}
        disabled={payload.trim().length === 0}
        onPress={async () => {
          setBusy(true);
          setError(null);
          setPreview(null);
          try {
            setPreview(await api.importPreview(payload, format));
          } catch (cause) {
            setError(errorMessage(cause, "Could not read that export"));
          } finally {
            setBusy(false);
          }
        }}
      />
      {preview ? (
        <View style={[styles.preview, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.deviceName, { color: theme.text }]}>
            {preview.items.length} item{preview.items.length === 1 ? "" : "s"} ready · {preview.format.replace(/_/g, " ")}
          </Text>
          {preview.skipped ? <Text style={[styles.meta, { color: theme.muted }]}>{preview.skipped} rows skipped</Text> : null}
          {preview.warnings.slice(0, 3).map((warning) => (
            <Text key={warning} style={[styles.meta, { color: theme.warning }]}>
              {warning}
            </Text>
          ))}
          <Btn
            label={`Import ${preview.items.length} items`}
            disabled={preview.items.length === 0}
            onPress={async () => {
              setBusy(true);
              try {
                const result = await api.importApply(preview.items, preview.format);
                notify(`Imported ${result.imported} items`);
                setPayload("");
                setPreview(null);
                props.onImported();
                props.onClose();
              } catch (cause) {
                setError(errorMessage(cause, "Could not import"));
              } finally {
                setBusy(false);
              }
            }}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 34 },
  header: { gap: 3 },
  title: { fontSize: 20, fontWeight: "800" },
  meta: { fontSize: 11.5, lineHeight: 16 },
  body: { fontSize: 12.5, lineHeight: 18 },
  caption: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.8 },
  accountRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  accountActions: { flexDirection: "row", gap: 8 },
  avatar: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontWeight: "800" },
  accountName: { fontSize: 15, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatches: { flexDirection: "row", gap: 10, paddingVertical: 2 },
  swatch: { width: 34, height: 34, borderRadius: 12, borderWidth: 2 },
  detailRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  detailValue: { fontSize: 12, flexShrink: 1, textAlign: "right" },
  codeBox: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  code: { fontSize: 18, fontWeight: "700", letterSpacing: 1.4 },
  device: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 13, padding: 12 },
  deviceName: { fontSize: 13.5, fontWeight: "700" },
  preview: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
});
