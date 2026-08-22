// Unit tests for viewer/scrubTrack.ts — the execution-ordered scrub track.
import { describe, expect, it, vi } from "vitest";
import {
  buildScrubTrack, sampleTrack, jointsForSample,
  machineJointsToProgram, prependEntry, splitTrackStreams,
  type ScrubSample, type ScrubStream, type ScrubTrack,
} from "./scrubTrack";
import { makeKins as kinsForTest } from "./kins";

function stream(points: number[][], opts: { abc?: number[][]; lines?: number[]; seq?: number[]; tcum?: number[]; mode?: number[]; frame?: number[]; brk?: number[] } = {}): ScrubStream {
  return {
    pos: new Float32Array(points.flat()),
    abc: opts.abc ? new Float32Array(opts.abc.flat()) : undefined,
    lines: opts.lines ? new Uint32Array(opts.lines) : undefined,
    seq: opts.seq ? new Uint32Array(opts.seq) : undefined,
    tcum: opts.tcum ? new Float32Array(opts.tcum) : undefined,
    mode: opts.mode ? new Uint8Array(opts.mode) : undefined,
    frame: opts.frame ? new Uint8Array(opts.frame) : undefined,
    brk: opts.brk ? new Uint8Array(opts.brk) : undefined,
  };
}

const EMPTY = stream([]);

function freshSample(): ScrubSample {
  return { px: 0, py: 0, pz: 0, pa: 0, pb: 0, pc: 0, line: 0, rapid: false, kinstype: null, frame: null, wcsEpoch: null, index: 0 };
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

  it("builds a TIME axis from per-stream cumulative seconds", () => {
    // Feed 2 segs (3s, 5s cumulative) interleaved with a rapid (0.5s):
    // execution f(seq1) r(seq2) f(seq3) → durations: point0 anchor, 0.5, 2.
    const t = buildScrubTrack(
      stream([[10, 0, 0], [30, 0, 0]], { seq: [1, 3], lines: [5, 9], tcum: [3, 5] }),
      stream([[20, 0, 0]], { seq: [2], lines: [7], tcum: [0.5] }))!;
    expect(t.timeBased).toBe(true);
    expect(Array.from(t.cum)).toEqual([0, 0.5, 2.5]);
    expect(t.lineCum.get(9)).toBeCloseTo(2.5, 5);
  });

  it("falls back to the distance axis when a non-empty stream lacks tcum", () => {
    const t = buildScrubTrack(
      stream([[0, 0, 0], [10, 0, 0]], { seq: [1, 2], tcum: [1, 2] }),
      stream([[5, 0, 0]], { seq: [3] }))!;   // rapid has no tcum
    expect(t.timeBased).toBe(false);
    expect(t.cum[1]).toBeCloseTo(10, 5);     // distance formula
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

describe("machineJointsToProgram", () => {
  it("inverts the WCS transform through JOINT-ordered letters", () => {
    // XYZAC joints at machine [11, 22, -2, 15, 94] with g5x [1,2,3,0,0,4]
    // must give back program [10, 20, -5, 15, 0, 90] — the exact inverse of
    // the jointsForSample fixture.
    const p = machineJointsToProgram(
      [11, 22, -2, 15, 94], ["X", "Y", "Z", "A", "C"],
      { g5x: [1, 2, 3, 0, 0, 4], g92: [], rotationDeg: 0 });
    expect(p[0]).toBeCloseTo(10, 5);
    expect(p[1]).toBeCloseTo(20, 5);
    expect(p[2]).toBeCloseTo(-5, 5);
    expect(p[3]).toBeCloseTo(15, 5);
    expect(p[5]).toBeCloseTo(90, 5);
  });

  it("inverts the XY rotation", () => {
    // +90° rotation: machine (0, 10) came from program (10, 0).
    const p = machineJointsToProgram([0, 10], ["X", "Y"], { g5x: [], g92: [], rotationDeg: 90 });
    expect(p[0]).toBeCloseTo(10, 5);
    expect(p[1]).toBeCloseTo(0, 5);
  });
});

describe("prependEntry", () => {
  const base = buildScrubTrack(
    stream([[10, 0, 0], [20, 0, 0]], { lines: [5, 7] }), EMPTY)!;

  it("prepends a rapid entry segment and shifts cum + lineCum", () => {
    const t = prependEntry(base, [10, -30, 0, 0, 0, 0]);
    expect(t.count).toBe(3);
    expect([t.pos[0], t.pos[1]]).toEqual([10, -30]);
    expect(t.lines[0]).toBe(0);          // "entry"
    expect(t.rapid[1]).toBe(1);          // the entry MOVE is a rapid
    expect(t.cum[1]).toBeCloseTo(30, 5); // entry length
    expect(t.cum[2]).toBeCloseTo(40, 5);
    expect(t.lineCum.get(5)).toBeCloseTo(30, 5);
    expect(t.lineCum.get(7)).toBeCloseTo(40, 5);
  });

  it("counts a pure rotary entry (1° ≙ 1 mm) and skips a no-op entry", () => {
    const rot = prependEntry(base, [10, 0, 0, 0, 0, -45]);
    expect(rot.cum[1]).toBeCloseTo(45, 5);
    // Machine already at the first point → original track returned as-is.
    expect(prependEntry(base, [10, 0, 0, 0, 0, 0])).toBe(base);
  });

  it("computes the entry duration from rapid rates on a time-based track", () => {
    const tb = buildScrubTrack(stream([[10, 0, 0], [20, 0, 0]], { lines: [5, 7], tcum: [0, 2] }), EMPTY)!;
    expect(tb.timeBased).toBe(true);
    // Entry 30 mm away at 100 mm/s → 0.3 s prepended to the time axis.
    const t = prependEntry(tb, [10, -30, 0, 0, 0, 0], { linear: 100, rotary: 60 });
    expect(t.cum[1]).toBeCloseTo(0.3, 5);
    expect(t.cum[2]).toBeCloseTo(2.3, 5);
    expect(t.timeBased).toBe(true);
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

describe("splitTrackStreams", () => {
  // The classic false-connector case: feed → rapid Z-lift → feed sweep.
  // Drawn as strips, the second feed appeared to start at the PRE-lift
  // position (the lift skipped); split into sections, each feed section
  // opens at its true start (the rapid's end) and `breaks` marks the
  // section starts so the renderer never draws the connector.
  it("re-opens a feed section at the rapid's end position", () => {
    // rapid(seq1)→(0,0,0); feed(seq2)→(10,0,0); rapid(seq3)→(10,0,60) LIFT;
    // feed(seq4)→(30,0,60) post-lift sweep.
    const feed = stream([[10, 0, 0], [30, 0, 60]], { seq: [2, 4], lines: [5, 9], abc: [[0, 0, 0], [0, 0, 90]] });
    const rapid = stream([[0, 0, 0], [10, 0, 60]], { seq: [1, 3], lines: [3, 7], abc: [[0, 0, 0], [0, 0, 0]] });
    const t = buildScrubTrack(feed, rapid)!;
    const s = splitTrackStreams(t);

    // Feed: section 1 = [track p0 (0,0,0) → p1 (10,0,0)], section 2 =
    // [track p2 (10,0,60) → p3 (30,0,60)] — section 2 STARTS at the lift's
    // end, not at (10,0,0).
    expect(Array.from(s.feedPos)).toEqual([0, 0, 0, 10, 0, 0, 10, 0, 60, 30, 0, 60]);
    expect(Array.from(s.feedBreaks)).toEqual([0, 2]);
    // Section-start vertices carry the OPENING segment's line.
    expect(Array.from(s.feedLines)).toEqual([5, 5, 9, 9]);
    // abc rides along (section start inherits the rapid end's abc).
    expect(Array.from(s.feedAbc)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 90]);

    // Rapid: only ONE rapid SEGMENT exists — the lift (feed end → lift end).
    // Track p0 is just the initial position; the segment into it was the
    // suppressed unknown-start first move and is not drawable.
    expect(Array.from(s.rapidPos)).toEqual([10, 0, 0, 10, 0, 60]);
    expect(Array.from(s.rapidBreaks)).toEqual([0]);
  });

  it("contiguous single-stream track yields one section, break only at 0", () => {
    const feed = stream([[0, 0, 0], [10, 0, 0], [20, 0, 0]], { seq: [1, 2, 3], lines: [1, 2, 3] });
    const t = buildScrubTrack(feed, EMPTY)!;
    const s = splitTrackStreams(t);
    expect(Array.from(s.feedPos)).toEqual([0, 0, 0, 10, 0, 0, 20, 0, 0]);
    expect(Array.from(s.feedBreaks)).toEqual([0]);
    expect(s.rapidPos.length).toBe(0);
    expect(s.rapidBreaks.length).toBe(0);
  });

  it("alternating streams duplicate every boundary vertex", () => {
    // F R F R: every segment is its own section.
    const feed = stream([[1, 0, 0], [3, 0, 0]], { seq: [1, 3], lines: [1, 3] });
    const rapid = stream([[2, 0, 0], [4, 0, 0]], { seq: [2, 4], lines: [2, 4] });
    const t = buildScrubTrack(feed, rapid)!;
    const s = splitTrackStreams(t);
    // The only feed SEGMENT is p1→p2 (p0 is the first rapid... no — p0 came
    // from feed but the segment INTO p1 is rapid): feed = [(2), (3)].
    expect(Array.from(s.feedPos)).toEqual([2, 0, 0, 3, 0, 0]);
    expect(Array.from(s.feedBreaks)).toEqual([0]);
    expect(Array.from(s.feedLines)).toEqual([3, 3]);
    expect(Array.from(s.rapidPos)).toEqual([1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0]);
    expect(Array.from(s.rapidBreaks)).toEqual([0, 2]);
  });
});

describe("kins mode plumbing (phase 2b)", () => {
  const AXES = ["X", "Y", "Z", "A", "C"];
  const SPEC = { type: "xyzac-trt", params: { yOffset: 20, zOffset: 10 } };
  const IDW = { g5x: [], g92: [], rotationDeg: 0 };

  it("buildScrubTrack merges per-stream mode; mixed payload drops it", () => {
    const t = buildScrubTrack(
      stream([[1, 0, 0], [3, 0, 0]], { seq: [1, 3], mode: [1, 1] }),
      stream([[2, 0, 0]], { seq: [2], mode: [0] }),
    )!;
    expect(Array.from(t.mode!)).toEqual([1, 0, 1]);
    const mixed = buildScrubTrack(
      stream([[1, 0, 0]], { seq: [1], mode: [1] }),
      stream([[2, 0, 0]], { seq: [2] }),   // no mode → untracked
    )!;
    expect(mixed.mode).toBeUndefined();
  });

  it("sampleTrack reports the segment's raw kinstype (null when untracked)", () => {
    const t = buildScrubTrack(
      stream([[0, 0, 0], [10, 0, 0], [20, 0, 0]], { seq: [1, 2, 3], mode: [0, 2, 0] }),
      EMPTY,
    )!;
    const s = freshSample();
    sampleTrack(t, 5, s);         // inside segment 0→1 (mode[1] = 2)
    expect(s.kinstype).toBe(2);   // raw type survives — 2 ≠ a world bool
    sampleTrack(t, 15, s);        // inside segment 1→2 (mode[2] = 0)
    expect(s.kinstype).toBe(0);
    const untracked = buildScrubTrack(
      stream([[0, 0, 0], [10, 0, 0]], { seq: [1, 2] }), EMPTY)!;
    sampleTrack(untracked, 5, s); // no mode data: null, NOT 0 (0 is the
    expect(s.kinstype).toBeNull(); // WORLD type on plain-sparm trt)
  });

  it("splitTrackStreams carries mode per drawn vertex", () => {
    const t = buildScrubTrack(
      stream([[1, 0, 0], [3, 0, 0]], { seq: [1, 3], mode: [0, 1], lines: [5, 7] }),
      stream([[2, 0, 0]], { seq: [2], mode: [0] }),
    )!;
    const split = splitTrackStreams(t);
    // Track point 0 has no INCOMING segment, so the only feed section is
    // the world-mode segment into point 2 (rapid-point start vertex + end).
    expect(Array.from(split.feedMode!)).toEqual([1, 1]);
    expect(Array.from(split.rapidMode!)).toEqual([0, 0]);
  });

  it("prependEntry stamps the entry move with the program's initial mode", () => {
    const t = buildScrubTrack(
      stream([[10, 0, 0], [20, 0, 0]], { seq: [1, 2], mode: [1, 1] }),
      EMPTY,
    )!;
    const withEntry = prependEntry(t, [0, 0, 0, 0, 0, 0]);
    expect(Array.from(withEntry.mode!)).toEqual([1, 1, 1]);  // 2 pts + entry
  });

  it("carries TWP frames through track, sample, split and entry", () => {
    const frames: [number, number, number][] = [[-1.78, 130.2, -40.9]];
    const t = buildScrubTrack(
      stream([[0, 0, 0], [10, 0, 0]], { seq: [1, 2], mode: [2, 2], frame: [0xff, 0] }),
      EMPTY, frames,
    )!;
    expect(t.frames).toBe(frames);
    const s = freshSample();
    sampleTrack(t, 5, s);          // segment 0→1 ends at index 1 (frame 0)
    expect(s.kinstype).toBe(2);
    expect(s.frame).toEqual([-1.78, 130.2, -40.9]);
    sampleTrack(t, 0, s);          // point 0: no governing frame yet
    expect(s.frame).toBeNull();
    const split = splitTrackStreams(t);
    expect(Array.from(split.feedFrame!)).toEqual([0, 0]);
    const withEntry = prependEntry(t, [5, 5, 5, 0, 0, 0]);
    expect(Array.from(withEntry.frame!)).toEqual([0xff, 0xff, 0]);
    expect(withEntry.frames).toBe(frames);
  });

  it("jointsForSample routes world samples through the declared kins", () => {
    const s = freshSample();
    s.px = 20; s.py = 10; s.pz = 30; s.pa = -45; s.pc = 90;
    const triv: (number | null)[] = [];
    jointsForSample(s, IDW, AXES, triv);              // untracked → trivkins
    // SPEC has no identityFirst (plain sparm): raw type 0 IS the world kins
    s.kinstype = 0;
    const world: (number | null)[] = [];
    jointsForSample(s, IDW, AXES, world, SPEC);
    // Routing proof: world joints differ from the permutation and match the
    // fixture-pinned model directly.
    expect(world).not.toEqual(triv);
    const expected: (number | null)[] = [];
    kinsForTest(AXES, SPEC).inverse([20, 10, 30, -45, 0, 90], expected);
    expect(world).toEqual(expected);
  });

  it("world sample without a spec falls back to trivkins (and warns)", () => {
    // The A4 honesty path: mode flags arrived but no kins declaration —
    // the pose must degrade to the permutation (identical to untracked),
    // with the loud once-per-context log (spied here to keep output clean;
    // the once-semantics themselves are pinned in kins.test.ts).
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = freshSample();
    s.px = 20; s.py = 10; s.pz = 30; s.pa = -45; s.pc = 90;
    s.kinstype = 1;  // no spec: any nonzero type = "needs routing we don't have"
    const noSpec: (number | null)[] = [];
    jointsForSample(s, IDW, AXES, noSpec);            // switched, but no spec
    s.kinstype = null;
    const triv: (number | null)[] = [];
    jointsForSample(s, IDW, AXES, triv);
    expect(noSpec).toEqual(triv);
    err.mockRestore();
  });

  it("machineJointsToProgram(world) inverts jointsForSample(world)", () => {
    const s = freshSample();
    s.px = 20; s.py = 10; s.pz = 30; s.pa = -45; s.pc = 90;
    s.kinstype = 0;  // plain sparm: type 0 = world (see SPEC note above)
    const joints: (number | null)[] = [];
    jointsForSample(s, IDW, AXES, joints, SPEC);
    const p = machineJointsToProgram(joints as number[], AXES, IDW, SPEC, 0);
    expect(p[0]).toBeCloseTo(20, 6);
    expect(p[1]).toBeCloseTo(10, 6);
    expect(p[2]).toBeCloseTo(30, 6);
    expect(p[3]).toBeCloseTo(-45, 6);
    expect(p[5]).toBeCloseTo(90, 6);
  });
});

describe("kins-flip relabel breaks (P1)", () => {
  // Wire shape mirroring the decisions.md switchkins probe: identity rapid,
  // the parse-worker-inserted relabel vertex (brk=1 — same machine pose
  // re-expressed in the plane frame, a ~600-unit program-space jump that is
  // NOT motion), then the real G53.3 entry move and a plane rapid.
  const PROBE = () => buildScrubTrack(
    EMPTY,
    stream(
      [[0, 0, 100], [50, 0, 100], [293.0, -498.4, 711.2], [309.6, -654.9, 708.9], [329.6, -684.9, 708.9]],
      { seq: [1, 2, 3, 4, 6], lines: [4, 5, 1029, 1029, 8],
        mode: [0, 0, 2, 2, 2], brk: [0, 0, 1, 0, 0] }),
  )!;

  it("relabel segments contribute ZERO to the distance axis", () => {
    const t = PROBE();
    expect(Array.from(t.brk!)).toEqual([0, 0, 1, 0, 0]);
    expect(t.cum[1]).toBeCloseTo(50, 4);   // the identity rapid is travel
    expect(t.cum[2]).toBe(t.cum[1]);       // the phantom jump is not
    const real1 = Math.hypot(309.6 - 293.0, -654.9 + 498.4, 708.9 - 711.2);
    expect(t.cum[3]! - t.cum[2]!).toBeCloseTo(real1, 4);  // entry move is real
    expect(t.cum[4]!).toBeGreaterThan(t.cum[3]!);
  });

  it("forces zero duration across a relabel even when wire tcum disagrees", () => {
    // Belt: the worker guarantees a zero tcum delta for inserted vertices;
    // an adversarial payload must not smuggle phantom seconds through.
    const t = buildScrubTrack(
      EMPTY,
      stream([[0, 0, 0], [500, 0, 0], [510, 0, 0]],
             { seq: [1, 2, 3], tcum: [0, 7, 8], mode: [0, 2, 2], brk: [0, 1, 0] }),
    )!;
    expect(t.timeBased).toBe(true);
    expect(t.cum[1]).toBe(0);
    expect(t.cum[2]).toBeCloseTo(1, 5);
  });

  it("sampleTrack never poses mid-relabel", () => {
    const t = PROBE();
    const s = freshSample();
    const end = t.cum[t.count - 1]!;
    for (let i = 0; i <= 200; i++) {
      sampleTrack(t, (end * i) / 200, s);
      // A pose strictly between the pre-flip vertex (x=50) and the relabel
      // (x=293) would be mid-phantom — the machine never occupies it.
      expect(s.px <= 50 + 1e-3 || s.px >= 293 - 1e-3).toBe(true);
    }
  });

  it("prependEntry keeps the entry move real and shifts brk", () => {
    const t = prependEntry(PROBE(), [-40, 0, 100, 0, 0, 0]);
    expect(Array.from(t.brk!)).toEqual([0, 0, 0, 1, 0, 0]);
    expect(t.cum[1]!).toBeCloseTo(40, 4);          // entry rapid is travel
    expect(t.cum[3]).toBe(t.cum[2]);               // relabel still is not
  });

  it("splitTrackStreams opens a section AT the relabel — no connector drawn", () => {
    const split = splitTrackStreams(PROBE());
    // The relabel vertex opens a NEW section with no back-vertex: unlike a
    // stream-interleave section (whose connector is the other stream's real
    // move), no motion exists into a relabel at all. The real entry move
    // then continues in-strip from the relabeled pose.
    expect(Array.from(split.rapidBreaks)).toEqual([0, 2]);
    const xs = Array.from(split.rapidPos.filter((_, i) => i % 3 === 0));
    expect(xs.map(v => Math.round(v))).toEqual([0, 50, 293, 310, 330]);
  });

  it("a mislengthed brk array drops the channel, never guesses alignment", () => {
    const t = buildScrubTrack(
      EMPTY,
      { ...stream([[0, 0, 0], [1, 0, 0]], { seq: [1, 2], mode: [0, 0] }),
        brk: new Uint8Array([1]) },
    )!;
    expect(t.brk).toBeUndefined();
  });
});

describe("wcs epochs on the track (review P2)", () => {
  const EVS = [
    { seq: 0, idx: 1, rotationDeg: 0, rewritten: false, g5x: [0, 0, 0, 0, 0, 0], g92: [0, 0, 0, 0, 0, 0] },
    { seq: 2, idx: 6, rotationDeg: 0, rewritten: true, g5x: [100, -50, 25, 0, 0, 0], g92: [0, 0, 0, 0, 0, 0] },
  ];
  const T = () => buildScrubTrack(
    EMPTY,
    { ...stream([[0, 0, 0], [10, 0, 0], [20, 0, 0]],
                { seq: [1, 2, 3], mode: [0, 0, 0] }),
      wcs: new Uint8Array([0, 0, 1]) },
    undefined, EVS,
  )!;

  it("merges per-point epochs and samples carry them", () => {
    const t = T();
    expect(Array.from(t.wcsEpoch!)).toEqual([0, 0, 1]);
    expect(t.wcsEvents).toBe(EVS);
    const s = freshSample();
    sampleTrack(t, 5, s);
    expect(s.wcsEpoch).toBe(0);
    sampleTrack(t, 15, s);
    expect(s.wcsEpoch).toBe(1);
    const legacy = buildScrubTrack(
      stream([[0, 0, 0], [10, 0, 0]], { seq: [1, 2] }), EMPTY)!;
    sampleTrack(legacy, 5, s);
    expect(s.wcsEpoch).toBeNull();
  });

  it("jointsForSample converts through the sample's epoch terms", () => {
    const t = T();
    const s = freshSample();
    sampleTrack(t, 15, s);           // epoch-1 segment
    const terms = [
      { ox: 0, oy: 0, oz: 0, oa: 0, ob: 0, oc: 0, tx: 0, ty: 0, tz: 0, cth: 1, sth: 0 },
      { ox: 100, oy: -50, oz: 25, oa: 0, ob: 0, oc: 0, tx: 0, ty: 0, tz: 0, cth: 1, sth: 0 },
    ];
    const j: (number | null)[] = [];
    jointsForSample(s, { g5x: [], g92: [], rotationDeg: 0 }, ["X", "Y", "Z"], j, undefined, terms);
    expect(j[0]).toBeCloseTo(s.px + 100, 5);
    expect(j[1]).toBeCloseTo(-50, 5);
    expect(j[2]).toBeCloseTo(25, 5);
    // Without the terms the live (empty) wcs applies — proves routing.
    jointsForSample(s, { g5x: [], g92: [], rotationDeg: 0 }, ["X", "Y", "Z"], j);
    expect(j[0]).toBeCloseTo(s.px, 5);
  });

  it("prependEntry stamps the entry move with epoch 0 and keeps the events", () => {
    const t = prependEntry(T(), [-5, 0, 0, 0, 0, 0]);
    expect(Array.from(t.wcsEpoch!)).toEqual([0, 0, 0, 1]);
    expect(t.wcsEvents).toBe(EVS);
  });

  it("splitTrackStreams carries per-vertex epochs on the drawn streams", () => {
    const split = splitTrackStreams(T());
    expect(Array.from(split.rapidWcs!)).toEqual([0, 0, 1]);
  });
});
