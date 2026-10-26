import { test, expect } from "@playwright/test";
import { expectArmed } from "./ctl";

// Armed-state E2E (issue #26): point the app at the mock gateway (e2e/
// mock-gateway.mjs), which pushes an armed + ready machine state. Asserts the
// default-deny gating OPENS — the inverse of, and complement to, the
// disconnected smoke test — exercising the full
// backend-permissions -> applyClientOverlay -> fieldset[disabled] pipeline in a
// real browser. The mock serves the app on its own port so the app's
// `location.host/ws` connection lands on the mock WS.
const MOCK = "http://localhost:4174/";

test("connected + armed + ready lifts default-deny on machine controls", async ({ page }) => {
  await page.goto(MOCK);
  // Armed, the permissions applied (expectArmed)...
  await expectArmed(page);
  // ...and a `ready` control opens because the broadcast permissions carry
  // ready=true and the client is armed (no outer fieldset since button
  // gates package C — each control self-gates).
  await expect(page.getByRole("button", { name: "Fwd", exact: true })).toBeEnabled();
});
