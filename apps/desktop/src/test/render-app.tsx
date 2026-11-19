import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "@/App";
import { DemoBackend } from "@/lib/demo-backend";

/**
 * Render the full application against the in-memory preview backend so UI
 * flows can be exercised without a Tauri runtime. This backend deliberately
 * performs no encryption; cryptographic behaviour is covered by the Rust tests.
 */
export function renderApp() {
  const backend = new DemoBackend();
  const user = userEvent.setup();
  const utils = render(<App backend={backend} />);
  return { ...utils, backend, user };
}

export async function createVault(user: ReturnType<typeof userEvent.setup>, username = "ada") {
  await user.type(await import("@testing-library/react").then((m) => m.screen.findByLabelText("Account name")), username);
  const password = await import("@testing-library/react").then((m) => m.screen.findByLabelText("Master password"));
  await user.type(password, "Correct-Horse-Battery-42!");
  const confirm = await import("@testing-library/react").then((m) => m.screen.findByLabelText("Confirm master password"));
  await user.type(confirm, "Correct-Horse-Battery-42!");
  const submit = await import("@testing-library/react").then((m) => m.screen.findByRole("button", { name: /create encrypted vault/i }));
  await user.click(submit);
}
