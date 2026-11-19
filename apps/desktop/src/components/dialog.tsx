import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "./ui";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  hideClose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  hideClose?: boolean;
}) {
  const widths = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  } as const;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                className={cn(
                  "fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/25",
                  widths[size],
                )}
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: 4 }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                style={{ translateX: "-50%", translateY: "-50%" }}
              >
                <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
                  <div className="min-w-0">
                    <DialogPrimitive.Title className="text-[15px] font-semibold tracking-[-0.01em]">
                      {title}
                    </DialogPrimitive.Title>
                    {description ? (
                      <DialogPrimitive.Description className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {description}
                      </DialogPrimitive.Description>
                    ) : (
                      <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
                    )}
                  </div>
                  {hideClose ? null : (
                    <DialogPrimitive.Close
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Close dialog"
                    >
                      <X className="h-4 w-4" />
                    </DialogPrimitive.Close>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
                {footer ? (
                  <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-muted/30 px-5 py-3">
                    {footer}
                  </div>
                ) : null}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <ConfirmDialogInner
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      destructive={destructive}
      loading={loading}
      onConfirm={onConfirm}
    />
  );
}

function ConfirmDialogInner({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={() => void onConfirm()}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
