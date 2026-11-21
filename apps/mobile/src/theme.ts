/**
 * Design tokens for Acuye Pass on Android.
 *
 * The desktop app offers six accent colours and light/dark/system appearance;
 * the phone mirrors that so the two apps feel like one product.
 */

export type ThemeColor = "blue" | "white" | "red" | "green" | "yellow" | "monochrome";
export type AppearanceMode = "light" | "dark" | "system";

export interface Theme {
  scheme: "light" | "dark";
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  overlay: string;
  radius: number;
  space: (units: number) => number;
  compact: boolean;
}

const ACCENTS: Record<ThemeColor, { dark: string; light: string; text: string }> = {
  blue: { dark: "#8aa0ff", light: "#3556f0", text: "#0b1220" },
  white: { dark: "#cbd5e1", light: "#334155", text: "#0b1220" },
  red: { dark: "#f78d8d", light: "#d92d20", text: "#1a0b0b" },
  green: { dark: "#5fe0b0", light: "#047857", text: "#04140e" },
  yellow: { dark: "#f7c948", light: "#b45309", text: "#1c1403" },
  monochrome: { dark: "#a8b3c4", light: "#3f4a5c", text: "#0b1220" },
};

export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const value = clean.length === 3
    ? clean.split("").map((part) => part + part).join("")
    : clean;
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

export function resolveScheme(appearance: AppearanceMode, system: "light" | "dark"): "light" | "dark" {
  return appearance === "system" ? system : appearance;
}

export function makeTheme(
  scheme: "light" | "dark",
  color: ThemeColor,
  compact: boolean,
): Theme {
  const dark = scheme === "dark";
  const accent = dark ? ACCENTS[color].dark : ACCENTS[color].light;
  return {
    scheme,
    bg: dark ? "#0b1220" : "#f5f7fc",
    surface: dark ? "#131c2e" : "#ffffff",
    surfaceAlt: dark ? "#1a2439" : "#eef2f9",
    border: dark ? "#25324b" : "#dde5f1",
    text: dark ? "#f1f5f9" : "#0f172a",
    muted: dark ? "#93a3bb" : "#5b6a83",
    accent,
    accentText: ACCENTS[color].text,
    accentSoft: withAlpha(accent, dark ? 0.18 : 0.12),
    success: dark ? "#34d399" : "#059669",
    successSoft: withAlpha(dark ? "#34d399" : "#059669", 0.14),
    danger: dark ? "#f87171" : "#dc2626",
    dangerSoft: withAlpha(dark ? "#f87171" : "#dc2626", 0.14),
    warning: dark ? "#fbbf24" : "#b45309",
    warningSoft: withAlpha(dark ? "#fbbf24" : "#b45309", 0.14),
    overlay: "rgba(3,7,18,0.72)",
    radius: 16,
    space: (units: number) => units * (compact ? 6 : 8),
    compact,
  };
}

export const TYPE_META: Record<string, { label: string; glyph: string }> = {
  login: { label: "Login", glyph: "K" },
  secure_note: { label: "Note", glyph: "N" },
  card: { label: "Card", glyph: "C" },
  identity: { label: "Identity", glyph: "I" },
  document: { label: "Document", glyph: "D" },
  custom: { label: "Custom", glyph: "X" },
  totp: { label: "Authenticator", glyph: "T" },
  secret: { label: "Secret", glyph: "S" },
};

export const SECRET_ENVIRONMENTS = ["development", "testing", "production"] as const;

export function typeLabel(kind: string): string {
  return TYPE_META[kind]?.label ?? kind;
}

export function typeGlyph(kind: string): string {
  return TYPE_META[kind]?.glyph ?? "?";
}

/** "2 hours ago" style relative time for metadata rows. */
export function relativeTime(unixSeconds: number): string {
  if (!unixSeconds) return "never";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo ago`;
  return `${Math.floor(months / 12)} y ago`;
}

/** A calendar date for recovery codes, backups and exports. */
export function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return "unknown";
  const date = new Date(unixSeconds * 1000);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
