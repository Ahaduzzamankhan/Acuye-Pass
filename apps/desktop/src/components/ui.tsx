import { cva, type VariantProps } from "class-variance-authority";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as LabelPrimitive from "@radix-ui/react-label";
import { Loader2 } from "lucide-react";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/utils";
export { Tooltip, TooltipProvider } from "./ui-tooltip";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 rounded-md text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:translate-y-[0.5px] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-foreground shadow-sm hover:brightness-[1.06] active:brightness-95",
        secondary:
          "bg-muted text-foreground hover:bg-muted/75 border border-border/60",
        outline:
          "border border-border bg-surface text-foreground hover:bg-muted/60",
        ghost: "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        danger: "bg-danger text-danger-foreground hover:brightness-110",
        subtle: "bg-accent-soft text-accent hover:brightness-95",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-4",
        lg: "h-11 px-5 text-[15px]",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "ghost", size = "icon", ...props }, ref) => (
    <Button ref={ref} variant={variant} size={size} className={cn("shrink-0", className)} {...props} />
  ),
);
IconButton.displayName = "IconButton";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-md border border-input bg-surface px-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-[90px] w-full resize-y rounded-md border border-input bg-surface px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export const Label = forwardRef<HTMLLabelElement, LabelPrimitive.LabelProps>(
  ({ className, ...props }, ref) => (
    <LabelPrimitive.Root
      ref={ref}
      className={cn("text-[13px] font-medium text-foreground/85", className)}
      {...props}
    />
  ),
);
Label.displayName = "Label";

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-9 w-full appearance-none rounded-md border border-input bg-surface px-3 pr-8 text-sm shadow-sm focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={cn(
          "relative h-[22px] w-[38px] shrink-0 rounded-full border border-transparent bg-muted-foreground/30 transition-colors data-[state=checked]:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50",
        )}
      >
        <SwitchPrimitive.Thumb className="block h-[18px] w-[18px] translate-x-[2px] rounded-full bg-white shadow transition-transform duration-200 data-[state=checked]:translate-x-[18px]" />
      </SwitchPrimitive.Root>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "danger" | "success" | "warning";
  className?: string;
}) {
  const tones: Record<string, string> = {
    muted: "bg-muted text-muted-foreground",
    accent: "bg-accent-soft text-accent",
    danger: "bg-danger/10 text-danger",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-muted-foreground", className)} aria-hidden />;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  className?: string;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex rounded-md border border-border bg-muted/50 p-0.5", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[12.5px] font-medium transition-colors",
            value === option.value
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted/70 px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
      {children}
    </kbd>
  );
}

export function Progress({ value, max = 100, className }: { value: number; max?: number; className?: string }) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-200"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
