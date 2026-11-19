import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { Backend } from "./backend";
import { DemoBackend } from "./demo-backend";
import { TauriBackend } from "./tauri-backend";
import { isTauri } from "./utils";

const BackendContext = createContext<Backend | null>(null);

let singleton: Backend | null = null;

export function getDefaultBackend(): Backend {
  if (!singleton) {
    singleton = isTauri() ? new TauriBackend() : new DemoBackend();
  }
  return singleton;
}

export function BackendProvider({
  backend,
  children,
}: {
  backend?: Backend;
  children: ReactNode;
}) {
  const value = useMemo(() => backend ?? getDefaultBackend(), [backend]);
  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>;
}

export function useBackend(): Backend {
  const backend = useContext(BackendContext);
  if (!backend) {
    throw new Error("useBackend must be used inside BackendProvider");
  }
  return backend;
}
