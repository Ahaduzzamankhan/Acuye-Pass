import { Copy, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useBackend } from "@/lib/backend-context";
import { useApp } from "@/lib/app-context";
import type {
  PassphraseOptions,
  PasswordOptions,
  PasswordStrength,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Dialog } from "./dialog";
import { Badge, Button, Field, Input, SegmentedControl, Switch } from "./ui";

const DEFAULT_PASSWORD: PasswordOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  exclude_chars: "",
};

const DEFAULT_PASSPHRASE: PassphraseOptions = {
  words: 6,
  separator: "-",
  capitalize: true,
  include_number: true,
};

export function GeneratorDialog({
  open,
  onOpenChange,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUse?: (value: string) => void;
}) {
  const backend = useBackend();
  const { showToast } = useApp();
  const [mode, setMode] = useState<"password" | "passphrase">("password");
  const [passwordOptions, setPasswordOptions] = useState(DEFAULT_PASSWORD);
  const [passphraseOptions, setPassphraseOptions] = useState(DEFAULT_PASSPHRASE);
  const [value, setValue] = useState("");
  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setError(null);
    try {
      const next =
        mode === "password"
          ? await backend.generatePassword(passwordOptions)
          : await backend.generatePassphrase(passphraseOptions);
      setValue(next);
      if (mode === "password") {
        setStrength(await backend.evaluatePassword(next));
      } else {
        setStrength(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate a secret");
    }
  }, [backend, mode, passphraseOptions, passwordOptions]);

  useEffect(() => {
    if (open) void generate();
  }, [open, generate]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      showToast({ title: "Generated secret copied", tone: "success" });
    } catch {
      showToast({ title: "Could not access the clipboard", tone: "error" });
    }
  };

  const scoreColors = ["bg-danger", "bg-danger", "bg-warning", "bg-success", "bg-success"];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Password generator"
      description="Generated locally with the operating system CSPRNG."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {onUse ? (
            <Button
              onClick={() => {
                onUse(value);
                onOpenChange(false);
              }}
              disabled={!value}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Use this
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <SegmentedControl
          ariaLabel="Generator mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "password", label: "Password" },
            { value: "passphrase", label: "Passphrase" },
          ]}
        />

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex items-start gap-2">
            <code className="min-h-[44px] flex-1 break-all font-mono text-[15px] leading-relaxed text-foreground">
              {value || "…"}
            </code>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="icon" onClick={() => void generate()} aria-label="Regenerate" title="Regenerate">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => void copy()} aria-label="Copy secret" title="Copy">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {mode === "password" && strength ? (
            <div className="mt-2.5 flex items-center gap-2">
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
              <span className="w-28 text-right text-[11px] text-muted-foreground">
                {strength.label} · {Math.round(strength.bits)} bits
              </span>
            </div>
          ) : null}
          {mode === "passphrase" ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {passphraseOptions.words} words from the EFF short wordlist · about{" "}
              {Math.round(passphraseOptions.words * Math.log2(1296))} bits of entropy
            </p>
          ) : null}
        </div>

        {error ? <p className="text-xs text-danger">{error}</p> : null}

        {mode === "password" ? (
          <div className="space-y-4">
            <Field label={`Length · ${passwordOptions.length} characters`} htmlFor="generator-length">
              <input
                id="generator-length"
                type="range"
                min={8}
                max={64}
                value={passwordOptions.length}
                onChange={(event) =>
                  setPasswordOptions({ ...passwordOptions, length: Number(event.target.value) })
                }
                className="w-full accent-[hsl(var(--accent))]"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2.5">
              <Switch
                id="opt-upper"
                label="Uppercase"
                checked={passwordOptions.uppercase}
                onCheckedChange={(checked) => setPasswordOptions({ ...passwordOptions, uppercase: checked })}
              />
              <Switch
                id="opt-lower"
                label="Lowercase"
                checked={passwordOptions.lowercase}
                onCheckedChange={(checked) => setPasswordOptions({ ...passwordOptions, lowercase: checked })}
              />
              <Switch
                id="opt-numbers"
                label="Numbers"
                checked={passwordOptions.numbers}
                onCheckedChange={(checked) => setPasswordOptions({ ...passwordOptions, numbers: checked })}
              />
              <Switch
                id="opt-symbols"
                label="Symbols"
                checked={passwordOptions.symbols}
                onCheckedChange={(checked) => setPasswordOptions({ ...passwordOptions, symbols: checked })}
              />
            </div>
            <Field
              label="Exclude characters"
              hint="Characters that must never appear, e.g. O0lI1"
              htmlFor="generator-exclude"
            >
              <Input
                id="generator-exclude"
                value={passwordOptions.exclude_chars}
                onChange={(event) =>
                  setPasswordOptions({ ...passwordOptions, exclude_chars: event.target.value })
                }
                placeholder="Optional"
                className="font-mono"
              />
            </Field>
            <Button variant="secondary" onClick={() => setPasswordOptions(DEFAULT_PASSWORD)} size="sm">
              <Wand2 className="h-3.5 w-3.5" />
              Reset options
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Words · ${passphraseOptions.words}`} htmlFor="generator-words">
                <input
                  id="generator-words"
                  type="range"
                  min={3}
                  max={12}
                  value={passphraseOptions.words}
                  onChange={(event) =>
                    setPassphraseOptions({ ...passphraseOptions, words: Number(event.target.value) })
                  }
                  className="w-full accent-[hsl(var(--accent))]"
                />
              </Field>
              <Field label="Separator" htmlFor="generator-separator">
                <Input
                  id="generator-separator"
                  value={passphraseOptions.separator}
                  maxLength={3}
                  onChange={(event) =>
                    setPassphraseOptions({ ...passphraseOptions, separator: event.target.value })
                  }
                  className="font-mono"
                />
              </Field>
            </div>
            <div className="flex items-center gap-5">
              <Switch
                id="passphrase-capitalize"
                label="Capitalize"
                checked={passphraseOptions.capitalize}
                onCheckedChange={(checked) => setPassphraseOptions({ ...passphraseOptions, capitalize: checked })}
              />
              <Switch
                id="passphrase-number"
                label="Append a number"
                checked={passphraseOptions.include_number}
                onCheckedChange={(checked) =>
                  setPassphraseOptions({ ...passphraseOptions, include_number: checked })
                }
              />
            </div>
            <Badge tone="muted">Wordlist bundled with the app · no network requests</Badge>
          </div>
        )}
      </div>
    </Dialog>
  );
}
