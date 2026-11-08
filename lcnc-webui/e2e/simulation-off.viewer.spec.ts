// The simulation per device (settings split package 2, operator 2026-11-07,
// plan Codex R335 SS334-03/04): off, the device runs no collision check —
// no worker, nothing scheduled, nothing on the page that claims a result —
// has no timeline and no Sim tab, and still shows the toolpath, the code
// panel's tool-change marks and the run's line. Switched off mid-check the
// worker ends and every finding goes; a new parse, an offset change or a run
// starts nothing; switched on, a fresh check runs.
import { test, expect, type Page, type BrowserContext } from "./test";
import { encode } from "@msgpack/msgpack";
import { readFileSync } from "node:fs";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

const MODEL = new URL("../../examples/sim_config/machine-5axis-xyzac/", import.meta.url);
const machine = JSON.parse(readFileSync(new URL("machine.json", MODEL), "utf8"));
// L7 traverses the spindle nose into the A yoke (collisions.viewer.spec): a program with findings
const FEED = [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]];
const LINES = [1, 6, 7, 8];
// line 3 changes the tool: its mark sits on line 3, its place where line 6 moves
const TEXT = ["G21", "G90", "T2 M6", "G0 X0", "G0 Z0", "G1 Z-380 F100", "G1 X240", "G1 Z-100", "M2", ""].join("\n");

const work = (page: Page) => page.evaluate(() => window.__viewerDiag!.getSimulationWork!());
const IDLE_WORK = { worker: false, busy: false, result: false, run: false, scheduled: false };
const simTab = (page: Page) => page.getByRole("tab", { name: "Sim", exact: true });

async function prepare(page: Page, context: BrowserContext, file: string, version: number, simulation: boolean) {
  const preview = Buffer.from(encode({ file, preview_schema: 11, feed: FEED, feed_lines: LINES,
    feed_seq: LINES.map((_, i) => i + 1), feed_outside: new Uint8Array(FEED.length), rapid: [],
    violations: [], violations_total: 0 }));
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: preview }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: TEXT }));
  await context.route("**/xyzac-model/*.stl", r => r.fulfill({ contentType: "application/octet-stream",
    body: readFileSync(new URL(new URL(r.request().url()).pathname.split("/").pop()!, MODEL)) }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!, () =>
    ctl({ op: "raw", frame: { type: "settings_init", settings: { simulation: { enabled: simulation } } } }));
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"],
    parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics,
    workGroup: machine.workGroup, toolGroup: machine.toolGroup } });
  await ctl({ op: "status_delta", data: { active_file: file, joint_pos: [-100, 0, 0, 0, 0], actual_position: [-100, 0, 0, 0, 0],
    g5x_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], g92_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], tool_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    rotation_xy: 0, is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version, file } });
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  // the program's marks and path are in: the signal that a check would be under way by now
  await expect(page.locator(".codeLine.toolChange .lineNumber")).toHaveText(["3"]);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.projectRole?.("feed") ?? null)).not.toBeNull();
}

test.afterEach(async () => { await ctl({ op: "reset" }); });

test("a device without the simulation: no check, no timeline, no Sim tab — the path, the tool mark and the run line stay", async ({ page, context }) => {
  test.setTimeout(90_000);
  await prepare(page, context, "/off.ngc", 7101, false);
  expect(await work(page)).toEqual(IDLE_WORK);
  await expect(page.locator(".scrubBar")).toHaveCount(0);
  await expect(simTab(page)).toHaveCount(0);
  await expect(page.locator(".codeLine.collision")).toHaveCount(0);
  // a new parse and an offset change start nothing
  await ctl({ op: "status_delta", data: { g92_offset: [0, 0, 1, 0, 0, 0, 0, 0, 0] } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 7102, file: "/off.ngc" } });
  await expect(page.locator(".codeLine.toolChange .lineNumber")).toHaveText(["3"]);
  expect(await work(page)).toEqual(IDLE_WORK);
  // the run: its line in the code panel, from the program's track — no timeline needed
  // motion_line names line 7: only the projection onto the track says 6
  await ctl({ op: "status_delta", data: { interp_state: 2, task_mode: 2, motion_line: 7, is_enabled: true, enabled: true,
    joint_pos: [0, 0, -200, 0, 0], actual_position: [0, 0, -200, 0, 0] } });
  await expect(page.locator(".codeLine.active .lineNumber")).toHaveText(["6"]);
  expect(await work(page)).toEqual(IDLE_WORK);
});

test("switched off during the check: the worker ends, every finding goes; switched on: a fresh check", async ({ page, context }) => {
  test.setTimeout(120_000);
  await prepare(page, context, "/onoff.ngc", 7201, true);
  await expect(simTab(page)).toHaveCount(1);
  await expect(page.locator(".scrubBar")).toHaveCount(1);
  await expect.poll(() => work(page), { timeout: 30_000 }).toMatchObject({ worker: true });
  // off (another device switched it, or this one): everything goes at once
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { simulation: { enabled: false } } } });
  await expect.poll(() => work(page)).toEqual(IDLE_WORK);
  await expect(page.locator(".scrubBar")).toHaveCount(0);
  await expect(simTab(page)).toHaveCount(0);
  await expect(page.locator(".codeLine.collision")).toHaveCount(0);
  expect(await page.evaluate(() => window.__viewerDiag!.getClashTint!())).toEqual([]);
  await expect(page.locator(".codeLine.toolChange .lineNumber"), "the program's marks stay").toHaveText(["3"]);
  // on again: a fresh check of the program shown
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { simulation: { enabled: true } } } });
  await expect(simTab(page)).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getCollisionSummary!()?.hits ?? null),
                    { timeout: 60_000 }).toBeGreaterThan(0);
  await expect(page.locator(".codeLine.collision").first()).toBeVisible();
});

test("the Sim tab shown when the simulation goes off: the Program tab takes its place", async ({ page, context }) => {
  test.setTimeout(90_000);
  await prepare(page, context, "/tab.ngc", 7301, true);
  await simTab(page).click();
  await expect(page.locator(".simPanel")).toBeVisible();
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { simulation: { enabled: false } } } });
  await expect(page.getByRole("tab", { name: "Program", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".simPanel")).toHaveCount(0);
});

// Codex R338 SS-I05: the Sim tab GOES while it holds the focus — the focus
// comes to the navigation, and the next arrow key moves along the tabs,
// never jogs; a focus elsewhere stays where it is.
const jogs = async () => ((await ctl({ op: "lastCmds" })) as { cmds?: { cmd?: string }[] }).cmds!
  .filter(c => c.cmd === "jog_cont" || c.cmd === "jog_incr" || c.cmd === "jog_stop");
const KEYS = { keyboard: { jogEnabled: true, buttonsEnabled: true } };

for (const where of ["tab", "pane"] as const) {
  test(`the Sim tab goes with the focus in its ${where}: the focus to the navigation, an arrow never jogs`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await prepare(page, context, `/focus-${where}.ngc`, 7400 + (where === "tab" ? 1 : 2), true);
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { ...KEYS, simulation: { enabled: true } } } });
    await simTab(page).click();
    if (where === "tab") await simTab(page).focus();
    else await page.locator(".simPanel").getByRole("button").first().focus();
    await ctl({ op: "clearCmds" });
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { ...KEYS, simulation: { enabled: false } } } });
    await expect(simTab(page)).toHaveCount(0);
    const program = page.getByRole("tab", { name: "Program", exact: true });
    await expect(program).toBeFocused();
    await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight");
    await expect(page.getByRole("tab", { name: "MDI", exact: true }), "the arrow moved along the tabs").toBeFocused();
    expect(await jogs(), "no jog").toEqual([]);
  });
}

test("the Sim tab goes with the focus elsewhere: it stays there", async ({ page, context }) => {
  test.setTimeout(90_000);
  await prepare(page, context, "/focus-else.ngc", 7403, true);
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { ...KEYS, simulation: { enabled: true } } } });
  const mdiTab = page.getByRole("tab", { name: "MDI", exact: true });
  await mdiTab.click();
  const line = page.getByRole("textbox", { name: /MDI/ }).first();
  await line.focus();
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { ...KEYS, simulation: { enabled: false } } } });
  await expect(simTab(page)).toHaveCount(0);
  await expect(line).toBeFocused();
});

// Codex R339 SS-I05 rest: the TIMELINE leaves with the simulation too, and it
// is not in the tab list — a focus on one of its controls comes to the side
// pane's navigation, never body (where the next arrow jogs).
for (const control of ["Open the Sim tab", "Playback speed"] as const) {
  test(`the timeline goes with the focus on "${control}": the focus to the navigation, an arrow never jogs`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await prepare(page, context, `/bar-${control.length}.ngc`, 7500 + control.length, true);
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { ...KEYS, simulation: { enabled: true } } } });
    const target = page.locator(".scrubBar").getByLabel(control, { exact: true });
    await target.focus();
    await expect(target, "the focus is on the timeline's control").toBeFocused();
    await ctl({ op: "clearCmds" });
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { ...KEYS, simulation: { enabled: false } } } });
    await expect(page.locator(".scrubBar")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Program", exact: true })).toBeFocused();
    await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight");
    expect(await jogs(), "no jog").toEqual([]);
  });
}

// ...and nothing moves under a press: the timeline the finger is on stays
// until that press has had its click; the simulation's WORK stops at once.
test("switched off during a press on the timeline: the work stops at once, the bar leaves after the click", async ({ page, context }) => {
  test.setTimeout(90_000);
  await prepare(page, context, "/press.ngc", 7601, true);
  await expect.poll(() => work(page), { timeout: 30_000 }).toMatchObject({ worker: true });
  const link = page.locator(".scrubBar").getByLabel("Open the Sim tab", { exact: true });
  const b = (await link.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { simulation: { enabled: false } } } });
  await expect.poll(() => work(page), { message: "the work stops under the press too" }).toEqual(IDLE_WORK);
  await expect(page.locator(".scrubBar"), "the bar under the finger stays").toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator(".scrubBar")).toHaveCount(0);
});
