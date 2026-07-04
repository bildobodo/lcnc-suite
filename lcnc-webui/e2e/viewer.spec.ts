import { test, expect } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

// Viewer GPU-resource leak probe (A2). window.__viewerLeakProbe reports live
// THREE.WebGLRenderer.info counts. A program's feed/rapid/highlight geometry is
// PER-PROGRAM: a scene rebuild (clearScene) must dispose it — and (review-fix
// batch) buildFromInit then RE-APPLIES the current program, so the preview
// survives a mid-session rebuild. This spec loads a program, forces clean
// in-session rebuilds, and asserts the renderer-tracked geometry count returns
// to the loaded level every cycle: a disposal leak (the old userData._shared
// mis-tag survived clearScene) ADDS ~3 geoms per cycle and fails the upper
// bound; a missing re-apply drops the count and fails the lower bound.
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

// The mock-gateway is shared by every spec; reset to pristine before each test.
test.beforeEach(async () => {
  await ctl({ op: "reset" });
});

test("a clean rebuild frees AND re-applies the loaded program's toolpath geometry", async ({ page }) => {
  await page.goto(MOCK);
  await expect.poll(() => page.evaluate(() => !!window.__viewerLeakProbe)).toBe(true);
  const empty = await settledGeometries(page);

  // Load once. This also creates troika's GLOBAL glyph atlas (lazily on the
  // first toolpath-bounds label, ~3 geoms + 1 texture, permanently resident) —
  // it is counted in `loaded` and in every `rebuilt` below, so it cancels out
  // of the comparison. loadGcode is async (preview-worker round-trip): wait for
  // the toolpath geometry to actually APPEAR before settling.
  await ctl({ op: "loadGcode" });
  await expect.poll(() => geometries(page), { timeout: 8000, intervals: [150] })
    .toBeGreaterThan(empty + 1);
  const loaded = await settledGeometries(page);

  // Repeat several clean rebuilds. Steady-state invariant: the count returns
  // to `loaded` every cycle — the rebuild disposed the old per-program
  // geometry (feed/rapid/highlight ≈ 3) AND re-applied the program preview.
  //  * A leak that survives clearScene (the old userData._shared mis-tag)
  //    accumulates ~3/cycle → upper bound goes RED by cycle 1-2.
  //  * A rebuild that loses the preview (no re-apply after
  //    toolpath.forgetAfterSceneClear) settles at ~loaded-3 → lower bound RED.
  for (let i = 0; i < 4; i++) {
    // POLL while RE-SENDING rebuildInit — a single broadcast can race the
    // page's WS readiness under full-suite load (the earlier intermittent
    // flake); each rebuildInit bumps _rev so it always forces a real rebuild.
    // Completion signal: buildFromInit stamps a fresh __viewerDiag.timestamp.
    const prevTs = await page.evaluate(() => window.__viewerDiag?.timestamp ?? 0);
    await expect.poll(async () => {
      await ctl({ op: "rebuildInit" });
      return page.evaluate(() =>
        (window.__viewerDiag?.ready && window.__viewerDiag?.timestamp) || 0);
    }, {
      timeout: 8000, intervals: [200],
      message: `cycle ${i}: rebuildInit never completed a rebuild`,
    }).toBeGreaterThan(prevTs);
    const rebuilt = await settledGeometries(page);

    expect(rebuilt, `cycle ${i}: rebuild lost the program preview (re-apply missing)`)
      .toBeGreaterThanOrEqual(loaded - 1);
    expect(rebuilt, `cycle ${i}: geometry accumulated across rebuild (clearScene leak)`)
      .toBeLessThanOrEqual(loaded + 1);
  }
});

// NOTE: H3 (tool-marker single-owner) is NOT guarded here. renderer.info only
// counts GPU-uploaded geometry, and a leaked tool marker's geometry stays flat
// in the probe (tool geometry is small / visibility- and render-on-demand-
// dependent, so it is not reliably resident) — an e2e assertion would be
// non-discriminating theater (verified: the count held at baseline even with
// replaceToolMarker's dispose removed). H3 is covered by the structural
// single-owner guarantee + disposal.test.ts (the dispose itself) + the A3
// toolController unit tests (precise, once the controller is extractable) +
// the phase-end manual smoke (tool change rebuilds the marker once).
