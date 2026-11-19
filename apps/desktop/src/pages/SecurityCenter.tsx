import { motion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Star,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useApp } from "@/lib/app-context";
import { relativeTime } from "@/lib/utils";
import { Badge, Button, IconButton, Spinner } from "@/components/ui";
import type { SecurityIssueKind } from "@/lib/types";

const ISSUE_META: Record<SecurityIssueKind, { label: string; tone: "danger" | "warning" | "muted"; icon: typeof KeyRound }> = {
  weak_password: { label: "Weak password", tone: "danger", icon: KeyRound },
  reused_password: { label: "Reused password", tone: "warning", icon: AlertTriangle },
  old_password: { label: "Old password", tone: "muted", icon: CalendarClock },
  empty_password: { label: "No password", tone: "danger", icon: ShieldAlert },
};

export function SecurityCenter() {
  const { report, recheckSecurity, selectItem, setFilter, counts } = useApp();
  const navigate = useNavigate();

  const openIssue = async (itemId: string) => {
    setFilter("all");
    navigate("/vault");
    await selectItem(itemId);
  };

  const score = report?.score ?? 100;
  const circumference = 2 * Math.PI * 44;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-4xl px-8 py-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Security Center</h1>
            <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              Local analysis of your vault. Passwords never leave this device and no breach
              service is contacted.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void recheckSecurity()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Re-scan
          </Button>
        </header>

        <div className="mt-6 grid gap-4 lg:grid-cols-[300px_1fr]">
          <section className="flex flex-col items-center rounded-xl border border-border bg-surface p-5">
            <div className="relative h-32 w-32">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="44" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
                <motion.circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke={score >= 80 ? "hsl(var(--success))" : score >= 50 ? "hsl(var(--warning))" : "hsl(var(--danger))"}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  initial={{ strokeDashoffset: circumference }}
                  animate={{ strokeDashoffset: offset }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[30px] font-semibold leading-none tabular-nums">{score}</span>
                <span className="mt-1 text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  Vault score
                </span>
              </div>
            </div>
            <p className="mt-3 text-center text-[12px] leading-relaxed text-muted-foreground">
              {score >= 80
                ? "Your local vault hygiene looks good."
                : score >= 50
                  ? "A few items need attention."
                  : "Several passwords are risky."}
            </p>
            <p className="mt-2 text-center text-[10.5px] text-muted-foreground/70">
              {report ? `Scanned ${relativeTime(report.scanned_at)}` : "Scanning…"}
            </p>
            <div className="mt-4 grid w-full grid-cols-2 gap-2 text-center">
              <Stat label="Items" value={report?.total_items ?? counts.total} />
              <Stat label="Logins" value={report?.login_items ?? counts.logins} />
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <IssueCard label="Weak passwords" value={report?.weak ?? 0} tone="danger" icon={<KeyRound />} />
            <IssueCard label="Reused passwords" value={report?.reused ?? 0} tone="warning" icon={<AlertTriangle />} />
            <IssueCard label="Old passwords" value={report?.old ?? 0} tone="muted" icon={<CalendarClock />} />
            <IssueCard label="Missing passwords" value={report?.empty ?? 0} tone="danger" icon={<ShieldAlert />} />
            <div className="sm:col-span-2 flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/10 text-success">
                <ShieldCheck className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">Everything is checked locally</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                  Strength, reuse and password age are computed in Rust on this device. Breach
                  checks are intentionally not implemented, because they would require sending
                  password material to a third party.
                </p>
              </div>
              <Badge tone="success">Private</Badge>
            </div>
          </div>
        </div>

        <section className="mt-7">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold">Recommendations</h2>
            {report ? (
              <span className="text-[11px] text-muted-foreground">{report.issues.length} findings</span>
            ) : null}
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            {!report ? (
              <div className="flex items-center gap-2 px-4 py-8 text-[12.5px] text-muted-foreground">
                <Spinner /> Analysing the vault…
              </div>
            ) : report.issues.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-success/10 text-success">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <p className="mt-3 text-[13px] font-medium">No issues found</p>
                <p className="mt-1 max-w-sm text-[12px] text-muted-foreground">
                  Every login has a unique, reasonably strong password. Re-scan after adding or
                  editing items.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/70">
                {report.issues.map((issue, index) => {
                  const meta = ISSUE_META[issue.issue];
                  const IssueIcon = meta.icon;
                  return (
                    <li key={`${issue.item_id}-${issue.issue}-${index}`}>
                      <div className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40">
                        <div
                          className={
                            meta.tone === "danger"
                              ? "flex h-7 w-7 items-center justify-center rounded-md bg-danger/10 text-danger"
                              : meta.tone === "warning"
                                ? "flex h-7 w-7 items-center justify-center rounded-md bg-warning/10 text-warning"
                                : "flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground"
                          }
                        >
                          <IssueIcon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-medium">{issue.title}</p>
                          <p className="text-[11px] text-muted-foreground">{issue.detail}</p>
                        </div>
                        <Badge tone={meta.tone === "muted" ? "muted" : meta.tone}>{meta.label}</Badge>
                        <IconButton
                          aria-label={`Open ${issue.title}`}
                          title="Open item"
                          onClick={() => void openIssue(issue.item_id)}
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <p className="mt-6 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Star className="h-3 w-3" />
          This score is a local heuristic, not a security audit or a guarantee.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-1.5">
      <p className="text-[15px] font-semibold leading-none tabular-nums">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
    </div>
  );
}

function IssueCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "danger" | "warning" | "muted";
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5">
      <div
        className={
          tone === "danger"
            ? "flex h-9 w-9 items-center justify-center rounded-lg bg-danger/10 text-danger"
            : tone === "warning"
              ? "flex h-9 w-9 items-center justify-center rounded-lg bg-warning/10 text-warning"
              : "flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        }
      >
        <span className="[&_svg]:h-4.5 [&_svg]:w-4.5">{icon}</span>
      </div>
      <div>
        <p className="text-[19px] font-semibold leading-none tabular-nums">{value}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
      </div>
      {value === 0 ? <Badge tone="success" className="ml-auto">Clear</Badge> : null}
    </div>
  );
}
