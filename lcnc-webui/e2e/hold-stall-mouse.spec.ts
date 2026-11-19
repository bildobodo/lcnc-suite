// Hold after a stall with the MOUSE — the same MachineBtn pointer path, in
// Chromium and in the pinned Firefox core (Codex R399: Chromium touch is no
// evidence for Firefox's scheduler). Real time on purpose (hold-stall.spec.ts
// says why). Firefox stamps a release made during a block after the block
// (measured 2026-11-18): the cases hold what must never happen — a fire from
// a tap, from a press the page could not watch, or from an old gesture on a
// new press — and that a hold on a smooth page fires. Each case PROVES its
// own setting from the deliveries the page saw (the window's capture
// listener), never from the runner's timers: a blocked tap's release came at
// or past the due time, a blocked hold was ended as stalled (its hint), a new
// press spanned the old press's due time — so a missing block or a drifted
// timing fails the case instead of leaving it green for the wrong reason.
// The abort case has no block: it runs on the page's clock (holdClock.ts),
// where its timing is exact (under the gate's load a real-time second press
// came 629 ms after the first, past the due time it must span). The real-time
// cases time the release from the press call's return (it returns after the
// page's delivery — measured, R401), assert "never fired" on every attempt
// and count an attempt only when the page's record proves its setting (the
// block recorded by the page itself, the release delivered past the due
// time, a tap or a hold of the length the page saw); an attempt the loaded
// runner kept from its setting is named and taken again, at most three.
import { test, expect, type Page } from "./test";
import { ctl, MOCK } from "./ctl";
import { installHoldClock, onPageClock } from "./holdClock";
import { judgeHold, STALL_HINT } from "./holdJudge";
import { readHints, resetHints } from "./hintRecorder";
import { HOLD_FIRE_MS } from "../src/machineControls";

test.use({ viewport: { width: 1280, height: 800 } });

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false, resume: false, step: true, abort: true,
  spindleStop: true, probe: true, zero: true, machineFrame: true, goZero: true, planeFrame: true, touchoff: true,
  touchoffRotary: true, twpCapture: true, surfaceComp: true, safety: true, setup: true, sourceWrite: true,
  toolTableWrite: true, armed: true, always: true, programLoad: true, modeManual: true, modeCoord: true,
  parameterRead: true, g30Write: true, spindleManual: true, armEnable: true, estopReset: true,
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const unhomes = async () => ((await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] }).cmds ?? [])
  .filter(c => c.cmd === "unhome_all").length;

async function open(page: Page) {
  await ctl({ op: "reset" });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", data: { active_file: "/A.ngc", homed: [1, 1, 1], permissions: PERMS_ALL } });
  const btn = page.getByRole("button", { name: "Unhome All", exact: true });
  await expect(btn).toBeEnabled();
  const box = (await btn.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await ctl({ op: "clearCmds" });
}

type Seen = { t: string; at: number };
type Blk = { from: number; to: number } | null;
/** From now on: every press and release the page delivers (`at`, its
 *  clock), and the hints shown after the next press (hintRecorder.ts — the
 *  one recorder, reset and disarmed in one step). */
async function record(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __seen: Seen[]; __rec?: boolean; __blk: Blk };
    w.__seen = [];
    w.__blk = null;
    if (w.__rec) return;
    w.__rec = true;
    for (const t of ["pointerdown", "pointerup"])
      window.addEventListener(t, () => w.__seen.push({ t, at: performance.now() }), { capture: true });
  });
  await resetHints(page);
}
async function seen(page: Page) {
  const s = await page.evaluate(() => {
    const w = window as unknown as { __seen: Seen[]; __blk: Blk };
    return { downs: w.__seen.filter(e => e.t === "pointerdown").map(e => e.at),
             ups: w.__seen.filter(e => e.t === "pointerup").map(e => e.at), block: w.__blk };
  });
  return { ...s, hints: await readHints(page) };
}
/** The one press's release after its press, as the page delivered them. */
const deliveredOf = (s: Awaited<ReturnType<typeof seen>>) =>
  s.downs.length === 1 && s.ups.length === 1 ? s.ups[0]! - s.downs[0]! : null;

/** Block the main thread from `from` to `to` ms after the next press's
 *  delivery; the page records the block as it ran. */
const blockAfterPress = (page: Page, from: number, to: number) => page.evaluate(([f, t]) => {
  window.addEventListener("pointerdown", () => {
    const delivered = performance.now();
    setTimeout(() => {
      const start = performance.now() - delivered;
      while (performance.now() - delivered < t) { /* blocked */ }
      (window as unknown as { __blk: Blk }).__blk = { from: start, to: performance.now() - delivered };
    }, f);
  }, { once: true });
}, [from, to]);

async function press(page: Page, ms: number) {
  await page.mouse.down();
  const t0 = Date.now();                                 // the call returned: the page has the press
  await sleep(Math.max(0, ms - (Date.now() - t0)));
  await page.mouse.up();
}

test("mouse: a tap sends nothing, a hold on a smooth page sends once", async ({ page }) => {
  await open(page);
  // a tap: never a fire from a press the page saw short; counted once the
  // page saw it short (a loaded runner may deliver it long — then retaken)
  const taps = [];
  for (let attempt = 1; ; attempt++) {
    await ctl({ op: "clearCmds" });
    await record(page);
    await press(page, 120);
    await sleep(800);
    const s = await seen(page), d = deliveredOf(s), fired = await unhomes();
    taps.push({ delivered: d, fired, hints: s.hints });
    if (d !== null && d < HOLD_FIRE_MS) {
      expect(fired, `a tap the page saw short: ${JSON.stringify(taps)}`).toBe(0);
      break;
    }
    expect(attempt, `a tap the page saw short within three attempts: ${JSON.stringify(taps)}`).toBeLessThan(3);
  }
  // a hold, judged by what the page saw (holdJudge.ts): retaken when the page
  // saw it short or saw it whole and stalled (said so); a fire from a press
  // the page saw short is red, so is a silent whole press
  const holds = [];
  for (let attempt = 1; ; attempt++) {
    await ctl({ op: "clearCmds" });
    await record(page);
    await press(page, 800);
    await sleep(500);
    const s = await seen(page);
    holds.push({ delivered: deliveredOf(s), fired: await unhomes(), hints: s.hints });
    if (judgeHold(holds[holds.length - 1]!, holds) === "done") break;
    expect(attempt, `a hold the page saw whole and watched within three attempts: ${JSON.stringify(holds)}`).toBeLessThan(3);
  }
  console.log(`hold-stall-mouse smooth: ${JSON.stringify({ taps, holds })}`);
});

test("mouse: a tap or a hold across a blocked page never fires", async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  // the release inside the block: at 120 ms for a block from the delivery, at
  // 250 ms for one from 100 ms (R401: 20 ms of margin was too little)
  for (const [from, to, ms] of [[0, 540, 120], [100, 700, 250], [100, 700, 800]] as const) {
    const tried = [];
    for (let attempt = 1; ; attempt++) {
      await record(page);
      await blockAfterPress(page, from, to);
      await press(page, ms);
      await sleep(900);
      const s = await seen(page), delivered = deliveredOf(s);
      tried.push({ delivered, block: s.block, hints: s.hints });
      // never a fire, whatever the attempt
      expect(await unhomes(), `block ${from}→${to} ms, press ${ms} ms: ${JSON.stringify(tried)}`).toBe(0);
      // the setting, proven by the page: the block ran and the release came
      // at or past the due time (a tap's release held back by the block; a
      // hold down through the block) — then a hold ended as stalled
      if (s.block !== null && delivered !== null && delivered >= HOLD_FIRE_MS) {
        if (ms > HOLD_FIRE_MS) expect(s.hints, `the hold ended as stalled: ${JSON.stringify(tried)}`).toContain(STALL_HINT);
        break;
      }
      expect(attempt, `the setting within three attempts: ${JSON.stringify(tried)}`).toBeLessThan(3);
    }
    console.log(`hold-stall-mouse block ${from}→${to} ms, press ${ms} ms: ${JSON.stringify(tried)}`);
  }
});

test("mouse: an ended press's step never fires a new short press (an abort, then a new press)", async ({ page }) => {
  await installHoldClock(page);
  await open(page);
  await record(page);
  await onPageClock(page, async () => {
    await page.mouse.down();                           // the first press ends at 100 ms
    await page.clock.runFor(100);
    await page.mouse.up();
    await page.clock.runFor(350);
    await page.mouse.down();                           // a new 114 ms press across the first one's 500 ms
    await page.clock.runFor(114);
    await page.mouse.up();
    await page.clock.runFor(900);
  });
  await sleep(300);
  const s = await seen(page);
  console.log(`hold-stall-mouse abort, then a new press: ${JSON.stringify(s)}`);
  expect(await unhomes(), "the old press's due step on the new press").toBe(0);
  // the setting, proven: two presses, the first ended before the second
  // began, and the first press's due time fell inside the second
  expect([s.downs.length, s.ups.length], "two presses, two releases").toEqual([2, 2]);
  const due = s.downs[0] + HOLD_FIRE_MS;
  expect(s.ups[0], "the first press ended before the second began").toBeLessThan(s.downs[1]);
  expect(s.downs[1], "the second press began before the first one's due time").toBeLessThan(due);
  expect(s.ups[1], "the second press was down at the first one's due time").toBeGreaterThan(due);
});

// Codex R401 (VM397-03 rest): the recorder takes a hint only from its own
// press. A stalled hold leaves "Page delayed" on screen; a new record, a DOM
// change before the press, then a whole press ended silently (a lost focus at
// 100 ms — no hint by contract, nothing sent): the old hint is not this
// press's, and the judgement rejects the silent whole press.
test("mouse: a hint already on screen is not the next press's — a silent whole press stays unexcused", async ({ page }) => {
  await installHoldClock(page);
  await open(page);
  await onPageClock(page, async () => {
    await record(page);
    await page.mouse.down();
    await page.clock.fastForward(700);                   // a stall: the watch sees a 700 ms gap
    await page.mouse.up();
    await page.clock.runFor(20);
    await expect(page.locator("[data-btn-hint]"), "the old hint on screen").toHaveText(STALL_HINT);
    await record(page);
    await page.evaluate(() => { const el = document.createElement("i"); document.body.append(el); el.remove(); });
    expect((await seen(page)).hints, "before the press: nothing of this record").toEqual([]);
    await page.mouse.down();
    await page.clock.runFor(100);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(700);
    await page.mouse.up();
    await page.clock.runFor(20);
  });
  const s = await seen(page);
  const a = { delivered: deliveredOf(s), fired: await unhomes(), hints: s.hints };
  console.log(`hold-stall-mouse stale hint: ${JSON.stringify(a)}`);
  expect(a.delivered, "a press the page saw whole").toBeGreaterThanOrEqual(HOLD_FIRE_MS);
  expect(a.fired, "nothing sent").toBe(0);
  expect(a.hints, "no hint of this press").not.toContain(STALL_HINT);
  expect(() => judgeHold(a, [a]), "the silent whole press is rejected").toThrow();
});
