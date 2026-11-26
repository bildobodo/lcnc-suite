// The bound evidence of a library shape and what it decides (P6-c plan v8
// §1.2–1.4, Codex R461/R465/R477 MT477-02..04). Pure tables: a reply, then rows.
import { describe, expect, it } from "vitest";
import { FormLibrary, type ToolBinding } from "./toolLibrary";
import {
  NO_DIAMETER, NO_LIBRARY_SHAPE, PAIR_EPS, ROW_NOT_CONFIRMED, SEEN_MAX, SHAPE_NOT_READ, TABLE_CHANGED, ToolShapeRecord,
  decideSet, refineSet, sameShapes, toolsOf, visibleDecision, type ProvenRead, type ShapeDecision, type ShapeSet, type ToolRowRaw,
} from "./toolShapeRecord";
import { runToEnd } from "./viewer/steps";

const B = (over: Partial<ToolBinding> = {}): ToolBinding => ({ path: "/t.tbl", instance: "11:1", units: 1, rev: "lib1", ...over });
const META: Record<number, any> = { 1: { type: "endmill", oal: 60 }, 2: { native_profile: [[0, 0], [3, 0], [3, 40]] }, 3: { type: "" },
  4: { native_mesh: { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 5]], triangles: [[0, 1, 2]] } },
  5: { native_profile: Array.from({ length: 4096 }, () => [1, 1]) }, 6: { type: "ball" } };
function library(binding: ToolBinding | null, Ts = Object.keys(META).map(Number), settle = true): FormLibrary {
  const lib = new FormLibrary(binding, Ts.map(T => ({ T, ...META[T] })), binding?.units ?? 1);
  if (settle) runToEnd(lib.normalise());
  return lib;
}
const row = (T: number, D = 6, Z = 50): ToolRowRaw => ({ T, D, Z });
const ROWS = [row(1), row(2), row(3), row(4), row(5), row(6)];
const read = (over: Partial<ProvenRead> = {}): ProvenRead => {
  const binding = over.binding === undefined ? B() : over.binding;
  return { binding, library: library(binding), rows: ROWS, proven: new Set(ROWS.map(r => r.T)), missing: [], ...over };
};
const NONE = new Set<number>();
const rec = (...reads: ProvenRead[]) => { const r = new ToolShapeRecord(); for (const x of reads) r.apply(x, NONE); return r; };
const why = (r: ToolShapeRecord, x: ToolRowRaw) => { const d = r.decide(x); return d && (d.why ?? d.body); };

describe("what pairs", () => {
  it("a proven row pairs its form: shape, envelope for a mesh", () => {
    const r = rec(read());
    expect([why(r, row(1)), why(r, row(2)), why(r, row(4))]).toEqual(["shape", "shape", "envelope"]);
    expect(r.decide(row(1))).toMatchObject({ body: "shape", why: null, warns: false, binding: B() });
    expect(Object.isFrozen(r.decide(row(1)))).toBe(true);
  });
  it("D and Z both, within the drift's 1e-4 — the memory's digits against the file's", () => {
    const r = rec(read({ rows: [row(1, 1.875, 63.212155)], proven: new Set([1]) }));
    expect(why(r, row(1, 1.875, 63.2121551))).toBe("shape");
    expect(why(r, row(1, 1.875, 63.212155 + 0.9 * PAIR_EPS))).toBe("shape");
    expect(why(r, row(1, 1.875, 63.212155 + 1.1 * PAIR_EPS))).toBe(TABLE_CHANGED);
    expect(why(r, row(1, 1.875 + 1.1 * PAIR_EPS, 63.212155))).toBe(TABLE_CHANGED);
  });
  it("Z with its sign: no magnitude, no stub diameter", () => {
    const r = rec(read({ rows: [row(1, 6, -50)], proven: new Set([1]) }));
    expect([why(r, row(1, 6, -50)), why(r, row(1, 6, 50))]).toEqual(["shape", TABLE_CHANGED]);
    const no = rec(read({ rows: [row(1, 0, 50), row(2, 0, 50), row(4, 0, 50)], proven: new Set([1, 2, 4]) }));
    expect([why(no, row(1, 0, 50)), why(no, row(2, 0, 50)), why(no, row(4, 0, 50))]).toEqual([NO_DIAMETER, "shape", "envelope"]);
  });
  it("an unproven row is no evidence", () => {
    expect(why(rec(read({ proven: new Set([2]) })), row(1))).toBe(ROW_NOT_CONFIRMED);
    expect(why(rec(read({ proven: null })), row(1))).toBe(ROW_NOT_CONFIRMED);       // unchecked
  });
  it("T 0 and none are no tool; a row with no finite value is no evidence", () => {
    const r = rec(read({ rows: [row(0), row(1, NaN, 50), row(2, 6, NaN)], proven: new Set([0, 1, 2]) }));
    expect([r.decide(row(0)), r.decide(row(-1)), r.keys]).toEqual([null, null, []]);
  });
});

describe("why a tool is checked as its table Ø", () => {
  it("no library shape only when the absence is proven — and that warns of nothing", () => {
    expect(rec(read()).decide(row(3))).toMatchObject({ why: NO_LIBRARY_SHAPE, warns: false });
  });
  it("before the first read, and while a form is being made: not read, and it warns", () => {
    const none = new ToolShapeRecord();
    expect(none.decide(row(3))).toMatchObject({ body: "table", why: SHAPE_NOT_READ, warns: true });
    const pending = new ToolShapeRecord();
    pending.apply(read({ library: library(B(), [1, 3], false) }), NONE);
    expect([why(pending, row(1)), why(pending, row(3))]).toEqual([SHAPE_NOT_READ, SHAPE_NOT_READ]);
  });
  it("a reply without a library (or a table, or a revision) leaves nothing to pair by", () => {
    const r = rec(read(), read({ binding: null }));
    expect([r.binding, r.keys, why(r, row(1)), why(r, row(3))]).toEqual([null, [], SHAPE_NOT_READ, SHAPE_NOT_READ]);
    expect(why(rec(read({ library: null })), row(1))).toBe(SHAPE_NOT_READ);
  });
  it("a refused form is what it is, never 'no library shape'", () => {
    expect(rec(read()).decide(row(5))).toMatchObject({ body: "table", why: "shape too detailed", warns: true });
  });
  it("a row of another read: changed since the preview; a tool with no record of the library: not read (Codex R492 MT-I50)", () => {
    const r = rec(read());
    expect([why(r, row(1, 6, 51)), why(r, row(9))]).toEqual([TABLE_CHANGED, SHAPE_NOT_READ]);
    expect(r.decide(row(9))).toMatchObject({ body: "table", warns: true });
    // apart from it: a proven absence, a refusal, a present form not paired
    expect([why(r, row(3)), why(r, row(5)), why(r, row(2, 6, 51))]).toEqual([NO_LIBRARY_SHAPE, "shape too detailed", TABLE_CHANGED]);
    const unproven = rec(read({ proven: new Set([1]) }));
    expect([why(unproven, row(2)), why(unproven, row(9))]).toEqual([ROW_NOT_CONFIRMED, SHAPE_NOT_READ]);
  });
  it("the newest read being partial on a tool leaves its seen row: it still pairs", () => {
    const r = rec(read(), read({ proven: new Set([2]) }));
    expect([why(r, row(1)), why(r, row(1, 6, 51))]).toEqual(["shape", ROW_NOT_CONFIRMED]);
  });
});

describe("another binding is another evidence", () => {
  for (const [name, over] of [["revision", { rev: "lib2" }], ["instance", { instance: "12:9" }], ["table", { path: "/u.tbl" }], ["units", { units: 1 / 25.4 }]] as const)
    it(name, () => {
      const b = B(over), r = rec(read(), read({ binding: b, library: library(b), rows: [row(1, 6, 51)], proven: new Set([1]) }));
      expect([r.rowsOf(1), why(r, row(1)), why(r, row(1, 6, 51))]).toEqual([[row(1, 6, 51)], TABLE_CHANGED, "shape"]);
    });
  it("a closed connection or other units clear it", () => {
    const r = rec(read());
    r.clear();
    expect([r.binding, r.keys, why(r, row(1))]).toEqual([null, [], SHAPE_NOT_READ]);
  });
});

describe("the seen rows are bounded", () => {
  const one = (z: number, over: Partial<ProvenRead> = {}) => read({ rows: [row(1, 6, z)], proven: new Set([1]), ...over });
  it("the newest eight, exact values, newest proof first; a re-proof moves up", () => {
    const r = rec(...Array.from({ length: 12 }, (_, i) => one(50 + i)));
    expect(r.rowsOf(1).map(x => x.Z)).toEqual([61, 60, 59, 58, 57, 56, 55, 54]);
    expect(r.rowsOf(1).length).toBe(SEEN_MAX);
    r.apply(one(56), NONE);
    expect(r.rowsOf(1).map(x => x.Z)).toEqual([56, 61, 60, 59, 58, 57, 55, 54]);
    expect(why(r, row(1, 6, 53))).toBe(TABLE_CHANGED);             // the ninth is gone: honestly unpaired
  });
  it("near values are not merged: a chain never drifts", () => {
    const r = rec(one(50), one(50 + 0.9 * PAIR_EPS), one(50 + 1.8 * PAIR_EPS));
    expect(r.rowsOf(1).length).toBe(3);
    expect([why(r, row(1, 6, 50 + 2.7 * PAIR_EPS)), why(r, row(1, 6, 50 + 2.9 * PAIR_EPS))]).toEqual(["shape", TABLE_CHANGED]);
  });
  it("five tables with other tools: only the tools the table, LinuxCNC or a held decision names", () => {
    const r = new ToolShapeRecord(), needed = new Set([1]);
    for (let i = 0; i < 5; i++) r.apply(read({ rows: [row(2 * i + 1), row(2 * i + 2)], proven: new Set([2 * i + 1, 2 * i + 2]), missing: i === 4 ? [8] : [] }), needed);
    expect(r.keys).toEqual([1, 8, 9, 10]);
  });
  it("partial frees by the same rule; an unchecked reply neither adds nor frees", () => {
    const r = rec(read({ rows: [row(1), row(2)], proven: new Set([1, 2]) }));
    r.apply(read({ rows: [row(4)], proven: null }), NONE);
    expect(r.keys).toEqual([1, 2]);
    r.apply(read({ rows: [row(1)], proven: new Set(), missing: [] }), NONE);
    expect(r.keys).toEqual([1]);
  });
});

describe("decisions and their owners", () => {
  const set = (r: ToolShapeRecord, program = [row(1), row(4)], base: ToolRowRaw | null = row(6)) => decideSet(r, program, base);
  const never = () => false, always = () => true;

  it("a set is one decision a tool, frozen, with the tools it needs", () => {
    const s = set(rec(read()), [row(1), row(1, 6, 51), row(4)]);
    expect([[...s.tools.keys()], s.tools.get(1)!.body, s.base!.T, toolsOf(s), toolsOf(null)]).toEqual([[1, 4], "shape", 6, [1, 4, 6], []]);
  });
  it("eviction and later proofs change no set that is held", () => {
    const r = rec(read()), held = set(r);
    for (let i = 0; i < 10; i++) r.apply(read({ rows: [row(1, 6, 60 + i)], proven: new Set([1]) }), NONE);
    expect([held.tools.get(1)!.body, why(r, row(1))]).toEqual(["shape", TABLE_CHANGED]);
    expect(sameShapes(held, { state: "known", set: set(r) }, never)).toBe(true);
  });
  it("the visible decision is the shown check's; without one the publication's own", () => {
    const shown = set(new ToolShapeRecord()), own = set(rec(read()));
    expect(visibleDecision(shown, own, 1)).toMatchObject({ body: "table", why: SHAPE_NOT_READ });
    expect(visibleDecision(null, own, 1)!.body).toBe("shape");
    expect(visibleDecision(shown, own, 99)).toBeNull();
    // a check's gap is the check's: never filled from the publication
    expect(visibleDecision(set(rec(read()), [row(4)]), own, 1)).toBeNull();
    expect(visibleDecision(null, own, 6)!.T).toBe(6);                // the base tool
  });
  it("a publication's own decisions are refined, kept through a lost connection, never un-paired by a thinner read", () => {
    const r = new ToolShapeRecord(), a = set(r);
    expect(a.tools.get(1)!.why).toBe(SHAPE_NOT_READ);
    r.apply(read(), NONE);
    const b = refineSet(a, set(r));
    expect(b.tools.get(1)!.body).toBe("shape");
    for (let i = 0; i < 10; i++) r.apply(read({ rows: [row(1, 6, 60 + i)], proven: new Set([1]) }), NONE);
    expect([why(r, row(1)), refineSet(b, set(r)).tools.get(1)!.body]).toEqual([TABLE_CHANGED, "shape"]);
    const closed = new ToolShapeRecord();
    expect(refineSet(b, set(closed))).toBe(b);
    const other = rec(read({ binding: B({ rev: "lib2" }), library: library(B({ rev: "lib2" })), rows: [row(1, 6, 70)], proven: new Set([1]) }));
    expect(refineSet(b, set(other)).tools.get(1)!.why).toBe(TABLE_CHANGED);
  });

  describe("is a held set still what a check would be built from?", () => {
    const held = set(rec(read()));
    const lib2 = B({ rev: "lib2" });
    const live2 = set(rec(read({ binding: lib2, library: library(lib2) })));
    it("not read is no statement: nothing changed", () => {
      expect(sameShapes(held, { state: "not-read" }, never)).toBe(true);
      expect(sameShapes(held, { state: "known", set: set(new ToolShapeRecord()) }, never)).toBe(true);
    });
    it("a KNOWN change of units, table or instance ends it without any read", () => {
      for (const now of [{ units: 1 / 25.4 }, { path: "/u.tbl" }, { instance: "12:9" }])
        expect(sameShapes(held, { state: "known", ...now, set: null }, always)).toBe(false);
      expect(sameShapes(held, { state: "known", units: 1, path: "/t.tbl", instance: "11:1", set: null }, never)).toBe(true);
    });
    it("the same library: only a tool that could not be paired and now can", () => {
      const late = set(rec(read()), [row(1)], null), before = set(rec(read({ proven: new Set([2]) })), [row(1)], null);
      expect(before.tools.get(1)!.why).toBe(ROW_NOT_CONFIRMED);
      expect(sameShapes(before, { state: "known", set: late }, never)).toBe(false);
      expect(sameShapes(late, { state: "known", set: before }, never)).toBe(true);
    });
    it("another library: by the bodies' exact numbers", () => {
      expect(sameShapes(held, { state: "known", set: live2 }, always)).toBe(true);
      expect(sameShapes(held, { state: "known", set: live2 }, never)).toBe(false);
      const thinner: ShapeSet = { ...live2, tools: new Map([...live2.tools].map(([T, d]): [number, ShapeDecision] => [T, { ...d, body: "table" }])) };
      expect(sameShapes(held, { state: "known", set: thinner }, always)).toBe(false);
    });
  });
});
