// PROBE (not committed — copied into e2e/ for its run, deleted after; R402,
// owed before the hold merge): how often is a normal hold refused ("Page
// delayed — hold again") while the collision check runs in the same page?
// The real XYZAC model and the collision spec's preparation; a long zigzag
// keeps the sweep busy; Unhome All held 800 ms with the mouse (timed from the
// press call's return), its hints recorded only after its own press,
// judged by holdJudge. The check's coverage before and after each hold shows
// it ran. Control: the same holds before any program is published.
import { test, expect, type Page, type BrowserContext } from "./test";
import { encode } from "@msgpack/msgpack";
import { readFileSync } from "node:fs";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";
import { STALL_HINT } from "./holdJudge";
import { HOLD_FIRE_MS } from "../src/machineControls";

const MODEL = new URL("../../examples/sim_config/machine-5axis-xyzac/", import.meta.url);
const machine = JSON.parse(readFileSync(new URL("machine.json", MODEL), "utf8"));
const N = Number(process.env.PROBE_HOLDS ?? 30);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false, resume: false, step: true, abort: true,
  spindleStop: true, probe: true, zero: true, machineFrame: true, goZero: true, planeFrame: true, touchoff: true,
  touchoffRotary: true, twpCapture: true, surfaceComp: true, safety: true, setup: true, sourceWrite: true,
  toolTableWrite: true, armed: true, always: true, programLoad: true, modeManual: true, modeCoord: true,
  parameterRead: true, g30Write: true, spindleManual: true, armEnable: true, estopReset: true,
};
const unhomes = async () => ((await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] }).cmds ?? [])
  .filter(c => c.cmd === "unhome_all").length;

/** A zigzag of `n` points, 0.5 mm apart, 1–5 mm above the A yoke's top
 *  (−350, collisions.viewer.spec) — close to a body, so the sweep is busy
 *  (a zigzag far from every body finished in ~5 s, the first probe run). */
function zigzag(n: number): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / 400), k = i % 400;
    const x = (row % 2 === 0 ? k : 399 - k) * 0.5 - 100;
    pts.push([x, -60 + (row % 240) * 0.5, -345 - (row % 5)]);
  }
  return pts;
}

type Seen = { t: string; at: number };
const record = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __seen: Seen[]; __hints: string[]; __rec?: boolean;
    __hintStale: { el: Element; text: string | null } | null };
  w.__seen = [];
  w.__hints = [];
  const shown = document.querySelector("[data-btn-hint]");
  w.__hintStale = shown ? { el: shown, text: shown.textContent } : null;
  if (w.__rec) return;
  w.__rec = true;
  for (const t of ["pointerdown", "pointerup"])
    window.addEventListener(t, () => w.__seen.push({ t, at: performance.now() }), { capture: true });
  new MutationObserver(() => {
    if (!w.__seen.some(e => e.t === "pointerdown")) return;
    const el = document.querySelector("[data-btn-hint]");
    if (!el || (w.__hintStale && el === w.__hintStale.el && el.textContent === w.__hintStale.text)) return;
    const h = el.textContent?.trim();
    if (h && w.__hints[w.__hints.length - 1] !== h) w.__hints.push(h);
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
});
const seen = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __seen: Seen[]; __hints: string[] };
  const d = w.__seen.filter(e => e.t === "pointerdown"), u = w.__seen.filter(e => e.t === "pointerup");
  return { delivered: d.length === 1 && u.length === 1 ? u[0]!.at - d[0]!.at : null, hints: w.__hints };
});
const coverage = (page: Page) => page.locator(".scrubBar .checkSlot").textContent({ timeout: 500 }).catch(() => null);

async function holds(page: Page, phase: string, n: number) {
  const btn = page.getByRole("button", { name: "Unhome All", exact: true });
  await expect(btn).toBeEnabled();
  const box = (await btn.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const rows = [];
  for (let i = 0; i < n; i++) {
    await ctl({ op: "clearCmds" });
    await record(page);
    const before = await coverage(page);
    await page.mouse.down();
    const t0 = Date.now();
    await sleep(Math.max(0, 800 - (Date.now() - t0)));
    await page.mouse.up();
    await sleep(500);
    const s = await seen(page), fired = await unhomes();
    const whole = s.delivered !== null && s.delivered >= HOLD_FIRE_MS;
    rows.push({ i, delivered: s.delivered === null ? null : Math.round(s.delivered), fired, hints: s.hints,
                outcome: fired ? "fired" : whole && s.hints.includes(STALL_HINT) ? "stalled" : whole ? "SILENT" : "short",
                before, after: await coverage(page) });
    await sleep(700);                                     // the hint (1.5 s) mostly gone before the next press
  }
  // counted: the holds the check ran through (its coverage below 100 % before AND after) — or, in the
  // control, every hold
  const counted = phase.startsWith("control") ? rows
    : rows.filter(r => /^\d+ %$/.test(r.before ?? "") && /^\d+ %$/.test(r.after ?? "") && r.after !== "100 %");
  const count = (o: string) => counted.filter(r => r.outcome === o).length;
  console.log(`probe-collision-hold ${phase}: ${JSON.stringify({ n, counted: counted.length, fired: count("fired"),
    stalled: count("stalled"), silent: count("SILENT"), short: count("short") })}`);
  console.log(`probe-collision-hold ${phase} rows: ${JSON.stringify(rows)}`);
  return rows;
}

test("refusal rate: a normal hold beside a running collision check, and without one", async ({ page, context }) => {
  test.setTimeout(900_000);
  const feed = zigzag(Number(process.env.PROBE_POINTS ?? 200_000));
  const lines = feed.map((_, i) => i + 1);
  const preview = Buffer.from(encode({ file: "/probe.ngc", preview_schema: 11, feed, feed_lines: lines,
    feed_seq: lines, feed_outside: new Uint8Array(feed.length), rapid: [], violations: [], violations_total: 0 }));
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: preview }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: 10 }, (_, i) => `G1 X${i} F100`).join("\n") }));
  await context.route("**/xyzac-model/*.stl", r => r.fulfill({ contentType: "application/octet-stream",
    body: readFileSync(new URL(new URL(r.request().url()).pathname.split("/").pop()!, MODEL)) }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"],
    parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics,
    workGroup: machine.workGroup, toolGroup: machine.toolGroup } });
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", data: { active_file: "/probe.ngc", joint_pos: [0, 0, 0, 0, 0], actual_position: [0, 0, 0, 0, 0],
    g5x_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], g92_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], tool_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    rotation_xy: 0, homed: [1, 1, 1, 1, 1], permissions: PERMS_ALL } });
  const control = await holds(page, "control (no program)", N);
  const t0 = Date.now();
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 4242, file: "/probe.ngc" } });
  await expect.poll(() => coverage(page), { timeout: 120_000, message: "the check runs" }).toMatch(/^\d+ %$/);
  console.log(`probe-collision-hold check running after ${Date.now() - t0} ms: ${await coverage(page)}`);
  const during = await holds(page, "during the check", N);
  console.log(`probe-collision-hold coverage at the end: ${await coverage(page)}`);
  expect(control.length + during.length).toBe(2 * N);
});
