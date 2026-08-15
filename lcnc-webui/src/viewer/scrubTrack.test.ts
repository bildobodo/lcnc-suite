// Unit tests for viewer/scrubTrack.ts — the execution-ordered scrub track.
import { describe, expect, it } from "vitest";
import {
  buildScrubTrack, sampleTrack, jointsForSample,
  type ScrubSample, type ScrubStream, type ScrubTrack,
} from "./scrubTrack";

function stream(points: number[][], opts: { abc?: number[][]; lines?: number[]; seq?: number[] } = {}): ScrubStream {
  return {
    pos: new Float32Array(points.flat()),
    abc: opts.abc ? new Float32Array(opts.abc.flat()) : undefined,
    lines: opts.lines ? new Uint32Array(opts.lines) : undefined,
    seq: opts.seq ? new Uint32Array(opts.seq) : undefined,
  };
}

const EMPTY = stream([]);

function freshSample(): ScrubSample {
  return { px: 0, py: 0, pz: 0, pa: 0, pb: 0, pc: 0, line: 0, rapid: false, index: 0 };
}

describe("buildScrubTrack", () => {
  it("merges feed and rapid into execution order by seq", () => {
    // Program order: rapid(seq1) → feed(seq2) → rapid(seq3) → feed(seq4).
    const feed = stream([[10, 0, 0], [30, 0, 0]], { seq: [2, 4], lines: [5, 9] });
    const rapid = stream([[0, 0, 0], [20, 0, 0]], { seq: [1, 3], lines: [3, 7] });
    const t = buildScrubTrack(feed, rapid)!;
    expect(t.count).toBe(4);
    expect(Array.from(t.pos.filter((_, i) => i % 3 === 0))).toEqual([0, 10, 20, 30]);
    expect(Array.from(t.lines)).toEqual([3, 5, 7, 9]);
    expect(Array.from(t.rapid)).toEqual([1, 0, 1, 0]);
  });

  it("returns null when both streams exist but seq is missing (stale payload)", () => {
    expect(buildScrubTrack(stream([[0, 0, 0]]), stream([[1, 0, 0]]))).toBeNull();
  });

  it("builds a single-stream track without seq and null on no points", () => {
    const t = buildScrubTrack(stream([[0, 0, 0], [5, 0, 0]], { lines: [1, 2] }), EMPTY)!;
    expect(t.count).toBe(2);
    expect(Array.from(t.rapid)).toEqual([0, 0]);
    expect(buildScrubTrack(EMPTY, EMPTY)).toBeNull();
  });

  it("gives pure-rotary segments nonzero length (1° ≙ 1 mm)", () => {
    const t = buildScrubTrack(
      stream([[0, 0, 0], [0, 0, 0]], { abc: [[0, 0, 0], [0, 0, 90]] }), EMPTY)!;
    expect(t.cum[1]).toBeCloseTo(90, 5);
  });

  it("maps each source line to the cum of its first track point", () => {
    const t = buildScrubTrack(
      stream([[0, 0, 0], [10, 0, 0], [20, 0, 0]], { lines: [4, 7, 7] }), EMPTY)!;
    expect(t.lineCum.get(4)).toBe(0);
    expect(t.lineCum.get(7)).toBe(10);   // first occurrence, not the last
    expect(t.lineCum.has(0)).toBe(false); // 0 = unknown line, never mapped
  });

  it("cum is monotonic and linear distance wins when larger", () => {
    const t = buildScrubTrack(
      stream([[0, 0, 0], [3, 4, 0], [3, 4, 0]], { abc: [[0, 0, 0], [0, 0, 2], [0, 0, 2]] }), EMPTY)!;
    expect(t.cum[1]).toBeCloseTo(5, 5);   // 3-4-5 triangle > 2°
    expect(t.cum[2]).toBeCloseTo(5, 5);   // zero-length tail stays flat, not negative
  });
});

describe("sampleTrack", () => {
  const T: ScrubTrack = buildScrubTrack(
    stream([[0, 0, 0], [10, 0, 0], [10, 0, -4]],
           { abc: [[0, 0, 0], [0, 0, 0], [0, 0, 40]], lines: [1, 2, 3] }), EMPTY)!;

  it("clamps below zero and past the end", () => {
    const s = freshSample();
    sampleTrack(T, -5, s);
    expect([s.px, s.line, s.index]).toEqual([0, 1, 0]);
    sampleTrack(T, 1e9, s);
    expect([s.px, s.pz, s.pc, s.line]).toEqual([10, -4, 40, 3]);
  });

  it("lerps position, abc, and labels with the segment's upper point", () => {
    const s = freshSample();
    sampleTrack(T, 5, s);                    // midway through segment 1
    expect(s.px).toBeCloseTo(5, 5);
    expect(s.line).toBe(2);
    // Second segment: linear dz=4 < rot 40 → cum span 40; s=10+20 = halfway.
    sampleTrack(T, 30, s);
    expect(s.pz).toBeCloseTo(-2, 5);
    expect(s.pc).toBeCloseTo(20, 5);
    expect(s.line).toBe(3);
  });
});

describe("jointsForSample", () => {
  const AXES_XYZAC = ["X", "Y", "Z", "A", "C"];  // C = joint 4, canonical axis 5

  it("maps machine axis slots through JOINT-ordered letters", () => {
    const s = freshSample();
    s.px = 10; s.py = 20; s.pz = -5; s.pa = 15; s.pc = 90;
    const out: (number | null)[] = [];
    jointsForSample(s, { g5x: [1, 2, 3, 0, 0, 4], g92: [], rotationDeg: 0 }, AXES_XYZAC, out);
    expect(out).toEqual([11, 22, -2, 15, 94]);  // C (joint 4) gets axis-5 value
  });

  it("applies the XY rotation before the offset and nulls unknown letters", () => {
    const s = freshSample();
    s.px = 10;
    const out: (number | null)[] = [];
    jointsForSample(s, { g5x: [], g92: [], rotationDeg: 90 }, ["X", "Y", "U"], out);
    expect(out[0]!).toBeCloseTo(0, 5);
    expect(out[1]!).toBeCloseTo(10, 5);   // +90°: program X becomes machine Y
    expect(out[2]).toBeNull();            // UVW → caller falls back to live joint
  });

  it("stays finite on empty WCS arrays (pre-first-status race)", () => {
    const s = freshSample();
    const out: (number | null)[] = [];
    jointsForSample(s, { g5x: [], g92: [], rotationDeg: 0 }, AXES_XYZAC, out);
    for (const v of out) expect(Number.isFinite(v!)).toBe(true);
  });
});
