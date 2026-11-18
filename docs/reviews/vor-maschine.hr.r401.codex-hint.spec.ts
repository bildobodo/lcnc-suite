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
/** From now on: every press and release the page delivers (`at`, its clock)
 *  and every hint text the button shows. */
const record = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __seen: Seen[]; __hints: string[]; __rec?: boolean; __blk: Blk };
  w.__seen = [];
  w.__hints = [];
  w.__blk = null;
  if (w.__rec) return;
  w.__rec = true;
  for (const t of ["pointerdown", "pointerup"])
    window.addEventListener(t, () => w.__seen.push({ t, at: performance.now() }), { capture: true });
  new MutationObserver(() => {
    const h = document.querySelector("[data-btn-hint]")?.textContent?.trim();
    if (h && w.__hints[w.__hints.length - 1] !== h) w.__hints.push(h);
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
});
const seen = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __seen: Seen[]; __hints: string[]; __blk: Blk };
  return { downs: w.__seen.filter(e => e.t === "pointerdown").map(e => e.at),
           ups: w.__seen.filter(e => e.t === "pointerup").map(e => e.at), hints: w.__hints, block: w.__blk };
});
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

test("R401: an old hint can excuse a later silent hold in the recorder", async ({ page }) => {
  await installHoldClock(page);
  await open(page);
  await onPageClock(page, async () => {
    await record(page);
    await page.mouse.down();
    await page.clock.fastForward(700);
    await page.mouse.up();
    await page.clock.runFor(20);
    await expect(page.locator("[data-btn-hint]")).toHaveText("Page delayed — hold again");
    await record(page); // exact recorder from the reviewed spec: clears arrays only
    // A routine DOM change before the new press; no new hint was emitted.
    await page.evaluate(() => { const el=document.createElement("i"); document.body.append(el); el.remove(); });
    const before = await seen(page);
    await page.mouse.down();
    await page.clock.runFor(100);
    // Named silent cancellation (console-only by contract), not a stall.
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(700);
    await page.mouse.up();
    await page.clock.runFor(20);
    const after = await seen(page), fired = await unhomes();
    const whole = deliveredOf(after)! >= HOLD_FIRE_MS;
    const originalAcceptance = whole && fired === 0 && after.hints.includes("Page delayed — hold again");
    console.log("R401-hint " + JSON.stringify({ before, after, whole, fired, originalAcceptance }));
    expect(before.hints).toContain("Page delayed — hold again");
    expect(originalAcceptance).toBe(true); // records the demonstrated blind spot, not a product PASS
    // Control: without an old visible hint this same cancellation has none.
    await record(page);
    await page.mouse.down();
    await page.clock.runFor(100);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(700);
    await page.mouse.up();
    await page.clock.runFor(20);
    const control = await seen(page);
    console.log("R401-hint-control " + JSON.stringify(control));
    expect(control.hints).toEqual([]);
  });
});
