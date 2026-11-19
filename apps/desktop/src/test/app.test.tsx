import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createVault, renderApp } from "./render-app";

describe("authentication flow", () => {
  it("creates a vault and unlocks the three-panel workspace", async () => {
    const { user } = renderApp();
    expect(await screen.findByText("Create your vault")).toBeInTheDocument();
    await createVault(user);

    expect(await screen.findByRole("heading", { name: "All Items" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add item/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search vault")).toBeInTheDocument();
    expect(await screen.findByText("GitHub")).toBeInTheDocument();
  });

  it("rejects a mismatched confirmation", async () => {
    const { user } = renderApp();
    await user.type(await screen.findByLabelText("Account name"), "ada");
    await user.type(screen.getByLabelText("Master password"), "Correct-Horse-Battery-42!");
    await user.type(screen.getByLabelText("Confirm master password"), "different-password-42");
    await user.click(screen.getByRole("button", { name: /create encrypted vault/i }));
    expect(await screen.findByText("The passwords do not match")).toBeInTheDocument();
  });

  it("locks and unlocks the vault with the master password", async () => {
    const { user } = renderApp();
    await createVault(user);
    await screen.findByText("GitHub");

    await user.click(screen.getByRole("button", { name: "Lock vault" }));
    expect(await screen.findByText("Unlock your vault")).toBeInTheDocument();

    const password = screen.getByLabelText("Master password");
    await user.type(password, "Correct-Horse-Battery-42!");
    await user.click(screen.getByRole("button", { name: /^unlock$/i }));
    expect(await screen.findByText("GitHub")).toBeInTheDocument();
  });

  it("shows an error for a wrong master password", async () => {
    const { user } = renderApp();
    await createVault(user);
    await screen.findByText("GitHub");
    await user.click(screen.getByRole("button", { name: "Lock vault" }));
    await screen.findByText("Unlock your vault");
    await user.type(screen.getByLabelText("Master password"), "wrong-password-123");
    await user.click(screen.getByRole("button", { name: /^unlock$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/authentication failed/i);
  });
});

describe("vault items", () => {
  it("creates, searches, edits and deletes an item", async () => {
    const { user } = renderApp();
    await createVault(user);
    await screen.findByText("GitHub");

    await user.click(screen.getByRole("button", { name: /add item/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Title"), "Acme Portal");
    await user.type(within(dialog).getByLabelText("Username or email"), "ada@acme.test");
    await user.type(within(dialog).getByLabelText("Password"), "Str0ng-Unique-Passphrase!");
    await user.click(within(dialog).getByRole("button", { name: /add item/i }));

    expect(await screen.findByRole("heading", { name: "Acme Portal" })).toBeInTheDocument();

    const search = screen.getByPlaceholderText("Search vault");
    await user.type(search, "acme");
    await waitFor(() => {
      expect(screen.getAllByText("Acme Portal").length).toBeGreaterThan(0);
      expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
    });
    await user.clear(search);

    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    const editDialog = await screen.findByRole("dialog");
    const title = within(editDialog).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Acme Portal v2");
    await user.click(within(editDialog).getByRole("button", { name: /save changes/i }));
    expect(await screen.findByRole("heading", { name: "Acme Portal v2" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.queryByText("Acme Portal v2")).not.toBeInTheDocument();
    });
  });

  it("filters favorites from the sidebar", async () => {
    const { user } = renderApp();
    await createVault(user);
    await screen.findByText("GitHub");

    await user.click(screen.getAllByRole("button", { name: "Favorites" })[0]);
    expect(await screen.findByText("No favorites yet")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /All Items/ })[0]);
    const rows = await screen.findAllByRole("button", { name: /GitHub/ });
    await user.click(rows[0]);
    await user.click(screen.getByRole("button", { name: "Add to favorites" }));
    await user.click(screen.getAllByRole("button", { name: "Favorites" })[0]);
    expect((await screen.findAllByText("GitHub")).length).toBeGreaterThan(0);
  });

  it("shows the password only when revealed", async () => {
    const { user } = renderApp();
    await createVault(user);
    await screen.findByText("GitHub");
    const rows = await screen.findAllByRole("button", { name: /GitHub/ });
    await user.click(rows[0]);
    expect(await screen.findByText("••••••••••••")).toBeInTheDocument();
    expect(screen.queryByText("Preview-Only-Pass-42!")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show Password" }));
    expect(await screen.findByText("Preview-Only-Pass-42!")).toBeInTheDocument();
  });
});
