import { Copy, KeyRound, Plus, ScanLine, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { QrScanner } from "@/components/QrScanner";
import { Badge, Button, Input, Spinner } from "@/components/ui";
import { useBackend } from "@/lib/backend-context";
import type { TotpEntry } from "@/lib/types";

export function AuthenticatorPage() {
  const backend = useBackend();
  const [entries, setEntries] = useState<TotpEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [setupUri, setSetupUri] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
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

  const add = async (uri: string) => {
    if (!uri.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await backend.authenticatorAdd(uri.trim());
      setSetupUri("");
      setScanning(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That setup code could not be added");
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async (entry: TotpEntry) => {
    try {
      await navigator.clipboard.writeText(entry.code);
      setCopied(entry.id);
      window.setTimeout(() => setCopied((current) => (current === entry.id ? null : current)), 1500);
    } catch {
      setError("The clipboard is not available");
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await backend.deleteItem(id);
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
        <header>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Authenticator</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
            Two-factor codes are generated on this device from secrets stored in your encrypted
            vault. Nothing is sent anywhere, and codes work offline.
          </p>
        </header>

        <section className="mt-6 rounded-xl border border-border bg-surface p-4">
          <p className="text-[13px] font-medium">Add an account</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            Paste the <span className="font-mono">otpauth://</span> setup code, or scan it from the
            service's setup page.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              value={setupUri}
              onChange={(event) => setSetupUri(event.target.value)}
              placeholder="otpauth://totp/Issuer:you@example.com?secret=…"
              className="min-w-[260px] flex-1 font-mono text-[12px]"
              spellCheck={false}
            />
            <Button size="sm" disabled={busy || !setupUri.trim()} onClick={() => void add(setupUri)}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setScanning((value) => !value)}>
              <ScanLine className="h-3.5 w-3.5" /> Scan QR
            </Button>
          </div>
          {scanning ? (
            <div className="mt-3">
              <QrScanner onDecode={(text) => void add(text)} onClose={() => setScanning(false)} />
            </div>
          ) : null}
          {error ? <p className="mt-2 text-[12px] text-danger">{error}</p> : null}
        </section>

        <section className="mt-4 space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 px-1 py-6 text-[12px] text-muted-foreground">
              <Spinner /> Loading authenticator entries…
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <KeyRound className="h-6 w-6 text-muted-foreground" />
              <p className="text-[13px] font-medium">No authenticator entries yet</p>
              <p className="max-w-sm text-[11.5px] leading-relaxed text-muted-foreground">
                Add a setup code above. Seeded secrets are encrypted in your vault like any other
                item.
              </p>
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] font-medium">{entry.title}</p>
                    {entry.algorithm !== "sha1" ? <Badge tone="muted">{entry.algorithm.toUpperCase()}</Badge> : null}
                    {entry.period !== 30 ? <Badge tone="muted">{entry.period}s</Badge> : null}
                  </div>
                  <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                    {entry.issuer || entry.account || "Authenticator entry"}
                  </p>
                  {entry.error ? <p className="mt-1 text-[11.5px] text-danger">{entry.error}</p> : null}
                </div>

                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={() => void copyCode(entry)}
                    title="Copy code"
                    className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 font-mono text-[19px] tracking-[0.14em] tabular-nums transition-colors hover:bg-muted/70"
                  >
                    {entry.code.replace(/(\d{3})(?=\d)/, "$1 ")}
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-20 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear"
                        style={{ width: `${Math.round((entry.remaining / entry.period) * 100)}%` }}
                      />
                    </div>
                    <span className="w-6 text-right text-[10.5px] tabular-nums text-muted-foreground">
                      {entry.remaining}s
                    </span>
                  </div>
                </div>

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

        {copied ? (
          <p className="mt-3 text-[11.5px] text-muted-foreground">
            Code copied. It stays valid for {entries.find((entry) => entry.id === copied)?.remaining ?? 0}s.
          </p>
        ) : null}
      </div>
    </div>
  );
}
