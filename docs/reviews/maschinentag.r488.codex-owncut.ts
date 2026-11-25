// probe: is the rapid at path position `at` (segment seg) wholly on poses the cutter already stood on in a feed?
type T = { pos: Float32Array; abc: Float32Array; rapid: Uint8Array; count: number; band?: Uint8Array; brk?: Uint8Array; tlo?: Uint32Array; wcs?: Uint32Array; mode?: Uint8Array; frame?: Uint32Array; depEnd?: number };
const same = (a: ArrayLike<number> | undefined, i: number, j: number) => !a || a[i] === a[j];
const onAxis = (t: T, i: number) => {   // segment i: pure program Z, the orientation unchanged
  const j = i * 3, k = j - 3;
  return t.pos[j] === t.pos[k] && t.pos[j + 1] === t.pos[k + 1] && t.abc[j] === t.abc[k] && t.abc[j + 1] === t.abc[k + 1] && t.abc[j + 2] === t.abc[k + 2]
    && !t.band?.[i] && !t.brk?.[i];
};
const sameBasis = (t: T, i: number, j: number) => same(t.tlo, i, j) && same(t.wcs, i, j) && same(t.mode, i, j) && same(t.frame, i, j);
const EPS = 2e-3, CAP = 4096;
export function ownHole(t: T, dcum: Float32Array, seg: number, at: number): boolean {
  if (!onAxis(t, seg)) return false;
  const z = (i: number) => t.pos[i * 3 + 2]!;
  const L = dcum[seg]! - dcum[seg - 1]!;
  const u = L > 0 ? (at - dcum[seg - 1]!) / L : 1;
  const zAt = z(seg - 1) + (z(seg) - z(seg - 1)) * u;
  // every rapid from here to the next feed stays on the axis; its span is what must have been fed
  let lo = Math.min(zAt, z(seg)), hi = Math.max(zAt, z(seg));
  for (let i = seg + 1; i < t.count && t.rapid[i] === 1; i++) {
    if (dcum[i]! - dcum[i - 1]! <= 1e-9) continue;
    if (!onAxis(t, i) || !sameBasis(t, i, seg)) { if (z(i - 1) >= hi - 1e-6) break; return false; }   // left the axis above the entry: out
    lo = Math.min(lo, z(i));
  }
  const iv: [number, number][] = [];
  for (let i = seg - 1, n = 0; i >= Math.max(1, (t.depEnd ?? 0) + 1) && n < CAP; i--, n++) {
    if (dcum[i]! - dcum[i - 1]! <= 1e-9) { if (t.brk?.[i]) break; continue; }
    if (!onAxis(t, i) || !sameBasis(t, i, seg) || t.pos[i * 3] !== t.pos[seg * 3] || t.pos[i * 3 + 1] !== t.pos[seg * 3 + 1]) break;
    if (t.rapid[i] !== 1) iv.push([Math.min(z(i), z(i - 1)), Math.max(z(i), z(i - 1))]);
  }
  iv.sort((a, b) => a[0] - b[0]);
  let cur = lo;
  for (const [a, b] of iv) { if (a > cur + EPS) break; if (b > cur) cur = b; if (cur >= hi - EPS) return true; }
  return cur >= hi - EPS;
}
/** RT: any direction — every pose of the rapid from `at` to the next feed lies on an earlier feed of the same basis (brute force). */
export function retrace(t: T, dcum: Float32Array, seg: number, at: number): boolean {
  const P = (i: number) => [t.pos[i * 3]!, t.pos[i * 3 + 1]!, t.pos[i * 3 + 2]!] as const;
  const onFeed = (p: number[], basis: number) => {
    for (let i = basis - 1; i >= 1; i--) {
      if (t.rapid[i] === 1 || t.brk?.[i] || t.band?.[i] || !sameBasis(t, i, seg)) continue;
      const a = P(i - 1), b = P(i);
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L2 = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2;
      const u = L2 > 0 ? Math.min(1, Math.max(0, ((p[0]! - a[0]) * d[0]! + (p[1]! - a[1]) * d[1]! + (p[2]! - a[2]) * d[2]!) / L2)) : 0;
      if ((a[0] + d[0]! * u - p[0]!) ** 2 + (a[1] + d[1]! * u - p[1]!) ** 2 + (a[2] + d[2]! * u - p[2]!) ** 2 <= EPS * EPS) return true;
    }
    return false;
  };
  for (let i = seg; i < t.count && t.rapid[i] === 1; i++) {
    const a = P(i - 1), b = P(i), L = dcum[i]! - dcum[i - 1]!;
    if (L <= 1e-9) continue;
    if (i > seg && onAxis(t, i) && b[2] > a[2]) break;   // a retract along the axis from a covered pose
    const u0 = i === seg ? (at - dcum[i - 1]!) / L : 0, n = Math.max(1, Math.ceil((1 - u0) * L / 0.5));
    for (let k = 0; k <= n; k++) { const u = u0 + (1 - u0) * k / n; if (!onFeed([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u], seg)) return false; }
  }
  return true;
}
/** Own hole along the TOOL AXIS (any orientation): the rapid and the run of segments just before it lie on one straight
 *  line of the program at one orientation and basis; `axisOk(seg)` says that line is the tool's axis in the stock's frame. */
export function ownHoleAxis(t: T, dcum: Float32Array, seg: number, at: number, axisOk: (seg: number) => boolean, lat = 2e-3, top = 2e-3, gap = 1e-4): boolean {
  const j = seg * 3, k = j - 3, P0 = [t.pos[k]!, t.pos[k + 1]!, t.pos[k + 2]!];
  const d = [t.pos[j]! - P0[0]!, t.pos[j + 1]! - P0[1]!, t.pos[j + 2]! - P0[2]!], len = Math.hypot(d[0]!, d[1]!, d[2]!);
  const still = (i: number) => { const a = i * 3, b = a - 3; return t.abc[a] === t.abc[b] && t.abc[a + 1] === t.abc[b + 1] && t.abc[a + 2] === t.abc[b + 2] && !t.band?.[i] && !t.brk?.[i]; };
  if (!(len > 1e-9) || !still(seg)) return false;
  d[0] /= len; d[1] /= len; d[2] /= len;
  let u = NaN;
  const onLine = (i: number) => { const x = t.pos[i * 3]! - P0[0]!, y = t.pos[i * 3 + 1]! - P0[1]!, z = t.pos[i * 3 + 2]! - P0[2]!; u = x * d[0]! + y * d[1]! + z * d[2]!; return Math.hypot(x - u * d[0]!, y - u * d[1]!, z - u * d[2]!) <= lat; };
  const L = dcum[seg]! - dcum[seg - 1]!;
  const uAt = len * (L > 0 ? (at - dcum[seg - 1]!) / L : 1);
  let hi = Math.max(uAt, len); const lo = uAt;
  for (let i = seg + 1, n = 0; i < t.count && t.rapid[i] === 1; i++) {
    if (++n > CAP) return false;
    if (dcum[i]! - dcum[i - 1]! <= 1e-9) continue;
    if (!still(i) || !sameBasis(t, i, seg) || !onLine(i)) { onLine(i - 1); if (u <= lo + 1e-6) break; return false; }
    if (u > hi) hi = u;
  }
  const iv: [number, number][] = [];
  for (let i = seg - 1, n = 0; i >= Math.max(1, (t.depEnd ?? 0) + 1); i--) {
    if (++n > CAP) break;
    if (t.brk?.[i]) break;
    if (dcum[i]! - dcum[i - 1]! <= 1e-9) continue;
    if (!still(i) || !sameBasis(t, i, seg) || !onLine(i)) break;
    const a = u; if (!onLine(i - 1)) break; const b = u;
    if (t.rapid[i] !== 1) iv.push([Math.min(a, b), Math.max(a, b)]);
  }
  iv.sort((a, b) => a[0] - b[0]);
  let cur = lo - 0, ok = false, started = false;
  for (const [a, b] of iv) { if (a > cur + (started ? gap : top)) break; started = true; if (b > cur) cur = b; if (cur >= hi - gap) { ok = true; break; } }
  return ok && axisOk(seg);
}
