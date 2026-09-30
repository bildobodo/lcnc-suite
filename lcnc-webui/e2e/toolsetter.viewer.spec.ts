import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
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

// Codex R44 ST-I03: the drawn tool is the PHYSICAL one. The tool routine
// switches to G49 for its measurement; the drawn tip followed the active
// offset and jumped a tool length up — while the sim's tool setter (and the
// machine) had the tool where it was — and the backplot drew the jump as a
// stroke. On the real XYZAC model, one joint pose: the tip on the puck under
// G43, the same under G49, the table write moves it with the pen up, real
// motion draws again.
const MODEL = new URL("../../examples/sim_config/machine-5axis-xyzac/", import.meta.url);
const machine = JSON.parse(readFileSync(new URL("machine.json", MODEL), "utf8"));

test("G49 never moves the drawn tool; a table write moves its tip with the backplot's pen up (Codex R44 ST-I03)", async ({ page, context }) => {
  test.setTimeout(60_000);
  await context.route("**/xyzac-model/*.stl", r => r.fulfill({ contentType: "application/octet-stream",
    body: readFileSync(new URL(new URL(r.request().url()).pathname.split("/").pop()!, MODEL)) }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"],
    parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics,
    workGroup: machine.workGroup, toolGroup: machine.toolGroup } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready ? window.__viewerDiag.getAppearance?.().parts.length ?? 0 : 0),
    { timeout: 20_000 }).toBe(machine.parts.length);
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { toolsetter: SET_UP } } });
  const pose = (z: number) => [150, 0, z, 0, 0];
  const nine = (z: number) => [0, 0, z, 0, 0, 0, 0, 0, 0];
  await ctl({ op: "status_delta", data: { tool_number: 13, tool_length: 65, tool_table_z: 65, tool_diameter: 6, tool_offset: nine(65),
    joint_pos: pose(-235), actual_position: pose(-235) } });
  const tipZ = async () => { const t = await page.evaluate(() => window.__viewerDiag!.getToolTip!()); return t ? Math.round(t[2]! * 1000) / 1000 : null; };
  const segs = () => page.evaluate(() => window.__viewerDiag!.getBackplot!().segments);
  await expect.poll(tipZ, { message: "G43: the tip on the puck's top (−235 − 65)" }).toBe(-300);
  expect((await puck(page))!.top[2]).toBe(-300);
  const bp = await segs();

  await ctl({ op: "status_delta", data: { tool_offset: nine(0) } });   // G49 — the routine measures
  await page.waitForTimeout(400);
  expect(await tipZ(), "G49: the tool is where it was").toBe(-300);
  expect(await segs(), "no stroke").toBe(bp);

  await ctl({ op: "status_delta", data: { tool_length: 60, tool_table_z: 60 } });   // the routine's table write
  await expect.poll(tipZ, { message: "the new length: the tip 5 mm higher" }).toBe(-295);
  expect(await segs(), "a length is no motion: the pen is up").toBe(bp);

  await ctl({ op: "status_delta", data: { joint_pos: pose(-240), actual_position: pose(-240) } });
  await expect.poll(tipZ).toBe(-300);
  await expect.poll(segs, { message: "real motion draws again, from the new tip" }).toBe(bp + 1);
});

// Codex R45 ST-I04: the physical offset keeps the table's SIGN (status
// tool_table_z) — tool_length is a magnitude, and a negative table offset
// drawn from it put the tip 130 mm off (−300 for −170). Without a table row no
// physical length is known: the active (signed) offset, as before.
test("the drawn tip keeps the table offset's sign; without a table row it follows the active offset (Codex R45 ST-I04)", async ({ page, context }) => {
  test.setTimeout(60_000);
  await context.route("**/xyzac-model/*.stl", r => r.fulfill({ contentType: "application/octet-stream",
    body: readFileSync(new URL(new URL(r.request().url()).pathname.split("/").pop()!, MODEL)) }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"],
    parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics,
    workGroup: machine.workGroup, toolGroup: machine.toolGroup } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready ? window.__viewerDiag.getAppearance?.().parts.length ?? 0 : 0),
    { timeout: 20_000 }).toBe(machine.parts.length);
  const pose = (z: number) => [150, 0, z, 0, 0];
  const nine = (z: number) => [0, 0, z, 0, 0, 0, 0, 0, 0];
  const tipZ = async () => { const t = await page.evaluate(() => window.__viewerDiag!.getToolTip!()); return t ? Math.round(t[2]! * 1000) / 1000 : null; };
  // a NEGATIVE table offset under its own G43: the tip where the control puts it
  await ctl({ op: "status_delta", data: { tool_number: 7, tool_length: 65, tool_table_z: -65, tool_diameter: 6,
    tool_offset: nine(-65), joint_pos: pose(-235), actual_position: pose(-235) } });
  await expect.poll(tipZ, { message: "G43 with −65: −235 + 65" }).toBe(-170);
  await ctl({ op: "status_delta", data: { tool_offset: nine(0) } });   // G49
  await page.waitForTimeout(400);
  expect(await tipZ(), "G49: the physical tool, sign kept").toBe(-170);
  // no table row: the gateway's tool_length is |active offset| — only the
  // active offset carries a sign, and it is what the control applies
  await ctl({ op: "status_delta", data: { tool_number: 9, tool_length: 65, tool_table_z: null, tool_offset: nine(-65) } });
  await expect.poll(tipZ, { message: "no row, G43 −65" }).toBe(-170);
  await ctl({ op: "status_delta", data: { tool_length: 0, tool_offset: nine(0) } });
  await expect.poll(tipZ, { message: "no row, G49: nothing known beyond the control point" }).toBe(-235);
});
