// Program-scrub track (offline dry run, stage 2).
//
// The wire ships feed and rapid as SEPARATE polylines (they render as two
// materials), which loses the execution-order interleaving between them. The
// parse worker therefore stamps every point with a global sequence number
// (feed_seq / rapid_seq — each stream ascending); merging the two streams on
// seq reconstructs true program order, including subroutine loops that
// revisit source lines (line numbers alone can't order those).
//
// The track stores PROGRAM-space samples. The scrub pose is derived per
// frame: lerp between adjacent samples (exact for trivkins — the machine
// interpolates joints the same way), then program→machine via the same
// wcsTerms/programToMachine used by the part-frame preview, then axis
// letters → joint slots via viewer_init.axes. No baked subdivision needed —
// the kinematic chain is evaluated at pose time, not baked per vertex.
import {
  machineToProgram, programToMachine, wcsTerms,
  type PartFrameWcs, type WcsTerms,
} from "./partFrame";
import type { ScrubTrack } from "../ws/bulkData";

export type { ScrubTrack };

export interface ScrubStream {
  pos: Float32Array;        // flat [x,y,z,...] program coords
  abc?: Float32Array;       // flat [a,b,c,...] degrees (absent on pure-linear programs)
  lines?: Uint32Array;      // per-point source line
  seq?: Uint32Array;        // per-point global execution sequence
  /** Cumulative SECONDS within this stream (unified timeline phase 1).
   *  Absent on legacy payloads / INIs without MAX_VELOCITY. */
  tcum?: Float32Array;
}

// Scrub-parameter contribution of a pure rotary sweep: 1° ≙ 1 mm, the same
// equivalence the 6D RDP uses. Pure-rotary moves would otherwise be
// zero-length on the timeline and get skipped instantly.
const DEG_AS_MM = 1;

/** Merge feed + rapid into one execution-ordered track.
 *
 *  Returns null when a track can't be built honestly: no points at all, or
 *  both streams present but seq missing (a stale pre-stage-2 cached payload)
 *  — the scrub UI treats null as "unavailable", never guesses an order. */
export function buildScrubTrack(feed: ScrubStream, rapid: ScrubStream): ScrubTrack | null {
  const nf = (feed.pos.length / 3) | 0;
  const nr = (rapid.pos.length / 3) | 0;
  const n = nf + nr;
  if (n === 0) return null;
  const fseq = feed.seq, rseq = rapid.seq;
  if (nf > 0 && nr > 0 && (fseq?.length !== nf || rseq?.length !== nr)) return null;

  const pos = new Float32Array(n * 3);
  const abc = new Float32Array(n * 3);
  const lines = new Uint32Array(n);
  const rapidFlag = new Uint8Array(n);
  const cum = new Float32Array(n);

  // Time axis available iff every non-empty stream carries tcum.
  const timeBased = (nf === 0 || feed.tcum?.length === nf) && (nr === 0 || rapid.tcum?.length === nr);

  let fi = 0, ri = 0;
  let prevFT = 0, prevRT = 0;   // per-stream previous cumulative time
  for (let i = 0; i < n; i++) {
    let takeFeed: boolean;
    if (fi >= nf) takeFeed = false;
    else if (ri >= nr) takeFeed = true;
    else takeFeed = fseq![fi]! < rseq![ri]!;

    const src = takeFeed ? feed : rapid;
    const si = takeFeed ? fi++ : ri++;
    const s3 = si * 3, d3 = i * 3;
    pos[d3] = src.pos[s3]!;
    pos[d3 + 1] = src.pos[s3 + 1]!;
    pos[d3 + 2] = src.pos[s3 + 2]!;
    if (src.abc) {
      abc[d3] = src.abc[s3]!;
      abc[d3 + 1] = src.abc[s3 + 1]!;
      abc[d3 + 2] = src.abc[s3 + 2]!;
    }
    lines[i] = src.lines?.[si] ?? 0;
    rapidFlag[i] = takeFeed ? 0 : 1;
    if (timeBased) {
      // Duration of the segment ending here = this stream's cumulative
      // delta (RDP-collapsed interiors are preserved by the cumulative).
      const t = src.tcum![si]!;
      const dur = Math.max(0, t - (takeFeed ? prevFT : prevRT));
      if (takeFeed) prevFT = t; else prevRT = t;
      if (i > 0) cum[i] = cum[i - 1]! + dur;   // point 0 anchors the axis at 0
    }
  }

  if (!timeBased) {
    // Distance axis fallback (1° ≙ 1 mm) — legacy payloads / no INI velocity.
    for (let i = 1; i < n; i++) {
      const j = i * 3, k = j - 3;
      const dx = pos[j]! - pos[k]!;
      const dy = pos[j + 1]! - pos[k + 1]!;
      const dz = pos[j + 2]! - pos[k + 2]!;
      const linear = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const rot = Math.max(
        Math.abs(abc[j]! - abc[k]!),
        Math.abs(abc[j + 1]! - abc[k + 1]!),
        Math.abs(abc[j + 2]! - abc[k + 2]!),
      ) * DEG_AS_MM;
      cum[i] = cum[i - 1]! + Math.max(linear, rot);
    }
  }

  const lineCum = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const ln = lines[i]!;
    if (ln && !lineCum.has(ln)) lineCum.set(ln, cum[i]!);
  }

  return { pos, abc, lines, rapid: rapidFlag, cum, count: n, lineCum, timeBased };
}

export interface ScrubSample {
  px: number; py: number; pz: number;
  pa: number; pb: number; pc: number;
  line: number;
  rapid: boolean;
  /** Upper track index of the segment the sample falls in. */
  index: number;
}

/** Interpolated track state at scrub parameter `s` (clamped to [0, cumMax]).
 *  Fills `out` in place — the caller reuses one object per frame. */
export function sampleTrack(t: ScrubTrack, s: number, out: ScrubSample): ScrubSample {
  const n = t.count;
  const last = n - 1;
  if (s <= 0 || n === 1) {
    out.px = t.pos[0]!; out.py = t.pos[1]!; out.pz = t.pos[2]!;
    out.pa = t.abc[0]!; out.pb = t.abc[1]!; out.pc = t.abc[2]!;
    out.line = t.lines[0]!; out.rapid = t.rapid[0] === 1; out.index = 0;
    return out;
  }
  if (s >= t.cum[last]!) {
    const j = last * 3;
    out.px = t.pos[j]!; out.py = t.pos[j + 1]!; out.pz = t.pos[j + 2]!;
    out.pa = t.abc[j]!; out.pb = t.abc[j + 1]!; out.pc = t.abc[j + 2]!;
    out.line = t.lines[last]!; out.rapid = t.rapid[last] === 1; out.index = last;
    return out;
  }
  // Smallest i with cum[i] >= s (cum[0] = 0 < s here, so lo starts at 1).
  let lo = 1, hi = last;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t.cum[mid]! < s) lo = mid + 1;
    else hi = mid;
  }
  const c0 = t.cum[lo - 1]!, c1 = t.cum[lo]!;
  const u = c1 > c0 ? (s - c0) / (c1 - c0) : 1;
  const j = lo * 3, k = j - 3;
  out.px = t.pos[k]! + (t.pos[j]! - t.pos[k]!) * u;
  out.py = t.pos[k + 1]! + (t.pos[j + 1]! - t.pos[k + 1]!) * u;
  out.pz = t.pos[k + 2]! + (t.pos[j + 2]! - t.pos[k + 2]!) * u;
  out.pa = t.abc[k]! + (t.abc[j]! - t.abc[k]!) * u;
  out.pb = t.abc[k + 1]! + (t.abc[j + 1]! - t.abc[k + 1]!) * u;
  out.pc = t.abc[k + 2]! + (t.abc[j + 2]! - t.abc[k + 2]!) * u;
  out.line = t.lines[lo]!;
  out.rapid = t.rapid[lo] === 1;
  out.index = lo;
  return out;
}

/** Live machine joints → program-space [x,y,z,a,b,c] via the JOINT-ordered
 *  letter list and the inverse WCS transform. UVW/unknown joints are
 *  ignored (they don't exist in the program frame). */
export function machineJointsToProgram(
  joints: ArrayLike<number>, axes: string[], wcs: PartFrameWcs,
): [number, number, number, number, number, number] {
  const m = [0, 0, 0, 0, 0, 0];
  for (let ji = 0; ji < axes.length; ji++) {
    const slot = "XYZABC".indexOf(axes[ji]!.toUpperCase());
    if (slot >= 0) m[slot] = joints[ji] ?? 0;
  }
  const out: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  machineToProgram(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, wcsTerms(wcs), out);
  return out;
}

/** New track with the ENTRY MOVE prepended: the rapid the machine will make
 *  from its live position (program coords) to the program's first point —
 *  run-time-only motion no parse can know, and the classic crash. The entry
 *  point gets line 0 ("entry" in the UI) and a rapid flag; cum and lineCum
 *  shift by the entry length (SECONDS on a time-based track, given rapid
 *  `rates`; distance otherwise). Returns the original track unchanged when
 *  the machine already sits at the first point. */
export function prependEntry(
  t: ScrubTrack,
  entry: [number, number, number, number, number, number],
  rates?: { linear?: number | null; rotary?: number | null },
): ScrubTrack {
  const dx = t.pos[0]! - entry[0], dy = t.pos[1]! - entry[1], dz = t.pos[2]! - entry[2];
  const linear = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const rotDeg = Math.max(
    Math.abs(t.abc[0]! - entry[3]),
    Math.abs(t.abc[1]! - entry[4]),
    Math.abs(t.abc[2]! - entry[5]),
  );
  let entryLen: number;
  if (t.timeBased && rates?.linear) {
    entryLen = Math.max(linear / rates.linear, rotDeg / (rates.rotary || rates.linear));
  } else {
    entryLen = Math.max(linear, rotDeg * DEG_AS_MM);
  }
  if (entryLen < 1e-6) return t;

  const n = t.count + 1;
  const pos = new Float32Array(n * 3);
  const abc = new Float32Array(n * 3);
  const lines = new Uint32Array(n);
  const rapid = new Uint8Array(n);
  const cum = new Float32Array(n);
  pos.set(entry.slice(0, 3), 0);
  pos.set(t.pos, 3);
  abc.set(entry.slice(3, 6), 0);
  abc.set(t.abc, 3);
  lines.set(t.lines, 1);            // entry point keeps line 0 = "entry"
  rapid.set(t.rapid, 1);
  rapid[1] = 1;                     // the entry MOVE (ending at old point 0) is a rapid
  for (let i = 0; i < t.count; i++) cum[i + 1] = t.cum[i]! + entryLen;
  const lineCum = new Map<number, number>();
  for (const [ln, c] of t.lineCum) lineCum.set(ln, c + entryLen);
  return { pos, abc, lines, rapid, cum, count: n, lineCum, timeBased: t.timeBased };
}

const _machineVals: number[] = [0, 0, 0, 0, 0, 0];

/** Per-joint pose values for a track sample: program → machine via the live
 *  WCS, then machine axis slots → joints via the JOINT-ordered letter list
 *  (viewer_init.axes — on XYZAC, C is joint 4 but canonical axis 5). UVW and
 *  unknown letters yield null — the caller falls back to the live joint
 *  position rather than inventing a value. Fills `out` in place. */
export function jointsForSample(
  sample: ScrubSample, wcs: PartFrameWcs, axes: string[], out: (number | null)[],
): (number | null)[] {
  const o: WcsTerms = wcsTerms(wcs);
  programToMachine(sample.px, sample.py, sample.pz, sample.pa, sample.pb, sample.pc, o, _machineVals);
  out.length = axes.length;
  for (let ji = 0; ji < axes.length; ji++) {
    const slot = "XYZABC".indexOf(axes[ji]!.toUpperCase());
    out[ji] = slot >= 0 ? _machineVals[slot]! : null;
  }
  return out;
}
