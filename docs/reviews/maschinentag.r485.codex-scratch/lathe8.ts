// P6-c8 scratch: the lathe drawn column by column into its preallocated arrays
// (no sector geometry, no UVs), the exact quarter turn in the write; measured.
import * as THREE from "three";
import { latheSector, quarterTurn, drawingSteps, canonProfile, runAll, counter, OPTS6, type Steps } from "./hull7";
import { cases, scaled, visLenOf } from "./contain_lib";
let held = 0, peak = 0; const alloc = <A extends ArrayBufferView>(a: A): A => { held += a.byteLength; peak = Math.max(peak, held); return a; };
export interface Drawn { positions: Float32Array; normals: Float32Array; index: Uint16Array | Uint32Array }
/** vertices and index entries of one lathe part — known before it is built */
export const latheSize = (points: number, segments: number) => ({ v: (segments + 1) * points, i: 6 * segments * (points - 1) });
export function* latheColumns(prof: Float32Array, segments: number, perStep = 4096): Steps<Drawn> {
  const np = prof.length / 2, { v, i } = latheSize(np, segments);
  // three's meridian normals (LatheGeometry 0.182, the last one not normalised)
  const mn = alloc(new Float64Array(2 * np)); let px = 0, py = 0;
  for (let j = 0; j < np; j++) {
    if (j === np - 1) { mn[2 * j] = px; mn[2 * j + 1] = py; break; }
    const dx = prof[2 * j + 2]! - prof[2 * j]!, dy = prof[2 * j + 3]! - prof[2 * j + 1]!; let x = dy * 1.0, y = -dx; const cx = x, cy = y;
    if (j > 0) { x += px; y += py; }
    const l = 1 / (Math.sqrt(x * x + y * y + 0) || 1); mn[2 * j] = x * l; mn[2 * j + 1] = y * l; px = cx; py = cy;
  }
  const positions = alloc(new Float32Array(3 * v)); yield;
  const normals = alloc(new Float32Array(3 * v)); yield;
  const index = alloc(v > 65535 ? new Uint32Array(i) : new Uint16Array(i)); yield;
  const inv = 1.0 / segments; let n = 0;
  for (let s = 0, o = 0; s <= segments; s++) {
    const phi = 0 + s * inv * (Math.PI * 2), sin = Math.sin(phi), cos = Math.cos(phi);
    for (let j = 0; j < np; j++, o += 3) {
      const r = prof[2 * j]!; positions[o] = r * sin; positions[o + 1] = -(r * cos); positions[o + 2] = prof[2 * j + 1]!;
      const nx = mn[2 * j]!; normals[o] = nx * sin; normals[o + 1] = -(nx * cos); normals[o + 2] = mn[2 * j + 1]!;
    }
    if ((n += np) >= perStep) { n = 0; yield; }
  }
  for (let s = 0, k = 0; s < segments; s++) { for (let j = 0; j < np - 1; j++) { const a = j + s * np, b = a + np, c = b + 1, d = a + 1; index[k++] = a; index[k++] = b; index[k++] = d; index[k++] = c; index[k++] = d; index[k++] = b; } if ((n += np) >= perStep) { n = 0; yield; } }
  return { positions, normals, index };
}
const bytesOf = (g: THREE.BufferGeometry) => [...new Set([...Object.values(g.attributes).map((a: any) => a.array), ...(g.index ? [g.index.array] : [])].map((a: any) => a.buffer as ArrayBuffer))].reduce((s, b) => s + b.byteLength, 0);
// 1 bit-equality with three + the quarter turn, on every lathe of the 102 and Codex's
let parts = 0, pEq = 0, nEq = 0, iEq = 0, nMax = 0;
const check = (prof: Float32Array, segments: number) => {
  parts++; const a = runAll(latheColumns(prof, segments)), g = latheSector(prof, 0, segments, segments);
  const p = g.getAttribute("position").array as Float32Array, n = g.getAttribute("normal").array as Float32Array, x = g.index!.array;
  if (p.length === a.positions.length && p.every((v, k) => v === a.positions[k])) pEq++;
  let m = 0; n.forEach((v, k) => { m = Math.max(m, Math.abs(v - a.normals[k]!)); }); nMax = Math.max(nMax, m); if (m === 0) nEq++;
  if (x.length === a.index.length && x.constructor === a.index.constructor && x.every((v, k) => v === a.index[k])) iEq++;
};
for (const u of [1, 1 / 25.4]) for (const c0 of cases()) { const c = scaled(c0, u), d = runAll(drawingSteps(c.D, visLenOf(c.L, u), c.meta, u, OPTS6(u), counter())); if (d.kind === "lathe") for (const q of d.parts) check(q.prof, q.segments); }
console.log(JSON.stringify({ parts, positionsEqual: pEq, normalsEqual: nEq, normalMaxDiff: nMax, indexEqual: iEq }));
// 2 Codex's admissible lathe: the buffers, the peak while building, and the v7 builder's peak
const n = 600, seg = 512, prof = canonProfile(Array.from({ length: n }, (_, i) => ({ x: i === 0 || i === n - 1 ? 0 : 1000, y: i })));
held = peak = 0; const job = latheColumns(prof, seg); let y = 0, out: Drawn; for (;;) { const r = job.next(); if (r.done) { out = r.value; break; } y++; }
const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(out.positions, 3)); g.setAttribute("normal", new THREE.BufferAttribute(out.normals, 3)); g.setIndex(new THREE.BufferAttribute(out.index, 1));
const V = out.positions.length / 3, I = out.index.length;
console.log(JSON.stringify({ V, I, bytes: bytesOf(g), formula: 24 * V + out.index.BYTES_PER_ELEMENT * I, sharedWithWriter: g.getAttribute("position").array === out.positions, peakHeldByBuilder: peak, yields: y, uv: !!g.getAttribute("uv"), over14_4MB: bytesOf(g) - 14_400_000 }));
// v7's sector builder: all sector geometries AND the targets alive together
let sect = 0; for (let s = 0, per = Math.max(1, Math.floor(4096 / n) - 1); s < seg; s += per) sect += bytesOf(latheSector(prof, s, Math.min(per, seg - s), seg));
console.log(JSON.stringify({ v7SectorBuffers: sect, v7Targets: 16216512, v7PeakTyped: sect + 16216512 }));
// 3 the bound: the most vertices 400 000 allows, several parts
const top = [[780, 512], [400_000 / 25 | 0, 24], [200, 1000]].map(([np, s]) => { const z = latheSize(np!, s!); return { np, seg: s, ...z, bytes: 24 * z.v + 4 * z.i, ratio: +(z.i / z.v).toFixed(3) }; });
console.log(JSON.stringify(top), 48 * 400_000);
// 4 does dispose free a CPU array? (what three does)
const before = g.getAttribute("position").array.length; g.dispose(); console.log(JSON.stringify({ afterDisposeStillHeld: g.getAttribute("position").array.length === before }));
