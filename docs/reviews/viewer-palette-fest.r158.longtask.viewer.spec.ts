// MEASUREMENT (not part of the gate; copied in as e2e/zz_longtask3.viewer.spec.ts
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

test("plan 3.6 at the budget: many pairs — arrival, an update delta over the whole budget, a fallback, an empty delta", async ({ page, context }) => {
  test.setTimeout(1_800_000);
  await tap(page);
  await prepare(page, context);
  await expect.poll(() => page.evaluate(() => (window as any).__ltTap.main?.id ?? null)).not.toBeNull();
  const main = await page.evaluate(() => { const m = (window as any).__ltTap.main; return { id: m.id as number, end: m.track.cum[m.track.count - 1] as number }; });
  const pairs = Array.from({ length: PAIRS }, () => ["spindle_nose", "a_yoke_casting"]);
  const out: unknown[] = [];
  const rows = async () => (await diag(page)).rows > 0;
  const prof = process.env.LT_PROFILE ? await page.context().newCDPSession(page) : null;
  if (prof) { await prof.send("Profiler.enable"); await prof.send("Profiler.setSamplingInterval", { interval: 100 }); await prof.send("Profiler.start"); }
  const domBefore = (await diag(page)).dom;
  const browser = page.context().browser();
  if (process.env.LT_TRACE && browser) await browser.startTracing(page, { path: process.env.LT_TRACE, screenshots: false,
    categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.stack", "blink.user_timing"] });
  out.push(await step(page, "the tables arrive (a result)", () => page.evaluate(([id, end, pairs, result, n]) => {
    const w = window as any;
    w.__ltTap.ready = { id, contacts: [w.__ltDelta(id, 0, end, n, false)], contactPairs: pairs, result };
  }, [main.id, main.end, pairs, result(PAIRS), PAIRS] as const), rows));
  (out[out.length - 1] as Record<string, unknown>).domBefore = domBefore;
  if (process.env.LT_TRACE && browser) await browser.stopTracing();
  if (prof) {
    const { profile } = await prof.send("Profiler.stop") as any;
    // self time by function (sampled): the nodes' hit counts × the interval
    const byId = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]));
    const dt = new Map<number, number>();
    for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i + 1] ?? 0));
    const self = new Map<string, number>();
    for (const [id, us] of dt) {
      const f = byId.get(id).callFrame;
      const k = `${f.functionName || "(anon)"} ${String(f.url).split("/").pop()}:${f.lineNumber + 1}`;
      self.set(k, (self.get(k) ?? 0) + us / 1000);
    }
    const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, ms]) => `${ms.toFixed(1)} ms  ${k}`);
    // the longest busy stretch (samples off idle, gaps under 1 ms): inclusive time by function there
    {
      const parentOf = new Map<number, number>();
      for (const n of profile.nodes) for (const c of n.children ?? []) parentOf.set(c, n.id);
      const idle = new Set(profile.nodes.filter((n: any) => n.callFrame.functionName === "(idle)").map((n: any) => n.id));
      let t = profile.startTime, runs: Array<{ a: number; b: number }> = [], cur: { a: number; b: number } | null = null;
      const times: number[] = [];
      for (let i = 0; i < profile.samples.length; i++) {
        t += profile.timeDeltas[i]; times.push(t);
        const busy = !idle.has(profile.samples[i]);
        if (busy) { if (cur && t - cur.b < 1000) cur.b = t; else { cur = { a: t, b: t }; runs.push(cur); } }
      }
      const best = runs.sort((x, y) => (y.b - y.a) - (x.b - x.a))[0];
      if (best) {
        const incl = new Map<string, number>();
        for (let i = 0; i < profile.samples.length; i++) {
          if (times[i] < best.a || times[i] > best.b) continue;
          const us = profile.timeDeltas[i + 1] ?? 0, seen = new Set<string>();
          for (let id: number | undefined = profile.samples[i]; id !== undefined; id = parentOf.get(id)) {
            const f = byId.get(id).callFrame;
            const k = `${f.functionName || "(anon)"} ${String(f.url).split("/").pop()}:${f.lineNumber + 1}`;
            if (seen.has(k)) continue;
            seen.add(k);
            incl.set(k, (incl.get(k) ?? 0) + us / 1000);
          }
        }
        top.push(`-- the longest busy stretch: ${((best.b - best.a) / 1000).toFixed(1)} ms, inclusive --`,
          ...[...incl].sort((a, b) => b[1] - a[1]).slice(0, 70).map(([k, ms]) => `${ms.toFixed(1)} ms  ${k}`));
      }
    }
    // who reads layout: the callers of the layout getters, by time
    const parent = new Map<number, number>();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const chains = new Map<string, number>();
    for (const [id, us] of dt) {
      const f = byId.get(id).callFrame;
      if (f.url || !f.functionName || /^\(/.test(f.functionName) || /insertBefore|setAttribute|createElement|uniform|draw|bufferData|texImage|bindBuffer|readPixels/.test(f.functionName)) continue;
      const names: string[] = [f.functionName];
      for (let p = parent.get(id), k = 0; p !== undefined && k < 8; p = parent.get(p), k++) {
        const g = byId.get(p).callFrame;
        names.push(`${g.functionName || "(anon)"}@${String(g.url).split("/").pop()}:${g.lineNumber + 1}`);
      }
      const key = names.join(" < ");
      chains.set(key, (chains.get(key) ?? 0) + us / 1000);
    }
    top.push("-- layout reads --", ...[...chains].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, ms]) => `${ms.toFixed(1)} ms  ${k}`));
    writeFileSync("/home/cnc/claude-work/form1/lt-profile.txt", top.join("\n") + "\n");
  }
  out.push(await step(page, "an update delta over the whole budget", () => page.evaluate(([id, end, result, n]) => {
    const w = window as any;
    w.__ltTap.ready = { id, contacts: [w.__ltUpdate(id, 0, end, n, false)], result };
  }, [main.id, main.end, result(PAIRS), PAIRS] as const)));
  out.push(await step(page, "the pool falls back: the same tables as the next generation", () => page.evaluate(([id, end, pairs, result, n]) => {
    const w = window as any;
    const next = { id, contacts: [w.__ltDelta(id, 1, end, n, false)], contactPairs: pairs, result };
    w.__ltTap.ready = { held: true, next };
  }, [main.id, main.end, pairs, result(PAIRS), PAIRS] as const), async () => (await diag(page)).held === 0));
  out.push(await step(page, "a rebuild: one more (empty) delta", () => page.evaluate(([id, result, n]) => {
    const w = window as any;
    w.__ltTap.ready = { id, contacts: [w.__ltEmpty(id, 1, n)], result };
  }, [main.id, result(PAIRS), PAIRS] as const)));
  console.log(`[longtask3] many pairs: ${JSON.stringify(out)}`);
  expect(errors.filter(e => /contactView|no longer published|a pass failed/.test(e)), "no query of a retired view, no failed pass").toEqual([]);
  save({ shape: "many pairs", pairs: PAIRS, targets: 4 * PAIRS, steps: out });
  await ctl({ op: "reset" });
});

test("plan 3.6 at the budget: one pair — its one big group builds, then a new program cancels it", async ({ page, context }) => {
  test.setTimeout(1_800_000);
  await tap(page);
  await prepare(page, context);
  await expect.poll(() => page.evaluate(() => (window as any).__ltTap.main?.id ?? null)).not.toBeNull();
  const main = await page.evaluate(() => { const m = (window as any).__ltTap.main; return { id: m.id as number, end: m.track.cum[m.track.count - 1] as number }; });
  const pairs = [["spindle_nose", "a_yoke_casting"]];
  const out: unknown[] = [];
  const browser = page.context().browser();
  if (process.env.LT_TRACE1 && browser) await browser.startTracing(page, { path: process.env.LT_TRACE1, screenshots: false,
    categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.stack", "v8"] });
  out.push(await step(page, "the tables of one pair arrive (a result)", () => page.evaluate(([id, end, pairs, result, n]) => {
    const w = window as any;
    w.__ltTap.ready = { id, contacts: [w.__ltDelta(id, 0, end, n, true)], contactPairs: pairs, result };
  }, [main.id, main.end, pairs, result(1), PAIRS] as const), async () => (await diag(page)).rows > 0));
  // an update delta: its pass builds the one big group again — a new program while it does
  const before = await diag(page);
  await page.evaluate(() => { (window as any).__lt = []; (window as any).__loaf = []; });
  await page.evaluate(([id, end, result, n]) => {
    const w = window as any;
    w.__ltTap.ready = { id, contacts: [w.__ltUpdate(id, 0, end, n, true)], result };
  }, [main.id, main.end, result(1), PAIRS] as const);
  await page.evaluate(() => { (window as any).__lt = []; (window as any).__loaf = []; (window as any).__ltTap.deliverReady(); });
  await expect.poll(async () => (await diag(page)).phase, { intervals: [5], timeout: 60_000 }).toBe(2);
  const t0 = Date.now();
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 4402, file: "/lt.ngc" } });
  await expect.poll(async () => !(await diag(page)).ids!.includes(main.id), { intervals: [5], timeout: 60_000 }).toBe(true);
  const goneMs = Date.now() - t0;
  await expect.poll(async () => { const d = await diag(page); return d.running === false && d.pending === false; }, { intervals: [50], timeout: 120_000 }).toBe(true);
  const lt: Array<{ ms: number }> = await page.evaluate(() => (window as any).__lt);
  const loaf: unknown[] = await page.evaluate(() => (window as any).__loaf);
  const after = await diag(page);
  out.push({ name: "a new program while the one big group builds", goneMs, longTasks: lt.length, longestMs: Math.round(Math.max(0, ...lt.map(x => x.ms))), loaf,
             passes: after.passes! - before.passes!, discards: after.discards! - before.discards!, ids: after.ids, acksOfOld: after.acks - before.acks });
  if (process.env.LT_TRACE1 && browser) await browser.stopTracing();
  console.log(`[longtask3] one pair: ${JSON.stringify(out)}`);
  expect(errors.filter(e => /contactView|no longer published|a pass failed/.test(e)), "no query of a retired view, no failed pass").toEqual([]);
  save({ shape: "one pair", pairs: 1, targets: 4 * PAIRS, steps: out });
  await ctl({ op: "reset" });
});
