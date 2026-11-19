import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={180}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = "top",
  disabled,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  disabled?: boolean;
}) {
  if (disabled) return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className="z-[95] rounded-md border border-border bg-surface px-2 py-1 text-[11.5px] font-medium text-foreground shadow-lg data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-[hsl(var(--surface))]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
