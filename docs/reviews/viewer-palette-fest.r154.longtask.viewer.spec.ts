// MEASUREMENT (not part of the gate): the browser's longest tasks when a
// request's contact tables reach the page at the budget — the view's build,
// the bar's and the Sim tab's use of it — and on a rebuild after one more
// delta. Both requests are answered here (no sweep runs); the tables are made
// in the page as typed columns. Shapes: many pairs, one generation; the same
// after a fallback (two generations, a union).
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";
import { simShow } from "./simTab";

const MODEL = new URL("../../examples/sim_config/machine-5axis-xyzac/", import.meta.url);
const machine = JSON.parse(readFileSync(new URL("machine.json", MODEL), "utf8"));
const OUT = process.env.LT_OUT ?? "/tmp/longtask.json";
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
}

for (const shape of ["one generation", "after a fallback"] as const) {
  test(`long tasks at the budget: ${shape}`, async ({ page, context }) => {
    test.setTimeout(900_000);
    await page.addInitScript(() => {
      const w = window as any;
      w.__lt = [];
      new PerformanceObserver(l => { for (const e of l.getEntries()) w.__lt.push({ at: e.startTime, ms: e.duration }); }).observe({ type: "longtask", buffered: true });
      const tap: any = { main: null, deliver: null };
      w.__ltTap = tap;
      const Real = window.Worker;
      const Tap = function (url: string | URL, opts?: WorkerOptions) {
        const wk = new Real(url, opts);
        if (!/collisionWorker/.test(String(url))) return wk;
        let handler: any = null;
        Object.defineProperty(wk, "onmessage", { configurable: true, get: () => handler, set: f => { handler = f; } });
        wk.addEventListener("message", e => handler?.(e));
        tap.deliver = (d: any) => handler?.(new MessageEvent("message", { data: d }));
        wk.postMessage = ((m: any) => { if (m?.track && !m.side) tap.main = m; }) as any;
        return wk;
      } as any;
      Tap.prototype = Real.prototype;
      window.Worker = Tap;
      // the budget's tables of one generation as a delta: 65536 pairs, four contacts each
      w.__ltDelta = (id: number, generation: number, end: number, E: number) => {
        const I = 4 * E, step = end / (E + 2);
        const ep = { pair: new Uint32Array(E), ordinal: new Uint32Array(E), flags: new Uint16Array(E), onset: new Float64Array(E),
                     end: new Float64Array(E), closeAt: new Float64Array(E), closeDist: new Float32Array(E), firstIv: new Uint32Array(E), ivCount: new Uint32Array(E) };
        const iv = { episode: new Uint32Array(I), enter: new Float64Array(I), exit: new Float64Array(I), flags: new Uint8Array(I), next: new Uint32Array(I),
                     witness: new Float64Array(I), freeAt: new Float64Array(I), freeR: new Float32Array(I) };
        for (let e = 0; e < E; e++) {
          const b = (e + 1) * step;
          ep.pair[e] = e; ep.ordinal[e] = 0; ep.flags[e] = 4; ep.onset[e] = b; ep.end[e] = b + 0.9 * step; ep.closeAt[e] = b;
          ep.firstIv[e] = 4 * e; ep.ivCount[e] = 4;
          for (let k = 0; k < 4; k++) {
            const r = 4 * e + k, a = b + k * 0.2 * step;
            iv.episode[r] = e; iv.enter[r] = a; iv.exit[r] = a + 0.1 * step; iv.flags[r] = 6; iv.next[r] = k < 3 ? r + 1 : 0xffffffff;
            iv.witness[r] = a; iv.freeAt[r] = a + 0.15 * step; iv.freeR[r] = 0.02 * step;
          }
        }
        const t = (rows: Record<string, ArrayLike<number>>, n: number) => ({ from: 0, count: n, rows, updates: new Uint32Array(0), updated: {} });
        return { request: id, generation, episodes: t(ep, E), intervals: t(iv, I), gaps: t({ pair: new Uint32Array(0), start: new Float64Array(0), end: new Float64Array(0), reason: new Uint8Array(0) }, 0) };
      };
      w.__ltEmpty = (id: number, generation: number, E: number) => {
        const t = () => ({ from: 0, count: 0, rows: {}, updates: new Uint32Array(0), updated: {} });
        return { request: id, generation, episodes: { ...t(), from: E }, intervals: { ...t(), from: 4 * E }, gaps: t() };
      };
    });
    await prepare(page, context);
    await expect.poll(() => page.evaluate(() => (window as any).__ltTap.main?.id ?? null)).not.toBeNull();
    const main = await page.evaluate(() => { const m = (window as any).__ltTap.main; return { id: m.id as number, end: m.track.cum[m.track.count - 1] as number }; });
    const pairs = Array.from({ length: PAIRS }, () => ["spindle_nose", "a_yoke_casting"]);
    const result = { hits: [], staticContacts: [], samples: 10, coarsened: false, uncertified: null, pairCount: PAIRS, pairsPrescreened: 0, bvhMs: 0, sweepMs: 10, truncated: null };
    const phase = async (name: string, act: () => Promise<unknown>, until: () => Promise<boolean>) => {
      await page.evaluate(() => { (window as any).__lt = []; });
      const t0 = Date.now();
      await act();
      await expect.poll(until, { timeout: 300_000, intervals: [250] }).toBe(true);
      await page.waitForTimeout(3000);
      const lt: Array<{ at: number; ms: number }> = await page.evaluate(() => (window as any).__lt);
      return { name, wallMs: Date.now() - t0, longTasks: lt.length, longestMs: Math.round(Math.max(0, ...lt.map(x => x.ms))),
               sumMs: Math.round(lt.reduce((s, x) => s + x.ms, 0)) };
    };
    const rows = () => page.locator(".simPanel tbody tr[data-sim-row]").count();
    const out: unknown[] = [];
    out.push(await phase("the tables arrive (a result)", () => page.evaluate(([id, end, pairs, result, n]) => {
      const w = window as any;
      setTimeout(() => w.__ltTap.deliver({ id, contacts: [w.__ltDelta(id, 0, end, n)], contactPairs: pairs, result }), 0);
    }, [main.id, main.end, pairs, result, PAIRS] as const), async () => (await rows()) > 0));
    if (shape === "after a fallback") {
      out.push(await phase("the pool falls back: the same tables as the next generation", () => page.evaluate(([id, end, pairs, result, n]) => {
        const w = window as any;
        setTimeout(() => {
          w.__ltTap.deliver({ id, heldCoverage: { generation: 0, covered: [1] } });
          w.__ltTap.deliver({ id, contacts: [w.__ltDelta(id, 1, end, n)], contactPairs: pairs, result });
        }, 0);
      }, [main.id, main.end, pairs, result, PAIRS] as const), () => page.evaluate(() => window.__viewerDiag?.getContacts?.().main?.held?.generation === 0)));
    }
    const gen = shape === "after a fallback" ? 1 : 0;
    out.push(await phase("a rebuild: one more (empty) delta", () => page.evaluate(([id, gen, result, n]) => {
      const w = window as any;
      setTimeout(() => w.__ltTap.deliver({ id, contacts: [w.__ltEmpty(id, gen, n)], result }), 0);
    }, [main.id, gen, result, PAIRS] as const), async () => true));
    const n = await rows();
    console.log(`[longtask] ${shape}: ${JSON.stringify(out)} rows ${n}`);
    let prev: unknown[] = [];
    try { prev = JSON.parse(readFileSync(OUT, "utf8")); } catch { /* first */ }
    writeFileSync(OUT, JSON.stringify([...prev, { shape, pairs: PAIRS, targets: 4 * PAIRS, phases: out, rows: n }], null, 2) + "\n");
    await ctl({ op: "reset" });
  });
}
