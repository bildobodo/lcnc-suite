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
import { kinsFor, warnWorldWithoutSpec, type KinsSpec } from "./kins";
import {
  buildLineMap, machineToProgram, programToMachine, wcsTerms,
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
  /** Per-point world-kins flags (phase 2a wire feed_mode/rapid_mode).
   *  Absent = no mode data. */
  mode?: Uint8Array;
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
  // Kins mode available iff every non-empty stream carries it (a mixed
  // payload is treated as untracked — never guess half a program's modes).
  const hasMode = (nf === 0 || feed.mode?.length === nf)
    && (nr === 0 || rapid.mode?.length === nr)
    && !!(feed.mode || rapid.mode);
  const mode = hasMode ? new Uint8Array(n) : undefined;

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
    if (mode) mode[i] = src.mode?.[si] ?? 0;
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

  return { pos, abc, lines, rapid: rapidFlag, mode, cum, count: n, lineCum, lineSpan: buildLineMap(lines), timeBased };
}

/** Drawn-preview streams re-derived from the merged track.
 *
 *  The wire's feed/rapid endpoint lists lose the interleaving between the
 *  two streams: rendered as connected strips, every rapid between two feeds
 *  produced a FALSE feed connector that skipped the rapid (and vice versa)
 *  — e.g. a feed after a G0 Z-lift drew as starting from the pre-lift
 *  position, and the part-frame transform subdivided that phantom segment
 *  into a long wrong curve (user-caught on a post-lift rotary sweep).
 *
 *  The merged track has the truth: segment (i-1 → i) belongs to the stream
 *  point i came from. Each stream is rebuilt as SECTIONS — a section's
 *  first vertex is the real start position (the other stream's last point)
 *  — plus `breaks`: the vertex indices that OPEN a section, i.e. no
 *  segment is drawn into them. Renderers turn breaks into an index buffer
 *  (LineSegments) instead of a strip. */
export interface SplitStreams {
  feedPos: Float32Array; feedAbc: Float32Array;
  feedLines: Uint32Array; feedBreaks: Uint32Array;
  rapidPos: Float32Array; rapidAbc: Float32Array;
  rapidBreaks: Uint32Array;
  /** Per-vertex world-kins flags aligned with feedPos/rapidPos — present
   *  iff the track carries mode. A section-start vertex takes the OPENING
   *  segment's mode (same convention as feedLines). */
  feedMode?: Uint8Array; rapidMode?: Uint8Array;
}

export function splitTrackStreams(t: ScrubTrack): SplitStreams {
  const n = t.count;
  const fPos: number[] = [], fAbc: number[] = [], fLines: number[] = [], fBreaks: number[] = [];
  const rPos: number[] = [], rAbc: number[] = [], rBreaks: number[] = [];
  const fMode: number[] = [], rMode: number[] = [];
  let fLast = -2, rLast = -2;  // track index of each stream's last emitted point

  const push = (pos: number[], abc: number[], i: number) => {
    const j = i * 3;
    pos.push(t.pos[j]!, t.pos[j + 1]!, t.pos[j + 2]!);
    abc.push(t.abc[j]!, t.abc[j + 1]!, t.abc[j + 2]!);
  };

  for (let i = 1; i < n; i++) {
    const ln = t.lines[i]!;  // segment belongs to its END point's line
    const md = t.mode?.[i] ?? 0;  // ...and its END point's mode
    if (t.rapid[i] === 1) {
      if (rLast !== i - 1) {
        rBreaks.push(rPos.length / 3);
        push(rPos, rAbc, i - 1);
        rMode.push(md);
      }
      push(rPos, rAbc, i);
      rMode.push(md);
      rLast = i;
    } else {
      if (fLast !== i - 1) {
        fBreaks.push(fPos.length / 3);
        // The section-start vertex carries the OPENING segment's line so a
        // line highlight covers the move from its true start.
        fLines.push(ln);
        push(fPos, fAbc, i - 1);
        fMode.push(md);
      }
      fLines.push(ln);
      push(fPos, fAbc, i);
      fMode.push(md);
      fLast = i;
    }
  }

  return {
    feedPos: new Float32Array(fPos), feedAbc: new Float32Array(fAbc),
    feedLines: new Uint32Array(fLines), feedBreaks: new Uint32Array(fBreaks),
    rapidPos: new Float32Array(rPos), rapidAbc: new Float32Array(rAbc),
    rapidBreaks: new Uint32Array(rBreaks),
    feedMode: t.mode ? new Uint8Array(fMode) : undefined,
    rapidMode: t.mode ? new Uint8Array(rMode) : undefined,
  };
}

export interface ScrubSample {
  px: number; py: number; pz: number;
  pa: number; pb: number; pc: number;
  line: number;
  rapid: boolean;
  /** True when the segment runs under WORLD/TCP kins (track mode flags).
   *  False when the track has no mode data — untracked poses as trivkins,
   *  same as today, never guessed. */
  world: boolean;
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
    out.line = t.lines[0]!; out.rapid = t.rapid[0] === 1;
    out.world = t.mode?.[0] === 1; out.index = 0;
    return out;
  }
  if (s >= t.cum[last]!) {
    const j = last * 3;
    out.px = t.pos[j]!; out.py = t.pos[j + 1]!; out.pz = t.pos[j + 2]!;
    out.pa = t.abc[j]!; out.pb = t.abc[j + 1]!; out.pc = t.abc[j + 2]!;
    out.line = t.lines[last]!; out.rapid = t.rapid[last] === 1;
    out.world = t.mode?.[last] === 1; out.index = last;
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
  out.world = t.mode?.[lo] === 1;
  out.index = lo;
  return out;
}

/** Live machine joints → program-space [x,y,z,a,b,c]: joints → machine
 *  coords through the kins boundary (forward kinematics), then the inverse
 *  WCS transform. `world` selects the machine's WORLD kins (spec + live
 *  TLO from wcs.tool) instead of the trivkins permutation — the caller
 *  passes the track's INITIAL mode (programs set their kins mode in the
 *  preamble before first motion; the live switchkins pin isn't sampled —
 *  recorded refinement). UVW/unknown joints are ignored. */
export function machineJointsToProgram(
  joints: ArrayLike<number>, axes: string[], wcs: PartFrameWcs,
  kins?: KinsSpec, world?: boolean,
): [number, number, number, number, number, number] {
  const m = [0, 0, 0, 0, 0, 0];
  if (world && !kins) warnWorldWithoutSpec("entry move");
  const model = world && kins
    ? kinsFor(axes, kins, wcs.tool?.[2] || undefined)
    : kinsFor(axes);
  model.forward(joints, m);
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
  let mode: Uint8Array | undefined;
  if (t.mode) {
    // The entry rapid executes under the program's initial mode (the
    // preamble sets kins before first motion — same assumption as the
    // entry inverse in machineJointsToProgram).
    mode = new Uint8Array(n);
    mode.set(t.mode, 1);
    mode[0] = t.mode[0] ?? 0;
    mode[1] = t.mode[0] ?? 0;
  }
  for (let i = 0; i < t.count; i++) cum[i + 1] = t.cum[i]! + entryLen;
  const lineCum = new Map<number, number>();
  for (const [ln, c] of t.lineCum) lineCum.set(ln, c + entryLen);
  return { pos, abc, lines, rapid, mode, cum, count: n, lineCum, lineSpan: buildLineMap(lines), timeBased: t.timeBased };
}

const _machineVals: number[] = [0, 0, 0, 0, 0, 0];

/** Per-joint pose values for a track sample: program → machine via the live
 *  WCS (TLO-inclusive), then machine coords → joints through the kins
 *  boundary. A WORLD-mode sample (sample.world, from the phase-2a wire
 *  flags) routes through the machine's declared kins with live TLO in the
 *  pivot math; identity/untracked samples use the trivkins permutation as
 *  before. UVW and unknown letters yield null — the caller falls back to
 *  the live joint position rather than inventing a value. Fills `out`. */
export function jointsForSample(
  sample: ScrubSample, wcs: PartFrameWcs, axes: string[], out: (number | null)[], kins?: KinsSpec,
): (number | null)[] {
  const o: WcsTerms = wcsTerms(wcs);
  programToMachine(sample.px, sample.py, sample.pz, sample.pa, sample.pb, sample.pc, o, _machineVals);
  if (sample.world && !kins) warnWorldWithoutSpec("scrub pose");
  const model = sample.world && kins
    ? kinsFor(axes, kins, wcs.tool?.[2] || undefined)
    : kinsFor(axes);
  return model.inverse(_machineVals, out);
}
