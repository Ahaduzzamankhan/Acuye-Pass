import { Database, HardDrive, Lock, Pencil, ShieldCheck, Vault } from "lucide-react";
import { useEffect, useState } from "react";

import { useApp } from "@/lib/app-context";
import { useBackend } from "@/lib/backend-context";
import type { BackupInfo, StorageInfo } from "@/lib/types";
import { formatBytes, relativeTime } from "@/lib/utils";
import { Dialog } from "@/components/dialog";
import { Badge, Button, Field, Input } from "@/components/ui";

export function VaultsPage() {
  const backend = useBackend();
  const { session, counts, lock, renameVault, showToast } = useApp();
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(session?.vaultName ?? "Personal");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([backend.storageInfo(), backend.listBackups()])
      .then(([info, list]) => {
        if (!cancelled) {
          setStorage(info);
          setBackups(list);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [backend]);

  const createBackup = async () => {
    setCreating(true);
    try {
      const backup = await backend.createBackup();
      setBackups((current) => [backup, ...current]);
      showToast({ title: "Encrypted backup created", description: backup.path, tone: "success" });
    } catch (cause) {
      showToast({
        title: "Could not create a backup",
        description: cause instanceof Error ? cause.message : undefined,
        tone: "error",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Vaults</h1>
        <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
          Acuye Pass stores one encrypted local vault in this phase. Additional vaults and
          bring-your-own-backend sync are prepared in the Rust architecture but not enabled.
        </p>

        <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex items-start gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Vault className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold">{session?.vaultName ?? "Personal"}</h2>
                <Badge tone="success">Unlocked</Badge>
                <Badge tone="muted">Local</Badge>
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {counts.total} items · {counts.logins} passwords · {counts.notes} notes ·{" "}
                {counts.favorites} favorites
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3 w-3 text-success" />
                Argon2id key derivation · XChaCha20-Poly1305 item encryption
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => { setName(session?.vaultName ?? "Personal"); setRenameOpen(true); }}>
                <Pencil className="h-3.5 w-3.5" />
                Rename
              </Button>
              <Button variant="outline" size="sm" onClick={() => void lock("Vault locked.")}>
                <Lock className="h-3.5 w-3.5" />
                Lock
              </Button>
            </div>
          </div>
          <div className="grid gap-3 border-t border-border/70 bg-muted/20 px-5 py-3 sm:grid-cols-3">
            <div>
              <p className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Encrypted database</p>
              <p className="mt-1 flex items-center gap-1.5 text-[12px]">
                <Database className="h-3 w-3" />
                {storage ? formatBytes(storage.databaseSize) : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Integrity</p>
              <p className="mt-1 flex items-center gap-1.5 text-[12px]">
                <ShieldCheck className="h-3 w-3 text-success" />
                {storage?.integrityOk ? "Verified" : "Unknown"}
              </p>
            </div>
            <div>
              <p className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Schema</p>
              <p className="mt-1 text-[12px]">v{storage?.schemaVersion ?? "—"}</p>
            </div>
          </div>
        </section>

        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold">Encrypted backups</h2>
            <Button variant="secondary" size="sm" onClick={() => void createBackup()} loading={creating}>
              <HardDrive className="h-3.5 w-3.5" />
              Back up now
            </Button>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            {backups.length === 0 ? (
              <p className="px-4 py-6 text-[12px] text-muted-foreground">
                No backups yet. Backups are copies of the encrypted database, so they remain
                unreadable without your master password.
              </p>
            ) : (
              <ul className="divide-y divide-border/70">
                {backups.slice(0, 6).map((backup) => (
                  <li key={backup.name} className="flex items-center gap-3 px-4 py-2.5">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">{backup.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatBytes(backup.size)} · {relativeTime(backup.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Restore and storage management live in Settings → Data &amp; Storage.
          </p>
        </section>
      </div>

      <Dialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename vault"
        description="The vault name is stored as metadata; item encryption is unchanged."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button
              loading={saving}
              onClick={async () => {
                setSaving(true);
                const ok = await renameVault(name);
                setSaving(false);
                if (ok) setRenameOpen(false);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Vault name" htmlFor="vault-name">
          <Input id="vault-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={64} />
        </Field>
      </Dialog>
    </div>
  );
}
