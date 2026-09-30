// Part B (operator 2026-09-29, Codex R38/R39): every path line at PATH_PX as
// a screen-space line. The packing, and the EQUIVALENCE with the previous GL
// lines — the fat lines draw exactly the pairs the GL index ranges drew, per
// chunk and LOD level, the overlays and the finding's reveal included — plus
// the materials, the rapid's dash distances, the culling margin, the line-
// mode switch and the memory ledger.
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { TOOLPATH_BOX_DASH_PX } from "./boxLines";
import { ref } from "vue";
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { disposeObject } from "./disposal";
import { fatGeometry, packPairs, PATH_PX } from "./fatPaths";
import { createToolpathController, LIMIT_OVERLAY_RENDER_ORDER, type PathLineMode, type ToolpathCtx } from "./toolpathController";

describe("packPairs / fatGeometry", () => {
  const pos = new Float32Array([0, 0, 0, 10, 0, 0, 10, 0, 0, 10, 5, 0, 0, 5, 0]);
  it("packs a pair range as six floats each, the dash distances from the stream's own vertices", () => {
    const dist = new Float32Array([0, 10, 10, 15, 25]);
    const p = packPairs(pos, [0, 1, 2, 3, 3, 4], 0, 6, dist);
    expect(p.pairs).toBe(3);
    expect(Array.from(p.positions)).toEqual([0, 0, 0, 10, 0, 0, 10, 0, 0, 10, 5, 0, 10, 5, 0, 0, 5, 0]);
    expect(Array.from(p.distances!)).toEqual([0, 10, 10, 15, 15, 25]);
  });
  it("drops a pair whose endpoints coincide, and reads a sub-range", () => {
    const p = packPairs(pos, [0, 1, 1, 2, 3, 4], 2, 4, null);   // (1,2) coincide, (3,4) kept
    expect(p.pairs).toBe(1);
    expect(Array.from(p.positions)).toEqual([10, 5, 0, 0, 5, 0]);
    expect(p.distances).toBeNull();
  });
  it("keeps a segment along the view direction (a plunge seen from above): only coincident ends are dropped", () => {
    const p = packPairs(new Float32Array([5, 5, 10, 5, 5, -2]), [0, 1], 0, 2, null);
    expect(p.pairs).toBe(1);
    expect(Array.from(p.positions)).toEqual([5, 5, 10, 5, 5, -2]);
  });
  it("a geometry draws exactly its pairs; an empty one draws nothing; the chunk's sphere replaces the computed one", () => {
    const sphere = new THREE.Sphere(new THREE.Vector3(1, 2, 3), 99);
    const g = fatGeometry(packPairs(pos, [0, 1, 3, 4], 0, 4, new Float32Array([0, 1, 2, 3, 4])), sphere);
    expect(g.instanceCount).toBe(2);
    expect(g.boundingSphere).toBe(sphere);
    expect(g.getAttribute("instanceDistanceStart")).toBeTruthy();
    const empty = fatGeometry(packPairs(pos, [], 0, 0, null));
    expect(empty.instanceCount).toBe(0);
  });
});

// A program spread over the table (several spatial chunks), with a coarse
// LOD level, section breaks, rapids with their dash distances, outside flags
// and source ids for a reveal.
function program() {
  const feed: number[] = [];
  for (let r = 0; r < 12; r++) for (let c = 0; c <= 10; c++) feed.push((r % 2 ? 10 - c : c) * 20, r * 15, 0);
  const nF = feed.length / 3;
  const rapid = [0, 0, 50, 0, 0, 2, 200, 165, 50, 200, 165, 2, 0, 0, 50];
  const nR = rapid.length / 3;
  const rapidDist = new Float32Array(nR);
  for (let i = 1; i < nR; i++) rapidDist[i] = rapidDist[i - 1]! + Math.hypot(rapid[i * 3]! - rapid[i * 3 - 3]!, rapid[i * 3 + 1]! - rapid[i * 3 - 2]!, rapid[i * 3 + 2]! - rapid[i * 3 - 1]!);
  const coarse: number[] = [];
  for (let r = 0; r < 12; r++) { coarse.push(r * 11, r * 11 + 10); if (r < 11) coarse.push(r * 11 + 10, r * 11 + 11); }
  const feedOutside = new Uint8Array(nF);
  // flagged: the segments ending at X 120..160 on the upper rows — INSIDE the
  // coarse level's row chords (X 0 → 200), never at their ends
  for (let i = 0; i < nF; i++) feedOutside[i] = feed[i * 3]! >= 120 && feed[i * 3]! <= 160 && feed[i * 3 + 1]! > 90 ? 1 : 0;
  return {
    feedPos: new Float32Array(feed), rapidPos: new Float32Array(rapid), rapidDist,
    feedBreaks: new Uint32Array([0, 66]),
    feedLod: [new Uint32Array(coarse)], lodTols: [0.01],
    feedOutside, rapidOutside: new Uint8Array([0, 0, 1, 1, 0]),
    feedSrc: Uint32Array.from({ length: nF }, (_, i) => i), rapidSrc: Uint32Array.from({ length: nR }, (_, i) => 1000 + i),
    bounds: { min: [0, 0, 0], max: [200, 165, 50] },
  } as any;
}

function build(mode: PathLineMode) {
  const ctx = {
    scene: new THREE.Scene(), workOrigin: new THREE.Group(), workRotGroup: new THREE.Group(),
    pathAnchor: null, pathRot: null, roomOrigin: null, roomRotGroup: null, roomAnchor: null, roomRot: null,
    pathAlwaysOnTop: false, units: "mm",
  } as unknown as ToolpathCtx & { workRotGroup: THREE.Group };
  const c = createToolpathController({
    requestRender: vi.fn(), boundsClipPlanes: [new THREE.Plane(new THREE.Vector3(1, 0, 0), -150)], insideBoundsClipPlanes: [],
    billboardLabels: [], makeLabel: vi.fn(() => { const o = new THREE.Object3D() as any; o.dispose = vi.fn(); return o; }),
    disposeObject, colors: () => ({ feed: "#00a83c", rapid: "#3d8bff", toolpathBounds: "#15181c", boundsAlt: "#f0f2f4", limit: "#e66b00" }),
    sceneBackground: () => new THREE.Color("#ffffff"), sceneForeground: () => new THREE.Color("#000000"),
    axisCss: { x: "#f00", y: "#0f0", z: "#00f" }, overflow: ref(false), chunkCells: 8, lineMode: mode,
  });
  c.apply(ctx, program());
  return { c, ctx };
}

/** The drawn pairs of an object as coordinate sextuples (degenerate ones out). */
function drawnPairs(o: THREE.Object3D): string[] {
  const out: string[] = [];
  if ((o as LineSegments2).isLineSegments2) {
    const g = (o as LineSegments2).geometry;
    const a = (g.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute).data.array as Float32Array;
    for (let i = 0; i < g.instanceCount; i++) out.push(Array.from(a.slice(i * 6, i * 6 + 6)).join(","));
    return out;
  }
  const g = (o as THREE.LineSegments).geometry;
  const pos = g.getAttribute("position").array as Float32Array, idx = g.index!.array;
  const end = Math.min(idx.length, g.drawRange.start + g.drawRange.count);
  for (let q = g.drawRange.start; q + 1 < end; q += 2) {
    const s = [...pos.slice(idx[q]! * 3, idx[q]! * 3 + 3), ...pos.slice(idx[q + 1]! * 3, idx[q + 1]! * 3 + 3)];
    if (s[0] === s[3] && s[1] === s[4] && s[2] === s[5]) continue;
    out.push(s.join(","));
  }
  return out;
}
const roleObjects = (g: THREE.Group, role: string) =>
  g.children.filter(o => ((o as THREE.Mesh).material as THREE.Material | undefined)?.userData?.role === role);

describe("the fat path draws exactly the GL path's pairs (Codex R39)", () => {
  it("per chunk and LOD level, for feed, rapid and the limit overlays", () => {
    const gl = build("gl"), fat = build("fat");
    for (const role of ["feed", "rapid", "limit"]) {
      const a = roleObjects(gl.ctx.workRotGroup, role), b = roleObjects(fat.ctx.workRotGroup, role);
      expect(b.length, `${role}: one object per chunk × level`).toBe(a.length);
      expect(a.length, `${role}: something drawn`).toBeGreaterThan(0);
      for (let i = 0; i < a.length; i++) expect(drawnPairs(b[i]!), `${role} object ${i}`).toEqual(drawnPairs(a[i]!));
      expect(b.every(o => (o as LineSegments2).isLineSegments2)).toBe(true);
    }
    expect(fat.c.drawSegs).toBe(gl.c.drawSegs);
  });

  it("the finding's reveal on a hidden layer: the same pairs", () => {
    const gl = build("gl"), fat = build("fat");
    for (const t of [gl, fat]) { t.c.setRapidsVisible(false); t.c.setReveal({ run: [1001, 1003], feed: false, rapid: true }); }
    const shown = (t: typeof gl) => t.ctx.workRotGroup.children.filter(o => o.visible && ((o as THREE.Mesh).material as THREE.Material).userData?.role === "rapid");
    expect(shown(fat).map(drawnPairs)).toEqual(shown(gl).map(drawnPairs));
    expect(shown(fat).length).toBe(1);
  });

  it("materials: PATH_PX in CSS px, no depth write, the rapid dashed with the stream's own distances, orders 10 / 12", () => {
    const { ctx } = build("fat");
    const mats = (role: string) => roleObjects(ctx.workRotGroup, role).map(o => (o as LineSegments2).material as LineMaterial);
    for (const role of ["feed", "rapid", "limit"]) {
      for (const m of mats(role)) {
        expect([m.linewidth, m.worldUnits, m.depthWrite], role).toEqual([PATH_PX, false, false]);
        expect(m.dashed, role).toBe(role === "rapid");
      }
    }
    expect(roleObjects(ctx.workRotGroup, "feed").every(o => o.renderOrder === 10)).toBe(true);
    expect(roleObjects(ctx.workRotGroup, "limit").every(o => o.renderOrder === LIMIT_OVERLAY_RENDER_ORDER)).toBe(true);
    // the rapid's distances: the stream's cumulative length at each end
    const r = roleObjects(ctx.workRotGroup, "rapid").find(o => (o as LineSegments2).geometry.instanceCount > 0) as LineSegments2;
    const d = (r.geometry.getAttribute("instanceDistanceStart") as THREE.InterleavedBufferAttribute).data.array as Float32Array;
    const dist = program().rapidDist as Float32Array;
    expect(Array.from(d).every(v => Array.from(dist).some(x => Math.abs(x - v) < 1e-4))).toBe(true);
  });

  it("a flagged vertex inside a coarse LOD chord keeps its limit mark at that level (Codex R39)", () => {
    const { ctx } = build("fat");
    const prog = program();
    const flagged = new Set<string>();
    for (let i = 0; i < prog.feedOutside.length; i++) if (prog.feedOutside[i]) flagged.add(`${prog.feedPos[i * 3]},${prog.feedPos[i * 3 + 1]}`);
    // a coarse chord spans a whole row (X 0 → 200); the fine level's pairs span 20
    const chords = roleObjects(ctx.workRotGroup, "limit").flatMap(o => drawnPairs(o).map(p => p.split(",").map(Number)))
      // feed plane only: the fixture's rapids leave Z 0 and one of them is a
      // flagged 200 mm diagonal — it is not a coarse feed chord
      .filter(p => p[2] === 0 && p[5] === 0 && Math.abs(p[0]! - p[3]!) > 20);
    expect(chords.length, "coarse chords drawn in the overlay").toBeGreaterThan(0);
    expect(chords.every(p => !flagged.has(`${p[0]},${p[1]}`) && !flagged.has(`${p[3]},${p[4]}`)), "flagged only inside, never at a chord's end").toBe(true);
  });

  it("always on top and the stale mute reach the 2 px materials", () => {
    const { c, ctx } = build("fat");
    const feed = () => roleObjects(ctx.workRotGroup, "feed").map(o => (o as LineSegments2).material as LineMaterial);
    c.setAlwaysOnTop(true);
    expect(feed().every(m => m.depthTest === false && m.depthWrite === false)).toBe(true);
    c.setAlwaysOnTop(false);
    expect(feed().every(m => m.depthTest === true && m.depthWrite === false)).toBe(true);
    const base = feed()[0]!.color.getHexString();
    c.setStale(true);
    expect(feed()[0]!.color.getHexString(), "muted").not.toBe(base);
    c.setStale(false);
    expect(feed()[0]!.color.getHexString()).toBe(base);
  });

  it("the box overflow outside the machine window: a 2 px limit line with the clip planes, dashed like the box on screen", () => {
    const { ctx } = build("fat");
    const [ov] = roleObjects(ctx.workRotGroup, "limitBox") as LineSegments2[];
    expect(ov?.isLineSegments2).toBe(true);
    const m = ov!.material as LineMaterial;
    expect([m.linewidth, m.dashed, m.clipIntersection, m.clippingPlanes?.length]).toEqual([2, true, true, 1]);
    // the toolpath box's own screen dash (Codex R44 VP-I10): CSS px along each projected edge
    expect(["SCREEN_DASH" in m.defines, m.dashSize, m.gapSize]).toEqual([true, TOOLPATH_BOX_DASH_PX, TOOLPATH_BOX_DASH_PX]);
  });

  it("culling widens each chunk's sphere by the line's reach at its distance", () => {
    const { c, ctx } = build("fat");
    const o = roleObjects(ctx.workRotGroup, "feed")[0] as LineSegments2;
    const r0 = o.geometry.boundingSphere!.radius;
    const cam = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 1e4);
    cam.position.set(100, 80, 500); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    c.updateCulling(ctx, cam, 200);   // 1 world unit per device px
    expect(o.geometry.boundingSphere!.radius).toBeCloseTo(r0 + PATH_PX * 2 * 1, 6);
  });

  it("the line-mode switch rebuilds the last program in the other mode, never holding both", () => {
    const { c, ctx } = build("fat");
    const before = ctx.workRotGroup.children.length;
    c.setLineMode("gl", ctx);
    expect(c.lineMode).toBe("gl");
    expect(roleObjects(ctx.workRotGroup, "feed").every(o => (o as THREE.LineSegments).isLineSegments && !(o as LineSegments2).isLineSegments2)).toBe(true);
    expect(ctx.workRotGroup.children.length, "replaced, not added").toBe(before);
    c.setLineMode("fat", ctx);
    expect(roleObjects(ctx.workRotGroup, "feed").every(o => (o as LineSegments2).isLineSegments2)).toBe(true);
  });

  it("a program change and an unload leave no path instance behind; the ledger returns to zero", () => {
    const { c, ctx } = build("fat");
    const count = () => ctx.workRotGroup.children.filter(o => (o as LineSegments2).isLineSegments2 && ((o as LineSegments2).material as LineMaterial).userData.role !== "toolpathBounds").length;
    const n = count();
    c.apply(ctx, program());          // the same program again = a change of program
    expect(count(), "replaced, not added").toBe(n);
    c.dispose();
    expect(count()).toBe(0);
    const m = c.pathMemory();
    expect([m.cpu.total, m.gpu.total, m.buildBytes, m.instances]).toEqual([0, 0, 0, 0]);
  });

  it("the memory ledger: bytes by owner, CPU once per buffer, GPU only once uploaded", () => {
    const { c, ctx } = build("fat");
    const m0 = c.pathMemory();
    expect(m0.mode).toBe("fat");
    expect(m0.cpu.base).toBeGreaterThan(0);
    expect(m0.cpu.dist, "the rapid's distances").toBeGreaterThan(0);
    expect(m0.cpu.overlay, "the flagged pairs").toBeGreaterThan(0);
    expect(m0.cpu.source).toBeGreaterThan(0);
    expect(m0.cpu.total).toBe(m0.cpu.base + m0.cpu.dist + m0.cpu.overlay + m0.cpu.reveal + m0.cpu.source);
    expect(m0.gpu.total, "nothing uploaded before a draw").toBe(0);
    expect(m0.buildBytes).toBeGreaterThanOrEqual(m0.cpu.base + m0.cpu.dist);
    // three calls a buffer's upload callback after its first transfer
    const o = roleObjects(ctx.workRotGroup, "feed")[0] as LineSegments2;
    const buf = (o.geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute).data;
    buf.onUploadCallback();
    const m1 = c.pathMemory();
    expect(m1.gpu.base).toBe((buf.array as Float32Array).byteLength);
    expect(m1.instances).toBe(c.drawSegs);
  });
});
