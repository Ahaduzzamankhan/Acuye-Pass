import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  shortcut?: string;
}

export function ActionMenu({
  trigger,
  actions,
  align = "end",
  label = "More actions",
}: {
  trigger: ReactNode;
  actions: MenuAction[];
  align?: "start" | "end" | "center";
  label?: string;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild aria-label={label}>
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          className="z-[70] min-w-[200px] rounded-lg border border-border bg-surface p-1 shadow-xl shadow-black/15 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {actions.map((action) => (
            <div key={action.label}>
              {action.separatorBefore ? <DropdownMenu.Separator className="my-1 h-px bg-border/70" /> : null}
              <DropdownMenu.Item
                disabled={action.disabled}
                onSelect={(event) => {
                  event.preventDefault();
                  action.onSelect();
                }}
                className={cn(
                  "flex cursor-default select-none items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-[13px] outline-none transition-colors",
                  action.danger
                    ? "text-danger focus:bg-danger/10"
                    : "text-foreground/90 focus:bg-muted",
                  action.disabled && "pointer-events-none opacity-45",
                )}
              >
                <span className="flex h-4 w-4 items-center justify-center text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">
                  {action.icon}
                </span>
                <span className="flex-1">{action.label}</span>
                {action.shortcut ? (
                  <span className="font-mono text-[10.5px] text-muted-foreground">{action.shortcut}</span>
                ) : null}
              </DropdownMenu.Item>
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Custom right-click menu, replacing the default WebView context menu. */
export function ContextMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  actions: MenuAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPosition({
      x: Math.min(x, window.innerWidth - rect.width - 8),
      y: Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      role="menu"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.1 }}
      style={{ left: position.x, top: position.y }}
      className="fixed z-[90] min-w-[190px] rounded-lg border border-border bg-surface p-1 shadow-xl shadow-black/20"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {actions.map((action) => (
        <div key={action.label}>
          {action.separatorBefore ? <div className="my-1 h-px bg-border/70" /> : null}
          <button
            type="button"
            role="menuitem"
            disabled={action.disabled}
            onClick={() => {
              action.onSelect();
              onClose();
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-[13px] transition-colors",
              action.danger ? "text-danger hover:bg-danger/10" : "text-foreground/90 hover:bg-muted",
              action.disabled && "pointer-events-none opacity-45",
            )}
          >
            <span className="flex h-4 w-4 items-center justify-center text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">
              {action.icon}
            </span>
            <span className="flex-1">{action.label}</span>
            {action.shortcut ? (
              <span className="font-mono text-[10.5px] text-muted-foreground">{action.shortcut}</span>
            ) : null}
          </button>
        </div>
      ))}
    </motion.div>
  );
}
