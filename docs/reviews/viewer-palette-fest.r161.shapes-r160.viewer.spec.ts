// MEASUREMENT (not part of the gate; copied in as e2e/zz_longtask5.viewer.spec.ts
// and never committed): plan 3.6's browser acceptance at the budget. A
// request's tables reach the page (the worker tapped, its messages delivered
// from page-made tables), and for each step: the long tasks (> 50 ms, the
// browser's own observer), the input delay of pointer moves made meanwhile,
// the publisher's passes / discards, the tables' memory by owner, the JS heap
// and the DOM. Shapes: many pairs (one generation, an update delta over the
// whole budget, a fallback, an empty delta), one pair (a cancel while its one
// big group builds).
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";
import { simShow } from "./simTab";

const MODEL = new URL("../../examples/sim_config/machine-5axis-xyzac/", import.meta.url);
const machine = JSON.parse(readFileSync(new URL("machine.json", MODEL), "utf8"));
const OUT = process.env.LT_OUT ?? "/tmp/longtask3.json";
const PAIRS = Number(process.env.LT_PAIRS ?? 65536);

async function prepare(page: Page, context: BrowserContext) {
  const feed = [[0, 0, -100], [10, 0, -100]], lines = [1, 2];
  const preview = Buffer.from(encode({ file: "/lt.ngc", preview_schema: 11, feed, feed_lines: lines, feed_seq: [1, 2],
    feed_outside: new Uint8Array(2), rapid: [], violations: [], violations_total: 0 }));
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: preview }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: "G1 X0 F100\nG1 X10" }));
  await context.route("**/xyzac-model/*.stl", r => r.fulfill({ contentType: "application/octet-stream",
    body: readFileSync(new URL(new URL(r.request().url()).pathname.split("/").pop()!, MODEL)) }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"],
    parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics, workGroup: machine.workGroup, toolGroup: machine.toolGroup } });
  await ctl({ op: "status_delta", data: { active_file: "/lt.ngc", joint_pos: [-100, 0, -100, 0, 0], actual_position: [-100, 0, -100, 0, 0],
    g5x_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], g92_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], tool_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    rotation_xy: 0, is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 4401, file: "/lt.ngc" } });
  await simShow(page, "clash");
  // the page at rest before anything is measured: the model loaded, its
  // edges built — no long task for 2 s (at most 60 s)
  const t0 = Date.now();
  await page.evaluate(() => { (window as any).__lt = []; });
  let quietSince = Date.now(), seen = 0;
  while (Date.now() - quietSince < 2000 && Date.now() - t0 < 60_000) {
    await page.waitForTimeout(250);
    const n = await page.evaluate(() => (window as any).__lt.length);
    if (n !== seen) { seen = n; quietSince = Date.now(); }
  }
}

/** Every page error (a query of a retired view would throw one). */
const errors: string[] = [];
async function tap(page: Page) {
  page.on("pageerror", e => errors.push(String(e.message)));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.addInitScript(() => {
    const w = window as any;
    w.__lt = [];
    w.__in = [];
    w.__loaf = [];
    // the long frames with their scripts (Chromium's Long Animation Frames)
    new PerformanceObserver(l => {
      for (const e of l.getEntries() as any[]) {
        if (e.duration < 50) continue;
        const end = e.startTime + e.duration;
        w.__loaf.push({ ms: Math.round(e.duration), blocking: Math.round(e.blockingDuration),
          render: e.renderStart ? Math.round(end - e.renderStart) : 0, styleLayout: e.styleAndLayoutStart ? Math.round(end - e.styleAndLayoutStart) : 0,
          scripts: e.scripts.map((x: any) => ({ inv: x.invoker, fn: x.sourceFunctionName, url: String(x.sourceURL).split("/").pop(), at: x.sourceCharPosition,
                                                 ms: Math.round(x.duration), forced: Math.round(x.forcedStyleAndLayoutDuration) })) });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) w.__lt.push({ at: e.startTime, ms: e.duration }); }).observe({ type: "longtask", buffered: true });
    // the input delay: from the event's creation to its handler
    window.addEventListener("pointermove", e => { w.__in.push(performance.now() - e.timeStamp); }, { capture: true });
    // a discrete input (not aligned to the frame like a move): Shift alone, bound to nothing
    w.__key = [];
    window.addEventListener("keydown", e => { if (e.key === "Shift") w.__key.push(performance.now() - e.timeStamp); }, { capture: true });
    const t: any = { main: null, deliver: null, acks: 0 };
    w.__ltTap = t;
    const Real = window.Worker;
    const Tap = function (url: string | URL, opts?: WorkerOptions) {
      const wk = new Real(url, opts);
      if (!/collisionWorker/.test(String(url))) return wk;
      let handler: any = null;
      Object.defineProperty(wk, "onmessage", { configurable: true, get: () => handler, set: f => { handler = f; } });
      wk.addEventListener("message", e => handler?.(e));
      t.deliver = (d: any) => handler?.(new MessageEvent("message", { data: d }));
      // a message made beforehand (the test's own table building is not measured)
      t.ready = null;
      t.deliverReady = () => { const d = t.ready; t.ready = null; handler?.(new MessageEvent("message", { data: d })); };
      wk.postMessage = ((m: any) => { if (m?.track && !m.side) t.main = m; if (m?.contactsAck != null) t.acks++; }) as any;
      return wk;
    } as any;
    Tap.prototype = Real.prototype;
    window.Worker = Tap;
    const cols = (E: number, I: number) => ({
      ep: { pair: new Uint32Array(E), ordinal: new Uint32Array(E), flags: new Uint16Array(E), onset: new Float64Array(E), end: new Float64Array(E),
            closeAt: new Float64Array(E), closeDist: new Float32Array(E), firstIv: new Uint32Array(E), ivCount: new Uint32Array(E) },
      iv: { episode: new Uint32Array(I), enter: new Float64Array(I), exit: new Float64Array(I), flags: new Uint8Array(I), next: new Uint32Array(I),
            witness: new Float64Array(I), freeAt: new Float64Array(I), freeR: new Float32Array(I) } });
    /** E episodes of four contacts each; `onePair`: all of pair 0 (one big group). */
    w.__ltTables = (end: number, E: number, onePair: boolean, shift = 0) => {
      const I = 4 * E, step = end / (E + 2), c = cols(E, I);
      for (let e = 0; e < E; e++) {
        const b = (e + 1) * step;
        c.ep.pair[e] = onePair ? 0 : e; c.ep.ordinal[e] = onePair ? e : 0; c.ep.flags[e] = 4; c.ep.onset[e] = b; c.ep.end[e] = b + 0.9 * step;
        c.ep.closeAt[e] = b; c.ep.firstIv[e] = 4 * e; c.ep.ivCount[e] = 4;
        for (let k = 0; k < 4; k++) {
          const r = 4 * e + k, a = b + k * 0.2 * step;
          c.iv.episode[r] = e; c.iv.enter[r] = a; c.iv.exit[r] = a + 0.1 * step; c.iv.flags[r] = 6; c.iv.next[r] = k < 3 ? r + 1 : 0xffffffff;
          c.iv.witness[r] = a + shift * 0.01 * step; c.iv.freeAt[r] = a + 0.15 * step; c.iv.freeR[r] = 0.02 * step;
        }
      }
      return c;
    };
    const none = { pair: new Uint32Array(0), start: new Float64Array(0), end: new Float64Array(0), reason: new Uint8Array(0) };
    const empty = (from: number) => ({ from, count: 0, rows: {}, updates: new Uint32Array(0), updated: {} });
    /** The whole tables as new rows. */
    w.__ltDelta = (id: number, generation: number, end: number, E: number, onePair: boolean) => {
      const c = w.__ltTables(end, E, onePair);
      const t = (rows: Record<string, ArrayLike<number>>, n: number) => ({ from: 0, count: n, rows, updates: new Uint32Array(0), updated: {} });
      return { request: id, generation, episodes: t(c.ep, E), intervals: t(c.iv, 4 * E), gaps: t(none, 0) };
    };
    /** Every interval row updated (a moved witness): the update delta over the whole budget (Codex R155). */
    w.__ltUpdate = (id: number, generation: number, end: number, E: number, onePair: boolean) => {
      const c = w.__ltTables(end, E, onePair, 1), I = 4 * E;
      const updates = new Uint32Array(I);
      for (let r = 0; r < I; r++) updates[r] = r;
      return { request: id, generation, episodes: empty(E), intervals: { from: I, count: 0, rows: {}, updates, updated: c.iv }, gaps: empty(0) };
    };
    w.__ltEmpty = (id: number, generation: number, E: number) => ({ request: id, generation, episodes: empty(E), intervals: empty(4 * E), gaps: empty(0) });
    /** Codex R158's shapes at the budget, one generation: a rapid/feed
     *  alternation (every contact ended at the feed, no free sample — one
     *  episode, its later rapid parts continuing the cut), a coarse contact
     *  over a finer run's every contact without a free sample, a chain of the
     *  two runs' contacts, one open contact over the gap budget of
     *  undecidable gaps. */
    w.__ltShape = (id: number, generation: number, end: number, kind: string) => {
      const I0 = 262144, G0 = 16384;
      const one = kind === "gaps" || (kind === "coarseFine" && generation === 0);
      const I = one ? 1 : I0, c = cols(1, I), step = end / (I0 + 2);
      c.ep.pair[0] = 0; c.ep.ordinal[0] = 0; c.ep.flags[0] = 4; c.ep.onset[0] = step; c.ep.closeAt[0] = step; c.ep.firstIv[0] = 0; c.ep.ivCount[0] = I;
      for (let k = 0; k < I; k++) {
        const shift = kind === "chain" && generation === 1 ? 0.5 : 0;
        const a = (k + 1 + shift) * step;
        c.iv.episode[k] = 0; c.iv.next[k] = k + 1 < I ? k + 1 : 0xffffffff; c.iv.freeAt[k] = NaN; c.iv.freeR[k] = 0;
        c.iv.enter[k] = a; c.iv.witness[k] = a + 0.25 * step;
        if (kind === "gaps") { c.iv.exit[k] = NaN; c.iv.flags[k] = 2; }
        else if (one) { c.iv.exit[k] = end - step; c.iv.flags[k] = 6; }
        else { c.iv.exit[k] = a + (kind === "chain" ? 0.6 : 0.5) * step; c.iv.flags[k] = 2 | 32 | (kind === "alternation" && k > 0 ? 64 : 0); }
      }
      c.ep.end[0] = kind === "gaps" ? NaN : c.iv.exit[I - 1]!;
      const G = kind === "gaps" ? G0 : 0, gs = end / (2 * G0 + 4);
      const gaps = { pair: new Uint32Array(G), start: new Float64Array(G), end: new Float64Array(G), reason: new Uint8Array(G) };
      for (let g = 0; g < G; g++) { gaps.start[g] = (2 * g + 2) * gs; gaps.end[g] = (2 * g + 2.5) * gs; gaps.reason[g] = 1; }
      const t = (rows: Record<string, ArrayLike<number>>, n: number) => ({ from: 0, count: n, rows, updates: new Uint32Array(0), updated: {} });
      return { request: id, generation, episodes: t(c.ep, 1), intervals: t(c.iv, I), gaps: t(gaps, G) };
    };
    /** Codex R160's chain at the budget (`refuted`: each run's free sample on
     *  the other run's witness, every one refuted) and one raw radius over
     *  everything (`wideRadius`: the earlier run's every sample, the rerun's
     *  contacts between — every sample contradicted). Positions as integer
     *  multiples of one step, so a sample and a witness meet exactly. */
    w.__ltShape2 = (id: number, generation: number, end: number, kind: string) => {
      const I = 262144, c = cols(1, I), s = end / (4 * I + 8);
      c.ep.pair[0] = 0; c.ep.ordinal[0] = 0; c.ep.flags[0] = 4; c.ep.closeAt[0] = s; c.ep.firstIv[0] = 0; c.ep.ivCount[0] = I;
      for (let k = 0; k < I; k++) {
        c.iv.episode[k] = 0; c.iv.next[k] = k + 1 < I ? k + 1 : 0xffffffff; c.iv.flags[k] = 6;
        if (kind === "refuted") {
          const g = 2 * generation;
          c.iv.enter[k] = (4 * k + g + 1) * s; c.iv.witness[k] = (4 * k + g + 2) * s; c.iv.exit[k] = (4 * k + g + 3.5) * s;
          c.iv.freeAt[k] = (4 * k + g + 4) * s; c.iv.freeR[k] = 0.1 * s;
        } else if (generation === 0) {
          c.iv.enter[k] = (4 * k + 1) * s; c.iv.witness[k] = (4 * k + 1.5) * s; c.iv.exit[k] = (4 * k + 2) * s;
          c.iv.freeAt[k] = (4 * k + 3) * s; c.iv.freeR[k] = end;
        } else {
          c.iv.enter[k] = (4 * k + 3.5) * s; c.iv.witness[k] = (4 * k + 3.75) * s; c.iv.exit[k] = (4 * k + 4) * s;
          c.iv.freeAt[k] = (4 * k + 4.5) * s; c.iv.freeR[k] = 0.1 * s;
        }
      }
      c.ep.onset[0] = c.iv.enter[0]!; c.ep.end[0] = c.iv.exit[I - 1]!;
      const none = { pair: new Uint32Array(0), start: new Float64Array(0), end: new Float64Array(0), reason: new Uint8Array(0) };
      const t = (rows: Record<string, ArrayLike<number>>, n: number) => ({ from: 0, count: n, rows, updates: new Uint32Array(0), updated: {} });
      return { request: id, generation, episodes: t(c.ep, 1), intervals: t(c.iv, I), gaps: t(none, 0) };
    };
  });
}

const diag = (page: Page) => page.evaluate(() => {
  const c = (window as any).__viewerDiag?.getContacts?.();
  const mem = (performance as any).memory;
  return { passes: c?.passes ?? null, discards: c?.discards ?? null, publications: c?.publications ?? null, running: c?.running ?? null,
           pending: c?.pending ?? null, phase: c?.phase ?? null, exp: (window as any).__expSteps ?? null, steps: c?.longestStepMs ?? null, lastPassMs: c?.lastPassMs ?? null, ids: c?.ids ?? null, held: c?.main?.held?.generation ?? null,
           byOwner: c?.stats?.byOwner ?? null, allocated: c?.stats?.allocated ?? null, viewsBytes: c?.stats?.views ?? null, acks: (window as any).__ltTap.acks, dropped: c?.dropped ?? null,
           heap: mem ? Math.round(mem.usedJSHeapSize / 1e6) : null, dom: document.getElementsByTagName("*").length,
           rows: document.querySelectorAll(".simPanel tbody tr[data-sim-row]").length };
});

/** One step: act, keep the pointer moving until the publisher is quiet and `until` holds, then the numbers. */
async function step(page: Page, name: string, act: () => Promise<unknown>, until: () => Promise<boolean> = async () => true) {
  const before = await diag(page);
  await act();   // makes the message (not measured)
  await page.evaluate(() => { (window as any).__lt = []; (window as any).__in = []; (window as any).__loaf = []; (window as any).__key = []; });
  const t0 = Date.now();
  await page.evaluate(() => {
    const t = (window as any).__ltTap, d = t.ready;
    if (!d) return;
    setTimeout(() => {
      if (d.held) { t.ready = null; t.deliver({ id: d.next.id, heldCoverage: { generation: 0, covered: [1] } }); t.deliver(d.next); }
      else t.deliverReady();
    }, 0);
  });
  const box = { x: 300, y: 12 };
  let k = 0, quiet = 0;
  // the transition's peaks, sampled every round: the tables by owner, the
  // views published and building, the JS heap and the buffers' backing stores
  const cdp = await page.context().newCDPSession(page);
  const peak = { tablesMB: 0, shownMB: 0, viewsMB: 0, buildingMB: 0, heapMB: 0, backingMB: NaN as number };
  for (;;) {
    const hu = await cdp.send("Runtime.getHeapUsage") as { usedSize: number; backingStorageSize?: number };
    peak.heapMB = Math.max(peak.heapMB, hu.usedSize / 1e6);
    if (hu.backingStorageSize !== undefined) peak.backingMB = Math.max(Number.isNaN(peak.backingMB) ? 0 : peak.backingMB, hu.backingStorageSize / 1e6);
    await page.mouse.move(box.x + (k++ % 40), box.y);
    if (process.env.LT_KEYS) await page.keyboard.press("Shift");
    const d = await diag(page);
    if (d.allocated) peak.tablesMB = Math.max(peak.tablesMB, d.allocated / 1e6);
    if (d.byOwner) peak.shownMB = Math.max(peak.shownMB, ((d.byOwner as { shown?: number }).shown ?? 0) / 1e6);
    if (d.viewsBytes) { const vb = d.viewsBytes as { published: number; building: number };
      peak.viewsMB = Math.max(peak.viewsMB, (vb.published + vb.building) / 1e6); peak.buildingMB = Math.max(peak.buildingMB, vb.building / 1e6); }
    quiet = d.running === false && d.pending === false && d.publications! > before.publications! ? quiet + 1 : 0;
    if (quiet >= 3 && await until()) break;
    if (Date.now() - t0 > 300_000) throw new Error(`${name}: not quiet after 300 s`);
  }
  const wallMs = Date.now() - t0;
  await page.waitForTimeout(500);
  const lt: Array<{ ms: number }> = await page.evaluate(() => (window as any).__lt);
  const inp: number[] = await page.evaluate(() => (window as any).__in);
  const loaf: unknown[] = await page.evaluate(() => (window as any).__loaf);
  const keys: number[] = await page.evaluate(() => (window as any).__key);
  const after = await diag(page);
  const sorted = [...inp].sort((a, b) => a - b), ks = [...keys].sort((a, b) => a - b);
  return { name, wallMs, longTasks: lt.length, longestMs: Math.round(Math.max(0, ...lt.map(x => x.ms))),
           inputs: inp.length, inputDelayMaxMs: Math.round(sorted[sorted.length - 1] ?? 0), inputDelayP95Ms: Math.round(sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0),
           keys: ks.length, keyDelayMaxMs: Math.round(ks[ks.length - 1] ?? 0), keyDelayP95Ms: Math.round(ks[Math.floor(0.95 * (ks.length - 1))] ?? 0),
           passes: after.passes! - before.passes!, discards: after.discards! - before.discards!, publications: after.publications! - before.publications!,
           acks: after.acks - before.acks, byOwnerMB: after.byOwner && Object.fromEntries(Object.entries(after.byOwner).map(([k, v]) => [k, Math.round(Number(v) / 1e5) / 10])),
           allocatedMB: after.allocated && Math.round(after.allocated / 1e5) / 10, heapMB: after.heap, dom: after.dom, rows: after.rows, ids: after.ids,
           peak: Object.fromEntries(Object.entries(peak).map(([n, v]) => [n, Math.round(v * 10) / 10])),
           dropped: after.dropped, exp: after.exp, longestStepMs: after.steps?.map((x: number) => Math.round(x * 10) / 10), lastPassMs: Math.round(after.lastPassMs ?? 0), loaf };
}

function save(entry: unknown) {
  let prev: unknown[] = [];
  try { prev = JSON.parse(readFileSync(OUT, "utf8")); } catch { /* first */ }
  writeFileSync(OUT, JSON.stringify([...prev, entry], null, 2) + "\n");
}

const result = (pairs: number) => ({ hits: [], staticContacts: [], samples: 10, coarsened: false, uncertified: null, pairCount: pairs,
  pairsPrescreened: 0, bvhMs: 0, sweepMs: 10, truncated: null });


for (const kind of ["refuted", "wideRadius"] as const) {
  test(`R160 at the budget: ${kind} — the first run, the fallback's union, the questions`, async ({ page, context }) => {
    test.setTimeout(1_800_000);
    await tap(page);
    await prepare(page, context);
    await expect.poll(() => page.evaluate(() => (window as any).__ltTap.main?.id ?? null)).not.toBeNull();
    const main = await page.evaluate(() => { const m = (window as any).__ltTap.main; return { id: m.id as number, end: m.track.cum[m.track.count - 1] as number }; });
    const pairs = [["spindle_nose", "a_yoke_casting"]];
    const out: unknown[] = [];
    out.push(await step(page, `${kind}: the first run arrives`, () => page.evaluate(([id, end, pairs, result, kind]) => {
      const w = window as any;
      w.__ltTap.ready = { id, contacts: [w.__ltShape2(id, 0, end, kind)], contactPairs: pairs, result };
    }, [main.id, main.end, pairs, result(1), kind] as const), async () => (await diag(page)).rows > 0));
    out.push(await step(page, `${kind}: the pool falls back — the second run, the union`, () => page.evaluate(([id, end, pairs, result, kind]) => {
      const w = window as any;
      const next = { id, contacts: [w.__ltShape2(id, 1, end, kind)], contactPairs: pairs, result };
      w.__ltTap.ready = { held: true, next };
    }, [main.id, main.end, pairs, result(1), kind] as const), async () => (await diag(page)).held === 0));
    // the questions on the published union, each timed (the worst of its kind)
    await page.evaluate(() => { (window as any).__lt = []; });
    const q = await page.evaluate(() => (window as any).__viewerDiag.timeContactQueries());
    const lt: Array<{ ms: number }> = await page.evaluate(() => (window as any).__lt);
    out.push({ name: `${kind}: the questions`, worstMs: q, longTasks: lt.length, longestMs: Math.round(Math.max(0, ...lt.map(x => x.ms))) });
    console.log(`[longtask6] ${kind}: ${JSON.stringify(out)}`);
    expect(errors.filter(e => /contactView|no longer published|a pass failed/.test(e)), "no query of a retired view, no failed pass").toEqual([]);
    save({ shape: kind, steps: out });
    await ctl({ op: "reset" });
  });
}
