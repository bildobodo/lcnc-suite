// The P3 measuring instrument in the real page (machine day 2026-11-21,
// F18/F20; Codex R425 MT425-04): every page sends its stall rows
// (`browser.stall`: gaps in the timer observation past the hold guard's
// 150 ms), a refused hold reaches the trace with its OWN gap
// (`browser.hold.refused`), and a batch the transport lost is counted and
// reported in front of the next one (`browser.telemetry.dropped`).
//
// Real time on purpose: the block is a real busy loop on the page's main
// thread. Every expectation reads what the page POSTed to /telemetry.
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

type Ev = Record<string, any>;

/** Every telemetry event the page posts from now on; `fail` answers the
 *  first n POSTs with a 500 (the transport's loss). */
async function capture(page: Page, fail = 0): Promise<{ events: Ev[]; failed: Ev[][] }> {
  const events: Ev[] = [];
  const failed: Ev[][] = [];
  await page.route("**/telemetry", async (route) => {
    const batch: Ev[] = [];
    for (const line of (route.request().postData() ?? "").split("\n")) {
      if (!line) continue;
      try { batch.push(JSON.parse(line)); } catch { /* not ours */ }
    }
    if (failed.length < fail) {
      failed.push(batch);
      await route.fulfill({ status: 500, body: "" });
      return;
    }
    events.push(...batch);
    await route.fulfill({ status: 204, body: "" });
  });
  return { events, failed };
}

async function open(page: Page) {
  await ctl({ op: "reset" });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
}

const block = (page: Page, ms: number) => page.evaluate((ms) => {
  const t = performance.now();
  while (performance.now() - t < ms) { /* the main thread blocked */ }
}, ms);

test("a block on the page reaches the trace as a stall row — whatever the viewer did", async ({ page }) => {
  const { events } = await capture(page);
  await open(page);
  await block(page, 280);
  await expect.poll(() => events.filter(e => e.kind === "stall" && e.n >= 1).length, { timeout: 15000 }).toBeGreaterThan(0);
  const row = events.find(e => e.kind === "stall" && e.n >= 1)!;
  expect(row.limit_ms).toBe(150);
  expect(row.max_ms).toBeGreaterThanOrEqual(270);
  // the histogram holds the stall in its bin (250–500 for a ~280 ms gap, or
  // a higher one under a loaded runner) — never below the limit
  expect(Object.keys(row.h).every(k => Number(k) >= 150)).toBe(true);
  expect(Object.values(row.h).reduce((a: number, b) => a + (b as number), 0)).toBe(row.n);
  // Chromium has the Long Tasks API: its count rides apart, the block among it
  expect(typeof row.lt_n).toBe("number");
  expect(row.lt_max_ms).toBeGreaterThanOrEqual(270);
  expect(row.seq).toBeGreaterThanOrEqual(1);
});

test("a refused hold reports its own gap for a stall, none for an early release", async ({ page }) => {
  const { events } = await capture(page);
  await open(page);
  await ctl({ op: "status_delta", data: { active_file: "/A.ngc", homed: [1, 1, 1], permissions: PERMS_ALL } });
  const btn = page.getByRole("button", { name: "Unhome All", exact: true });
  await expect(btn).toBeEnabled();
  const box = (await btn.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // early release: a tap
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => events.filter(e => e.kind === "hold.refused").length, { timeout: 10000 }).toBe(1);
  // a stall during the hold: the watch sees the gap and ends it. The release
  // is sent only once the refusal was reported — sent right after the block
  // it may run BEFORE the overdue watch (the browser's own order, hold-stall
  // spec; gate round 1 measured it) and end the hold as released
  await page.mouse.down();
  await block(page, 300);
  await expect.poll(() => events.filter(e => e.kind === "hold.refused").length, { timeout: 10000 }).toBe(2);
  await page.mouse.up();
  // one end per gesture: the later release reports nothing. The signal: a
  // stall row EMITTED after the release (its window end past it; a later
  // block makes one due) has arrived — the batcher keeps the page's order,
  // so a report of the release would stand in front of it
  const releasedAt = await page.evaluate(() => performance.timeOrigin + performance.now());
  await block(page, 200);
  await expect.poll(() => events.filter(e => e.kind === "stall" && e.win_end > releasedAt).length, { timeout: 15000 })
    .toBeGreaterThan(0);
  expect(events.filter(e => e.kind === "hold.refused")).toHaveLength(2);
  const [tap, stalled] = events.filter(e => e.kind === "hold.refused");
  expect(tap).toMatchObject({ type: "unhome", why: "released" });
  expect("gap_ms" in tap!).toBe(false);
  expect(stalled).toMatchObject({ type: "unhome", why: "stalled" });
  expect(stalled!.gap_ms).toBeGreaterThanOrEqual(250);
  expect(((await ctl({ op: "lastCmds" })) as { cmds?: { cmd?: string }[] }).cmds?.filter(c => c.cmd === "unhome_all")).toHaveLength(0);
});

test("a batch the transport lost is counted and reported in front of the next one", async ({ page }) => {
  const { events, failed } = await capture(page, 1);
  await open(page);
  await expect.poll(() => failed.length, { timeout: 15000 }).toBe(1);
  const lost = failed[0]!.filter(e => e.kind !== "telemetry.dropped").length;
  await block(page, 200);   // a stall row makes the next batch
  await expect.poll(() => events.filter(e => e.kind === "telemetry.dropped").length, { timeout: 15000 }).toBe(1);
  const rep = events.find(e => e.kind === "telemetry.dropped")!;
  expect(rep).toMatchObject({ events: lost, batches: 1, why: { status_500: lost } });
});
