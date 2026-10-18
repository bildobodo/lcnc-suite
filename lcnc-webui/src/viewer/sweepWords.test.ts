import { describe, expect, it } from "vitest";
import { wordsOfCounts, type FindingCounts } from "./sweepWords";

const c = (o: Partial<FindingCounts> = {}): FindingCounts =>
  ({ collisions: 0, entryCollisions: 0, nearMisses: 0, possible: 0, startsIn: false, ...o });

describe("wordsOfCounts (step 4 plan 1a/1d)", () => {
  it("names each kind, the sum is the marks'", () => {
    const w = wordsOfCounts(c({ collisions: 2, entryCollisions: 1, nearMisses: 1, possible: 1 }));
    expect([w.collisions, w.entryCollisions, w.nearMisses, w.possible]).toEqual([2, 1, 1, 1]);
    expect(w.text).toBe("2 collisions · 1 collision on the entry move · 1 possible contact · 1 near miss");
    expect(w.danger).toBe(true);
  });
  it("a near miss is never a collision; near misses alone are no danger", () => {
    const w = wordsOfCounts(c({ nearMisses: 2 }));
    expect([w.text, w.danger]).toEqual(["2 near misses", false]);
  });
  it("an entry collision alone is a danger; a start in contact passes through; nothing is no words", () => {
    expect(wordsOfCounts(c({ entryCollisions: 1 })).danger).toBe(true);
    expect(wordsOfCounts(c({ collisions: 1, startsIn: true })).startsIn).toBe(true);
    expect(wordsOfCounts(c()).text).toBe("");
  });
});
