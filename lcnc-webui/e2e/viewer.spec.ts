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

// Poll until the geometry count has held for a full second (five reads
// ~250 ms apart), then return it — a settled value immune to mid-rebuild /
// mid-fetch transients. Two equal reads were not enough under load (a
// VM-local browser on the live UI, load 5-6 on 4 cores): the rebuild's
// asynchronous tail — the program re-apply, the edge worker, the GPU upload
// on the next frame — paused longer than 250 ms, and the spec counted a
// plateau half-way ("lost the preview" / "accumulated" in 3 of 4 runs; after
// a quiet second the count was back every time: no leak, no lost re-apply).
async function settledGeometries(page: Page): Promise<number> {
  const reads: number[] = [];
  await expect.poll(async () => {
    reads.push(await geometries(page));
    const tail = reads.slice(-5);
    return tail.length === 5 && tail[0]! >= 0 && tail.every(n => n === tail[0]);
  }, { timeout: 20000, intervals: [250] }).toBe(true);
  return reads[reads.length - 1]!;
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
  // POLL while RE-SENDING rebuildInit — a single broadcast can race the
  // page's WS readiness under full-suite load (the earlier intermittent
  // flake); each rebuildInit bumps _rev so it always forces a real rebuild.
  // Completion signal: buildFromInit stamps a fresh __viewerDiag.timestamp.
  const rebuild = async (what: string) => {
    const prevTs = await page.evaluate(() => window.__viewerDiag?.timestamp ?? 0);
    await expect.poll(async () => {
      await ctl({ op: "rebuildInit" });
      return page.evaluate(() =>
        (window.__viewerDiag?.ready && window.__viewerDiag?.timestamp) || 0);
    }, {
      timeout: 15000, intervals: [200],
      message: `${what}: rebuildInit never completed a rebuild`,
    }).toBeGreaterThan(prevTs);
  };
  // One warm-up rebuild before the baseline: the glyph atlas is lazy, and
  // under load it was still not uploaded after a quiet second — the baseline
  // read 74 and the first honest rebuild 76 ("accumulated", 2026-09-25). A
  // leak or a lost re-apply still moves every counted cycle below; a re-apply
  // lost on EVERY rebuild would lower this baseline too, and the chunk count
  // right after it (>= 48 over empty) goes red.
  await rebuild("warm-up");
  const loaded = await settledGeometries(page);
  // The mock feed zigzags through every cell of the controller's 8 × 8 chunk
  // grid, so the program is drawn as 64 level-0 chunk geometries (plus rapid
  // and highlight). Pin that the multi-chunk path is what this spec covers:
  // a leak there accumulates dozens of geometries per cycle, not ~3. (LOD
  // levels ≥ 1 are uploaded only when drawn at that zoom, so renderer.info
  // cannot see them here — their disposal is the controller unit tests'.)
  expect(loaded - empty, "the mock program should draw as many chunks").toBeGreaterThanOrEqual(48);

  // Repeat several clean rebuilds. Steady-state invariant: the count returns
  // to `loaded` every cycle — the rebuild disposed the old per-program
  // geometry (64 feed chunks + rapid + highlight) AND re-applied the preview.
  //  * A leak that survives clearScene (the old userData._shared mis-tag)
  //    accumulates dozens per cycle → upper bound goes RED by cycle 1.
  //  * A rebuild that loses the preview (no re-apply after
  //    toolpath.forgetAfterSceneClear) settles at ~loaded-3 → lower bound RED.
  for (let i = 0; i < 4; i++) {
    await rebuild(`cycle ${i}`);
    const rebuilt = await settledGeometries(page);

    expect(rebuilt, `cycle ${i}: rebuild lost the program preview (re-apply missing)`)
      .toBeGreaterThanOrEqual(loaded - 1);
    expect(rebuilt, `cycle ${i}: geometry accumulated across rebuild (clearScene leak)`)
      .toBeLessThanOrEqual(loaded + 1);
  }
});

// An offline machine: the UI and the viewer load everything from the
// gateway. The 3D text labels (troika) had no font set, and troika then
// resolves its fonts from cdn.jsdelivr.net at run time — without internet
// the toolpath-bounds, probe and plane labels never rendered (found
// 2026-09-25 with the bundled UI font). Every request to another host is
// aborted and recorded; the loaded program's labels must still lay out (the
// glyph atlas is a texture that exists only once a label has glyphs).
test("the viewer fetches nothing from outside the gateway (an offline machine)", async ({ page, context }) => {
  const outside: string[] = [];
  await context.route(url => !["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol.startsWith("http"), route => {
    outside.push(route.request().url());
    return route.abort();
  });
  await page.goto(MOCK);
  await expect.poll(() => page.evaluate(() => !!window.__viewerLeakProbe), { timeout: 15000 }).toBe(true);
  const textures = () => page.evaluate(() => window.__viewerLeakProbe?.()?.textures ?? -1);
  const before = await textures();
  await ctl({ op: "loadGcode" });
  await expect.poll(() => geometries(page), { timeout: 15000, intervals: [150] }).toBeGreaterThan(0);
  await settledGeometries(page);
  await expect.poll(textures, { timeout: 15000, message: "no label glyph atlas: the labels never laid out" })
    .toBeGreaterThan(before);
  expect(outside, "requests to hosts other than the gateway").toEqual([]);
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

// ── Default framing outside the model (WP5, review C) ──
// A bed/column model far larger than the travel box (the XYZAC class: 0.4 m
// travel inside a 2.2 m machine). The default frame — build, presets, every
// ViewCube direction, both projections and Reset's endpoint — must put the
// eye OUTSIDE every non-stock part at max(travel rule, model sphere + near)
// from the target. Dolly/pan/tween paths are deliberately not certified.
const CUBE_DIRS: number[][] = [];
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) CUBE_DIRS.push([x, y, z]);

type PartBox = { id: string; min: number[]; max: number[] };
function insidePart(pos: number[], parts: PartBox[], margin = 1): string | null {
  for (const p of parts) {
    if (pos[0]! > p.min[0]! - margin && pos[0]! < p.max[0]! + margin &&
        pos[1]! > p.min[1]! - margin && pos[1]! < p.max[1]! + margin &&
        pos[2]! > p.min[2]! - margin && pos[2]! < p.max[2]! + margin) return p.id;
  }
  return null;
}
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const camera = (page: Page) => page.evaluate(() => window.__viewerDiag?.getCamera?.() ?? null);
async function settledCamera(page: Page) {
  let last = "";
  await expect.poll(async () => {
    const c = await camera(page);
    const key = JSON.stringify(c?.position);
    const stable = key === last; last = key; return stable;
  }, { timeout: 5000, intervals: [120] }).toBe(true);
  return (await camera(page))!;
}

test("default framing keeps the eye outside a bed/column model for every direction, preset, projection and reset", async ({ page }) => {
  test.setTimeout(60_000);
  const bed = new STLExporter().parse(new THREE.Mesh(new THREE.BoxGeometry(2000, 2400, 200)), { binary: true });
  const column = new STLExporter().parse(new THREE.Mesh(new THREE.BoxGeometry(400, 400, 1800)), { binary: true });
  await page.route("**/machine/bed.stl", route => route.fulfill({ contentType: "application/octet-stream", body: Buffer.from(bed.buffer) }));
  await page.route("**/machine/column.stl", route => route.fulfill({ contentType: "application/octet-stream", body: Buffer.from(column.buffer) }));
  await page.goto(MOCK);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready)).toBe(true);
  const init = {
    units: "mm", stl_base_url: "/machine/", axes: ["X", "Y", "Z"],
    parts: [
      { id: "bed", file: "bed.stl", group: "root", translate: [0, 400, -300], color: [0.4, 0.4, 0.4] },
      { id: "column", file: "column.stl", group: "root", translate: [0, 1400, 500], color: [0.5, 0.5, 0.5] },
    ],
    groups: [{ id: "head", parent: "root" }],
    kinematics: [],
    workGroup: "root", toolGroup: "head",
    machine_bounds: { origin: [-200, -70, -30], size: [400, 140, 130] },
  };
  await ctl({ op: "setViewerInit", data: { ...init, _rev: 901 } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getPartBounds?.().length ?? 0)).toBe(2);
  await ctl({ op: "status_delta", data: { joint_pos: [0, 0, 0] } });   // the first-status reframe
  const parts = (await page.evaluate(() => window.__viewerDiag!.getPartBounds!()))!;
  const frameBox = (await page.evaluate(() => window.__viewerDiag!.getFrameBox!()))!;
  const cam0 = await settledCamera(page);
  const centre = [0, 1, 2].map(i => (frameBox.min[i]! + frameBox.max[i]!) / 2);
  expect(dist(cam0.target, centre)).toBeLessThan(1);
  // Model sphere about the target from the parts' corners.
  let R = 0;
  for (const p of parts) for (let i = 0; i < 8; i++) {
    const c = [i & 1 ? p.max[0]! : p.min[0]!, i & 2 ? p.max[1]! : p.min[1]!, i & 4 ? p.max[2]! : p.min[2]!];
    R = Math.max(R, dist(c, cam0.target));
  }
  const maxDim = Math.max(...[0, 1, 2].map(i => frameBox.max[i]! - frameBox.min[i]!));
  const expected = Math.max(2.345 * maxDim, 1.05 * R + cam0.near);
  const d0 = dist(cam0.position, cam0.target);
  expect(Math.abs(d0 - expected), `default distance ${d0} vs ${expected}`).toBeLessThan(1.5);
  expect(insidePart(cam0.position, parts)).toBeNull();
  expect(cam0.minDistance).toBeCloseTo(cam0.near * 20, 6);

  // 26 ViewCube directions at the framing distance.
  for (const dir of CUBE_DIRS) {
    await page.evaluate(d => window.__viewerDiag!.setViewDirection!(d), dir);
    const c = (await camera(page))!;
    expect(insidePart(c.position, parts), `direction ${dir.join(",")} at ${c.position.map(v => v.toFixed(0))}`).toBeNull();
    expect(Math.abs(dist(c.position, c.target) - d0)).toBeLessThan(1.5);
  }
  // Presets (animated) and Reset's endpoint.
  for (const preset of ["top", "bottom", "front", "back", "left", "right", "iso", "dimetric", "reset"]) {
    await page.evaluate(p => window.__viewerDiag!.setView!(p), preset);
    const c = await settledCamera(page);
    expect(insidePart(c.position, parts), `preset ${preset}`).toBeNull();
  }
  const afterReset = await settledCamera(page);
  expect(Math.abs(dist(afterReset.position, afterReset.target) - expected)).toBeLessThan(1.5);
  // The OTHER projection (the settings default is parallel, so the first
  // switch lands on perspective): same pose, still outside; Reset lands
  // there again; then back to the default.
  const startOrtho = cam0.ortho;
  await page.evaluate(() => window.__viewerDiag!.switchProjection!());
  expect((await camera(page))!.ortho).toBe(!startOrtho);
  await page.evaluate(() => window.__viewerDiag!.setView!("reset"));
  const other = await settledCamera(page);
  expect(insidePart(other.position, parts)).toBeNull();
  expect(Math.abs(dist(other.position, other.target) - expected)).toBeLessThan(1.5);
  await page.evaluate(() => window.__viewerDiag!.switchProjection!());
  expect((await camera(page))!.ortho).toBe(startOrtho);

  // Negative control: the OLD travel-box distance from diagonally below
  // puts the eye inside the bed — the fixture discriminates.
  const oldDistance = 2.345 * maxDim;
  await page.evaluate(({ dir, d }) => window.__viewerDiag!.setViewDirection!(dir, d), { dir: [1, -1, -0.4], d: oldDistance });
  const inside = (await camera(page))!;
  expect(insidePart(inside.position, parts)).toBe("bed");
  await page.evaluate(() => window.__viewerDiag!.setView!("reset"));
  expect(insidePart((await settledCamera(page)).position, parts)).toBeNull();
});
