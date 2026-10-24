// VP188-02 E2 (plan basiswechsel-last Fassung 4 3b, Codex VP193-01/R194):
// the drawn path's key — a value of every input it bakes with — and the
// scope it applies in (_pfScheduleWcsRefresh's own criterion).
import { describe, expect, it } from "vitest";
import { bakeFollowsOffsets, bakeKey, pathBehind, type BakeInputs } from "./pathBasis";

const base = (): BakeInputs => ({ file: "/nc/p.ngc", version: 10, mode: "part", g5x: [1, 2, 3], g92: [0, 0, 0],
                                  rotationDeg: 0, tool: [0, 0, 5], table: null });

describe("the bake key (VP188-02 E2 3b)", () => {
  it("equal inputs give equal keys; every input changes it", () => {
    expect(bakeKey(base())).toBe(bakeKey(base()));
    const changes: Array<Partial<BakeInputs>> = [
      { file: "/nc/q.ngc" }, { version: 11 }, { mode: "programmed" }, { g5x: [1, 2, 4] }, { g92: [0, 0, 1] },
      { rotationDeg: 15 }, { tool: [0, 0, 6] }, { tool: null }, { table: "G55:1,2,3" },
    ];
    for (const c of changes) expect(bakeKey({ ...base(), ...c }), JSON.stringify(c)).not.toBe(bakeKey(base()));
  });

  it("is a value: replacing or mutating the arrays afterwards changes no key taken before", () => {
    const g5x = [1, 2, 3];
    const key = bakeKey({ ...base(), g5x });
    g5x[2] = 99;
    expect(key).toBe(bakeKey(base()));
    expect(bakeKey({ ...base(), g5x: Float64Array.from([1, 2, 3]) })).toBe(key);   // typed or plain: the numbers
  });
});

describe("the scope: _pfScheduleWcsRefresh's criterion", () => {
  it("the part frame always; a programmed path only where its rebase can differ", () => {
    expect(bakeFollowsOffsets("part", null, 1)).toBe(true);
    expect(bakeFollowsOffsets("programmed", null, 1)).toBe(false);
    expect(bakeFollowsOffsets("programmed", [], 1)).toBe(false);
    // R193's three cases: a plain epoch of the active fixture (0), a
    // rewritten one (1), another active fixture (1)
    expect(bakeFollowsOffsets("programmed", [{ idx: 1 }], 1)).toBe(false);
    expect(bakeFollowsOffsets("programmed", [{ idx: 1, rewritten: true }], 1)).toBe(true);
    expect(bakeFollowsOffsets("programmed", [{ idx: 1 }], 2)).toBe(true);
    expect(bakeFollowsOffsets("programmed", [{ idx: 1 }, { idx: 2 }], 1)).toBe(true);
    expect(bakeFollowsOffsets(null, [{ idx: 1 }], 1)).toBe(false);
  });

  it("behind: in scope and not the wanted key", () => {
    expect(pathBehind("a", "a")).toBe(false);
    expect(pathBehind("a", "b")).toBe(true);
    expect(pathBehind(null, "b")).toBe(true);     // nothing drawn yet
    expect(pathBehind("a", null)).toBe(false);    // out of scope
    expect(pathBehind(null, null)).toBe(false);
  });
});
