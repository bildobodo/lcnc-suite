import { test, expect } from "@playwright/test";

// Disconnected smoke tests (issue #26): no gateway is running, so the app loads
// into its default disarmed/disconnected state. These assert the shell mounts
// and that default-deny holds: since button gates package C there is no outer
// armed fieldset — every machine control self-gates (catalog gate or an inner
// <Gate>), and before the first status every class but `always` is closed.

test("app shell mounts with no gateway connected", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator(".content#content-dialog-area")).toBeAttached();
  await expect(page.locator(".strip")).toBeAttached();
  await expect(page.locator('fieldset[data-gate="armed"]')).toHaveCount(0);
});

test("default-deny: machine controls are closed while disconnected", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Arm", exact: true })).toBeVisible();
  // a spindle start and the overrides: each closed by its own gate (no
  // status → every class but `always` closed; no axes yet → no jog pad)
  for (const name of ["Fwd", "Rev"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  // a <fieldset disabled> is not "disabled" to toBeDisabled (native controls only)
  await expect(page.locator('fieldset[data-gate="override"]').first()).toHaveAttribute("disabled", "");
});

test("Arm control stays reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Arm", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Arm", exact: true })).toBeEnabled();
});
