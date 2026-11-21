import { motion } from "motion/react";
import { Check, Eye, EyeOff, HelpCircle, Plus, ShieldCheck, Unlock as UnlockIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useApp } from "@/lib/app-context";
import { useBackend } from "@/lib/backend-context";
import { cn, initials } from "@/lib/utils";
import { Dialog } from "@/components/dialog";
import { Button, Field, Input } from "@/components/ui";

export function Unlock() {
  const { status, accounts, authMode, setAuthMode, unlock, addAccount, showToast } = useApp();
  const backend = useBackend();
  const adding = authMode === "add";
  const [selectedVault, setSelectedVault] = useState<string | null>(accounts[0]?.vault_id ?? null);
  const [username, setUsername] = useState(status?.username ?? "");
  const [vaultName, setVaultName] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (!selectedVault && accounts.length > 0) setSelectedVault(accounts[0].vault_id);
  }, [accounts, selectedVault]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (adding) {
        await addAccount(username, password, vaultName);
        showToast({ title: "Account added", description: "The new vault is open.", tone: "success" });
      } else {
        await unlock(accounts.length > 0 ? selectedVault : null, username, password);
        showToast({ title: "Vault unlocked", tone: "success" });
      }
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed");
      setPassword("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface/60 px-3">
        <ShieldCheck className="h-3.5 w-3.5 text-accent" />
        <span className="text-[11.5px] font-medium text-muted-foreground">Acuye Pass · Locked</span>
        {backend.kind === "preview" ? (
          <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
            Browser preview
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
          className="w-full max-w-[360px]"
        >
          <div className="flex flex-col items-center text-center">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent/50 shadow-lg shadow-accent/20">
              <ShieldCheck className="h-8 w-8 text-white" />
              <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-surface">
                <UnlockIcon className="h-3 w-3 text-muted-foreground" />
              </span>
            </div>
            <h1 className="mt-5 text-[21px] font-semibold tracking-[-0.02em]">
              {adding ? "Add an account" : "Unlock your vault"}
            </h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {adding
                ? "A new vault with its own master password, in the same encrypted database."
                : "Your master password decrypts everything locally."}
            </p>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-3.5">
            {!adding && accounts.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Account
                </p>
                {accounts.map((account) => {
                  const selected = account.vault_id === selectedVault;
                  return (
                    <button
                      key={account.vault_id}
                      type="button"
                      onClick={() => setSelectedVault(account.vault_id)}
                      aria-pressed={selected}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                        selected ? "border-accent/60 bg-accent/10" : "border-border hover:bg-muted/40",
                      )}
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">
                        {initials(account.username)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium">
                          {account.username}
                        </span>
                        <span className="block truncate text-[10.5px] text-muted-foreground">
                          {account.vault_name}
                        </span>
                      </span>
                      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {adding || accounts.length === 0 ? (
              <Field label={adding ? "Account name" : "Account"} htmlFor="unlock-username">
                <Input
                  id="unlock-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  required
                />
              </Field>
            ) : null}

            {adding ? (
              <Field label="Vault name (optional)" htmlFor="unlock-vault-name">
                <Input
                  id="unlock-vault-name"
                  value={vaultName}
                  onChange={(event) => setVaultName(event.target.value)}
                  placeholder="Personal"
                  maxLength={64}
                />
              </Field>
            ) : null}

            <Field label="Master password" htmlFor="unlock-password">
              <div className="relative">
                <Input
                  id="unlock-password"
                  type={reveal ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={adding ? "new-password" : "current-password"}
                  className="pr-10"
                  autoFocus
                  required
                />
                <button
                  type="button"
                  onClick={() => setReveal((current) => !current)}
                  aria-label={reveal ? "Hide password" : "Show password"}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            {error ? (
              <motion.p
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-md bg-danger/10 px-3 py-2 text-[12.5px] text-danger"
                role="alert"
              >
                {error}
              </motion.p>
            ) : null}

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              {adding ? <Plus className="h-4 w-4" /> : <UnlockIcon className="h-4 w-4" />}
              {adding ? "Create account" : "Unlock"}
            </Button>
          </form>

          {adding ? (
            accounts.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setPassword("");
                  setAuthMode("unlock");
                }}
                className="mx-auto mt-4 block text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Back to unlock
              </button>
            ) : null
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setPassword("");
                setAuthMode("add");
              }}
              className="mx-auto mt-4 flex items-center gap-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Plus className="h-3 w-3" />
              Add another account
            </button>
          )}

          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="mx-auto mt-3 flex items-center gap-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <HelpCircle className="h-3 w-3" />
            Forgot your master password?
          </button>

          <p className="mt-6 text-center text-[10.5px] text-muted-foreground/70">
            Local only · No cloud account
          </p>
        </motion.div>
      </div>

      <Dialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="There is no password reset"
        description="Your master password derives the only key that can decrypt this vault."
        size="sm"
        footer={<Button onClick={() => setHelpOpen(false)}>I understand</Button>}
      >
        <div className="space-y-3 text-[12.5px] leading-relaxed text-muted-foreground">
          <p>
            Acuye Pass stores no plaintext password, no recovery key and no server-side copy of
            your vault. If the master password is lost, the encrypted data cannot be decrypted —
            by us or by anyone else.
          </p>
          <p>
            Other accounts in the same database keep working: each vault has its own master
            password, so losing one does not lock you out of the others.
          </p>
          <p>
            If you have an encrypted backup and remember an older master password, restore the
            backup from Settings → Data &amp; Storage and unlock with that older password.
          </p>
          <p className="text-foreground/80">
            This is a deliberate security property, not a limitation we can bypass.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
