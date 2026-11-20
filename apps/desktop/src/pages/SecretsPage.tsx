import {
  AlertTriangle,
  Copy,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge, Button, Input, Select, Spinner } from "@/components/ui";
import { useBackend } from "@/lib/backend-context";
import type {
  ItemSummary,
  SecretAccessEntry,
  SecretAlert,
  SecretEnvironment,
  TypedItem,
} from "@/lib/types";

const ENVIRONMENTS: SecretEnvironment[] = ["development", "testing", "production"];

const ENV_TONE: Record<string, "success" | "warning" | "danger" | "muted"> = {
  development: "muted",
  testing: "warning",
  production: "danger",
};

const ALERT_LABEL: Record<SecretAlert["kind"], string> = {
  expired: "Expired",
  expiring: "Expires soon",
  rotation_due: "Rotation due",
  rotation_soon: "Rotate soon",
};

export function SecretsPage() {
  const backend = useBackend();
  const [summaries, setSummaries] = useState<ItemSummary[]>([]);
  const [alerts, setAlerts] = useState<SecretAlert[]>([]);
  const [selected, setSelected] = useState<TypedItem | null>(null);
  const [history, setHistory] = useState<SecretAccessEntry[]>([]);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [environment, setEnvironment] = useState<SecretEnvironment | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    environment: "development" as SecretEnvironment,
    category: "",
    label: "API key",
    value: "",
  });

  const refresh = useCallback(async () => {
    try {
      const [items, nextAlerts] = await Promise.all([
        backend.listItems("", null, false),
        backend.secretAlerts(),
      ]);
      setSummaries(items.filter((item) => item.item_type === "secret"));
      setAlerts(nextAlerts);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load secrets");
    } finally {
      setLoading(false);
    }
  }, [backend]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = async (id: string) => {
    try {
      const item = await backend.getItem(id);
      setSelected(item as TypedItem);
      setRevealed({});
      setHistory(await backend.secretAccessLog(id));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open that secret");
    }
  };

  const create = async () => {
    if (!draft.title.trim() || !draft.value.trim()) {
      setError("A title and a value are required");
      return;
    }
    try {
      const item = await backend.createItem({
        title: draft.title.trim(),
        tags: draft.category.trim() ? [draft.category.trim()] : [],
        fields: {
          kind: "secret",
          environment: draft.environment,
          category: draft.category.trim(),
          fields: [{ label: draft.label.trim() || "Value", value: draft.value, concealed: true }],
          expires_at: null,
          rotate_every_days: null,
          last_rotated_at: null,
        },
      });
      setCreating(false);
      setDraft({ title: "", environment: "development", category: "", label: "API key", value: "" });
      await refresh();
      await open(item.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that secret");
    }
  };

  const copy = async (index: number) => {
    if (!selected) return;
    try {
      await backend.secretCopy(selected.id, index);
      setHistory(await backend.secretAccessLog(selected.id));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not copy that field");
    }
  };

  const reveal = async (index: number) => {
    if (!selected) return;
    if (revealed[index] !== undefined) {
      setRevealed((current) => {
        const next = { ...current };
        delete next[index];
        return next;
      });
      return;
    }
    try {
      const value = await backend.secretReveal(selected.id, index);
      setRevealed((current) => ({ ...current, [index]: value }));
      setHistory(await backend.secretAccessLog(selected.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reveal that field");
    }
  };

  const remove = async (id: string) => {
    try {
      await backend.deleteItem(id);
      if (selected?.id === id) setSelected(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete that secret");
    }
  };

  const visible = useMemo(
    () =>
      summaries.filter((item) =>
        environment === "all" ? true : item.subtitle.toLowerCase().includes(environment),
      ),
    [summaries, environment],
  );

  const fields = selected && selected.kind === "secret" ? selected.fields : [];

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
      <div className="flex min-h-0 w-[300px] shrink-0 flex-col border-r border-border">
        <div className="border-b border-border px-4 py-4">
          <h1 className="text-[17px] font-semibold tracking-[-0.01em]">Secrets</h1>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            API keys, tokens and credentials, encrypted in this vault.
          </p>
          <Button size="sm" className="mt-3 w-full" onClick={() => setCreating((value) => !value)}>
            <Plus className="h-3.5 w-3.5" /> New secret
          </Button>
        </div>

        <div className="flex gap-1 border-b border-border px-3 py-2">
          {(["all", ...ENVIRONMENTS] as const).map((env) => (
            <button
              key={env}
              type="button"
              onClick={() => setEnvironment(env)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors ${
                environment === env ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {env}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-4 text-[12px] text-muted-foreground">
              <Spinner /> Loading…
            </div>
          ) : visible.length === 0 ? (
            <p className="px-2 py-6 text-[11.5px] leading-relaxed text-muted-foreground">
              No secrets in this environment yet.
            </p>
          ) : (
            visible.map((item) => {
              const alert = alerts.find((entry) => entry.id === item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void open(item.id)}
                  className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                    selected?.id === item.id ? "bg-muted" : "hover:bg-muted/60"
                  }`}
                >
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium">{item.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{item.subtitle}</span>
                  </span>
                  {alert ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" /> : null}
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-8">
          {error ? <p className="mb-4 text-[12px] text-danger">{error}</p> : null}

          {alerts.length > 0 ? (
            <div className="mb-4 rounded-xl border border-warning/40 bg-warning/5 p-3">
              <p className="text-[12.5px] font-medium">{alerts.length} secret reminder{alerts.length === 1 ? "" : "s"}</p>
              <ul className="mt-1 space-y-0.5">
                {alerts.slice(0, 5).map((alert) => (
                  <li key={`${alert.id}-${alert.kind}`} className="text-[11.5px] text-muted-foreground">
                    <span className="font-medium text-foreground">{alert.title}</span> — {ALERT_LABEL[alert.kind]}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {creating ? (
            <section className="mb-4 rounded-xl border border-border bg-surface p-4">
              <p className="text-[13px] font-medium">New secret</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder="Title (for example Stripe production key)"
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
                <Select
                  value={draft.environment}
                  onChange={(event) =>
                    setDraft({ ...draft, environment: event.target.value as SecretEnvironment })
                  }
                >
                  {ENVIRONMENTS.map((env) => (
                    <option key={env} value={env}>
                      {env}
                    </option>
                  ))}
                </Select>
                <Input
                  placeholder="Category (optional)"
                  value={draft.category}
                  onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                />
                <Input
                  placeholder="Field name"
                  value={draft.label}
                  onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                />
                <Input
                  className="sm:col-span-2 font-mono text-[12px]"
                  placeholder="Secret value"
                  type="password"
                  value={draft.value}
                  onChange={(event) => setDraft({ ...draft, value: event.target.value })}
                />
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => void create()}>
                  Save secret
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
            </section>
          ) : null}

          {selected && selected.kind === "secret" ? (
            <section className="rounded-xl border border-border bg-surface p-5">
              <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[16px] font-semibold">{selected.title}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={ENV_TONE[selected.environment] ?? "muted"}>{selected.environment}</Badge>
                    {selected.category ? <Badge tone="muted">{selected.category}</Badge> : null}
                    {selected.tags.map((tag) => (
                      <Badge key={tag} tone="muted">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void remove(selected.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </header>

              <div className="mt-4 space-y-2">
                {fields.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">This secret has no fields.</p>
                ) : (
                  fields.map((field, index) => (
                    <div
                      key={`${field.label}-${index}`}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                          {field.label || "Field"}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[12px]">
                          {revealed[index] ?? "•".repeat(Math.min(24, Math.max(8, field.value.length)))}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" aria-label="Copy field" onClick={() => void copy(index)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label="Reveal field" onClick={() => void reveal(index)}>
                        {revealed[index] !== undefined ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-5 border-t border-border pt-3">
                <div className="flex items-center gap-2">
                  <History className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-[12px] font-medium">Access history</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={async () => {
                      await backend.secretClearHistory(selected.id);
                      setHistory([]);
                    }}
                  >
                    Clear
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Only the action and time are recorded — never the value.
                </p>
                <ul className="mt-2 space-y-1">
                  {history.length === 0 ? (
                    <li className="text-[11.5px] text-muted-foreground">No access recorded yet.</li>
                  ) : (
                    history.slice(0, 8).map((entry, index) => (
                      <li key={`${entry.at}-${index}`} className="text-[11.5px] text-muted-foreground">
                        <span className="capitalize text-foreground">{entry.action}</span> ·{" "}
                        {new Date(entry.at * 1000).toLocaleString()}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </section>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-16 text-center">
              <KeyRound className="h-6 w-6 text-muted-foreground" />
              <p className="text-[13px] font-medium">Select a secret</p>
              <p className="max-w-sm text-[11.5px] leading-relaxed text-muted-foreground">
                Values stay masked until you reveal or copy them, and every access is recorded
                without the value.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
