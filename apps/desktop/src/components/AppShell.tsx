import { motion } from "motion/react";
import { Lock, Search, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";

import { useApp } from "@/lib/app-context";
import { useBackend } from "@/lib/backend-context";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { Kbd, Tooltip } from "./ui";

export function AppShell() {
  const navigate = useNavigate();
  const backend = useBackend();
  const { settings, session, counts, lock } = useApp();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (!settings.shortcuts_enabled) return;
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      switch (event.key.toLowerCase()) {
        case "l":
          event.preventDefault();
          void lock("Locked with the keyboard.");
          break;
        case "k":
          event.preventDefault();
          setPaletteOpen((open) => !open);
          break;
        case "n":
          event.preventDefault();
          window.dispatchEvent(new CustomEvent("acuye:new-item"));
          break;
        case "g":
          event.preventDefault();
          window.dispatchEvent(new CustomEvent("acuye:generator"));
          break;
        case ",":
          event.preventDefault();
          navigate("/settings/appearance");
          break;
        case "f":
          if (event.shiftKey) {
            event.preventDefault();
            window.dispatchEvent(new CustomEvent("acuye:focus-search"));
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lock, navigate, settings.shortcuts_enabled]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <TitleBar />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {backend.kind === "preview" ? (
        <div className="flex items-center justify-center gap-2 border-b border-warning/25 bg-warning/10 px-4 py-1 text-[11px] font-medium text-warning">
          Preview · demo data only
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <motion.main
            key="content"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="flex min-h-0 flex-1"
          >
            <Outlet />
          </motion.main>
          <StatusBar
            username={session?.username ?? ""}
            vaultName={session?.vaultName ?? "Vault"}
            itemCount={counts.total}
            autoLock={settings.auto_lock_secs}
            shortcuts={settings.shortcuts_enabled}
            encrypted={backend.kind === "tauri"}
          />
        </div>
      </div>
    </div>
  );
}

function StatusBar({
  username,
  vaultName,
  itemCount,
  autoLock,
  shortcuts,
  encrypted,
}: {
  username: string;
  vaultName: string;
  itemCount: number;
  autoLock: number;
  shortcuts: boolean;
  encrypted: boolean;
}) {
  return (
    <div className="flex h-7 shrink-0 select-none items-center gap-2.5 border-t border-border bg-surface/70 px-3 text-[10.5px] text-muted-foreground">
      <span
        className="inline-flex items-center gap-1.5"
        title={encrypted ? "Vault data is encrypted at rest" : "Browser preview uses demo data"}
      >
        <ShieldCheck className={cn("h-3 w-3", encrypted ? "text-success" : "text-warning")} />
        {encrypted ? "Encrypted" : "Preview"}
      </span>
      <span className="h-3 w-px bg-border" />
      <span className="truncate">
        {vaultName} · {itemCount} {itemCount === 1 ? "item" : "items"}
      </span>
      <span className="truncate text-muted-foreground/70">{username}</span>
      <span className="ml-auto inline-flex items-center gap-1.5 whitespace-nowrap">
        <Lock className="h-3 w-3" />
        {autoLock === 0 ? "Auto-lock off" : `Locks after ${Math.round(autoLock / 60)} min`}
      </span>
      {shortcuts ? (
        <>
          <span className="h-3 w-px bg-border" />
          <Tooltip content="Command palette (Ctrl K)">
            <span className="inline-flex items-center gap-1">
              <Search className="h-3 w-3" />
              <Kbd>Ctrl K</Kbd>
            </span>
          </Tooltip>
        </>
      ) : null}
    </div>
  );
}
