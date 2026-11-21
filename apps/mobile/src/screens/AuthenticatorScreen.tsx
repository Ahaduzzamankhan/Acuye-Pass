/**
 * Authenticator tab: every RFC 6238/4226 entry with a live code, plus adding
 * entries from an otpauth:// URI or by hand.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useApp } from "../app-context";
import { Badge, Btn, Chip, Empty, ErrorBox, Field, Loading, Sheet } from "../components/ui";
import { api, errorMessage, type AuthenticatorEntry } from "../native";

export function AuthenticatorScreen(props: { onOpenItem: (id: string) => void; onCreate: () => void }) {
  const { theme, copy, vaultVersion, notify } = useApp();
  const [entries, setEntries] = useState<AuthenticatorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setEntries(await api.authenticator.list());
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, "Could not read your authenticator entries"));
    }
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
    const timer = setInterval(() => void load(), 1000);
    return () => clearInterval(timer);
  }, [load, vaultVersion]);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.title, { color: theme.text }]}>Authenticator</Text>
          <Text style={[styles.meta, { color: theme.muted }]}>
            {entries.length} {entries.length === 1 ? "entry" : "entries"} · codes computed on this phone
          </Text>
        </View>
        <Btn label="Add" tone="soft" compact onPress={() => setAdding(true)} />
      </View>

      {error ? (
        <View style={{ paddingHorizontal: 16 }}>
          <ErrorBox message={error} />
        </View>
      ) : null}

      {loading ? (
        <Loading label="Loading entries" />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {entries.length === 0 ? (
            <Empty
              title="No authenticator entries"
              body="Paste an otpauth:// setup link or type a base32 secret. Codes stay on this device and never touch a server."
              action={<Btn label="Add an entry" compact onPress={() => setAdding(true)} />}
            />
          ) : null}
          {entries.map((entry) => (
            <Pressable
              key={entry.id}
              onLongPress={() => props.onOpenItem(entry.id)}
              onPress={() => copy(entry.code, "Code copied")}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: pressed ? theme.surfaceAlt : theme.surface, borderColor: theme.border },
              ]}
            >
              <View style={styles.cardTop}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.entryTitle, { color: theme.text }]} numberOfLines={1}>
                    {entry.title}
                  </Text>
                  <Text style={[styles.meta, { color: theme.muted }]} numberOfLines={1}>
                    {[entry.issuer, entry.account].filter(Boolean).join(" · ") || entry.algorithm.toUpperCase()}
                  </Text>
                </View>
                {entry.otpType === "hotp" ? <Badge label="counter" tone="warning" /> : null}
                <Text style={[styles.meta, { color: theme.muted }]}>
                  {entry.otpType === "hotp" ? `#${entry.counter}` : `${entry.remaining}s`}
                </Text>
              </View>

              {entry.error ? (
                <Text style={[styles.meta, { color: theme.danger }]}>{entry.error}</Text>
              ) : (
                <Text style={[styles.code, { color: theme.text }]}>
                  {entry.code.slice(0, Math.ceil(entry.code.length / 2))}{" "}
                  {entry.code.slice(Math.ceil(entry.code.length / 2))}
                </Text>
              )}

              <View style={[styles.track, { backgroundColor: theme.border }]}>
                <View
                  style={[
                    styles.fill,
                    {
                      backgroundColor: theme.accent,
                      width: entry.otpType === "hotp" ? "100%" : `${Math.max(2, entry.progress * 100)}%`,
                    },
                  ]}
                />
              </View>

              <View style={styles.actions}>
                <Pressable onPress={() => copy(entry.code, "Code copied")} hitSlop={8}>
                  <Text style={[styles.link, { color: theme.accent }]}>Copy code</Text>
                </Pressable>
                <Pressable onPress={() => props.onOpenItem(entry.id)} hitSlop={8}>
                  <Text style={[styles.link, { color: theme.accent }]}>Details</Text>
                </Pressable>
                {entry.otpType === "hotp" ? (
                  <Pressable
                    onPress={async () => {
                      try {
                        await api.authenticator.advance(entry.id);
                        await load();
                      } catch (cause) {
                        notify(errorMessage(cause, "Could not advance the counter"));
                      }
                    }}
                    hitSlop={8}
                  >
                    <Text style={[styles.link, { color: theme.accent }]}>Next code</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={async () => {
                    try {
                      copy(await api.authenticator.exportUri(entry.id), "Setup link copied");
                    } catch (cause) {
                      notify(errorMessage(cause, "Could not export the entry"));
                    }
                  }}
                  hitSlop={8}
                >
                  <Text style={[styles.link, { color: theme.muted }]}>Export</Text>
                </Pressable>
              </View>
            </Pressable>
          ))}
          {entries.length ? (
            <Btn label="Add a vault item instead" tone="ghost" compact onPress={props.onCreate} />
          ) : null}
        </ScrollView>
      )}

      <AddEntrySheet visible={adding} onClose={() => setAdding(false)} onAdded={() => void load()} />
    </View>
  );
}

function AddEntrySheet(props: { visible: boolean; onClose: () => void; onAdded: () => void }) {
  const { theme } = useApp();
  const [tab, setTab] = useState<"uri" | "manual">("uri");
  const [uri, setUri] = useState("");
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [account, setAccount] = useState("");
  const [secret, setSecret] = useState("");
  const [digits, setDigits] = useState(6);
  const [period, setPeriod] = useState(30);
  const [algorithm, setAlgorithm] = useState("sha1");
  const [otpType, setOtpType] = useState("totp");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.visible) {
      setUri("");
      setName("");
      setIssuer("");
      setAccount("");
      setSecret("");
      setDigits(6);
      setPeriod(30);
      setAlgorithm("sha1");
      setOtpType("totp");
      setError(null);
    }
  }, [props.visible]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      if (tab === "uri") {
        await api.authenticator.addUri(uri.trim());
      } else {
        await api.authenticator.addEntry({
          name: name.trim(),
          secret: secret.trim(),
          issuer: issuer.trim(),
          account: account.trim(),
          otpType,
          algorithm,
          digits,
          period,
          counter: 0,
        });
      }
      props.onAdded();
      props.onClose();
    } catch (cause) {
      setError(errorMessage(cause, "Could not add the entry"));
    } finally {
      setBusy(false);
    }
  };

  const ready = tab === "uri" ? uri.trim().length > 8 : secret.trim().length > 0;

  return (
    <Sheet visible={props.visible} title="Add authenticator" onClose={props.onClose} subtitle="Codes are generated in Rust and stay on this phone.">
      <View style={styles.tabs}>
        <Chip label="Setup link" active={tab === "uri"} onPress={() => setTab("uri")} />
        <Chip label="Enter manually" active={tab === "manual"} onPress={() => setTab("manual")} />
      </View>

      {tab === "uri" ? (
        <Field
          label="otpauth:// URI"
          value={uri}
          onChangeText={setUri}
          placeholder="otpauth://totp/GitHub?secret=…"
          multiline
          hint="Usually shown as a QR code; copy its link instead."
        />
      ) : (
        <>
          <Field label="Name" value={name} onChangeText={setName} placeholder="GitHub" />
          <Field label="Issuer" value={issuer} onChangeText={setIssuer} placeholder="GitHub" />
          <Field label="Account" value={account} onChangeText={setAccount} placeholder="you@example.com" />
          <Field label="Shared secret" value={secret} onChangeText={setSecret} secure placeholder="Base32 secret" />
          <View style={{ gap: 8 }}>
            <Text style={[styles.caption, { color: theme.muted }]}>DIGITS</Text>
            <View style={styles.tabs}>
              {[6, 7, 8].map((value) => (
                <Chip key={value} label={String(value)} active={digits === value} onPress={() => setDigits(value)} />
              ))}
            </View>
          </View>
          <View style={{ gap: 8 }}>
            <Text style={[styles.caption, { color: theme.muted }]}>PERIOD</Text>
            <View style={styles.tabs}>
              {[30, 60].map((value) => (
                <Chip key={value} label={`${value}s`} active={period === value} onPress={() => setPeriod(value)} />
              ))}
            </View>
          </View>
          <View style={{ gap: 8 }}>
            <Text style={[styles.caption, { color: theme.muted }]}>ALGORITHM</Text>
            <View style={styles.tabs}>
              {["sha1", "sha256", "sha512"].map((value) => (
                <Chip
                  key={value}
                  label={value.toUpperCase()}
                  active={algorithm === value}
                  onPress={() => setAlgorithm(value)}
                />
              ))}
            </View>
          </View>
          <View style={{ gap: 8 }}>
            <Text style={[styles.caption, { color: theme.muted }]}>CODE TYPE</Text>
            <View style={styles.tabs}>
              <Chip label="Time based" active={otpType === "totp"} onPress={() => setOtpType("totp")} />
              <Chip label="Counter based" active={otpType === "hotp"} onPress={() => setOtpType("hotp")} />
            </View>
          </View>
        </>
      )}

      {error ? <ErrorBox message={error} /> : null}
      <Btn label="Add entry" onPress={() => void add()} busy={busy} disabled={!ready} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: "800" },
  meta: { fontSize: 11.5 },
  list: { paddingHorizontal: 16, paddingBottom: 28, gap: 10 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  entryTitle: { fontSize: 14.5, fontWeight: "700" },
  code: { fontSize: 30, fontWeight: "800", letterSpacing: 3, fontVariant: ["tabular-nums"] },
  track: { height: 4, borderRadius: 999, overflow: "hidden" },
  fill: { height: 4, borderRadius: 999 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  link: { fontSize: 12.5, fontWeight: "700" },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  caption: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.8 },
});
