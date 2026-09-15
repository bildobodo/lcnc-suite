import { test, expect } from "@playwright/test";
import { ctl, MOCK } from "./ctl";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

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
  }, { timeout: 15000, intervals: [250] }).toBe(true);
  return last;
}

// The mock-gateway is shared by every spec; reset to pristine before each test.
test.beforeEach(async () => {
  await ctl({ op: "reset" });
});

test("a clean rebuild frees AND re-applies the loaded program's toolpath geometry", async ({ page }) => {
  // 4 rebuild iterations × widened poll budgets: give the whole spec room
  // under full-suite contention on the 4-core VM (typical run stays ~5 s).
  test.setTimeout(120_000);
  await page.goto(MOCK);
  // Probe appears only after the async three/ThreeViewer chunks resolve
  // (WS-E moved them off the critical path) — allow for contention.
  await expect.poll(() => page.evaluate(() => !!window.__viewerLeakProbe), { timeout: 15000 }).toBe(true);
  const empty = await settledGeometries(page);

  // Load once. This also creates troika's GLOBAL glyph atlas (lazily on the
  // first toolpath-bounds label, ~3 geoms + 1 texture, permanently resident) —
  // it is counted in `loaded` and in every `rebuilt` below, so it cancels out
  // of the comparison. loadGcode is async (preview-worker round-trip): wait for
  // the toolpath geometry to actually APPEAR before settling.
  await ctl({ op: "loadGcode" });
  await expect.poll(() => geometries(page), { timeout: 15000, intervals: [150] })
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
      timeout: 15000, intervals: [200],
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

// Small real STL fixtures exercise the worker, IDB migration and rendered
// scene together without requiring Git LFS downloads in browser CI.

const appearance = (page: Page) => page.evaluate(() => window.__viewerDiag?.getAppearance?.());

test("studio model keeps a themed, persistent ground grid through motion and rebuilds", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  let settings: Record<string, any> = { viewer: { layers: { bounds: false, tool: false }, machineEdges: true }, display: { theme: "light" } };
  await page.route("**/settings", route => route.fulfill({ json: { settings } }));
  const base = new THREE.BoxGeometry(1000, 1000, 100);
  const head = new THREE.CylinderGeometry(130, 130, 280, 64).rotateX(Math.PI / 2).toNonIndexed();
  head.computeVertexNormals(); // old, faceted browser cache
  const binary = new STLExporter().parse(new THREE.Mesh(base), { binary: true });
  let fetches = 0;
  await page.route("**/machine/base.stl", route => {
    fetches++;
    return route.fulfill({ contentType: "application/octet-stream", body: Buffer.from(binary.buffer) });
  });
  await page.route("**/machine/head.stl", route => {
    errors.push("cached head was unnecessarily fetched");
    return route.abort();
  });
  await page.goto(MOCK);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready)).toBe(true);
  // Seed an entry written by the old application (no normal-processing version).
  await page.evaluate(async ({ positions, normals }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("lcnc-geometry", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("geometries");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("geometries", "readwrite");
      transaction.objectStore("geometries").put({ positions: new Float32Array(positions), normals: new Float32Array(normals) }, "/machine/head.stl");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, { positions: Array.from(head.getAttribute("position").array), normals: Array.from(head.getAttribute("normal").array) });

  const init = {
    units: "mm", stl_base_url: "/machine/", axes: ["X", "Y", "Z"],
    parts: [
      { id: "appearance-base", file: "base.stl", group: "root", translate: [0, 0, -160], color: [0.38, 0.46, 0.5] },
      { id: "appearance-head", file: "head.stl", group: "slide", translate: [120, 0, 180], color: [0.82, 0.84, 0.82] },
    ],
    groups: [{ id: "slide", parent: "root", translate: [20, 30, 0] }, { id: "tool", parent: "slide" }],
    kinematics: [{ group: "slide", joint: 1, type: "translate", direction: "y", sign: 1 }],
    workGroup: "root", toolGroup: "tool",
    machine_bounds: { origin: [-500, -500, -210], size: [1000, 1000, 700] },
  };
  const sendInit = (rev: number) => ctl({ op: "setViewerInit", data: { ...init, _rev: rev } });
  await sendInit(1);
  await expect.poll(async () => (await appearance(page))?.parts.length).toBe(2);
  await expect.poll(async () => (await appearance(page))?.outlinedParts).toBe(2);
  const initial = (await appearance(page))!;
  expect(initial.parts.every(p => p.normalsVersion === 1)).toBe(true);
  expect(initial.parts[1]!.color).toBe("d1d6d1"); // sRGB, no accidental gamma shift
  expect(initial.grid?.visible).toBe(true);
  expect(initial.grid!.position[2]).toBeLessThan(-210);
  expect(fetches).toBe(1);

  await ctl({ op: "status_delta", data: { joint_pos: [0, 250, 0] } });
  await expect.poll(async () => (await appearance(page))?.parts[1]?.position[1]).toBe(280);
  expect((await appearance(page))!.grid!.position).toEqual(initial.grid!.position);
  await sendInit(2);
  await expect.poll(async () => (await appearance(page))?.outlinedParts).toBe(2);
  expect((await appearance(page))!.grid!.position).toEqual(initial.grid!.position);
  expect(fetches).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("viewer-light.png") });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const toggle = page.getByRole("checkbox", { name: "Ground Grid", exact: true });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect.poll(async () => (await appearance(page))?.grid?.visible).toBe(false);

  // Server settings broadcasts and reloads must both preserve the toggle.
  settings = { viewer: { layers: { groundGrid: false, machine: false }, machineEdges: true }, display: { theme: "dark" } };
  await ctl({ op: "raw", frame: { type: "settings_changed", settings } });
  await expect.poll(async () => (await appearance(page))?.outlinedParts).toBe(0);
  await expect.poll(async () => JSON.stringify((await appearance(page))?.grid?.color)).not.toBe(JSON.stringify(initial.grid!.color));
  await sendInit(3);
  await expect.poll(async () => (await appearance(page))?.parts.length).toBe(2);
  expect((await appearance(page))!.grid!.visible).toBe(false);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready)).toBe(true);
  await sendInit(4);
  await expect.poll(async () => (await appearance(page))?.parts.length).toBe(2);
  expect((await appearance(page))!.grid!.visible).toBe(false);
  expect((await appearance(page))!.parts.every(p => p.normalsVersion === 1)).toBe(true);
  expect(fetches).toBe(1); // reloaded from IndexedDB, including worker result

  settings = { viewer: { layers: { bounds: false, tool: false } }, display: { theme: "dark" } };
  await ctl({ op: "raw", frame: { type: "settings_changed", settings } });
  await expect.poll(async () => (await appearance(page))?.grid?.visible).toBe(true);
  await expect.poll(async () => (await appearance(page))?.outlinedParts).toBe(2);
  await page.screenshot({ path: testInfo.outputPath("viewer-dark.png") });
  expect(errors).toEqual([]);
});
