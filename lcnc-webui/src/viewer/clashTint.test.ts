// The clash tint decides PER PAIR (operator 2026-10-06, live on haus.ngc
// on the XYZAC sim: the Y saddle and the yoke stayed in the column to the
// end of the program, but went dark on every line where another pair — the
// A drive covers re-entering — had a record of its own).
import { describe, expect, it } from "vitest";
import type { CollisionHit, CollisionResult } from "./collision";
import { clashTintBodies } from "./clashTint";
import { mergeEntryResult } from "./sweepMerge";

const hit = (h: Partial<CollisionHit> & Pick<CollisionHit, "line" | "a" | "b" | "cum" | "cumEnd">): CollisionHit =>
  ({ dist: 0, rapid: false, ...h });

// The haus.ngc shape: y_saddle meets the column at L17 and never leaves
// (records L17–L31, then the cap: its span reaches the track end); the A
// drive covers touch and leave again and again (a record far down the
// program, on L69736).
const HITS: CollisionHit[] = [
  hit({ line: 17, a: "rear_column", b: "y_saddle", cum: 1, cumEnd: 2, intervals: [[1, 2]], spanEndLine: 203539, spanCumEnd: 15960 }),
  ...Array.from({ length: 14 }, (_, i) => hit({ line: 18 + i, a: "rear_column", b: "y_saddle", cum: 2 + i * 0.3, cumEnd: 2.3 + i * 0.3, intervals: [[2 + i * 0.3, 2.3 + i * 0.3]], continuation: 17 })),
  hit({ line: 69736, a: "rear_column", b: "a_drive_covers", cum: 4600, cumEnd: 4664, intervals: [[4600, 4664]] }),
];

describe("the clash tint", () => {
  it("a contact that never separated glows on a line where ANOTHER pair has a record", () => {
    const on = clashTintBodies(HITS, 69736, 4620);
    expect([...on].sort(), "both pairs: the drive covers by their record, the saddle by its span")
      .toEqual(["a_drive_covers", "rear_column", "y_saddle"]);
  });
  it("a line without any record: the span alone", () => {
    expect([...clashTintBodies(HITS, 100000, 9000)].sort()).toEqual(["rear_column", "y_saddle"]);
  });
  it("a pair with a record on the line decides by its intervals, never its span: a verified gap stays dark", () => {
    const gap: CollisionHit[] = [
      hit({ line: 5, a: "t", b: "w", cum: 10, cumEnd: 30, intervals: [[10, 12], [20, 30]] }),
      hit({ line: 3, a: "t", b: "w", cum: 1, cumEnd: 2, intervals: [[1, 2]], spanEndLine: 5, spanCumEnd: 12 }),
    ];
    expect([...clashTintBodies(gap, 5, 15)], "inside line 5's gap").toEqual([]);
    expect([...clashTintBodies(gap, 5, 25)].sort()).toEqual(["t", "w"]);
  });
  it("the entry move's onset glows from its start: cum 0 on the raw line 0 (no line match)", () => {
    const entry = [hit({ line: 17, a: "rear_column", b: "y_saddle", cum: 0, cumEnd: 5, intervals: [[0, 5]], entry: true })];
    expect([...clashTintBodies(entry, 0, 0.5)].sort()).toEqual(["rear_column", "y_saddle"]);
  });
  it("a near-miss record of the pair on the line is proximity: its span does not glow there", () => {
    const near = [
      hit({ line: 17, a: "p", b: "q", cum: 1, cumEnd: 2, intervals: [[1, 2]], spanEndLine: 90, spanCumEnd: 1000 }),
      hit({ line: 50, a: "p", b: "q", cum: 505, cumEnd: 505, dist: 1.5, continuation: 17 }),
    ];
    expect([...clashTintBodies(near, 50, 505)], "line 50: the pair only near").toEqual([]);
    expect([...clashTintBodies(near, 60, 600)].sort(), "line 60, no record: the span").toEqual(["p", "q"]);
  });
  it("a near miss never glows", () => {
    expect([...clashTintBodies([hit({ line: 1, a: "t", b: "w", cum: 1, cumEnd: 1, dist: 1.5 })], 1, 1)]).toEqual([]);
  });
  it("a carried first interval is contact: it glows, the gap after it stays dark", () => {
    const carried: CollisionHit[] = [
      hit({ line: 3, a: "t", b: "w", cum: 1, cumEnd: 2, intervals: [[1, 2]], spanEndLine: 5, spanCumEnd: 12 }),
      hit({ line: 5, a: "t", b: "w", cum: 10, cumEnd: 30, intervals: [[10, 12], [20, 30]], carried: true }),
    ];
    expect([...clashTintBodies(carried, 5, 11)].sort(), "the carried contact").toEqual(["t", "w"]);
    expect([...clashTintBodies(carried, 5, 15)], "the verified gap").toEqual([]);
    expect([...clashTintBodies(carried, 5, 25)].sort(), "the re-entry").toEqual(["t", "w"]);
  });
});

// Through the entry merge (`sweepMerge.ts`): every cum on the ENTRY track's
// axis, the entry onset holding the program contact it runs into.
describe("the clash tint after the entry merge", () => {
  const SHIFT = 50;
  const result = (hits: CollisionHit[]): CollisionResult => ({
    hits, staticContacts: [], samples: 0, coarsened: false, uncertified: null,
    pairCount: 1, pairsPrescreened: 0, bvhMs: 0, sweepMs: 0, truncated: null,
  });
  const entry = result([hit({ line: 17, a: "column", b: "saddle", cum: 30, cumEnd: SHIFT, intervals: [[30, SHIFT]] })]);
  it("one contact from the entry move through the program: the entry, its line and the lines after glow", () => {
    const base = result([
      hit({ line: 17, a: "column", b: "saddle", cum: 0, cumEnd: 4, intervals: [[0, 4]], spanEndLine: 900, spanCumEnd: 400 }),
      hit({ line: 18, a: "column", b: "saddle", cum: 4, cumEnd: 6, intervals: [[4, 6]], continuation: 17 }),
    ]);
    const m = mergeEntryResult(entry, base, SHIFT, 500);
    expect([...clashTintBodies(m.hits, 0, 40)].sort(), "the entry move (raw line 0)").toEqual(["column", "saddle"]);
    expect([...clashTintBodies(m.hits, 17, SHIFT + 2)].sort(), "the program's first line").toEqual(["column", "saddle"]);
    expect([...clashTintBodies(m.hits, 400, SHIFT + 300)].sort(), "a line without a record").toEqual(["column", "saddle"]);
    expect([...clashTintBodies(m.hits, 950, SHIFT + 420)], "past the contact's end").toEqual([]);
    expect([...clashTintBodies(m.hits, 0, 10)], "the entry before its contact").toEqual([]);
  });
  it("the program contact separates on its first line: the gap stays dark, its re-entry glows", () => {
    const base = result([
      hit({ line: 17, a: "column", b: "saddle", cum: 0, cumEnd: 9, intervals: [[0, 3], [6, 9]] }),
    ]);
    const m = mergeEntryResult(entry, base, SHIFT, 500);
    expect(m.hits.find(h => !h.entry)?.carried, "the merge marks it carried").toBe(true);
    expect([...clashTintBodies(m.hits, 17, SHIFT + 1)].sort(), "the carried contact").toEqual(["column", "saddle"]);
    expect([...clashTintBodies(m.hits, 17, SHIFT + 4.5)], "the gap").toEqual([]);
    expect([...clashTintBodies(m.hits, 17, SHIFT + 7)].sort(), "the re-entry").toEqual(["column", "saddle"]);
  });
});
