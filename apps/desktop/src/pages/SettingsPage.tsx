import { motion } from "motion/react";
import {
  ArrowUpRight,
  Check,
  DownloadCloud,
  Database,
  Eye,
  EyeOff,
  FileUp,
  Globe,
  HardDrive,
  Info,
  Keyboard,
  KeyRound,
  Laptop,
  MonitorSmartphone,
  Palette,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  WifiOff,
  Lock,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useApp } from "@/lib/app-context";
import { useBackend } from "@/lib/backend-context";
import type {
  AppSettings,
  BackupInfo,
  DeviceView,
  ParsedImport,
  PasswordStrength,
  ReleaseChannel,
  StorageInfo,
  SyncProviderConfig,
  ThemeColor,
  UpdateStatusView,
} from "@/lib/types";
import { cn, formatBytes, formatDate, relativeTime, secondsLabel } from "@/lib/utils";
import { ConfirmDialog, Dialog } from "@/components/dialog";
import {
  Badge,
  Button,
  Field,
  Input,
  Kbd,
  Progress,
  SegmentedControl,
  Select,
  Switch,
} from "@/components/ui";

const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "vault-security", label: "Vault Security", icon: ShieldCheck },
  { id: "authentication", label: "Authentication", icon: KeyRound },
  { id: "devices", label: "Devices", icon: MonitorSmartphone },
  { id: "privacy", label: "Privacy Center", icon: EyeOff },
  { id: "network", label: "Network", icon: Globe },
  { id: "sync", label: "Sync Providers", icon: RefreshCw },
  { id: "storage", label: "Data & Storage", icon: Database },
  { id: "transfer", label: "Import & Export", icon: Upload },
  { id: "shortcuts", label: "Keyboard Shortcuts", icon: Keyboard },
  { id: "updates", label: "Updates", icon: DownloadCloud },
  { id: "about", label: "About Acuye Pass", icon: Info },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsPage() {
  const params = useParams<{ section?: string }>();
  const active = (SECTIONS.find((section) => section.id === params.section)?.id ?? "appearance") as SectionId;

  return (
    <div className="flex min-h-0 flex-1 bg-background">
      <nav className="w-[220px] shrink-0 overflow-y-auto border-r border-border bg-surface/40 px-2.5 py-4" aria-label="Settings">
        <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Settings
        </p>
        <ul className="space-y-0.5">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <Link
                to={`/settings/${section.id}`}
                aria-current={active === section.id ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] font-medium transition-colors",
                  active === section.id
                    ? "bg-accent-soft text-accent"
                    : "text-foreground/75 hover:bg-muted/70 hover:text-foreground",
                )}
              >
                <section.icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{section.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
          className="mx-auto w-full max-w-[720px] px-8 py-8"
        >
          {active === "appearance" ? <AppearanceSection /> : null}
          {active === "preferences" ? <PreferencesSection /> : null}
          {active === "vault-security" ? <VaultSecuritySection /> : null}
          {active === "authentication" ? <AuthenticationSection /> : null}
          {active === "devices" ? <DevicesSection /> : null}
          {active === "privacy" ? <PrivacySection /> : null}
          {active === "network" ? <NetworkSection /> : null}
          {active === "sync" ? <SyncSection /> : null}
          {active === "storage" ? <StorageSection /> : null}
          {active === "transfer" ? <TransferSection /> : null}
          {active === "shortcuts" ? <ShortcutsSection /> : null}
          {active === "updates" ? <UpdatesSection /> : null}
          {active === "about" ? <AboutSection /> : null}
        </motion.div>
      </div>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-5">
      <h1 className="text-[21px] font-semibold tracking-[-0.02em]">{title}</h1>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>
    </header>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-xl border border-border bg-surface", className)}>{children}</section>;
}

function Row({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-4 px-4 py-3.5", className)}>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{title}</p>
        {description ? (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function AppearanceSection() {
  const { settings, saveSettings } = useApp();
  const themes: Array<{ id: ThemeColor; label: string; swatch: string }> = [
    { id: "blue", label: "Blue", swatch: "hsl(221 83% 53%)" },
    { id: "white", label: "White", swatch: "hsl(220 12% 26%)" },
    { id: "red", label: "Red", swatch: "hsl(355 74% 47%)" },
    { id: "green", label: "Green", swatch: "hsl(158 74% 31%)" },
    { id: "yellow", label: "Yellow", swatch: "hsl(36 92% 34%)" },
    { id: "monochrome", label: "Mono", swatch: "hsl(220 8% 32%)" },
  ];

  return (
    <>
      <SectionHeading
        title="Appearance"
        description="Accent colour and light/dark mode are independent and apply immediately."
      />
      <Card>
        <div className="border-b border-border/70 px-4 py-3">
          <p className="text-[13px] font-medium">Accent colour</p>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {themes.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => void saveSettings({ theme_color: theme.id })}
                aria-pressed={settings.theme_color === theme.id}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-all",
                  settings.theme_color === theme.id
                    ? "border-accent bg-accent-soft/60"
                    : "border-border hover:border-muted-foreground/30",
                )}
              >
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full shadow-inner"
                  style={{ background: theme.swatch }}
                >
                  {settings.theme_color === theme.id ? <Check className="h-3.5 w-3.5 text-white" /> : null}
                </span>
                <span className="text-[10.5px] font-medium">{theme.label}</span>
              </button>
            ))}
          </div>
        </div>
        <Row title="Appearance mode" description="Follow Windows or force light or dark.">
          <SegmentedControl
            ariaLabel="Appearance mode"
            value={settings.appearance_mode}
            onChange={(value) => void saveSettings({ appearance_mode: value })}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
          />
        </Row>
        <Row title="Reduce motion" description="Disable sidebar, page and dialog animations." className="border-t border-border/70">
          <Switch
            id="reduce-motion"
            checked={settings.reduce_motion}
            onCheckedChange={(checked) => void saveSettings({ reduce_motion: checked })}
          />
        </Row>
        <Row title="Compact density" description="Tighter rows in the item list." className="border-t border-border/70">
          <Switch
            id="compact-density"
            checked={settings.density_compact}
            onCheckedChange={(checked) => void saveSettings({ density_compact: checked })}
          />
        </Row>
      </Card>
    </>
  );
}

function PreferencesSection() {
  const { settings, saveSettings } = useApp();
  return (
    <>
      <SectionHeading
        title="Preferences"
        description="Session and clipboard behaviour. These settings are stored locally."
      />
      <Card>
        <Row title="Auto-lock" description="Lock the vault after this much inactivity. Enforced in Rust as well as the UI.">
          <Select
            aria-label="Auto-lock timeout"
            className="w-[150px]"
            value={String(settings.auto_lock_secs)}
            onChange={(event) => void saveSettings({ auto_lock_secs: Number(event.target.value) })}
          >
            <option value="60">1 minute</option>
            <option value="300">5 minutes</option>
            <option value="600">10 minutes</option>
            <option value="1800">30 minutes</option>
            <option value="3600">1 hour</option>
            <option value="0">Never</option>
          </Select>
        </Row>
        <Row title="Clear clipboard" description="Copied secrets are cleared after this delay." className="border-t border-border/70">
          <Select
            aria-label="Clipboard clear timeout"
            className="w-[150px]"
            value={String(settings.clipboard_clear_secs)}
            onChange={(event) => void saveSettings({ clipboard_clear_secs: Number(event.target.value) })}
          >
            <option value="10">10 seconds</option>
            <option value="30">30 seconds</option>
            <option value="60">1 minute</option>
            <option value="120">2 minutes</option>
            <option value="0">Never</option>
          </Select>
        </Row>
        <Row title="Confirm before deleting" description="Ask for confirmation before an item is removed." className="border-t border-border/70">
          <Switch
            id="confirm-delete"
            checked={settings.confirm_delete}
            onCheckedChange={(checked) => void saveSettings({ confirm_delete: checked })}
          />
        </Row>
        <Row title="Website favicons" description="Fetch a site's favicon on demand when you open an item. No third-party service." className="border-t border-border/70">
          <Switch
            id="favicon-enabled"
            checked={settings.favicon_enabled}
            onCheckedChange={(checked) => void saveSettings({ favicon_enabled: checked })}
          />
        </Row>
        <Row title="Keyboard shortcuts" description="Ctrl+K opens the command palette; Ctrl+N, Ctrl+L, Ctrl+G and Ctrl+," className="border-t border-border/70">
          <Switch
            id="shortcuts-enabled"
            checked={settings.shortcuts_enabled}
            onCheckedChange={(checked) => void saveSettings({ shortcuts_enabled: checked })}
          />
        </Row>
      </Card>
    </>
  );
}

function usePasswordStrength(password: string) {
  const { evaluatePassword } = useApp();
  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!password) {
      setStrength(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      const result = await evaluatePassword(password);
      if (!cancelled) setStrength(result);
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [password, evaluatePassword]);
  return strength;
}

function ChangePasswordForm() {
  const { changeMasterPassword, showToast } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const strength = usePasswordStrength(next);
  const scoreColors = ["bg-danger", "bg-danger", "bg-warning", "bg-success", "bg-success"];

  const submit = async () => {
    setError(null);
    if (next !== confirm) {
      setError("The new passwords do not match");
      return;
    }
    setSaving(true);
    try {
      await changeMasterPassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the master password");
      showToast({ title: "Password change failed", tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-4">
      <Field label="Current master password" htmlFor="current-password">
        <Input
          id="current-password"
          type="password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="New master password" htmlFor="new-password">
          <Input
            id="new-password"
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm-password">
          <Input
            id="confirm-password"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
          />
        </Field>
      </div>
      {strength && next ? (
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
          <span className="text-[11px] text-muted-foreground">
            {strength.label} · {Math.round(strength.bits)} bits
          </span>
        </div>
      ) : null}
      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Rotates the KDF salt, the password-derived keys and the vault key. Every item is
          re-encrypted in one transaction.
        </p>
        <Button onClick={() => void submit()} loading={saving} disabled={!current || !next || !confirm}>
          Change password
        </Button>
      </div>
    </div>
  );
}

function VaultSecuritySection() {
  const backend = useBackend();
  const { report, status, showToast } = useApp();
  const [backingUp, setBackingUp] = useState(false);

  const backup = async () => {
    setBackingUp(true);
    try {
      const created = await backend.createBackup();
      showToast({ title: "Encrypted backup created", description: created.path, tone: "success" });
    } catch (cause) {
      showToast({
        title: "Could not create a backup",
        description: cause instanceof Error ? cause.message : undefined,
        tone: "error",
      });
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <>
      <SectionHeading
        title="Vault Security"
        description="Encryption parameters and master password rotation."
      />
      <Card className="mb-4">
        <div className="grid grid-cols-3 divide-x divide-border/70">
          <div className="px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Score</p>
            <p className="mt-1 text-[20px] font-semibold tabular-nums">{report?.score ?? "—"}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Weak</p>
            <p className="mt-1 text-[20px] font-semibold tabular-nums">{report?.weak ?? 0}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Reused</p>
            <p className="mt-1 text-[20px] font-semibold tabular-nums">{report?.reused ?? 0}</p>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border/70 px-4 py-2.5">
          <p className="text-[11px] text-muted-foreground">Analysis is local; nothing is uploaded.</p>
          <Link to="/security" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent">
            Open Security Center <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between px-4 pt-3.5">
          <div>
            <p className="text-[13px] font-medium">Encryption</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Argon2id · {status ? `${Math.round(status.kdfMemoryKib / 1024)} MiB, ${status.kdfIterations} iterations` : "…"} · XChaCha20-Poly1305
            </p>
          </div>
          <Badge tone="success">Active</Badge>
        </div>
        <Row title="Create encrypted backup" description="A verified copy of the encrypted database." className="mt-2 border-t border-border/70">
          <Button variant="secondary" size="sm" onClick={() => void backup()} loading={backingUp}>
            Back up now
          </Button>
        </Row>
      </Card>

      <Card className="mt-4">
        <div className="px-4 pt-3.5">
          <p className="text-[13px] font-medium">Change master password</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            You need the current password. There is no recovery path if it is lost.
          </p>
        </div>
        <ChangePasswordForm />
      </Card>
    </>
  );
}

function AuthenticationSection() {
  const backend = useBackend();
  const { status, settings, logout } = useApp();
  const [account, setAccount] = useState<{ created_at: number; username: string } | null>(null);

  useEffect(() => {
    void backend
      .getAccount()
      .then((value) => setAccount(value ? { created_at: value.created_at, username: value.username } : null))
      .catch(() => undefined);
  }, [backend]);

  return (
    <>
      <SectionHeading
        title="Authentication"
        description="Username + master password only. Acuye Pass has no biometric unlock by design."
      />
      <Card>
        <Row title="Account" description={`Created ${formatDate(account?.created_at ?? null)}`}>
          <span className="text-[12.5px] font-medium">{account?.username ?? status?.username ?? "—"}</span>
        </Row>
        <Row title="Auto-lock" description="Idle timeout enforced by the Rust backend." className="border-t border-border/70">
          <span className="text-[12.5px]">{secondsLabel(settings.auto_lock_secs)}</span>
        </Row>
        <Row title="Biometric unlock" description="Not implemented and not planned for this build." className="border-t border-border/70">
          <Badge tone="muted">Unavailable</Badge>
        </Row>
        <Row title="Password recovery" description="No reset, no recovery key, no server copy." className="border-t border-border/70">
          <Badge tone="warning">Impossible by design</Badge>
        </Row>
        <Row title="Sign out" description="Drops the in-memory vault key and returns to the unlock screen." className="border-t border-border/70">
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            <Lock className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </Row>
      </Card>
      <Card className="mt-4">
        <div className="px-4 pt-3.5">
          <p className="text-[13px] font-medium">Change master password</p>
        </div>
        <ChangePasswordForm />
      </Card>
    </>
  );
}

function DevicesSection() {
  const backend = useBackend();
  const { showToast } = useApp();
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setDevices(await backend.listDevices());
    } catch {
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, [backend]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <SectionHeading
        title="Devices"
        description="Devices known to this vault. Sync is not enabled in this phase, so there are no remote devices yet."
      />
      <Card>
        {loading ? (
          <p className="px-4 py-6 text-[12px] text-muted-foreground">Loading devices…</p>
        ) : devices.length === 0 ? (
          <p className="px-4 py-6 text-[12px] text-muted-foreground">No devices recorded.</p>
        ) : (
          <ul className="divide-y divide-border/70">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  {device.platform === "windows" ? <Laptop className="h-4 w-4" /> : <MonitorSmartphone className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-[13px] font-medium">{device.name}</p>
                    {device.current ? <Badge tone="accent">This device</Badge> : null}
                    {device.revoked ? <Badge tone="danger">Revoked</Badge> : null}
                    {device.syncRegistered ? <Badge tone="muted">Sync</Badge> : null}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {device.platform} · last seen {relativeTime(device.lastSeenAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={device.current || device.revoked}
                  onClick={async () => {
                    try {
                      await backend.revokeDevice(device.id);
                      await load();
                      showToast({ title: "Device revoked", tone: "success" });
                    } catch (cause) {
                      showToast({
                        title: "Could not revoke the device",
                        description: cause instanceof Error ? cause.message : undefined,
                        tone: "error",
                      });
                    }
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Device revocation only becomes meaningful once a bring-your-own-backend sync transport is
        implemented. The protocol messages for registration and revocation already exist in
        <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[10.5px]">acuye-protocol</code>.
      </p>
    </>
  );
}

function PrivacySection() {
  const backend = useBackend();
  const { settings, saveSettings, showToast } = useApp();

  return (
    <>
      <SectionHeading
        title="Privacy Center"
        description="Acuye Pass is local-first. Telemetry and analytics are not implemented in this build, not merely switched off."
      />
      <Card>
        <Row title="Telemetry" description="No telemetry endpoint exists in this build. The setting is rejected by the backend.">
          <Badge tone="success">Off · not implemented</Badge>
        </Row>
        <Row title="Analytics" description="No analytics SDK, no identifiers, no crash reporting." className="border-t border-border/70">
          <Badge tone="success">None</Badge>
        </Row>
        <Row title="Website favicons" description="Fetched on demand from the item's own site, then cached locally." className="border-t border-border/70">
          <Switch
            id="privacy-favicon"
            checked={settings.favicon_enabled}
            onCheckedChange={(checked) => void saveSettings({ favicon_enabled: checked })}
          />
        </Row>
        <Row title="Clipboard clearing" description="Copied secrets are removed automatically." className="border-t border-border/70">
          <span className="text-[12.5px]">{settings.clipboard_clear_secs === 0 ? "Disabled" : `${settings.clipboard_clear_secs}s`}</span>
        </Row>
        <Row title="Vault database" description="Only ciphertext, salts, verifiers and settings are stored." className="border-t border-border/70">
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              try {
                await backend.openDataFolder();
              } catch {
                showToast({ title: "Available in the desktop app", tone: "info" });
              }
            }}
          >
            <HardDrive className="h-3.5 w-3.5" />
            Open folder
          </Button>
        </Row>
      </Card>
      <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4">
        <p className="flex items-center gap-1.5 text-[12px] font-medium">
          <WifiOff className="h-3.5 w-3.5" /> What leaves this device
        </p>
        <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          <li>· Update checks to api.github.com when you allow them.</li>
          <li>· A favicon request to the item's own website when enabled.</li>
          <li>· Nothing else. Vault contents, passwords and usage data stay local.</li>
        </ul>
      </div>
    </>
  );
}

function NetworkSection() {
  const { settings, saveSettings } = useApp();
  return (
    <>
      <SectionHeading
        title="Network"
        description="Every outbound request is narrowly scoped. There is no background telemetry and no proxying."
      />
      <Card>
        <Row title="Favicon retrieval" description="HTTPS only, public hosts only, no redirects, 256 KB limit, raster formats only.">
          <Switch
            id="network-favicon"
            checked={settings.favicon_enabled}
            onCheckedChange={(checked) => void saveSettings({ favicon_enabled: checked })}
          />
        </Row>
        <Row title="Update discovery" description="Official repository only: Ahaduzzamankhan/Acuye-Pass." className="border-t border-border/70">
          <Badge tone="accent">api.github.com</Badge>
        </Row>
        <Row title="Update downloads" description="Download URLs must live under the official release path and match an installer asset." className="border-t border-border/70">
          <Badge tone="accent">github.com</Badge>
        </Row>
        <Row title="Auto-check for updates" description="Checks at most once every six hours when you open the Updates section." className="border-t border-border/70">
          <Switch
            id="network-auto-check"
            checked={settings.update_auto_check}
            onCheckedChange={(checked) => void saveSettings({ update_auto_check: checked })}
          />
        </Row>
        <Row title="Sync traffic" description="None. No provider is contacted while sync is disabled." className="border-t border-border/70">
          <Badge tone="muted">Disabled</Badge>
        </Row>
      </Card>
      <div className="mt-4 flex gap-3 rounded-xl border border-border bg-surface p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Acuye Pass blocks favicon requests that resolve to loopback, link-local, private or
          otherwise special-purpose addresses to prevent SSRF. Redirects are not followed.
        </p>
      </div>
    </>
  );
}

function SyncSection() {
  const { settings, saveSettings, showToast } = useApp();
  const existing = settings.sync_provider;
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? "");
  const [deviceName, setDeviceName] = useState(existing?.device_name ?? "");
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const config: SyncProviderConfig | null =
      endpoint.trim() === ""
        ? null
        : { endpoint: endpoint.trim(), device_name: deviceName.trim(), enabled };
    if (config && enabled && !config.endpoint.startsWith("https://")) {
      setError("Sync endpoints must use HTTPS");
      return;
    }
    setSaving(true);
    const ok = await saveSettings({ sync_provider: config });
    setSaving(false);
    if (ok) showToast({ title: "Sync provider saved", description: "No data has been transmitted.", tone: "success" });
  };

  return (
    <>
      <SectionHeading
        title="Sync Providers"
        description="Bring your own backend. Acuye Pass will never require Fluxenite-hosted sync infrastructure."
      />
      <div className="mb-4 flex gap-3 rounded-xl border border-warning/30 bg-warning/[0.07] p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-[11.5px] leading-relaxed text-warning">
          The sync engine is not enabled in this desktop phase. Saving a provider stores only the
          HTTPS endpoint and device name; nothing is uploaded, downloaded or decrypted remotely.
        </p>
      </div>
      <Card>
        <div className="space-y-3 px-4 py-4">
          <Field label="Provider endpoint" htmlFor="sync-endpoint" hint="Your own HTTPS server, Worker, Durable Object or API.">
            <Input
              id="sync-endpoint"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://sync.example.com/v1"
              spellCheck={false}
            />
          </Field>
          <Field label="Device name" htmlFor="sync-device">
            <Input
              id="sync-device"
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              placeholder="Work laptop"
              maxLength={120}
            />
          </Field>
          <div className="flex items-center justify-between">
            <Switch
              id="sync-enabled"
              label="Allow syncing with this provider"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
            <div className="flex gap-2">
              {existing ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEndpoint("");
                    setDeviceName("");
                    setEnabled(false);
                    void saveSettings({ sync_provider: null });
                  }}
                >
                  Remove
                </Button>
              ) : null}
              <Button size="sm" onClick={() => void save()} loading={saving}>
                Save provider
              </Button>
            </div>
          </div>
          {error ? <p className="text-[12px] text-danger">{error}</p> : null}
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-border/70 bg-muted/20 px-4 py-3 text-[11.5px]">
          <div>
            <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Protocol</p>
            <p className="mt-0.5 font-mono">acuye-sync/1</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Status</p>
            <p className="mt-0.5">{existing ? (existing.enabled ? "Configured · engine not enabled" : "Configured · disabled") : "Not configured"}</p>
          </div>
        </div>
      </Card>
    </>
  );
}

function StorageSection() {
  const backend = useBackend();
  const { lock, showToast } = useApp();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null);

  const load = useCallback(async () => {
    try {
      const [storage, list] = await Promise.all([backend.storageInfo(), backend.listBackups()]);
      setInfo(storage);
      setBackups(list);
    } catch {
      setInfo(null);
    }
  }, [backend]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <SectionHeading
        title="Data & Storage"
        description="Where your encrypted vault lives and how to back it up safely."
      />
      <Card>
        <Row title="Encrypted database" description={info?.databasePath ?? "Unavailable in preview"}>
          <span className="text-[12px] tabular-nums">{info ? formatBytes(info.databaseSize) : "—"}</span>
        </Row>
        <Row title="Integrity check" description="SQLite quick_check on the encrypted file." className="border-t border-border/70">
          <Badge tone={info?.integrityOk ? "success" : "warning"}>{info?.integrityOk ? "Passed" : "Unknown"}</Badge>
        </Row>
        <Row title="Schema version" description={`${info?.itemCount ?? 0} encrypted item rows`} className="border-t border-border/70">
          <span className="text-[12px]">v{info?.schemaVersion ?? "—"}</span>
        </Row>
        <Row title="Folders" description="Open the data, backup or export folder." className="border-t border-border/70">
          <div className="flex gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  await backend.openDataFolder();
                } catch {
                  showToast({ title: "Available in the desktop app", tone: "info" });
                }
              }}
            >
              Data
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  await backend.openBackupsFolder();
                } catch {
                  showToast({ title: "Available in the desktop app", tone: "info" });
                }
              }}
            >
              Backups
            </Button>
          </div>
        </Row>
      </Card>

      <div className="mt-4 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold">Encrypted backups</h2>
        <Button
          variant="secondary"
          size="sm"
          loading={creating}
          onClick={async () => {
            setCreating(true);
            try {
              const backup = await backend.createBackup();
              showToast({ title: "Backup created", description: backup.path, tone: "success" });
              await load();
            } catch (cause) {
              showToast({
                title: "Could not create a backup",
                description: cause instanceof Error ? cause.message : undefined,
                tone: "error",
              });
            } finally {
              setCreating(false);
            }
          }}
        >
          <HardDrive className="h-3.5 w-3.5" />
          Back up now
        </Button>
      </div>
      <Card className="mt-2">
        {backups.length === 0 ? (
          <p className="px-4 py-5 text-[12px] text-muted-foreground">
            No backups yet. Backups remain encrypted; you still need the master password of the
            time the backup was made.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {backups.map((backup) => (
              <li key={backup.name} className="flex items-center gap-3 px-4 py-2.5">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium">{backup.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatBytes(backup.size)} · {relativeTime(backup.createdAt)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setRestoreTarget(backup)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Restoring replaces the current vault contents with the backup and locks the app. Keep a
        fresh backup before restoring an older one.
      </p>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
        title="Restore this backup?"
        description={
          restoreTarget
            ? `“${restoreTarget.name}” will replace the current vault. You will be signed out and must unlock with the master password that was set when the backup was created.`
            : ""
        }
        confirmLabel="Restore backup"
        destructive
        loading={restoring}
        onConfirm={async () => {
          if (!restoreTarget) return;
          setRestoring(true);
          try {
            await backend.restoreBackup(restoreTarget.name);
            await lock();
            showToast({ title: "Backup restored", description: "Unlock with the matching master password.", tone: "success" });
          } catch (cause) {
            showToast({
              title: "Could not restore the backup",
              description: cause instanceof Error ? cause.message : undefined,
              tone: "error",
            });
          } finally {
            setRestoring(false);
            setRestoreTarget(null);
          }
        }}
      />
    </>
  );
}

function TransferSection() {
  const backend = useBackend();
  const { refresh, showToast } = useApp();
  const [preview, setPreview] = useState<ParsedImport | null>(null);
  const [importing, setImporting] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportConfirm, setExportConfirm] = useState("");
  const [exporting, setExporting] = useState(false);
  const [plainAck, setPlainAck] = useState(false);
  const [plainConfirm, setPlainConfirm] = useState(false);
  const [encryptedPayload, setEncryptedPayload] = useState<{ name: string; text: string } | null>(null);
  const [importPassword, setImportPassword] = useState("");
  const [importingEncrypted, setImportingEncrypted] = useState(false);
  const [busy, setBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const encryptedInput = useRef<HTMLInputElement>(null);

  const pickImport = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = await backend.importPreview(text, null);
      setPreview(parsed);
    } catch (cause) {
      showToast({
        title: "Could not read that file",
        description: cause instanceof Error ? cause.message : undefined,
        tone: "error",
      });
    } finally {
      setBusy(false);
      if (importInput.current) importInput.current.value = "";
    }
  };

  const applyImport = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const result = await backend.importApply(preview.items, preview.format);
      await refresh();
      showToast({
        title: `${result.imported} items imported`,
        description: result.renamed ? `${result.renamed} duplicate ids were rewritten` : undefined,
        tone: "success",
      });
      setPreview(null);
    } catch (cause) {
      showToast({
        title: "Import failed",
        description: cause instanceof Error ? cause.message : undefined,
        tone: "error",
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <SectionHeading
        title="Import & Export"
        description="Your data is yours. Export it at any time or import from another password manager."
      />

      <Card>
        <div className="flex items-start gap-3 px-4 pt-3.5">
          <FileUp className="mt-0.5 h-4 w-4 text-accent" />
          <div className="flex-1">
            <p className="text-[13px] font-medium">Import</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              Bitwarden (JSON/CSV), Chrome/Edge CSV, 1Password CSV or an Acuye Pass JSON export.
              Parsing happens in Rust; nothing is uploaded.
            </p>
          </div>
          <input
            ref={importInput}
            type="file"
            accept=".csv,.json,text/csv,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void pickImport(file);
            }}
          />
          <Button variant="secondary" size="sm" loading={busy} onClick={() => importInput.current?.click()}>
            Choose file
          </Button>
        </div>
        {preview ? (
          <div className="border-t border-border/70 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">{preview.format.replace(/_/g, " ")}</Badge>
              <Badge tone="muted">{preview.items.length} items</Badge>
              {preview.skipped ? <Badge tone="warning">{preview.skipped} skipped</Badge> : null}
            </div>
            <p className="mt-2 max-h-24 overflow-y-auto text-[11.5px] text-muted-foreground">
              {preview.items.slice(0, 6).map((item) => item.title).join(" · ")}
              {preview.items.length > 6 ? ` · +${preview.items.length - 6} more` : ""}
            </p>
            {preview.warnings.length > 0 ? (
              <p className="mt-1 text-[11px] text-warning">{preview.warnings.join(" · ")}</p>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>Cancel</Button>
              <Button size="sm" loading={importing} onClick={() => void applyImport()}>
                Import {preview.items.length} items
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="mt-4">
        <div className="px-4 pt-3.5">
          <p className="text-[13px] font-medium">Encrypted export</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Recommended. The file is protected with Argon2id and XChaCha20-Poly1305 using a
            separate export password.
          </p>
        </div>
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
          <Field label="Export password" htmlFor="export-password">
            <Input
              id="export-password"
              type="password"
              value={exportPassword}
              onChange={(event) => setExportPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm password" htmlFor="export-confirm">
            <Input
              id="export-confirm"
              type="password"
              value={exportConfirm}
              onChange={(event) => setExportConfirm(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>
        <div className="flex items-center justify-between border-t border-border/70 px-4 py-2.5">
          <p className="text-[11px] text-muted-foreground">Stored in the app's exports folder.</p>
          <Button
            size="sm"
            loading={exporting}
            disabled={exportPassword.length < 8 || exportPassword !== exportConfirm}
            onClick={async () => {
              setExporting(true);
              try {
                const result = await backend.exportEncrypted(exportPassword);
                showToast({ title: "Encrypted export created", description: result.path, tone: "success" });
                setExportPassword("");
                setExportConfirm("");
              } catch (cause) {
                showToast({
                  title: "Export failed",
                  description: cause instanceof Error ? cause.message : undefined,
                  tone: "error",
                });
              } finally {
                setExporting(false);
              }
            }}
          >
            Export encrypted
          </Button>
        </div>
      </Card>

      <Card className="mt-4">
        <div className="px-4 pt-3.5">
          <p className="text-[13px] font-medium">Plaintext CSV export</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-warning">
            The CSV contains your passwords in the clear. Only use it with a trusted destination,
            and delete it afterwards.
          </p>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <label className="flex items-start gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
            <input
              type="checkbox"
              checked={plainAck}
              onChange={(event) => setPlainAck(event.target.checked)}
              className="mt-0.5 accent-[hsl(var(--accent))]"
            />
            I understand this file is unencrypted and contains my secrets.
          </label>
          <Button variant="outline" size="sm" disabled={!plainAck} onClick={() => setPlainConfirm(true)}>
            Export CSV
          </Button>
        </div>
      </Card>

      <Card className="mt-4">
        <div className="flex items-start gap-3 px-4 pt-3.5">
          <DownloadCloud className="mt-0.5 h-4 w-4 text-accent" />
          <div className="flex-1">
            <p className="text-[13px] font-medium">Import an encrypted Acuye Pass export</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">Choose the JSON file and enter its export password.</p>
          </div>
          <input
            ref={encryptedInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) setEncryptedPayload({ name: file.name, text: await file.text() });
              if (encryptedInput.current) encryptedInput.current.value = "";
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => encryptedInput.current?.click()}>
            Choose file
          </Button>
        </div>
        {encryptedPayload ? (
          <div className="grid items-end gap-3 border-t border-border/70 px-4 py-3 sm:grid-cols-[1fr_auto]">
            <Field label={encryptedPayload.name} htmlFor="import-export-password">
              <Input
                id="import-export-password"
                type="password"
                value={importPassword}
                onChange={(event) => setImportPassword(event.target.value)}
                placeholder="Export password"
              />
            </Field>
            <Button
              size="sm"
              loading={importingEncrypted}
              disabled={!importPassword}
              onClick={async () => {
                setImportingEncrypted(true);
                try {
                  const result = await backend.importEncrypted(encryptedPayload.text, importPassword);
                  await refresh();
                  showToast({ title: `${result.imported} items imported`, tone: "success" });
                  setEncryptedPayload(null);
                  setImportPassword("");
                } catch (cause) {
                  showToast({
                    title: "Could not import that export",
                    description: cause instanceof Error ? cause.message : undefined,
                    tone: "error",
                  });
                } finally {
                  setImportingEncrypted(false);
                }
              }}
            >
              Import
            </Button>
          </div>
        ) : null}
      </Card>

      <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-3">
        <p className="text-[11.5px] text-muted-foreground">Exports are written to the app data folder.</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await backend.openExportsFolder();
            } catch {
              showToast({ title: "Available in the desktop app", tone: "info" });
            }
          }}
        >
          Open exports folder
        </Button>
      </div>

      <ConfirmDialog
        open={plainConfirm}
        onOpenChange={setPlainConfirm}
        title="Export passwords as CSV?"
        description="This creates an unencrypted file containing every password. Anyone with access to it can read your secrets."
        confirmLabel="Export unencrypted"
        destructive
        onConfirm={async () => {
          try {
            const result = await backend.exportPlaintextCsv(true);
            showToast({ title: "Plaintext CSV exported", description: result.path, tone: "success" });
          } catch (cause) {
            showToast({
              title: "Export failed",
              description: cause instanceof Error ? cause.message : undefined,
              tone: "error",
            });
          } finally {
            setPlainConfirm(false);
          }
        }}
      />
    </>
  );
}

function ShortcutsSection() {
  const { settings, saveSettings } = useApp();
  const shortcuts = [
    { keys: "Ctrl + K", action: "Focus the vault search" },
    { keys: "Ctrl + N", action: "Create a new item" },
    { keys: "Ctrl + G", action: "Open the password generator" },
    { keys: "Ctrl + L", action: "Lock the vault" },
    { keys: "Ctrl + ,", action: "Open settings" },
    { keys: "Esc", action: "Close a dialog or menu" },
    { keys: "Enter", action: "Submit the focused form" },
  ];
  return (
    <>
      <SectionHeading title="Keyboard Shortcuts" description="Shortcuts work when no text field needs the key combination." />
      <Card>
        <Row title="Enable shortcuts" description="Global shortcuts are handled by the app shell.">
          <Switch
            id="shortcuts-toggle"
            checked={settings.shortcuts_enabled}
            onCheckedChange={(checked) => void saveSettings({ shortcuts_enabled: checked })}
          />
        </Row>
        <ul className="divide-y divide-border/70 border-t border-border/70">
          {shortcuts.map((shortcut) => (
            <li key={shortcut.keys} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[12.5px] text-foreground/85">{shortcut.action}</span>
              <Kbd>{shortcut.keys}</Kbd>
            </li>
          ))}
        </ul>
      </Card>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Text selection, Ctrl+C, Ctrl+V and Ctrl+A keep working normally. The default WebView
        right-click menu is disabled; item rows offer a custom context menu instead.
      </p>
    </>
  );
}

function UpdatesSection() {
  const backend = useBackend();
  const { settings, setUpdateChannel, showToast } = useApp();
  const [status, setStatus] = useState<UpdateStatusView | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [channelDialog, setChannelDialog] = useState<ReleaseChannel | null>(null);
  const [installDialog, setInstallDialog] = useState(false);
  const autoChecked = useRef(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await backend.updateStatus());
    } catch {
      setStatus(null);
    }
  }, [backend]);

  useEffect(() => {
    void refreshStatus();
    let unlisten: (() => void) | undefined;
    void backend
      .onUpdateProgress((received, total) => {
        setStatus((current) => (current ? { ...current, progress: received, total } : current));
      })
      .then((cleanup) => {
        unlisten = cleanup;
      });
    return () => unlisten?.();
  }, [backend, refreshStatus]);

  useEffect(() => {
    if (autoChecked.current || backend.kind === "preview" || !settings.update_auto_check) return;
    autoChecked.current = true;
    const last = settings.last_update_check ?? 0;
    if (Date.now() / 1000 - last < 6 * 3600) return;
    setChecking(true);
    void backend
      .checkForUpdates(false)
      .then(setStatus)
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, [backend, settings.last_update_check, settings.update_auto_check]);

  const check = async () => {
    setChecking(true);
    try {
      setStatus(await backend.checkForUpdates(true));
    } catch (cause) {
      showToast({
        title: "Update check failed",
        description: cause instanceof Error ? cause.message : undefined,
        tone: "error",
      });
    } finally {
      setChecking(false);
    }
  };

  const run = async (label: string, action: () => Promise<UpdateStatusView>) => {
    setBusy(label);
    try {
      setStatus(await action());
    } catch (cause) {
      showToast({
        title: `${label} failed`,
        description: cause instanceof Error ? cause.message : undefined,
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const stage = status?.stage ?? "idle";
  const channel = settings.update_channel;
  const percent =
    status?.progress != null && status?.total ? Math.min(100, (status.progress / status.total) * 100) : null;

  return (
    <>
      <SectionHeading
        title="Updates"
        description="Official GitHub releases only. Every update is signature-verified before it can be installed."
      />
      <Card>
        <div className="flex items-start justify-between gap-3 px-4 py-4">
          <div>
            <p className="text-[13px] font-medium">Acuye Pass {status?.currentVersion ?? "0.1.0"}</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Repository: <span className="font-mono">{status?.repository ?? "Ahaduzzamankhan/Acuye-Pass"}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={status?.signingConfigured ? "success" : "warning"}>
              {status?.signingConfigured ? "Signing key configured" : "Signing key missing"}
            </Badge>
            <Badge tone="muted">{channel}</Badge>
          </div>
        </div>

        <div className="border-t border-border/70 px-4 py-3">
          <p className="text-[12.5px] font-medium">Release channel</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(["stable", "beta", "alpha"] as ReleaseChannel[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  if (option === channel) return;
                  if (option === "stable") void setUpdateChannel("stable", false);
                  else setChannelDialog(option);
                }}
                aria-pressed={channel === option}
                className={cn(
                  "rounded-lg border p-2.5 text-left transition-colors",
                  channel === option ? "border-accent bg-accent-soft/60" : "border-border hover:bg-muted/50",
                )}
              >
                <p className="flex items-center justify-between text-[12px] font-medium capitalize">
                  {option}
                  {channel === option ? <Check className="h-3 w-3 text-accent" /> : null}
                </p>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
                  {option === "stable"
                    ? "Tested releases only"
                    : option === "beta"
                      ? "Opt-in preview builds"
                      : "Early experimental builds"}
                </p>
              </button>
            ))}
          </div>
          {channel !== "stable" ? (
            <p className="mt-2 text-[11px] text-warning">
              You are on the {channel} channel. Prereleases are only offered because you enabled
              them explicitly.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 px-4 py-3">
          <Button variant="secondary" size="sm" onClick={() => void check()} loading={checking}>
            <RefreshCw className="h-3.5 w-3.5" />
            Check for updates
          </Button>
          {stage === "available" ? (
            <Button size="sm" onClick={() => void run("Download", () => backend.downloadUpdate())} loading={busy === "Download"}>
              Download {status?.available?.version}
            </Button>
          ) : null}
          {stage === "downloaded" ? (
            <Button size="sm" onClick={() => void run("Verification", () => backend.verifyUpdate())} loading={busy === "Verification"}>
              <ShieldCheck className="h-3.5 w-3.5" />
              Verify signature
            </Button>
          ) : null}
          {stage === "verified" ? (
            <Button size="sm" onClick={() => setInstallDialog(true)} loading={busy === "Install"}>
              Install update
            </Button>
          ) : null}
          {stage !== "idle" && stage !== "checking" && stage !== "up_to_date" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await backend.discardUpdate();
                await refreshStatus();
              }}
            >
              Discard
            </Button>
          ) : null}
          <span className="ml-auto text-[11px] text-muted-foreground">
            Last check {relativeTime(status?.lastCheck ?? settings.last_update_check)}
          </span>
        </div>

        {stage === "checking" ? <p className="px-4 pb-3 text-[12px] text-muted-foreground">Contacting GitHub…</p> : null}
        {stage === "up_to_date" ? (
          <p className="px-4 pb-3 text-[12px] text-success">You are on the latest {channel} release.</p>
        ) : null}
        {stage === "failed" && status?.error ? (
          <p className="mx-4 mb-3 rounded-md bg-danger/10 px-3 py-2 text-[12px] text-danger">{status.error}</p>
        ) : null}
        {percent != null ? (
          <div className="px-4 pb-3">
            <Progress value={percent} />
            <p className="mt-1 text-[10.5px] tabular-nums text-muted-foreground">
              {formatBytes(status?.progress ?? 0)} of {formatBytes(status?.total ?? 0)} · {Math.round(percent)}%
            </p>
          </div>
        ) : null}
        {status?.verified ? (
          <div className="mx-4 mb-3 rounded-md bg-success/10 px-3 py-2 text-[11.5px] text-success">
            Signature verified · SHA-256 {status.verified.sha256.slice(0, 24)}…
          </div>
        ) : null}
      </Card>

      {status?.available ? (
        <Card className="mt-4">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-[13px] font-medium">
              Acuye Pass {status.available.version}
              {status.available.prerelease ? <Badge tone="warning" className="ml-2">Prerelease</Badge> : null}
            </p>
            <span className="text-[11px] text-muted-foreground">
              {(status.available.asset.size / (1024 * 1024)).toFixed(1)} MB · {status.available.asset.name}
            </span>
          </div>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap border-t border-border/70 px-4 py-3 font-sans text-[11.5px] leading-relaxed text-muted-foreground">
            {status.available.notes || "No release notes provided."}
          </pre>
        </Card>
      ) : null}

      <div className="mt-4 flex gap-3 rounded-xl border border-border bg-surface p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Updates are discovered from the official repository only, downloaded over HTTPS from the
          release asset path, verified with the updater's minisign key and rejected if they are
          older than the installed version. Downloads are never executed automatically.
        </p>
      </div>

      <Dialog
        open={channelDialog !== null}
        onOpenChange={(open) => !open && setChannelDialog(null)}
        title={`Switch to the ${channelDialog ?? ""} channel?`}
        description="Prereleases are opt-in. Acuye Pass never switches channels on its own."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setChannelDialog(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!channelDialog) return;
                const ok = await setUpdateChannel(channelDialog, true);
                if (ok) {
                  showToast({ title: `${channelDialog} channel enabled`, tone: "info" });
                  setChannelDialog(null);
                }
              }}
            >
              Enable {channelDialog}
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {channelDialog === "alpha"
            ? "Alpha builds are early and may break. They receive the newest features first."
            : "Beta builds are previews of the next stable release and may contain bugs."}{" "}
          Only install builds you are comfortable testing, and keep an encrypted backup.
        </p>
      </Dialog>

      <ConfirmDialog
        open={installDialog}
        onOpenChange={setInstallDialog}
        title="Install this update?"
        description="Acuye Pass will launch the verified installer. The app may close during installation and your vault stays encrypted on disk."
        confirmLabel="Install and restart"
        loading={busy === "Install"}
        onConfirm={async () => {
          setInstallDialog(false);
          await run("Install", () => backend.installUpdate());
        }}
      />
    </>
  );
}

function AboutSection() {
  const backend = useBackend();
  const { status, showToast } = useApp();

  return (
    <>
      <SectionHeading title="About Acuye Pass" description="A Fluxenite open-source project." />
      <Card>
        <div className="flex items-center gap-4 px-4 py-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent/60 shadow-lg shadow-accent/20">
            <ShieldCheck className="h-7 w-7 text-white" />
          </div>
          <div>
            <p className="text-[16px] font-semibold">Acuye Pass</p>
            <p className="text-[12px] text-muted-foreground">
              Version {status?.appVersion ?? "0.1.0"} · {status?.platform ?? "—"} · MIT License
            </p>
          </div>
        </div>
        <Row title="Official repository" description="Updates are only trusted from this repository.">
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              try {
                await backend.openWebsite(`https://github.com/${status?.repository ?? "Ahaduzzamankhan/Acuye-Pass"}`);
              } catch {
                showToast({ title: "Could not open the browser", tone: "error" });
              }
            }}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            GitHub
          </Button>
        </Row>
        <Row title="Data location" description={status?.dataDir ?? "—"} className="border-t border-border/70">
          <span className="text-[11px] text-muted-foreground">Local only</span>
        </Row>
        <Row title="Mobile app" description="React Native scaffold only. The shared Rust core is prepared for it." className="border-t border-border/70">
          <Badge tone="muted">Scaffold</Badge>
        </Row>
      </Card>
      <div className="mt-4 rounded-xl border border-warning/30 bg-warning/[0.07] p-4">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-warning">
          <Info className="h-3.5 w-3.5" />
          Security limitations
        </p>
        <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-warning/90">
          <li>· Acuye Pass has not been independently audited.</li>
          <li>· No software is unbreakable, including this one.</li>
          <li>· Losing the master password makes the vault permanently unrecoverable.</li>
          <li>· Unlocked vault contents necessarily exist in process memory.</li>
          <li>· Mobile sync and the BYOB sync engine are not implemented yet.</li>
        </ul>
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Eye className="h-3 w-3" /> Built with Tauri 2, Rust and React.
      </p>
    </>
  );
}

/** Utility used by future sections that need to display stored settings. */
export function _settingsSnapshot(settings: AppSettings) {
  return settings;
}

export type { AppSettings };
