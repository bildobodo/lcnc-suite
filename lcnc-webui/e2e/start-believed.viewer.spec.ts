// The believed start on the page (P6-a, machine-day F9; plan
// docs/reviews/maschinentag.r457.p6a-plan-v3.md, Codex R456/R457). The parse's
// `start_believed` is the interpreter's position at the program's first point;
// before, it was the canon's initial `lo` — machine zero, not program zero — so
// on a 3-axis machine with G54 ≠ 0 the simulation's entry move bound the
// beginning a whole fixture off: the machine day's `G53 G0 Z0` ran to
// 2 × G54 in X/Y, diagonally, and the bar's time grew by 8 s (13.555 s for the
// beginning instead of 5.4515 s, the trace's own figure).
//
// The page gets the REAL worker's payloads (scripts/gen_start_dep_payloads.py,
// native LinuxCNC interpreter) and a machine standing at the G54 origin with the
// machine OFF; the spec enters the simulation, puts the scrub at the entry
// move's end and reads the SCENE: the tool tip in the machine frame
// (`__viewerDiag.getToolTip`) and the bar's time. Where the entry ends is
// computed here by the client's own chain over the same payload and pose — only
// WHEN to look; what is seen there is held against the commanded axes alone.
import { test, expect, type Page, type BrowserContext } from "./test";
import { decode, encode } from "@msgpack/msgpack";
import { readFileSync } from "node:fs";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";
import { fulfillPreview, publishFile, routeText } from "./programFixture";
import { decodePreviewStreams } from "../src/previewDecode";
import { buildEntryTrack, buildScrubTrack } from "../src/viewer/scrubTrack";
import { epochTermsFor } from "../src/viewer/wcsEpochs";

const payload = (name: string) =>
  decode(readFileSync(new URL(`../../scripts/test_fixtures/start_dep_payloads/${name}.msgpack`, import.meta.url))) as Record<string, any>;
const nine = (xyz: number[]) => [...xyz, 0, 0, 0, 0, 0, 0];
/** The live fixture table: G54 and G55 as given, the rest zero. */
const table = (g54: number[], g55: number[]) => ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"]
  .map((name, r) => { const v = r === 0 ? g54 : r === 1 ? g55 : [0, 0, 0]; return { name, x: v[0], y: v[1], z: v[2], r: 0 }; });
/** Rounded to the µm, −0 as 0. */
const um = (v: number) => Math.round(v * 1e3) / 1e3 + 0;

/** The entry move's end on the time axis: the client's chain over the payload
 *  and the live pose the page gets (G54 live, G49, the machine at `at`). */
function entryEnd(raw: Record<string, any>, g54: number[], g55: number[], at: number[]): number {
  const d = decodePreviewStreams(raw);
  const base = buildScrubTrack(d.feed, d.rapid, d.kinsFrames, d.wcsEvents, d.subNames, d.tloEvents,
                               d.rotaryCmd, d.startBelieved, d.startUnbound)!;
  const wcs = { g5x: [...g54, 0, 0, 0], g92: [0, 0, 0, 0, 0, 0], rotationDeg: 0, tool: [0, 0, 0] } as any;
  const e = buildEntryTrack(base, at, ["X", "Y", "Z"], wcs, undefined, epochTermsFor(d.wcsEvents!, wcs, table(g54, g55) as any), 0,
                            { linear: raw.rapid_rate, rotary: raw.rot_rapid_rate, axisVmax: raw.axis_vmax, trajVmax: raw.traj_vmax })!;
  return e.cum[1]!;
}

async function simAt(page: Page, context: BrowserContext, name: string, g54: number[], g55: number[], version: number) {
  const file = `/${name}.ngc`;
  const raw = { ...payload(name), file };
  await context.route(/\/preview(\?|$)/, r => fulfillPreview(r, { contentType: "application/octet-stream", body: Buffer.from(encode(raw)) }));
  await routeText(context, "G53 G0 Z0\nM2\n");
  await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === "desktop")!);
  // a head that moves in X, Y and Z over a fixed table (no meshes): the tool
  // group's place is the machine's joints
  await ctl({ op: "setViewerInit", data: { units: "mm", axes: ["X", "Y", "Z"], parts: [],
    groups: [{ id: "table", parent: "root" }, { id: "head", parent: "root" }],
    kinematics: [{ group: "head", joint: 0, direction: "x", sign: 1 }, { group: "head", joint: 1, direction: "y", sign: 1 },
                 { group: "head", joint: 2, direction: "z", sign: 1 }],
    workGroup: "table", toolGroup: "head" } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready ?? false), { timeout: 20_000 }).toBe(true);
  // the machine OFF, standing at the G54 origin under G49
  await ctl({ op: "status_delta", data: { active_file: file, joint_pos: g54, actual_position: g54,
    g5x_index: 1, g5x_offset: nine(g54), g92_offset: nine([0, 0, 0]), tool_offset: nine([0, 0, 0]), rotation_xy: 0,
    wcs_table: table(g54, g55),
    tool_number: 0, is_enabled: false, enabled: false } });
  await publishFile(file, version);
  await expect(page.locator(".scrubBar")).toBeVisible({ timeout: 15_000 });
  await page.locator(".scrubBar").getByRole("checkbox", { name: "Sim" }).check();
  await expect(page.locator(".simBanner")).toBeVisible();
  // the scrub at the entry's end: the slider takes the exact time (its step
  // grid would round it into the next move)
  const t = entryEnd(raw, g54, g55, g54);
  await page.locator(".scrubBar .sliderInput").evaluate((el: HTMLInputElement, v) => {
    el.step = "any"; el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true }));
  }, t);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getScrubPose?.()?.cum ?? null),
    { message: "the scene at the entry's end" }).toBeCloseTo(t, 4);
  // the pose is set at once, the scene is posed in its next frame: read after
  // the frame (a tip that never follows the pose still ends red here) — the
  // P6-e merge gate read it between the two, under load (1 of 1104)
  const read = () => page.evaluate(() => ({ tip: window.__viewerDiag!.getToolTip!(), pose: window.__viewerDiag!.getScrubPose!() }));
  await expect.poll(async () => { const r = await read(); return r.tip!.map(um); }, { message: "the scene's pose: the tool tip's joints" })
    .toEqual((await read()).pose!.joints.slice(0, 3).map(v => um(v!)));
  const { tip } = await read();
  return { tip: tip!.map(um), total: (await page.locator(".scrubBar .posSlot").innerText()).split("/")[1] };
}

test("the machine day's head on a 3-axis machine with G54 ≠ 0: Z up alone to machine 0, the beginning's true time", async ({ page, context }) => {
  test.setTimeout(90_000);
  const g54 = [238.525, 379.696, -96.75];
  const { tip, total } = await simAt(page, context, "mday_head", g54, [0, 0, 0], 9601);
  expect(tip, "the entry ends straight above where the machine stands (before: 2 × G54 in X and Y)").toEqual([238.525, 379.696, 0]);
  // 34.27 s with the beginning's 5.4515 s; 42.37 s before (13.555 s, the diagonal)
  expect(total, "the bar's total with the Z-only beginning (before: 00:42)").toBe("00:34");
  await ctl({ op: "reset" });
});

test("G55 before an X-only first move (Codex R456 MT456-01): only X moves, to G55 X10", async ({ page, context }) => {
  test.setTimeout(90_000);
  const { tip } = await simAt(page, context, "g55_first", [100, 200, -30], [300, 400, -60], 9602);
  expect(tip, "Y and Z stay where the machine stands (before: moved by the fixtures' difference)").toEqual([310, 200, -30]);
  await ctl({ op: "reset" });
});
