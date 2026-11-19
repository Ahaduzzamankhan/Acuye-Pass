import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";

// Disable the default WebView context menu everywhere. Text selection and the
// standard copy/paste/select-all keyboard shortcuts keep working; item rows
// provide a custom application context menu.
document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

// Prevent dropping files or links onto the webview navigating away from the
// application shell.
for (const type of ["dragover", "drop"] as const) {
  window.addEventListener(type, (event) => {
    event.preventDefault();
  });
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <h1 className="text-lg font-semibold">Acuye Pass hit an unexpected error</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Your vault on disk is unaffected. Restart the application; if the problem persists,
            restore an encrypted backup from the application data folder.
          </p>
          <button
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
            onClick={() => window.location.reload()}
          >
            Reload interface
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root");

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
