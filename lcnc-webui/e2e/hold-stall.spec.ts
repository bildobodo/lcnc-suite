// Hold after a stall, real time (Codex R397 / R399, operator Q397-1): a hold
// whose watch saw the page blocked past HOLD_STALL_MS ends for good — "Page
// delayed — hold again", nothing sent; a short tap never fires, whatever
// the browser runs first after the block. REAL time on purpose: the race is
// the browser scheduler's (the other hold specs run on the page's clock,
// holdClock.ts). The block is anchored at the press's DELIVERY (the handler
// after the button's own, Codex R399), the release is asked for by a Node
// timer and judged by the events' own timestamps: a "real tap" is a release
// stamped under 500 ms after its press. The measurement does not claim a
// rate — it holds that no real tap fired; which order the browser took is
// in the rows it prints.
import { test, expect, type Page } from "./test";
import { enterTouch } from "./touchMode";
import { ctl, MOCK } from "./ctl";
import { HOLD_STALL_MS } from "../src/holdGesture";

test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } });

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
  await enterTouch(page);
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", data: { active_file: "/A.ngc", homed: [1, 1, 1], permissions: PERMS_ALL } });
  await expect(page.getByRole("button", { name: "Unhome All", exact: true })).toBeEnabled();
  const box = (await page.getByRole("button", { name: "Unhome All", exact: true }).boundingBox())!;
  return { cdp: await page.context().newCDPSession(page), p: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}

/** One gesture: the press, a block of the main thread from `from` to `to` ms
 *  after the press's delivery (none when null), the release asked for at
 *  `releaseAt` ms. → whether it fired, and the release's stamp after the press's. */
async function gesture(page: Page, cdp: Awaited<ReturnType<typeof open>>["cdp"], p: { x: number; y: number },
                       releaseAt: number, block: { from: number; to: number } | null) {
  await ctl({ op: "clearCmds" });
  await page.evaluate((b) => {
    const w = window as unknown as { __hs: { t: string; ts: number }[] };
    w.__hs = [];
    for (const t of ["pointerdown", "pointerup"]) window.addEventListener(t, (e) => w.__hs.push({ t, ts: e.timeStamp }), { capture: true, once: true });
    if (b) window.addEventListener("pointerdown", () => {
      const delivered = performance.now();                 // after the button's own handler (window, bubble)
      setTimeout(() => { while (performance.now() - delivered < b.to) { /* blocked */ } }, Math.max(0, b.from));
    }, { once: true });
  }, block);
  const t0 = Date.now();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
  await sleep(Math.max(0, releaseAt - (Date.now() - t0)));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(900);
  const ev = await page.evaluate(() => (window as unknown as { __hs: { t: string; ts: number }[] }).__hs);
  const down = ev.find(e => e.t === "pointerdown"), up = ev.find(e => e.t === "pointerup");
  return { fired: await unhomes(), pressed: down && up ? up.ts - down.ts : null };
}

for (const [name, block] of [["a block from the press's delivery to 520 ms", { from: 0, to: 520 }],
                             ["a block from the press's delivery to 540 ms", { from: 0, to: 540 }],
                             ["a block from 100 to 700 ms after the delivery", { from: 100, to: 700 }]] as const) {
  test(`${name}: no real tap fires`, async ({ page }) => {
    test.setTimeout(90_000);
    const { cdp, p } = await open(page);
    const rows = [];
    for (let i = 0; i < 8; i++) rows.push(await gesture(page, cdp, p, 120, block));
    console.log(`hold-stall ${name}: ${JSON.stringify(rows)}`);
    const real = rows.filter(r => r.pressed !== null && r.pressed < 500);
    expect(real.length, "real taps made (a release stamped under 500 ms)").toBeGreaterThanOrEqual(6);
    expect(real.filter(r => r.fired > 0), "a real tap that fired").toEqual([]);
  });
}

test(`a hold across a block past ${HOLD_STALL_MS} ms is cancelled and says so; the same hold on a smooth page fires`, async ({ page }) => {
  test.setTimeout(60_000);
  const { cdp, p } = await open(page);
  // every hint text the gesture shows (the hint hides itself after ~1.6 s)
  await page.evaluate(() => {
    const w = window as unknown as { __hints: string[] };
    w.__hints = [];
    new MutationObserver(() => {
      const h = document.querySelector("[data-btn-hint]")?.textContent?.trim();
      if (h && w.__hints[w.__hints.length - 1] !== h) w.__hints.push(h);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const across = await gesture(page, cdp, p, 800, { from: 100, to: 700 });
  expect(across.fired, "a hold the page could not watch").toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __hints: string[] }).__hints)).toContain("Page delayed — hold again");
  const smooth = await gesture(page, cdp, p, 800, null);
  expect(smooth.fired, "the same hold, the page smooth").toBe(1);
});
