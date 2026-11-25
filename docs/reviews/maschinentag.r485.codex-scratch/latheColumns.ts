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
