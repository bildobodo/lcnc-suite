// Hold after a stall with the MOUSE — the same MachineBtn pointer path, in
// Chromium and in the pinned Firefox core (Codex R399: Chromium touch is no
// evidence for Firefox's scheduler). Real time on purpose (hold-stall.spec.ts
// says why). Firefox stamps a release made during a block after the block
// (measured 2026-11-18): the cases hold what must never happen — a fire from
// a tap, from a press the page could not watch, or from an old gesture on a
// new press — and that a hold on a smooth page fires.
import { test, expect, type Page } from "./test";
import { ctl, MOCK } from "./ctl";

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

/** Block the main thread from `from` to `to` ms after the next press's delivery. */
const blockAfterPress = (page: Page, from: number, to: number) => page.evaluate(([f, t]) => {
  window.addEventListener("pointerdown", () => {
    const delivered = performance.now();
    setTimeout(() => { while (performance.now() - delivered < t) { /* blocked */ } }, f);
  }, { once: true });
}, [from, to]);

async function press(page: Page, ms: number) {
  const t0 = Date.now();
  await page.mouse.down();
  await sleep(Math.max(0, ms - (Date.now() - t0)));
  await page.mouse.up();
}

test("mouse: a tap sends nothing, a hold on a smooth page sends once", async ({ page }) => {
  await open(page);
  await press(page, 120);
  await sleep(800);
  expect(await unhomes(), "a tap").toBe(0);
  await press(page, 800);
  await expect.poll(unhomes).toBe(1);
});

test("mouse: a tap or a hold across a blocked page never fires", async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  for (const [from, to, ms] of [[0, 540, 120], [100, 700, 120], [100, 700, 800]] as const) {
    await blockAfterPress(page, from, to);
    await press(page, ms);
    await sleep(900);
    expect(await unhomes(), `block ${from}→${to} ms, press ${ms} ms`).toBe(0);
  }
});

test("mouse: an ended press's step never fires a new short press (an abort, then a new press)", async ({ page }) => {
  await open(page);
  const t0 = Date.now();
  await press(page, 100);                              // the first press ends at 100 ms
  await sleep(Math.max(0, 450 - (Date.now() - t0)));
  await press(page, 114);                              // a new 114 ms press across the first one's 500 ms
  await sleep(900);
  expect(await unhomes(), "the old press's due step on the new press").toBe(0);
});
