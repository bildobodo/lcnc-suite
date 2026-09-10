// sweepPump — the worker's slice driver for the sweep iterator, with a fake
// iterator and a fake clock: slices end on time, resume where they left off,
// a cancel aborts the iterator (which still runs its epilogue) and discards
// the result, and a completed run hands the result back.
import { describe, expect, it } from "vitest";
import { runSweepSlice, type SweepIter } from "./sweepPump";
import type { CollisionResult } from "./collision";

const RESULT = { hits: [], samples: 7 } as unknown as CollisionResult;

/** A sweep stand-in: `n` checkpoints, `tick` ms of "work" before each. */
function fake(n: number, clock: { t: number }, tick: number, log: string[]): SweepIter {
  return (function* (): SweepIter {
    for (let i = 0; i < n; i++) {
      clock.t += tick;
      const abort = yield i / n;
      if (abort === true) { log.push(`abort@${i}`); break; }
    }
    clock.t += tick;
    yield 1;            // the epilogue's final progress
    log.push("returned");
    return RESULT;
  })();
}

describe("runSweepSlice", () => {
  it("ends a slice on the clock and resumes at the next checkpoint", () => {
    const clock = { t: 0 }, log: string[] = [];
    const it = fake(10, clock, 10, log);
    const now = () => clock.t;
    const s1 = runSweepSlice(it, 25, () => false, now);
    expect(s1.done).toBe(false);
    expect(s1.checkpoints).toBe(3);          // 10, 20, 30 ms — the third crosses 25
    expect(s1.progress).toBeCloseTo(0.2, 6);
    const s2 = runSweepSlice(it, 25, () => false, now);
    expect(s2.done).toBe(false);
    expect(s2.checkpoints).toBe(3);
    expect(s2.progress).toBeCloseTo(0.5, 6);
    let last = s2;
    for (let g = 0; g < 10 && !last.done; g++) last = runSweepSlice(it, 25, () => false, now);
    expect(last.done).toBe(true);
    expect(last.cancelled).toBe(false);
    expect(last.result).toBe(RESULT);
    expect(last.progress).toBe(1);
    expect(log).toEqual(["returned"]);
  });

  it("a cancel aborts at the next checkpoint, drains the epilogue, and discards the result", () => {
    const clock = { t: 0 }, log: string[] = [];
    const it = fake(10, clock, 10, log);
    const now = () => clock.t;
    runSweepSlice(it, 25, () => false, now);
    const s = runSweepSlice(it, 25, () => true, now);
    expect(s.done).toBe(true);
    expect(s.cancelled).toBe(true);
    expect(s.result).toBeNull();
    // The first slice left the iterator suspended at checkpoint 2; the cancel
    // resumes THAT yield with abort=true.
    expect(log).toEqual(["abort@2", "returned"]);   // the iterator saw the abort and still finished cleanly
    expect(it.next().done).toBe(true);              // nothing left to resume
  });

  it("a sweep shorter than one slice completes in that slice", () => {
    const clock = { t: 0 }, log: string[] = [];
    const s = runSweepSlice(fake(2, clock, 1, log), 1000, () => false, () => clock.t);
    expect(s.done).toBe(true);
    expect(s.result).toBe(RESULT);
    expect(s.checkpoints).toBe(3);   // 0/2, 1/2, and the epilogue's 1
  });
});
