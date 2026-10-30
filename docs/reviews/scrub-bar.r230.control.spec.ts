import { test, expect, type Page, type BrowserContext } from "@playwright/test";


import { decode, encode } from "@msgpack/msgpack";


import { readFileSync } from "node:fs";


import { ctl } from "./ctl";


import { openSimTab, simLine, simShow, simStepBtn } from "./simTab";


import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";


import { FROM_WIRE_INIT, oneContact, wireDelta } from "./contactsDelta";


import { ContactStore, GAP_UNDECIDABLE, NONE } from "../src/viewer/contactStore";



// COLLISION jumps on the real 5-axis model (examples/sim_config/machine-
// 5axis-xyzac, the XYZAC config's own machine.json and STLs): the sweep runs
// in the browser worker against the real bodies — the program's sweep on
// load, the entry move's own side sweep once a jump enters the simulation.
const MODEL = new URL("../../examples/sim_config/machine-5axis-xyzac/", import.meta.url);


const machine = JSON.parse(readFileSync(new URL("machine.json", MODEL), "utf8"));



async function prepare(page: Page, context: BrowserContext, o: {
  file: string; version: number; feed: number[][]; lines: number[]; joints: number[]; extra?: Record<string, unknown>;
  /** Runs once the viewer is up, before the program is published. */
  before?: () => Promise<unknown>;
}) {
  const preview = Buffer.from(encode({ file: o.file, preview_schema: 11, feed: o.feed,
    feed_lines: o.lines, feed_seq: o.lines.map((_, i) => i + 1), feed_outside: new Uint8Array(o.feed.length), rapid: [],
    violations: [], violations_total: 0, ...o.extra }));
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: preview }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: 10 }, (_, i) => `G1 X${i} F100`).join("\n") }));
  await context.route("**/xyzac-model/*.stl", r => r.fulfill({ contentType: "application/octet-stream",
    body: readFileSync(new URL(new URL(r.request().url()).pathname.split("/").pop()!, MODEL)) }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"],
    parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics,
    workGroup: machine.workGroup, toolGroup: machine.toolGroup } });
  await ctl({ op: "status_delta", data: { active_file: o.file, joint_pos: o.joints, actual_position: o.joints,
    g5x_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], g92_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], tool_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    rotation_xy: 0, is_enabled: false, enabled: false } });
  if (o.before) await o.before();
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: o.version, file: o.file } });
  // The findings live in the side pane's Simulation tab, its list on the collisions.
  await simShow(page, "clash");
}


const nextHit = (page: Page) => simStepBtn(page, "Next collision");


/** The list's collision rows (the list is filtered to collisions). */
const clashRows = (page: Page) => page.locator(".simPanel tbody tr[data-sim-row]");


const slider = (page: Page) => page.locator(".scrubBar .sliderInput");


const at = async (page: Page) => Number(await slider(page).inputValue());


/** The collision count the findings button reads ("9 collisions"). */
const hitCount = async (page: Page) => clashRows(page).count();


/** The sweep has ended: the findings show from the live partial on ("… so far").
 *  Read from the summary's NAME — its line may show the result as a count
 *  ("3… · entry move still checking", the measured short form). */
const sweepDone = async (page: Page) =>
  !/so far/.test(await page.locator(".simPanel .simSummary .sumItem").first().getAttribute("aria-label") ?? "");



// Codex R33's XYZAC probes: the machine stands at X 300 with the nose at
// Z −380 already INSIDE the yoke — the live pose touches it with several
// pairs. The entry move (300 mm back to the first point) leaves them; the
// program then runs L7 back into the yoke, L8 lifts out. The entry move ends
// at the first point and carries L7, so the entry side sweep's contacts sit
// on the program's own line and pairs (VP-I07), all at the same spot.
const IN_THE_YOKE = { lines: [7, 7, 8], joints: [300, 0, -380, 0, 0],
  feed: [[0, 0, -380], [240, 0, -380], [240, 0, -100]] };



// ---- Plan „Prüfung im Lauf“ 1c / 2 (Codex R112–R115) ----
// L7 traverses into the A yoke (as above): a program with findings.
const RUN_FEED = [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]];


const Z9 = [0, 0, 0, 0, 0, 0, 0, 0, 0];


/** The envelope's run_basis as the gateway sends it once the start was
 *  written (scripts/test_fixtures/run_check_wire.json). */
const runEnv = (file: string, over: Record<string, unknown> = {}) => ({ run_basis: {
  run_id: 7, state: "sent", file, source: "s", version: 4101, ctx_digest: "d", tool_basis_rev: 1,
  start: { g5x_index: 1, g5x_offset: Z9, g92_offset: Z9, rotation_xy: 0, wcs_table: null, tool_number: 0,
           tool_diameter: null, tool_length: null, tool_table_z: null, tool_offset: Z9 },
  verified: true, why: null, ...over } });


const basisOf = (page: Page) => page.evaluate(() => window.__viewerDiag?.getCollisionBasis?.() ?? null);


const g92z = (z: number) => [0, 0, z, 0, 0, 0, 0, 0, 0];



async function runReady(page: Page, context: BrowserContext, file: string, version: number,
  o: { lines?: number[]; extra?: Record<string, unknown> } = {}) {
  await prepare(page, context, { file, version, feed: RUN_FEED, lines: o.lines ?? [1, 6, 7, 8], joints: [-100, 0, 0, 0, 0],
    extra: o.extra });
  await ctl({ op: "status_delta", data: { is_enabled: true, enabled: true, interp_state: 1, task_mode: 1 } });
  await expect(clashRows(page).first(), "the program's collisions, swept at load").toBeVisible({ timeout: 30_000 });
  await expect.poll(() => sweepDone(page), { timeout: 30_000 }).toBe(true);
  const found = await hitCount(page);
  expect(found).toBeGreaterThan(0);
  return found;
}



// ---- Step 4 plan 1c: the card "Check basis" ----
/** The card's text, opened by its trigger (click) and closed again by it —
 *  never by Escape, which is E-Stop. */
async function basisCard(page: Page): Promise<string> {
  const trigger = page.getByRole("button", { name: "Check basis", exact: true });
  await trigger.click();
  const card = page.locator(".helpPopover:popover-open");
  await expect(card).toBeVisible();
  const text = await card.innerText();
  await trigger.click();
  await expect(card).toHaveCount(0);
  return text;
}


const machineCmds = async () => ((await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] }).cmds ?? [])
  .map(c => c.cmd ?? "").filter(c => !["hello", "heartbeat", "get_tool_table", "timing_log", "tab_visibility"].includes(c));



// ---- Plan „Prüfung im Lauf“ 3 (Codex R112–R115): the check during a run ----
/** The envelope's preview_origin for `version` (ordinary unless `forRun`). */
const originEnv = (file: string, version: number, over: Record<string, unknown> = {}) => ({ preview_origin: {
  version, file, source: "s", reason: "file", pinned: false, for_run: null, table: { mtime: 5, rows: "r" },
  tool_basis_rev: 1, tool_basis_rev_now: 1, ...over } });


const pinnedFor = (runId: number) => ({ pinned: true, reason: "midrun:table_mtime",
  for_run: { run_id: runId, ctx_digest: "d", tool_basis_rev: 1 } });


const runLog = (page: Page) => page.evaluate(() => window.__viewerDiag?.getRunCheckLog?.() ?? []);


/** Publish `version` during the run and, once it is on screen, one status
 *  frame (the gateway sends 30 a second; `quiet` sends none): the run watcher
 *  attaches the position to the new track before the auto timer plans. */
async function publishInRun(page: Page, file: string, version: number, over: Record<string, unknown>) {
  await ctl({ op: "status_delta", envelope: originEnv(file, version, over), data: {} });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version, file } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getShownVersion?.() ?? null), { timeout: 10_000 }).toBe(version);
  await ctl({ op: "status_delta", data: { joint_pos: [120, 0, -380, 0, 0], actual_position: [120, 0, -380, 0, 0] } });
}


/** The run on screen at X 120 on L7 (the attached run position the provisional check starts from). */
async function runOnL7(page: Page, file: string, version: number) {
  await ctl({ op: "status_delta", envelope: { ...runEnv(file, { run_id: 9 }), ...originEnv(file, version) },
    data: { interp_state: 2, task_mode: 2, motion_line: 7, joint_pos: [120, 0, -380, 0, 0], actual_position: [120, 0, -380, 0, 0] } });
  await expect(simLine(page)).toHaveText(/L7/);
}



// ---- Codex R116: the provisional result's own limits, and a worker that asks for the bodies ----
type TapReq = { id: number; kind: "provisional" | "full" | "other"; range: number | null; bodies: boolean; dropped: boolean };


interface ColTap {
  reqs: TapReq[];
  /** answer the next request of this kind with "needBodies" (each once) */
  drop: Array<"provisional" | "full">;
  /** hold the full check's result until `release` */
  holdFull: boolean;
  held: Array<() => void>;
  /** fields laid over the provisional result as it arrives */
  patchProvisional: Record<string, unknown> | null;
  /** The provisional request's contact tables as they arrive (round B3: the
   *  views read them): the episodes of these pairs made boundary contacts,
   *  and the contact of `cut.pair` ended at `cut.at` */
  boundaryPairs: Array<[string, string]>;
  cut: { pair: [string, string]; at: number } | null;
}


/** A tap on the page's collision worker: it records the main requests,
 *  answers a chosen one with the worker's own "needBodies" (a worker that
 *  lost the model), lays fields over the provisional result and holds the
 *  full check's result. Installed before the page loads. */
async function installWorkerTap(page: Page) {
  await page.addInitScript(() => {
    const tap = { reqs: [], drop: [], holdFull: false, held: [], patchProvisional: null,
      boundaryPairs: [], cut: null } as unknown as ColTap;
    (window as unknown as { __colTap: ColTap }).__colTap = tap;
    const Real = window.Worker;
    const Tapped = function (url: string | URL, opts?: WorkerOptions) {
      const w = new Real(url, opts);
      if (!/collisionWorker/.test(String(url))) return w;
      const kinds = new Map<number, TapReq["kind"]>();
      let sawRange = false;
      let handler: ((ev: MessageEvent) => unknown) | null = null;
      const post = w.postMessage.bind(w) as (m: unknown, t?: Transferable[]) => void;
      w.postMessage = ((msg: { id: number; track?: unknown; side?: boolean; bodies?: unknown; options?: { range?: { from: number } } },
                        transfer?: Transferable[]) => {
        if (msg && typeof msg === "object" && "track" in msg && !msg.side) {
          const range = msg.options?.range?.from ?? null;
          const kind: TapReq["kind"] = range != null ? "provisional" : sawRange ? "full" : "other";
          if (range != null) sawRange = true;
          kinds.set(msg.id, kind);
          const i = tap.drop.indexOf(kind as "provisional" | "full");
          tap.reqs.push({ id: msg.id, kind, range, bodies: !!msg.bodies, dropped: i >= 0 });
          if (i >= 0) {
            tap.drop.splice(i, 1);
            setTimeout(() => handler?.(new MessageEvent("message", { data: { id: msg.id, needBodies: true } })), 0);
            return;
          }
        }
        post(msg, transfer);
      }) as typeof w.postMessage;
      Object.defineProperty(w, "onmessage", { configurable: true, get: () => handler,
        set: (fn: ((ev: MessageEvent) => unknown) | null) => { handler = fn; } });
      // the provisional request's tables: its pair names and, per table, the
      // pair of each episode row seen so far
      const pairsOf = new Map<number, Array<[string, string]>>(), epPair = new Map<string, number>();
      type Col = Record<string, ArrayLike<number> & { [i: number]: number }>;
      const patchTables = (id: number, contacts: Array<{ episodes: { from: number; count: number; rows: Col; updates: ArrayLike<number>; updated: Col };
                                                       intervals: { from: number; count: number; rows: Col; updates: ArrayLike<number>; updated: Col } }>) => {
        const names = pairsOf.get(id) ?? [];
        const is = (pair: number, ab: [string, string]) => names[pair]?.[0] === ab[0] && names[pair]?.[1] === ab[1];
        contacts.forEach((delta, k) => {
          const eps: Array<[Col, number, (i: number) => number]> = [[delta.episodes.rows, delta.episodes.count, i => delta.episodes.from + i],
            [delta.episodes.updated, delta.episodes.updates.length, i => delta.episodes.updates[i]!]];
          for (const [c, n, rowOf] of eps) for (let i = 0; i < n; i++) {
            const pair = c.pair![i]!;
            epPair.set(`${id}:${k}:${rowOf(i)}`, pair);
            if (tap.boundaryPairs.some(ab => is(pair, ab))) c.flags![i] = (c.flags![i]! & ~3) | 3;
            if (tap.cut && is(pair, tap.cut.pair) && !(c.end![i]! <= tap.cut.at)) c.end![i] = tap.cut.at;
          }
          const ivs: Array<[Col, number]> = [[delta.intervals.rows, delta.intervals.count], [delta.intervals.updated, delta.intervals.updates.length]];
          for (const [c, n] of ivs) for (let i = 0; i < n; i++) {
            const pair = epPair.get(`${id}:${k}:${c.episode![i]}`);
            if (tap.cut && pair !== undefined && is(pair, tap.cut.pair) && !(c.exit![i]! <= tap.cut.at)) c.exit![i] = tap.cut.at;
          }
        });
      };
      w.addEventListener("message", (ev: MessageEvent) => {
        const d = ev.data as { id: number; result?: Record<string, unknown>; contacts?: Parameters<typeof patchTables>[1]; contactPairs?: Array<[string, string]> };
        const kind = d && kinds.get(d.id);
        if (d?.contactPairs) pairsOf.set(d.id, d.contactPairs);
        if (d?.contacts && kind === "provisional") patchTables(d.id, d.contacts);
        if (d?.result && kind === "provisional" && tap.patchProvisional) Object.assign(d.result, structuredClone(tap.patchProvisional));
        if (d?.result && kind === "full" && tap.holdFull) { tap.held.push(() => handler?.(ev)); return; }
        handler?.(ev);
      });
      return w;
    } as unknown as typeof Worker;
    Tapped.prototype = Real.prototype;
    window.Worker = Tapped;
  });
}


const colTap = <T>(page: Page, f: (t: ColTap) => T) =>
  page.evaluate(`(${f.toString()})(window.__colTap)`) as Promise<T>;


const releaseFull = (page: Page) => page.evaluate(() => {
  const t = (window as unknown as { __colTap: ColTap }).__colTap;
  t.holdFull = false;
  for (const h of t.held.splice(0)) h();
});



// Codex R137 VP-I93: a run check's bound beginning is a side sweep; what it
// finds — early (its first confirmed contact) and final — reaches the list
// and the verdict, the beginning said still checking until its result. The
// bar used to take the bare base result: the beginning's findings never
// showed. Real page, decode and main sweep; only the side request's
// transport is answered here (a known contact now, the result later).
/** A run check whose bound beginning's side request the page answers itself;
 *  the main check done, the side request waiting. */
async function sideRunReady(page: Page, context: BrowserContext) {
  await page.addInitScript({ content: FROM_WIRE_INIT });
  await page.addInitScript(() => {
    const tap: any = { side: null, deliver: null, first: null, pairs: null };
    (window as any).__sideTap = tap;
    const Real = window.Worker;
    const Tapped = function (url: string | URL, opts?: WorkerOptions) {
      const w = new Real(url, opts);
      if (!/collisionWorker/.test(String(url))) return w;
      const post = w.postMessage.bind(w);
      let handler: any = null;
      Object.defineProperty(w, "onmessage", { configurable: true, get: () => handler, set: f => { handler = f; } });
      w.addEventListener("message", ev => { if (ev.data?.contactPairs && ev.data.id !== tap.side?.id) tap.pairs = ev.data.contactPairs; handler?.(ev); });
      w.postMessage = ((m: any, t?: Transferable[]) => {
        if (m?.side && m.track) { tap.side = m; tap.deliver = (d: any) => handler?.(new MessageEvent("message", { data: { id: m.id, ...d } })); return; }
        post(m, t ?? []);
      }) as any;
      return w;
    } as any;
    Tapped.prototype = Real.prototype;
    window.Worker = Tapped;
  });
  const file = "/side-run.ngc";
  await runReady(page, context, file, 7137);
  await ctl({ op: "quiet", on: true });
  const start = { ...runEnv(file).run_basis.start, joints: [-100, 0, -100, 0, 0], joints_why: null };
  await ctl({ op: "status_delta", envelope: { ...runEnv(file, { run_id: 9, start }), ...originEnv(file, 7137) },
    data: { interp_state: 2, task_mode: 2, motion_line: 7, joint_pos: [120, 0, -380, 0, 0], actual_position: [120, 0, -380, 0, 0] } });
  // the parse made for the run: a native payload with a start-dependent beginning
  const native = decode(readFileSync(new URL("../../scripts/test_fixtures/start_dep_payloads/e_single.msgpack", import.meta.url))) as any;
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: Buffer.from(encode({ ...native, file })) }));
  await publishInRun(page, file, 7138, pinnedFor(9));
  await expect.poll(() => page.evaluate(() => (window as any).__sideTap.side !== null), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => runLog(page), { timeout: 60_000 }).toContain("done");
  await expect(page.locator(".simPanel .simSummary .sumItem").first()).toHaveAttribute("aria-label", "No contact · start still checking");
  await expect(clashRows(page)).toHaveCount(0);
}


/** The side request's contact table as the spec answers it (the views read
 *  the tables). */
const sideTables = new WeakMap<Page, ContactStore>();


/** The side sweep's first touch, delivered: its table — one contact of the
 *  model's first pair, inside the move from point `seg` to `seg + 1` of the
 *  side track (the line of that move, kept in `first` for the spec). Point 0
 *  is the start the run stood at: the move to point 1 is the entry — the
 *  program's first move from there, whose line the track does not carry
 *  (prependEntry, W2 P6; plan 1.3, C3) — point 1 → 2 the beginning's next
 *  move, of a line the track carries. */
const sideFirst = async (page: Page, seg = 1) => {
  const { id, at, pairs } = await page.evaluate(seg => {
    const t = (window as any).__sideTap;
    return { id: t.side.id as number, at: (t.side.track.cum[seg] + t.side.track.cum[seg + 1]) / 2 as number, pairs: t.pairs as Array<[string, string]> | null };
  }, seg);
  const st = oneContact(id, 0, at, at);
  sideTables.set(page, st);
  await page.evaluate(([w, pairs, seg]) => {
    const t = (window as any).__sideTap, i = seg + 1;
    const [a, b] = pairs?.[0] ?? ["spindle_nose", "a_yoke"];
    t.first = { line: t.side.track.lines[i] || 2, cum: t.side.track.cum[i], cumEnd: t.side.track.cum[i], a, b, dist: 0, rapid: true };
    t.deliver({ progress: 0.2, contacts: [(window as any).__fromWire(w)], contactPairs: pairs ?? [[a, b]] });
  }, [wireDelta(st), pairs, seg] as const);
};


/** The side request's result, its last (empty) delta riding with it. */
const sideResultMsg = async (page: Page) => {
  const w = wireDelta(sideTables.get(page)!);
  await page.evaluate(w => {
    const t = (window as any).__sideTap;
    t.deliver({ contacts: [(window as any).__fromWire(w)], result: { staticContacts: [], samples: 10, coarsened: false,
      uncertified: null, pairCount: 1, pairsPrescreened: 0, bvhMs: 0, sweepMs: 100, truncated: null } });
  }, w);
};



// Codex R138 VP-I93: the beginning's contact before the MAIN request's first
// partial — a main sweep finding nothing posts no partial until it ends, and
// the contact waited for it. The main request's messages are held here (its
// real sweep, its real result), the side request answered by the page.
/** A run check with the main request's messages held and the side request
 *  waiting: nothing shown yet. */
async function sideRunHeld(page: Page, context: BrowserContext, file = "/side-held.ngc") {
  await page.addInitScript({ content: FROM_WIRE_INIT });
  await page.addInitScript(() => {
    const tap: any = { side: null, deliver: null, first: null, hold: false, mainId: null, main: [], raw: null, pairs: null };
    (window as any).__sideTap = tap;
    const Real = window.Worker;
    const Tapped = function (url: string | URL, opts?: WorkerOptions) {
      const w = new Real(url, opts);
      if (!/collisionWorker/.test(String(url))) return w;
      const post = w.postMessage.bind(w);
      let handler: any = null;
      Object.defineProperty(w, "onmessage", { configurable: true, get: () => handler, set: f => { handler = f; } });
      tap.raw = (d: any) => handler?.(new MessageEvent("message", { data: d }));
      w.addEventListener("message", ev => {
        if (ev.data?.contactPairs && ev.data.id !== tap.side?.id) tap.pairs = ev.data.contactPairs;
        if (ev.data?.id === tap.mainId) { tap.main.push(ev.data); return; }
        handler?.(ev);
      });
      w.postMessage = ((m: any, t?: Transferable[]) => {
        if (m?.side && m.track) { tap.side = m; tap.deliver = (d: any) => handler?.(new MessageEvent("message", { data: { id: m.id, ...d } })); return; }
        if (m?.track && tap.hold) { tap.mainId = m.id; tap.main = []; }
        post(m, t ?? []);
      }) as any;
      return w;
    } as any;
    Tapped.prototype = Real.prototype;
    window.Worker = Tapped;
  });
  await runReady(page, context, file, 7137);
  await ctl({ op: "quiet", on: true });
  const start = { ...runEnv(file).run_basis.start, joints: [-100, 0, -100, 0, 0], joints_why: null };
  await ctl({ op: "status_delta", envelope: { ...runEnv(file, { run_id: 9, start }), ...originEnv(file, 7137) },
    data: { interp_state: 2, task_mode: 2, motion_line: 7, joint_pos: [120, 0, -380, 0, 0], actual_position: [120, 0, -380, 0, 0] } });
  const native = decode(readFileSync(new URL("../../scripts/test_fixtures/start_dep_payloads/e_single.msgpack", import.meta.url))) as any;
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: Buffer.from(encode({ ...native, file })) }));
  // from the run's publication on, the main request's messages are held
  await page.evaluate(() => { (window as any).__sideTap.hold = true; });
  await publishInRun(page, file, 7138, pinnedFor(9));
  await expect.poll(() => page.evaluate(() => (window as any).__sideTap.side !== null), { timeout: 30_000 }).toBe(true);
  // the main request's real messages, held — none of them delivered yet
  await expect.poll(() => page.evaluate(() => (window as any).__sideTap.main.some((m: any) => m.result)), { timeout: 60_000 }).toBe(true);
  await expect(page.locator(".simPanel .simSummary .sumItem").first()).toHaveAttribute("aria-label", /^No contact so far/);
  await expect(clashRows(page)).toHaveCount(0);
}


/** The held main request: a running partial of its real result, then the result. */
const mainPartial = (page: Page, covered: number) => page.evaluate(c => {
  const t = (window as any).__sideTap, end = t.main.find((m: any) => m.result);
  t.raw({ id: t.mainId, progress: c, partial: { ...end.result, truncated: { covered: c, reason: "running" } } });
}, covered);


const mainResult = (page: Page) => page.evaluate(() => { const t = (window as any).__sideTap; t.raw(t.main.find((m: any) => m.result)); });


const sideResult = sideResultMsg;


const codeMarks = async (page: Page) => {
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  const n = await page.locator(".codeLine.collision").count();
  await openSimTab(page);
  return n;
};



// Round B4 (plan 3.5): a sweep worker fails mid-run; the request runs again on
// one core as its next generation, and the earlier generation's evidence stays.
// The worker script is served with a hook in front (no seam in the product):
// once a sub-worker's contact reached the coordinator, the sub-workers' words
// wait (so the pool cannot end first), and on the page's word sub-worker 0
// fails. The rerun is held by a camera hold: its own tables have nothing yet.
const FAIL_HOOK = `(() => {
  const RealWorker = self.Worker;
  if (!RealWorker) return;
  const subs = [];
  let held = false;
  self.Worker = function (url, opts) {
    const w = new RealWorker(url, opts);
    subs.push(w);
    let handler = null;
    Object.defineProperty(w, "onmessage", { configurable: true, get: () => handler, set: f => { handler = f; } });
    w.addEventListener("message", e => {
      if (held) return;
      handler && handler(e);
      const c = e.data && e.data.contacts;
      if (c && c.some(d => d.intervals && d.intervals.count > 0)) { held = true; self.postMessage({ __poolHeld: true }); }
    });
    return w;
  };
  self.addEventListener("message", e => {
    if (e.data && e.data.__failShard !== undefined) {
      e.stopImmediatePropagation();
      const w = subs[e.data.__failShard];
      if (w) w.dispatchEvent(new ErrorEvent("error", { message: "a failing sweep worker (test)" }));
    }
  });
})();
`;



// Codex R151 VP-I111: an entry contact the base continues is ONE finding
// after a fallback — the base's alone (the side had ended), both at one
// failure (the side still running) — and a later separate contact of the pair
// stays a finding of its own. Both requests are answered here (no sweep
// runs): the page, the tables' receiver and the view are the product's.
async function joinPage(page: Page, context: BrowserContext, file: string) {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript({ content: FROM_WIRE_INIT });
  await page.addInitScript(() => {
    const tap: any = { main: null, side: null, deliver: null };
    (window as any).__r151 = tap;
    const Real = window.Worker;
    const Tap = function (url: string | URL, opts?: WorkerOptions) {
      const w = new Real(url, opts);
      if (!/collisionWorker/.test(String(url))) return w;
      let handler: any = null;
      Object.defineProperty(w, "onmessage", { configurable: true, get: () => handler, set: f => { handler = f; } });
      w.addEventListener("message", e => handler?.(e));
      tap.deliver = (d: any) => handler?.(new MessageEvent("message", { data: d }));
      // both requests are this spec's: no worker answer races them
      w.postMessage = ((m: any) => { if (m?.track) { if (m.side) tap.side = m; else tap.main = m; } }) as any;
      return w;
    } as any;
    Tap.prototype = Real.prototype;
    window.Worker = Tap;
  });
  await prepare(page, context, { file, version: 29151, lines: [1, 2], joints: [-100, 0, -100, 0, 0], feed: [[0, 0, -100], [10, 0, -100]] });
  await expect.poll(() => page.evaluate(() => (window as any).__r151.main?.id ?? null)).not.toBeNull();
  const main = await page.evaluate(() => { const m = (window as any).__r151.main; return { id: m.id as number, end: m.track.cum[m.track.count - 1] as number }; });
  const pairs = [["spindle_nose", "a_yoke_casting"]];
  const result = { staticContacts: [], samples: 10, coarsened: false, uncertified: null, pairCount: 1, pairsPrescreened: 0, bvhMs: 0, sweepMs: 10,
                   truncated: { covered: 0.5, reason: "running" } };
  const deliver = (d: Record<string, unknown>, w?: ReturnType<typeof wireDelta>) => page.evaluate(([d, w]) => {
    (window as any).__r151.deliver({ ...d, ...(w ? { contacts: [(window as any).__fromWire(w)] } : {}) });
  }, [d, w ?? null] as const);
  // the base in contact from its start to 30 %, running at 50 %
  await deliver({ id: main.id, contactPairs: pairs, progress: 0.5, partial: result }, wireDelta(contactIn(new ContactStore(main.id, 0), 0, 0, 0.3 * main.end)));
  await expect(clashRows(page)).toHaveCount(1);
  await page.locator(".scrubBar").getByRole("checkbox", { name: "Sim" }).check();
  await expect.poll(() => page.evaluate(() => (window as any).__r151.side?.id ?? null)).not.toBeNull();
  const side = await page.evaluate(() => { const m = (window as any).__r151.side; return { id: m.id as number, end: m.track.cum[m.track.count - 1] as number }; });
  // the entry move touches from 20 % to its end: swept whole, it continues into the base's contact
  const entryResult = { ...result, truncated: null };
  const rows = () => clashRows(page).evaluateAll(rs => rs.map(r => r.getAttribute("data-sim-row")));
  const generation = (which: "main" | "entry") => page.evaluate(w => {
    const c = window.__viewerDiag?.getContacts?.();
    // a running side run's tables, else the shown entry result's
    return w === "main" ? c?.main?.generation : c?.side?.generation ?? c?.entry?.tables?.generation;
  }, which);
  const frames = () => page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  return { errors, main, side, pairs, result, entryResult, deliver, rows, generation, frames };
}


/** One more contact of pair 0 in a request's table of a generation. */
function contactIn(st: ContactStore, ordinal: number, at: number, exit: number) {
  const ep = st.episodes.append({ pair: 0, ordinal, flags: 4, onset: at, end: exit, closeAt: at, closeDist: 0, firstIv: 0xffffffff, ivCount: 1 });
  st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: at, exit, flags: Number.isNaN(exit) ? 2 : 6, next: 0xffffffff, witness: at, freeAt: NaN }));
  return st;
}


test('R230 a completed provisional suffix has no stop glyph while the full check runs',async({page,context},info)=>{
 test.setTimeout(90000);
 await installWorkerTap(page);
 const file='/r230-suffix.ngc';
 await runReady(page,context,file,4301);
 await page.evaluate(()=>{(window as unknown as {__colTap:ColTap}).__colTap.holdFull=true;});
 await ctl({op:'quiet',on:true});
 await runOnL7(page,file,4301);
 await publishInRun(page,file,4302,pinnedFor(9));
 await expect.poll(()=>runLog(page),{timeout:60000}).toEqual(['start provisional 1','full']);
 await expect.poll(()=>colTap(page,t=>t.held.length),{timeout:60000}).toBe(1);
 const slot=page.locator('.scrubBar .checkSlot');
 await expect(slot).toHaveText('100 %');
 await expect(slot).toHaveAttribute('title','Collision check: provisional from L7');
 await expect(slot.locator('.checkGlyph')).toHaveCount(0);
 await expect(slot).not.toHaveClass(/text-warn/);
 const data={text:await slot.innerText(),title:await slot.getAttribute('title'),glyphs:await slot.locator('.checkGlyph').count(),cls:await slot.getAttribute('class'),range:await page.evaluate(()=>window.__viewerDiag!.getCollisionRange!()),log:await runLog(page)};
 console.log('R230 completed-suffix '+JSON.stringify(data));
 await page.screenshot({path:info.outputPath('completed-suffix.png')});
 await releaseFull(page);
 await expect.poll(()=>runLog(page),{timeout:30000}).toEqual(['start provisional 1','full','done']);
 await expect(slot).toHaveText('');await expect(slot.locator('.checkGlyph')).toHaveCount(0);
 await expect(slot).not.toHaveClass(/text-warn/);
 await ctl({op:'quiet',on:false});await ctl({op:'reset'});
});
