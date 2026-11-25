// v2 (Codex R484 MT484-02): own hole by IDENTICAL poses only — one program coordinate moves, every other one bit-equal, exact
// comparisons, no tolerance. Allocation-free, at most CAP segments back and CAP forward. `fs` counts the work.
export interface FedTrack { pos: Float32Array; abc: Float32Array; rapid: Uint8Array; count: number; band?: Uint8Array; brk?: Uint8Array; ustart?: Uint8Array;
  unpredicted?: Uint8Array; tlo?: Uint32Array; wcs?: Uint32Array; mode?: Uint8Array; frame?: Uint32Array; cond?: Uint8Array; depEnd?: number }
export const CAP: number = Number((globalThis as any).process?.env?.CAP ?? 4096);
export const fs = { asks: 0, steps: 0, maxSteps: 0 };
const eq = (a: ArrayLike<number> | undefined, i: number, j: number) => !a || a[i] === a[j];
/** May the segment ENDING at i be read as motion of segment `s`'s basis? Asked for every segment, zero-length ones too. */
const usable = (t: FedTrack, i: number, s: number) => !t.brk?.[i] && !t.ustart?.[i] && !t.band?.[i] && !t.unpredicted?.[i]
  && eq(t.tlo, i, s) && eq(t.wcs, i, s) && eq(t.mode, i, s) && eq(t.frame, i, s) && eq(t.cond, i, s);
/** `u` = where on segment `seg` (0..1, the sweep's own interpolation) the pose is that lies OUTSIDE the entry. */
export function fedOver(t: FedTrack, seg: number, u: number): boolean {
  fs.asks++;
  const j = seg * 3, k = j - 3, p = t.pos, r = t.abc;
  if (!usable(t, seg, seg)) return false;
  if (r[j] !== r[k] || r[j + 1] !== r[k + 1] || r[j + 2] !== r[k + 2]) return false;
  const mx = p[j] !== p[k], my = p[j + 1] !== p[k + 1], mz = p[j + 2] !== p[k + 2];
  if ((mx ? 1 : 0) + (my ? 1 : 0) + (mz ? 1 : 0) !== 1) return false;   // exactly one coordinate moves
  const ax = mx ? 0 : my ? 1 : 2, o1 = (ax + 1) % 3, o2 = (ax + 2) % 3;
  const c1 = p[j + o1]!, c2 = p[j + o2]!, a0 = r[j]!, b0 = r[j + 1]!, d0 = r[j + 2]!;
  const dir = p[j + ax]! > p[k + ax]! ? 1 : -1;
  const on = (i: number) => { const q = i * 3; return p[q + o1] === c1 && p[q + o2] === c2 && r[q] === a0 && r[q + 1] === b0 && r[q + 2] === d0; };
  const w = (i: number) => dir * p[i * 3 + ax]!;                       // inward = increasing
  const A0 = dir * (p[k + ax]! + (p[j + ax]! - p[k + ax]!) * u);
  let A1 = w(seg), n = 0;
  for (let i = seg + 1; i < t.count && t.rapid[i] === 1; i++) {
    if (++n > CAP) { fs.steps += n; if (n > fs.maxSteps) fs.maxSteps = n; return false; }
    if (!usable(t, i, seg) || !on(i)) { if (w(i - 1) <= A0) break; fs.steps += n; return false; }   // leaves the line: at or outside the entry only
    if (w(i) > A1) A1 = w(i);
  }
  let low = NaN, m = 0, ok = false;                                     // the fed union around A1 reaches out to `low`
  for (let i = seg - 1, first = (t.depEnd ?? 0) + 1; i >= first; i--) {
    if (++m > CAP) break;
    if (!usable(t, i, seg) || !on(i) || !on(i - 1)) break;
    if (t.rapid[i] === 1) continue;
    const x = w(i - 1), y = w(i), lo = x < y ? x : y, hi = x < y ? y : x;
    if (Number.isNaN(low)) { if (lo <= A1 && hi >= A1) low = lo; } else if (hi >= low && lo < low) low = lo;
    if (low <= A0) { ok = true; break; }
  }
  fs.steps += n + m; if (n + m > fs.maxSteps) fs.maxSteps = n + m;
  return ok;
}
