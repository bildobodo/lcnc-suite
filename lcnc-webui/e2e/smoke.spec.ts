import { test, expect } from "@playwright/test";

// Disconnected smoke tests (issue #26): no gateway is running, so the app loads
// into its default disarmed/disconnected state. These assert the shell mounts
// and that default-deny gating (the IEC-62443-style fieldset cascade) holds.

test("app shell mounts with no gateway connected", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();
  // Armed-gate fieldsets wrap the content area and the bottom strip.
  await expect(page.locator('fieldset[data-gate="armed"]').first()).toBeAttached();
});

test("default-deny: no armed gate is enabled while disconnected", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('fieldset[data-gate="armed"]').first()).toBeAttached();
  // Disconnected => not armed => EVERY armed-gate fieldset is disabled, which
  // cascades to every machine control inside it. Assert none is enabled.
  await expect(page.locator('fieldset[data-gate="armed"]:not([disabled])')).toHaveCount(0);
});

test("Arm control stays reachable in the exempt slot", async ({ page }) => {
  await page.goto("/");
  // SafetyStrip (Arm / E-Stop) lives in the Gate's #exempt slot, so it must be
  // present and NOT inside the disabled fieldset.
  await expect(page.getByRole("button", { name: "Arm", exact: true })).toBeVisible();
});
