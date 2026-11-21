/**
 * One vault item: typed fields, live authenticator codes, secret access
 * history and the edit/duplicate/delete actions.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { useApp } from "../app-context";
import { Badge, Btn, ErrorBox, Loading, Sheet } from "../components/ui";
import { api, errorMessage, type SecretAccessEntry, type TotpCode, type VaultItem } from "../native";
import { formatDate, relativeTime, typeGlyph, typeLabel } from "../theme";

export function ItemDetailScreen(props: {
  itemId: string | null;
  onClose: () => void;
  onEdit: (item: VaultItem) => void;
  onChanged: () => void;
}) {
  const { theme, notify, settings, bumpVault } = useApp();
  const [item, setItem] = useState<VaultItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accessLog, setAccessLog] = useState(false);

  useEffect(() => {
    if (!props.itemId) {
      setItem(null);
      return;
    }
    let cancelled = false;
    setItem(null);
    setError(null);
    api
      .getItem(props.itemId)
      .then((loaded) => {
        if (!cancelled) setItem(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause, "Could not open the item"));
      });
    return () => {
      cancelled = true;
    };
  }, [props.itemId]);

  const refresh = useCallback(async (id: string) => {
    try {
      setItem(await api.getItem(id));
    } catch {
      // Keep the current view; the next action will surface the error.
    }
  }, []);

  const toggleFavorite = async () => {
    if (!item) return;
    try {
      const updated = await api.toggleFavorite(item.id);
      setItem(updated);
      bumpVault();
    } catch (cause) {
      notify(errorMessage(cause, "Could not update the favourite"));
    }
  };

  const duplicate = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await api.duplicateItem(item.id);
      bumpVault();
      notify("Item duplicated");
      props.onClose();
    } catch (cause) {
      notify(errorMessage(cause, "Could not duplicate the item"));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!item) return;
    const destroy = async () => {
      setBusy(true);
      try {
        await api.deleteItem(item.id);
        bumpVault();
        notify("Item deleted");
        props.onClose();
      } catch (cause) {
        notify(errorMessage(cause, "Could not delete the item"));
      } finally {
        setBusy(false);
      }
    };
    if (!settings.confirm_delete) {
      void destroy();
      return;
    }
    Alert.alert("Delete this item?", `“${item.title}” will be removed from the vault.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void destroy() },
    ]);
  };

  const openWebsite = async (url: string) => {
    try {
      await api.openUrl(url);
    } catch (cause) {
      notify(errorMessage(cause, "Could not open the link"));
    }
  };

  const fields = (item?.fields ?? { kind: "secure_note" }) as unknown as Record<string, unknown>;
  const kind = item?.fields.kind ?? "secure_note";

  return (
    <Sheet
      visible={Boolean(props.itemId)}
      title={item?.title ?? "Item"}
      subtitle={item ? `${typeLabel(kind)} · edited ${relativeTime(item.updated_at)}` : undefined}
      onClose={props.onClose}
      footer={
        item ? (
          <View style={styles.footerRow}>
            <Btn label="Edit" onPress={() => props.onEdit(item)} style={{ flex: 1 }} />
            <Btn label="Duplicate" tone="ghost" onPress={() => void duplicate()} busy={busy} style={{ flex: 1 }} />
            <Btn label="Delete" tone="danger" onPress={remove} disabled={busy} style={{ flex: 1 }} />
          </View>
        ) : undefined
      }
    >
      {error ? <ErrorBox message={error} /> : null}
      {!item && !error ? <Loading label="Decrypting item" /> : null}
      {item ? (
        <>
          <View style={styles.hero}>
            <View style={[styles.heroBadge, { backgroundColor: theme.accentSoft }]}>
              <Text style={[styles.heroGlyph, { color: theme.accent }]}>{typeGlyph(kind)}</Text>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.heroTitle, { color: theme.text }]}>{item.title}</Text>
              <Text style={[styles.heroMeta, { color: theme.muted }]}>
                {typeLabel(kind)} · created {formatDate(item.created_at)}
              </Text>
            </View>
            <Pressable onPress={() => void toggleFavorite()} hitSlop={10} accessibilityLabel="Toggle favourite">
              <Text style={[styles.star, { color: item.favorite ? theme.warning : theme.muted }]}>
                {item.favorite ? "★" : "☆"}
              </Text>
            </Pressable>
          </View>

          {item.tags.length ? (
            <View style={styles.tags}>
              {item.tags.map((tag) => (
                <Badge key={tag} label={tag} tone="accent" />
              ))}
            </View>
          ) : null}

          {kind === "login" ? (
            <>
              <DetailRow label="Username" value={String(fields.username ?? "")} />
              <DetailRow label="Password" value={String(fields.password ?? "")} secret />
              {fields.url ? (
                <DetailRow
                  label="Website"
                  value={String(fields.url)}
                  action={{ label: "Open", onPress: () => void openWebsite(String(fields.url)) }}
                />
              ) : null}
              {fields.totp ? <TotpBlock itemId={item.id} /> : null}
              {fields.password_changed_at ? (
                <Text style={[styles.meta, { color: theme.muted }]}>
                  Password last changed {relativeTime(Number(fields.password_changed_at))}
                </Text>
              ) : null}
            </>
          ) : null}

          {kind === "card" ? (
            <>
              <DetailRow label="Cardholder" value={String(fields.cardholder ?? "")} />
              <DetailRow label="Number" value={String(fields.number ?? "")} secret mono />
              <View style={styles.pairRow}>
                <DetailRow label="Expires" value={`${fields.expiry_month ?? ""}/${fields.expiry_year ?? ""}`} compact />
                <DetailRow label="CVV" value={String(fields.cvv ?? "")} secret compact />
              </View>
              <View style={styles.pairRow}>
                <DetailRow label="Brand" value={String(fields.brand ?? "")} compact />
                <DetailRow label="PIN" value={String(fields.pin ?? "")} secret compact />
              </View>
            </>
          ) : null}

          {kind === "identity" ? (
            <>
              <DetailRow label="Name" value={`${fields.first_name ?? ""} ${fields.last_name ?? ""}`.trim()} />
              <DetailRow label="Email" value={String(fields.email ?? "")} />
              <DetailRow label="Phone" value={String(fields.phone ?? "")} />
              <DetailRow
                label="Address"
                value={[fields.address, fields.city, fields.state, fields.postal_code, fields.country]
                  .filter(Boolean)
                  .join(", ")}
                multiline
              />
              <DetailRow label="Company" value={String(fields.company ?? "")} />
            </>
          ) : null}

          {kind === "document" ? (
            <>
              <DetailRow label="Filename" value={String(fields.filename ?? "")} />
              <DetailRow label="Type" value={String(fields.mime_type ?? "")} />
              <DetailRow label="Size" value={formatBytes(Number(fields.size_bytes ?? 0))} />
              <DetailRow label="SHA-256" value={String(fields.sha256 ?? "")} multiline mono />
            </>
          ) : null}

          {kind === "custom" ? (
            <CustomFieldsList fields={(fields.fields as { label: string; value: string; concealed: boolean }[]) ?? []} />
          ) : null}

          {kind === "totp" ? (
            <>
              <TotpBlock itemId={item.id} />
              <DetailRow label="Issuer" value={String(fields.issuer ?? "")} />
              <DetailRow label="Account" value={String(fields.account ?? "")} />
              <DetailRow label="Secret" value={String(fields.secret ?? "")} secret mono />
              <Text style={[styles.meta, { color: theme.muted }]}>
                {String(fields.algorithm ?? "SHA1").toUpperCase()} · {String(fields.digits ?? 6)} digits ·{" "}
                {String(fields.period ?? 30)}s · {String(fields.otp_type ?? "totp").toUpperCase()}
                {fields.otp_type === "hotp" ? ` · counter ${fields.counter ?? 0}` : ""}
              </Text>
            </>
          ) : null}

          {kind === "secret" ? (
            <>
              <View style={styles.tags}>
                <Badge label={String(fields.environment ?? "development")} tone="accent" />
                {fields.category ? <Badge label={String(fields.category)} /> : null}
                {fields.expires_at ? <Badge label={`expires ${formatDate(Number(fields.expires_at))}`} tone="warning" /> : null}
                {fields.rotate_every_days ? (
                  <Badge label={`rotate every ${fields.rotate_every_days}d`} tone="muted" />
                ) : null}
              </View>
              <SecretFieldsList itemId={item.id} fields={item} onAccess={() => setAccessLog(true)} />
            </>
          ) : null}

          {item.notes ? (
            <View style={[styles.notes, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.label, { color: theme.muted }]}>NOTES</Text>
              <Text style={[styles.notesText, { color: theme.text }]} selectable>
                {item.notes}
              </Text>
            </View>
          ) : null}

          <Text style={[styles.meta, { color: theme.muted }]}>
            Decrypted on this phone · nothing is uploaded
          </Text>

          <SecretAccessSheet
            visible={accessLog}
            itemId={item.id}
            onClose={() => setAccessLog(false)}
            onChanged={() => void refresh(item.id)}
          />
        </>
      ) : null}
    </Sheet>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DetailRow(props: {
  label: string;
  value: string;
  secret?: boolean;
  multiline?: boolean;
  mono?: boolean;
  compact?: boolean;
  action?: { label: string; onPress: () => void };
}) {
  const { theme, copy } = useApp();
  const [revealed, setRevealed] = useState(!props.secret);
  if (!props.value) return null;
  return (
    <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border, flex: props.compact ? 1 : undefined }]}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.label, { color: theme.muted }]}>{props.label}</Text>
        <Text
          style={[
            styles.value,
            { color: theme.text },
            props.mono && { fontVariant: ["tabular-nums"] },
          ]}
          numberOfLines={revealed && !props.multiline ? 4 : 1}
          selectable={revealed}
        >
          {revealed ? props.value : "•".repeat(Math.min(14, Math.max(8, props.value.length)))}
        </Text>
      </View>
      <View style={styles.rowActions}>
        {props.secret ? (
          <Pressable onPress={() => setRevealed((current) => !current)} hitSlop={8}>
            <Text style={[styles.link, { color: theme.accent }]}>{revealed ? "Hide" : "Show"}</Text>
          </Pressable>
        ) : null}
        {props.action ? (
          <Pressable onPress={props.action.onPress} hitSlop={8}>
            <Text style={[styles.link, { color: theme.accent }]}>{props.action.label}</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => copy(props.value, `${props.label} copied`)} hitSlop={8}>
            <Text style={[styles.link, { color: theme.accent }]}>Copy</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function CustomFieldsList(props: { fields: { label: string; value: string; concealed: boolean }[] }) {
  if (!props.fields.length) return null;
  return (
    <>
      {props.fields.map((field, index) => (
        <DetailRow
          key={`${field.label}-${index}`}
          label={field.label || `Field ${index + 1}`}
          value={field.value}
          secret={field.concealed}
        />
      ))}
    </>
  );
}

function SecretFieldsList(props: { itemId: string; fields: VaultItem; onAccess: () => void }) {
  const { theme, copy, notify } = useApp();
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  return (
    <>
      {props.fields.fields.kind === "secret"
        ? props.fields.fields.fields.map((field, index) => {
            const value = revealed[index];
            return (
              <View key={`${field.label}-${index}`} style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.label, { color: theme.muted }]}>{field.label || `Field ${index + 1}`}</Text>
                  <Text style={[styles.value, { color: theme.text }]} numberOfLines={value ? 4 : 1} selectable={Boolean(value)}>
                    {value ?? (field.concealed ? "•".repeat(12) : field.value)}
                  </Text>
                </View>
                <View style={styles.rowActions}>
                  {field.concealed ? (
                    <Pressable
                      onPress={async () => {
                        if (value) {
                          setRevealed((current) => {
                            const next = { ...current };
                            delete next[index];
                            return next;
                          });
                          return;
                        }
                        try {
                          const secret = await api.secrets.reveal(props.itemId, index);
                          setRevealed((current) => ({ ...current, [index]: secret }));
                          props.onAccess();
                        } catch (cause) {
                          notify(errorMessage(cause, "Could not reveal the secret"));
                        }
                      }}
                      hitSlop={8}
                    >
                      <Text style={[styles.link, { color: theme.accent }]}>{value ? "Hide" : "Show"}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => copy(field.value, `${field.label || "Secret"} copied`)} hitSlop={8}>
                    <Text style={[styles.link, { color: theme.accent }]}>Copy</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        : null}
      <Btn label="Access history" tone="ghost" compact onPress={props.onAccess} />
    </>
  );
}

function SecretAccessSheet(props: { visible: boolean; itemId: string; onClose: () => void; onChanged: () => void }) {
  const { theme, notify } = useApp();
  const [entries, setEntries] = useState<SecretAccessEntry[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.visible) return;
    api.secrets
      .accessLog(props.itemId)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [props.itemId, props.visible]);

  return (
    <Sheet visible={props.visible} title="Secret access history" subtitle="Reveals are recorded on this device only." onClose={props.onClose}>
      {entries.length === 0 ? (
        <Text style={[styles.meta, { color: theme.muted }]}>
          Nothing revealed yet. Every reveal is logged with a timestamp, and nothing is synced.
        </Text>
      ) : (
        entries.map((entry, index) => (
          <View key={`${entry.at}-${index}`} style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.value, { color: theme.text, flex: 1 }]}>{entry.action}</Text>
            <Text style={[styles.meta, { color: theme.muted }]}>{relativeTime(entry.at)}</Text>
          </View>
        ))
      )}
      <Btn
        label="Clear history"
        tone="danger"
        busy={busy}
        disabled={!entries.length}
        onPress={async () => {
          setBusy(true);
          try {
            await api.secrets.clearHistory(props.itemId);
            setEntries([]);
            props.onChanged();
            notify("Access history cleared");
          } catch (cause) {
            notify(errorMessage(cause, "Could not clear the history"));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Sheet>
  );
}

export function TotpBlock(props: { itemId: string }) {
  const { theme, copy } = useApp();
  const [code, setCode] = useState<TotpCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await api.totp(props.itemId);
        if (!cancelled) {
          setCode(next);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause, "No authenticator code"));
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [props.itemId]);

  if (error) return null;
  if (!code) return null;
  const counterBased = code.otpType === "hotp";
  const progress = counterBased ? 100 : Math.max(0, Math.min(100, code.progress * 100));
  return (
    <View style={[styles.totp, { backgroundColor: theme.accentSoft, borderColor: theme.accent }]}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.label, { color: theme.muted }]}>AUTHENTICATOR CODE</Text>
        <Text style={[styles.totpCode, { color: theme.text }]}>
          {code.code.slice(0, Math.ceil(code.code.length / 2))} {code.code.slice(Math.ceil(code.code.length / 2))}
        </Text>
        <View style={[styles.track, { backgroundColor: theme.border }]}>
          <View style={[styles.fill, { backgroundColor: theme.accent, width: `${progress}%` }]} />
        </View>
      </View>
      <View style={styles.totpMeta}>
        <Text style={[styles.meta, { color: theme.muted }]}>{counterBased ? `#${code.counter}` : `${code.remaining}s`}</Text>
        <Pressable onPress={() => copy(code.code, "Code copied")} hitSlop={8}>
          <Text style={[styles.link, { color: theme.accent }]}>Copy</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  footerRow: { flexDirection: "row", gap: 8 },
  hero: { flexDirection: "row", alignItems: "center", gap: 12 },
  heroBadge: { width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  heroGlyph: { fontSize: 19, fontWeight: "800" },
  heroTitle: { fontSize: 18, fontWeight: "800" },
  heroMeta: { fontSize: 11.5 },
  star: { fontSize: 22 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderWidth: 1, borderRadius: 13, padding: 12 },
  pairRow: { flexDirection: "row", gap: 8 },
  label: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.7, textTransform: "uppercase" },
  value: { fontSize: 14.5, lineHeight: 20 },
  rowActions: { flexDirection: "row", gap: 12, alignItems: "center", paddingTop: 2 },
  link: { fontSize: 12.5, fontWeight: "700" },
  meta: { fontSize: 11.5, lineHeight: 16 },
  notes: { borderWidth: 1, borderRadius: 13, padding: 12, gap: 6 },
  notesText: { fontSize: 13, lineHeight: 19 },
  totp: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 13 },
  totpCode: { fontSize: 27, fontWeight: "800", letterSpacing: 2, fontVariant: ["tabular-nums"] },
  totpMeta: { alignItems: "flex-end", gap: 6 },
  track: { height: 4, borderRadius: 999, overflow: "hidden", marginTop: 2 },
  fill: { height: 4, borderRadius: 999 },
});
