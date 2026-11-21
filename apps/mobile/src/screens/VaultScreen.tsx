/**
 * The vault tab: search, category filters and the item list.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useApp } from "../app-context";
import { Badge, Btn, Empty, ErrorBox, Loading, Sheet } from "../components/ui";
import { api, errorMessage, type ItemSummary, type VaultCounts } from "../native";
import { relativeTime, typeGlyph, typeLabel } from "../theme";

const FILTERS: { key: string; label: string; glyph: string }[] = [
  { key: "", label: "All", glyph: "•" },
  { key: "login", label: "Logins", glyph: "K" },
  { key: "totp", label: "Codes", glyph: "T" },
  { key: "secret", label: "Secrets", glyph: "S" },
  { key: "secure_note", label: "Notes", glyph: "N" },
  { key: "card", label: "Cards", glyph: "C" },
  { key: "identity", label: "Identities", glyph: "I" },
  { key: "document", label: "Docs", glyph: "D" },
  { key: "custom", label: "Custom", glyph: "X" },
];

export function VaultScreen(props: {
  onOpenItem: (id: string) => void;
  onCreate: () => void;
  onLock: () => void;
}) {
  const { theme, status, vaultVersion, settings } = useApp();
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [counts, setCounts] = useState<VaultCounts | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [favorites, setFavorites] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alertsSheet, setAlertsSheet] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (needle: string) => {
      try {
        const [next, stats] = await Promise.all([
          api.list(needle, filter || null, favorites),
          api.counts(),
        ]);
        setItems(next);
        setCounts(stats);
        setError(null);
      } catch (cause) {
        setError(errorMessage(cause, "Could not read the vault"));
      }
    },
    [favorites, filter],
  );

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void load(query).finally(() => setLoading(false));
    }, 130);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load, query, vaultVersion]);

  useEffect(() => {
    api.secrets
      .alerts()
      .then((alerts) => setAlertCount(alerts.length))
      .catch(() => undefined);
  }, [vaultVersion]);

  const refresh = async () => {
    setRefreshing(true);
    await load(query);
    setRefreshing(false);
  };

  const session = status?.session;
  const subtitle = useMemo(() => {
    if (!counts) return "Decrypted locally";
    return `${counts.total} items · ${counts.favorites} favourite${counts.favorites === 1 ? "" : "s"}`;
  }, [counts]);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            {session?.vaultName ?? "Vault"}
          </Text>
          <Text style={[styles.meta, { color: theme.muted }]}>
            {session?.username ?? ""} · {subtitle}
          </Text>
        </View>
        {alertCount > 0 ? (
          <Pressable onPress={() => setAlertsSheet(true)} style={[styles.pill, { backgroundColor: theme.warningSoft }]}>
            <Text style={[styles.pillText, { color: theme.warning }]}>{alertCount} due</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={props.onLock}
          accessibilityRole="button"
          accessibilityLabel="Lock vault"
          style={[styles.lock, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <Text style={[styles.lockText, { color: theme.text }]}>Lock</Text>
        </Pressable>
      </View>

      <View style={[styles.searchRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.searchGlyph, { color: theme.muted }]}>⌕</Text>
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          value={query}
          onChangeText={setQuery}
          placeholder="Search titles, usernames, sites, tags"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query ? (
          <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="Clear search">
            <Text style={[styles.clear, { color: theme.muted }]}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        <Pressable
          onPress={() => setFavorites((current) => !current)}
          style={[
            styles.favorite,
            {
              backgroundColor: favorites ? theme.warningSoft : theme.surface,
              borderColor: favorites ? theme.warning : theme.border,
            },
          ]}
        >
          <Text style={[styles.favoriteText, { color: favorites ? theme.warning : theme.muted }]}>★</Text>
        </Pressable>
        {FILTERS.map((entry) => {
          const active = filter === entry.key;
          return (
            <Pressable
              key={entry.key || "all"}
              onPress={() => setFilter(entry.key)}
              style={[
                styles.filter,
                {
                  backgroundColor: active ? theme.accentSoft : theme.surface,
                  borderColor: active ? theme.accent : theme.border,
                },
              ]}
            >
              <Text style={[styles.filterGlyph, { color: active ? theme.accent : theme.muted }]}>{entry.glyph}</Text>
              <Text style={[styles.filterText, { color: active ? theme.accent : theme.muted }]}>{entry.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {error ? (
        <View style={{ paddingHorizontal: 16 }}>
          <ErrorBox message={error} />
        </View>
      ) : null}

      {loading ? (
        <Loading label="Opening your vault" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.accent} />}
          ListEmptyComponent={
            <Empty
              title={query || filter || favorites ? "Nothing matches" : "Your vault is empty"}
              body={
                query || filter || favorites
                  ? "Try a different search or category."
                  : "Add a login, a secure note, a card or an authenticator code. Everything is encrypted before it touches disk."
              }
              action={<Btn label="Add your first item" onPress={props.onCreate} compact />}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => props.onOpenItem(item.id)}
              style={({ pressed }) => [
                styles.item,
                {
                  backgroundColor: pressed ? theme.surfaceAlt : theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
                <Text style={[styles.badgeText, { color: theme.accent }]}>{typeGlyph(item.item_type)}</Text>
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={styles.itemTop}>
                  <Text style={[styles.itemTitle, { color: theme.text }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {item.favorite ? <Text style={[styles.star, { color: theme.warning }]}>★</Text> : null}
                </View>
                <Text style={[styles.itemSubtitle, { color: theme.muted }]} numberOfLines={1}>
                  {item.subtitle || typeLabel(item.item_type)}
                </Text>
                <View style={styles.itemMeta}>
                  <Text style={[styles.metaBadge, { color: theme.muted }]}>{typeLabel(item.item_type)}</Text>
                  <Text style={[styles.dot, { color: theme.muted }]}>·</Text>
                  <Text style={[styles.metaBadge, { color: theme.muted }]}>{relativeTime(item.updated_at)}</Text>
                  {item.tags.slice(0, 2).map((tag) => (
                    <Badge key={tag} label={tag} />
                  ))}
                </View>
              </View>
              <Text style={[styles.chevron, { color: theme.muted }]}>›</Text>
            </Pressable>
          )}
        />
      )}

      <Pressable
        onPress={props.onCreate}
        accessibilityRole="button"
        accessibilityLabel="Add item"
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: theme.accent, opacity: pressed ? 0.9 : 1 },
        ]}
      >
        <Text style={[styles.fabGlyph, { color: theme.accentText }]}>+</Text>
      </Pressable>

      <SecretAlertsSheet visible={alertsSheet} onClose={() => setAlertsSheet(false)} onOpen={props.onOpenItem} />
      {settings.auto_lock_secs > 0 ? (
        <Text style={[styles.autoLock, { color: theme.muted }]}>
          Auto-lock after {formatSeconds(settings.auto_lock_secs)}
        </Text>
      ) : null}
    </View>
  );
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

function SecretAlertsSheet(props: { visible: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const { theme } = useApp();
  const [alerts, setAlerts] = useState<Awaited<ReturnType<typeof api.secrets.alerts>>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!props.visible) return;
    setLoading(true);
    api.secrets
      .alerts()
      .then(setAlerts)
      .catch(() => setAlerts([]))
      .finally(() => setLoading(false));
  }, [props.visible]);

  const label = (kind: string) =>
    kind === "expired"
      ? "Expired"
      : kind === "expiring"
        ? "Expires soon"
        : kind === "rotation_due"
          ? "Rotate now"
          : "Rotation due soon";

  return (
    <Sheet visible={props.visible} title="Secret reminders" onClose={props.onClose} subtitle="Expiry and rotation across your secret items.">
      {loading ? <Loading /> : null}
      {!loading && alerts.length === 0 ? (
        <Empty title="Nothing due" body="Secrets with an expiry date or rotation interval show up here." />
      ) : null}
      {alerts.map((alert) => (
        <Pressable
          key={`${alert.id}-${alert.kind}`}
          onPress={() => {
            props.onClose();
            props.onOpen(alert.id);
          }}
          style={[styles.alertRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[styles.itemTitle, { color: theme.text }]}>{alert.title}</Text>
            <Text style={[styles.itemSubtitle, { color: theme.muted }]}>
              {label(alert.kind)} · {relativeTime(alert.dueAt)}
            </Text>
          </View>
          <Badge label={label(alert.kind)} tone={alert.kind === "expired" || alert.kind === "rotation_due" ? "danger" : "warning"} />
        </Pressable>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: "800" },
  meta: { fontSize: 11.5 },
  lock: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  lockText: { fontSize: 12.5, fontWeight: "700" },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pillText: { fontSize: 11, fontWeight: "700" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchGlyph: { fontSize: 16, fontWeight: "700" },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14 },
  clear: { fontSize: 13, fontWeight: "700" },
  filters: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  filter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  filterGlyph: { fontSize: 10.5, fontWeight: "800" },
  filterText: { fontSize: 12, fontWeight: "600" },
  favorite: { width: 34, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 999 },
  favoriteText: { fontSize: 14, fontWeight: "800" },
  list: { paddingHorizontal: 16, paddingBottom: 128, gap: 8, paddingTop: 2 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 15, padding: 12 },
  badge: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 15, fontWeight: "800" },
  itemTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  itemTitle: { fontSize: 14.5, fontWeight: "700", flexShrink: 1 },
  star: { fontSize: 12 },
  itemSubtitle: { fontSize: 12 },
  itemMeta: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 1 },
  metaBadge: { fontSize: 10.5 },
  dot: { fontSize: 10 },
  chevron: { fontSize: 20, fontWeight: "600" },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  fabGlyph: { fontSize: 27, fontWeight: "700", marginTop: -2 },
  autoLock: { position: "absolute", bottom: 8, left: 0, right: 0, textAlign: "center", fontSize: 10 },
  alertRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 12 },
});
