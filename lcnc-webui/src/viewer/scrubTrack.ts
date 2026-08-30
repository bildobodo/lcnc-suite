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
import { kinsForSegment, type KinsSpec } from "./kins";
import { TLO_NONE, tloForIndex, type TloEvent } from "./tloEvents";
import {
  buildLineMap, machineToProgram, wcsTerms,
  type PartFrameWcs, type WcsTerms, liftToJoints, jointsToProgram, tipWcs } from "./partFrame";
import type { WcsEpoch } from "./wcsEpochs";
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
  /** Per-point RAW switchkins type (wire feed_kinstype/rapid_kinstype —
   *  raw since phase 3: trsrn types 1/TCP and 2/TOOL differ). Mapping to
   *  world/identity is the consumer's job (worldModeForSpec). Absent =
   *  no mode data. */
  mode?: Uint8Array;
  /** Per-point governing TWP frame INDEX into the track's `frames` list
   *  (0xff = none) — resolved at ingestion from wire kins_frames by seq.
   *  Absent on programs without WEBUI_TWPFRAME markers. */
  frame?: Uint8Array;
  /** Per-point kins-flip relabel flag (wire rapid_brk): 1 ⇒ the segment
   *  INTO this point is a switchkins frame relabel at a stationary pose —
   *  zero machine motion. Absent = legacy payload (flip segments keep the
   *  raw phantom; the reparse machinery refreshes them). */
  brk?: Uint8Array;
  /** Per-point unknown-start flag (wire rapid_ustart, schema 6 / W3 P1):
   *  1 ⇒ this point is a suppressed first-move ENDPOINT reached via an
   *  unknown path — unioned into the track's brk at build time. */
  ustart?: Uint8Array;
  /** Per-point WCS epoch INDEX into the payload's wcs_frames events —
   *  which basis this point was peeled against (review P2). Absent =
   *  legacy payload (single-basis semantics). */
  wcs?: Uint8Array;
  /** Per-point TLO/tool event INDEX into the payload's tlo_events (schema
   *  8; 0xff = before the first row → live offset governs). Absent = the
   *  program never changes tool or offset. */
  tlo?: Uint8Array;
  /** Per-point line trust (wire feed_lineok/rapid_lineok, W2 P6). Absent
   *  = pre-schema-4 payload. */
  lineOk?: Uint8Array;
  /** Per-point marked-subroutine index (wire feed_sub/rapid_sub, 0xff =
   *  none) — dereferences into the payload's sub_names. */
  sub?: Uint8Array;
  /** Per-point call-site MAIN-file line (wire feed_cline/rapid_cline,
   *  W4; 0 = none) — the text-verified unique o-call/remap trigger line
   *  of the span the point sits in. */
  cline?: Uint16Array;
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
export function buildScrubTrack(feed: ScrubStream, rapid: ScrubStream,
                                frames?: [number, number, number][],
                                wcsEvents?: WcsEpoch[],
                                subNames?: string[],
                                tloEvents?: TloEvent[]): ScrubTrack | null {
  const nf = (feed.pos.length / 3) | 0;
  const nr = (rapid.pos.length / 3) | 0;
  const n = nf + nr;
  if (n === 0) return null;
  const fseq = feed.seq, rseq = rapid.seq;
  if (nf > 0 && nr > 0 && (fseq?.length !== nf || rseq?.length !== nr)) return null;
  // abc alignment guard (W2 P3): a present-but-mislengthed abc stream is an
  // upstream bug — zero-filling would pose the machine untilted, the exact
  // silent-wrong class the abc channel exists to fix — so the track refuses
  // to build and says why (same honesty rule as the seq guard above).
  // Absence stays legal: pure-linear programs ship no abc.
  if ((feed.abc && feed.abc.length !== nf * 3)
      || (rapid.abc && rapid.abc.length !== nr * 3)) {
    console.error("[scrubTrack] abc stream length mismatch — track not built",
      { feedAbc: feed.abc?.length, nf, rapidAbc: rapid.abc?.length, nr });
    return null;
  }

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
  // TWP frame indices merge like mode (present iff consistent + a frames
  // list exists to dereference into).
  const hasFrame = !!frames?.length && hasMode
    && (nf === 0 || feed.frame?.length === nf)
    && (nr === 0 || rapid.frame?.length === nr)
    && !!(feed.frame || rapid.frame);
  const frameIdx = hasFrame ? new Uint8Array(n) : undefined;
  // Relabel flags: a stream without brk data means "no relabels here" (the
  // worker only ever inserts them into rapid), so absence on one stream is
  // zeros, not inconsistency — but a mislengthed array is a bug upstream
  // and drops the whole channel (never guess alignment).
  const hasBrk = !!(feed.brk || rapid.brk)
    && (!feed.brk || feed.brk.length === nf)
    && (!rapid.brk || rapid.brk.length === nr);
  // Unknown-start flags (W3 P1): same tolerance rules as brk (rapid-only
  // in practice; a mislengthed array drops the channel, never guessed).
  const hasUstart = !!(feed.ustart || rapid.ustart)
    && (!feed.ustart || feed.ustart.length === nf)
    && (!rapid.ustart || rapid.ustart.length === nr);
  // brk exists whenever EITHER channel does: ustart unions into it so every
  // brk consumer (draw sections, sweep, time, projection) inherits the
  // never-cross-the-connector behavior with no per-consumer changes.
  const brk = (hasBrk || hasUstart) ? new Uint8Array(n) : undefined;
  const ustart = hasUstart ? new Uint8Array(n) : undefined;
  // WCS epochs (review P2): like mode — present iff every non-empty stream
  // carries the per-point index and an events list exists to deref into.
  const hasWcs = !!wcsEvents?.length
    && (nf === 0 || feed.wcs?.length === nf)
    && (nr === 0 || rapid.wcs?.length === nr)
    && !!(feed.wcs || rapid.wcs);
  const wcsEpoch = hasWcs ? new Uint8Array(n) : undefined;
  // TLO/tool events (schema 8): like wcs — present iff consistent and an
  // events list exists to dereference into.
  const hasTlo = !!tloEvents?.length
    && (nf === 0 || feed.tlo?.length === nf)
    && (nr === 0 || rapid.tlo?.length === nr)
    && !!(feed.tlo || rapid.tlo);
  const tlo = hasTlo ? new Uint8Array(n) : undefined;
  // Line trust + sub spans (W2 P6): merged like mode — present iff every
  // non-empty stream carries the channel (the worker ships both together;
  // a half-present channel is a bug upstream, dropped whole rather than
  // guessed). subNames must exist to dereference sub indices into.
  const hasLineOk = (nf === 0 || feed.lineOk?.length === nf)
    && (nr === 0 || rapid.lineOk?.length === nr)
    && !!(feed.lineOk || rapid.lineOk);
  const lineOk = hasLineOk ? new Uint8Array(n) : undefined;
  const hasSub = !!subNames?.length
    && (nf === 0 || feed.sub?.length === nf)
    && (nr === 0 || rapid.sub?.length === nr)
    && !!(feed.sub || rapid.sub);
  const sub = hasSub ? new Uint8Array(n) : undefined;
  // Call-site attribution (W4): merged like sub (present iff consistent).
  const hasCline = (nf === 0 || feed.cline?.length === nf)
    && (nr === 0 || rapid.cline?.length === nr)
    && !!(feed.cline || rapid.cline);
  const cline = hasCline ? new Uint16Array(n) : undefined;

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
    if (frameIdx) frameIdx[i] = src.frame?.[si] ?? 0xff;
    if (brk) brk[i] = (src.brk?.[si] ?? 0) | (src.ustart?.[si] ?? 0);
    if (ustart) ustart[i] = src.ustart?.[si] ?? 0;
    if (wcsEpoch) wcsEpoch[i] = src.wcs?.[si] ?? 0;
    if (tlo) tlo[i] = src.tlo?.[si] ?? TLO_NONE;
    if (lineOk) lineOk[i] = src.lineOk?.[si] ?? 0;
    if (sub) sub[i] = src.sub?.[si] ?? 0xff;
    if (cline) cline[i] = src.cline?.[si] ?? 0;
    if (timeBased) {
      // Duration of the segment ending here = this stream's cumulative
      // delta (RDP-collapsed interiors are preserved by the cumulative).
      // A relabel segment is not motion: its wire tcum delta is already 0
      // (the worker inserts a zero-length tuple), forced here as a belt
      // against any payload that disagrees.
      const t = src.tcum![si]!;
      const dur = brk?.[i] ? 0 : Math.max(0, t - (takeFeed ? prevFT : prevRT));
      if (takeFeed) prevFT = t; else prevRT = t;
      if (i > 0) cum[i] = cum[i - 1]! + dur;   // point 0 anchors the axis at 0
    }
  }

  if (!timeBased) {
    // Distance axis fallback (1° ≙ 1 mm) — legacy payloads / no INI velocity.
    for (let i = 1; i < n; i++) {
      if (brk?.[i]) {
        // Frame relabel — the position jump is a re-expression, not travel.
        cum[i] = cum[i - 1]!;
        continue;
      }
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

  return { pos, abc, lines, rapid: rapidFlag, mode, frame: frameIdx,
           frames: hasFrame ? frames : undefined, brk, ustart,
           wcsEpoch, wcsEvents: hasWcs ? wcsEvents : undefined,
           tlo, tloEvents: hasTlo ? tloEvents : undefined,
           lineOk, sub, subNames: hasSub ? subNames : undefined, cline,
           cum, count: n, lineCum, lineSpan: buildLineMap(lines), timeBased };
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
  /** Per-vertex RAW switchkins types aligned with feedPos/rapidPos —
   *  present iff the track carries mode. A section-start vertex takes the
   *  OPENING segment's mode (same convention as feedLines). */
  feedMode?: Uint8Array; rapidMode?: Uint8Array;
  /** Per-vertex TWP frame indices (same conventions as feedMode/rapidMode;
   *  dereference into the track's `frames`). */
  feedFrame?: Uint8Array; rapidFrame?: Uint8Array;
  /** Per-vertex WCS epoch indices (same conventions; dereference into the
   *  track's `wcsEvents`) — which basis each drawn vertex was peeled
   *  against, consumed by the display rebase (wcsEpochs.rebasePositions). */
  feedWcs?: Uint8Array; rapidWcs?: Uint8Array;
  /** Per-vertex TLO event indices (same conventions; dereference into the
   *  track's `tloEvents`) — the part-frame worker lifts and peels each
   *  vertex with ITS offset (schema 8). */
  feedTlo?: Uint8Array; rapidTlo?: Uint8Array;
  /** Source TRACK index per drawn feed vertex (ascending) — maps a track
   *  segment range to a drawn-vertex range for the positional 3D highlight
   *  (review P3), which line numbers cannot do once a called sub's numbers
   *  collide with the main file's. */
  feedSrc?: Uint32Array;
}

export function splitTrackStreams(t: ScrubTrack): SplitStreams {
  const n = t.count;
  const fPos: number[] = [], fAbc: number[] = [], fLines: number[] = [], fBreaks: number[] = [];
  const rPos: number[] = [], rAbc: number[] = [], rBreaks: number[] = [];
  const fMode: number[] = [], rMode: number[] = [];
  const fFrame: number[] = [], rFrame: number[] = [];
  const fWcs: number[] = [], rWcs: number[] = [];
  const fTlo: number[] = [], rTlo: number[] = [];
  const fSrc: number[] = [];
  let fLast = -2, rLast = -2;  // track index of each stream's last emitted point

  const push = (pos: number[], abc: number[], i: number) => {
    const j = i * 3;
    pos.push(t.pos[j]!, t.pos[j + 1]!, t.pos[j + 2]!);
    abc.push(t.abc[j]!, t.abc[j + 1]!, t.abc[j + 2]!);
  };

  for (let i = 1; i < n; i++) {
    const ln = t.lines[i]!;  // segment belongs to its END point's line
    const md = t.mode?.[i] ?? 0;  // ...and its END point's mode
    const fr = t.frame?.[i] ?? 0xff;  // ...and its END point's TWP frame
    const we = t.wcsEpoch?.[i] ?? 0;  // ...and its END point's WCS epoch
    const te = t.tlo?.[i] ?? TLO_NONE;  // ...and its END point's TLO event
    // Kins-flip relabel INTO i: unlike a stream-interleave section (whose
    // connector is the other stream's real move), no motion exists here at
    // all — open the section AT the relabeled vertex and draw nothing into
    // it. The next real segment then starts from the machine's true pose.
    const relabel = t.brk?.[i] === 1;
    if (t.rapid[i] === 1) {
      if (relabel) {
        rBreaks.push(rPos.length / 3);
        push(rPos, rAbc, i);
        rMode.push(md); rFrame.push(fr); rWcs.push(we); rTlo.push(te);
        rLast = i;
        continue;
      }
      if (rLast !== i - 1) {
        rBreaks.push(rPos.length / 3);
        push(rPos, rAbc, i - 1);
        rMode.push(md); rFrame.push(fr); rWcs.push(we); rTlo.push(te);
      }
      push(rPos, rAbc, i);
      rMode.push(md); rFrame.push(fr); rWcs.push(we); rTlo.push(te);
      rLast = i;
    } else {
      if (relabel) {
        fBreaks.push(fPos.length / 3);
        fLines.push(ln);
        push(fPos, fAbc, i);
        fMode.push(md); fFrame.push(fr); fWcs.push(we); fTlo.push(te); fSrc.push(i);
        fLast = i;
        continue;
      }
      if (fLast !== i - 1) {
        fBreaks.push(fPos.length / 3);
        // The section-start vertex carries the OPENING segment's line so a
        // line highlight covers the move from its true start.
        fLines.push(ln);
        push(fPos, fAbc, i - 1);
        fMode.push(md); fFrame.push(fr); fWcs.push(we); fTlo.push(te); fSrc.push(i - 1);
      }
      fLines.push(ln);
      push(fPos, fAbc, i);
      fMode.push(md); fFrame.push(fr); fWcs.push(we); fTlo.push(te); fSrc.push(i);
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
    feedFrame: t.frame ? new Uint8Array(fFrame) : undefined,
    rapidFrame: t.frame ? new Uint8Array(rFrame) : undefined,
    feedWcs: t.wcsEpoch ? new Uint8Array(fWcs) : undefined,
    rapidWcs: t.wcsEpoch ? new Uint8Array(rWcs) : undefined,
    feedTlo: t.tlo ? new Uint8Array(fTlo) : undefined,
    rapidTlo: t.tlo ? new Uint8Array(rTlo) : undefined,
    feedSrc: new Uint32Array(fSrc),
  };
}

export interface ScrubSample {
  px: number; py: number; pz: number;
  pa: number; pb: number; pc: number;
  line: number;
  rapid: boolean;
  /** RAW switchkins type of the segment (track mode array), or null when
   *  the track has no mode data — untracked poses as trivkins, never
   *  guessed (0 would NOT be a safe default: on a plain-sparm trt config
   *  type 0 is the WORLD kins). Consumers map it per the declared kins
   *  family via worldModeForSpec — jointsForSample does this internally. */
  kinstype: number | null;
  /** Governing TWP frame values [preRot, primary, secondary] for a
   *  TOOL-mode (type 2) segment, or null (no frame marker / no TWP). */
  frame: [number, number, number] | null;
  /** WCS epoch index of the segment (into the track's wcsEvents), or null
   *  when the track has no epoch data (legacy payload — single-basis). */
  wcsEpoch: number | null;
  /** TLO/tool event governing the segment (schema 8), or null = the LIVE
   *  applied offset governs (before the program's first G43/M6, or no
   *  channel). Consumers resolve through tloEvents.tloForIndex semantics:
   *  `sample.tlo?.xyz ?? wcs.tool`. */
  tlo: TloEvent | null;
  /** Upper track index of the segment the sample falls in. */
  index: number;
}

function _frameAt(t: ScrubTrack, i: number): [number, number, number] | null {
  const idx = t.frame?.[i];
  return (idx != null && idx !== 0xff && t.frames) ? t.frames[idx] ?? null : null;
}

function _tloAt(t: ScrubTrack, i: number): TloEvent | null {
  const idx = t.tlo?.[i];
  return (idx != null && idx !== TLO_NONE && t.tloEvents) ? t.tloEvents[idx] ?? null : null;
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
    out.kinstype = t.mode ? t.mode[0]! : null;
    out.frame = _frameAt(t, 0); out.index = 0;
    out.wcsEpoch = t.wcsEpoch ? t.wcsEpoch[0]! : null;
    out.tlo = _tloAt(t, 0);
    return out;
  }
  if (s >= t.cum[last]!) {
    const j = last * 3;
    out.px = t.pos[j]!; out.py = t.pos[j + 1]!; out.pz = t.pos[j + 2]!;
    out.pa = t.abc[j]!; out.pb = t.abc[j + 1]!; out.pc = t.abc[j + 2]!;
    out.line = t.lines[last]!; out.rapid = t.rapid[last] === 1;
    out.kinstype = t.mode ? t.mode[last]! : null;
    out.frame = _frameAt(t, last); out.index = last;
    out.wcsEpoch = t.wcsEpoch ? t.wcsEpoch[last]! : null;
    out.tlo = _tloAt(t, last);
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
  // A relabel segment must never be lerped — the two vertices are the same
  // machine pose in two frames (zero cum makes this unreachable today; the
  // guard keeps a future non-zero-width break from posing mid-phantom).
  const u = t.brk?.[lo] ? 1 : c1 > c0 ? (s - c0) / (c1 - c0) : 1;
  const j = lo * 3, k = j - 3;
  out.px = t.pos[k]! + (t.pos[j]! - t.pos[k]!) * u;
  out.py = t.pos[k + 1]! + (t.pos[j + 1]! - t.pos[k + 1]!) * u;
  out.pz = t.pos[k + 2]! + (t.pos[j + 2]! - t.pos[k + 2]!) * u;
  out.pa = t.abc[k]! + (t.abc[j]! - t.abc[k]!) * u;
  out.pb = t.abc[k + 1]! + (t.abc[j + 1]! - t.abc[k + 1]!) * u;
  out.pc = t.abc[k + 2]! + (t.abc[j + 2]! - t.abc[k + 2]!) * u;
  out.line = t.lines[lo]!;
  out.rapid = t.rapid[lo] === 1;
  out.kinstype = t.mode ? t.mode[lo]! : null;
  out.frame = _frameAt(t, lo);
  out.wcsEpoch = t.wcsEpoch ? t.wcsEpoch[lo]! : null;
  out.tlo = _tloAt(t, lo);
  out.index = lo;
  return out;
}

/** The ONE rule for "which text-panel line may a track point display"
 *  (W3 P4): per-point wire trust when the track carries it, else the
 *  wholesale lines_untrusted fallback; line 0 (entry/unknown) never
 *  displays. Returns the sub name alongside so callers can say
 *  "in subroutine (name)" instead of a colliding line. Shared by the run
 *  playhead and the scrub emit — the scrub path used to forward RAW
 *  sample lines, lighting blank main-file lines with a called sub's
 *  numbers and scrolling to remap linenos past the end of the file.
 *
 *  W4: an untrusted point inside a marked sub span whose unique main-file
 *  call/trigger line was text-verified (track `cline`) displays THAT line
 *  (`viaCall: true`) — the o-call/remap line the operator wrote — so the
 *  highlight tracks execution through subs instead of going dark. */
export function displayLineForPoint(
  t: ScrubTrack, i: number, wholesaleTrusted: boolean,
): { line: number | null; subName: string | null; viaCall: boolean } {
  const ln = t.lines[i] ?? 0;
  const ok = t.lineOk ? t.lineOk[i] === 1 : wholesaleTrusted;
  const sb = t.sub?.[i];
  const cl = t.cline?.[i] ?? 0;
  const own = ok && ln > 0;
  return {
    line: own ? ln : cl > 0 ? cl : null,
    subName: (sb != null && sb !== 0xff && t.subNames) ? t.subNames[sb] ?? null : null,
    viaCall: !own && cl > 0,
  };
}

/** True when the scrub parameter sits pinned at the track's very end —
 *  the playhead has nothing further to attribute (trailing non-motion
 *  lines are unknowable), so the UI presents an explicit "end" state
 *  instead of a frozen last-line highlight (W3 P4). */
export function atTrackEnd(t: ScrubTrack, s: number): boolean {
  return t.count > 0 && s >= t.cum[t.count - 1]! - 1e-9;
}

/** Build the sim's ENTRY track from the live joints (W6 P1 extraction —
 *  the single implementation for ScrubBar's sim entry AND the sim-vs-
 *  actual gate harness; reimplementing it is the W3 P3 bug class).
 *
 *  Entry labeling (W3 P3): the entry converts the live JOINTS into the
 *  frame of the track's FIRST SEGMENT — its mode, its TWP frame, its
 *  epoch-0 terms — one consistent triple. Joints are the physical
 *  invariant; kins maps are labelings: forwarding the joints under the
 *  track's own labeling names the live pose in exactly the coordinates
 *  vertex 0 uses, so jointsForSample(entry) round-trips to the live
 *  joints BY CONSTRUCTION. `liveKinsType` is only the legacy fallback for
 *  a track without mode data; no pin AND no mode = untracked → identity,
 *  never guessed.
 *
 *  Returns the entry track, or null when nothing to prepend (no joints,
 *  or prependEntry judged the entry degenerate). */
export function buildEntryTrack(
  base: ScrubTrack,
  liveJoints: readonly number[],
  axes: string[],
  wcs: PartFrameWcs,
  kins: KinsSpec | undefined,
  epochTerms: readonly WcsTerms[] | undefined,
  liveKinsType: number | null | undefined,
  rates?: { linear?: number | null; rotary?: number | null },
): ScrubTrack | null {
  if (!liveJoints.length) return null;
  const ktEntry = base.mode?.[0] ?? liveKinsType ?? null;
  const f0 = base.frame?.[0];
  const frameEntry =
    (f0 != null && f0 !== 0xff && base.frames) ? base.frames[f0] ?? null : null;
  // Epoch-0 terms (review P2): the entry lands on the track's FIRST point,
  // whose coords live in epoch 0's frame — not necessarily the live active
  // fixture's (a TWP program's first point is already in the plane frame).
  const entryTerms = epochTerms?.[base.wcsEpoch?.[0] ?? 0];
  // Point 0's tool offset (schema 8) — the fourth member of the "one
  // consistent triple": the entry lands where vertex 0 lifts from.
  const entryTlo = tloForIndex(base.tlo?.[0], base.tloEvents, wcs.tool);
  const entry = machineJointsToProgram(liveJoints, axes, wcs, kins,
                                       ktEntry, frameEntry, entryTerms, entryTlo);
  const t = prependEntry(base, entry, rates);
  return t === base ? null : t;
}

/** The program's terminating line — the UNIQUE comment-stripped main-file
 *  line that is an M2/M02/M30 (optionally N-numbered) statement (W5).
 *  Zero or several such lines → null, never a guess. Displayed when the
 *  playhead reaches the track's terminal vertex: the motion track cannot
 *  know what follows the last move, but the program's own text can. */
export function programEndLine(text: string | null | undefined): number | null {
  if (!text) return null;
  let hit: number | null = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const src = lines[i]!.replace(/\([^)]*\)/g, "").replace(/;.*$/, "");
    if (/^\s*(?:n\d+\s*)?(?:m0?2|m30)(?![0-9.])/i.test(src)) {
      if (hit != null) return null;   // two program-end lines — ambiguous
      hit = i + 1;
    }
  }
  return hit;
}

/** MAIN-file lines vouched for by the track's per-point trust (W5): the
 *  set a live `motion_line` value must belong to before it may display —
 *  motion ids carry no file identity (LinuxCNC stamps the interp's bare
 *  sequence_number on each motion segment), so a number outside this set
 *  is either a called file's colliding lineno or a stale id. Null for
 *  legacy tracks without the per-point channel (callers fall back to the
 *  wholesale flag, pre-W2 behavior). */
export function mainLinesTrusted(t: ScrubTrack): Set<number> | null {
  if (!t.lineOk) return null;
  const s = new Set<number>();
  for (let i = 0; i < t.count; i++) {
    const ln = t.lines[i] ?? 0;
    if (t.lineOk[i] === 1 && ln > 0) s.add(ln);
  }
  return s;
}

/** Live machine joints → program-space [x,y,z,a,b,c]: joints → machine
 *  coords through the kins boundary (forward kinematics), then the inverse
 *  WCS transform. `kinstype` (+ `frame` for TOOL mode) selects the model
 *  via kinsForSegment — the caller passes the TRACK'S first-segment
 *  mode/frame (W3 P3: naming the live pose in the track's coordinates is
 *  a labeling question, answered by the track's own labeling — the live
 *  pin is only a legacy fallback for mode-less tracks; mixing the live
 *  STATE in landed the entry ~900 mm off when parked labeling ≠ track
 *  labeling). null kinstype = untracked → trivkins. UVW/unknown joints
 *  are ignored. */
export function machineJointsToProgram(
  joints: ArrayLike<number>, axes: string[], wcs: PartFrameWcs,
  kins?: KinsSpec, kinstype?: number | null,
  frame?: readonly number[] | null,
  terms?: WcsTerms,
  tlo?: readonly number[],
): [number, number, number, number, number, number] {
  const m = [0, 0, 0, 0, 0, 0];
  // The offset the track's FIRST segment runs under (schema 8) — the same
  // value jointsForSample lifts that point with, so the entry round-trips
  // to the live joints by construction; live `wcs.tool` when unknown.
  const tl = tlo ?? tloForIndex(undefined, undefined, wcs.tool);
  const model = kinsForSegment(axes, kins, kinstype ?? null, frame,
                               tl[2] || undefined, "entry move");
  model.forward(joints, m);
  const out: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  // `terms` override (review P2): the entry inverse must land in the frame
  // of the track point it connects to — epoch 0's terms on an epoch-aware
  // track, not necessarily the live ACTIVE fixture's. Terms are TIP-space.
  jointsToProgram(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, terms ?? wcsTerms(tipWcs(wcs)), tl, out);
  return out;
}

/** Live joints → machine axis values through the kins boundary (forward
 *  only — no WCS peel). The projection converts machine → program PER
 *  CANDIDATE SEGMENT (each has its own epoch terms), so the two halves of
 *  machineJointsToProgram are split here. Uses the LIVE tool offset on
 *  purpose (schema 8 changes nothing here): the run playhead inverts the
 *  machine's PHYSICAL joints under its ACTUAL G43 state at that instant —
 *  the track's per-segment offsets are the parse-time prediction of that
 *  same state, not a substitute for it. */
export function machineFromJoints(
  joints: ArrayLike<number>, axes: string[], wcs: PartFrameWcs,
  kins?: KinsSpec, kinstype?: number | null, frame?: readonly number[] | null,
): [number, number, number, number, number, number] {
  const m: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  const model = kinsForSegment(axes, kins, kinstype ?? null, frame,
                               wcs.tool?.[2] || undefined, "run playhead");
  model.forward(joints, m);
  return m;
}

export interface TrackProjection {
  /** Scrub parameter of the closest on-track point. */
  cum: number;
  /** Upper track index of the segment it falls in. */
  index: number;
  /** Squared 6D residual (units/degrees, 1° ≙ 1 unit). */
  dist2: number;
}

/** Project a live MACHINE pose onto the track (review P3 — the positional
 *  run playhead): best point-to-segment match in 6D (1° ≙ 1 unit) over the
 *  segments whose cum range intersects `win` (null = the whole track).
 *  motion_line is NOT consulted — sub/remap-relative line numbers collide
 *  with the main file's, which is exactly what parked the old highlight on
 *  wrong lines. The machine pose converts to program space per candidate
 *  segment through ITS epoch's terms (precomputed flat per epoch); brk
 *  segments (frame relabels — poses the machine never sweeps) are skipped.
 *  `stride` probes every Nth segment — the off-path re-probe's bounded
 *  coarse scan (W2 P5); callers refine a strided hit with a windowed
 *  stride-1 pass before trusting its residual. */
export function projectOntoTrack(
  t: ScrubTrack,
  machine: readonly number[],
  wcs: PartFrameWcs,
  epochTerms: readonly WcsTerms[] | undefined,
  win: { lo: number; hi: number } | null,
  stride = 1,
): TrackProjection | null {
  const n = t.count;
  if (n < 2) return null;
  let i0 = 1, i1 = n - 1;
  if (win) {
    // Smallest i with cum[i] >= lo …
    let lo = 1, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t.cum[mid]! < win.lo) lo = mid + 1; else hi = mid;
    }
    i0 = lo;
    // … largest i with cum[i-1] <= hi.
    lo = i0; hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (t.cum[mid - 1]! > win.hi) hi = mid - 1; else lo = mid;
    }
    i1 = lo;
    if (t.cum[i0 - 1]! > win.hi) return null;  // window past the segment
  }
  const liveTerms = wcsTerms(tipWcs(wcs));
  // The live joints are physical under the machine's ACTUAL G43 state:
  // strip the LIVE tool offset once, up front, then every per-epoch
  // conversion runs in TIP space (epoch terms carry no tool, schema 8).
  const lt = wcs.tool ?? [];
  const mx = machine[0]! - (lt[0] ?? 0), my = machine[1]! - (lt[1] ?? 0), mz = machine[2]! - (lt[2] ?? 0);
  // Per-epoch machine→program conversions precomputed FLAT (W2 P5): the
  // previous lazy Map paid a hash lookup per segment — real money on a 99k
  // segment full-track scan. Slot 0 = live terms (no-epoch fallback);
  // slot e+1 = epochTerms[e].
  const nE = epochTerms?.length ?? 0;
  const pFlat = new Float64Array((nE + 1) * 6);
  const _tmp: number[] = [0, 0, 0, 0, 0, 0];
  machineToProgram(mx, my, mz, machine[3]!, machine[4]!, machine[5]!, liveTerms, _tmp);
  pFlat.set(_tmp, 0);
  for (let e = 0; e < nE; e++) {
    machineToProgram(mx, my, mz, machine[3]!, machine[4]!, machine[5]!,
                     epochTerms![e] ?? liveTerms, _tmp);
    pFlat.set(_tmp, (e + 1) * 6);
  }
  const hasEp = !!(t.wcsEpoch && epochTerms);
  const step = Math.max(1, stride | 0);
  let best: TrackProjection | null = null;
  for (let i = i0; i <= i1; i += step) {
    if (t.brk?.[i]) continue;
    const e = hasEp ? t.wcsEpoch![i]! : -1;
    const off = (e >= 0 && e < nE ? e + 1 : 0) * 6;
    const j = i * 3, k = j - 3;
    const ax = t.pos[k]!, ay = t.pos[k + 1]!, az = t.pos[k + 2]!;
    const aa = t.abc[k]!, ab = t.abc[k + 1]!, ac = t.abc[k + 2]!;
    const dx = t.pos[j]! - ax, dy = t.pos[j + 1]! - ay, dz = t.pos[j + 2]! - az;
    const da = t.abc[j]! - aa, db = t.abc[j + 1]! - ab, dc = t.abc[j + 2]! - ac;
    const len2 = dx * dx + dy * dy + dz * dz + da * da + db * db + dc * dc;
    const rx = pFlat[off]! - ax, ry = pFlat[off + 1]! - ay, rz = pFlat[off + 2]! - az;
    const ra = pFlat[off + 3]! - aa, rb = pFlat[off + 4]! - ab, rc = pFlat[off + 5]! - ac;
    const u = len2 > 0
      ? Math.min(1, Math.max(0, (rx * dx + ry * dy + rz * dz + ra * da + rb * db + rc * dc) / len2))
      : 0;
    const ex = rx - u * dx, ey = ry - u * dy, ez = rz - u * dz;
    const ea = ra - u * da, eb = rb - u * db, ec = rc - u * dc;
    const d2 = ex * ex + ey * ey + ez * ez + ea * ea + eb * eb + ec * ec;
    if (d2 < (best?.dist2 ?? Infinity)) {
      best = { cum: t.cum[i - 1]! + u * (t.cum[i]! - t.cum[i - 1]!), index: i, dist2: d2 };
    }
  }
  return best;
}

/** The contiguous same-line run of track segments around index i — the
 *  track-index answer to "which stretch of path is this line". Contiguity
 *  is what disambiguates COLLIDING line numbers (a sub's L7 vs the main
 *  file's L7 are different runs); brk boundaries never join a run. */
export function lineRunAround(t: ScrubTrack, i: number): [number, number] {
  const ln = t.lines[i]!;
  let a = i, b = i;
  while (a > 1 && t.lines[a - 1] === ln && !t.brk?.[a]) a--;
  while (b < t.count - 1 && t.lines[b + 1] === ln && !t.brk?.[b + 1]) b++;
  return [a, b];
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
  let frame: Uint8Array | undefined;
  if (t.frame) {
    frame = new Uint8Array(n);
    frame.set(t.frame, 1);
    frame[0] = t.frame[0] ?? 0xff;
    frame[1] = t.frame[0] ?? 0xff;
  }
  let brk: Uint8Array | undefined;
  if (t.brk) {
    // The entry rapid is REAL motion (live position → first point), so the
    // entry vertex and the move ending at old point 0 are both unbroken.
    // When old point 0 was an unknown-start vertex this is the supersede
    // (W3 P1): the entry provides the real path to that endpoint, so the
    // unioned break clears with it.
    brk = new Uint8Array(n);
    brk.set(t.brk, 1);
    brk[0] = 0;
    brk[1] = 0;
  }
  let ustart: Uint8Array | undefined;
  if (t.ustart) {
    // The entry move supersedes the unknown approach to the first vertex —
    // its path is now the concrete live-pose → endpoint rapid.
    ustart = new Uint8Array(n);
    ustart.set(t.ustart, 1);
    ustart[0] = 0;
    ustart[1] = 0;
  }
  let wcsEpoch: Uint8Array | undefined;
  if (t.wcsEpoch) {
    // The entry move targets the track's first point, whose coords live in
    // epoch 0's frame — the whole entry segment shares that epoch (same
    // reasoning as the initial-mode stamp above).
    wcsEpoch = new Uint8Array(n);
    wcsEpoch.set(t.wcsEpoch, 1);
    wcsEpoch[0] = t.wcsEpoch[0] ?? 0;
    wcsEpoch[1] = t.wcsEpoch[0] ?? 0;
  }
  let tlo: Uint8Array | undefined;
  if (t.tlo) {
    // The entry move runs under whatever offset governs the track's first
    // point (schema 8) — the same "one consistent triple" rule as mode /
    // frame / epoch above; the entry inverse uses the same value.
    tlo = new Uint8Array(n);
    tlo.set(t.tlo, 1);
    tlo[0] = t.tlo[0] ?? TLO_NONE;
    tlo[1] = t.tlo[0] ?? TLO_NONE;
  }
  let lineOk: Uint8Array | undefined;
  if (t.lineOk) {
    // The entry move is run-time motion no program line commanded — both
    // its vertices are untrusted for the text highlight (W2 P6).
    lineOk = new Uint8Array(n);
    lineOk.set(t.lineOk, 1);
    lineOk[0] = 0;
    lineOk[1] = 0;
  }
  let sub: Uint8Array | undefined;
  if (t.sub) {
    sub = new Uint8Array(n);
    sub.set(t.sub, 1);
    sub[0] = 0xff;
    sub[1] = 0xff;
  }
  let cline: Uint16Array | undefined;
  if (t.cline) {
    // Entry vertices carry no call-site line (run-time motion, W4).
    cline = new Uint16Array(n);
    cline.set(t.cline, 1);
    cline[0] = 0;
    cline[1] = 0;
  }
  for (let i = 0; i < t.count; i++) cum[i + 1] = t.cum[i]! + entryLen;
  const lineCum = new Map<number, number>();
  for (const [ln, c] of t.lineCum) lineCum.set(ln, c + entryLen);
  return { pos, abc, lines, rapid, mode, frame, frames: t.frames, brk, ustart,
           wcsEpoch, wcsEvents: t.wcsEvents, tlo, tloEvents: t.tloEvents,
           lineOk, sub, subNames: t.subNames, cline,
           cum, count: n, lineCum, lineSpan: buildLineMap(lines), timeBased: t.timeBased };
}

const _machineVals: number[] = [0, 0, 0, 0, 0, 0];

/** Per-joint pose values for a track sample: program → machine via the
 *  sample's epoch terms (tip-space) + the sample's TOOL OFFSET (schema 8:
 *  the event governing the segment, else the live applied offset), then
 *  machine coords → joints through the kins boundary. A sample whose raw
 *  kinstype maps to non-identity for the declared kins family
 *  (worldModeForSpec) routes through the machine's declared kins with the
 *  same per-segment TLO in the pivot math; identity/untracked samples use
 *  the trivkins permutation as before. UVW and unknown letters yield null —
 *  the caller falls back to the live joint position rather than inventing
 *  a value. Fills `out`. */
export function jointsForSample(
  sample: ScrubSample, wcs: PartFrameWcs, axes: string[], out: (number | null)[],
  kins?: KinsSpec, epochTerms?: readonly WcsTerms[],
): (number | null)[] {
  // Per-epoch terms (review P2): a sample on an epoch-aware track re-adds
  // ITS segment's basis (live row or rewritten snapshot, resolved by
  // wcsEpochs.epochTermsFor), not the live active fixture's. A legacy
  // track (wcsEpoch null) or a missing terms list keeps today's behavior.
  const o: WcsTerms = (sample.wcsEpoch != null && epochTerms?.[sample.wcsEpoch])
    ? epochTerms[sample.wcsEpoch]! : wcsTerms(tipWcs(wcs));
  const tlo = sample.tlo?.xyz ?? tloForIndex(undefined, undefined, wcs.tool);
  liftToJoints(sample.px, sample.py, sample.pz, sample.pa, sample.pb, sample.pc, o, tlo, _machineVals);
  const model = kinsForSegment(axes, kins, sample.kinstype, sample.frame,
                               tlo[2] || undefined, "scrub pose");
  return model.inverse(_machineVals, out);
}
