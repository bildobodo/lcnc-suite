import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { encode } from "@msgpack/msgpack";
import { readFileSync } from "node:fs";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

// VP188-02 E2 (plan basiswechsel-last Fassung 4, Codex R193/R194): while the
// gateway re-parses the loaded program, an offset change does not re-bake
// the drawn path, and the path stays MUTED until the matching path is
// actually drawn — read at the visible result: the drawn colour (muted or
// not), the drawn path's world box (its anchor), the path's build count —
// beside the diagnostic keys. On the real XYZAC model, in the part frame.
const MODEL = new URL("../../examples/sim_config/machine-5axis-xyzac/", import.meta.url);
const machine = JSON.parse(readFileSync(new URL("machine.json", MODEL), "utf8"));
const FILE = "/nc/hold.ngc";
const FEED = [[-50, 0, -100], [50, 0, -100], [50, 20, -100]];
const z9 = (z = 0) => [0, 0, z, 0, 0, 0, 0, 0, 0];

function payload(o: { abc?: boolean; frames?: number[][] } = {}) {
  return Buffer.from(encode({ file: FILE, preview_schema: 11, feed: FEED, feed_lines: [1, 2, 3], feed_seq: [1, 2, 3],
    feed_outside: new Uint8Array(3), rapid: [], violations: [], violations_total: 0,
    ...(o.abc === false ? {} : { feed_abc: FEED.map(() => [0, 0, 0]) }),
    ...(o.frames ? { wcs_frames: o.frames } : {}) }));
}

async function prepare(page: Page, context: BrowserContext, o: {
  bad?: number[]; stall?: number[]; abc?: boolean; frames?: number[][];
} = {}) {
  const body = payload(o);
  await context.route(/\/preview(\?|$)/, r => {
    const v = Number(new URL(r.request().url()).searchParams.get("v"));
    if (o.stall?.includes(v)) return;           // never answered: that version stays out
    if (o.bad?.includes(v)) return r.fulfill({ contentType: "application/octet-stream", body: Buffer.from([0xc1, 0xc1]) });
    return r.fulfill({ contentType: "application/octet-stream", body });
  });
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: "G1 X-50\nG1 X50\nG1 Y20\n" }));
  await context.route(/\/surface_points(\?|$)/, r => r.fulfill({ status: 503, body: "" }));
  await context.route("**/xyzac-model/*.stl", r => r.fulfill({ contentType: "application/octet-stream",
    body: readFileSync(new URL(new URL(r.request().url()).pathname.split("/").pop()!, MODEL)) }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"],
    parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics,
    workGroup: machine.workGroup, toolGroup: machine.toolGroup } });
  await ctl({ op: "status_delta", data: { active_file: FILE, joint_pos: [0, 0, 0, 0, 0], actual_position: [0, 0, 0, 0, 0],
    g5x_index: 1, g5x_offset: z9(), g92_offset: z9(), tool_offset: z9(), rotation_xy: 0,
    is_enabled: false, enabled: false, interp_state: 1, task_mode: 1 } });
  await publish(100);
  await waitDrawn(page);
}

type Basis = ReturnType<NonNullable<NonNullable<Window["__viewerDiag"]>["getPathBasis"]>>;
const basis = (page: Page) => page.evaluate(() => window.__viewerDiag?.getPathBasis?.() ?? null) as Promise<Basis>;
/** The diag is installed once the model is built — null before. */
const basisOrNull = (page: Page) => page.evaluate(() => window.__viewerDiag?.getPathBasis?.() ?? null);
const builds = (page: Page) => page.evaluate(() => window.__viewerDiag!.getPathMemory!().generation);
/** The path drawn MUTED: its drawn colour is not the feed role's own. */
const muted = (page: Page) => page.evaluate(() => {
  const p = window.__viewerDiag!.getPalette!();
  return p.drawn.feed !== (p.resolved as Record<string, string>).feed;
});
const boxZ = (page: Page) => page.evaluate(() => window.__viewerDiag!.getPathBox!()!.min[2]!);
const sendZ = (z: number) => ctl({ op: "status_delta", data: { g5x_offset: z9(z) } });
/** A G54 Z offset, applied by the page (its wanted key carries it — or, out
 *  of scope, the drawn path's box follows the live origin). */
async function setZ(page: Page, z: number) {
  await sendZ(z);
  await expect.poll(async () => {
    const b = await basis(page);
    return b.want == null || b.want.includes(`[0,0,${z},`);
  }, { timeout: 10_000 }).toBe(true);
}
const parse = (job: number | null) => ctl({ op: "status_delta", data: {}, envelope: { preview_refresh: job == null ? null
  : { reason: "wcsoff:G54:z", file: "hold.ngc", expected_ms: 9000, started_ms: 1, job, queued: false, superseded: 0 } } });
const publish = (version: number) => ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version, file: FILE } });
/** The drawn path is the wanted one: baked, applied, not muted. */
async function waitDrawn(page: Page) {
  await expect.poll(async () => {
    const b = await basisOrNull(page);
    return !!b?.drawn && (b.want === null || b.drawn === b.want) && !b.behind;
  }, { timeout: 20_000 }).toBe(true);
}
/** ...and drawn unmuted: no parse running, nothing behind. */
async function waitClear(page: Page) {
  await waitDrawn(page);
  await expect.poll(() => muted(page)).toBe(false);
}
const waitHold = (page: Page, state: Basis["hold"]) =>
  expect.poll(async () => (await basis(page)).hold, { timeout: 10_000 }).toBe(state);
/** The 300 ms re-bake timer has fired (and found the hold). */
const pastDebounce = (page: Page) => page.waitForTimeout(700);

test.afterEach(async () => {
  await ctl({ op: "reset" });
});

test("an offset change without a parse re-bakes once, at the new offsets", async ({ page, context }) => {
  test.setTimeout(60_000);
  await prepare(page, context);
  const [g0, z0] = [await builds(page), await boxZ(page)];
  await setZ(page, -10);
  await waitDrawn(page);
  expect(await builds(page)).toBe(g0 + 1);
  expect(await boxZ(page)).toBeCloseTo(z0 - 10, 3);
});

test("A→B→A held across the supersede gap and the loading: muted until the matching path is DRAWN (VP193-01)", async ({ page, context }) => {
  test.setTimeout(90_000);
  await prepare(page, context);
  const z0 = await boxZ(page);
  await setZ(page, -10);                         // B: no parse yet — baked at once
  await waitDrawn(page);
  const zB = await boxZ(page);
  expect(zB).toBeCloseTo(z0 - 10, 3);
  await parse(1);
  await waitHold(page, "parsing");
  const g1 = await builds(page);
  await setZ(page, 0);                           // back to A — held
  await pastDebounce(page);
  let b = await basis(page);
  expect(b.held).toBe(true);
  expect(b.behind, "drawn B, wanted A").toBe(true);
  expect(await muted(page)).toBe(true);
  expect(await builds(page)).toBe(g1);
  expect(await boxZ(page)).toBeCloseTo(zB, 3);
  await parse(null);                       // the supersede gap: no parse in the status
  await waitHold(page, "after_parse");
  expect(await muted(page), "muted without a parse and with the preview's basis back at the live one").toBe(true);
  await parse(2);
  await waitHold(page, "parsing");
  // the publication arrives and is adopted — its part-frame reply kept out
  await page.evaluate(() => window.__viewerDiag!.holdPartFrameReplies!(true));
  await publish(101);
  await expect.poll(async () => (await basis(page)).want ?? "").toContain("101");
  b = await basis(page);
  expect(b.drawn).not.toContain("101");
  expect(b.behind, "adopted, not drawn").toBe(true);
  expect(await muted(page)).toBe(true);
  expect(await boxZ(page)).toBeCloseTo(zB, 3);
  await page.evaluate(() => window.__viewerDiag!.holdPartFrameReplies!(false));
  expect(await page.evaluate(() => window.__viewerDiag!.releasePartFrameReplies!())).toBe(1);
  await waitDrawn(page);
  expect(await boxZ(page)).toBeCloseTo(z0, 3);
  expect(await builds(page), "the adoption's bake alone").toBe(g1 + 1);
  await parse(null);
  await waitClear(page);
});

test("the supersede window runs out: ONE catch-up bake — only when a change was held", async ({ page, context }) => {
  test.setTimeout(60_000);
  await prepare(page, context);
  const z0 = await boxZ(page);
  // nothing held: the window ends without a bake
  await parse(1);
  await waitHold(page, "parsing");
  await parse(null);
  await waitHold(page, "after_parse");
  const g0 = await builds(page);
  await waitHold(page, "free");
  await page.waitForTimeout(500);
  expect(await builds(page)).toBe(g0);
  // a held change: one catch-up at the live offsets
  await parse(2);
  await waitHold(page, "parsing");
  await setZ(page, -10);
  await pastDebounce(page);
  expect((await basis(page)).held).toBe(true);
  await parse(null);
  await waitHold(page, "after_parse");
  await waitHold(page, "free");
  await waitClear(page);
  expect(await builds(page)).toBe(g0 + 1);
  expect(await boxZ(page)).toBeCloseTo(z0 - 10, 3);
  await page.waitForTimeout(1000);
  expect(await builds(page), "once").toBe(g0 + 1);
});

test("only THIS decode's failure ends the loading with its catch-up; a surface-points failure does not", async ({ page, context }) => {
  test.setTimeout(60_000);
  await prepare(page, context, { bad: [102] });
  await parse(1);
  await waitHold(page, "parsing");
  await setZ(page, -10);
  await pastDebounce(page);
  const g0 = await builds(page);
  // another channel's failure (the mixed previewLoadError) changes nothing
  await ctl({ op: "raw", frame: { type: "surface_points_ready", version: 7 } });
  await page.waitForTimeout(500);
  expect((await basis(page)).hold).toBe("parsing");
  await parse(null);                       // the parse ends, its publication arrives
  await publish(102);                      // its bytes do not decode
  await waitHold(page, "free");
  await waitClear(page);
  expect(await builds(page)).toBe(g0 + 1);
});

test("the loading has a bound: 20 s without its adoption, one catch-up", async ({ page, context }) => {
  test.setTimeout(90_000);
  await prepare(page, context, { stall: [103] });
  await parse(1);
  await waitHold(page, "parsing");
  await setZ(page, -10);
  await pastDebounce(page);
  const g0 = await builds(page);
  await parse(null);
  await publish(103);                      // arrives, never answered
  await waitHold(page, "loading");
  await page.waitForTimeout(15_000);
  expect((await basis(page)).hold).toBe("loading");
  expect(await muted(page)).toBe(true);
  await expect.poll(async () => (await basis(page)).hold, { timeout: 10_000 }).toBe("free");
  await waitClear(page);
  expect(await builds(page)).toBe(g0 + 1);
});

test("admitted at every refresh: a run already going holds nothing; a run beginning in a hold catches up", async ({ page, context }) => {
  test.setTimeout(60_000);
  await prepare(page, context);
  // the envelope's run_basis as the gateway sends it once the start was
  // written (scripts/test_fixtures/run_check_wire.json; collisions.viewer.spec)
  const run = { run_basis: { run_id: 7, state: "sent", file: FILE, source: "s", version: 100, ctx_digest: "d",
    tool_basis_rev: 1, verified: true, why: null,
    start: { g5x_index: 1, g5x_offset: z9(), g92_offset: z9(), rotation_xy: 0, wcs_table: null, tool_number: 0,
             tool_diameter: null, tool_length: null, tool_table_z: null, tool_offset: z9() } } };
  // the run first, then the parse signal: no hold
  await ctl({ op: "status_delta", envelope: run, data: { task_mode: 2, interp_state: 2 } });
  await parse(1);
  await expect.poll(async () => (await basis(page)).admission).toBe("a run");
  expect((await basis(page)).hold).toBe("free");
  let g = await builds(page);
  await setZ(page, -10);
  await waitDrawn(page);
  expect(await builds(page)).toBe(g + 1);
  await ctl({ op: "status_delta", envelope: { run_basis: null }, data: { task_mode: 1, interp_state: 1 } });
  // a hold, then the run begins: its catch-up
  await parse(2);
  await expect.poll(async () => (await basis(page)).admission, { timeout: 10_000 }).toBeNull();
  await waitHold(page, "parsing");
  await setZ(page, -20);
  await pastDebounce(page);
  g = await builds(page);
  await ctl({ op: "status_delta", envelope: run, data: { task_mode: 2, interp_state: 2 } });
  await waitHold(page, "free");
  await waitDrawn(page);
  expect(await builds(page)).toBe(g + 1);
  await parse(null);
});

test("a lost connection in a hold catches up", async ({ page, context }) => {
  test.setTimeout(60_000);
  await prepare(page, context);
  await parse(1);
  await waitHold(page, "parsing");
  await setZ(page, -10);
  await pastDebounce(page);
  const g = await builds(page);
  await ctl({ op: "refuseWs", on: true });
  await ctl({ op: "shutdownClose" });
  await waitHold(page, "free");
  await expect.poll(() => builds(page)).toBe(g + 1);
  await ctl({ op: "refuseWs", on: false });
});

test("a reply asked for before the hold is drawn with its own anchor; a later held change keeps the path muted", async ({ page, context }) => {
  test.setTimeout(60_000);
  await prepare(page, context);
  const z0 = await boxZ(page);
  await page.evaluate(() => window.__viewerDiag!.holdPartFrameReplies!(true));
  await setZ(page, -10);
  await pastDebounce(page);                // the bake for −10 is asked for, its reply kept out
  await parse(1);
  await waitHold(page, "parsing");
  await setZ(page, -20);                         // held
  await pastDebounce(page);
  await page.evaluate(() => window.__viewerDiag!.holdPartFrameReplies!(false));
  expect(await page.evaluate(() => window.__viewerDiag!.releasePartFrameReplies!())).toBe(1);
  await expect.poll(() => boxZ(page)).toBeCloseTo(z0 - 10, 3);
  const b = await basis(page);
  expect(b.behind, "drawn −10, wanted −20").toBe(true);
  expect(await muted(page)).toBe(true);
  await parse(null);
  await publish(104);
  await waitClear(page);
  expect(await boxZ(page)).toBeCloseTo(z0 - 20, 3);
});

test("the adoption consumes a pending re-bake: no second bake after it", async ({ page, context }) => {
  test.setTimeout(60_000);
  await prepare(page, context);
  await page.evaluate(() => window.__viewerDiag!.setBakeDebounceMs!(3000));
  const g = await builds(page);
  await setZ(page, -10);                         // its re-bake waits 3 s
  await publish(105);                      // adopted well before
  await waitDrawn(page);
  expect(await builds(page)).toBe(g + 1);
  await page.waitForTimeout(3500);
  expect(await builds(page), "the timer was consumed").toBe(g + 1);
  await page.evaluate(() => window.__viewerDiag!.setBakeDebounceMs!(300));
});

test("a programmed path: the plain epoch of the active fixture is never held nor behind", async ({ page, context }) => {
  test.setTimeout(60_000);
  // one epoch of the active fixture G54 (idx 1), not rewritten: out of scope
  await prepare(page, context, { abc: false, frames: [[0, 1, 0, 0, ...Array(12).fill(0)]] });
  const b = await basis(page);
  expect(b.mode).toBe("programmed");
  expect(b.want, "the path follows the live origin — nothing to bake").toBeNull();
  const g = await builds(page);
  await parse(1);
  await sendZ(-10);
  await pastDebounce(page);
  const after = await basis(page);
  expect(after.hold, "no hold — nothing it could hold").toBe("free");
  expect(after.admission).toBe("the path follows the live origin");
  expect(after.behind, "never behind: nothing to bake").toBe(false);
  expect(await builds(page), "no re-bake asked for (the scheduler's own exception)").toBe(g);
  await parse(null);
});

test("a programmed path with a rewritten epoch is held while the program re-parses", async ({ page, context }) => {
  test.setTimeout(60_000);
  await prepare(page, context, { abc: false, frames: [[0, 1, 0, 1, ...Array(12).fill(0)]] });
  let b = await basis(page);
  expect(b.mode).toBe("programmed");
  expect(b.want).not.toBeNull();
  const g = await builds(page);
  await parse(1);
  await waitHold(page, "parsing");
  await setZ(page, -10);
  await pastDebounce(page);
  b = await basis(page);
  expect(b.held).toBe(true);
  expect(b.behind).toBe(true);
  expect(await muted(page)).toBe(true);
  expect(await builds(page)).toBe(g);
  await parse(null);
});

test("a failed part-frame bake: the programmed fallback is drawn, named, and MUTED until the part frame is drawn again", async ({ page, context }) => {
  test.setTimeout(60_000);
  await prepare(page, context);
  const z0 = await boxZ(page);
  await page.evaluate(() => window.__viewerDiag!.failNextPartFrameReply!());
  await setZ(page, -10);
  await expect.poll(async () => (await basis(page)).drawn ?? "", { timeout: 10_000 }).toContain('"programmed"');
  const b = await basis(page);
  expect(b.wantMode, "the display asked for stays the part frame").toBe("part");
  expect(b.want).toContain('"part"');
  expect(b.behind, "a fallback is no current path on the part").toBe(true);
  expect(await muted(page)).toBe(true);
  // the next offset change bakes the part frame again
  await setZ(page, -20);
  await waitClear(page);
  expect((await basis(page)).drawn).toContain('"part"');
  expect(await boxZ(page)).toBeCloseTo(z0 - 20, 3);
});
