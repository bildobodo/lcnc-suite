import { test, expect } from "@playwright/test";
import { ctl as ctlSend, MOCK } from "./ctl";

// Touch-off under kinematics modes (2026-08-30): the backend broadcasts two
// gate classes (touchoff / touchoffRotary) and SetupStrip renders the rotary
// axis controls under the rotary class and the reserved fixtures disabled on
// a TWP machine. This pins the visible layer — what the operator sees is
// what the policy decided.

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  touchoff: true, touchoffRotary: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};

test("Plane mode: rotary touch-off closed, reserved fixtures disabled, Zero All stays open", async ({ page }) => {
  // setAxes re-ships viewer_init to CONNECTED clients — load the page and
  // wait for the first axis rows before asking for the 6-axis set.
  await page.goto(MOCK);
  const zeroA = page.getByRole("button", { name: "Zero A", exact: true });
  const zeroX = page.getByRole("button", { name: "Zero X", exact: true });
  await expect(zeroX).toBeVisible();
  await ctlSend({ op: "setAxes", axes: ["X", "Y", "Z", "A", "C", "B"] });
  await expect(zeroA).toBeVisible();
  // No switchable kins reported (kins_type absent): every fixture selectable.
  await expect(page.locator('input[name="wcs"][value="G59"]')).not.toBeDisabled();
  await ctlSend({ op: "quiet", on: true });
  try {
    await ctlSend({ op: "status_delta", data: {
      kins_type: 2, g5x_index: 6, twp_active: true,
      permissions: { ...PERMS_ALL, touchoffRotary: false },
    } });
    await expect(zeroA).toBeDisabled();
    await expect(zeroX).not.toBeDisabled();
    await expect(page.getByRole("button", { name: "Zero All" })).not.toBeDisabled();
    await expect(page.locator('input[name="wcs"][value="G59"]')).toBeDisabled();
    await expect(page.locator('input[name="wcs"][value="G59.3"]')).toBeDisabled();
    await expect(page.locator('input[name="wcs"][value="G54"]')).not.toBeDisabled();
    // Linear touch-off closed (e.g. TCP off the A=0 datum): inputs + Zero close.
    await ctlSend({ op: "status_delta", data: {
      kins_type: 1, g5x_index: 1,
      permissions: { ...PERMS_ALL, touchoff: false, touchoffRotary: false },
    } });
    await expect(zeroX).toBeDisabled();
    await expect(page.locator("input.setupInput").first()).toBeDisabled();
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});
