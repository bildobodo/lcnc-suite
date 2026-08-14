// Off-main-thread part-frame preview transform. A heavy 5-axis program can
// carry hundreds of thousands of vertices, each needing a kinematic-chain
// evaluation (plus subdivision) — running that on the UI thread would starve
// the heartbeat worker exactly like the P4.1 decode problem did. The math
// lives in partFrame.ts (pure, unit-tested); this shell just marshals.
import {
  transformToPartFrame, lineDistances, buildLineMap,
  type PartFrameMachine, type PartFrameWcs,
} from "./partFrame";

interface Req {
  id: number;
  machine: PartFrameMachine;
  wcs: PartFrameWcs;
  feed: { pos: Float32Array; abc: Float32Array; lines?: Uint32Array };
  rapid: { pos: Float32Array; abc: Float32Array };
}

function assertFinite(a: Float32Array, label: string) {
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i])) throw new Error(`non-finite ${label} vertex at ${i} — bad machine.json/WCS input`);
  }
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, machine, wcs, feed, rapid } = e.data;
  try {
    const f = transformToPartFrame(machine, wcs, feed);
    const r = transformToPartFrame(machine, wcs, rapid);
    // NaN positions render as NOTHING with no error — never ship them; the
    // main thread falls back to the programmed preview and logs loudly.
    assertFinite(f.pos, "feed");
    assertFinite(r.pos, "rapid");
    const rapidDist = lineDistances(r.pos);
    const feedLineMap = buildLineMap(f.lines);
    const transfer: Transferable[] = [f.pos.buffer as ArrayBuffer, r.pos.buffer as ArrayBuffer, rapidDist.buffer as ArrayBuffer];
    if (f.lines) transfer.push(f.lines.buffer as ArrayBuffer);
    self.postMessage(
      { id, feedPos: f.pos, feedLines: f.lines, feedLineMap, rapidPos: r.pos, rapidDist },
      { transfer },
    );
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
