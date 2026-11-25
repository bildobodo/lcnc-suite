import { encode, decode } from "@msgpack/msgpack";
import { readFileSync } from "node:fs";
import { CASES } from "./cases";
import { canonMeshSteps, bodySteps, drawingSteps, latheSector, counter, OPTS6, type Steps, type CanonMesh, type Counter } from "./hull7";
import { runSteps } from "/tmp/r482/tree/lcnc-webui/src/viewer/steps";
const [what, name] = process.argv.slice(2) as [string, string];
const ms = (x: number) => Math.round(x * 100) / 100;
const out = (x: object) => console.log(JSON.stringify({ what, name, ...x }));
function driver(slice: number) {
  const ch = new MessageChannel(); const q: Array<() => void> = []; const tasks: number[] = [];
  ch.port1.onmessage = () => { const f = q.shift(); if (!f) return; const t = performance.now(); f(); tasks.push(performance.now() - t); };
  return { run: <T>(g: Steps<T>) => runSteps(g, { sliceMs: slice, schedule: f => { q.push(f); ch.port2.postMessage(0); } }).promise, tasks, close: () => ch.port1.close() };
}
/** the drawn soup from the canonical arrays, in parts of at most PART triangles (one mesh each) */
export function* soupSteps(m: CanonMesh, part: number, budget: number, c: Counter): Steps<Array<{ positions: Float32Array; normals: Float32Array }>> {
  const n = m.idx.length / 3, parts: Array<{ positions: Float32Array; normals: Float32Array }> = [], p = m.pos, ix = m.idx;
  for (let s = 0; s < n; s += part) {
    const k = Math.min(part, n - s), positions = new Float32Array(k * 9); yield; const normals = new Float32Array(k * 9); yield;
    for (let t = 0; t < k; t++) {
      const a = 3 * ix[3 * (s + t)]!, b = 3 * ix[3 * (s + t) + 1]!, d = 3 * ix[3 * (s + t) + 2]!, o = 9 * t;
      const ax = p[a]!, ay = p[a + 1]!, az = p[a + 2]!, bx = p[b]!, by = p[b + 1]!, bz = p[b + 2]!, cx = p[d]!, cy = p[d + 1]!, cz = p[d + 2]!;
      positions[o] = ax; positions[o + 1] = ay; positions[o + 2] = az; positions[o + 3] = bx; positions[o + 4] = by; positions[o + 5] = bz; positions[o + 6] = cx; positions[o + 7] = cy; positions[o + 8] = cz;
      const ux = cx - bx, uy = cy - by, uz = cz - bz, vx = ax - bx, vy = ay - by, vz = az - bz;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
      for (let j = 0; j < 9; j += 3) { normals[o + j] = nx; normals[o + j + 1] = ny; normals[o + j + 2] = nz; }
      if ((c.n += 24) >= budget) { c.total += c.n; c.n = 0; c.steps++; yield; }
    }
    parts.push({ positions, normals });
  }
  return parts;
}
import * as THREE from "three";
/** the canonical lathe in angular sectors (latheSector: the exact quarter turn), merged */
export function* latheDraw(prof: Float32Array, segments: number): Steps<{ positions: Float32Array; normals: Float32Array; index: Uint32Array }> {
  const np = prof.length / 2, per = Math.max(1, Math.floor(Number(process.env.SECTOR ?? 1024) / np) - 1);
  const parts: THREE.BufferGeometry[] = []; let nv = 0, ni = 0;
  for (let s = 0; s < segments; s += per) { const g = latheSector(prof, s, Math.min(per, segments - s), segments); parts.push(g); nv += g.getAttribute("position").count; ni += g.index!.count; yield; }
  const positions = new Float32Array(nv * 3); yield; const normals = new Float32Array(nv * 3), index = new Uint32Array(ni); let o = 0, i = 0;
  for (const g of parts) { positions.set(g.getAttribute("position").array as Float32Array, 3 * o); normals.set(g.getAttribute("normal").array as Float32Array, 3 * o); const ix = g.index!.array; for (let j = 0; j < ix.length; j++) index[i + j] = ix[j]! + o; i += ix.length; o += g.getAttribute("position").count; g.dispose(); yield; }
  return { positions, normals, index };
}
const slice = Number(process.env.SLICE ?? 4);
if (what === "steps") {                         // canon, body, drawing of one case; per phase
  let mesh: any = CASES[name]!(); const d = driver(slice), o = OPTS6();
  const seg: any = {}; let from = 0;
  const phase = async <T>(nm: string, g: Steps<T>) => { const t0 = performance.now(); const v = await d.run(g); const ts = d.tasks.slice(from); from = d.tasks.length; seg[nm] = { sum: ms(ts.reduce((a, b) => a + b, 0)), tasks: ts.length, max: ms(Math.max(...ts)), wall: ms(performance.now() - t0) }; return v; };
  const c1 = counter(), m = await phase("canon", canonMeshSteps(mesh, o, c1)); if (process.env.RELEASE) { mesh = null; await new Promise(f => setTimeout(f, 30)); (globalThis as any).gc?.(); }
  const c2 = counter(), h = await phase("body", bodySteps({ kind: "mesh", mesh: m }, 8, 160, o, c2));
  const c3 = counter(); await phase("draw", soupSteps(m, Number(process.env.PART ?? 16384), 4096, c3));
  out({ slice, part: Number(process.env.PART ?? 16384), ...seg, ops: [c1.total + c1.n, c2.total + c2.n, c3.total + c3.n], maxOpsBetweenYields: [c1.max, c2.max], pieces: h.rho.length }); d.close();
} else if (what === "heap") {                   // nested arrays against the canonical typed ones
  (globalThis as any).gc(); const h0 = process.memoryUsage();
  const box: any = { mesh: decode(encode(CASES[name]!())) }; (globalThis as any).gc(); const h1 = process.memoryUsage();
  const canon = () => { const g = canonMeshSteps(box.mesh, OPTS6(), counter()); for (;;) { const x = g.next(); if (x.done) return x.value; } };
  const r = canon(); box.mesh = null; await new Promise(f => setTimeout(f, 50)); (globalThis as any).gc(); const h2 = process.memoryUsage();
  out({ nestedMB: ms((h1.heapUsed - h0.heapUsed) / 1e6), typedMB: ms((r.pos.byteLength + r.idx.byteLength) / 1e6), heapAfterMB: ms((h2.heapUsed - h0.heapUsed) / 1e6) });
} else if (what === "gcmark") {                 // a full GC with the nested arrays alive / with the typed ones
  const box: any = { mesh: decode(encode(CASES[name]!())) }; const full = () => { const t = performance.now(); (globalThis as any).gc(); return performance.now() - t; };
  full(); const a = [full(), full(), full()]; const canon = () => { const g = canonMeshSteps(box.mesh, OPTS6(), counter()); for (;;) { const x = g.next(); if (x.done) return x.value; } }; const r = canon(); box.mesh = null; await new Promise(f => setTimeout(f, 50)); full(); const b = [full(), full(), full()];
  out({ nestedMs: a.map(ms), typedMs: b.map(ms), keep: r.pos.length });
} else if (what === "same") {                   // the reply without the library
  const seed = JSON.parse(readFileSync("/tmp/r482/tree/examples/sim_config/xyz3/tool.seed.json", "utf8"));
  for (const [nm, n] of [["36 rows", 36], ["1000 rows", 1000]] as const) { const rows = Array.from({ length: n }, (_, i) => ({ T: i + 1, P: i + 1, Z: 50.123456, D: 6.35, remark: "end mill" })); const b = encode({ ok: true, tools: rows, library: { state: "same" }, proof: { state: "complete", proven: rows.map(r => r.T) } }); const t = performance.now(); decode(b); out({ rows: nm, ms: ms(performance.now() - t), bytes: b.length }); } void seed;
} else if (what === "lathe6") {
  const [p, sg] = name.split("x").map(Number) as [number, number], prof = new Float32Array(2 * p); for (let i = 0; i < p; i++) { prof[2 * i] = 3 + Math.sin(i / 7); prof[2 * i + 1] = 100 * i / p; }
  const d = driver(slice), g = await d.run(latheDraw(prof, sg)); out({ verts: g.positions.length / 3, tasks: d.tasks.length, sum: ms(d.tasks.reduce((a, b) => a + b, 0)), max: ms(Math.max(...d.tasks)) }); d.close();
} else if (what === "many") {
  const d = driver(slice), o = OPTS6(); const t0 = performance.now(); let n = 0;
  for (const k of ["worst200k", "long200k", "codex80k", "fine200k"]) { const mesh = CASES[k]!(); const m = await d.run(canonMeshSteps(mesh, o, counter())); await d.run(bodySteps({ kind: "mesh", mesh: m }, 8, 160, o, counter())); await d.run(soupSteps(m, 16384, 4096, counter())); n++; }
  const seed = JSON.parse(readFileSync("/tmp/r482/tree/examples/sim_config/xyz3/tool.seed.json", "utf8"));
  for (const mt of Object.values(seed) as any[]) { await d.run((function* () { const dr = yield* drawingSteps(6, 80, mt, 1, o, counter()); yield; const h = yield* bodySteps(dr, 6, 80, o, counter()); if (dr.kind === "lathe") for (const q of dr.parts) { yield; yield* latheDraw(q.prof, q.segments); } else yield* soupSteps(dr.mesh, 1e6, 4096, counter()); return h; })()); n++; }
  out({ tools: n, tasks: d.tasks.length, sum: ms(d.tasks.reduce((a, b) => a + b, 0)), max: ms(Math.max(...d.tasks)), over10: d.tasks.filter(x => x > 10).length, wall: ms(performance.now() - t0) }); d.close();
}
