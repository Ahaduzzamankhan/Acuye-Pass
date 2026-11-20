import {
  KeyRound,
  KeySquare,
  Laptop,
  LayoutGrid,
  Lock,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  SquarePen,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useApp } from "@/lib/app-context";
import { cn } from "@/lib/utils";
import { Kbd } from "./ui";

interface Command {
  id: string;
  label: string;
  group: string;
  icon: typeof KeyRound;
  run: () => void;
}

/**
 * Ctrl+K command palette: navigation and the app's main actions in one list.
 * Everything runs locally — the palette only dispatches the same events the
 * rest of the UI uses.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { lock } = useApp();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      navigate(path);
      onClose();
    };
    const event = (name: string) => () => {
      window.dispatchEvent(new CustomEvent(name));
      onClose();
    };
    return [
      { id: "vault", label: "Go to vault", group: "Navigate", icon: LayoutGrid, run: go("/vault") },
      { id: "authenticator", label: "Go to authenticator", group: "Navigate", icon: KeyRound, run: go("/authenticator") },
      { id: "secrets", label: "Go to secrets", group: "Navigate", icon: KeySquare, run: go("/secrets") },
      { id: "devices", label: "Go to trusted devices", group: "Navigate", icon: Laptop, run: go("/devices") },
      { id: "security", label: "Go to security center", group: "Navigate", icon: ShieldAlert, run: go("/security") },
      { id: "settings", label: "Go to settings", group: "Navigate", icon: Settings, run: go("/settings/appearance") },
      { id: "new-item", label: "New item", group: "Actions", icon: SquarePen, run: event("acuye:new-item") },
      { id: "search", label: "Search the vault", group: "Actions", icon: Search, run: event("acuye:focus-search") },
      { id: "generator", label: "Open password generator", group: "Actions", icon: Sparkles, run: event("acuye:generator") },
      {
        id: "lock",
        label: "Lock the vault",
        group: "Actions",
        icon: Lock,
        run: () => {
          void lock("Locked from the command palette.");
          onClose();
        },
      },
    ];
  }, [lock, navigate, onClose]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (command) =>
        command.label.toLowerCase().includes(needle) || command.group.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setIndex((current) => (current >= results.length ? 0 : current));
  }, [results.length]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((current) => (results.length ? (current + 1) % results.length : 0));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((current) => (results.length ? (current - 1 + results.length) % results.length : 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              results[index]?.run();
            }
          }}
          placeholder="Type a command or page…"
          aria-label="Search commands"
          className="h-11 w-full border-b border-border bg-transparent px-4 text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <ul className="max-h-[46vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-[12px] text-muted-foreground">No matching command</li>
          ) : (
            results.map((command, position) => (
              <li key={command.id}>
                <button
                  type="button"
                  onMouseEnter={() => setIndex(position)}
                  onClick={command.run}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors",
                    index === position ? "bg-muted text-foreground" : "text-muted-foreground",
                  )}
                >
                  <command.icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{command.label}</span>
                  <span className="text-[10.5px] uppercase tracking-[0.08em] opacity-60">{command.group}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[10.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>Enter</Kbd> to run
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <Kbd>Esc</Kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
