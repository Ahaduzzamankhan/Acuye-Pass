import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Info, X, AlertTriangle } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

type ToastTone = "info" | "success" | "error";

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  detail?: string;
  tone: ToastTone;
}

interface ToastContextValue {
  push: (toast: { title: string; description?: string; tone?: ToastTone }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Long machine paths (backup and export locations) used to overflow the toast.
 * Show the file name and keep the full path in the tooltip instead.
 */
function describe(text: string): { shown: string; detail?: string } {
  const trimmed = text.trim();
  if (trimmed.length <= 56 || !/[\\/]/.test(trimmed)) {
    return { shown: trimmed };
  }
  const name = trimmed.split(/[\\/]/).filter(Boolean).pop() ?? trimmed;
  const parent = trimmed.split(/[\\/]/).filter(Boolean).slice(-2, -1)[0];
  return {
    shown: parent ? `${parent}/${name}` : name,
    detail: trimmed,
  };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    ({ title, description, tone = "info" }: { title: string; description?: string; tone?: ToastTone }) => {
      const id = crypto.randomUUID();
      const described = description ? describe(description) : null;
      setToasts((current) => [
        // Collapse duplicates so repeated actions do not stack identical cards.
        ...current.filter((toast) => !(toast.title === title && toast.tone === tone)).slice(-2),
        {
          id,
          title,
          description: described?.shown,
          detail: described?.detail,
          tone,
        },
      ]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4200);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-9 right-3 z-[80] flex w-[min(360px,calc(100vw-1.5rem))] flex-col gap-2"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 16, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              className="pointer-events-auto flex items-start gap-2.5 overflow-hidden rounded-xl border border-border/80 bg-surface/95 p-3 pr-2 shadow-xl shadow-black/15 backdrop-blur"
              title={toast.detail}
            >
              <span
                className={cn(
                  "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                  toast.tone === "success" && "bg-success/12 text-success",
                  toast.tone === "error" && "bg-danger/12 text-danger",
                  toast.tone === "info" && "bg-accent-soft text-accent",
                )}
              >
                {toast.tone === "success" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : toast.tone === "error" ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : (
                  <Info className="h-3.5 w-3.5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium leading-snug">{toast.title}</p>
                {toast.description ? (
                  <p
                    className="mt-0.5 break-all text-[11.5px] leading-snug text-muted-foreground"
                    dir="ltr"
                  >
                    {toast.description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="-mr-0.5 shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
