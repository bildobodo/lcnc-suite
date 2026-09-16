// Unit tests for viewer/runWatcher.ts — the run-playhead state machine
// (W2 P5). The op-budget cases are the regression tripwire for report 6:
// a machine parked off-path must cost ZERO projection work per frame
// between re-probe ticks, and no unstrided full-track scan may run after
// the single escape transition.
import { describe, expect, it } from "vitest";
import { emptyLineIndex } from "./lineIndex";
import {
  createRunWatcher, RUN_ESCAPE_D2, REPROBE_MS, STRIDE_TARGET,
} from "./runWatcher";
import { projectOntoTrack, type ScrubTrack } from "./scrubTrack";

const WCS0 = { g5x: [], g92: [], rotationDeg: 0 };

/** Straight-line synthetic track: n points along +X, cum = x. */
function lineTrack(n: number): ScrubTrack {
  const pos = new Float32Array(n * 3);
  const abc = new Float32Array(n * 3);
  const cum = new Float32Array(n);
  const lines = new Uint32Array(n);
  const rapid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = i;
    cum[i] = i;
    lines[i] = 1 + (i >> 4);
  }
  return {
    pos, abc, cum, lines, rapid, count: n, timeBased: false,
    lineIndex: emptyLineIndex(),
  } as unknown as ScrubTrack;
}

type Call = { win: { lo: number; hi: number } | null; stride: number };

/** Delegating spy: records every projection call's window and stride. */
function spyProject(calls: Call[]): typeof projectOntoTrack {
  return (t, m, wcs, et, win, stride = 1) => {
    calls.push({ win: win ? { ...win } : null, stride });
    return projectOntoTrack(t, m, wcs, et, win, stride);
  };
}

const on = (x: number): number[] => [x, 0, 0, 0, 0, 0];
const OFF: number[] = [500, 400, 0, 0, 0, 0];   // nowhere near the line

describe("runWatcher state machine", () => {
  it("attaches via ONE full scan at run start, then windows", () => {
    const calls: Call[] = [];
    const w = createRunWatcher(spyProject(calls));
    const t = lineTrack(1000);
    const first = w.update({ track: t, machine: on(500.5), wcs: WCS0, nowMs: 0 });
    expect(first.phase).toBe("attached");
    expect(first.probed).toBe("full");
    expect(first.cum).toBeCloseTo(500.5, 4);
    calls.length = 0;
    const next = w.update({ track: t, machine: on(502), wcs: WCS0, nowMs: 33 });
    expect(next.probed).toBe("window");
    expect(next.cum).toBeCloseTo(502, 4);
    expect(calls.every(c => c.win !== null)).toBe(true);  // no full scans
  });

  it("escapes to offPath after exactly one full scan, then freezes", () => {
    const calls: Call[] = [];
    const w = createRunWatcher(spyProject(calls));
    const t = lineTrack(1000);
    w.update({ track: t, machine: on(100), wcs: WCS0, nowMs: 0 });
    const esc = w.update({ track: t, machine: OFF, wcs: WCS0, nowMs: 33 });
    expect(esc.phase).toBe("offPath");
    expect(esc.cum).toBeNull();
    expect(esc.index).toBeNull();
    // Frozen frames inside the re-probe window: zero projection calls.
    calls.length = 0;
    for (let f = 0; f < 20; f++) {
      const out = w.update({ track: t, machine: OFF, wcs: WCS0, nowMs: 66 + f * 33 });
      expect(out.probed).toBe("idle");
      expect(out.cum).toBeNull();
    }
    expect(calls.length).toBe(0);
  });

  it("re-probes at most once per REPROBE_MS and re-attaches when back on path", () => {
    const calls: Call[] = [];
    const w = createRunWatcher(spyProject(calls));
    const t = lineTrack(1000);
    w.update({ track: t, machine: on(100), wcs: WCS0, nowMs: 0 });
    w.update({ track: t, machine: OFF, wcs: WCS0, nowMs: 33 });
    // Still off at the tick: one re-probe burst, then idle again.
    calls.length = 0;
    const tick = w.update({ track: t, machine: OFF, wcs: WCS0, nowMs: 33 + REPROBE_MS });
    expect(tick.probed).toBe("reprobe");
    expect(tick.phase).toBe("offPath");
    expect(calls.length).toBeGreaterThan(0);
    calls.length = 0;
    w.update({ track: t, machine: OFF, wcs: WCS0, nowMs: 50 + REPROBE_MS });
    expect(calls.length).toBe(0);
    // Back on path at the next tick → attached at the right cum.
    const back = w.update({ track: t, machine: on(700.25), wcs: WCS0, nowMs: 40 + 2 * REPROBE_MS });
    expect(back.phase).toBe("attached");
    expect(back.cum).toBeCloseTo(700.25, 3);
  });

  it("the trusted-line hint re-attaches at the tick without a coarse scan", () => {
    const calls: Call[] = [];
    const w = createRunWatcher(spyProject(calls));
    const t = lineTrack(1000);
    w.update({ track: t, machine: on(100), wcs: WCS0, nowMs: 0 });
    w.update({ track: t, machine: OFF, wcs: WCS0, nowMs: 33 });
    calls.length = 0;
    const back = w.update({
      track: t, machine: on(300), wcs: WCS0,
      hintSpan: { start: 295, end: 305 }, nowMs: 33 + REPROBE_MS,
    });
    expect(back.phase).toBe("attached");
    expect(back.cum).toBeCloseTo(300, 3);
    expect(calls.length).toBe(1);           // the hint window alone
    expect(calls[0]!.win).not.toBeNull();
  });

  it("resets on track identity change", () => {
    const w = createRunWatcher();
    const t1 = lineTrack(100);
    const t2 = lineTrack(100);
    w.update({ track: t1, machine: OFF, wcs: WCS0, nowMs: 0 });
    expect(w.phase).toBe("offPath");
    const out = w.update({ track: t2, machine: on(50), wcs: WCS0, nowMs: 10 });
    expect(out.phase).toBe("attached");     // fresh attach on the new track
    expect(out.probed).toBe("full");
  });
});

describe("runWatcher op budget on a 200k track (report 6 tripwire)", () => {
  const N = 200_000;
  const t = lineTrack(N);

  it("attached steady state: ≤2 calls per frame, all windowed", () => {
    const calls: Call[] = [];
    const w = createRunWatcher(spyProject(calls));
    w.update({ track: t, machine: on(100_000), wcs: WCS0, nowMs: 0 });
    calls.length = 0;
    for (let f = 0; f < 10; f++) {
      w.update({ track: t, machine: on(100_000 + f), wcs: WCS0,
                 hintSpan: { start: 99_990, end: 100_020 }, nowMs: 33 * (f + 1) });
    }
    expect(calls.length).toBeLessThanOrEqual(20);
    for (const c of calls) {
      expect(c.win).not.toBeNull();
      // Windowed spans stay bounded — orders of magnitude below the track.
      expect(c.win!.hi - c.win!.lo).toBeLessThan(N / 10);
    }
  });

  it("off-path: zero calls between ticks; ticks never run an unstrided full scan", () => {
    const calls: Call[] = [];
    const w = createRunWatcher(spyProject(calls));
    w.update({ track: t, machine: on(100_000), wcs: WCS0, nowMs: 0 });
    w.update({ track: t, machine: OFF, wcs: WCS0, nowMs: 33 });   // escape: the one full scan
    calls.length = 0;
    let now = 66;
    for (let f = 0; f < 200; f++) {
      now += 33;
      w.update({ track: t, machine: OFF, wcs: WCS0, nowMs: now });
    }
    // ~6.6 s → at most 7 re-probe bursts; every full-track call is strided.
    const minStride = Math.ceil((N - 1) / STRIDE_TARGET);
    const fullCalls = calls.filter(c => c.win === null);
    expect(fullCalls.length).toBeGreaterThan(0);
    expect(fullCalls.length).toBeLessThanOrEqual(7);
    for (const c of fullCalls) expect(c.stride).toBeGreaterThanOrEqual(minStride);
    // Total probed segments across the whole 6.6 s stays far below ONE
    // wave-1 frame (which scanned all 200k every 33 ms).
    const probed = calls.reduce((s, c) => {
      const span = c.win ? Math.min(N, c.win.hi - c.win.lo) : N;
      return s + span / c.stride;
    }, 0);
    expect(probed).toBeLessThan(N);
  });

  it("re-attach lands on the exact cum through the strided path", () => {
    const w = createRunWatcher();
    w.update({ track: t, machine: on(100_000), wcs: WCS0, nowMs: 0 });
    w.update({ track: t, machine: OFF, wcs: WCS0, nowMs: 33 });
    const back = w.update({ track: t, machine: on(150_000.5), wcs: WCS0,
                            nowMs: 33 + REPROBE_MS });
    expect(back.phase).toBe("attached");
    expect(back.cum).toBeCloseTo(150_000.5, 2);
  });

  it("escape gate constant sanity", () => {
    // OFF must actually clear the gate the tests rely on.
    const d2 = 500 * 500 + 400 * 400;
    expect(d2).toBeGreaterThan(RUN_ESCAPE_D2);
  });
});
