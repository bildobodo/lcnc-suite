// Off-main-thread part-frame preview transform. A heavy 5-axis program can
// carry hundreds of thousands of vertices, each needing a kinematic-chain
// evaluation (plus subdivision) — running that on the UI thread would starve
// the heartbeat worker exactly like the P4.1 decode problem did. The math
// lives in partFrame.ts (pure, unit-tested); this shell just marshals.
import {
  transformToPartFrame, lineDistances,
  type PartFrameMachine, type PartFrameWcs,
} from "./partFrame";
import { buildLineIndex, lineIndexTransferables } from "./lineIndex";
import { epochTermsFor, type WcsEpoch, type WcsTableRow } from "./wcsEpochs";
import type { TloEvent } from "./tloEvents";

type Streams = {
  feed: { pos: Float32Array; abc: Float32Array; lines?: Uint32Array; breaks?: Uint32Array; mode?: Uint8Array; wcs?: Uint8Array; src?: Uint32Array; tlo?: Uint8Array };
  rapid: { pos: Float32Array; abc: Float32Array; breaks?: Uint32Array; mode?: Uint8Array; wcs?: Uint8Array; tlo?: Uint8Array };
};

/** The payload is RESIDENT here (2026-09-05): the main thread sends the
 *  streams ONCE per program ("load", buffers transferred) and every WCS /
 *  tool / table change is a small "transform" request against them. It
 *  used to copy ~10 typed arrays (~150 MB on a 1.18 M-point program) on
 *  the main thread for every touch-off, feeding the collector's hitches. */
interface LoadReq { op: "load"; payloadId: number; streams: Streams }

interface TransformReq {
  op: "transform";
  id: number;
  /** Must match the loaded payload; otherwise the reply says needPayload
   *  and the main thread re-sends the streams (a recreated worker, or a
   *  transform racing a program change). */
  payloadId: number;
  machine: PartFrameMachine;
  wcs: PartFrameWcs;
  /** WCS epochs + the live table (review P2): per-vertex `wcs` indices on
   *  the streams resolve into per-epoch re-add terms here. Absent = legacy
   *  single-basis payload. */
  wcsEvents?: WcsEpoch[];
  wcsTable?: WcsTableRow[];
  /** Per-segment TLO/tool events (schema 8) — per-vertex `tlo` indices on
   *  the streams resolve into them (live `wcs.tool` before the first row). */
  tloEvents?: TloEvent[];
}

type Req = LoadReq | TransformReq;

let _resident: { id: number; streams: Streams } | null = null;

function assertFinite(a: Float32Array, label: string) {
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i])) throw new Error(`non-finite ${label} vertex at ${i} — bad machine.json/WCS input`);
  }
}

self.onmessage = (e: MessageEvent<Req>) => {
  if (e.data.op === "load") {
    _resident = { id: e.data.payloadId, streams: e.data.streams };
    return;
  }
  const { id, payloadId, machine, wcs, wcsEvents, wcsTable, tloEvents } = e.data;
  if (!_resident || _resident.id !== payloadId) {
    self.postMessage({ id, needPayload: payloadId });
    return;
  }
  const { feed, rapid } = _resident.streams;
  try {
    const epochTerms = wcsEvents?.length
      ? epochTermsFor(wcsEvents, wcs, wcsTable) : undefined;
    const f = transformToPartFrame(machine, wcs, { ...feed, tloEvents }, undefined, epochTerms);
    const r = transformToPartFrame(machine, wcs, { ...rapid, tloEvents }, undefined, epochTerms);
    // NaN positions render as NOTHING with no error — never ship them; the
    // main thread falls back to the programmed preview and logs loudly.
    assertFinite(f.pos, "feed");
    assertFinite(r.pos, "rapid");
    const rapidDist = lineDistances(r.pos);
    const feedLineIndex = buildLineIndex(f.lines);
    const transfer: Transferable[] = [f.pos.buffer as ArrayBuffer, r.pos.buffer as ArrayBuffer, rapidDist.buffer as ArrayBuffer,
                                      ...lineIndexTransferables(feedLineIndex)];
    if (f.lines) transfer.push(f.lines.buffer as ArrayBuffer);
    if (f.breaks) transfer.push(f.breaks.buffer as ArrayBuffer);
    if (r.breaks) transfer.push(r.breaks.buffer as ArrayBuffer);
    if (f.src) transfer.push(f.src.buffer as ArrayBuffer);
    self.postMessage(
      { id, feedPos: f.pos, feedLines: f.lines, feedLineIndex, rapidPos: r.pos, rapidDist, feedBreaks: f.breaks, rapidBreaks: r.breaks, feedSrc: f.src },
      { transfer },
    );
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
