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


export { prepare, basis, builds, muted, boxZ, setZ, sendZ, parse, publish, waitDrawn, waitClear, waitHold, pastDebounce, z9, FILE };
