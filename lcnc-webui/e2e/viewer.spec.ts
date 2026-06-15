import { test, expect } from "@playwright/test";
import WebSocket from "ws";

// Viewer GPU-resource leak probe (A2). window.__viewerLeakProbe reports live
// THREE.WebGLRenderer.info counts. A program's feed/rapid/highlight geometry is
// PER-PROGRAM: a scene rebuild (clearScene) must dispose it. The old
// disposeObject skipped it (it was wrongly tagged userData._shared), so it
// survived every reconnect rebuild — a geometry leak. This spec loads programs,
// forces clean in-session rebuilds, and asserts the renderer-tracked geometry
// count converges back to the no-program baseline.
//
// Scope: renderer.info tracks geometries/textures/programs but NOT material
// instances, so the material-leak half of A2 (edge materials, colour clones) is
// guarded by src/viewer/disposal.test.ts (dispose spies), not here.
//
// Robustness: loadGcode is async (preview-worker round-trip) and rendering is
// rAF-batched, so the spec POLLS for a settled count rather than guessing a
// fixed wait — fixed settles raced the worker when both serial specs ran under
// load. Runs in the serial `serial` project: a contention-free, settled
// renderer, and it drives mock-global rebuild/load state.
const MOCK = "http://localhost:4174/";
const CTL = "ws://localhost:4174/ctl";

function ctl(op: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = new WebSocket(CTL);
    c.once("open", () => c.send(JSON.stringify(op)));
    c.once("message", () => { c.close(); resolve(); });
    c.once("error", reject);
  });
}

type Page = import("@playwright/test").Page;

const geometries = (page: Page) =>
  page.evaluate(() => window.__viewerLeakProbe?.()?.geometries ?? -1);

// Poll until the geometry count is the same on two reads ~250 ms apart, then
// return it — a settled value immune to mid-rebuild / mid-fetch transients.
async function settledGeometries(page: Page): Promise<number> {
  let last = -999;
  await expect.poll(async () => {
    const now = await geometries(page);
    const stable = now >= 0 && now === last;
    last = now;
    return stable;
  }, { timeout: 8000, intervals: [250] }).toBe(true);
  return last;
}

test("a clean rebuild frees the loaded program's toolpath geometry", async ({ page }) => {
  await page.goto(MOCK);
  await expect.poll(() => page.evaluate(() => !!window.__viewerLeakProbe)).toBe(true);

  // Prime once so troika's GLOBAL glyph atlas (created lazily on the first
  // toolpath-bounds label, ~3 geoms + 1 texture, then permanently resident) is
  // already counted in every reading below — otherwise it would masquerade as a
  // first-cycle "leak". This is why the test compares a DELTA, not an absolute
  // baseline: the atlas is present in both `loaded` and `rebuilt`, so it cancels.
  await ctl({ op: "loadGcode" });
  await settledGeometries(page);
  await ctl({ op: "rebuildInit" });
  await settledGeometries(page);

  // Repeat several cycles: the freed-delta must hold every time (a per-cycle
  // leak that survived clearScene would shrink the delta toward zero) and the
  // post-rebuild count must not climb (no accumulation).
  let rebuilt = await settledGeometries(page);
  for (let i = 0; i < 4; i++) {
    const before = rebuilt;
    await ctl({ op: "loadGcode" });
    // loadGcode is async (preview-worker round-trip): wait for the toolpath
    // geometry to actually APPEAR before settling, or a premature "stable" read
    // at the pre-load count makes the delta below collapse under CPU load.
    await expect.poll(() => geometries(page), { timeout: 8000, intervals: [150] })
      .toBeGreaterThan(before + 1);
    const loaded = await settledGeometries(page);

    await ctl({ op: "rebuildInit" });
    // Core invariant: the clean rebuild disposes the per-program toolpath
    // geometry (feed/rapid/highlight ≈ 3), so the count drops back to ~before.
    // POLL for it rather than a single read — buildFromInit's clearScene runs a
    // Vue-tick + WS-hop after the broadcast, and that latency varies under
    // full-suite load (the source of an earlier intermittent flake). With the
    // old leak the toolpath was userData._shared and survived clearScene, so
    // the count never drops and this poll times out → RED.
    await expect.poll(() => geometries(page), {
      timeout: 8000, intervals: [150],
      message: `cycle ${i}: clean rebuild did not free the loaded toolpath geometry`,
    }).toBeLessThanOrEqual(loaded - 2);
    rebuilt = await settledGeometries(page);

    // No accumulation across cycles (troika atlas aside, the steady state is flat).
    expect(rebuilt, `cycle ${i}: post-rebuild geometry grew`).toBeLessThanOrEqual(before + 1);
  }
});
