import { test, expect } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

// WS-D — dynamic 9-axis layout guards.
//
// The mock's `setAxes` ctl op re-ships viewer_init with an arbitrary axis
// letter set (and work_pos sized to match), driving every axis-derived
// surface: the SetupStrip touchoff/homing grid and the viewer HUD DRO.
// These specs pin the two properties the 9-axis rework promises:
//   1. one row/button-group PER MACHINE AXIS, in machine order, all visible
//   2. by-letter rendering (a lathe [X,Z] shows Z — no phantom Y between)
//
// Runs in the SERIAL project: setAxes swaps mock-global state, and the reset
// op restores the XYZ baseline for whichever serial spec runs next.
const NINE = ["X", "Y", "Z", "A", "B", "C", "U", "V", "W"];

test.beforeEach(async ({ page }) => {
  await ctl({ op: "reset" });
  await page.goto(MOCK);
  await expect(page.getByRole("button", { name: "Zero X", exact: true })).toBeVisible();
});

test.afterAll(async () => {
  await ctl({ op: "reset" });
});

test("9-axis machine: SetupStrip renders a zero/home group per axis, HUD shows all letters", async ({ page }) => {
  await ctl({ op: "setAxes", axes: NINE });

  // SetupStrip: every axis gets its Zero button (XYZ+ABC in column 1, UVW in
  // column 2), each visible — not clipped away by the grid layout.
  for (const l of NINE) {
    await expect(page.getByRole("button", { name: `Zero ${l}`, exact: true })).toBeVisible();
  }
  // Grid sanity: exactly one zero button per axis, no duplicated rows.
  await expect(page.getByRole("button", { name: /^Zero [XYZABCUVW]$/ })).toHaveCount(9);

  // Viewer HUD DRO: work-position block renders one row per axis with a
  // numeric value (work_pos is index-aligned to the axis list).
  const hud = page.locator(".hud");
  for (const l of NINE) {
    await expect(hud.locator(".hudCoord", { hasText: l }).first()).toBeVisible();
  }
  // Rotary axes format in degrees — the A row carries the ° suffix.
  await expect(hud.locator(".hudCoord", { hasText: "A" }).first()).toContainText("°");

  // Bounding-box check: the 6 primary-column rows (XYZABC) stack without
  // overlap — each row's top edge sits at-or-below the previous row's bottom
  // (1px tolerance for rounding).
  const zeroBtns = page.getByRole("button", { name: /^Zero [XYZABC]$/ });
  const boxes = [];
  for (let i = 0; i < 6; i++) {
    const b = await zeroBtns.nth(i).boundingBox();
    expect(b).not.toBeNull();
    boxes.push(b!);
  }
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i]!.y).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height - 1);
  }
});

test("lathe [X,Z]: renders exactly those axes — Z present, no phantom Y", async ({ page }) => {
  await ctl({ op: "setAxes", axes: ["X", "Z"] });

  await expect(page.getByRole("button", { name: "Zero Z", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Zero [XYZABCUVW]$/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Zero Y", exact: true })).toHaveCount(0);

  // JogStrip: no X/Y pad partner → the Z column still renders (by letter).
  await expect(page.locator(".jogLabel", { hasText: "Z+" }).first()).toBeVisible();
});

test("reset returns the mock to the XYZ baseline", async ({ page }) => {
  await ctl({ op: "setAxes", axes: NINE });
  await expect(page.getByRole("button", { name: "Zero W", exact: true })).toBeVisible();
  await ctl({ op: "reset" });
  await expect(page.getByRole("button", { name: "Zero W", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Zero [XYZABCUVW]$/ })).toHaveCount(3);
});
