import { describe, expect, it } from "vitest";
import {
  ContactStore, EP_AT_START, EP_POSSIBLE, EP_RAPID, GAP_TOOL_UNKNOWN, GAP_UNDECIDABLE, IV_CONTINUES_CUT, IV_ENDED_AT_GAP, IV_POSSIBLE,
  NONE, ORIGIN_BOUNDARY,
} from "./contactStore";
import {
  T_AT_START, T_ENTRY, T_ENTRY_MOVE, T_NEAR, T_OPEN, T_POSSIBLE, T_RAPID, T_REENTRY, buildContactView, contactBands, findKey,
  indexAfter, indexBefore, lineMark, targetAt, targetKey, targetWindow, tintAt, viewCounts, type ContactSource,
} from "./contactView";
import { findingWords } from "./sweepWords";

interface Ep { pair: number; flags?: number; onset?: number; end?: number; close?: [number, number]; ivs?: Array<[number, number, number?]> }
/** A store with the given episodes (each with its intervals [enter, exit, flags]; NaN = open). */
function store(eps: Ep[], gaps: Array<[number, number, number, number]> = []): ContactStore {
  const s = new ContactStore(1, 0);
  const ord = new Map<number, number>();
  for (const e of eps) {
    const o = ord.get(e.pair) ?? 0; ord.set(e.pair, o + 1);
    const first = e.ivs?.[0]?.[0] ?? e.close?.[0] ?? 0;
    const ep = s.episodes.append({ pair: e.pair, ordinal: o, flags: e.flags ?? 0, onset: e.onset ?? first, end: e.end ?? NaN,
      closeAt: e.close?.[0] ?? first, closeDist: e.close?.[1] ?? 0, firstIv: NONE, ivCount: 0 });
    let last = -1;
    for (const [a, b, f] of e.ivs ?? []) {
      const iv = s.intervals.append({ episode: ep, enter: a, exit: b, flags: f ?? 0, next: NONE, witness: a, freeAt: NaN });
      if (last < 0) s.episodes.set(ep, "firstIv", iv); else s.intervals.set(last, "next", iv);
      s.episodes.set(ep, "ivCount", s.episodes.get(ep, "ivCount") + 1);
      last = iv;
    }
  }
  for (const [pair, start, end, reason] of gaps) s.gaps.append({ pair, start, end, reason });
  return s;
}
const names = (pair: number) => ({ a: `t${pair}`, b: `w${pair}` });
const src = (st: ContactStore, o: Partial<ContactSource> = {}): ContactSource => ({ stores: [st], at: c => c, ...o });
const lineAt = (pos: number) => Math.floor(pos) + 1;

describe("the target index (plan 4.1)", () => {
  it("an interval at its entry, a near miss at its closest approach, sorted; re-entry, possible, at start, rapid", () => {
    const st = store([
      { pair: 1, flags: EP_AT_START | EP_RAPID, ivs: [[0, 2], [5, 6]] },
      { pair: 2, close: [3.5, 1.2] },
      { pair: 3, flags: EP_POSSIBLE, close: [4, 0.5] },
      { pair: 4, ivs: [[7, 8, IV_POSSIBLE]] },
    ]);
    const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 10 });
    expect(Array.from(v.pos)).toEqual([0, 3.5, 4, 5, 7]);
    expect(Array.from(v.kind)).toEqual([T_AT_START | T_RAPID, T_NEAR, T_NEAR | T_POSSIBLE, T_REENTRY | T_RAPID, T_POSSIBLE]);
    expect(viewCounts(v)).toEqual({ collisions: 2, entryCollisions: 0, nearMisses: 1, possible: 2, startsIn: true });
    // the same kinds the words count from objects
    const objs = Array.from({ length: v.n }, (_, i) => targetAt(v, i, lineAt));
    expect(findingWords(objs).text).toBe("2 collisions · 2 possible contacts · 1 near miss");
    expect(objs[1]).toMatchObject({ a: "t2", b: "w2", line: 4, cum: 3.5, cumEnd: 3.5 });
    expect(objs[1]!.dist).toBeCloseTo(1.2, 6);
  });

  it("keys are the identity (origin, pair, episode number, interval number), stable as the tables grow", () => {
    const st = store([{ pair: 1, ivs: [[0, 1], [2, 3]] }, { pair: 1, close: [5, 1] }]);
    const keys = (s: ContactStore) => { const v = buildContactView({ sources: [src(s)], pairName: names, coverage: 10 }); return Array.from({ length: v.n }, (_, i) => targetKey(v, i)); };
    expect(keys(st)).toEqual(["C1|0|0", "C1|0|1", "C1|1|n"]);
    st.episodes.append({ pair: 1, ordinal: 2, onset: 0.5, end: 0.6, closeAt: 0.5, closeDist: 1, firstIv: NONE });
    expect(keys(st), "a new row earlier on the axis adds a key, renames none").toEqual(["C1|0|0", "C1|2|n", "C1|0|1", "C1|1|n"]);
  });

  it("a boundary contact and a later rapid part of a cutting contact are no findings of their own", () => {
    const st = store([
      { pair: 1, flags: ORIGIN_BOUNDARY, ivs: [[0, 1]] },
      { pair: 2, ivs: [[2, 3], [4, 5, IV_CONTINUES_CUT]] },
    ]);
    const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 10 });
    expect(Array.from(v.pos)).toEqual([2]);
    expect(Array.from(v.touch.get(2)!), "both rapid parts touch").toEqual([2, 3, 4, 5]);
  });

  it("the entry move: its findings keyed E; on the entry move itself before its end; a joined base interval counted once, reaching the base exit", () => {
    // the entry track: the entry move (0..10) and the bound beginning (10..15);
    // the base is checked from its first point on, which lies at 15
    const entry = store([{ pair: 1, ivs: [[3, NaN]] }, { pair: 2, ivs: [[12, 13]] }]);
    const base = store([{ pair: 1, ivs: [[0, 4], [6, 7]] }]);
    const v = buildContactView({
      sources: [src(entry, { entry: true, entryEnd: 10, coverage: 15 }), src(base, { at: c => c + 15 })],
      pairName: names, coverage: 100,
      joins: [{ entrySrc: 0, baseSrc: 1, entryShard: 0, baseShard: 0, joins: new Map([[0, 0]]) }],
    });
    expect(Array.from(v.pos)).toEqual([3, 12, 21]);
    expect(v.end[0], "the entry contact reaches the base interval's exit").toBe(19);
    expect(v.kind[0]! & (T_ENTRY | T_ENTRY_MOVE | T_OPEN), "joined: not open").toBe(T_ENTRY | T_ENTRY_MOVE);
    expect(v.kind[1]! & (T_ENTRY | T_ENTRY_MOVE), "past the entry move: the bound beginning").toBe(T_ENTRY);
    expect([targetKey(v, 0), targetKey(v, 2)]).toEqual(["E1|0|0", "C1|0|1"]);
    expect(viewCounts(v)).toMatchObject({ collisions: 2, entryCollisions: 1 });
  });

  it("an open interval runs to the coverage; one ended at an unknown tool to its gap, never through it", () => {
    const st = store([{ pair: 1, ivs: [[2, NaN]] }, { pair: 2, ivs: [[1, NaN, IV_ENDED_AT_GAP]] }], [[2, 3, 6, GAP_TOOL_UNKNOWN]]);
    const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 8 });
    expect([v.pos[0], v.end[0], v.kind[0]! & T_OPEN]).toEqual([1, 3, 0]);
    expect([v.pos[1], v.end[1], v.kind[1]! & T_OPEN]).toEqual([2, 8, T_OPEN]);
  });
});

describe("navigation on the index (findingNav's rule)", () => {
  const st = store([{ pair: 1, ivs: [[1, 2]] }, { pair: 2, ivs: [[1.0005, 1.0007]] }, { pair: 3, ivs: [[5, 6]] }]);
  const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 10 });
  it("next by position lands past s; by key steps from the one shown; wraps", () => {
    expect(indexAfter(v, 0, null)).toBe(0);
    expect(indexAfter(v, 3, null)).toBe(2);
    expect(indexAfter(v, 7, null), "wraps").toBe(0);
    expect(indexAfter(v, 1.0003, null), "just past a start, before where its jump samples: that one").toBe(0);
    // two findings 0.5 ms apart: the shown one by key, the next is the other
    const s = 1 + 1e-3 * 0.5;
    expect(indexAfter(v, s, { key: targetKey(v, 0), pos: s })).toBe(1);
    expect(indexBefore(v, 5.5, null)).toBe(2);
    expect(indexBefore(v, 4, null)).toBe(1);
    expect(indexBefore(v, 0.5, null), "wraps").toBe(2);
    expect(findKey(v, targetKey(v, 2), 5)).toBe(2);
  });
  it("a window of at most max around its centre, saying how many lie before and after", () => {
    const w = targetWindow(v, 2, 2, lineAt);
    expect([w.first, w.targets.length, w.before, w.after]).toEqual([1, 2, 1, 0]);
  });
});

describe("tint, marks and bands (plan 4.2, 4.3)", () => {
  it("the tint glows a pair inside its touch stretch, dark in its gap, per pair", () => {
    const st = store([{ pair: 1, ivs: [[0, NaN]] }, { pair: 2, ivs: [[3, 4]] }], [[1, 2, 2.5, GAP_UNDECIDABLE]]);
    const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 6 });
    expect([...tintAt(v, 1)].sort()).toEqual(["t1", "w1"]);
    expect([...tintAt(v, 2.25)], "the gap: dark").toEqual([]);
    expect([...tintAt(v, 3.5)].sort()).toEqual(["t1", "t2", "w1", "w2"]);
    expect([...tintAt(v, 6.5)], "past the coverage").toEqual([]);
  });

  it("a line is marked where an episode covers one of its moves: a contact over a possible over a provisional; each span of a repeated line apart; a gap marks nothing", () => {
    const st = store([
      { pair: 1, flags: ORIGIN_BOUNDARY, ivs: [[0, 1]], end: 1 },
      { pair: 2, close: [0.5, 1], onset: 0.2, end: 0.8, flags: EP_POSSIBLE },
      { pair: 3, ivs: [[4, 5]], end: 5 },
      { pair: 4, ivs: [[7, NaN]] },
    ], [[4, 8, 9, GAP_UNDECIDABLE]]);
    const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 10 });
    expect(lineMark(v, 1, [[0, 0.1]])).toEqual({ line: 1, boundary: true });
    expect(lineMark(v, 1, [[0.3, 0.4]]), "possible over provisional").toEqual({ line: 1, possible: true });
    expect(lineMark(v, 2, [[4.5, 4.6]])).toEqual({ line: 2 });
    expect(lineMark(v, 3, [[2, 3], [4.9, 6]]), "the second span").toEqual({ line: 3 });
    expect(lineMark(v, 3, [[2, 3], [5.5, 6]]), "between the episodes: no mark").toBeNull();
    expect(lineMark(v, 4, [[8.2, 8.8]]), "in the gap of an open contact").toBeNull();
    expect(lineMark(v, 4, [[9.5, 9.6]]), "after the gap: marked").toEqual({ line: 4 });
  });

  it("a line inside a long early contact is marked past later short stays that ended before it", () => {
    const st = store([{ pair: 1, ivs: [[0, 10]], end: 10 }, { pair: 2, close: [2.5, 1], onset: 2, end: 3 }]);
    const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 12 });
    expect(lineMark(v, 7, [[5, 6]])).toEqual({ line: 7 });
  });

  it("bands at display resolution: the R140 separation shows where a column can hold it, a narrow contact never vanishes", () => {
    const st = store([{ pair: 1, ivs: [[0, 1]] }, { pair: 1, ivs: [[1.001, 2]] }, { pair: 2, ivs: [[3.0001, 3.0002]] }]);
    const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 4 });
    expect(contactBands(v, 100, 4), "a 0.04 column cannot show the 0.001 gap").toEqual([[0, 0.5], [0.75, 0.76]]);
    const fine = contactBands(v, 8000, 4);
    expect(fine.length, "a 0.0005 column can").toBe(3);
    expect(fine[0]![1]).toBeLessThan(fine[1]![0]);
    expect(contactBands(v, 1e6, 4).length, "at most 8192 columns").toBe(3);
  });
});
