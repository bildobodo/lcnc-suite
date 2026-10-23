// VP188-02 N1 (plan basiswechsel-last 4, Codex R190/R191): the collision
// request copies every track column and transfers exactly those copies —
// never an original the viewer still reads, never a buffer twice (that
// throws), optional columns absent in both — and the receiver gets the same
// values while the originals stay readable after the send.
import { describe, expect, it } from "vitest";
import type { ScrubTrack } from "./scrubTrack";
import { copyTrackForWorker } from "./colTrackCopy";

const n = 5;
const base = () => ({
  pos: Float32Array.from({ length: n * 3 }, (_, i) => i), abc: new Float32Array(n * 3).fill(1),
  lines: Uint32Array.from({ length: n }, (_, i) => i + 1), rapid: new Uint8Array(n).fill(1),
  cum: Float32Array.from({ length: n }, (_, i) => i * 2), count: n, timeBased: true,
}) as unknown as ScrubTrack;
const OPTIONAL = { mode: Uint8Array, frame: Uint32Array, brk: Uint8Array, ustart: Uint8Array, dep: Uint8Array,
                   wcsEpoch: Uint32Array, tlo: Uint32Array, unpredicted: Uint8Array, band: Uint8Array, cond: Uint8Array,
                   lineOk: Uint8Array, sub: Uint8Array, cline: Uint16Array } as const;
const full = () => {
  const t = base() as any;
  let k = 7;
  for (const [key, C] of Object.entries(OPTIONAL)) t[key] = (C as any).from({ length: n }, () => k++);
  return t as ScrubTrack;
};
const originals = (t: ScrubTrack) =>
  ["pos", "abc", "lines", "rapid", "cum", ...Object.keys(OPTIONAL)].flatMap(k => ((t as any)[k] ? [(t as any)[k].buffer] : []));

describe("the track the collision worker gets (VP188-02 N1)", () => {
  it("transfers every copied column once and no original", () => {
    for (const t of [base(), full()]) {
      const { trackCopy, transfer } = copyTrackForWorker(t);
      const copies = ["pos", "abc", "lines", "rapid", "cum", "mode", "frame", "brk", "ustart", "dep", "wcs", "tlo",
                      "unpredicted", "band", "cond", "lineOk", "sub", "cline"]
        .flatMap(k => ((trackCopy as any)[k] ? [(trackCopy as any)[k].buffer] : []));
      expect(new Set(transfer).size, "each buffer once").toBe(transfer.length);
      expect(new Set(transfer)).toEqual(new Set(copies));
      for (const o of originals(t)) expect(transfer, "an original is never transferred").not.toContain(o);
    }
    expect(copyTrackForWorker(base()).transfer).toHaveLength(5);    // optional columns absent: not listed
    expect(copyTrackForWorker(full()).transfer).toHaveLength(18);
    expect([copyTrackForWorker(base()).copies, copyTrackForWorker(full()).copies]).toEqual([5, 18]);
  });

  it("the receiver gets the same values and the originals stay readable after the send", () => {
    const t = full();
    const before = originals(t).map(b => Array.from(new Uint8Array(b)));
    const { trackCopy, transfer } = copyTrackForWorker(t);
    const got = structuredClone(trackCopy, { transfer });         // what postMessage does
    for (const [i, b] of originals(t).entries()) {
      expect(b.byteLength, "an original is not detached").toBeGreaterThan(0);
      expect(Array.from(new Uint8Array(b))).toEqual(before[i]);
    }
    expect(Array.from(got.pos)).toEqual(Array.from(t.pos));
    expect(Array.from(got.wcs!)).toEqual(Array.from(t.wcsEpoch!));
    expect(Array.from(got.cline!)).toEqual(Array.from(t.cline!));
    expect(trackCopy.pos.byteLength, "the copy went over").toBe(0);
    expect(got.count).toBe(n);
  });
});
