import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { within } from "@testing-library/react";

import { createVault, renderApp } from "./render-app";

async function openSettings(user: ReturnType<typeof import("./render-app").renderApp>["user"]) {
  await user.click(screen.getByRole("button", { name: "Settings" }));
  expect(await screen.findByRole("heading", { name: "Appearance" })).toBeInTheDocument();
}

describe("settings", () => {
  it("switches themes and persists the preference", async () => {
    const { user } = renderApp();
    await createVault(user);
    await openSettings(user);

    await user.click(screen.getByRole("button", { name: "Red" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("red"));

    const stored = JSON.parse(localStorage.getItem("acuye-preview-state-v1") ?? "{}");
    expect(stored.settings.theme_color).toBe("red");
  });

  it("changes the appearance mode", async () => {
    const { user } = renderApp();
    await createVault(user);
    await openSettings(user);
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
  });

  it("collapses the sidebar and remembers it", async () => {
    const { user } = renderApp();
    await createVault(user);
    await screen.findByText("GitHub", undefined, { timeout: 4000 });
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument();
    });
    const stored = JSON.parse(localStorage.getItem("acuye-preview-state-v1") ?? "{}");
    expect(stored.settings.sidebar_collapsed).toBe(true);
  });

  it("navigates every settings section without placeholder pages", async () => {
    const { user } = renderApp();
    await createVault(user);
    await openSettings(user);
    const sections = [
      "Preferences",
      "Vault Security",
      "Authentication",
      "Devices",
      "Privacy Center",
      "Network",
      "Sync Providers",
      "Data & Storage",
      "Import & Export",
      "Keyboard Shortcuts",
      "Updates",
      "About Acuye Pass",
    ];
    for (const section of sections) {
      await user.click(screen.getByRole("link", { name: section }));
      expect(await screen.findByRole("heading", { name: section })).toBeInTheDocument();
    }
  });

  it("requires explicit consent before enabling a prerelease channel", async () => {
    const { user } = renderApp();
    await createVault(user);
    await openSettings(user);
    await user.click(screen.getByRole("link", { name: "Updates" }));
    const beta = await screen.findByRole("button", { name: /beta/i });
    await user.click(beta);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Prereleases are opt-in/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /enable beta/i }));
    const stored = JSON.parse(localStorage.getItem("acuye-preview-state-v1") ?? "{}");
    await waitFor(() => expect(stored.settings.update_channel).toBe("beta"));
  });
});
