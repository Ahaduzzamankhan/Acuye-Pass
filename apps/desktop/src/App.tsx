import { Loader2 } from "lucide-react";
import { HashRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { ToastProvider } from "@/components/toast";
import { TooltipProvider } from "@/components/ui";
import type { Backend } from "@/lib/backend";
import { BackendProvider } from "@/lib/backend-context";
import { AppProvider, useApp } from "@/lib/app-context";
import { useTheme } from "@/hooks/useTheme";
import { AuthenticatorPage } from "@/pages/AuthenticatorPage";
import { DevicesPage } from "@/pages/DevicesPage";
import { SecretsPage } from "@/pages/SecretsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { Onboarding } from "@/pages/Onboarding";
import { SecurityCenter } from "@/pages/SecurityCenter";
import { Unlock } from "@/pages/Unlock";
import { VaultPage } from "@/pages/VaultPage";
import { VaultsPage } from "@/pages/VaultsPage";
import { ShieldCheck } from "lucide-react";

function ThemeBridge() {
  const { settings } = useApp();
  useTheme(settings);
  return null;
}

function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent/50 shadow-lg shadow-accent/20">
        <ShieldCheck className="h-7 w-7 text-white" />
      </div>
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Opening your vault…
      </div>
    </div>
  );
}

/** Auth gate: onboarding → unlock → three-panel workspace. */
function Gate() {
  const { booting, status, session } = useApp();
  if (booting) return <Splash />;
  if (!status?.hasAccount) return <Onboarding />;
  if (!session) return <Unlock />;
  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Gate />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/vault" replace />} />
          <Route path="/vault" element={<VaultPage />} />
          <Route path="/security" element={<SecurityCenter />} />
          <Route path="/authenticator" element={<AuthenticatorPage />} />
          <Route path="/secrets" element={<SecretsPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/vaults" element={<VaultsPage />} />
          <Route path="/settings" element={<Navigate to="/settings/appearance" replace />} />
          <Route path="/settings/:section" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/vault" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default function App({ backend }: { backend?: Backend }) {
  return (
    <BackendProvider backend={backend}>
      <ToastProvider>
        <AppProvider>
          <ThemeBridge />
          <TooltipProvider>
            <HashRouter>
              <AppRoutes />
            </HashRouter>
          </TooltipProvider>
        </AppProvider>
      </ToastProvider>
    </BackendProvider>
  );
}
