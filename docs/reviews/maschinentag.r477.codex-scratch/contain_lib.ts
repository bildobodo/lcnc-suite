// P6-c5 scratch: the v5 body after transfer + reconstruction, held by an
// INDEPENDENT check (edge × plane crossings against the rebuilt mesh's own
// side planes; no function of hull5's is used for the judgement).
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { buildToolGeometries, buildToolParts, buildToolProfile, type ToolMeta } from "/home/cnc/lcnc-suite-p6c/lcnc-webui/src/toolGeometry";
import { buildCollisionModel, geometryNote, toolCylinderPositions, type CollisionMachine } from "/home/cnc/lcnc-suite-p6c/lcnc-webui/src/viewer/collision";
import { meshClosure } from "/home/cnc/lcnc-suite-p6c/lcnc-webui/src/viewer/insideCheck";
import { meshHullSteps, profileHullSteps, hullPositions, counter, OPTS, runAll, setMut, type HullNumbers } from "./hull5";
import { closedHull, drawnSoup } from "./hullv2";
import { cylinder } from "./cases";

export const visLenOf = (L: number, u: number) => Math.max(40 * u, (L || 60 * u) + 20 * u);
export interface Case { name: string; D: number; L: number; meta: ToolMeta | null }
const boxTris = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
  const v = (i: number) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0] as [number, number, number];
  const verts: any[] = [], tris: any[] = [];
  for (const q of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) { const b = verts.length; q.forEach(i => verts.push(v(i))); tris.push([b, b + 1, b + 2], [b, b + 2, b + 3]); }
  return { verts, tris };
};
const meshOf = (...parts: any[]) => { const vertices: any[] = [], triangles: any[] = []; for (const p of parts) { const o = vertices.length; vertices.push(...p.verts); triangles.push(...p.tris.map((t: number[]) => t.map(i => i + o))); } return { vertices, triangles }; };
export function cases(): Case[] {
  const T13: any = { type: "tapered", fusion_type: "tapered mill", taper_angle: 3.7, corner_radius: 1, flute_length: 47, shoulder_length: 50, shoulder_diameter: 5.8, shaft_diameter: 8, oal: 100 };
  const out: Case[] = [
    { name: "T13 D1.875", D: 1.875, L: 63.19, meta: T13 }, { name: "T13 D8", D: 8, L: 63.19, meta: T13 },
    { name: "em6 on 6", D: 6, L: 50, meta: { type: "endmill", flute_length: 20, shaft_diameter: 6, oal: 60 } },
    { name: "em3 on 6", D: 3, L: 40, meta: { type: "endmill", flute_length: 10, shaft_diameter: 6, oal: 50 } },
    { name: "em6 OAL 120", D: 6, L: 50, meta: { type: "endmill", flute_length: 20, shaft_diameter: 6, oal: 120 } },
    { name: "mesh lug", D: 6, L: 40, meta: { type: "formmill", native_mesh: meshOf(boxTris(-3, 3, -3, 3, 0, 50), boxTris(9, 12, -1, 1, 10, 15)), oal: 50 } as any },
    { name: "mesh below tip", D: 6, L: 40, meta: { type: "formmill", native_mesh: meshOf(boxTris(-3, 3, -3, 3, -4, 50)), oal: 54 } as any },
    { name: "formmill y<0", D: 8, L: 40, meta: { type: "formmill", oal: 53, profile: [{ end: [0, -3] }, { end: [4, -3] }, { end: [4, 10] }, { end: [3, 10] }, { end: [3, 50] }, { end: [0, 50] }] } as any },
    { name: "long facet", D: 2, L: 0, meta: { type: "formmill", native_mesh: { vertices: [[4, 0, 0], [4, 0, 20], [0, 4, 20]], triangles: [[0, 1, 2]] }, oal: 20 } as any },
    { name: "two long facets below the tip + lug", D: 2, L: 0, meta: { type: "formmill", native_mesh: { vertices: [[4, 0, -4], [4, 0, 160], [0, 4, 160], [12, 0, 30], [12, 0, 100], [4, 3, 60]], triangles: [[0, 1, 2], [3, 4, 5]] }, oal: 160 } as any },
    { name: "codex cylinder n=2000", D: 2, L: 140, meta: { type: "formmill", native_mesh: cylinder(2000), oal: 160 } as any },
    { name: "no meta", D: 6, L: 50, meta: null },
    { name: "tiny em 0.1 on 3", D: 0.1, L: 25, meta: { type: "endmill", flute_length: 1, shaft_diameter: 3, oal: 38 } },
    { name: "tiny em 0.2 on 0.2", D: 0.2, L: 25, meta: { type: "endmill", flute_length: 1, shaft_diameter: 0.2, oal: 38 } },
    { name: "long drill OAL 300", D: 10, L: 250, meta: { type: "drill", point_angle: 118, flute_length: 200, shaft_diameter: 10, oal: 300 } },
  ];
  const seed = JSON.parse(readFileSync("/home/cnc/lcnc-suite-p6c/examples/sim_config/xyz3/tool.seed.json", "utf8"));
  const rows = new Map<number, { D: number; Z: number }>();
  for (const ln of readFileSync("/home/cnc/lcnc-suite-p6c/examples/sim_config/xyz3/tool.tbl", "utf8").split("\n")) {
    const f = ln.split(";")[0]!.trim().split(/\s+/); const g = (c: string) => { const t = f.find(x => x[0]?.toUpperCase() === c); return t ? Number(t.slice(1)) : NaN; };
    if (f[0]?.[0] === "T") rows.set(g("T"), { D: g("D"), Z: g("Z") });
  }
  for (const [T, m] of Object.entries(seed) as any[]) { const r = rows.get(+T); if (r) out.push({ name: `seed T${T} ${m.type}${m.native_mesh ? " mesh" : m.native_profile ? " profile" : ""}`, D: r.D, L: Math.abs(r.Z), meta: m }); }
  return out;
}
const LEN_KEYS = ["oal", "flute_length", "shoulder_length", "shoulder_diameter", "body_length", "shaft_diameter", "tip_diameter", "tip_length", "corner_radius", "maximum_cutting_diameter", "upper_radius", "chamfer_width", "lower_radius", "profile_radius", "axial_distance", "thread_pitch", "thread_pitch_min", "thread_pitch_max", "thread_tip_width", "thread_tip_radius"];
export function scaled(c: Case, u: number): Case {
  if (u === 1) return c;
  const m: any = c.meta ? structuredClone(c.meta) : null;
  if (m) {
    for (const k of LEN_KEYS) if (typeof m[k] === "number") m[k] *= u;
    if (m.shaft_segments) m.shaft_segments = m.shaft_segments.map((s: any) => ({ height: s.height * u, lower_diameter: s.lower_diameter * u, upper_diameter: s.upper_diameter * u }));
    if (m.profile) m.profile = m.profile.map((s: any) => ({ ...s, end: s.end.map((x: number) => x * u), ...(s.center ? { center: s.center.map((x: number) => x * u) } : {}) }));
    if (m.native_profile) m.native_profile = m.native_profile.map((p: number[]) => p.map(x => x * u));
    if (m.native_mesh) m.native_mesh = { vertices: m.native_mesh.vertices.map((v: number[]) => v.map(x => x * u)), triangles: m.native_mesh.triangles };
  }
  return { name: c.name, D: c.D * u, L: c.L * u, meta: m };
}
/** the ONE dispatch: what is drawn, as the hull's input */
export function hullOf(c: Case, u: number): HullNumbers {
  const vl = visLenOf(c.L, u), o = OPTS(u), cnt = counter();
  if (c.meta?.native_mesh) return runAll(meshHullSteps(c.meta.native_mesh as any, c.D, vl, o, cnt));
  if (c.meta?.native_profile?.length) return runAll(profileHullSteps([buildToolProfile(c.D, vl, c.meta, u).pts], c.D, vl, o, cnt));
  const p = buildToolParts(c.D, vl, c.meta, u);
  return runAll(profileHullSteps([p.cutter, p.shaft].filter(x => x.length >= 3), c.D, vl, o, cnt));
}
/** what buildToolGeometries draws, as f32 triangles */
export function soupOf(c: Case, u: number): Float32Array {
  const { cutter, shaft } = buildToolGeometries(c.D, visLenOf(c.L, u), c.meta, u); const parts: Float32Array[] = [];
  for (const g of [cutter, shaft]) if (g) parts.push(new Float32Array((g.index ? g.toNonIndexed() : g).getAttribute("position").array as Float32Array));
  const all = new Float32Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; } return all;
}
// ---- the judgement ----
/** Every slab of the REBUILT mesh from its own facets: z levels + side planes. */
export function slabsOf(pos: Float32Array) {
  const zs = [...new Set(Array.from(pos).filter((_, i) => i % 3 === 2))].sort((a, b) => a - b);
  const slabs = zs.slice(0, -1).map((a, i) => ({ a, b: zs[i + 1]!, planes: [] as Array<[number, number, number]> }));
  for (let t = 0; t < pos.length; t += 9) {
    const z = [pos[t + 2]!, pos[t + 5]!, pos[t + 8]!], lo = Math.min(...z), hi = Math.max(...z);
    if (lo === hi) continue;
    const A = [pos[t]!, pos[t + 1]!, z[0]!], B = [pos[t + 3]!, pos[t + 4]!, z[1]!], C = [pos[t + 6]!, pos[t + 7]!, z[2]!];
    const u = [B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!], v = [C[0]! - A[0]!, C[1]! - A[1]!, C[2]! - A[2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!];
    const l = Math.hypot(n[0]!, n[1]!); if (l === 0) continue;
    const nx = n[0]! / l, ny = n[1]! / l, d = nx * A[0]! + ny * A[1]!;
    for (const s of slabs) if (s.a >= lo && s.b <= hi) s.planes.push([nx, ny, d]);
  }
  return { zs, slabs };
}
/** Violations: points of a triangle's part in an (open) slab outside that slab's planes. */
export function violations(soup: Float32Array, pos: Float32Array) {
  const { zs, slabs } = slabsOf(pos); let bad = 0, worst = 0; let first = "";
  const z0 = zs[0]!, z1 = zs[zs.length - 1]!;
  for (let t = 0; t < soup.length; t += 9) {
    const P = [0, 3, 6].map(o => [soup[t + o]!, soup[t + o + 1]!, soup[t + o + 2]!]);
    const lo = Math.min(P[0]![2]!, P[1]![2]!, P[2]![2]!), hi = Math.max(P[0]![2]!, P[1]![2]!, P[2]![2]!);
    if (lo < z0 || hi > z1) { bad++; worst = Math.max(worst, z0 - lo, hi - z1); first ||= `cap ${lo}..${hi} of ${z0}..${z1}`; }
    for (const s of slabs) {
      const flat = lo === hi;
      if (flat ? (lo < s.a || lo > s.b) : (hi <= s.a || lo >= s.b)) continue;
      const pts: number[][] = P.filter(p => p[2]! >= s.a && p[2]! <= s.b);
      for (let e = 0; e < 3; e++) for (const zc of [s.a, s.b]) {
        const p = P[e]!, q = P[(e + 1) % 3]!; if (p[2]! === q[2]!) continue;
        const u = (zc - p[2]!) / (q[2]! - p[2]!); if (u < 0 || u > 1) continue;
        pts.push([p[0]! + u * (q[0]! - p[0]!), p[1]! + u * (q[1]! - p[1]!), zc]);
      }
      let out = 0;
      for (const p of pts) for (const [nx, ny, d] of s.planes) out = Math.max(out, nx * p[0]! + ny * p[1]! - d);
      if (flat && out > 0) {   // a flat facet ON a level needs only one of the two slabs
        const other = slabs.find(x => x !== s && lo >= x.a && lo <= x.b);
        if (other) { let o2 = 0; for (const p of P) for (const [nx, ny, d] of other.planes) o2 = Math.max(o2, nx * p[0]! + ny * p[1]! - d); out = Math.min(out, o2); }
      }
      if (out > 0) { bad++; if (out > worst) { worst = out; first ||= `slab ${s.a.toFixed(3)}..${s.b.toFixed(3)} by ${out}`; } }
    }
  }
  return { bad, worst, first };
}
