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
// E1 (plan Fassung 5 3e, Codex R197): the collision check waits at the same
// hold — read at its starts, whether one runs, and the offsets it read.
const MODEL = new URL("../../examples/sim_config/machine-5axis-xyzac/", import.meta.url);
const machine = JSON.parse(readFileSync(new URL("machine.json", MODEL), "utf8"));
const FILE = "/nc/hold.ngc";
const FEED = [[-50, 0, -100], [50, 0, -100], [50, 20, -100]];
const z9 = (z = 0) => [0, 0, z, 0, 0, 0, 0, 0, 0];
// the envelope's run_basis as the gateway sends it once the start was
// written (scripts/test_fixtures/run_check_wire.json; collisions.viewer.spec)
const RUN = { run_basis: { run_id: 7, state: "sent", file: FILE, source: "s", version: 100, ctx_digest: "d",
  tool_basis_rev: 1, verified: true, why: null,
  start: { g5x_index: 1, g5x_offset: z9(), g92_offset: z9(), rotation_xy: 0, wcs_table: null, tool_number: 0,
           tool_diameter: null, tool_length: null, tool_table_z: null, tool_offset: z9() } } };
const INIT = { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"],
  parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics,
  workGroup: machine.workGroup, toolGroup: machine.toolGroup };

function payload(o: { abc?: boolean; frames?: number[][] } = {}) {
  return Buffer.from(encode({ file: FILE, preview_schema: 11, feed: FEED, feed_lines: [1, 2, 3], feed_seq: [1, 2, 3],
    feed_outside: new Uint8Array(3), rapid: [], violations: [], violations_total: 0,
    ...(o.abc === false ? {} : { feed_abc: FEED.map(() => [0, 0, 0]) }),
    ...(o.frames ? { wcs_frames: o.frames } : {}) }));
}

async function prepare(page: Page, context: BrowserContext, o: {
  bad?: number[]; stall?: number[]; abc?: boolean; frames?: number[][];
  /** The fixture table to send with the live offsets (a machine's G54 row
   *  equals its live G54) — the mock's own (setAxes: G54 = 10.123 …) does not. */
  table?: boolean;
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
  await ctl({ op: "setViewerInit", data: INIT });
  await ctl({ op: "status_delta", data: { active_file: FILE, joint_pos: [0, 0, 0, 0, 0], actual_position: [0, 0, 0, 0, 0],
    g5x_index: 1, g5x_offset: z9(), g92_offset: z9(), tool_offset: z9(), rotation_xy: 0,
    is_enabled: false, enabled: false, interp_state: 1, task_mode: 1,
    ...(o.table ? { wcs_table: ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"]
      .map(name => ({ name, x: 0, y: 0, z: 0, a: 0, c: 0, r: 0 })) } : {}) } });
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
// E1: the check
const activity = (page: Page) => page.evaluate(() => window.__viewerDiag!.getCollisionActivity!());
const holdLog = (page: Page) => page.evaluate(() => window.__viewerDiag!.getCollisionHoldLog!());
const reparseLog = async (page: Page) => (await holdLog(page)).filter(l => l.startsWith("reparse"));
/** The offsets the last main check read: its G54 Z. */
const checkZ = (page: Page) => page.evaluate(() => window.__viewerDiag!.getCollisionBasis!()?.g5x[2] ?? null);
const camera = (page: Page, on: boolean) => page.evaluate(o => window.__viewerDiag!.setCameraHold!(o), on);
/** A check with its result on hand, none running, none parked (a parked
 *  check shows its sweep so far as a result too). */
async function waitChecked(page: Page) {
  await expect.poll(async () => { const a = await activity(page); return !a.busy && !a.resumable && a.result; },
                    { timeout: 30_000 }).toBe(true);
}
/** The 400 ms re-check timer has fired (and found the hold). */
const pastCheckDebounce = (page: Page) => page.waitForTimeout(900);

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

test("the adoption ends the hold: the next offset change re-bakes at once, no window left to wait out", async ({ page, context }) => {
  test.setTimeout(60_000);
  await prepare(page, context);
  const z0 = await boxZ(page);
  await parse(1);
  await waitHold(page, "parsing");
  const g0 = await builds(page);
  await setZ(page, -10);                         // held
  await pastDebounce(page);
  expect(await builds(page)).toBe(g0);
  await parse(null);                             // the parse ends, then its publication arrives
  await waitHold(page, "after_parse");
  await publish(101);
  await expect.poll(async () => (await basis(page)).want ?? "").toContain("101");
  await waitDrawn(page);
  expect(await boxZ(page), "the adoption bakes at the live offsets").toBeCloseTo(z0 - 10, 3);
  expect(await builds(page)).toBe(g0 + 1);
  await setZ(page, -20);                         // no parse: the debounce alone
  await expect.poll(() => builds(page), { message: "re-baked within the debounce, not at a window's end", timeout: 5_000 })
    .toBe(g0 + 2);
  await waitClear(page);
  expect(await boxZ(page)).toBeCloseTo(z0 - 20, 3);
  expect((await basis(page)).hold).toBe("free");
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
  // the run first, then the parse signal: no hold
  await ctl({ op: "status_delta", envelope: RUN, data: { task_mode: 2, interp_state: 2 } });
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
  await ctl({ op: "status_delta", envelope: RUN, data: { task_mode: 2, interp_state: 2 } });
  await waitHold(page, "free");
  await waitDrawn(page);
  expect(await builds(page)).toBe(g + 1);
  await parse(null);
});

test("a run or the simulation beginning in the gap or the loading ends the hold at once — no parse in the status says so", async ({ page, context }) => {
  test.setTimeout(90_000);
  await prepare(page, context, { stall: [101] });
  // the supersede gap: the parse has ended, no preview_refresh in the status
  await parse(1);
  await waitHold(page, "parsing");
  await setZ(page, -10);
  await pastDebounce(page);
  let g = await builds(page);
  await parse(null);
  await waitHold(page, "after_parse");
  await ctl({ op: "status_delta", envelope: RUN, data: { task_mode: 2, interp_state: 2 } });
  await expect.poll(() => builds(page), { message: "caught up at the run's start, not at the 6 s window's end", timeout: 3_000 })
    .toBe(g + 1);
  expect((await basis(page)).hold).toBe("free");
  await ctl({ op: "status_delta", envelope: { run_basis: null }, data: { task_mode: 1, interp_state: 1 } });
  // the loading: the newer version arrived and is never answered
  await parse(2);
  await waitHold(page, "parsing");
  await setZ(page, -20);
  await pastDebounce(page);
  g = await builds(page);
  await parse(null);
  await publish(101);
  await waitHold(page, "loading");
  await page.locator(".scrubBar input.toggle").check();
  await expect(page.locator(".simBanner")).toBeVisible();
  await expect.poll(() => builds(page), { message: "caught up at the simulation's start, not at the 20 s window's end", timeout: 3_000 })
    .toBe(g + 1);
  expect((await basis(page)).hold).toBe("free");
  await page.locator(".scrubBar input.toggle").uncheck();
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

test("a programmed path: the plain epoch of the active fixture is never held nor behind — it follows at once, the check waits (E1)", async ({ page, context }) => {
  test.setTimeout(60_000);
  // one epoch of the active fixture G54 (idx 1), not rewritten: out of scope
  // the table as a machine has it: its G54 row is the live G54 (the mock's
  // own differs, and the path drawn against it is rebased — anchored, not
  // following; whether it arrived before the first build was a race)
  await prepare(page, context, { abc: false, frames: [[0, 1, 0, 0, ...Array(12).fill(0)]], table: true });
  const b = await basis(page);
  expect(b.mode).toBe("programmed");
  expect(b.want, "the path follows the live origin — nothing to bake").toBeNull();
  await waitChecked(page);
  const [g, z0, s0] = [await builds(page), await boxZ(page), (await activity(page)).starts];
  await parse(1);
  // admitted without the path scope (E1): the hold is the check's too
  await waitHold(page, "parsing");
  expect((await basis(page)).admission).toBeNull();
  await sendZ(-10);
  // the drawn path follows its live anchor AT ONCE — geometry, not a build
  await expect.poll(() => boxZ(page), { timeout: 3_000 }).toBeCloseTo(z0 - 10, 3);
  await pastCheckDebounce(page);
  const after = await basis(page);
  expect(after.behind, "never behind: nothing to bake").toBe(false);
  expect(after.held, "no bake asked for, none noted").toBe(false);
  expect(await builds(page), "no re-bake asked for (the scheduler's own exception)").toBe(g);
  expect(after.checkHeld, "the check's restart noted").toBe(true);
  expect((await activity(page)).starts, "no check starts beside the parse").toBe(s0);
  await parse(null);
  await publish(101);
  await expect.poll(async () => (await activity(page)).starts, { timeout: 10_000 }).toBe(s0 + 1);
  await waitChecked(page);
  expect(await checkZ(page), "the adoption's check at the live offsets").toBe(-10);
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

test("a scene rebuild leaves no key vouching for the new geometry: behind until the path is drawn again", async ({ page, context }) => {
  test.setTimeout(60_000);
  await prepare(page, context);
  await page.evaluate(() => window.__viewerDiag!.holdPartFrameReplies!(true));
  await ctl({ op: "setViewerInit", data: INIT });          // the same machine again: a real scene rebuild
  await expect.poll(async () => {
    const b = await basisOrNull(page);
    return b ? { drawn: b.drawn, behind: b.behind } : null;
  }, { timeout: 20_000 }).toEqual({ drawn: null, behind: true });
  await page.evaluate(() => window.__viewerDiag!.holdPartFrameReplies!(false));
  await page.evaluate(() => window.__viewerDiag!.releasePartFrameReplies!());
  await waitClear(page);
});

// Codex R195 VP-I133: a hold's window outlives no viewer. Torn down in the
// gap and in the loading with a change held, the window's end bakes nothing:
// no part-frame worker is created for the gone component, and a reply held
// at the teardown is dropped, not applied.
for (const state of ["after_parse", "loading"] as const) {
  test(`the viewer torn down in ${state} with a change held: no worker after it, no reply applied`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      const log: string[] = [];
      (window as unknown as { __workerLog: string[] }).__workerLog = log;
      const Real = window.Worker;
      window.Worker = class extends Real {
        private label: string;
        constructor(url: string | URL, opts?: WorkerOptions) { super(url, opts); this.label = String(url); log.push(`create ${this.label}`); }
        terminate() { log.push(`terminate ${this.label}`); super.terminate(); }
      } as typeof Worker;
    });
    await prepare(page, context, { stall: [104] });
    // a reply asked for before the hold, still out at the teardown
    await page.evaluate(() => window.__viewerDiag!.holdPartFrameReplies!(true));
    await setZ(page, -5);
    await pastDebounce(page);
    await parse(1);
    await waitHold(page, "parsing");
    await setZ(page, -10);
    await pastDebounce(page);
    expect((await basis(page)).held).toBe(true);
    await parse(null);
    if (state === "loading") await publish(104);   // arrives, never answered
    await waitHold(page, state);
    expect((await basis(page)).checkHeld, "a check restart noted too (E1)").toBe(true);
    const partFrame = (log: string[], kind: string) => log.filter(l => l.startsWith(kind) && l.includes("partFrameWorker")).length;
    const checker = (log: string[]) => log.filter(l => l.startsWith("create") && l.includes("collisionWorker")).length;
    const before = await page.evaluate(() => {
      const app = (document.getElementById("app") as unknown as { __vue_app__?: { unmount(): void } }).__vue_app__;
      if (!app) throw new Error("Vue root not found");
      app.unmount();
      return [...(window as unknown as { __workerLog: string[] }).__workerLog];
    });
    expect(partFrame(before, "terminate"), "the teardown ends its worker").toBe(partFrame(before, "create"));
    // past the window's end (6 s in the gap, 20 s in the loading)
    await page.waitForTimeout(state === "loading" ? 21_000 : 7_000);
    const released = await page.evaluate(() => window.__viewerDiag!.releasePartFrameReplies!());
    expect(released, "a reply held at the teardown is dropped").toBe(0);
    const after = await page.evaluate(() => [...(window as unknown as { __workerLog: string[] }).__workerLog]);
    expect(partFrame(after, "create"), "no part-frame worker after the teardown").toBe(partFrame(before, "create"));
    expect(checker(after), "no check after the teardown (E1)").toBe(checker(before));
  });
}

// Codex R195 VP-I132: the hold asks the CONTROLLER whether the interpreter is
// idle, never whether a run basis says a run — an AUTO run without a run
// basis, an MDI executing and an unknown state hold nothing, and each ends a
// hold already there, in the gap and in the loading too (no parse asks again).
const BUSY = [
  { name: "an AUTO run without a run basis", data: { task_mode: 2, interp_state: 2 }, why: "the interpreter is busy", end: "after_parse" },
  { name: "an MDI executing", data: { task_mode: 3, interp_state: 2 }, why: "the interpreter is busy", end: "loading" },
  { name: "an unknown interpreter state", data: { task_mode: 1, interp_state: null }, why: "interpreter state unknown", end: "after_parse" },
] as const;
const IDLE = { task_mode: 1, interp_state: 1 };
for (const c of BUSY) {
  test(`${c.name}: no hold begins, and one in ${c.end} ends at once with its catch-up`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await prepare(page, context, { stall: [105] });
    const z0 = await boxZ(page);
    // before the parse signal: admitted never, the change re-bakes as without a parse
    await ctl({ op: "status_delta", data: c.data });
    await parse(1);
    await expect.poll(async () => (await basis(page)).admission).toBe(c.why);
    expect((await basis(page)).hold).toBe("free");
    let g = await builds(page);
    await setZ(page, -10);
    await waitDrawn(page);
    expect(await builds(page)).toBe(g + 1);
    // idle again: the same parse holds
    await ctl({ op: "status_delta", data: IDLE });
    await waitHold(page, "parsing");
    await setZ(page, -20);
    await pastDebounce(page);
    expect((await basis(page)).held).toBe(true);
    g = await builds(page);
    await parse(null);
    if (c.end === "loading") await publish(105);    // arrives, never answered
    await waitHold(page, c.end);
    await ctl({ op: "status_delta", data: c.data });
    await expect.poll(() => builds(page), { message: `caught up as the interpreter left idle, not at the ${c.end === "loading" ? 20 : 6} s window's end`, timeout: 3_000 })
      .toBe(g + 1);
    expect((await basis(page)).hold).toBe("free");
    await waitDrawn(page);
    expect(await boxZ(page), "at the live offsets").toBeCloseTo(z0 - 20, 3);
    await ctl({ op: "status_delta", data: IDLE });
  });
}

// ---- E1 (plan basiswechsel-last Fassung 5 3e, Codex R197): the collision
// check waits at the same hold. Beside the gateway's parse its restart took
// the browser's frames; while the program re-parses no check starts, a
// running one pauses (its own worker hold), and the publication brings
// exactly one check of the new version at the live offsets. ----

test("E1: an offset change without a parse re-checks once, at the new offsets", async ({ page, context }) => {
  test.setTimeout(60_000);
  await prepare(page, context);
  await waitChecked(page);
  const s0 = (await activity(page)).starts;
  await setZ(page, -10);
  await expect.poll(async () => (await activity(page)).starts, { timeout: 5_000 }).toBe(s0 + 1);
  await waitChecked(page);
  expect(await checkZ(page)).toBe(-10);
});

test("E1: a running check pauses at the parse signal; later changes start none; the adoption starts ONE check at the live offsets", async ({ page, context }) => {
  test.setTimeout(90_000);
  await prepare(page, context);
  await waitChecked(page);
  const s0 = (await activity(page)).starts;
  // a check still running when the parse begins (a camera hold keeps it so)
  await camera(page, true);
  await setZ(page, -5);
  await expect.poll(async () => (await activity(page)).starts, { timeout: 5_000 }).toBe(s0 + 1);
  expect((await activity(page)).busy).toBe(true);
  await parse(1);
  await waitHold(page, "parsing");
  expect(await reparseLog(page)).toEqual(["reparse on"]);
  // the camera lets go: the re-parse still holds it — no result comes
  await camera(page, false);
  await page.waitForTimeout(2_000);
  let a = await activity(page);
  expect([a.busy, a.result], "still held by the re-parse").toEqual([true, false]);
  // a later change: the paused check ends with its findings, the restart is noted
  await setZ(page, -10);
  await pastCheckDebounce(page);
  a = await activity(page);
  expect(a.starts, "no check starts in the hold").toBe(s0 + 1);
  expect([a.busy, a.result]).toEqual([false, false]);
  expect((await basis(page)).checkHeld).toBe(true);
  await setZ(page, -20);
  await pastCheckDebounce(page);
  expect((await activity(page)).starts, "nor at a third change").toBe(s0 + 1);
  // the publication: ONE check of the new version, at the live offsets
  await parse(null);
  await publish(101);
  await waitHold(page, "free");
  await expect.poll(async () => (await activity(page)).starts, { timeout: 10_000 }).toBe(s0 + 2);
  await waitChecked(page);
  expect(await checkZ(page)).toBe(-20);
  await page.waitForTimeout(1_500);
  expect((await activity(page)).starts, "exactly one").toBe(s0 + 2);
  expect(await reparseLog(page)).toEqual(["reparse on", "reparse off"]);
});

test("E1: the supersede gap sends the check's hold once — not at every window", async ({ page, context }) => {
  test.setTimeout(60_000);
  await prepare(page, context);
  await waitChecked(page);
  await parse(1);
  await waitHold(page, "parsing");
  await parse(null);
  await waitHold(page, "after_parse");
  await parse(2);
  await waitHold(page, "parsing");
  await parse(null);
  await waitHold(page, "after_parse");
  expect(await reparseLog(page), "on once, through the gaps").toEqual(["reparse on"]);
  await publish(101);
  await waitHold(page, "free");
  expect(await reparseLog(page)).toEqual(["reparse on", "reparse off"]);
});

test("E1: a parse that ends without a publication — a noted restart checks once after the gap; without one the paused check goes on", async ({ page, context }) => {
  test.setTimeout(90_000);
  // noted: one check after the 6 s gap, at the live offsets
  await prepare(page, context);
  await waitChecked(page);
  let s0 = (await activity(page)).starts;
  await parse(1);
  await waitHold(page, "parsing");
  await setZ(page, -10);
  await pastCheckDebounce(page);
  expect((await activity(page)).starts).toBe(s0);
  await parse(null);
  await waitHold(page, "after_parse");
  await page.waitForTimeout(4_000);
  expect((await activity(page)).starts, "not before the gap's end").toBe(s0);
  await expect.poll(async () => (await activity(page)).starts, { message: "one check at the gap's end", timeout: 6_000 }).toBe(s0 + 1);
  await waitChecked(page);
  expect(await checkZ(page)).toBe(-10);
  // nothing noted: the check paused by the hold goes on — no new start
  await camera(page, true);
  await setZ(page, -20);
  await expect.poll(async () => (await activity(page)).starts, { timeout: 5_000 }).toBe(s0 + 2);
  s0 += 2;
  await parse(2);
  await waitHold(page, "parsing");
  await camera(page, false);
  await parse(null);
  await waitHold(page, "after_parse");
  await waitHold(page, "free");
  await waitChecked(page);
  expect((await activity(page)).starts, "the paused check went on, none started").toBe(s0);
  expect((await reparseLog(page)).slice(-2)).toEqual(["reparse on", "reparse off"]);
  expect(await checkZ(page)).toBe(-20);
});

test("E1: a run beginning in a hold with a noted restart — the catch-up goes through the auto check: none in the run, one at idle", async ({ page, context }) => {
  test.setTimeout(60_000);
  await prepare(page, context);
  await waitChecked(page);
  const s0 = (await activity(page)).starts;
  await parse(1);
  await waitHold(page, "parsing");
  await setZ(page, -10);
  await pastCheckDebounce(page);
  expect((await basis(page)).checkHeld).toBe(true);
  // an AUTO run without a run basis: the hold ends, its check is held by the run
  await ctl({ op: "status_delta", data: { task_mode: 2, interp_state: 2 } });
  await waitHold(page, "free");
  await pastCheckDebounce(page);
  expect((await activity(page)).starts, "no baseline check in the run").toBe(s0);
  // idle again with the parse still in the status: the hold begins anew and
  // the run's held check is noted in it — still none beside the parse
  await ctl({ op: "status_delta", data: { task_mode: 1, interp_state: 1 } });
  await waitHold(page, "parsing");
  await pastCheckDebounce(page);
  expect((await activity(page)).starts, "none beside the parse").toBe(s0);
  expect((await basis(page)).checkHeld).toBe(true);
  // the parse ends without a publication: one check after the gap
  await parse(null);
  await expect.poll(async () => (await activity(page)).starts, { timeout: 10_000 }).toBe(s0 + 1);
  await waitChecked(page);
  expect(await checkZ(page)).toBe(-10);
});

test("E1: a check parked by a rotary jog under the hold goes on after the hold — never left paused", async ({ page, context }) => {
  test.setTimeout(90_000);
  await prepare(page, context);
  await ctl({ op: "status_delta", data: { rotary_abc: [0, 0, 0] } });
  await waitChecked(page);
  const s0 = (await activity(page)).starts;
  await camera(page, true);
  await setZ(page, -5);
  await expect.poll(async () => (await activity(page)).starts, { timeout: 5_000 }).toBe(s0 + 1);
  await parse(1);
  await waitHold(page, "parsing");
  await camera(page, false);
  await parse(null);
  await waitHold(page, "after_parse");
  await page.waitForTimeout(3_000);
  // a rotary jog parks the check the re-parse holds
  await ctl({ op: "status_delta", data: { rotary_abc: [1, 0, 0] } });
  await expect.poll(async () => (await activity(page)).resumable, { timeout: 5_000 }).toBe(true);
  // the hold ends (the gap's 6 s) before the pose counts as settled (4.5 s
  // after the jog): it lets go of the PARKED check, which the settle continues
  await waitHold(page, "free");
  expect((await activity(page)).resumable, "still parked as the hold ends").toBe(true);
  await waitChecked(page);
  expect((await activity(page)).starts, "continued, not restarted").toBe(s0 + 1);
});

test("E1: the re-parse line's help names the collision check", async ({ page, context }) => {
  test.setTimeout(60_000);
  await prepare(page, context);
  await parse(1);
  await expect(page.locator(".hudWarn", { hasText: "Preview re-parsing" })).toHaveCount(1);
  await expect(page.getByText("Path, limits, collision check and simulation update when it lands", { exact: false })).toHaveCount(1);
  await parse(null);
});

