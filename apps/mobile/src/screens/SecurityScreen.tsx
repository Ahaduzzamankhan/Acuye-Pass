/**
 * Security Center: the same local hygiene scan the desktop app runs, with no
 * network calls. Passwords are analysed inside Rust and never transmitted.
 */

import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { useApp } from "../app-context";
import { Badge, Btn, ErrorBox, Loading, SectionTitle } from "../components/ui";
import { api, errorMessage, type SecurityIssue, type SecurityReport, type VaultCounts } from "../native";
import { relativeTime } from "../theme";

const ISSUE_META: Record<SecurityIssue["issue"], { label: string; tone: "danger" | "warning" | "muted" }> = {
  empty_password: { label: "No password", tone: "danger" },
  weak_password: { label: "Weak", tone: "warning" },
  reused_password: { label: "Reused", tone: "warning" },
  old_password: { label: "Old", tone: "muted" },
};

export function SecurityScreen(props: { onOpenItem: (id: string) => void }) {
  const { theme, vaultVersion } = useApp();
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [counts, setCounts] = useState<VaultCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<SecurityIssue["issue"] | null>(null);

  const load = useCallback(async () => {
    try {
      const [next, stats] = await Promise.all([api.securityReport(), api.counts()]);
      setReport(next);
      setCounts(stats);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, "Could not scan the vault"));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, vaultVersion]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const score = report?.score ?? 0;
  const scoreColor = score >= 85 ? theme.success : score >= 60 ? theme.warning : theme.danger;
  const issues = (report?.issues ?? []).filter((issue) => !filter || issue.issue === filter);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.accent} />}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Security Center</Text>
        <Text style={[styles.meta, { color: theme.muted }]}>
          Local analysis only · scan of {report ? relativeTime(report.scanned_at) : "…"}
        </Text>
      </View>

      {error ? <ErrorBox message={error} /> : null}
      {!report ? <Loading label="Scanning your vault" /> : null}

      {report ? (
        <>
          <View style={[styles.scoreCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={[styles.ring, { borderColor: scoreColor, backgroundColor: theme.bg }]}>
              <Text style={[styles.score, { color: scoreColor }]}>{score}</Text>
              <Text style={[styles.scoreOutOf, { color: theme.muted }]}>/100</Text>
            </View>
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={[styles.scoreTitle, { color: theme.text }]}>
                {score >= 85 ? "Looking good" : score >= 60 ? "Worth tidying" : "Needs attention"}
              </Text>
              <Text style={[styles.meta, { color: theme.muted }]}>
                {report.login_items} login{report.login_items === 1 ? "" : "s"} · {report.total_items} item
                {report.total_items === 1 ? "" : "s"} in the vault
              </Text>
              <View style={styles.badges}>
                <Badge label={`${report.weak} weak`} tone={report.weak ? "warning" : "success"} />
                <Badge label={`${report.reused} reused`} tone={report.reused ? "warning" : "success"} />
                <Badge label={`${report.old} old`} tone={report.old ? "muted" : "success"} />
                <Badge label={`${report.empty} empty`} tone={report.empty ? "danger" : "success"} />
              </View>
            </View>
          </View>

          <View style={styles.stats}>
            <Stat label="Items" value={counts?.total ?? report.total_items} />
            <Stat label="Favourites" value={counts?.favorites ?? 0} />
            <Stat label="Codes" value={counts?.authenticators ?? 0} />
            <Stat label="Secrets" value={counts?.secrets ?? 0} />
          </View>

          <SectionTitle
            title="Findings"
            caption="Tap a finding to open the item. Detail comes from the shared Rust engine."
            right={
              filter ? (
                <Btn label="Show all" tone="ghost" compact onPress={() => setFilter(null)} />
              ) : undefined
            }
          />

          <View style={styles.filters}>
            {(["weak_password", "reused_password", "old_password", "empty_password"] as const).map((kind) => (
              <Btn
                key={kind}
                label={ISSUE_META[kind].label}
                tone={filter === kind ? "soft" : "ghost"}
                compact
                onPress={() => setFilter((current) => (current === kind ? null : kind))}
              />
            ))}
          </View>

          {issues.length === 0 ? (
            <View style={[styles.clean, { backgroundColor: theme.successSoft }]}>
              <Text style={[styles.cleanTitle, { color: theme.success }]}>
                {report.issues.length === 0 ? "No issues found" : "Nothing in this category"}
              </Text>
              <Text style={[styles.meta, { color: theme.muted }]}>
                Weak, reused, old and empty passwords show up here. Rotation reminders for secret items live in the
                vault tab.
              </Text>
            </View>
          ) : (
            issues.map((issue) => (
              <View
                key={`${issue.item_id}-${issue.issue}`}
                style={[styles.issue, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.issueTitle, { color: theme.text }]}>{issue.title}</Text>
                  <Text style={[styles.meta, { color: theme.muted }]}>{issue.detail}</Text>
                </View>
                <Badge label={ISSUE_META[issue.issue].label} tone={ISSUE_META[issue.issue].tone} />
                <Btn label="Open" tone="ghost" compact onPress={() => props.onOpenItem(issue.item_id)} />
              </View>
            ))
          )}

          <View style={[styles.note, { backgroundColor: theme.surfaceAlt }]}>
            <Text style={[styles.noteTitle, { color: theme.text }]}>How this is scored</Text>
            <Text style={[styles.meta, { color: theme.muted }]}>
              A 0-100 hygiene score, not an audit: weak passwords cost 6 points each, reused 8, old (over a year) 3 and
              missing 10. Everything is computed on this phone and nothing is uploaded.
            </Text>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function Stat(props: { label: string; value: number }) {
  const { theme } = useApp();
  return (
    <View style={[styles.stat, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.statValue, { color: theme.text }]}>{props.value}</Text>
      <Text style={[styles.statLabel, { color: theme.muted }]}>{props.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 30 },
  header: { gap: 3 },
  title: { fontSize: 20, fontWeight: "800" },
  meta: { fontSize: 11.5, lineHeight: 16 },
  scoreCard: { flexDirection: "row", alignItems: "center", gap: 16, borderWidth: 1, borderRadius: 18, padding: 16 },
  ring: {
    width: 88,
    height: 88,
    borderRadius: 999,
    borderWidth: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  score: { fontSize: 26, fontWeight: "800", fontVariant: ["tabular-nums"] },
  scoreOutOf: { fontSize: 10 },
  scoreTitle: { fontSize: 16, fontWeight: "800" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  stats: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, borderWidth: 1, borderRadius: 13, padding: 10, alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontWeight: "800", fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 10.5 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  clean: { borderRadius: 14, padding: 14, gap: 5 },
  cleanTitle: { fontSize: 14, fontWeight: "700" },
  issue: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 12 },
  issueTitle: { fontSize: 14, fontWeight: "700" },
  note: { borderRadius: 14, padding: 14, gap: 5 },
  noteTitle: { fontSize: 13.5, fontWeight: "700" },
});
