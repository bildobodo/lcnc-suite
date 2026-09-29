import { describe, it, expect } from "vitest";
import { offsetAux } from "./offsetRows";
import { canonicalIndex } from "./useAxes";

// Canonical vectors: X Y Z A B C U V W at slots 0..8.
const vec = (o: Partial<Record<string, number>>) => "XYZABCUVW".split("").map(l => o[l] ?? 0);

describe("offset auxiliary rows (operator P5/P6, Codex R22 OP22-03)", () => {
  it("canonicalIndex is the vector slot, never the visible column", () => {
    expect(["X", "z", "A", "C", "W", "Q", "XY"].map(canonicalIndex)).toEqual([0, 2, 3, 5, 8, -1, -1]);
  });

  it("reads G92 and tool by the letter's canonical slot — XYZAC, XYZBC, XZ", () => {
    const g92 = vec({ X: 1, Z: 3, A: 4, B: 5, C: 6 });
    for (const [letters, want] of [
      [["X", "Y", "Z", "A", "C"], { x: 1, y: 0, z: 3, a: 4, c: 6 }],
      [["X", "Y", "Z", "B", "C"], { x: 1, y: 0, z: 3, b: 5, c: 6 }],
      [["X", "Z"], { x: 1, z: 3 }],
    ] as const) {
      const r = offsetAux({ letters, g92, tool: vec({ C: 2 }), compZ: 0, compEnabled: false });
      expect(r.g92.values, letters.join("")).toEqual(want);
      expect(r.g92.state).toBe("active");
      const hasC = (letters as readonly string[]).includes("C");
      expect(r.tool.values[hasC ? "c" : "x"]).toBe(hasC ? 2 : 0);
    }
  });

  it("a missing, short or non-finite vector is unknown, never zero", () => {
    for (const bad of [null, undefined, [0, 0], vec({ Z: Number.NaN })]) {  // [0, 0]: short of Z
      const r = offsetAux({ letters: ["X", "Y", "Z"], g92: bad, tool: vec({}), compZ: 0, compEnabled: false });
      expect(r.g92.state, String(bad)).toBe("unknown");
      expect(r.summary).toEqual({ kind: "unknown", sources: ["G52/G92"] });
    }
  });

  it("all zero on a vector wider than the axes is none", () => {
    const r = offsetAux({ letters: ["X", "Y", "Z"], g92: vec({ B: 9 }), tool: vec({}), compZ: 0, compEnabled: false });
    expect(r.g92.state, "B is not an axis of this machine").toBe("none");
  });

  it("comp: enabled true / false / null, amount 0 and not 0", () => {
    const at = (compEnabled: boolean | null, compZ: number | null) =>
      offsetAux({ letters: ["X", "Y", "Z"], g92: vec({}), tool: vec({}), compZ, compEnabled });
    expect([at(true, 0.2).comp, at(true, 0).comp]).toEqual(["active", "active"]);
    expect(at(true, null).comp, "enabled with no amount: unknown, not in effect (Codex R23)").toBe("unknown");
    expect(at(true, Number.NaN).comp).toBe("unknown");
    expect([at(false, 0.2).comp, at(false, 0).comp]).toEqual(["none", "none"]);
    expect([at(null, 0.2).comp, at(null, 0).comp]).toEqual(["unknown", "unknown"]);
    expect(at(true, 0).compZ, "enabled at 0 shows 0").toBe(0);
    expect(at(true, null).summary).toEqual({ kind: "unknown", sources: ["comp"] });
  });

  it("the summary: none only when every source is known and nothing is in effect", () => {
    const base = { letters: ["X", "Y", "Z"], g92: vec({}), tool: vec({}), compZ: 0, compEnabled: false } as const;
    expect(offsetAux(base).summary).toEqual({ kind: "none" });
    expect(offsetAux({ ...base, compEnabled: null }).summary, "an amount of 0 with an unknown enable proves nothing")
      .toEqual({ kind: "unknown", sources: ["comp"] });
    expect(offsetAux({ ...base, tool: vec({ Z: 45.7 }) }).summary, "something in effect: the row says it").toBeNull();
    expect(offsetAux({ ...base, g92: null, tool: undefined, compEnabled: undefined }).summary)
      .toEqual({ kind: "unknown", sources: ["G52/G92", "G43", "comp"] });
  });
});
