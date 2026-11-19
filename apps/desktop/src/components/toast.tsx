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
  tone: ToastTone;
}

interface ToastContextValue {
  push: (toast: { title: string; description?: string; tone?: ToastTone }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    ({ title, description, tone = "info" }: { title: string; description?: string; tone?: ToastTone }) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current.slice(-3), { id, title, description, tone }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4200);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[340px] flex-col gap-2"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-surface p-3 shadow-lg shadow-black/10"
            >
              <span
                className={cn(
                  "mt-0.5",
                  toast.tone === "success" && "text-success",
                  toast.tone === "error" && "text-danger",
                  toast.tone === "info" && "text-accent",
                )}
              >
                {toast.tone === "success" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : toast.tone === "error" ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : (
                  <Info className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium leading-snug">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{toast.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="rounded p-1 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
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
