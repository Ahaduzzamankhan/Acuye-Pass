import { AnimatePresence, motion } from "motion/react";
import {
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  Fingerprint,
  KeyRound,
  LayoutGrid,
  Lock,
  LogOut,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Star,
  StickyNote,
  Vault,
} from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

import { useApp, type VaultFilter } from "@/lib/app-context";
import { cn, initials } from "@/lib/utils";
import { ActionMenu } from "./menu";
import { Badge, IconButton, Tooltip } from "./ui";
import { useBackend } from "@/lib/backend-context";

const ITEM_NAV: Array<{ filter: VaultFilter; label: string; icon: typeof KeyRound }> = [
  { filter: "all", label: "All Items", icon: LayoutGrid },
  { filter: "favorites", label: "Favorites", icon: Star },
  { filter: "login", label: "Passwords", icon: KeyRound },
  { filter: "secure_note", label: "Secure Notes", icon: StickyNote },
  { filter: "card", label: "Cards", icon: CreditCard },
  { filter: "identity", label: "Identities", icon: Fingerprint },
];

export function Sidebar() {
  const backend = useBackend();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    settings,
    saveSettings,
    counts,
    report,
    session,
    filter,
    setFilter,
    lock,
    logout,
    showToast,
  } = useApp();

  const collapsed = settings.sidebar_collapsed;
  const onVault = location.pathname === "/vault";

  const toggleCollapsed = () => {
    void saveSettings({ sidebar_collapsed: !collapsed });
  };

  const go = (path: string) => navigate(path);

  const selectFilter = (next: VaultFilter) => {
    setFilter(next);
    if (!onVault) navigate("/vault");
  };

  const navButton = (active: boolean, label: string, icon: React.ReactNode, onClick: () => void, badge?: React.ReactNode) => (
    <Tooltip key={label} content={label} side="right" disabled={!collapsed}>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
          active
            ? "text-white"
            : "text-sidebar-muted hover:bg-white/[0.06] hover:text-white/90",
        )}
      >
        {active ? (
          <motion.span
            layoutId="sidebar-active"
            transition={{ type: "spring", stiffness: 520, damping: 40 }}
            className="absolute inset-0 rounded-lg"
            style={{ background: "hsl(var(--sidebar-active))" }}
          />
        ) : null}
        <span className="relative z-10 flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
        <AnimatePresence initial={false}>
          {!collapsed ? (
            <motion.span
              key="label"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.14 }}
              className="relative z-10 flex-1 truncate text-left"
            >
              {label}
            </motion.span>
          ) : null}
        </AnimatePresence>
        {!collapsed && badge ? <span className="relative z-10">{badge}</span> : null}
      </button>
    </Tooltip>
  );

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 68 : 236 }}
      transition={{ type: "spring", stiffness: 420, damping: 40 }}
      className="relative z-20 flex h-full shrink-0 flex-col overflow-hidden border-r border-black/30"
      style={{ background: "hsl(var(--sidebar))", color: "hsl(var(--sidebar-foreground))" }}
    >
      <div className={cn("flex h-14 items-center gap-2.5 px-3", collapsed && "justify-center px-0")}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-accent to-accent/60 shadow-md shadow-black/30">
          <ShieldCheck className="h-4.5 w-4.5 text-white" strokeWidth={2.2} />
        </div>
        <AnimatePresence initial={false}>
          {!collapsed ? (
            <motion.div
              key="brand"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="min-w-0 flex-1"
            >
              <p className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-white">Acuye Pass</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-white/35">Fluxenite</p>
            </motion.div>
          ) : null}
        </AnimatePresence>
        {!collapsed ? (
          <IconButton
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            onClick={toggleCollapsed}
            className="text-white/50 hover:bg-white/10 hover:text-white"
          >
            <ChevronsLeft className="h-4 w-4" />
          </IconButton>
        ) : null}
      </div>

      <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-2">
        {ITEM_NAV.map((entry) => {
          const count =
            entry.filter === "all"
              ? counts.total
              : entry.filter === "favorites"
                ? counts.favorites
                : entry.filter === "login"
                  ? counts.logins
                  : entry.filter === "secure_note"
                    ? counts.notes
                    : entry.filter === "card"
                      ? counts.cards
                      : counts.identities;
          return navButton(
            onVault && filter === entry.filter,
            entry.label,
            <entry.icon />,
            () => selectFilter(entry.filter),
            count ? (
              <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/60">
                {count}
              </span>
            ) : undefined,
          );
        })}

        <div className="my-2 mx-2 h-px bg-white/[0.07]" />

        {navButton(
          location.pathname === "/security",
          "Security Center",
          <ShieldAlert />,
          () => go("/security"),
          report && (report.weak || report.reused || report.empty) ? (
            <span className="rounded-full bg-danger/25 px-1.5 py-0.5 text-[10px] font-semibold text-red-200">
              {(report.weak || 0) + (report.reused || 0) + (report.empty || 0)}
            </span>
          ) : undefined,
        )}
        {navButton(location.pathname === "/vaults", "Vaults", <Vault />, () => go("/vaults"))}
        {navButton(location.pathname.startsWith("/settings"), "Settings", <Settings />, () => go("/settings/appearance"))}
      </nav>

      <div className="border-t border-white/[0.07] p-2">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            <Tooltip content={`${session?.username ?? "Vault"} · Click to expand`} side="right">
              <button
                type="button"
                onClick={toggleCollapsed}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-white"
                aria-label="Expand sidebar"
              >
                {initials(session?.username ?? "A")}
              </button>
            </Tooltip>
            <IconButton
              aria-label="Lock vault"
              title="Lock vault (Ctrl+L)"
              onClick={() => void lock("Locked from the sidebar.")}
              className="text-white/50 hover:bg-white/10 hover:text-white"
            >
              <Lock className="h-4 w-4" />
            </IconButton>
            <IconButton
              aria-label="Expand sidebar"
              title="Expand sidebar"
              onClick={toggleCollapsed}
              className="text-white/40 hover:bg-white/10 hover:text-white"
            >
              <ChevronsRight className="h-4 w-4" />
            </IconButton>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.05]">
            <div className="relative">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent/80 to-accent/40 text-[11px] font-semibold text-white">
                {initials(session?.username ?? "A")}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[hsl(var(--sidebar))] bg-success" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium text-white/90">{session?.username ?? "Vault"}</p>
              <p className="truncate text-[10.5px] text-white/40">{session?.vaultName ?? "Locked"}</p>
            </div>
            <IconButton
              aria-label="Lock vault"
              title="Lock vault (Ctrl+L)"
              onClick={() => void lock("Locked from the sidebar.")}
              className="text-white/50 hover:bg-white/10 hover:text-white"
            >
              <Lock className="h-3.5 w-3.5" />
            </IconButton>
            <ActionMenu
              label="Account actions"
              trigger={
                <IconButton
                  aria-label="Account actions"
                  className="text-white/50 hover:bg-white/10 hover:text-white"
                >
                  <span className="text-[15px] leading-none">⋯</span>
                </IconButton>
              }
              actions={[
                {
                  label: "Settings",
                  icon: <Settings />,
                  onSelect: () => go("/settings/appearance"),
                },
                {
                  label: "Lock vault",
                  icon: <Lock />,
                  shortcut: "Ctrl+L",
                  onSelect: () => void lock("Locked from the account menu."),
                },
                {
                  label: "Sign out",
                  icon: <LogOut />,
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => {
                    void logout();
                    showToast({ title: "Signed out", description: "Your vault is locked." });
                  },
                },
              ]}
            />
          </div>
        )}
        {!collapsed ? (
          <p className="mt-1 px-1.5 text-[10px] text-white/25">
            Local vault · {backend.kind === "tauri" ? "Encrypted" : "Preview mode"}
          </p>
        ) : null}
      </div>
    </motion.aside>
  );
}

export function SidebarBadge({ children }: { children: React.ReactNode }) {
  return <Badge tone="danger">{children}</Badge>;
}
