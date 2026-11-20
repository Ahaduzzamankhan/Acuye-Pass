import { Copy, KeyRound, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge, Button, Input, Spinner } from "@/components/ui";
import { useBackend } from "@/lib/backend-context";
import type { NewAuthenticatorEntry, TotpEntry } from "@/lib/types";

const selectClass =
  "h-8 rounded-lg border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-accent/30";

const emptyDraft = (): NewAuthenticatorEntry => ({
  name: "",
  secret: "",
  issuer: "",
  account: "",
  otpType: "totp",
  algorithm: "sha1",
  digits: 6,
  period: 30,
  counter: 0,
});

export function AuthenticatorPage() {
  const backend = useBackend();
  const [entries, setEntries] = useState<TotpEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<NewAuthenticatorEntry>(emptyDraft);
  const [showForm, setShowForm] = useState(false);
  const [uri, setUri] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEntries(await backend.authenticatorEntries());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read authenticator entries");
    } finally {
      setLoading(false);
    }
  }, [backend]);

  // Codes roll over with the clock, so refresh once a second while visible.
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.title, entry.issuer, entry.account].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [entries, query]);

  const add = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await backend.authenticatorAddEntry(draft);
      setDraft(emptyDraft());
      setShowForm(false);
      setNotice("Authenticator entry added.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That entry could not be added");
    } finally {
      setBusy(false);
    }
  };

  const addFromUri = async () => {
    if (!uri.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await backend.authenticatorAdd(uri.trim());
      setUri("");
      setNotice("Entry imported from the setup URI.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That setup code could not be added");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (key: string, value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setNotice(message);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    } catch {
      setError("The clipboard is not available");
    }
  };

  const nextCounter = async (entry: TotpEntry) => {
    setBusy(true);
    setError(null);
    try {
      const counter = await backend.authenticatorAdvanceCounter(entry.id);
      setNotice(`Moved ${entry.title} to counter ${counter}.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not advance the counter");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await backend.deleteItem(id);
      setNotice("Entry deleted.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete that entry");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-4xl px-8 py-8">
        <header className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Authenticator</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Time-based and counter-based codes, generated on this device.
            </p>
          </div>
          <Button size="sm" onClick={() => setShowForm((value) => !value)}>
            <Plus className="h-3.5 w-3.5" /> Add entry
          </Button>
        </header>

        <div className="mt-5 flex items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, issuer or account"
            className="h-9 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
          />
          <span className="text-[11px] text-muted-foreground">
            {visible.length}/{entries.length}
          </span>
        </div>

        {showForm ? (
          <section className="mt-3 rounded-xl border border-border bg-surface p-4">
            <p className="text-[13px] font-medium">New entry</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-[11px] text-muted-foreground">
                Name
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="GitHub"
                  className="mt-1 h-8 text-[12px]"
                />
              </label>
              <label className="text-[11px] text-muted-foreground">
                Issuer
                <Input
                  value={draft.issuer}
                  onChange={(event) => setDraft({ ...draft, issuer: event.target.value })}
                  placeholder="GitHub"
                  className="mt-1 h-8 text-[12px]"
                />
              </label>
              <label className="text-[11px] text-muted-foreground">
                Account
                <Input
                  value={draft.account}
                  onChange={(event) => setDraft({ ...draft, account: event.target.value })}
                  placeholder="you@example.com"
                  className="mt-1 h-8 text-[12px]"
                />
              </label>
              <label className="text-[11px] text-muted-foreground">
                Secret (base32)
                <Input
                  value={draft.secret}
                  onChange={(event) => setDraft({ ...draft, secret: event.target.value })}
                  placeholder="JBSWY3DPEHPK3PXP"
                  spellCheck={false}
                  className="mt-1 h-8 font-mono text-[12px]"
                />
              </label>
              <label className="text-[11px] text-muted-foreground">
                Type
                <select
                  value={draft.otpType}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      otpType: event.target.value,
                      period: event.target.value === "hotp" ? draft.period : draft.period,
                    })
                  }
                  className={`${selectClass} mt-1 block w-full`}
                >
                  <option value="totp">TOTP (time based)</option>
                  <option value="hotp">HOTP (counter based)</option>
                </select>
              </label>
              <label className="text-[11px] text-muted-foreground">
                Algorithm
                <select
                  value={draft.algorithm}
                  onChange={(event) => setDraft({ ...draft, algorithm: event.target.value })}
                  className={`${selectClass} mt-1 block w-full`}
                >
                  <option value="sha1">SHA-1 (default)</option>
                  <option value="sha256">SHA-256</option>
                  <option value="sha512">SHA-512</option>
                </select>
              </label>
              <label className="text-[11px] text-muted-foreground">
                Digits
                <select
                  value={draft.digits}
                  onChange={(event) => setDraft({ ...draft, digits: Number(event.target.value) })}
                  className={`${selectClass} mt-1 block w-full`}
                >
                  {[6, 7, 8].map((value) => (
                    <option key={value} value={value}>
                      {value} digits
                    </option>
                  ))}
                </select>
              </label>
              {draft.otpType === "totp" ? (
                <label className="text-[11px] text-muted-foreground">
                  Time interval (seconds)
                  <Input
                    type="number"
                    min={15}
                    max={300}
                    value={draft.period}
                    onChange={(event) =>
                      setDraft({ ...draft, period: Number(event.target.value) || 30 })
                    }
                    className="mt-1 h-8 text-[12px]"
                  />
                </label>
              ) : (
                <label className="text-[11px] text-muted-foreground">
                  Counter
                  <Input
                    type="number"
                    min={0}
                    value={draft.counter}
                    onChange={(event) =>
                      setDraft({ ...draft, counter: Number(event.target.value) || 0 })
                    }
                    className="mt-1 h-8 text-[12px]"
                  />
                </label>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy || !draft.secret.trim()} onClick={() => void add()}>
                <Plus className="h-3.5 w-3.5" /> Add to vault
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDraft(emptyDraft());
                  setShowForm(false);
                }}
              >
                Cancel
              </Button>
            </div>

            <div className="mt-4 border-t border-border pt-3">
              <p className="text-[11.5px] text-muted-foreground">
                Or paste the service's <span className="font-mono">otpauth://</span> setup URI.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  value={uri}
                  onChange={(event) => setUri(event.target.value)}
                  placeholder="otpauth://totp/Issuer:you@example.com?secret=…"
                  className="min-w-[240px] flex-1 font-mono text-[12px]"
                  spellCheck={false}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || !uri.trim()}
                  onClick={() => void addFromUri()}
                >
                  Import
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {error ? <p className="mt-3 text-[12px] text-danger">{error}</p> : null}
        {notice ? <p className="mt-3 text-[12px] text-muted-foreground">{notice}</p> : null}

        <section className="mt-4 space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 px-1 py-6 text-[12px] text-muted-foreground">
              <Spinner /> Loading authenticator entries…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <KeyRound className="h-6 w-6 text-muted-foreground" />
              <p className="text-[13px] font-medium">
                {entries.length === 0 ? "No authenticator entries yet" : "No entries match"}
              </p>
              <p className="max-w-sm text-[11.5px] leading-relaxed text-muted-foreground">
                {entries.length === 0
                  ? "Add an entry with its secret, issuer, digits, interval and algorithm. Secrets are encrypted in your vault like any other item."
                  : "Try a different search."}
              </p>
            </div>
          ) : (
            visible.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[13px] font-medium">{entry.title}</p>
                    {entry.otpType === "hotp" ? <Badge tone="muted">HOTP</Badge> : null}
                    {entry.algorithm !== "sha1" ? (
                      <Badge tone="muted">{entry.algorithm.toUpperCase()}</Badge>
                    ) : null}
                    {entry.digits !== 6 ? <Badge tone="muted">{entry.digits}-digit</Badge> : null}
                    {entry.otpType !== "hotp" && entry.period !== 30 ? (
                      <Badge tone="muted">{entry.period}s</Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                    {entry.issuer || entry.account || "Authenticator entry"}
                    {entry.otpType === "hotp" ? ` · counter ${entry.counter}` : null}
                  </p>
                  {entry.error ? <p className="mt-1 text-[11.5px] text-danger">{entry.error}</p> : null}
                </div>

                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={() => void copy(entry.id, entry.code, "Code copied.")}
                    title="Copy code"
                    className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 font-mono text-[19px] tracking-[0.14em] tabular-nums transition-colors hover:bg-muted/70"
                  >
                    {entry.code.replace(/(\d{3})(?=\d)/g, "$1 ")}
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  {entry.otpType === "hotp" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void nextCounter(entry)}
                      title="Use this code and move to the next counter"
                    >
                      <RefreshCw className="h-3 w-3" /> Next
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-20 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear"
                          style={{ width: `${Math.round((1 - entry.progress) * 100)}%` }}
                        />
                      </div>
                      <span className="w-6 text-right text-[10.5px] tabular-nums text-muted-foreground">
                        {entry.remaining}s
                      </span>
                    </div>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Copy setup URI"
                  title="Copy setup URI for another authenticator"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      const exported = await backend.authenticatorExport(entry.id);
                      await copy(`${entry.id}:uri`, exported, "Setup URI copied.");
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "Could not export the entry");
                    }
                  }}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Delete entry"
                  disabled={busy}
                  onClick={() => void remove(entry.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </section>

        {copied ? <p className="mt-3 text-[11.5px] text-muted-foreground">Copied.</p> : null}
      </div>
    </div>
  );
}
