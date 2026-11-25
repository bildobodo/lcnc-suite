// The own hole (stock-mute plan v2 §3.4, Codex R484 MT484-02, R488): a rapid
// whose poses the same cutter has just been FED through, on the same basis,
// along one program axis — peck drilling's retract and re-entry. Exact
// comparisons only, no tolerance anywhere: the poses must be bit-identical to
// ones the sweep poses for an earlier feed, so the rapid cannot touch material
// the feed did not reach. Any doubt refuses (the rapid's touch is then a
// finding). Allocation-free; at most FED_CAP segments back and FED_CAP forward.
//
// What it does NOT decide: that the axis is the TOOL's (the sweep checks that
// on its two poses), that the entry's free side is APART (the sweep's own
// state), anything about material really removed on the machine.

/** The track channels the question reads — each compared at every segment it
 *  reads (an absent channel is one basis for the whole track). */
export interface FedTrack {
  pos: Float32Array; abc: Float32Array; rapid: Uint8Array; count: number;
  band?: Uint8Array; brk?: Uint8Array; ustart?: Uint8Array; unpredicted?: Uint8Array; cond?: Uint8Array;
  tlo?: Uint32Array; wcs?: Uint32Array; mode?: Uint8Array; frame?: Uint32Array; depEnd?: number;
}
/** The channels FedTrack reads besides the poses — the worker's copy must carry
 *  every one (colTrackCopy.ts; fedPath.test.ts holds the two together). */
export const FED_CHANNELS = ["band", "brk", "ustart", "unpredicted", "cond", "tlo", "wcs", "mode", "frame", "depEnd"] as const;

/** Segments read back and forward at the most; past that: not excused. */
export const FED_CAP = 1024;

/** What one sweep's questions cost: the sweep's checkpoint counts `asks`. */
export interface FedWork { asks: number; steps: number }

const eq = (a: ArrayLike<number> | undefined, i: number, j: number) => !a || a[i] === a[j];
/** May the segment ENDING at i be read as motion of segment `s`'s basis?
 *  Asked for every segment, zero-length ones too, before any length. */
const usable = (t: FedTrack, i: number, s: number) => !t.brk?.[i] && !t.ustart?.[i] && !t.band?.[i] && !t.unpredicted?.[i]
  && eq(t.tlo, i, s) && eq(t.wcs, i, s) && eq(t.mode, i, s) && eq(t.frame, i, s) && eq(t.cond, i, s);

/** Is the rapid segment `seg`, from the pose at `u` (0..1 of it: the entry's
 *  proven free side) on, the own hole? True only when
 *   1. the rapid moves exactly ONE program coordinate, the other two and A, B,
 *      C bit-equal — and so does every point of the rapid run that follows;
 *   2. every segment read has the rapid's basis (tool and offset, fixture,
 *      kinematics, frame, the condition after a measurement), no relabel, no
 *      unknown start, no braking range, no unpredicted point, after `depEnd`;
 *   3. the feeds of the run before it, merged outward from the deepest pose
 *      the rapid run reaches, cover that pose and everything up to the free
 *      side (an interval that does not meet the union when read: dropped);
 *   4. a following rapid that leaves the line does so at or outside the free
 *      side. */
export function fedOver(t: FedTrack, seg: number, u: number, work: FedWork): boolean {
  work.asks++;
  const j = seg * 3, k = j - 3, p = t.pos, r = t.abc;
  if (t.rapid[seg] !== 1 || !usable(t, seg, seg)) return false;
  if (r[j] !== r[k] || r[j + 1] !== r[k + 1] || r[j + 2] !== r[k + 2]) return false;
  const mx = p[j] !== p[k], my = p[j + 1] !== p[k + 1], mz = p[j + 2] !== p[k + 2];
  if ((mx ? 1 : 0) + (my ? 1 : 0) + (mz ? 1 : 0) !== 1) return false;   // exactly one coordinate moves
  const ax = mx ? 0 : my ? 1 : 2, o1 = (ax + 1) % 3, o2 = (ax + 2) % 3;
  const c1 = p[j + o1]!, c2 = p[j + o2]!, a0 = r[j]!, b0 = r[j + 1]!, d0 = r[j + 2]!;
  const dir = p[j + ax]! > p[k + ax]! ? 1 : -1;
  const on = (i: number) => { const q = i * 3; return p[q + o1] === c1 && p[q + o2] === c2 && r[q] === a0 && r[q + 1] === b0 && r[q + 2] === d0; };
  const w = (i: number) => dir * p[i * 3 + ax]!;                       // inward = increasing
  const A0 = dir * (p[k + ax]! + (p[j + ax]! - p[k + ax]!) * u);      // the free side
  let A1 = w(seg), n = 0;
  for (let i = seg + 1; i < t.count && t.rapid[i] === 1; i++) {
    if (++n > FED_CAP) { work.steps += n; return false; }
    if (!usable(t, i, seg) || !on(i)) { if (w(i - 1) <= A0) break; work.steps += n; return false; }   // leaves the line: at or outside the free side only
    if (w(i) > A1) A1 = w(i);
  }
  let low = NaN, m = 0, ok = false;                                     // the fed union around A1 reaches out to `low`
  for (let i = seg - 1, first = (t.depEnd ?? 0) + 1; i >= first; i--) {
    if (++m > FED_CAP) break;
    if (!usable(t, i, seg) || !on(i) || !on(i - 1)) break;
    if (t.rapid[i] === 1) continue;
    const x = w(i - 1), y = w(i), lo = x < y ? x : y, hi = x < y ? y : x;
    if (Number.isNaN(low)) { if (lo <= A1 && hi >= A1) low = lo; } else if (hi >= low && lo < low) low = lo;
    if (low <= A0) { ok = true; break; }
  }
  work.steps += n + m;
  return ok;
}
