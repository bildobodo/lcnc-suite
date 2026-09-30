import { test, expect, type Page } from "@playwright/test";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

// The tool setter in the 3D view (operator 2026-09-29): a puck in the machine
// frame, its top face at the contact Z the WebUI's next measurement probes —
// shown only for a tool setter the SERVER confirmed as set up (the fallback
// zeros are no position) and while the "Tool Setter" layer is on.
const SET_UP = {
  touchX: 150, touchY: 0, touchZ: -300, fastFeed: 2000, slowFeed: 200, traverseFeed: 6000,
  maxZTravel: 180, retractDist: 2, spindleZeroHeight: 180,
};

const puck = (page: Page) => page.evaluate(() => {
  const t = window.__viewerDiag?.getToolsetter?.();
  return t ? { visible: t.visible, top: t.top.map(v => Math.round(v * 1000) / 1000) } : null;
});

test("the tool setter shows where it is set up, and only there", async ({ page }) => {
  test.setTimeout(60_000);
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await expect.poll(() => puck(page), { message: "the viewer built the puck", timeout: 20_000 }).not.toBeNull();
  expect((await puck(page))!.visible, "no saved section: nothing to show").toBe(false);

  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { toolsetter: SET_UP } } });
  await expect.poll(() => puck(page), { message: "set up: the top face at the contact position" })
    .toEqual({ visible: true, top: [150, 0, -300] });

  // The layer hides it; back on, it is there again.
  await ctl({ op: "raw", frame: { type: "settings_changed",
    settings: { toolsetter: SET_UP, viewer: { layers: { toolsetter: false } } } } });
  await expect.poll(async () => (await puck(page))?.visible, { message: "the Tool Setter layer is off" }).toBe(false);
  await ctl({ op: "raw", frame: { type: "settings_changed",
    settings: { toolsetter: SET_UP, viewer: { layers: { toolsetter: true } } } } });
  await expect.poll(async () => (await puck(page))?.visible).toBe(true);

  // Moved by another client: follows. A section that is no longer complete: gone.
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { toolsetter: { ...SET_UP, touchX: -120, touchZ: -250 } } } });
  await expect.poll(() => puck(page)).toEqual({ visible: true, top: [-120, 0, -250] });
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { toolsetter: { touchZ: -300 } } } });
  await expect.poll(async () => (await puck(page))?.visible, { message: "a partial section is no position" }).toBe(false);
});
