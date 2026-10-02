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

// Operator 2026-10-01: zeroing with T13 in the spindle under G49 set G54 at
// the spindle nose — the startup code and every abort run G49 while the
// tool stays, and the drawn (physical) tool showed nothing of it. The Tool
// strip names the offset state, and the viewer pins the CONTROL POINT (what
// the DRO, zeroing and touch-off refer to) while it is not the tool's tip.
test("G49 with a tool in the spindle: the Tool strip says Off, a pin marks the control point at the nose (operator 2026-10-01)", async ({ page, context }) => {
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
  const offsetRow = page.locator('[data-strip="tool"] [data-tool-offset]');
  const pin = () => page.evaluate(() => window.__viewerDiag!.getControlPoint!());
  const tipZ = async () => { const t = await page.evaluate(() => window.__viewerDiag!.getToolTip!()); return t ? Math.round(t[2]! * 1000) / 1000 : null; };
  // G49 with T13 (65 mm) in the spindle
  await ctl({ op: "status_delta", data: { tool_number: 13, tool_length: 65, tool_table_z: 65, tool_diameter: 6, tool_offset: nine(0),
    gcodes: [-1, 0, 170, 400, 490, 540, 800, 900, 940, 210], joint_pos: pose(-235), actual_position: pose(-235) } });
  await expect(offsetRow).toContainText("Off (G49)");
  await expect.poll(async () => (await pin())?.visible ?? null, { message: "the control-point pin shows" }).toBe(true);
  await expect.poll(tipZ).toBe(-300);
  expect(Math.round((await pin())!.world[2]! * 1000) / 1000, "the pin at the nose: the tip + the tool's 65 mm").toBe(-235);
  // G43 H13: the control point is the tip — no pin, the strip says so
  await ctl({ op: "status_delta", data: { tool_offset: nine(65), gcodes: [-1, 0, 170, 400, 430, 540, 800, 900, 940, 210] } });
  await expect(offsetRow).toHaveText("· G43");
  await expect.poll(async () => (await pin())?.visible ?? null).toBe(false);
  // The word is the REPORTED mode, never inferred from a numeric match
  // (Codex R61 VP-I25): a zero-length tool under G49 says G49, a G43.1 of
  // the table's value says G43.1 — neither is a warning, neither has a pin.
  await ctl({ op: "status_delta", data: { tool_table_z: 0, tool_length: 0, tool_offset: nine(0), gcodes: [-1, 0, 170, 400, 490, 540, 800, 900, 940, 210] } });
  await expect(offsetRow).toHaveText("· G49");
  await expect(offsetRow).not.toHaveClass(/\bwarn\b/);
  await ctl({ op: "status_delta", data: { tool_table_z: 65, tool_length: 65, tool_offset: nine(65), gcodes: [-1, 0, 170, 400, 431, 540, 800, 900, 940, 210] } });
  await expect(offsetRow).toHaveText("· G43.1");
  await expect.poll(async () => (await pin())?.visible ?? null).toBe(false);
  // The pin follows the Tool layer at once, with no further status (VP-I26)
  await ctl({ op: "status_delta", data: { tool_offset: nine(0), gcodes: [-1, 0, 170, 400, 490, 540, 800, 900, 940, 210] } });
  await expect.poll(async () => (await pin())?.visible ?? null).toBe(true);
  await ctl({ op: "quiet", on: true });
  for (const on of [false, true]) {
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { tool: on } } } } });
    await expect.poll(async () => (await pin())?.visible ?? null, { message: `Tool layer ${on ? "on" : "off"}: the pin without a status`, timeout: 3_000 }).toBe(on);
  }
  await ctl({ op: "quiet", on: false });
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

// The tool setter and the tool-change position (operator 2026-09-30): pins
// with a label — no model — drawn OVER the machine by default (Settings →
// Layers' "On top" column). From above, the spindle head standing over the
// tool setter hides a pin drawn in depth; on top it shows. Drawn over it
// needs the depth test off AND a draw after the machine (viewer/onTop.ts).
async function xyzacScene(page: Page, context: import("@playwright/test").BrowserContext, g30: () => object | null) {
  await context.route("**/xyzac-model/*.stl", r => r.fulfill({ contentType: "application/octet-stream",
    body: readFileSync(new URL(new URL(r.request().url()).pathname.split("/").pop()!, MODEL)) }));
  await context.route(/\/g30(\?|$)/, r => { const v = g30(); return v ? r.fulfill({ json: v }) : r.fulfill({ status: 500, body: "no parameter file" }); });
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"],
    parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics,
    workGroup: machine.workGroup, toolGroup: machine.toolGroup } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready ? window.__viewerDiag.getAppearance?.().parts.length ?? 0 : 0),
    { timeout: 20_000 }).toBe(machine.parts.length);
  await ctl({ op: "status_delta", data: { tool_number: 13, tool_length: 65, tool_table_z: 65, tool_diameter: 6,
    tool_offset: [0, 0, 65, 0, 0, 0, 0, 0, 0], joint_pos: [150, 0, -235, 0, 0], actual_position: [150, 0, -235, 0, 0] } });
}
const QUIET = { hud: false, toolpath: false, rapids: false, bounds: false, toolpathBounds: false, groundGrid: false, workzero: false, backplot: false };

test("the tool setter is a pin drawn over the machine while on top, hidden by the head when not", async ({ page, context }) => {
  test.setTimeout(60_000);
  await xyzacScene(page, context, () => null);
  const settings = (shown: boolean, onTop: boolean) => ({ toolsetter: SET_UP, display: { theme: "light" },
    viewer: { machineEdges: false, layers: { ...QUIET, toolChange: false, toolsetter: shown }, onTop: { toolsetter: onTop } } });
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: settings(true, true) } });
  await page.evaluate(() => window.__viewerDiag!.setView!("top"));
  await page.waitForTimeout(800);
  const at = (await page.evaluate(() => window.__viewerDiag!.getToolsetter!()))!;
  expect(at).toMatchObject({ visible: true, top: [150, 0, -300], onTop: true });
  /** The pixels within ±48 CSS px of the pin's point. */
  const around = async () => {
    const png = (await page.screenshot()).toString("base64");
    return page.evaluate(async ({ png, x, y }) => {
      const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode();
      const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext("2d", { willReadFrequently: true })!; cx.drawImage(img, 0, 0);
      return Array.from(cx.getImageData(Math.round(x) - 48, Math.round(y) - 48, 97, 97).data);
    }, { png, x: at.screen!.x, y: at.screen!.y });
  };
  const changed = (a: number[], b: number[]) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!)) > 40) n++;
    return n;
  };
  const onTop = await around();
  await test.info().attach("pin-on-top.png", { body: await page.screenshot(), contentType: "image/png" });
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: settings(true, false) } });
  await expect.poll(async () => (await page.evaluate(() => window.__viewerDiag!.getToolsetter!()))?.onTop).toBe(false);
  await page.waitForTimeout(300);
  const inDepth = await around();
  await test.info().attach("pin-in-depth.png", { body: await page.screenshot(), contentType: "image/png" });
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: settings(false, false) } });
  await expect.poll(async () => (await page.evaluate(() => window.__viewerDiag!.getToolsetter!()))?.visible).toBe(false);
  await page.waitForTimeout(300);
  const none = await around();
  const shows = changed(onTop, none), hides = changed(inDepth, none);
  expect(shows, `on top: the pin and its label show over the head (${shows} px differ from no pin)`).toBeGreaterThan(80);
  expect(hides, `in depth: the head hides it (${hides} px differ from no pin)`).toBeLessThan(shows / 10);
});

test("the tool-change pin stands at the stored G30; without a read there is none", async ({ page, context }) => {
  test.setTimeout(60_000);
  let g30: object = { ok: true, values: { X: -100, Y: 50, Z: -20, A: 0, C: 0 }, mtime_ms: 1, units: "mm" };
  await xyzacScene(page, context, () => g30);
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { ...QUIET, toolChange: true } } } } });
  const pin = () => page.evaluate(() => window.__viewerDiag!.getToolChange!());
  await expect.poll(async () => (await pin())?.top).toEqual([-100, 50, -20]);
  expect((await pin())).toMatchObject({ visible: true, onTop: true });
  // the interpreter back to idle (a G30.1, a Save): read again
  g30 = { ok: true, values: { X: 120, Y: -30, Z: -5, A: 0, C: 0 }, mtime_ms: 2, units: "mm" };
  await ctl({ op: "status_delta", data: { interp_state: 2 } });
  await page.waitForTimeout(200);
  await ctl({ op: "status_delta", data: { interp_state: 1 } });
  await expect.poll(async () => (await pin())?.top, { message: "moved with the stored G30" }).toEqual([120, -30, -5]);
  // a missing row: no position, never 0
  g30 = { ok: true, values: { X: 120, Y: null, Z: -5, A: 0, C: 0 }, mtime_ms: 3, units: "mm" };
  await ctl({ op: "status_delta", data: { interp_state: 2 } });
  await page.waitForTimeout(200);
  await ctl({ op: "status_delta", data: { interp_state: 1 } });
  await expect.poll(async () => (await pin())?.visible, { message: "no position, no pin" }).toBe(false);
});

// Codex R50 VP-I19: reads in flight are ordered — two idle edges' reads
// answered in reverse leave the NEWER position, and a late failure takes
// nothing down either.
test("a late G30 read never puts the pin back on an older position (Codex R50 VP-I19)", async ({ page, context }) => {
  test.setTimeout(60_000);
  let value = 100;
  const read = () => ({ ok: true, values: { X: value, Y: 0, Z: -20, A: 0, C: 0 }, mtime_ms: value, units: "mm" });
  await xyzacScene(page, context, read);
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { ...QUIET, toolChange: true } } } } });
  const pin = async () => (await page.evaluate(() => window.__viewerDiag!.getToolChange!()))?.top;
  await expect.poll(pin).toEqual([100, 0, -20]);
  // registered last, so it answers first: every read from here on is held
  const held: { route: import("@playwright/test").Route; data: object }[] = [];
  await context.route(/\/g30(\?|$)/, route => { held.push({ route, data: read() }); });
  const edge = async () => {
    await ctl({ op: "status_delta", data: { interp_state: 2 } });
    await page.waitForTimeout(150);
    await ctl({ op: "status_delta", data: { interp_state: 1 } });
  };
  value = 110; await edge(); await expect.poll(() => held.length).toBe(1);
  value = 120; await edge(); await expect.poll(() => held.length).toBe(2);
  await held[1]!.route.fulfill({ json: held[1]!.data });
  await expect.poll(pin).toEqual([120, 0, -20]);
  await held[0]!.route.fulfill({ json: held[0]!.data });
  await page.waitForTimeout(600);
  expect(await pin(), "the older reply arrived last and changed nothing").toEqual([120, 0, -20]);
  // a late FAILURE of an older read neither hides nor moves the pin
  value = 130; await edge(); await expect.poll(() => held.length).toBe(3);
  value = 140; await edge(); await expect.poll(() => held.length).toBe(4);
  await held[3]!.route.fulfill({ json: held[3]!.data });
  await expect.poll(pin).toEqual([140, 0, -20]);
  await held[2]!.route.fulfill({ status: 500, body: "no parameter file" });
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__viewerDiag!.getToolChange!()), "a late failure changed nothing")
    .toMatchObject({ visible: true, top: [140, 0, -20] });
});

// Codex R50 VP-I18: a Save G30 LinuxCNC confirmed moves the pin at once —
// a short parameter MDI need not show as busy in any status packet, and the
// form said "confirmed" while the pin stood at the old position.
test("a confirmed Save G30 moves the tool-change pin without an idle edge (Codex R50 VP-I18)", async ({ page, context }) => {
  test.setTimeout(60_000);
  const stored = { X: 100, Y: 0, Z: -26.275, A: 0, C: 0 };
  let reads = 0;
  await xyzacScene(page, context, () => { reads++; return { ok: true, values: { ...stored }, mtime_ms: 1, units: "mm" }; });
  const PERMS = { idle: true, jog: true, override: true, ready: true, run: true, pause: false, resume: false, step: true,
    abort: true, probe: true, zero: true, machineFrame: true, g30Capture: true, goZero: true, planeFrame: true,
    touchoff: true, touchoffRotary: true, twpCapture: true, surfaceComp: true, safety: true, setup: true, armed: true, always: true };
  await ctl({ op: "status_delta", data: { permissions: PERMS, kins_type: 0 } });
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { toolsetter: SET_UP,
    viewer: { layers: { ...QUIET, toolChange: true } } } } });
  await ctl({ op: "replies", replies: { set_g30: { ok: true, confirmed: true, values: { ...stored, X: 110 } } } });
  const pin = async () => (await page.evaluate(() => window.__viewerDiag!.getToolChange!()))?.top;
  await expect.poll(pin).toEqual([100, 0, -26.275]);
  await page.getByRole("tab", { name: "Probing", exact: true }).click();
  await page.getByRole("tab", { name: "Toolsetter", exact: true }).click();
  const x = page.getByLabel("G30 X", { exact: true });
  await x.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("110");
  await page.keyboard.press("Enter");
  await expect(x).toHaveValue("110");
  const readsBefore = reads;
  stored.X = 110;   // the confirmed reply: the file holds it now
  await page.getByRole("button", { name: "Save G30", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Toolsetter", exact: true }).locator(".statusNote.ok"))
    .toHaveText("G30 saved — confirmed by LinuxCNC");
  // no busy→idle edge in any status packet: the confirmation alone moves it
  await expect.poll(pin, { message: "the pin follows the confirmed save", timeout: 2_000 }).toEqual([110, 0, -26.275]);
  expect(reads, "handed over, not read again").toBe(readsBefore);
  await ctl({ op: "replies", replies: {} });
});

// Settings → Layers (operator 2026-09-30): an "On top" column for the lines
// and markers — never a body — whose switch draws its layer over the machine
// and is saved per layer.
test("Settings › Layers: an On top column for lines and markers, saved per layer", async ({ page, context }) => {
  test.setTimeout(60_000);
  await xyzacScene(page, context, () => null);
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { toolsetter: SET_UP } } });
  await page.getByTitle("Settings", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("tab", { name: "3D Viewer", exact: true }).click();
  const table = dialog.locator("[data-layer-legend]");
  for (const l of ["toolpath", "rapids", "backplot", "workzero", "workplane", "toolsetter", "toolChange", "toolpathBounds", "bounds", "reachRoom", "reachPart"]) {
    await expect(table.locator(`[data-layer="${l}"] [data-on-top]`), `${l}: offered`).toHaveCount(1);
  }
  for (const l of ["machine", "groundGrid", "tool", "hud", "surface"]) {
    await expect(table.locator(`[data-layer="${l}"] [data-on-top]`), `${l}: a body, never on top`).toHaveCount(0);
  }
  const ts = dialog.getByRole("checkbox", { name: "Tool Setter on top", exact: true });
  await expect(ts, "a marker: on top by default").toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Machine Bounds on top", exact: true }), "a box: not").not.toBeChecked();
  await ctl({ op: "clearCmds" });
  await ts.uncheck();
  await expect.poll(async () => (await page.evaluate(() => window.__viewerDiag!.getToolsetter!()))?.onTop).toBe(false);
  await expect.poll(async () => {
    const cmds = ((await ctl({ op: "lastCmds" })) as { cmds?: any[] }).cmds ?? [];
    const save = cmds.filter(c => c.cmd === "save_settings" && c.section === "viewer").at(-1);
    return save ? JSON.stringify({ ts: save.data.onTop?.toolsetter, bounds: save.data.onTop?.bounds, old: "pathOnTop" in save.data }) : "no save";
  }).toBe(JSON.stringify({ ts: false, bounds: false, old: false }));
});

// The pins carry their own cyan over the dark carrier (operator 2026-10-01:
// "die Toolsetterposition und G30 sind kaum erkennbar mit den Machine
// Bounds"; Codex R62: on all three real pins, light and dark ground, after a
// theme switch and a scene rebuild — CSS tokens and material metadata alone
// prove nothing). Each pin alone, so a neighbour's cyan never stands in.
test("the three pins are cyan over their dark carrier in every theme, after a switch and a rebuild", async ({ page, context }) => {
  test.setTimeout(120_000);
  await xyzacScene(page, context, () => ({ ok: true, values: { X: -100, Y: 50, Z: -20, A: 0, C: 0 }, mtime_ms: 1, units: "mm" }));
  // G49 with T13 in the spindle: the control-point pin at the nose
  await ctl({ op: "status_delta", data: { tool_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], gcodes: [-1, 0, 170, 400, 490, 540, 800, 900, 940, 210] } });
  const PINS = {
    toolsetter: { layers: { toolsetter: true }, diag: "getToolsetter" },
    toolChange: { layers: { toolChange: true }, diag: "getToolChange" },
    controlPoint: { layers: { tool: true }, diag: "getControlPoint" },
  } as const;
  /** Cyan pixels within ±20 CSS px of the pin's point. */
  const cyanNear = async (diag: string) => {
    const at = await page.evaluate(d => (window.__viewerDiag as any)[d]() as { visible: boolean; screen: { x: number; y: number } | null }, diag);
    expect(at?.visible, `${diag}: shown`).toBe(true);
    const png = (await page.screenshot()).toString("base64");
    return page.evaluate(async ({ png, x, y }) => {
      const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode();
      const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext("2d", { willReadFrequently: true })!; cx.drawImage(img, 0, 0);
      const d = cx.getImageData(Math.round(x) - 20, Math.round(y) - 20, 41, 41).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! < 90 && d[i + 1]! > 170 && d[i + 2]! > 190) n++;
      return n;
    }, { png, x: at.screen!.x, y: at.screen!.y });
  };
  const show = async (theme: string, pin: keyof typeof PINS) => {
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { toolsetter: SET_UP, display: { theme },
      viewer: { machineEdges: false, layers: { ...QUIET, toolsetter: false, toolChange: false, tool: false, ...PINS[pin].layers } } } } });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.waitForTimeout(400);
  };
  await page.evaluate(() => window.__viewerDiag!.setView!("front"));
  for (const theme of ["light", "dark", "hc-light", "hc-dark"]) {
    for (const pin of Object.keys(PINS) as (keyof typeof PINS)[]) {
      await show(theme, pin);
      expect(await cyanNear(PINS[pin].diag), `${theme} ${pin}: cyan on the pin`).toBeGreaterThan(6);
    }
  }
  // the drawn role follows the token
  expect((await page.evaluate(() => window.__viewerDiag!.getPalette!())).drawn.markerAlt).toBe("#00e5ff");
  // a scene rebuild keeps them cyan
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"],
    parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics,
    workGroup: machine.workGroup, toolGroup: machine.toolGroup } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready ? window.__viewerDiag.getAppearance?.().parts.length ?? 0 : 0),
    { timeout: 20_000 }).toBe(machine.parts.length);
  await page.evaluate(() => window.__viewerDiag!.setView!("front"));
  for (const pin of Object.keys(PINS) as (keyof typeof PINS)[]) {
    await show("dark", pin);
    expect(await cyanNear(PINS[pin].diag), `after a rebuild, ${pin}: cyan`).toBeGreaterThan(6);
  }
});
