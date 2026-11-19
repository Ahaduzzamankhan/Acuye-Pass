import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function relativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "Never";
  const seconds = Math.round(Date.now() / 1000 - timestamp);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

export function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return "—";
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function secondsLabel(seconds: number): string {
  if (seconds === 0) return "Never";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

/** Initials for generated favicon fallbacks. */
export function initials(title: string): string {
  const words = title
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "•";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

/** Deterministic accent hue for item avatars. */
export function hueFor(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 360;
  }
  return hash;
}

export function hostOf(url: string): string {
  if (!url.trim()) return "";
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function truncateMiddle(value: string, max = 34): string {
  if (value.length <= max) return value;
  const half = Math.floor((max - 1) / 2);
  return `${value.slice(0, half)}…${value.slice(-half)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
