import {
  CreditCard,
  FileText,
  Fingerprint,
  KeyRound,
  SlidersHorizontal,
  StickyNote,
} from "lucide-react";

import type { ItemType } from "@/lib/types";
import { cn, hueFor, initials } from "@/lib/utils";

const ICONS: Record<ItemType, typeof KeyRound> = {
  login: KeyRound,
  secure_note: StickyNote,
  card: CreditCard,
  identity: Fingerprint,
  document: FileText,
  custom: SlidersHorizontal,
};

export function ItemAvatar({
  title,
  type,
  favicon,
  size = "md",
  className,
}: {
  title: string;
  type: ItemType;
  favicon?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const hue = hueFor(title);
  const dimensions = {
    sm: "h-7 w-7 rounded-[7px] text-[10px]",
    md: "h-9 w-9 rounded-lg text-[11.5px]",
    lg: "h-12 w-12 rounded-xl text-[15px]",
  }[size];
  const Icon = ICONS[type];

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden font-semibold text-white shadow-sm",
        dimensions,
        className,
      )}
      style={{
        background: `linear-gradient(145deg, hsl(${hue} 62% 46%), hsl(${(hue + 28) % 360} 68% 36%))`,
      }}
      aria-hidden
    >
      {favicon ? (
        <img src={favicon} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : type === "login" ? (
        <span>{initials(title)}</span>
      ) : (
        <Icon className="h-[45%] w-[45%]" />
      )}
    </div>
  );
}
