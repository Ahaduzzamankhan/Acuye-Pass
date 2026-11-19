import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useApp } from "@/lib/app-context";
import { useBackend } from "@/lib/backend-context";
import type { PasswordStrength } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button, Field, Input } from "@/components/ui";

const FEATURES = [
  {
    icon: Lock,
    title: "Encrypted on this device",
    body: "Argon2id derives your key; every item is sealed with XChaCha20-Poly1305.",
  },
  {
    icon: WifiOff,
    title: "No account, no telemetry",
    body: "Your vault never leaves the machine unless you explicitly export it.",
  },
  {
    icon: KeyRound,
    title: "You hold the only key",
    body: "There is no password reset and no recovery service. Keep your master password safe.",
  },
];

export function Onboarding() {
  const { createAccount, evaluatePassword, showToast } = useApp();
  const backend = useBackend();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await evaluatePassword(password);
      if (!cancelled) setStrength(result);
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [password, evaluatePassword]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await createAccount(username, password);
      showToast({ title: "Vault created", description: "Your encrypted vault is ready.", tone: "success" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the vault");
    } finally {
      setLoading(false);
    }
  };

  const scoreColors = ["bg-danger", "bg-danger", "bg-warning", "bg-success", "bg-success"];

  return (
    <div className="flex h-full bg-background">
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-[hsl(var(--sidebar))] p-10 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(110% 70% at 0% 0%, hsl(var(--accent) / 0.40), transparent 60%), radial-gradient(90% 70% at 100% 100%, hsl(var(--accent) / 0.18), transparent 65%)",
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-white/10 backdrop-blur">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-[15px] font-semibold text-white">Acuye Pass</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">by Fluxenite</p>
            </div>
          </div>
          <h1 className="mt-16 max-w-md text-[34px] font-semibold leading-[1.15] tracking-[-0.03em] text-white">
            Your passwords.
            <br />
            Your device.
            <br />
            <span className="text-white/55">Nobody else.</span>
          </h1>
          <p className="mt-4 max-w-sm text-[13.5px] leading-relaxed text-white/60">
            A local-first password manager built for Windows. No cloud account, no subscription,
            no telemetry — just strong cryptography you control.
          </p>
        </div>
        <div className="relative space-y-4">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="flex gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-white/80">
                <feature.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[12.5px] font-medium text-white/90">{feature.title}</p>
                <p className="mt-0.5 max-w-xs text-[11.5px] leading-relaxed text-white/45">{feature.body}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="relative text-[10.5px] text-white/30">
          Open source · MIT licensed · Not audited — see SECURITY.md
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <motion.form
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          onSubmit={submit}
          className="w-full max-w-[400px]"
        >
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <span className="text-[14px] font-semibold">Acuye Pass</span>
          </div>

          <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
            <Sparkles className="h-3 w-3" />
            First launch
          </div>
          <h2 className="mt-3 text-[24px] font-semibold tracking-[-0.02em]">Create your vault</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Choose an account name and a strong master password. This password is the only way to
            unlock your vault.
          </p>

          <div className="mt-6 space-y-4">
            <Field label="Account name" htmlFor="onboarding-username" hint="Used only to identify this local account.">
              <Input
                id="onboarding-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="e.g. ada"
                autoComplete="username"
                autoFocus
                maxLength={64}
                required
              />
            </Field>

            <Field label="Master password" htmlFor="onboarding-password">
              <div className="relative">
                <Input
                  id="onboarding-password"
                  type={reveal ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 12 characters recommended"
                  autoComplete="new-password"
                  className="pr-10"
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
              <AnimatePresence initial={false}>
                {password && strength ? (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-1.5 overflow-hidden pt-1"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex flex-1 gap-1">
                        {[0, 1, 2, 3, 4].map((segment) => (
                          <div
                            key={segment}
                            className={cn(
                              "h-1 flex-1 rounded-full",
                              segment <= strength.score ? scoreColors[strength.score] : "bg-muted-foreground/20",
                            )}
                          />
                        ))}
                      </div>
                      <span className="text-[10.5px] text-muted-foreground">
                        {strength.label} · {Math.round(strength.bits)} bits
                      </span>
                    </div>
                    {strength.feedback.length > 0 ? (
                      <p className="text-[10.5px] text-muted-foreground">{strength.feedback[0]}</p>
                    ) : null}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </Field>

            <Field label="Confirm master password" htmlFor="onboarding-confirm">
              <Input
                id="onboarding-confirm"
                type={reveal ? "text" : "password"}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Repeat the master password"
                autoComplete="new-password"
                required
              />
            </Field>

            {error ? (
              <p className="rounded-md bg-danger/10 px-3 py-2 text-[12.5px] text-danger" role="alert">
                {error}
              </p>
            ) : null}

            <div className="rounded-lg border border-warning/30 bg-warning/[0.07] px-3 py-2.5">
              <p className="text-[11.5px] leading-relaxed text-warning">
                Acuye Pass cannot recover a lost master password. There is no reset, no recovery
                key and no server-side copy. Store it in a safe place.
              </p>
            </div>

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              Create encrypted vault
              <ArrowRight className="h-4 w-4" />
            </Button>

            <p className="text-center text-[10.5px] text-muted-foreground">
              {backend.kind === "tauri"
                ? "Key derivation runs locally with Argon2id."
                : "Browser preview: data is stored unencrypted in this preview only."}
            </p>
          </div>
        </motion.form>
      </div>
    </div>
  );
}
