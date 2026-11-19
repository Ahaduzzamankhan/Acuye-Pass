import { Copy, Minus, ShieldCheck, Square, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useBackend } from "@/lib/backend-context";
import { cn } from "@/lib/utils";

/**
 * Custom frameless title bar for Windows.
 *
 * The drag region uses the native `-webkit-app-region: drag` behaviour so
 * Windows keeps snap layouts, double-click maximize and Aero snap. Window
 * buttons call narrowly scoped Rust commands instead of the JS window API.
 */
export function TitleBar() {
  const backend = useBackend();
  const [maximized, setMaximized] = useState(false);
  const preview = backend.kind === "preview";

  const syncMaximized = useCallback(async () => {
    try {
      setMaximized(await backend.windowIsMaximized());
    } catch {
      setMaximized(false);
    }
  }, [backend]);

  useEffect(() => {
    void syncMaximized();
    window.addEventListener("resize", syncMaximized);
    return () => window.removeEventListener("resize", syncMaximized);
  }, [syncMaximized]);

  const toggleMaximize = async () => {
    try {
      setMaximized(await backend.windowToggleMaximize());
    } catch {
      // Window controls only exist in the desktop shell.
    }
  };

  return (
    <header className="titlebar relative z-40 flex h-9 shrink-0 items-stretch border-b border-black/20 select-none">
      <div
        className="drag-region flex flex-1 items-center gap-2 pl-3"
        onDoubleClick={() => void toggleMaximize()}
        data-tauri-drag-region
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-white/10 text-white">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="text-[12px] font-semibold tracking-[-0.01em]">Acuye Pass</span>
        <span className="hidden text-[11px] text-white/40 sm:inline">·</span>
        <span className="hidden text-[11px] text-white/50 sm:inline">Local-first password manager</span>
        {preview ? (
          <span className="ml-1 hidden rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-medium text-amber-200/90 md:inline">
            Browser preview
          </span>
        ) : null}
      </div>

      <div className="no-drag flex items-stretch">
        <TitleBarButton label="Minimize" onClick={() => void backend.windowMinimize()}>
          <Minus className="h-3.5 w-3.5" />
        </TitleBarButton>
        <TitleBarButton
          label={maximized ? "Restore" : "Maximize"}
          onClick={() => void toggleMaximize()}
        >
          {maximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
        </TitleBarButton>
        <TitleBarButton label="Close" danger onClick={() => void backend.windowClose()}>
          <X className="h-4 w-4" />
        </TitleBarButton>
      </div>
    </header>
  );
}

function TitleBarButton({
  label,
  onClick,
  children,
  danger,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex w-[44px] items-center justify-center text-white/70 transition-colors duration-100 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40",
        danger ? "hover:bg-[#c42b1c]" : "hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}
