// Part B (operator 2026-09-29, Codex R38/R39): every path line at PATH_PX as
// a screen-space line. The packing, and the EQUIVALENCE with the previous GL
// lines — the fat lines draw exactly the pairs the GL index ranges drew, per
// chunk and LOD level, the overlays and the finding's reveal included — plus
// the materials, the rapid's dash distances, the culling margin, the line-
// mode switch and the memory ledger.
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { TOOLPATH_BOX_PX } from "./boxLines";
import { ref } from "vue";
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { disposeObject } from "./disposal";
import { ON_TOP_ORDER } from "./onTop";
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

function controller(mode: PathLineMode) {
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
  return { c, ctx };
}

function build(mode: PathLineMode) {
  const { c, ctx } = controller(mode);
  c.apply(ctx, program());
  return { c, ctx };
}

/** Every typed array CONSTRUCTED while `fn` runs, independent of the ledger
 *  it checks (Codex R48 VP-I17): the constructors — a view on an existing
 *  ArrayBuffer is no allocation — and the methods that return a NEW array
 *  (slice, map, filter, from, of). Bytes at the buffer's capacity, and per
 *  calling site for the diagnosis. */
// WeakRef through globalThis: the browser tsconfig this suite checks under
// has no ES2021 lib (the test itself runs in node, which has it).
type WeakRefLike<T> = { deref(): T | undefined };
const WeakRefOf = (globalThis as unknown as { WeakRef: new <T extends object>(t: T) => WeakRefLike<T> }).WeakRef;
type Alloc = { ref: WeakRefLike<ArrayBufferLike>; site: string; bytes: number };
function allocationsDuring<T>(fn: () => T): { out: T; bytes: number; sites: Record<string, number>; refs: Alloc[] } {
  const g = globalThis as unknown as Record<string, unknown>;
  const names = ["Float32Array", "Float64Array", "Uint32Array", "Uint16Array", "Uint8Array", "Uint8ClampedArray",
    "Int32Array", "Int16Array", "Int8Array"];
  const proto = Object.getPrototypeOf(Uint8Array).prototype as Record<string, (...a: unknown[]) => unknown>;
  const saved = names.map(n => g[n]);
  const savedProto = { slice: proto.slice!, map: proto.map!, filter: proto.filter! };
  let bytes = 0;
  const sites: Record<string, number> = {};
  const refs: Alloc[] = [];   // WEAK: the spy keeps nothing alive
  const note = (a: ArrayBufferView) => {
    bytes += a.buffer.byteLength;
    // the first caller outside the meter's helpers (the site that allocates)
    const at = (new Error().stack ?? "").split("\n").slice(3).find(l => !l.includes("allocMeter"))?.trim().replace(/^at /, "") ?? "?";
    sites[at] = (sites[at] ?? 0) + a.buffer.byteLength;
    refs.push({ ref: new WeakRefOf(a.buffer), site: at, bytes: a.buffer.byteLength });
  };
  names.forEach((n, i) => {
    const C = saved[i] as new (...a: unknown[]) => ArrayBufferView;
    g[n] = new Proxy(C, {
      construct(t, args) {
        const a = Reflect.construct(t, args) as ArrayBufferView;
        if (!(args[0] instanceof ArrayBuffer)) note(a);
        return a;
      },
      get(t, key, r) {
        const v = Reflect.get(t, key, r);
        if (key !== "from" && key !== "of") return v;
        return (...a: unknown[]) => { const x = (v as (...b: unknown[]) => ArrayBufferView).apply(t, a); note(x); return x; };
      },
    });
  });
  for (const k of ["slice", "map", "filter"] as const) {
    const f = savedProto[k];
    proto[k] = function (this: unknown, ...a: unknown[]) { const x = f.apply(this, a) as ArrayBufferView; note(x); return x; };
  }
  try {
    return { out: fn(), bytes, sites, refs };
  } finally {
    names.forEach((n, i) => { g[n] = saved[i]; });
    Object.assign(proto, savedProto);
  }
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

  it("on top per stream (the Toolpath row = feed + its limit overlay, the Rapids row = rapid), kept across a rebuild; the stale mute reaches the 2 px materials", () => {
    const { c, ctx } = build("fat");
    const mats = (role: string) => roleObjects(ctx.workRotGroup, role).map(o => (o as LineSegments2).material as LineMaterial);
    const feed = () => mats("feed");
    c.setOnTop("feed", true);
    expect(feed().every(m => m.depthTest === false && m.depthWrite === false)).toBe(true);
    // the limit overlays: the feed's follows the feed, the rapid's the rapid
    expect(new Set(mats("limit").map(m => m.depthTest)), "one overlay per stream, each its stream's").toEqual(new Set([false, true]));
    expect(mats("rapid").every(m => m.depthTest === true), "the rapid keeps its own").toBe(true);
    c.rebuild(ctx);
    expect(feed().every(m => m.depthTest === false), "kept across a rebuild").toBe(true);
    c.setOnTop("rapid", true);
    expect(mats("rapid").every(m => m.depthTest === false)).toBe(true);
    expect(mats("limit").every(m => m.depthTest === false), "both overlays over the machine").toBe(true);
    c.setOnTop("feed", false); c.setOnTop("rapid", false);
    expect(feed().every(m => m.depthTest === true && m.depthWrite === false)).toBe(true);
    // the toolpath box: depth test off and drawn after the machine; back as built
    const box = () => roleObjects(ctx.workRotGroup, "toolpathBounds") as LineSegments2[];
    const built = box().map(o => o.renderOrder);
    c.setBoxOnTop(true);
    expect(box().every(o => (o.material as LineMaterial).depthTest === false && o.renderOrder >= ON_TOP_ORDER.box)).toBe(true);
    c.setBoxOnTop(false);
    expect(box().map(o => o.renderOrder)).toEqual(built);
    expect(box().every(o => (o.material as LineMaterial).depthTest === true)).toBe(true);
    const base = feed()[0]!.color.getHexString();
    c.setStale(true);
    expect(feed()[0]!.color.getHexString(), "muted").not.toBe(base);
    c.setStale(false);
    expect(feed()[0]!.color.getHexString()).toBe(base);
  });

  it("the box overflow outside the machine window: the box's own pattern with the limit's orange as the light tone, on the box's geometry, clipped outside", () => {
    const { ctx } = build("fat");
    // the box and its overflow are groups of two passes: search the tree
    const deep = (role: string) => {
      const out: LineSegments2[] = [];
      ctx.workRotGroup.traverse(o => { if (((o as THREE.Mesh).material as THREE.Material | undefined)?.userData?.role === role) out.push(o as LineSegments2); });
      return out;
    };
    const [ov] = deep("limitBox"), [dark] = deep("limitBoxDark"), [boxSolid] = deep("toolpathBounds");
    expect([ov?.isLineSegments2, dark?.isLineSegments2]).toEqual([true, true]);
    for (const o of [ov!, dark!]) {
      const m = o.material as LineMaterial;
      expect([m.linewidth, m.clipIntersection, m.clippingPlanes?.length]).toEqual([TOOLPATH_BOX_PX, true, 1]);
    }
    const m = ov!.material as LineMaterial;
    // package 4: the geometry-anchored cells, continuing the box's own
    expect(["GEO_DASH" in m.defines, "SCREEN_DASH" in m.defines]).toEqual([true, false]);
    expect(ov!.geometry, "the box's own geometry: its cells").toBe(boxSolid!.geometry);
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
    expect([m.cpu.total, m.gpu.total, m.pairs.source, m.pairs.drawn]).toEqual([0, 0, 0, 0]);
  });

  it("the memory ledger: bytes by owner, CPU once per buffer, GPU only once uploaded", () => {
    const { c, ctx } = build("fat");
    const m0 = c.pathMemory();
    expect(m0.mode).toBe("fat");
    expect(m0.cpu.base).toBeGreaterThan(0);
    expect(m0.cpu.dist, "the rapid's distances").toBeGreaterThan(0);
    expect(m0.cpu.overlay, "the flagged pairs").toBeGreaterThan(0);
    expect(m0.cpu.source).toBeGreaterThan(0);
    expect(m0.cpu.mesh, "the fat geometries' own quad mesh").toBeGreaterThan(0);
    expect(m0.cpu.payload, "the program kept for a rebuild").toBeGreaterThan(0);
    expect(m0.cpu.box, "the toolpath box and its overflow edges, built with the path").toBeGreaterThan(0);
    expect(m0.cpu.total).toBe(m0.cpu.base + m0.cpu.dist + m0.cpu.overlay + m0.cpu.reveal + m0.cpu.mesh + m0.cpu.box
      + m0.cpu.source + m0.cpu.payload);
    expect(m0.gpu.total, "nothing uploaded before a draw").toBe(0);
    expect(m0.allocated, "what the build allocated covers what it holds").toBeGreaterThanOrEqual(m0.cpu.total - m0.cpu.payload);
    expect(m0.peak, "the peak bound covers what is held").toBeGreaterThanOrEqual(m0.cpu.total);
    // three calls a buffer's upload callback after its first transfer
    const o = roleObjects(ctx.workRotGroup, "feed")[0] as LineSegments2;
    const buf = (o.geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute).data;
    buf.onUploadCallback();
    const m1 = c.pathMemory();
    expect(m1.gpu.base).toBe((buf.array as Float32Array).byteLength);
  });

  // Codex R47 VP-I17: the ledger counts what is HELD — a buffer's capacity,
  // the program kept for rebuilds, the fat mesh; current, allocated and peak
  // apart; three pair counts, only the last one "drawn".
  it("a small view keeps its whole buffer: the ledger counts the capacity", () => {
    const { c, ctx } = build("fat");
    const g = program();
    const big = new ArrayBuffer(1 << 20);                       // 1 MiB behind a small view
    const view = new Float32Array(big, 0, g.feedPos.length);
    view.set(g.feedPos);
    c.apply(ctx, { ...g, feedPos: view });
    expect(c.pathMemory().cpu.total, "the 1 MiB buffer the view keeps alive").toBeGreaterThanOrEqual(1 << 20);
  });

  it("three pair counts: source, at the current levels, drawn (visible objects only)", () => {
    const { c } = build("fat");
    const p = c.pathMemory().pairs;
    expect(p.source).toBeGreaterThan(0);
    expect(p.lod).toBeLessThanOrEqual(p.source);
    expect(p.drawn).toBeGreaterThan(0);
    expect(p.drawn).toBeLessThanOrEqual(p.lod);
    c.setVisible(false);
    expect(c.pathMemory().pairs.drawn, "a hidden layer draws nothing").toBe(0);
    expect(c.pathMemory().pairs.lod).toBe(p.lod);
  });

  it("a finding's view built three times: the same bytes held, three times allocated", () => {
    const { c } = build("fat");
    const held: number[] = [], alloc: number[] = [];
    for (let k = 0; k < 3; k++) {
      const before = c.pathMemory();
      c.setReveal({ run: [0, 40], feed: true, rapid: false } as any);
      const m = c.pathMemory();
      held.push(m.cpu.total); alloc.push(m.allocated);
      expect(m.peak, "the bound: held when the build began + what it allocated")
        .toBeGreaterThanOrEqual(before.cpu.total + (m.allocated - before.allocated));
    }
    expect(new Set(held).size, "current: held, not summed").toBe(1);
    expect(alloc[1]! - alloc[0]!).toBeGreaterThan(0);
    expect(alloc[2]! - alloc[1]!).toBe(alloc[1]! - alloc[0]!);
  });

  // Codex R47 VP-I14: every build phase of the A/B run is a real build.
  for (const mode of ["fat", "gl"] as const) {
    it(`rebuild (${mode}): new objects every time, whether or not the mode changes; setLineMode keeps its no-op`, () => {
      const { c, ctx } = build(mode);
      const objs = () => roleObjects(ctx.workRotGroup, "feed");
      const g0 = c.generation, first = objs();
      c.setLineMode(mode, ctx);
      expect([c.generation, objs().every((o, i) => o === first[i])], "an unchanged mode: nothing rebuilt").toEqual([g0, true]);
      c.rebuild(ctx);
      const second = objs();
      expect(c.generation).toBe(g0 + 1);
      expect(second.length).toBe(first.length);
      expect(second.some(o => first.includes(o)), "every object new").toBe(false);
      c.rebuild(ctx);
      expect(objs().some(o => second.includes(o))).toBe(false);
      expect(c.generation).toBe(g0 + 2);
    });
  }

  it("release: every path object disposed, the program kept — the ledger holds the payload alone; rebuild restores it", () => {
    const { c, ctx } = build("fat");
    const before = c.pathMemory();
    c.release();
    const m = c.pathMemory();
    expect(roleObjects(ctx.workRotGroup, "feed")).toEqual([]);
    expect([m.cpu.base, m.cpu.dist, m.cpu.overlay, m.cpu.reveal, m.cpu.mesh, m.cpu.source, m.gpu.total]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(m.cpu.payload, "the program stays").toBeGreaterThan(0);
    expect(m.cpu.total).toBe(m.cpu.payload);
    c.rebuild(ctx);
    const after = c.pathMemory();
    expect(after.cpu.total).toBe(before.cpu.total);
    expect(roleObjects(ctx.workRotGroup, "feed").length).toBeGreaterThan(0);
    // this build's bound, exactly: the payload held when it began + what it
    // allocated — never the highest since the controller began
    expect(after.peak).toBe(m.cpu.total + (after.allocated - m.allocated));
    const small = { feedPos: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0]), rapidPos: new Float32Array(0),
      feedBreaks: new Uint32Array([0]), bounds: { min: [0, 0, 0], max: [10, 10, 0] } } as any;
    c.apply(ctx, small);
    expect(c.pathMemory().peak, "a smaller program's build: its own bound").toBeLessThan(after.peak);
  });

  // Codex R48 VP-I17: the peak bound covers EVERY allocation of a build —
  // scratch included, counted where it is created, never read off the
  // results. The spy above counts independently of the ledger; the bound is
  // EXACTLY held-at-start + what the spy saw (a missed site and an invented
  // byte both fail).
  const payloadBytes = (p: Record<string, unknown>) => {
    const seen = new Set<ArrayBufferLike>();
    let n = 0;
    const add = (v: unknown) => { if (ArrayBuffer.isView(v) && !seen.has(v.buffer)) { seen.add(v.buffer); n += v.buffer.byteLength; } };
    for (const v of Object.values(p)) { add(v); if (Array.isArray(v)) v.forEach(add); }
    return n;
  };
  const roomCtx = (ctx: ToolpathCtx & { workRotGroup: THREE.Group }) =>
    Object.assign(ctx, { roomRotGroup: new THREE.Group() }) as ToolpathCtx & { workRotGroup: THREE.Group };
  /** program() with the first rows room-fixed (the room sets), a legacy
   *  nested variant (no flat buffers, no worker distances), or as is. */
  const variants: Record<string, () => { p: Record<string, unknown>; room: boolean }> = {
    table: () => ({ p: program(), room: false }),
    room: () => {
      const p = program();
      const n = p.feedPos.length / 3;
      // the first 33 vertices room-fixed, with a duplicated break at the flip (the bake's shape)
      p.feedRoom = Uint8Array.from({ length: n }, (_, i) => (i < 33 ? 1 : 0));
      p.feedBreaks = new Uint32Array([0, 33, 66]);
      return { p, room: true };
    },
    legacy: () => {
      const p = program();
      const nest = (f: Float32Array) => Array.from({ length: f.length / 3 }, (_, i) => [f[i * 3]!, f[i * 3 + 1]!, f[i * 3 + 2]!]);
      return { p: { feed: nest(p.feedPos), rapid: nest(p.rapidPos), feedOutside: p.feedOutside, rapidOutside: p.rapidOutside,
        bounds: p.bounds }, room: false };
    },
  };
  for (const mode of ["fat", "gl"] as const) {
    for (const [name, make] of Object.entries(variants)) {
      it(`the peak bound is held-at-start + every array the build constructs, scratch included (${mode}, ${name})`, () => {
        const { c, ctx: base } = controller(mode);
        const { p, room } = make();
        const ctx = room ? roomCtx(base) : base;
        const first = allocationsDuring(() => c.apply(ctx, p as any));
        expect(first.bytes).toBeGreaterThan(0);
        expect(c.pathMemory().peak, JSON.stringify(first.sites, null, 1)).toBe(payloadBytes(p) + first.bytes);
        c.release();
        const held0 = c.pathMemory().cpu.total;
        const again = allocationsDuring(() => c.rebuild(ctx));
        expect(c.pathMemory().peak, JSON.stringify(again.sites, null, 1)).toBe(held0 + again.bytes);
        expect(c.pathMemory().generation).toBe(2);
      });
    }
    it(`a finding's view: the peak bound covers it (${mode})`, () => {
      const { c, ctx } = build(mode);
      c.setRapidsVisible(false);
      const before = c.pathMemory();
      const rv = allocationsDuring(() => c.setReveal({ run: [1001, 1003], feed: false, rapid: true } as any));
      expect(rv.bytes, "the reveal built something").toBeGreaterThan(0);
      const m = c.pathMemory();
      expect(m.allocated - before.allocated, JSON.stringify(rv.sites, null, 1)).toBe(rv.bytes);
      expect(m.peak).toBe(Math.max(before.peak, before.cpu.total + rv.bytes));
      void ctx;
    });
  }

  // Codex R49 VP-I17: what a build leaves ALIVE is in the ledger — found by
  // a full collection, independent of the ledger's own walk: every array the
  // builds allocated that survives gc() must be among the buffers the CPU
  // side counts (the prepared overlay indices and chunk boxes stayed held
  // and uncounted).
  const gc = (globalThis as { gc?: () => void }).gc;
  const tick = () => new Promise(r => setTimeout(r, 0));
  async function survivors(refs: Alloc[]) {
    // a WeakRef keeps its target alive through the job that made it
    await tick(); gc!(); await tick(); gc!();
    return refs.flatMap(r => { const b = r.ref.deref(); return b ? [{ buffer: b, site: r.site, bytes: r.bytes }] : []; });
  }
  for (const mode of ["fat", "gl"] as const) {
    for (const [name, make] of Object.entries(variants)) {
      it(`everything a build and a finding's view leave alive is in the ledger (${mode}, ${name})`, async () => {
        expect(gc, "vitest runs with --expose-gc").toBeTypeOf("function");
        const { c, ctx: base } = controller(mode);
        const { p, room } = make();
        const ctx = room ? roomCtx(base) : base;
        const refs = [...allocationsDuring(() => c.apply(ctx, p as any)).refs];
        c.setRapidsVisible(false);
        refs.push(...allocationsDuring(() => c.setReveal({ run: [1001, 1003], feed: false, rapid: true } as any)).refs);
        refs.push(...allocationsDuring(() => c.rebuild(ctx)).refs);
        const alive = await survivors(refs);
        expect(alive.length, "the build holds what it drew").toBeGreaterThan(0);
        const held = c.heldBuffers();
        expect(alive.filter(a => !held.has(a.buffer)).map(a => `${a.site}: ${a.bytes} B`)).toEqual([]);
      });
    }
  }

  it("a program of separate single points: the frame index's scratch counts (Codex R48's 4096-section case)", () => {
    const { c, ctx } = controller("fat");
    const n = 4096;
    const p = { feedPos: new Float32Array(n * 3), feedBreaks: Uint32Array.from({ length: n }, (_, i) => i),
      rapidPos: new Float32Array(), bounds: { min: [0, 0, 0], max: [0, 0, 0] } } as any;
    const a = allocationsDuring(() => c.apply(ctx, p));
    expect(a.bytes, "at least the break mask").toBeGreaterThanOrEqual(n);
    expect(c.pathMemory().peak, JSON.stringify(a.sites, null, 1)).toBe(payloadBytes(p) + a.bytes);
  });

  // The eager estimate (Codex R39/R47/R48): known before the first pair is
  // packed, an upper bound on what the pack allocates — equal when no pair
  // is degenerate, above it by exactly the dropped pairs.
  it("the eager estimate precedes the pack and bounds it", () => {
    const { c } = build("fat");
    const e = c.pathMemory().eager;
    expect(e.packed).toBeGreaterThan(0);
    expect(e.estimate).toBe(e.packed);
    const { c: c2, ctx } = controller("fat");
    const p = program();
    // three coincident points in a row: two degenerate feed pairs
    p.feedPos = new Float32Array([...p.feedPos.slice(0, 3), ...p.feedPos.slice(0, 3), ...p.feedPos]);
    p.feedOutside = new Uint8Array(p.feedPos.length / 3);
    p.feedSrc = Uint32Array.from({ length: p.feedPos.length / 3 }, (_, i) => i);
    p.feedLod = []; p.feedBreaks = new Uint32Array([0]);
    c2.apply(ctx, p);
    const d = c2.pathMemory().eager;
    expect(d.estimate - d.packed, "two dropped pairs, 24 bytes each").toBe(2 * 24);
    const { c: g } = build("gl");
    expect(g.pathMemory().eager, "the GL lines share the prepared indices").toEqual({ estimate: 0, packed: 0 });
  });
});
