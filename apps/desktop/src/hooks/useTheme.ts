import { useEffect, useState } from "react";

import type { AppSettings } from "@/lib/types";

/**
 * Applies the persisted accent theme + light/dark/system mode to the document.
 * Accent colour and appearance mode are independent by design.
 */
export function useTheme(settings: AppSettings) {
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme_color;
    const dark =
      settings.appearance_mode === "dark" ||
      (settings.appearance_mode === "system" && systemDark);
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
    root.dataset.reduceMotion = String(settings.reduce_motion);
    root.dataset.density = settings.density_compact ? "compact" : "comfortable";
  }, [settings, systemDark]);

  return { isDark: settings.appearance_mode === "dark" || (settings.appearance_mode === "system" && systemDark) };
}
