// Hold after a stall, real time (Codex R397 / R399, operator Q397-1): a hold
// whose watch saw the page blocked past HOLD_STALL_MS ends for good — "Page
// delayed — hold again", nothing sent; a short tap never fires, whatever
// the browser runs first after the block. REAL time on purpose: the race is
// the browser scheduler's (the other hold specs run on the page's clock,
// holdClock.ts). The block is anchored at the press's DELIVERY (the handler
// after the button's own, Codex R399), the release is asked for by a Node
// timer started once the press call returned (it returns after the page's
// delivery — measured in Chromium and Firefox 160, R401) and judged by the
// events' own timestamps: a "real tap" is a release stamped under 500 ms
// after its press. The race is proven, not assumed: a row counts only when
// its release was DELIVERED (the window's capture listener) at or past
// HOLD_FIRE_MS after the press's delivery and the block itself ran (the page
// records its start and end) — the due time had come with the release still
// queued. A guard green with the block missing fails its count. The
// measurement does not claim a rate — it holds that no tap fired; the rows
// print each one's stamped length, its delivery, the block and whether it
// fired. Every case asserts "never fired" on every attempt; an attempt the
// loaded runner kept from its setting is named and taken again.
import { test, expect, type Page } from "./test";
import { enterTouch } from "./touchMode";
import { ctl, MOCK } from "./ctl";
import { HOLD_STALL_MS } from "../src/holdGesture";
import { HOLD_FIRE_MS } from "../src/machineControls";
import { judgeHold, STALL_HINT } from "./holdJudge";
import { readHints, resetHints } from "./hintRecorder";

test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } });

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false, resume: false, step: true, abort: true,
  spindleStop: true, probe: true, zero: true, machineFrame: true, goZero: true, planeFrame: true, touchoff: true,
  touchoffRotary: true, twpCapture: true, surfaceComp: true, safety: true, setup: true, sourceWrite: true,
  toolTableWrite: true, armed: true, always: true, programLoad: true, modeManual: true, modeCoord: true,
  parameterRead: true, g30Write: true, spindleManual: true, armEnable: true, estopReset: true,
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// the hints of the next gesture only: hintRecorder.ts, the one recorder (R401)
const hints = readHints;
const clearHints = resetHints;
const unhomes = async () => ((await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] }).cmds ?? [])
  .filter(c => c.cmd === "unhome_all").length;

async function open(page: Page) {
  await ctl({ op: "reset" });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await enterTouch(page);
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", data: { active_file: "/A.ngc", homed: [1, 1, 1], permissions: PERMS_ALL } });
  await expect(page.getByRole("button", { name: "Unhome All", exact: true })).toBeEnabled();
  const box = (await page.getByRole("button", { name: "Unhome All", exact: true }).boundingBox())!;
  return { cdp: await page.context().newCDPSession(page), p: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}

/** One gesture: the press, a block of the main thread from `from` to `to` ms
 *  after the press's delivery (none when null), the release asked for at
 *  `releaseAt` ms after the press call returned. → whether it fired, the
 *  release's stamp after the press's (`pressed`), its delivery after the
 *  press's delivery (`delivered`) and the block as it ran (`block`, null when
 *  it did not), both on the page's clock. */
async function gesture(page: Page, cdp: Awaited<ReturnType<typeof open>>["cdp"], p: { x: number; y: number },
                       releaseAt: number, block: { from: number; to: number } | null) {
  await ctl({ op: "clearCmds" });
  await page.evaluate((b) => {
    const w = window as unknown as { __hs: { t: string; ts: number; at: number }[]; __blk: { from: number; to: number } | null };
    w.__hs = [];
    w.__blk = null;
    for (const t of ["pointerdown", "pointerup"])
      window.addEventListener(t, (e) => w.__hs.push({ t, ts: e.timeStamp, at: performance.now() }), { capture: true, once: true });
    if (b) window.addEventListener("pointerdown", () => {
      const delivered = performance.now();                 // after the button's own handler (window, bubble)
      setTimeout(() => {
        const from = performance.now() - delivered;
        while (performance.now() - delivered < b.to) { /* blocked */ }
        w.__blk = { from, to: performance.now() - delivered };
      }, Math.max(0, b.from));
    }, { once: true });
  }, block);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
  const t0 = Date.now();                                   // the call returned: the page has the press
  await sleep(Math.max(0, releaseAt - (Date.now() - t0)));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(900);
  const rec = await page.evaluate(() => {
    const w = window as unknown as { __hs: { t: string; ts: number; at: number }[]; __blk: { from: number; to: number } | null };
    return { ev: w.__hs, block: w.__blk };
  });
  const down = rec.ev.find(e => e.t === "pointerdown"), up = rec.ev.find(e => e.t === "pointerup");
  return { fired: await unhomes(), pressed: down && up ? up.ts - down.ts : null,
           delivered: down && up ? up.at - down.at : null, block: rec.block };
}

/** A hold of `ms` on a smooth page, taken until the page saw it whole: an
 *  attempt it saw shorter than the due time is retaken; one it saw whole
 *  either fired once or showed "Page delayed" (the runner stalled it) and is
 *  retaken; a fire from a press the page saw shorter is red — at most three. */
async function smoothHold(page: Page, cdp: Awaited<ReturnType<typeof open>>["cdp"], p: { x: number; y: number }, ms: number) {
  const tried = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    await clearHints(page);
    const r = await gesture(page, cdp, p, ms, null);
    tried.push({ ...r, hints: await hints(page) });
    if (judgeHold(tried[tried.length - 1]!, tried) === "done") return tried;
  }
  throw new Error(`no hold the page saw whole and watched in three attempts: ${JSON.stringify(tried)}`);
}

// the release inside the block: at 120 ms for a block from the delivery, at
// 250 ms for one from 100 ms (at 120 it had 20 ms of margin — one row in 24
// came before the block even unloaded, R401)
for (const [name, block, releaseAt] of [["a block from the press's delivery to 520 ms", { from: 0, to: 520 }, 120],
                                        ["a block from the press's delivery to 540 ms", { from: 0, to: 540 }, 120],
                                        ["a block from 100 to 700 ms after the delivery", { from: 100, to: 700 }, 250]] as const) {
  test(`${name}: no real tap fires`, async ({ page }) => {
    test.setTimeout(90_000);
    const { cdp, p } = await open(page);
    const rows = [];
    for (let i = 0; i < 8; i++) rows.push(await gesture(page, cdp, p, releaseAt, block));
    console.log(`hold-stall ${name}: ${JSON.stringify(rows)}`);
    const raced = rows.filter(r => r.pressed !== null && r.pressed < 500 && r.block !== null
                                   && r.delivered !== null && r.delivered >= HOLD_FIRE_MS);
    expect(raced.length, `real taps (stamped under 500 ms) delivered past the due time (${HOLD_FIRE_MS} ms)`)
      .toBeGreaterThanOrEqual(6);
    expect(rows.filter(r => r.pressed !== null && r.pressed < 500 && r.fired > 0), "a real tap that fired").toEqual([]);
  });
}

test(`a hold across a block past ${HOLD_STALL_MS} ms is cancelled and says so; the same hold on a smooth page fires`, async ({ page }) => {
  test.setTimeout(60_000);
  const { cdp, p } = await open(page);
  // across the block: never a fire; counted once the page saw the press down
  // through the whole block — then it ended as stalled and says so
  const tried = [];
  for (let attempt = 1; ; attempt++) {
    await clearHints(page);
    const across = await gesture(page, cdp, p, 800, { from: 100, to: 700 });
    tried.push({ ...across, hints: await hints(page) });
    expect(across.fired, `a hold the page could not watch: ${JSON.stringify(tried)}`).toBe(0);
    if (across.block !== null && across.delivered !== null && across.delivered >= across.block.to) {
      expect(tried[tried.length - 1]!.hints, "the hold ended as stalled").toContain(STALL_HINT);
      break;
    }
    expect(attempt, `the press down through the block within three attempts: ${JSON.stringify(tried)}`).toBeLessThan(3);
  }
  console.log(`hold-stall across: ${JSON.stringify(tried)}`);
  // the same hold, the page smooth
  console.log(`hold-stall smooth: ${JSON.stringify(await smoothHold(page, cdp, p, 800))}`);
});
