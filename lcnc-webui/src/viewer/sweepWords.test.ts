import { describe, expect, it } from "vitest";
import { findingWords } from "./sweepWords";
import type { ClashTarget } from "./clashTargets";

const t = (o: Partial<ClashTarget> = {}): ClashTarget => ({ cum: 1, cumEnd: 1, key: "C1|a|b|0", line: 1, dist: 0, a: "a", b: "b", ...o });

describe("findingWords (step 4 plan 1a/1d)", () => {
  it("names each kind, the sum is the marks'", () => {
    const w = findingWords([t(), t({ dist: 1.5 }), t({ dist: 0, possible: true }), t({ dist: 2, touches: true }), t({ entryMove: true, entry: true })]);
    expect([w.collisions, w.entryCollisions, w.nearMisses, w.possible]).toEqual([2, 1, 1, 1]);
    expect(w.text).toBe("2 collisions · 1 collision on the entry move · 1 possible contact · 1 near miss");
    expect(w.danger).toBe(true);
  });
  it("a near miss is never a collision; near misses alone are no danger", () => {
    const w = findingWords([t({ dist: 0.5 }), t({ dist: 1 })]);
    expect([w.text, w.danger]).toEqual(["2 near misses", false]);
  });
  it("a margin entry whose contact touches later is a collision", () => {
    expect(findingWords([t({ dist: 2, touches: true })]).text).toBe("1 collision");
  });
  it("starts in contact only for a confirmed program contact at the start", () => {
    expect(findingWords([t({ atStart: true })]).startsIn).toBe(true);
    expect(findingWords([t({ atStart: true, dist: 1 })]).startsIn).toBe(false);
    expect(findingWords([t({ atStart: true, entry: true })]).startsIn).toBe(false);
    expect(findingWords([]).text).toBe("");
  });
});
