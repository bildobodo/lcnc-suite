import * as THREE from "three";
import { cases, scaled, hullOf, soupOf, visLenOf } from "./contain_lib";
import { hullPositions, boundaries, OPTS } from "./hull5";
import { drawingSteps, drawnSoup6, bodySteps, counter, runAll, OPTS6, setMut6, setRule, boundaries6 } from "./hull6";
import { judge } from "./judge6";
import { toolCylinderPositions, withoutArealessFacets } from "/tmp/r480/tree/lcnc-webui/src/viewer/collision";
import { buildToolGeometries } from "/tmp/r480/tree/lcnc-webui/src/toolGeometry";
import { meshClosure } from "/tmp/r480/tree/lcnc-webui/src/viewer/insideCheck";
const fb = new ArrayBuffer(4), fv = new Float32Array(fb), iv = new Uint32Array(fb);
const ulpAt = (x: number) => { fv[0] = x; const a = fv[0]!; iv[0]!++; return fv[0]! - a; };
interface C { name: string; u: number; D: number; L: number; meta: any }
const OFFS = [-2, -1, -0.75, -0.6, -0.5, -0.4, -0.25, -0.1, 0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 1, 2];
/** corners placed around inner boundaries by fractions of an ulp */
export function* generated(): Generator<C> {
  for (const u of [1, 1 / 25.4]) for (const L of [60, 47.3, 63.19, 150]) {
    const D = 2 * u, vl = visLenOf(L * u, u);
    const pin = toolCylinderPositions(D, vl); let z0 = 0, z1 = 0; for (let i = 2; i < pin.length; i += 3) { z0 = Math.min(z0, pin[i]!); z1 = Math.max(z1, pin[i]!); }
    const b = boundaries6(z0, z1, OPTS6(u)), K = b.length - 1;
    for (const k of [...new Set([1, 2, K >> 1, K - 1])]) {
      const zb = b[k]!, ul = ulpAt(zb);
      for (const off of OFFS) {
        const z = zb + off * ul;                         // f64: between two f32 values
        for (const R of [10, 1.7]) for (const h of [0.01, 1.3]) {
          const ang = [Math.PI / 20, 3 * Math.PI / 20], r = R * u, hh = h * u;
          const top = ang.map(a => [r * Math.cos(a), r * Math.sin(a), z]);
          for (const [dir, apex] of [["down", zb - hh], ["up", zb + hh]] as const)
            yield { name: `mesh ${dir} L${L} k${k} off${off} R${R} h${h}`, u, D, L: L * u, meta: { type: "formmill", native_mesh: { vertices: [[0, 0, apex], ...top, [0, 0, z]], triangles: dir === "down" ? [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]] : [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]] }, oal: vl } };
          // revolved: a cone whose rim stands at the boundary
          yield { name: `profile down L${L} k${k} off${off} R${R} h${h}`, u, D, L: L * u, meta: { type: "formmill", oal: vl, native_profile: [[0, zb - hh], [r, z], [0, z]] } };
          yield { name: `profile up L${L} k${k} off${off} R${R} h${h}`, u, D, L: L * u, meta: { type: "formmill", oal: vl, native_profile: [[0, z], [r, z], [0, zb + hh]] } };
          yield { name: `formmill L${L} k${k} off${off} R${R} h${h}`, u, D, L: L * u, meta: { type: "formmill", oal: vl, profile: [{ end: [0, zb - hh] }, { end: [r, z] }, { end: [r / 2, z] }, { end: [0, zb + hh] }] } };
        }
        { const r = 9 * u; yield { name: `mesh disk L${L} k${k} off${off}`, u, D, L: L * u, meta: { type: "formmill", native_mesh: { vertices: [[0, 0, z], [r, 0, z], [0, r, z], [-r, 0, z]], triangles: [[0, 1, 2], [0, 2, 3]] }, oal: vl } }; }
        yield { name: `endmill flute L${L} k${k} off${off}`, u, D, L: L * u, meta: { type: "endmill", flute_length: z, shaft_diameter: 7 * u, oal: vl } };
        yield { name: `chamfer L${L} k${k} off${off}`, u, D: 9 * u, L: L * u, meta: { type: "chamfer", flute_length: z, taper_angle: 90, shaft_diameter: 5 * u, oal: vl } };
        // two corners on two boundaries at once
        if (k + 1 < K) { const z2 = b[k + 1]! + off * ulpAt(b[k + 1]!), r = 8 * u; yield { name: `mesh two L${L} k${k} off${off}`, u, D, L: L * u, meta: { type: "formmill", native_mesh: { vertices: [[0, 0, zb - 0.02 * u], [r * Math.cos(.3), r * Math.sin(.3), z], [r * Math.cos(.5), r * Math.sin(.5), z2], [0, 0, z2]], triangles: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]] }, oal: vl } }; }
      }
    }
    // below the tip: a boundary at (or next to) zero
    for (const zmin of [-5, -2.5, -7.31]) {
      const bb = boundaries6(Math.fround(zmin * u), z1, OPTS6(u));
      for (let k = 1; k < Math.min(4, bb.length - 1); k++) for (const off of OFFS) { const ul = ulpAt(bb[k]! || 1e-8 * u), z = bb[k]! + off * ul, r = 6 * u;
        yield { name: `mesh below L${L} zmin${zmin} k${k} off${off}`, u, D, L: L * u, meta: { type: "formmill", native_mesh: { vertices: [[0, 0, zmin * u], [r * Math.cos(.1), r * Math.sin(.1), z], [r * Math.cos(.4), r * Math.sin(.4), z], [0, 0, z]], triangles: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]] }, oal: vl } };
        yield { name: `profile below L${L} zmin${zmin} k${k} off${off}`, u, D, L: L * u, meta: { type: "formmill", oal: vl, native_profile: [[0, zmin * u], [r, z], [0, z]] } }; }
    }
  }
}
const v6 = (c: C) => {
  const vl = visLenOf(c.L, c.u), o = OPTS6(c.u), cnt = counter(), d = runAll(drawingSteps(c.D, vl, c.meta, c.u, o, cnt));
  const h = structuredClone(runAll(bodySteps(d, c.D, vl, o, cnt, c.meta?.native_mesh))), pos = hullPositions(h);
  const soup = drawnSoup6(d), j = judge(soup, pos), p = judge(toolCylinderPositions(c.D, vl), pos);
  return { bad: j.bad + p.bad, first: j.first || p.first, worst: Math.max(j.worst, p.worst), wit: j.wit, pos, soup, h, d };
};
const v5 = (c: C) => { const h = structuredClone(hullOf(c as any, c.u)), pos = hullPositions(h); const j = judge(soupOf(c as any, c.u), pos); return { bad: j.bad, first: j.first, worst: j.worst }; };
const base = (): C[] => [1, 1 / 25.4].flatMap(u => cases().map(c => ({ ...scaled(c, u), u } as C)));
const what = process.argv[2];
if (what === "control") {
  let n = 0, red = 0, open = 0, areal = 0, wit = 0, notEq = 0, meshes = 0; const names: string[] = [];
  for (const c of base()) { const r = v6(c); n++; wit += r.wit; if (r.bad) { red++; names.push(c.name + " " + r.first); } const cl = meshClosure(r.pos); if (!cl.closed) open++; areal += withoutArealessFacets(r.pos).dropped;
    if (c.meta?.native_mesh) { meshes++; const o = buildToolGeometries(c.D, visLenOf(c.L, c.u), c.meta, c.u).shaft!.getAttribute("position").array as Float32Array; if (o.length !== r.soup.length || o.some((x, i) => x !== r.soup[i])) notEq++; } }
  console.log(JSON.stringify({ inputs: n, red, names: names.slice(0, 5), open, areal, witnesses: wit, meshes, meshNotBitEqualToday: notEq }));
} else if (what === "gen") {
  for (const [nm, f] of [["v5", v5], ["v6", v6]] as const) {
    const by: Record<string, [number, number, number]> = {}; let n = 0, wit = 0; let ex = "";
    for (const c of generated()) { n++; const r: any = f(c); wit += r.wit ?? 0; const key = (c.u === 1 ? "mm " : "inch ") + c.name.split(" L")[0]; const e = by[key] ??= [0, 0, 0]; e[0]++; if (r.bad) { e[1]++; e[2] = Math.max(e[2], r.worst / c.u); ex ||= c.name + ": " + r.first; } }
    console.log(nm, "generated", n, "witnesses", wit, "red", Object.values(by).reduce((s, x) => s + x[1], 0), ex);
    for (const [k, v] of Object.entries(by)) if (v[1]) console.log("   ", k, v[1], "of", v[0], "worst mm", v[2].toExponential(2));
  }
} else if (what === "mut") {
  for (const m of ["f64Source", "zNotCanon", "verticesOnly", "oneSide", "inscribed", "noPin", "zFromZero", "snapCuts", "noInflate", "mergeNear", "upperLost", "lowerLost", "flatLost"]) {
    let rb = 0, rg = 0, n = 0, g = 0, ex = "";
    setMut6(m);
    for (const c of base()) { n++; const r = v6(c); if (r.bad) { rb++; ex ||= c.name + " " + r.first; } }
    let i = 0; for (const c of generated()) { if (i++ % 7) continue; g++; const r = v6(c); if (r.bad) { rg++; ex ||= c.name + " " + r.first; } }
    setMut6(""); console.log(JSON.stringify({ m, base: `${rb}/${n}`, generated: `${rg}/${g}`, ex: ex.slice(0, 110) }));
  }
} else if (what === "codex") {
  for (const u of [1, 1 / 25.4]) { const pin = toolCylinderPositions(2 * u, 80 * u); let m = 0; for (let i = 2; i < pin.length; i += 3) m = Math.min(m, pin[i]!); const level = boundaries(m, 80 * u, OPTS(u))[1]!, ul = ulpAt(level);
    for (const above of [0, .25, .4, .75]) { const z = level + above * ul, an = [Math.PI / 20, 3 * Math.PI / 20]; const c: C = { name: "codex", u, D: 2 * u, L: 60 * u, meta: { type: "formmill", native_mesh: { vertices: [[0, 0, level - .01 * u], ...an.map(a => [10 * u * Math.cos(a), 10 * u * Math.sin(a), z]), [0, 0, z]], triangles: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]] }, oal: 80 * u } };
      const a = v5(c), b = v6(c); console.log(u === 1 ? "mm" : "inch", "+" + above, "v5 bad", a.bad, a.worst.toExponential(3), "| v6 bad", b.bad, "witnesses", b.wit); } }
}
else if (what === "tight") {                 // the open rule against the closed one: slabs (mm of length) wider than needed
  let wider = 0, tools = 0, mm = 0, same = 0; const ex: string[] = [];
  for (const c of base().filter(c => c.u === 1)) { const vl = visLenOf(c.L, 1), o = OPTS6(1); const h = (rule: string) => { setRule(rule); const x = runAll(bodySteps(runAll(drawingSteps(c.D, vl, c.meta, 1, o, counter())), c.D, vl, o, counter())); setRule("open"); return x; };
    const a = h("open"), k = h("closed"); const rad = (q: any, z: number) => { for (let i = 0; i < q.rho.length; i++) if (z > q.z[i] && z < q.z[i + 1]) return q.rho[i]; return NaN; };
    let len = 0, dm = 0; const z1 = a.z[a.z.length - 1]!, N = 2000; for (let i = 0; i < N; i++) { const z = z1 * (i + .37) / N, d = rad(k, z) - rad(a, z); if (d > 1e-3) { len += z1 / N; dm = Math.max(dm, d); } }
    if (len > 0) { tools++; mm += len; if (ex.length < 6 || c.name.startsWith("em3") || c.name === "mesh lug") ex.push(`${c.name}: ${len.toFixed(1)} mm by up to ${dm.toFixed(2)}`); } else same++; }
  console.log(JSON.stringify({ tools, same, mm: +mm.toFixed(1), ex }));
} else if (what === "v5same") {
  let w = 0, wn = "", pieces = 0, n = 0; for (const c of base()) { const vl = visLenOf(c.L, c.u), d = runAll(drawingSteps(c.D, vl, c.meta, c.u, OPTS6(c.u), counter())), h = runAll(bodySteps(d, c.D, vl, OPTS6(c.u), counter())), g = hullOf(c as any, c.u); n++;
    const rad = (q: any, z: number) => { for (let k = 0; k < q.rho.length; k++) if (z > q.z[k] && z < q.z[k + 1]) return q.rho[k]; return NaN; };
    const N = 400, a = Math.max(h.z[0]!, g.z[0]!), e = Math.min(h.z[h.z.length - 1]!, g.z[g.z.length - 1]!); let dm = 0; for (let i = 0; i < N; i++) { const z = a + (e - a) * (i + 0.37) / N; dm = Math.max(dm, Math.abs(rad(h, z) - rad(g, z)) / c.u); }
    if (dm > w) { w = dm; wn = c.name; } if (h.rho.length !== g.rho.length) pieces++; }
  console.log(JSON.stringify({ n, maxRhoDiffMm: w, at: wn, differentPieceCount: pieces }));
} else if (what === "sectors") {
  let n = 0, red = 0, i = 0; const it = [...base()]; for (const c of generated()) if (i++ % 11 === 0) it.push(c);
  for (const c of it) { if (c.meta?.native_mesh) continue; const vl = visLenOf(c.L, c.u), o = OPTS6(c.u), cnt = counter(), d = runAll(drawingSteps(c.D, vl, c.meta, c.u, o, cnt)); const pos = hullPositions(structuredClone(runAll(bodySteps(d, c.D, vl, o, cnt)))); for (const per of [1, 5, 7]) { n++; if (judge(drawnSoup6(d, per), pos).bad) red++; } }
  console.log(JSON.stringify({ sectorBuilds: n, red }));
} else if (what === "diff") {               // canonical lathe against today's buildToolGeometries
  let n = 0, maxd = 0, moved = 0; for (const c of base()) { if (c.meta?.native_mesh) continue; const vl = visLenOf(c.L, c.u), d = runAll(drawingSteps(c.D, vl, c.meta, c.u, OPTS6(c.u), counter())), a = drawnSoup6(d), b = soupOf(c as any, c.u); n++; if (a.length !== b.length) { console.log("length", c.name, a.length, b.length); continue; } for (let i = 0; i < a.length; i++) { const x = Math.abs(a[i]! - b[i]!) / c.u; if (x > 0) moved++; maxd = Math.max(maxd, x); } }
  console.log(JSON.stringify({ lathes: n, coordsMoved: moved, maxMm: maxd }));
}
void THREE;
