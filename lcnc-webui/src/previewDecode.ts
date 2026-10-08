// Pure preview-payload decode: raw msgpack-decoded payload object → the
// scrub-track input streams (W6 P1 extraction).
//
// ONE decode source for two consumers: previewWorker (the browser path)
// and scripts/simDump.ts (the sim-vs-actual trajectory gate, which must
// exercise EXACTLY the client math — a second decode implementation is
// how divergence starts). No DOM/worker globals here.
import { parseWcsFrames, type WcsEpoch } from "./viewer/wcsEpochs";
import { TLO_NONE, parseTloEvents, type TloEvent } from "./viewer/tloEvents";
import { EVENT_NONE, eventIdxFor } from "./viewer/eventIndex";
import { firstProbeStopSeq } from "./viewer/probeStop";
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
  const feedFrameWire = eventIdxFor(feedSeq, frameSeqs, EVENT_NONE);
  const rapidFrameWire = eventIdxFor(rapidSeq, frameSeqs, EVENT_NONE);
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
  // M600 (docs/reviews/m600-preview.plan.md): every point after the first
  // measurement the preview cannot predict (wire probe_unpredicted, by seq).
  const stopSeq = firstProbeStopSeq(g.probe_unpredicted);
  const after = (seq: Uint32Array | undefined, n: number) => {
    if (stopSeq == null || !seq || seq.length !== n) return undefined;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = seq[i]! > stopSeq ? 1 : 0;
    return out;
  };
  const feedUnpred = after(feedSeq, feedPos.length / 3);
  const rapidUnpred = after(rapidSeq, rapidPos.length / 3);

  return {
    feed: { pos: feedPos, abc: feedAbc, lines: feedLines, seq: feedSeq,
            tcum: g.feed_tcum != null && (g.feed_tcum as Uint8Array).length ? toF32(g.feed_tcum) : undefined,
            mode: feedModeWire, frame: feedFrameWire, wcs: feedWcsWire, tlo: feedTloWire,
            lineOk: feedLineOkWire, sub: feedSubWire, cline: feedClineWire, outside: feedOutsideWire,
            unpredicted: feedUnpred },
    rapid: { pos: rapidPos, abc: rapidAbc, lines: toU32(g.rapid_lines), seq: rapidSeq,
             tcum: g.rapid_tcum != null && (g.rapid_tcum as Uint8Array).length ? toF32(g.rapid_tcum) : undefined,
             mode: rapidModeWire, frame: rapidFrameWire, brk: rapidBrkWire,
             ustart: rapidUstartWire, wcs: rapidWcsWire, tlo: rapidTloWire,
             lineOk: rapidLineOkWire, sub: rapidSubWire, cline: rapidClineWire, outside: rapidOutsideWire,
             unpredicted: rapidUnpred },
    kinsFrames, wcsEvents, tloEvents, subNames, rotaryCmd,
    feedPos, rapidPos, feedLines, feedAbc, rapidAbc,
  };
}

/** Normalise a decoded payload to a TOOL BASIS (VP-I20, plan Fassungen
 *  4–6, Codex R55/R56). The client uses a point's resolved tool offset
 *  twice — axis position (point + offset) and tip / tool body (the point
 *  itself) — and the points before the first TLO row were parsed under the
 *  payload's start `tloStart`. Normalised to a basis b, those points become
 *  p + tloStart − b and resolve to b (tloForIndex's fallback), so the axis
 *  position stays the interpreter's and the tip is where a fresh parse at b
 *  puts it. Shifts the streams' `pos` IN PLACE (decodePreviewStreams copies
 *  every wire array) — call it once per decode, always from the original
 *  payload, so bases never sum up. `basis` null/absent = the payload's own
 *  start (nothing moves). Returns the basis used, or undefined for a payload
 *  without a known start (an older worker, or `start_known: false`): its
 *  consumers keep the live applied offset as before. Pure but for the
 *  in-place shift. */
export function normalizeToToolBasis(d: DecodedPreview, tloStart: unknown,
                                     basis: readonly number[] | null | undefined): number[] | undefined {
  if (!Array.isArray(tloStart) || tloStart.length < 3) return undefined;
  const s = [Number(tloStart[0]), Number(tloStart[1]), Number(tloStart[2])];
  if (!s.every(Number.isFinite)) return undefined;
  const b = basis && basis.length >= 3 ? [Number(basis[0]), Number(basis[1]), Number(basis[2])] : s;
  const dx = s[0]! - b[0]!, dy = s[1]! - b[1]!, dz = s[2]! - b[2]!;
  if (dx || dy || dz) {
    for (const st of [d.feed, d.rapid]) {
      const pos = st.pos, tlo = st.tlo;
      const n = pos.length / 3;
      for (let i = 0; i < n; i++) {
        if (tlo && tlo[i] !== TLO_NONE) continue;   // after the first row: its row governs
        pos[i * 3] = pos[i * 3]! + dx;
        pos[i * 3 + 1] = pos[i * 3 + 1]! + dy;
        pos[i * 3 + 2] = pos[i * 3 + 2]! + dz;
      }
    }
  }
  return b;
}

/** The worker's two boxes over the wire points (gcode_parse_worker): bounds
 *  = X/Y over feed + rapid, Z over feed only (null without feed); motion =
 *  every axis over both (null without points). Recomputed after a
 *  normalisation moved points — as the gateway's verify compares them. */
export function payloadBoxes(feedPos: Float32Array, rapidPos: Float32Array): {
  bounds: { min: number[]; max: number[] } | null;
  motion: { min: number[]; max: number[] } | null;
} {
  const box = (pos: Float32Array) => {
    if (pos.length < 3) return null;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = pos[i + k]!;
        if (v < mn[k]!) mn[k] = v;
        if (v > mx[k]!) mx[k] = v;
      }
    }
    return { min: mn, max: mx };
  };
  const f = box(feedPos), r = box(rapidPos);
  const bounds = f ? (r ? { min: [Math.min(f.min[0]!, r.min[0]!), Math.min(f.min[1]!, r.min[1]!), f.min[2]!],
                            max: [Math.max(f.max[0]!, r.max[0]!), Math.max(f.max[1]!, r.max[1]!), f.max[2]!] }
                        : f) : null;
  const motion = f && r ? { min: f.min.map((v, i) => Math.min(v, r.min[i]!)), max: f.max.map((v, i) => Math.max(v, r.max[i]!)) }
                        : (f ?? r);
  return { bounds, motion };
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
