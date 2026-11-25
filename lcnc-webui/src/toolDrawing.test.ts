// A tool is drawn from ONE canonical float32 source (P6-c plan v8 §2.1 / §1.6,
// Codex R477 MT477-01, R480, R482 MT482-01): the drawn positions ARE the source,
// the quarter turn is an exact signed swap, the arrays are the real bytes.
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildHolderGeometry, drawableHolder, drawableToolGeometries, buildToolGeometries, buildToolGeometry, partGeometry, toolDrawing, type ToolMeta } from "./toolGeometry";
import {
  DRAW_BUDGET, LATHE_VERTICES_MAX, ShapeNotUsable, canonMeshSteps, canonProfile, drawCounter, drawingAdmitted, drawingBytes,
  drawingVertices, drawnSteps, isCanonMesh, latheColumnsSteps, latheSize, meshSoupSteps, withHeldMeter,
  type DrawnPart, type HeldMeter, type LathePart, type NestedMesh, type ToolDrawing,
} from "./toolDrawing";
import { runToEnd, type Steps } from "./viewer/steps";

const IN = 1 / 25.4;
const LENGTHS = ["oal", "flute_length", "shoulder_length", "shoulder_diameter", "body_length", "shaft_diameter", "tip_diameter",
  "tip_length", "corner_radius", "maximum_cutting_diameter", "upper_radius", "chamfer_width", "lower_radius", "profile_radius",
  "axial_distance", "thread_pitch", "thread_pitch_min", "thread_pitch_max", "thread_tip_width", "thread_tip_radius"] as const;
/** A library entry in another length unit. */
function scaledMeta(m: any, u: number): any {
  const out = structuredClone(m);
  for (const k of LENGTHS) if (typeof out[k] === "number") out[k] *= u;
  if (out.shaft_segments) out.shaft_segments = out.shaft_segments.map((s: any) => ({ height: s.height * u, lower_diameter: s.lower_diameter * u, upper_diameter: s.upper_diameter * u }));
  if (out.profile) out.profile = out.profile.map((s: any) => ({ ...s, end: s.end.map((x: number) => x * u), ...(s.center ? { center: s.center.map((x: number) => x * u) } : {}) }));
  if (out.native_profile) out.native_profile = out.native_profile.map((p: number[]) => p.map(x => x * u));
  if (out.native_mesh) out.native_mesh = { ...out.native_mesh, vertices: out.native_mesh.vertices.map((v: number[]) => v.map(x => x * u)) };
  return out;
}
const SEED: Record<string, any> = JSON.parse(readFileSync(new URL("../../examples/sim_config/xyz3/tool.seed.json", import.meta.url), "utf8"));
const T13 = { type: "tapered", fusion_type: "tapered mill", taper_angle: 3.7, corner_radius: 1, flute_length: 47, shoulder_length: 50,
              shoulder_diameter: 5.8, shaft_diameter: 8, oal: 100 } as ToolMeta;
interface Tool { name: string; D: number; len: number; meta: ToolMeta | null; u: number }
/** Every shipped tool, T13 and a plain one, in mm and inch. */
const TOOLS: Tool[] = [1, IN].flatMap(u => [
  ...Object.entries(SEED).map(([T, m]) => ({ name: `T${T} ${m.type}`, D: 6 * u, len: 80 * u, meta: scaledMeta(m, u) as ToolMeta, u })),
  { name: "T13", D: 1.875 * u, len: 83.19 * u, meta: scaledMeta(T13, u) as ToolMeta, u },
  { name: "no library row", D: 6 * u, len: 80 * u, meta: null, u },
]);
const drawing = (t: Tool) => toolDrawing(t.D, t.len, t.meta, t.u);
const lathes = (): Array<{ name: string; part: LathePart }> => TOOLS.flatMap(t => {
  const d = drawing(t);
  return d.kind === "lathe" ? d.parts.map(part => ({ name: t.name, part })) : [];
});
/** three's own lathe with the exact swap — what latheColumnsSteps must write. */
function threeLathe(p: LathePart): { positions: Float32Array; normals: Float32Array; index: ArrayLike<number> & { constructor: unknown } } {
  const pts = Array.from({ length: p.prof.length / 2 }, (_, i) => new THREE.Vector2(p.prof[2 * i]!, p.prof[2 * i + 1]!));
  const g = new THREE.LatheGeometry(pts, p.segments);
  const swap = (a: Float32Array) => { for (let i = 0; i < a.length; i += 3) { const y = a[i + 1]!, z = a[i + 2]!; a[i + 1] = -z; a[i + 2] = y; } return a; };
  return { positions: swap(g.getAttribute("position").array as Float32Array), normals: swap(g.getAttribute("normal").array as Float32Array),
           index: g.index!.array as any };
}
const same = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
/** Codex R482: an admissible native profile of 600 points at radius 1000. */
const CODEX_600 = { type: "formmill", native_profile: Array.from({ length: 600 }, (_, i) => [i === 0 || i === 599 ? 0 : 1000, i]) } as unknown as ToolMeta;
const bytesOf = (g: THREE.BufferGeometry) => [...new Set([...Object.values(g.attributes).map(a => (a as THREE.BufferAttribute).array.buffer),
  ...(g.index ? [g.index.array.buffer] : [])])].reduce((n, b) => n + b.byteLength, 0);

describe("the lathe is three's, turned by an exact axis swap", () => {
  it("equals LatheGeometry + the swap, value for value: every lathe of every shipped tool, mm and inch, and Codex's", () => {
    const codex = (toolDrawing(6, 80, CODEX_600) as Extract<ToolDrawing, { kind: "lathe" }>).parts[0]!;
    const all = [...lathes(), { name: "Codex 600", part: codex }];
    expect(all.length).toBeGreaterThan(90);
    for (const { name, part } of all) {
      const d = runToEnd(latheColumnsSteps(part)), t = threeLathe(part);
      expect([name, same(d.positions, t.positions), same(d.normals, t.normals), same(d.index!, t.index)]).toEqual([name, true, true, true]);
      expect(d.index!.constructor).toBe(t.index.constructor);
    }
  });
  it("draws the profile's own z and a radius within the f32 of x and y — thin rings far out too (Codex R480)", () => {
    for (const u of [1, IN]) for (const r of [1e-9, 1e-6, 1e-3, 1, 10]) for (const z of [80, 500, 1e4, 1e7, 1e9, 1e12]) {
      const part: LathePart = { role: "shaft", segments: 24, prof: canonProfile([{ x: 0, y: (z - 1) * u }, { x: r * u, y: (z - 1) * u }, { x: r * u, y: z * u }, { x: 0, y: z * u }]) };
      const d = runToEnd(latheColumnsSteps(part)), np = 4;
      for (let i = 0; i < d.positions.length / 3; i++) {
        const R = part.prof[2 * (i % np)]!, Z = part.prof[2 * (i % np) + 1]!;
        expect(d.positions[3 * i + 2]).toBe(Z);
        expect(Math.hypot(d.positions[3 * i]!, d.positions[3 * i + 1]!)).toBeLessThanOrEqual(R * (1 + 2 ** -22));
      }
    }
  });
  it("a holder and a plain outline take the same path (no second rotation)", () => {
    const pts = [new THREE.Vector2(0, 5), new THREE.Vector2(9, 5), new THREE.Vector2(4, 1e7), new THREE.Vector2(0, 1e7)];
    const want = runToEnd(latheColumnsSteps({ role: "shaft", prof: canonProfile(pts), segments: 24 }));
    expect(same(buildToolGeometry(pts).getAttribute("position").array, want.positions)).toBe(true);
    const h = buildHolderGeometry([{ height: 1e7 - 5, lower_diameter: 18, upper_diameter: 8 }], 5)!;
    const hp = h.getAttribute("position");
    for (let i = 0; i < hp.count; i++) expect([Math.fround(5), Math.fround(1e7)]).toContain(hp.getZ(i));
  });
});

describe("one canonical source", () => {
  it("a mesh is drawn from the float32 of its own coordinates, flat-shaded like three's", () => {
    for (const t of TOOLS.filter(x => x.meta?.native_mesh)) {
      const d = drawing(t) as Extract<ToolDrawing, { kind: "mesh" }>, src = t.meta!.native_mesh as NestedMesh;
      expect(src.vertices.every((v, i) => [0, 1, 2].every(j => d.mesh.pos[3 * i + j] === Math.fround(v[j]!)))).toBe(true);
      const part = runToEnd(meshSoupSteps(d.mesh));
      const ref = new THREE.BufferGeometry();
      ref.setAttribute("position", new THREE.Float32BufferAttribute(src.vertices.flatMap(v => Array.from(v)), 3));
      ref.setIndex(src.triangles.flatMap(v => Array.from(v)));
      const soup = ref.toNonIndexed();
      soup.computeVertexNormals();
      expect(same(part.positions, soup.getAttribute("position").array)).toBe(true);
      const n = soup.getAttribute("normal").array;
      expect(Math.max(...Array.from(n, (x, i) => Math.abs(x - part.normals[i]!)))).toBeLessThan(2e-7);
    }
  });
  it("a canonical mesh and profile are taken as they are, and draw the same as the nested ones", () => {
    const mesh = TOOLS.find(t => t.meta?.native_mesh)!, d = drawing(mesh) as Extract<ToolDrawing, { kind: "mesh" }>;
    expect(isCanonMesh(d.mesh)).toBe(true);
    expect((toolDrawing(mesh.D, mesh.len, { ...mesh.meta, native_mesh: d.mesh }) as any).mesh).toBe(d.mesh);
    const prof = TOOLS.find(t => t.meta?.native_profile)!;
    const canon = canonProfile((prof.meta!.native_profile as [number, number][]).map(([x, y]) => ({ x, y })));
    expect(drawing({ ...prof, meta: { ...prof.meta, native_profile: canon } })).toEqual(drawing(prof));
  });
  it("buildToolGeometries (tab preview, live marker) and the steps give the same arrays, with their bounds", () => {
    for (const t of TOOLS) {
      const g = buildToolGeometries(t.D, t.len, t.meta, t.u);
      for (const p of runToEnd(drawnSteps(drawing(t)))) {
        const geom = g[p.role]!, pos = geom.getAttribute("position");
        expect(same(pos.array, p.positions) && same(geom.getAttribute("normal").array, p.normals)).toBe(true);
        expect(geom.getAttribute("uv")).toBeUndefined();
        const s = geom.boundingSphere!, b = geom.boundingBox!, v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos as THREE.BufferAttribute, i);
          expect(v.distanceTo(s.center)).toBeLessThanOrEqual(s.radius * (1 + 1e-6) + 1e-12);
          expect(b.distanceToPoint(v)).toBeLessThanOrEqual(1e-6 * (1 + b.max.length()));
        }
      }
    }
  });
  it("what float32 cannot hold is a named fault, when it is built", () => {
    const mesh = (v: number, i = 2): NestedMesh => ({ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, v]], triangles: [[0, 1, i]] });
    for (const bad of [mesh(1e39), mesh(NaN), mesh(0, 3), mesh(0, -1), mesh(0, 1.5), mesh(0, NaN)])
      expect(() => runToEnd(canonMeshSteps(bad))).toThrow(ShapeNotUsable);
    for (const p of [{ x: 1e39, y: 0 }, { x: -1, y: 0 }, { x: 0, y: Infinity }, { x: NaN, y: 0 }])
      expect(() => canonProfile([{ x: 0, y: 0 }, p])).toThrow(ShapeNotUsable);
    expect(() => buildToolGeometries(6, 80, { native_mesh: mesh(1e39) })).toThrow(ShapeNotUsable);
  });
  it("what is shown of it is the table's cylinder, named; nothing where that cannot be drawn either", () => {
    const mesh: NestedMesh = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 1e39]], triangles: [[0, 1, 2]] };
    const pos = (g: THREE.BufferGeometry | null) => Array.from(g?.getAttribute("position").array ?? []);
    const cyl = buildToolGeometries(6, 80, null), shown = drawableToolGeometries(6, 80, { native_mesh: mesh });
    expect([pos(shown.cutter), pos(shown.shaft), shown.why]).toEqual([pos(cyl.cutter), pos(cyl.shaft), "shape not usable: a mesh coordinate"]);
    expect(pos(drawableToolGeometries(6, 80, null).shaft)).toEqual(pos(cyl.shaft));
    expect(drawableToolGeometries(6, 80, null).why).toBeNull();
    expect(drawableToolGeometries(6, 80, { type: "endmill", shaft_diameter: 1e39 } as ToolMeta).why).toMatch(/^shape not usable/);
    expect(drawableToolGeometries(6, 1e39, null)).toEqual({ cutter: null, shaft: null, why: "shape not usable: a profile point" });
    const seg = { height: 5, lower_diameter: 20, upper_diameter: 20 };
    expect(drawableHolder([seg], 1e39)).toBeNull();
    expect(drawableHolder([seg], 30)).not.toBeNull();
  });
});

/** A job's steps: how many yields, and what its arrays held at the most. */
function meter(job: Steps<DrawnPart[] | DrawnPart>): HeldMeter & { yields: number; out: DrawnPart[] } {
  const m = { bytes: 0, peak: 0, yields: 0, out: [] as DrawnPart[] };
  for (;;) {
    const r = withHeldMeter(m, () => job.next());
    if (r.done) { m.out = Array.isArray(r.value) ? r.value : [r.value]; return m; }
    m.yields++;
  }
}

describe("a drawing's bytes are its arrays' (MT482-01)", () => {
  const codex = toolDrawing(6, 80, CODEX_600);
  it("Codex's admissible lathe: 14 747 712 bytes, over the old 14.4 MB, built, and nothing beside it", () => {
    expect(drawingVertices(codex)).toBe(307_800);
    expect(drawingAdmitted(codex)).toBe(true);
    const m = meter(drawnSteps(codex)), g = partGeometry(m.out[0]!);
    const V = 307_800, I = g.index!.count;
    expect([I, bytesOf(g), drawingBytes(codex)]).toEqual([1_840_128, 24 * V + 4 * I, 24 * V + 4 * I]);
    expect(bytesOf(g)).toBe(14_747_712);
    expect(bytesOf(g)).toBeGreaterThan(14_400_000);
    // the peak: the result and the meridian normals — no second holding (v7 held all sector geometries: 31.7 MB)
    expect(m.peak).toBe(14_747_712 + 2 * 8 * 600);
    expect(g.getAttribute("position").array).toBe(m.out[0]!.positions);      // the same arrays, no copy
    expect(g.getAttribute("uv")).toBeUndefined();
  });
  it("the bytes a drawing is said to take are the bytes it has: every shipped tool, meshes and lathes", () => {
    for (const t of TOOLS) {
      const d = drawing(t), g = runToEnd(drawnSteps(d)).map(partGeometry);
      expect([t.name, g.reduce((n, x) => n + bytesOf(x), 0)]).toEqual([t.name, drawingBytes(d)]);
    }
  });
  it("cutter and shaft count together, each with its seam column; the index is 16 bit below 65 536 vertices", () => {
    const two = toolDrawing(6, 80, { type: "endmill", flute_length: 20, shaft_diameter: 6, oal: 60 }) as Extract<ToolDrawing, { kind: "lathe" }>;
    expect(two.parts.length).toBe(2);
    expect(drawingVertices(two)).toBe(two.parts.reduce((n, p) => n + 25 * (p.prof.length / 2), 0));
    const part = (np: number, segments: number): LathePart => ({ role: "shaft", segments, prof: canonProfile(Array.from({ length: np }, (_, i) => ({ x: 1, y: i }))) });
    const small = part(655, 99), large = part(656, 99);                      // 65 500 and 65 600 vertices
    expect(runToEnd(latheColumnsSteps(small)).index).toBeInstanceOf(Uint16Array);
    expect(runToEnd(latheColumnsSteps(large)).index).toBeInstanceOf(Uint32Array);
    expect(drawingBytes({ kind: "lathe", parts: [small, large] }))
      .toBe([small, large].reduce((n, p) => n + bytesOf(partGeometry(runToEnd(latheColumnsSteps(p)))), 0));
  });
  it("is admitted up to 400 000 vertices over ALL parts, at most 19.2 MB", () => {
    const part = (np: number, segments: number): LathePart => ({ role: "shaft", segments, prof: new Float32Array(2 * np) });
    const lathe = (...parts: LathePart[]): ToolDrawing => ({ kind: "lathe", parts });
    expect(drawingVertices(lathe(part(2000, 99), part(2000, 99)))).toBe(400_000);
    expect(drawingAdmitted(lathe(part(2000, 99), part(2000, 99)))).toBe(true);
    expect(drawingAdmitted(lathe(part(2000, 99), part(2001, 99)))).toBe(false);
    for (const [np, seg] of [[2000, 199], [779, 512], [16_000, 24]] as const) {
      const d = lathe(part(np, seg));
      expect([drawingAdmitted(d), drawingBytes(d) <= 48 * LATHE_VERTICES_MAX]).toEqual([true, true]);
      expect(latheSize(np, seg).i).toBeLessThan(6 * latheSize(np, seg).v);
    }
    expect(48 * LATHE_VERTICES_MAX).toBe(19_200_000);
  });
  it("three's dispose frees no array: whoever holds the geometry holds its bytes", () => {
    const g = partGeometry(runToEnd(latheColumnsSteps({ role: "shaft", segments: 24, prof: canonProfile([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 9 }]) })));
    g.dispose();
    expect(g.getAttribute("position").array.length).toBe(3 * 75);
  });
});

describe("the work is counted, step by step (Codex R485-H1)", () => {
  it("a mesh: at most the budget between two yields", () => {
    const n = 20_000, vertices: number[][] = [], triangles: number[][] = [];
    for (let k = 0; k < n; k++) { const a = 2 * Math.PI * k / n; vertices.push([4 * Math.cos(a), 4 * Math.sin(a), 0], [4 * Math.cos(a), 4 * Math.sin(a), 160]); }
    for (let k = 0; k < n; k++) { const a = 2 * k, b = 2 * ((k + 1) % n); triangles.push([a, b, b + 1], [a, b + 1, a + 1]); }
    const c1 = drawCounter(), mesh = runToEnd(canonMeshSteps({ vertices, triangles }, c1));
    expect([c1.max, c1.total]).toEqual([DRAW_BUDGET, 4 * (vertices.length + triangles.length)]);
    const c2 = drawCounter(), m = meter(meshSoupSteps(mesh, c2));
    expect([c2.max <= DRAW_BUDGET, c2.total]).toEqual([true, 24 * triangles.length + vertices.length]);
    expect(m.yields).toBeGreaterThan(c2.total / DRAW_BUDGET - 1);
  });
  // sizes that do not divide the budget: a column may not run past it, and the
  // index is work like the vertices
  for (const [np, segments] of [[600, 512], [800, 48], [2000, 199], [4097, 24], [7, 24]] as const)
    it(`${np} points at ${segments}: the arrays themselves fill by at most the budget a step`, () => {
      const part: LathePart = { role: "shaft", segments, prof: canonProfile(Array.from({ length: np }, (_, i) => ({ x: 1 + (i % 3), y: i + 1 }))) };
      const c = drawCounter(), m: HeldMeter = { bytes: 0, peak: 0, arrays: [] };
      const job = latheColumnsSteps(part, c);
      // how far the positions' z and the index are written (both are never 0 there but the index's first entry)
      let vertices = 0, entries = 0, mostV = 0, mostI = 0;
      for (;;) {
        const r = withHeldMeter(m, () => job.next());
        const [, pos, , idx] = m.arrays as [Float64Array, Float32Array | undefined, Float32Array | undefined, Uint32Array | undefined];
        let v = vertices, e = entries;
        if (pos) while (v < pos.length / 3 && pos[3 * v + 2] !== 0) v++;
        if (idx) while (e < idx.length && (e === 0 ? v === pos!.length / 3 && idx[1] !== 0 : idx[e] !== 0)) e++;
        mostV = Math.max(mostV, v - vertices);
        mostI = Math.max(mostI, e - entries);
        vertices = v;
        entries = e;
        if (r.done) break;
      }
      const size = latheSize(np, segments);
      expect([vertices, entries]).toEqual([size.v, size.i]);
      expect([mostV <= DRAW_BUDGET, mostI <= DRAW_BUDGET, c.max <= DRAW_BUDGET]).toEqual([true, true, true]);
      expect(Math.max(mostV, mostI)).toBeGreaterThan(Math.min(size.v, DRAW_BUDGET) / 2);      // the guard sees the work
      expect(c.total).toBe(4 * np + size.v + size.i);
    });
});
