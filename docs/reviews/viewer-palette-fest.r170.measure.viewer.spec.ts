// C2 measurement (Codex R167): the VISIBLE first touch, the worker's answer
// to a stop and a cancel — before C2 (records + the `first` message) and after
// (tables only, the metadata partial). Not committed; copied into e2e/ for a
// run against the tree under test. Output: one JSON line per case on stdout
// (prefixed "C2M ").
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { encode } from "@msgpack/msgpack";
import { readFileSync } from "node:fs";
import { ctl } from "./ctl";
import { simShow } from "./simTab";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

const MODEL = new URL("../../examples/sim_config/machine-5axis-xyzac/", import.meta.url);
const machine = JSON.parse(readFileSync(new URL("machine.json", MODEL), "utf8"));
const RUNS = Number(process.env.C2M_RUNS ?? 5);

/** The page's collision worker, tapped: every main request's post and every
 *  message back, timed; acknowledgements held `holdAck` ms; stop / cancel
 *  posted by the spec at chosen times. */
async function installTap(page: Page) {
  await page.addInitScript(() => {
    const tap: any = { raw: [], req: null, t0: 0, log: [], visible: null, worker: null, post: null };
    (window as any).__c2m = tap;
    const Real = window.Worker;
    const Tapped = function (url: string | URL, opts?: WorkerOptions) {
      const w = new Real(url, opts);
      if (!/collisionWorker/.test(String(url))) return w;
      const post = w.postMessage.bind(w) as (m: unknown, t?: Transferable[]) => void;
      tap.worker = w; tap.post = post;
      w.postMessage = ((m: any, t?: Transferable[]) => {
        if (m && typeof m === "object" && m.track && !m.side) { tap.req = m.id; tap.t0 = performance.now(); tap.log = []; tap.raw = []; tap.visible = null; }
        const hold = (window as any).__c2mHold ?? 0;
        if (m && typeof m === "object" && "contactsAck" in m && hold > 0) { setTimeout(() => post(m, t), hold); return; }
        post(m, t);
      }) as typeof w.postMessage;
      w.addEventListener("message", (ev: MessageEvent) => {
        const d = ev.data;
        if (!d || d.id !== tap.req) return;
        const ivs = (d.contacts ?? []).reduce((n: number, x: any) => n + (x.intervals?.count ?? 0), 0);
        for (const x of d.contacts ?? []) {
          const iv = x.intervals?.rows ?? {}, ep = x.episodes?.rows ?? {};
          tap.raw.push({ t: performance.now() - tap.t0, ivEnter: Array.from(iv.enter ?? []), ivExit: Array.from(iv.exit ?? []), ivEp: Array.from(iv.episode ?? []),
            epPair: Array.from(ep.pair ?? []), epOnset: Array.from(ep.onset ?? []), epEnd: Array.from(ep.end ?? []),
            epCloseAt: Array.from(ep.closeAt ?? []), epCloseDist: Array.from(ep.closeDist ?? []) });
        }
        tap.log.push({ t: performance.now() - tap.t0, first: !!d.first, partial: !!d.partial, ivs, result: !!d.result,
                       stopped: !!d.stopped, cancelled: !!d.cancelled, progress: d.progress ?? null });
      });
      return w;
    } as unknown as typeof Worker;
    Tapped.prototype = Real.prototype;
    window.Worker = Tapped;
    // the first frame the summary names a collision
    const loop = () => {
      const s = document.querySelector(".simPanel .simSummary .sumItem")?.getAttribute("aria-label") ?? "";
      if (tap.req !== null && tap.visible === null && /collision/.test(s)) tap.visible = performance.now() - tap.t0;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

async function prepare(page: Page, context: BrowserContext, o: { file: string; version: number; feed: number[][]; lines: number[]; joints: number[] }) {
  const preview = Buffer.from(encode({ file: o.file, preview_schema: 11, feed: o.feed,
    feed_lines: o.lines, feed_seq: o.lines.map((_, i) => i + 1), feed_outside: new Uint8Array(o.feed.length), rapid: [],
    violations: [], violations_total: 0 }));
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
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: o.version, file: o.file } });
  // the summary is in the DOM whether its tab shows or not: the frame loop reads it from the start
  await simShow(page, "clash");
}

/** The XYZAC case (collisions.viewer.spec): L7 traverses the nose sideways into the yoke. */
const SMALL = { feed: [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]], lines: [1, 6, 7, 8], joints: [-100, 0, 0, 0, 0] };
/** A long program: 4000 short moves clear of everything, then the same traverse into the yoke. */
function large() {
  const feed: number[][] = [[0, 0, -100]], lines = [1];
  for (let i = 1; i <= 4000; i++) { feed.push([((i % 2) ? 20 : 0), 0, -100 - (i % 40)]); lines.push(1 + i); }
  feed.push([0, 0, -380], [240, 0, -380], [240, 0, -100]);
  lines.push(4002, 4003, 4004);
  return { feed, lines, joints: [-100, 0, 0, 0, 0] };
}

/** A near miss shortly before the touch (Codex R167: a delta still unacknowledged
 *  when the touch lands): L7's traverse stops 1 mm short of the yoke (touch at
 *  X 125, the margin entered at X 123.04 — probed), back, `n` short moves clear
 *  of everything, then the traverse into the yoke. */
function near(n: number) {
  const feed: number[][] = [[0, 0, -100], [0, 0, -380], [124, 0, -380], [0, 0, -380], [0, 0, -100]], lines = [1, 2, 3, 4, 5];
  for (let i = 1; i <= n; i++) { feed.push([((i % 2) ? 20 : 0), 0, -100 - (i % 40)]); lines.push(5 + i); }
  feed.push([0, 0, -380], [240, 0, -380], [240, 0, -100]);
  lines.push(n + 6, n + 7, n + 8);
  return { feed, lines, joints: [-100, 0, 0, 0, 0] };
}
/** A program the sweep takes seconds over: the stop and the cancel land while it runs. */
function longer() {
  const feed: number[][] = [[0, 0, -100]], lines = [1];
  for (let i = 1; i <= 40000; i++) { feed.push([((i % 2) ? 20 : 0), (i % 7) * 3, -100 - (i % 40)]); lines.push(1 + i); }
  return { feed, lines, joints: [-100, 0, 0, 0, 0] };
}

const stats = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b);
  return { n: s.length, min: +s[0]!.toFixed(1), median: +s[s.length >> 1]!.toFixed(1), max: +s[s.length - 1]!.toFixed(1) };
};

const CASES: Array<readonly [string, ReturnType<typeof large>, number[]]> = [
  ["xyzac L7", SMALL, [0, 300]],
  ["long, contact at its end", large(), [0, 300]],
  ["a near miss, 400 moves, then the touch", near(400), [0, 300, 1000]],
];
for (const [name, prog, holds] of CASES) {
  for (const hold of holds) {
    test(`C2M visible first touch — ${name}, acknowledgements held ${hold} ms`, async ({ page, context }) => {
      test.setTimeout(600_000);
      await page.addInitScript(h => { (window as any).__c2mHold = h; }, hold);
      await installTap(page);
      const out: Array<{ held: number; visible: number; touchMsg: number | null; firstMsg: number | null; partialFirst: number | null }> = [];
      for (let k = 0; k < RUNS; k++) {
        // a fresh page each run (openLayout navigates): a new worker, the model built again
        await prepare(page, context, { file: `/c2m-${k}.ngc`, version: 9000 + k, ...prog });
        await expect.poll(() => page.evaluate(() => (window as any).__c2m.visible), { timeout: 300_000 }).not.toBeNull();
        const r = await page.evaluate(() => {
          const t = (window as any).__c2m;
          const at = (f: (x: any) => boolean) => { const e = t.log.find(f); return e ? e.t : null; };
          return { held: (window as any).__c2mHold ?? 0, visible: t.visible, touchMsg: at((x: any) => x.ivs > 0), firstMsg: at((x: any) => x.first), partialFirst: at((x: any) => x.partial) };
        });
        out.push(r);
        // let the sweep end before the next run
        await expect.poll(() => page.evaluate(() => (window as any).__c2m.log.some((x: any) => x.result)), { timeout: 300_000 }).toBe(true);
      }
      console.log("C2M " + JSON.stringify({ case: name, hold, runs: out,
        visible: stats(out.map(o => o.visible)), touchMsg: stats(out.map(o => o.touchMsg ?? NaN).filter(x => !Number.isNaN(x))),
        visibleAfterTouch: stats(out.filter(o => o.touchMsg !== null).map(o => o.visible - o.touchMsg!)) }));
      await ctl({ op: "reset" });
    });
  }
}

for (const what of ["stop", "cancel"] as const) {
  test(`C2M the worker's answer to a ${what} — long program`, async ({ page, context }) => {
    test.setTimeout(600_000);
    await installTap(page);
    const prog = longer();
    // `at` ms after the sweep's first word (it runs from there; before it the
    // worker builds the model and reads no message)
    const answers: Array<{ at: number; progress: number | null; ms: number; answer: string; running: number }> = [];
    for (const [k, at] of [0, 200, 1000, 2000, 0, 200, 1000, 2000].entries()) {
      await prepare(page, context, { file: `/c2m-s${k}.ngc`, version: 9100 + k, ...prog });
      await expect.poll(() => page.evaluate(() => (window as any).__c2m.log.length), { timeout: 120_000 }).toBeGreaterThan(0);
      const r = await page.evaluate(([at, what]) => new Promise<{ progress: number | null; ms: number; answer: string; running: number }>(resolve => {
        const t = (window as any).__c2m;
        const running = t.log[0].t;
        const wait = () => {
          if (performance.now() - t.t0 < running + at) { setTimeout(wait, 2); return; }
          const progress = [...t.log].reverse().find((x: any) => x.progress !== null)?.progress ?? null;
          const sent = performance.now();
          const n0 = t.log.length;
          t.post(what === "stop" ? { stop: t.req } : { cancel: t.req });
          const check = () => {
            const hit = t.log.slice(n0).find((x: any) => x.stopped || x.cancelled || x.result);
            if (hit) resolve({ progress, ms: performance.now() - sent, answer: hit.stopped ? "stopped" : hit.cancelled ? "cancelled" : "result", running });
            else setTimeout(check, 1);
          };
          check();
        };
        wait();
      }), [at, what] as const);
      answers.push({ at, ...r });
    }
    console.log("C2M " + JSON.stringify({ case: `${what}, long program`, answers,
      ms: stats(answers.filter(a => a.answer !== "result").map(a => a.ms)) }));
    await ctl({ op: "reset" });
  });
}

test("C2M probe — the contact tables of a program", async ({ page, context }) => {
  test.setTimeout(300_000);
  await installTap(page);
  const prog = process.env.C2M_CASE === "near" ? near(400) : SMALL;
  await prepare(page, context, { file: "/c2m-probe.ngc", version: 9900, ...prog });
  await expect.poll(() => page.evaluate(() => (window as any).__c2m.log.some((x: any) => x.result)), { timeout: 200_000 }).toBe(true);
  const raw = await page.evaluate(() => (window as any).__c2m.raw);
  console.log("C2MPROBE " + JSON.stringify(raw));
});

test("C2M a stop posted before the sweep's first word — what answers it", async ({ page, context }) => {
  test.setTimeout(600_000);
  await installTap(page);
  const prog = large();
  const answers: Array<{ after: number; answer: string; ms: number }> = [];
  for (const [k, after] of [10, 50, 100, 300].entries()) {
    await prepare(page, context, { file: `/c2m-e${k}.ngc`, version: 9200 + k, ...prog });
    await expect.poll(() => page.evaluate(() => (window as any).__c2m.req), { timeout: 60_000 }).not.toBeNull();
    const r = await page.evaluate(after => new Promise<{ answer: string; ms: number }>(resolve => {
      const t = (window as any).__c2m;
      const wait = () => {
        if (performance.now() - t.t0 < after) { setTimeout(wait, 1); return; }
        const sent = performance.now(), n0 = t.log.length, words = t.log.length;
        t.post({ stop: t.req });
        const check = () => {
          const hit = t.log.slice(n0).find((x: any) => x.stopped || x.cancelled || x.result);
          if (hit) resolve({ answer: (hit.stopped ? "stopped" : hit.cancelled ? "cancelled" : "result") + (words ? " (after a word)" : " (before any word)"), ms: performance.now() - sent });
          else setTimeout(check, 1);
        };
        check();
      };
      wait();
    }), after);
    answers.push({ after, ...r });
  }
  console.log("C2M " + JSON.stringify({ case: "early stop", answers }));
});
