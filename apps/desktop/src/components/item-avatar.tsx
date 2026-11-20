import {
  CreditCard,
  FileText,
  Fingerprint,
  KeyRound,
  KeySquare,
  ShieldCheck,
  SlidersHorizontal,
  StickyNote,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { ItemType } from "@/lib/types";
import { cn, hueFor, initials } from "@/lib/utils";

const ICONS: Record<ItemType, typeof KeyRound> = {
  login: KeyRound,
  secure_note: StickyNote,
  card: CreditCard,
  identity: Fingerprint,
  document: FileText,
  custom: SlidersHorizontal,
  totp: ShieldCheck,
  secret: KeySquare,
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
  const [broken, setBroken] = useState(false);
  const dimensions = {
    sm: "h-7 w-7 rounded-[7px] text-[10px]",
    md: "h-9 w-9 rounded-lg text-[11.5px]",
    lg: "h-12 w-12 rounded-xl text-[15px]",
  }[size];
  const Icon = ICONS[type];
  const showImage = Boolean(favicon) && !broken;

  // A new icon source gets a fresh chance to load.
  useEffect(() => setBroken(false), [favicon]);

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
      {showImage ? (
        <img
          src={favicon ?? undefined}
          alt=""
          className="h-full w-full bg-white object-contain p-1"
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : type === "login" ? (
        <span>{initials(title)}</span>
      ) : (
        <Icon className="h-[45%] w-[45%]" />
      )}
    </div>
  );
}
