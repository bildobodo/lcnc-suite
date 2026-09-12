// Pure preview-payload decode: raw msgpack-decoded payload object → the
// scrub-track input streams (W6 P1 extraction).
//
// ONE decode source for two consumers: previewWorker (the browser path)
// and scripts/simDump.ts (the sim-vs-actual trajectory gate, which must
// exercise EXACTLY the client math — a second decode implementation is
// how divergence starts). No DOM/worker globals here.
import { parseWcsFrames, type WcsEpoch } from "./viewer/wcsEpochs";
import { TLO_NONE, parseTloEvents, type TloEvent } from "./viewer/tloEvents";
import type { ScrubStream } from "./viewer/scrubTrack";
import type { RotaryCmd } from "./ws/bulkData";

export interface DecodedPreview {
  feed: ScrubStream;
  rapid: ScrubStream;
  kinsFrames?: [number, number, number][];
  wcsEvents?: WcsEpoch[];
  tloEvents?: TloEvent[];
  subNames?: string[];
  /** Rotary-command boundary (wire `rotary_cmd`, 2026-09-11); undefined
   *  when absent or malformed (never guessed). */
  rotaryCmd?: RotaryCmd;
  // The drawing-path aliases the worker also ships (same buffers as the
  // stream fields — feed.pos === feedPos etc.).
  feedPos: Float32Array;
  rapidPos: Float32Array;
  feedLines?: Uint32Array;
  feedAbc?: Float32Array;
  rapidAbc?: Float32Array;
}

/** Payload object (msgpack-decoded GET /preview shape) → typed stream
 *  inputs for buildScrubTrack. Pure. */
export function decodePreviewStreams(g: Record<string, any>): DecodedPreview {
  const feedPos = toF32(g.feed);
  const rapidPos = toF32(g.rapid);
  const feedLines = toU32(g.feed_lines);
  // Rotary-aware preview: per-vertex abc, present only when the pose
  // depends on it (should_ship_abc).
  const feedAbc = g.feed_abc != null ? toF32(g.feed_abc) : undefined;
  const rapidAbc = g.rapid_abc != null ? toF32(g.rapid_abc) : undefined;
  // Kins mode (RAW switchkins types since phase 3), relabel breaks,
  // unknown-start endpoints, per-point trust / sub spans / call lines —
  // see ws/bulkData.ts for each channel's semantics.
  const feedModeWire = g.feed_kinstype != null ? new Uint8Array(g.feed_kinstype as Uint8Array) : undefined;
  const rapidModeWire = g.rapid_kinstype != null ? new Uint8Array(g.rapid_kinstype as Uint8Array) : undefined;
  const rapidBrkWire = g.rapid_brk != null ? new Uint8Array(g.rapid_brk as Uint8Array) : undefined;
  const rapidUstartWire = g.rapid_ustart != null ? new Uint8Array(g.rapid_ustart as Uint8Array) : undefined;
  const feedLineOkWire = g.feed_lineok != null ? new Uint8Array(g.feed_lineok as Uint8Array) : undefined;
  const rapidLineOkWire = g.rapid_lineok != null ? new Uint8Array(g.rapid_lineok as Uint8Array) : undefined;
  // Outside-limits verdict per wire vertex (2026-09-12): the segment ENDING
  // there had a joint beyond the checked window (gateway validator — the
  // ONE source the marks, the count and the painted path share). Absent =
  // unchecked.
  const feedOutsideWire = g.feed_outside != null ? new Uint8Array(g.feed_outside as Uint8Array) : undefined;
  const rapidOutsideWire = g.rapid_outside != null ? new Uint8Array(g.rapid_outside as Uint8Array) : undefined;
  const feedSubWire = g.feed_sub != null ? new Uint8Array(g.feed_sub as Uint8Array) : undefined;
  const rapidSubWire = g.rapid_sub != null ? new Uint8Array(g.rapid_sub as Uint8Array) : undefined;
  const subNames = g.sub_names as string[] | undefined;
  const feedClineWire = toU16(g.feed_cline);
  const rapidClineWire = toU16(g.rapid_cline);
  const feedSeq = toU32(g.feed_seq);
  const rapidSeq = toU32(g.rapid_seq);

  // TWP frames (phase 3): wire kins_frames = [seq, preRot, primary, secondary].
  const wireFrames = (g.kins_frames as [number, number, number, number][] | undefined);
  const kinsFrames = wireFrames?.length
    ? wireFrames.map((f) => [f[1], f[2], f[3]] as [number, number, number])
    : undefined;
  const frameSeqs = kinsFrames ? wireFrames!.map(f => f[0]) : undefined;
  const feedFrameWire = eventIdxFor(feedSeq, frameSeqs, 0xff);
  const rapidFrameWire = eventIdxFor(rapidSeq, frameSeqs, 0xff);
  // WCS epochs (review P2): wire wcs_frames rows → per-vertex epoch index.
  const wcsEvents = parseWcsFrames(g.wcs_frames as number[][] | undefined);
  const epochSeqs = wcsEvents?.map(e => e.seq);
  const feedWcsWire = eventIdxFor(feedSeq, epochSeqs, 0);
  const rapidWcsWire = eventIdxFor(rapidSeq, epochSeqs, 0);
  // TLO/tool events (schema 8): same rule; TLO_NONE before the first row
  // (= the live applied offset governs).
  const tloEvents = parseTloEvents(g.tlo_events as number[][] | undefined);
  const tloSeqs = tloEvents?.map(e => e.seq);
  const feedTloWire = eventIdxFor(feedSeq, tloSeqs, TLO_NONE);
  const rapidTloWire = eventIdxFor(rapidSeq, tloSeqs, TLO_NONE);

  const rotaryCmd = parseRotaryCmd(g.rotary_cmd);

  return {
    feed: { pos: feedPos, abc: feedAbc, lines: feedLines, seq: feedSeq,
            tcum: g.feed_tcum != null && (g.feed_tcum as Uint8Array).length ? toF32(g.feed_tcum) : undefined,
            mode: feedModeWire, frame: feedFrameWire, wcs: feedWcsWire, tlo: feedTloWire,
            lineOk: feedLineOkWire, sub: feedSubWire, cline: feedClineWire, outside: feedOutsideWire },
    rapid: { pos: rapidPos, abc: rapidAbc, lines: toU32(g.rapid_lines), seq: rapidSeq,
             tcum: g.rapid_tcum != null && (g.rapid_tcum as Uint8Array).length ? toF32(g.rapid_tcum) : undefined,
             mode: rapidModeWire, frame: rapidFrameWire, brk: rapidBrkWire,
             ustart: rapidUstartWire, wcs: rapidWcsWire, tlo: rapidTloWire,
             lineOk: rapidLineOkWire, sub: rapidSubWire, cline: rapidClineWire, outside: rapidOutsideWire },
    kinsFrames, wcsEvents, tloEvents, subNames, rotaryCmd,
    feedPos, rapidPos, feedLines, feedAbc, rapidAbc,
  };
}

/** Wire `rotary_cmd` → RotaryCmd, or undefined for absent/malformed data
 *  (a letter's value must be a non-negative integer seq or null). */
export function parseRotaryCmd(v: unknown): RotaryCmd | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const seqOrNull = (x: unknown): number | null | undefined =>
    x === null ? null : (typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : undefined);
  const unknown = seqOrNull(o.unknown);
  if (unknown === undefined) return undefined;
  const out: RotaryCmd = { unknown, seed: {} };
  const seed = (o.seed && typeof o.seed === "object") ? o.seed as Record<string, unknown> : {};
  for (const l of ["A", "B", "C"] as const) {
    if (!(l in o)) continue;
    const s = seqOrNull(o[l]);
    if (s === undefined) return undefined;
    out[l] = s;
    const sv = seed[l];
    if (typeof sv === "number" && Number.isFinite(sv)) out.seed[l] = sv;
  }
  return out;
}

// Seq-keyed event resolution, shared by TWP frames and WCS epochs: an
// event at seq N governs segments with seq > N; same-seq ties: last
// recorded wins (stable sort on seq alone). `none` is the fill value.
function eventIdxFor(
  seq: Uint32Array | undefined, eventSeqs: number[] | undefined, none: number,
): Uint8Array | undefined {
  if (!eventSeqs?.length || !seq) return undefined;
  const evs = eventSeqs.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Uint8Array(seq.length).fill(none);
  for (let v = 0; v < seq.length; v++) {
    let idx = none;
    for (const [es, ei] of evs) {
      if (es < seq[v]!) idx = Math.min(ei, 0xfe);
      else break;
    }
    out[v] = idx;
  }
  return out;
}

// Preferred wire shape: little-endian float32 bytes from the parse worker
// (msgpack bin → Uint8Array VIEW into the fetch buffer). One buffer.slice
// gives an aligned, independently-transferable Float32Array. Legacy nested
// [[x,y,z],...] lists still fall back to flatten3.
export function toF32(v: unknown): Float32Array {
  if (v instanceof Uint8Array) {
    return new Float32Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  }
  return flatten3(v);
}

function flatten3(pts: unknown): Float32Array {
  if (!Array.isArray(pts) || pts.length === 0) return new Float32Array(0);
  const out = new Float32Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    out[i * 3] = p[0]; out[i * 3 + 1] = p[1]; out[i * 3 + 2] = p[2];
  }
  return out;
}

export function toU32(a: unknown): Uint32Array | undefined {
  if (a instanceof Uint8Array) {
    return new Uint32Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
  }
  if (!Array.isArray(a)) return undefined;
  const out = new Uint32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i];
  return out;
}

export function toU16(a: unknown): Uint16Array | undefined {
  if (a instanceof Uint8Array) {
    return new Uint16Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
  }
  return undefined;
}
