// The clash tint decides PER PAIR (operator 2026-10-06, live on haus.ngc
// on the XYZAC sim: the Y saddle and the yoke stayed in the column to the
// end of the program, but went dark on every line where another pair — the
// A drive covers re-entering — had a record of its own).
import { describe, expect, it } from "vitest";
import type { CollisionHit } from "./collision";
import { clashTintBodies } from "./clashTint";

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
  it("a near miss never glows", () => {
    expect([...clashTintBodies([hit({ line: 1, a: "t", b: "w", cum: 1, cumEnd: 1, dist: 1.5 })], 1, 1)]).toEqual([]);
  });
});
