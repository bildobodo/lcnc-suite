import { describe, expect, it } from "vitest";
import {
  ColumnTable, ContactStore, EP_AT_START, EP_POSSIBLE, EP_RAPID, GAP_TOOL_UNKNOWN, GAP_UNDECIDABLE, IV_CONTINUES_CUT, IV_ENDED_AT_GAP,
  IV_ENTER_DECIDED, IV_EXIT_DECIDED, IV_POSSIBLE, IV_RAPID, NONE, ORIGIN_BOUNDARY, REQUEST_BUDGET, shareOf,
} from "./contactStore";
import { boundaryStretchesSteps,
  T_AT_START, T_ENTRY, T_ENTRY_MOVE, T_NEAR, T_OPEN, T_POSSIBLE, T_RAPID, T_REENTRY, buildContactView, contactBands, findKey,
  heldBytes, indexAfter, indexBefore, lineMark, lineRuns, runsOf, targetAt, targetEnd, targetKey, targetKind, targetPos,
  startTargets, targetWindow, tintAt, trackLineAt, viewCounts, type ContactSource, type ContactView,
  buildContactViewSteps, contactBandsSteps, startTargetsSteps, undecidableStretchesSteps, viewCountsSteps,
} from "./contactView";
import { STEP_OPS, runToEnd, type Steps } from "./steps";
import { buildShownSteps, type ShownSpec } from "./shownContacts";
import type { GenerationTables } from "./contactPublisher";
import { clashIndexOfView, clashTicksSteps } from "./simWindow";
import { wordsOfCounts } from "./sweepWords";

interface Ep { pair: number; flags?: number; onset?: number; end?: number; close?: [number, number]; ivs?: Array<[number, number, number?]> }
/** A store with the given episodes (each with its intervals [enter, exit, flags]; NaN = open). */
function store(eps: Ep[], gaps: Array<[number, number, number, number]> = [], generation = 0): ContactStore {
  const s = new ContactStore(1, generation);
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
const poss = (v: ContactView) => Array.from({ length: v.n }, (_, i) => targetPos(v, i));
const kinds = (v: ContactView) => Array.from({ length: v.n }, (_, i) => targetKind(v, i));

describe("the track's undecidable stretches: every generation's gaps united (C2, Codex R170 VP-I123)", () => {
  const gapsOf = (g: number, spans: number[][], pair = 0) => {
    const st = new ContactStore(1, g);
    for (const [start, end] of spans) st.gaps.append({ pair, start: start!, end: end!, reason: GAP_UNDECIDABLE });
    return st;
  };
  const stretches = (held: number[][], cur: number[][], o: { cov?: number; own?: number } = {}) => {
    const cov = o.cov ?? 10;
    const v = buildContactView({ sources: [src(gapsOf(1, cur), { held: [gapsOf(0, held)], heldCoverage: [cov], ownCoverage: o.own ?? cov })],
                                 pairName: () => ({ a: "spindle", b: "stock" }), coverage: cov });
    return runToEnd(undecidableStretchesSteps(v)).map(u => [u.spans, u.more]);
  };
  it("a shorter current stretch inside an earlier one keeps the earlier one whole — the rerun reached only 5 (Codex's probe)", () => {
    expect(stretches([[1, 9]], [[4, 5]], { own: 5 })).toEqual([[[[1, 9]], false]]);
  });
  it("overlapping earlier stretches unite with no current run at all (Codex's second probe)", () => {
    expect(stretches([[1, 3], [2, 9]], [])).toEqual([[[[1, 9]], false]]);
  });
  it("a partial overlap keeps what lies outside it on either side; apart, both stay", () => {
    expect(stretches([[3, 8]], [[2, 4]])).toEqual([[[[2, 8]], false]]);
    expect(stretches([[1, 3]], [[5, 7]])).toEqual([[[[1, 3], [5, 7]], false]]);
    expect(stretches([[5, 7]], [[1, 3]])).toEqual([[[[1, 3], [5, 7]], false]]);
  });
  it("the first three stretches and whether there are more — after a union too", () => {
    expect(stretches([[0, 1], [4, 5]], [[2, 3], [6, 7], [8, 9]])).toEqual([[[[0, 1], [2, 3], [4, 5]], true]]);
    expect(stretches([[0, 1], [2, 3]], [[0.5, 2.5], [4, 5]])).toEqual([[[[0, 3], [4, 5]], false]]);
  });
  it("pairs by their first stretch, then by name; a gap of another reason is no stretch", () => {
    const st = new ContactStore(1, 1);
    // the names' order is not the stretches': w0 last by its start
    st.gaps.append({ pair: 0, start: 5, end: 6, reason: GAP_UNDECIDABLE });
    st.gaps.append({ pair: 2, start: 1, end: 2, reason: GAP_UNDECIDABLE });
    st.gaps.append({ pair: 1, start: 1, end: 2, reason: GAP_UNDECIDABLE });
    st.gaps.append({ pair: 3, start: 0, end: 9, reason: GAP_TOOL_UNKNOWN });
    const v = buildContactView({ sources: [src(st, { ownCoverage: 10 })], pairName: p => ({ a: "t", b: `w${p}` }), coverage: 10 });
    expect(runToEnd(undecidableStretchesSteps(v)).map(u => u.b)).toEqual(["w1", "w2", "w0"]);
  });
});

describe("the target index (plan 4.1)", () => {
  it("an interval at its entry, a near miss at its closest approach, sorted; re-entry, possible, at start, rapid", () => {
    const st = store([
      { pair: 1, flags: EP_AT_START | EP_RAPID, ivs: [[0, 2], [5, 6, IV_RAPID]] },
      { pair: 2, close: [3.5, 1.2] },
      { pair: 3, flags: EP_POSSIBLE, close: [4, 0.5] },
      { pair: 4, ivs: [[7, 8, IV_POSSIBLE]] },
    ]);
    const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 10 });
    expect(poss(v)).toEqual([0, 3.5, 4, 5, 7]);
    expect(kinds(v)).toEqual([T_AT_START | T_RAPID, T_NEAR, T_NEAR | T_POSSIBLE, T_REENTRY | T_RAPID, T_POSSIBLE]);
    expect(viewCounts(v)).toEqual({ collisions: 2, entryCollisions: 0, nearMisses: 1, possible: 2, startsIn: true });
    // the words of those counts
    const objs = Array.from({ length: v.n }, (_, i) => targetAt(v, i, lineAt));
    expect(wordsOfCounts(viewCounts(v)).text).toBe("2 collisions · 2 possible contacts · 1 near miss");
    expect(objs[1]).toMatchObject({ a: "t2", b: "w2", line: 4, cum: 3.5, cumEnd: 3.5 });
    expect(objs[1]!.dist).toBeCloseTo(1.2, 6);
  });

  it("a target's move kind: a touch on a rapid (IV_RAPID), or the episode's first entered on one — a re-entry never inherits its episode's margin entry", () => {
    const st = store([
      { pair: 1, flags: EP_RAPID, ivs: [[0, 1], [2, 3], [4, 5, IV_RAPID]] },   // entered on a rapid; a feed re-entry, a rapid one
      { pair: 2, ivs: [[6, 7, IV_RAPID], [8, 9]] },                         // entered on a feed, touched on a rapid; a feed re-entry
    ]);
    const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 10 });
    expect(kinds(v).map(k => k & (T_RAPID | T_REENTRY))).toEqual([T_RAPID, T_REENTRY, T_REENTRY | T_RAPID, T_RAPID, T_REENTRY]);
  });

  it("the targets a program starts in, found at their tables' first sample — the same as asking every target (plan 4.4)", () => {
    const st = store([
      { pair: 1, flags: EP_AT_START, ivs: [[0, 2], [5, 6]] },
      { pair: 2, flags: EP_AT_START | EP_POSSIBLE, ivs: [[0, 1, IV_POSSIBLE]] },
      { pair: 3, ivs: [[0, 1]] },        // at the first sample, not proven at the first pose
      { pair: 4, close: [0, 0.5] },
      { pair: 5, ivs: [[3, 4]] },
    ]);
    // (an episode is at the start only when its pair touched at the first
    // pose — at the table's first sample: the sweep's own rows hold it,
    // collision.test and contactViewCross.test)
    const other = store([{ pair: 6, flags: EP_AT_START, ivs: [[0.5, 1]] }, { pair: 7, ivs: [[2, 3]] }]);
    const every = (v: ContactView) => Array.from({ length: v.n }, (_, i) => i).filter(i => targetKind(v, i) & T_AT_START);
    const v = buildContactView({ sources: [src(st), src(other, { at: c => c + 0.25 })], pairName: names, coverage: 10 });
    expect(startTargets(v)).toEqual(every(v));
    expect(startTargets(v).map(i => targetKey(v, i))).toEqual(["C1|0|0", "C2|0|0", "C6|0|0"]);
    // after a fallback: the earlier generation and the current one, both starting in contact (union pieces)
    const held = store([{ pair: 1, flags: EP_AT_START, ivs: [[0, 2]] }, { pair: 2, ivs: [[4, 5]] }]);
    const cur = store([{ pair: 1, flags: EP_AT_START, ivs: [[0, 2]] }, { pair: 2, ivs: [[4, 5]] }], [], 1);
    const u = buildContactView({ sources: [src(cur, { held: [held], heldCoverage: [10], ownCoverage: 10 })], pairName: names, coverage: 10 });
    expect(startTargets(u)).toEqual(every(u));
    expect(startTargets(u).length, "the union's start contact").toBe(1);
    expect(startTargets(buildContactView({ sources: [src(store([]))], pairName: names, coverage: 10 }))).toEqual([]);
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
    expect(poss(v)).toEqual([2]);
    expect([...tintAt(v, 4.5)].sort(), "both rapid parts touch").toEqual(["t2", "w2"]);
    expect([...tintAt(v, 0.5)].sort(), "so does the boundary contact").toEqual(["t1", "w1"]);
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
    expect(poss(v)).toEqual([3, 12, 21]);
    expect(targetEnd(v, 0), "the entry contact reaches the base interval's exit").toBe(19);
    expect(targetKind(v, 0) & (T_ENTRY | T_ENTRY_MOVE | T_OPEN), "joined: not open").toBe(T_ENTRY | T_ENTRY_MOVE);
    expect(targetKind(v, 1) & (T_ENTRY | T_ENTRY_MOVE), "past the entry move: the bound beginning").toBe(T_ENTRY);
    expect([targetKey(v, 0), targetKey(v, 2)]).toEqual(["E1|0|0", "C1|0|1"]);
    expect(viewCounts(v)).toMatchObject({ collisions: 2, entryCollisions: 1 });
  });

  it("an open interval runs to the coverage; one ended at an unknown tool to its gap, never through it", () => {
    const st = store([{ pair: 1, ivs: [[2, NaN]] }, { pair: 2, ivs: [[1, NaN, IV_ENDED_AT_GAP]] }], [[2, 3, 6, GAP_TOOL_UNKNOWN]]);
    const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 8 });
    expect([targetPos(v, 0), targetEnd(v, 0), targetKind(v, 0) & T_OPEN]).toEqual([1, 3, 0]);
    expect([targetPos(v, 1), targetEnd(v, 1), targetKind(v, 1) & T_OPEN]).toEqual([2, 8, T_OPEN]);
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

// Codex R147: VP-I101..VP-I105, each one rule the derivation had wrong.
describe("the derivation's exactness and budget (Codex R147)", () => {
  it("VP-I101: no tolerance fills a proven free point between two contacts", () => {
    const st = store([{ pair: 1, ivs: [[0, 1], [1.001, 2]] }]);
    st.intervals.set(0, "freeAt", 1.0005);
    const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 4 });
    expect([...tintAt(v, 1.0005)], "the free point: dark").toEqual([]);
    expect([...tintAt(v, 1)].sort(), "the exit itself: lit").toEqual(["t1", "w1"]);
    expect([...tintAt(v, 1.001)].sort(), "the re-entry itself: lit").toEqual(["t1", "w1"]);
  });

  it("VP-I102 A: a point gap inside a contact is unknown — no tint at it, no mark for a span lying only there", () => {
    const st = store([{ pair: 1, ivs: [[20, 21]], end: 21 }], [[1, 20.75, 20.75, GAP_UNDECIDABLE]]);
    const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 22 });
    expect([...tintAt(v, 20.75)]).toEqual([]);
    expect([...tintAt(v, 20.7)].sort()).toEqual(["t1", "w1"]);
    expect(lineMark(v, 8, [[20.75, 20.75]])).toBeNull();
    expect(lineMark(v, 8, [[20.7, 20.75]])).toEqual({ line: 8 });
  });

  it("VP-I102 B: a contact mapped to a point keeps its tint and band when the pair gains a gap elsewhere", () => {
    const st = store([{ pair: 1, ivs: [[1, 2]], end: 2 }]);
    const mapped = () => buildContactView({ sources: [src(st, { at: c => Math.max(0, c - 3) })], pairName: names, coverage: 4 });
    const bandsBefore = contactBands(mapped(), 100, 4);   // a view reads its tables as built: read before the write
    st.gaps.append({ pair: 1, start: 5, end: 6, reason: GAP_UNDECIDABLE });
    const after = mapped();
    expect([...tintAt(after, 0)].sort()).toEqual(["t1", "w1"]);
    expect(contactBands(after, 100, 4)).toEqual(bandsBefore);
    expect(contactBands(after, 100, 4)).toEqual([[0, 0.01]]);
    expect(lineMark(after, 1, [[0, 0]])).toEqual({ line: 1 });
  });

  it("VP-I103: a contact ended at an unknown tool ends at the TOOL gap, an undecidable one before it only cuts it", () => {
    const st = store([{ pair: 1, ivs: [[1, NaN, IV_ENDED_AT_GAP]], end: 6 }], [[1, 3, 4, GAP_UNDECIDABLE], [1, 7, 9, GAP_TOOL_UNKNOWN]]);
    const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 10 });
    expect(targetEnd(v, 0)).toBe(7);
    expect([...tintAt(v, 5)].sort(), "after the undecidable stretch: lit").toEqual(["t1", "w1"]);
    expect([...tintAt(v, 3.5)], "inside it: dark").toEqual([]);
    expect([...tintAt(v, 8)], "inside the tool gap: dark").toEqual([]);
    expect(targetKind(v, 0) & T_OPEN, "ended, not open").toBe(0);
  });

  it("VP-I104: a gap belongs to its own source, to that source's coverage — it never erases another source's contact", () => {
    // the side run ends at 10 with a gap open from 2; the base on the same axis from 10
    const side = store([], [[1, 2, NaN, GAP_UNDECIDABLE]]), base = store([{ pair: 1, ivs: [[2, 5]], end: 5 }]);
    const v = buildContactView({ sources: [src(side, { entry: true, coverage: 10 }), src(base, { at: c => c + 10 })], pairName: names, coverage: 20 });
    expect([...tintAt(v, 13)].sort()).toEqual(["t1", "w1"]);
    expect(lineMark(v, 13, [[13, 14]])).toEqual({ line: 13 });
    expect(contactBands(v, 20, 20)).toEqual([[0.6, 0.75]]);
    // two sources on ONE axis: the first's gap is its own ignorance, the
    // second's contact there stands
    const a = store([{ pair: 1, ivs: [[5, 6]], end: 6 }], [[1, 2, NaN, GAP_UNDECIDABLE]]), b = store([{ pair: 1, ivs: [[3, 4]], end: 4 }]);
    const w = buildContactView({ sources: [src(a, { coverage: 10 }), src(b)], pairName: names, coverage: 20 });
    expect([...tintAt(w, 3.5)].sort(), "b's contact inside a's gap").toEqual(["t1", "w1"]);
    expect([...tintAt(w, 5.5)], "a's own contact inside its gap: unknown").toEqual([]);
  });

  it("VP-I107: a view reads its tables as built — a write after the build makes every query of it throw; built anew it answers from one state", () => {
    // Codex R148: an open near stay at 2 (1 apart) gains its touch [4, 6]
    const st = store([{ pair: 1, close: [2, 1] }]);
    const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 10 });
    expect([viewCounts(v).nearMisses, targetPos(v, 0)]).toEqual([1, 2]);
    const iv = st.intervals.append({ episode: 0, enter: 4, exit: 6, flags: 0, next: NONE, witness: 4, freeAt: NaN });
    st.episodes.set(0, "firstIv", iv); st.episodes.set(0, "ivCount", 1); st.episodes.set(0, "closeAt", 4); st.episodes.set(0, "closeDist", 0);
    for (const ask of [() => targetPos(v, 0), () => targetAt(v, 0, lineAt), () => viewCounts(v), () => tintAt(v, 5),
                       () => lineMark(v, 5, [[4, 5]]), () => contactBands(v, 10, 10), () => indexAfter(v, 0, null)]) {
      expect(ask, "a stale view never answers").toThrow(/tables changed since it was built/);
    }
    // a cell set alone (a closer approach) is a write too
    const st2 = store([{ pair: 1, close: [2, 1] }]);
    const v2 = buildContactView({ sources: [src(st2)], pairName: names, coverage: 10 });
    st2.episodes.set(0, "closeAt", 3);
    expect(() => targetPos(v2, 0), "a set cell").toThrow(/tables changed since it was built/);
    const w = buildContactView({ sources: [src(st)], pairName: names, coverage: 10 });
    const t = targetAt(w, 0, lineAt);
    expect([t.cum, t.dist, t.near, viewCounts(w).collisions, [...tintAt(w, 5)].length]).toEqual([4, 0, false, 1, 2]);
  });

  it("VP-I102 (R148): a gap and a separate contact that both map to one shown point — the contact is cut on its own axis, and stays", () => {
    const st = store([{ pair: 1, ivs: [[1, 2]], end: 2 }]);
    const at = (c: number) => Math.max(0, c - 10);
    const make = () => buildContactView({ sources: [src(st, { entry: true, at, ownCoverage: 10 })], pairName: names, coverage: 20 });
    const bandsBefore = contactBands(make(), 100, 10);
    st.gaps.append({ pair: 1, start: 5, end: 6, reason: GAP_UNDECIDABLE });
    const after = make();
    expect([...tintAt(after, 0)].sort()).toEqual(["t1", "w1"]);
    expect(contactBands(after, 100, 10)).toEqual(bandsBefore);
    expect(lineMark(after, 1, [[0, 0]])).toEqual({ line: 1 });
    // a gap over the contact itself, mapped there too, takes it away
    st.gaps.append({ pair: 1, start: 0.5, end: 2.5, reason: GAP_UNDECIDABLE });
    const covered = make();
    expect([...tintAt(covered, 0)]).toEqual([]);
    expect(lineMark(covered, 1, [[0, 0]])).toBeNull();
  });

  it("touching gaps cover a stretch together (Codex R158: their stretch's end by one bisection) — a line inside them unmarked, one past them marked", () => {
    // a contact [0, 10] whose pair's undecidable gaps [2, 4], [4, 6], [5, 8] touch and overlap: [2, 8] is dark
    const v = buildContactView({ sources: [src(store([{ pair: 1, ivs: [[0, 10]], end: 10 }], [[1, 2, 4, GAP_UNDECIDABLE], [1, 4, 6, GAP_UNDECIDABLE],
      [1, 5, 8, GAP_UNDECIDABLE]]), { ownCoverage: 10 })], pairName: names, coverage: 10 });
    expect(lineMark(v, 3, [[2.5, 7.5]]), "inside the touching gaps: no free point").toBeNull();
    expect(lineMark(v, 4, [[3, 8]]), "to the last gap's end: still none").toBeNull();
    expect(lineMark(v, 5, [[3, 8.5]]), "past them: contact").not.toBeNull();
    expect([...tintAt(v, 4)], "the point they share: dark").toEqual([]);
    expect(contactBands(v, 10, 10), "the bands: the contact less [2, 8]").toEqual([[0, 0.2], [0.8, 1]]);
  });

  it("VP-I104 (R148): a join extends the entry FINDING to the base's end — the contact there is the base's own, with the base's gaps", () => {
    const side = store([{ pair: 1, ivs: [[3, NaN]] }]), base = store([{ pair: 1, ivs: [[0, 5]], end: 5 }], [[1, 1, 2, GAP_UNDECIDABLE]]);
    const sources = [src(side, { entry: true, entryEnd: 10, ownCoverage: 10 }), src(base, { at: c => c + 10, ownCoverage: 5 })];
    const plain = buildContactView({ sources, pairName: names, coverage: 15 });
    const v = buildContactView({ sources, pairName: names, coverage: 15,
                                 joins: [{ entrySrc: 0, baseSrc: 1, entryShard: 0, baseShard: 0, joins: new Map([[0, 0]]) }] });
    expect([v.n, targetEnd(v, 0)], "one finding, to the base's end").toEqual([1, 15]);
    expect([...tintAt(v, 11.5)], "the base's gap: dark").toEqual([]);
    expect([...tintAt(v, 12.5)].sort()).toEqual(["t1", "w1"]);
    expect(contactBands(v, 150, 15), "the bands of the contacts themselves").toEqual(contactBands(plain, 150, 15));
    expect(lineMark(v, 20, [[11.25, 11.75]]), "no mark in the gap").toBeNull();
  });

  it("VP-I105: two generations at the request budget and BOTH side generations, every episode its own pair, the gaps at budget — held within 8.4 MB, room kept for B4's display ids", { timeout: 300_000 }, () => {
    // Codex R148's counterexample: the pairs are not 384 but one per episode
    const full = (k: number, generation: number, b = REQUEST_BUDGET) => {
      const st = new ContactStore(k, generation, b);
      const per = Math.floor(b.intervals / b.episodes);
      for (let e = 0; e < b.episodes; e++) {
        const p = e * 4;
        const ep = st.episodes.append({ pair: e, ordinal: 0, onset: p, end: p + 3.25, closeAt: p, closeDist: 0, firstIv: NONE, ivCount: per });
        let last = -1;
        for (let k2 = 0; k2 < per; k2++) {
          const iv = st.intervals.append({ episode: ep, enter: p + k2, exit: p + k2 + 0.25, flags: 0, next: NONE, witness: p + k2, freeAt: NaN });
          if (last < 0) st.episodes.set(ep, "firstIv", iv); else st.intervals.set(last, "next", iv);
          last = iv;
        }
      }
      for (let g = 0; g < b.gaps; g++) st.gaps.append({ pair: g, start: g * 4 + 0.5, end: g * 4 + 0.75, reason: GAP_UNDECIDABLE });
      return st;
    };
    const side = shareOf(REQUEST_BUDGET, 8);
    const genA = full(1, 0), genB = full(1, 1), sideA = full(-1, 0, side), sideB = full(-1, 1, side);
    expect([genA.intervals.rows, genA.gaps.rows, sideA.intervals.rows]).toEqual([REQUEST_BUDGET.intervals, REQUEST_BUDGET.gaps, side.intervals]);
    const t0 = performance.now();
    const v = buildContactView({ sources: [{ stores: [genA], at: c => c }, { stores: [genB], at: c => c },
                                           { stores: [sideA], at: c => c, entry: true }, { stores: [sideB], at: c => c, entry: true }],
                                 pairName: names, coverage: 4 * REQUEST_BUDGET.episodes + 1 });
    const ms = performance.now() - t0;
    const held = heldBytes(v);
    // B4 binds a display id per target: a u32 each, reserved here
    const reserve = 4 * v.n;
    console.log(`[R148 VP-I105] targets ${v.n}, held ${(held / 1e6).toFixed(2)} MB + ${(reserve / 1e6).toFixed(2)} MB reserved for B4 (limit 8.4), ` +
                `build ${ms.toFixed(0)} ms; tables ${([genA, genB, sideA, sideB].reduce((n, s) => n + s.allocatedBytes(), 0) / 1e6).toFixed(1)} MB`);
    // + two u32 a gap since Codex R158 (the next tool gap and the end of the
    // touching gaps' stretch: ownEnd and freeOf by bisection), named in 3.4,
    // and the episode index, 4 B an episode
    const perGap = 8 * [genA, genB, sideA, sideB].reduce((n, s) => n + s.gaps.rows, 0);
    const perEpisode = 4 * [genA, genB, sideA, sideB].reduce((n, s) => n + s.episodes.rows, 0);
    // and the three block indexes, 4 B a block of 64 positions and one more, an empty earlier generation's too
    const perBlock = 3 * 4 * [genA, genB, sideA, sideB].reduce((n, s) => n + Math.ceil(s.intervals.rows / 64) + 2, 0);
    // and the targets' least and largest jump point per block of 64
    const perTargetBlock = 16 * Math.ceil(v.n / 64);
    expect(held + reserve).toBeLessThanOrEqual(8_400_000 + perGap + perEpisode + perBlock + perTargetBlock);
    expect(genA.allocatedBytes(), "one generation's tables within T = 19.3 MB").toBeLessThanOrEqual(19_300_000);
    expect(v.n).toBe(2 * REQUEST_BUDGET.intervals + 2 * side.intervals);
    // what it answers stays exact at that size: a contact, a gap of its pair, the free stretch after it
    expect([...tintAt(v, 4 * 1000 + 0.1)].length).toBe(2);
    expect([...tintAt(v, 4 * 1000 + 0.6)].length, "inside the pair's gap").toBe(0);
    expect([...tintAt(v, 4 * 1000 + 1.1)].length).toBe(2);
    expect([...tintAt(v, 4 * 1000 + 2.5)]).toEqual([]);
  });
});

describe("lines on the shown track (plan 1.3, 4.2)", () => {
  // points 0..4: L5 from 0 to 1, L6 from 1 to 2, L5 again from 2 to 3, a zero-length L7 at 3, L8 to 4
  const t = { count: 6, cum: [0, 1, 2, 3, 3, 4], lines: [5, 5, 6, 5, 7, 8] };
  it("a position is the move containing it — on a segment's start the next move's, at an end the move ending there", () => {
    const at = trackLineAt(t);
    expect([at(0.5), at(1), at(1.5), at(3), at(3.5)]).toEqual([5, 6, 6, 8, 8]);
    expect([at(1, true), at(2, true), at(3, true)], "where something ends").toEqual([5, 6, 5]);
  });
  it("each run of a repeated line apart", () => {
    const r = lineRuns(t);
    expect(runsOf(r, 5)).toEqual([[0, 1], [2, 3]]);
    expect(runsOf(r, 6)).toEqual([[1, 2]]);
    expect(runsOf(r, 7)).toEqual([[3, 3]]);
    expect(runsOf(r, 9)).toEqual([]);
  });
  it("a line a contact carried in from an earlier line is \"still in contact\", naming that line; one beginning on it wins", () => {
    const st = store([{ pair: 1, ivs: [[0.5, 2.5]], end: 2.5 }, { pair: 2, ivs: [[1.5, 1.6]], end: 1.6 }]);
    const v = buildContactView({ sources: [src(st)], pairName: names, coverage: 4 });
    const at = trackLineAt(t);
    expect(lineMark(v, 5, [[2, 3]], at), "the second run of L5: carried in from L5's first").toEqual({ line: 5, continuation: 5 });
    expect(lineMark(v, 6, [[1, 2]], at), "pair 2 begins on L6").toEqual({ line: 6 });
  });
});

describe("the build and the bar's queries in bounded steps (plan 3.6)", () => {
  /** Runs a job, counting its yields. */
  const yieldsOf = <T,>(job: Steps<T>): { value: T; yields: number } => {
    let yields = 0;
    for (;;) { const r = job.next(); if (r.done) return { value: r.value, yields }; yields++; }
  };
  it("a union of one pair's 8192 contacts per generation: the build, the counts, the bands and the start targets each yield", () => {
    const mk = (g: number, shift: number) => store([{ pair: 1, flags: EP_AT_START,
      ivs: Array.from({ length: 8192 }, (_, i) => [3 * i + shift, 3 * i + shift + 1] as [number, number]) }], [], g);
    const held = mk(0, 0), cur = mk(1, 1.5);
    const input = { sources: [src(cur, { held: [held], heldCoverage: [3 * 8192 + 5], ownCoverage: 3 * 8192 + 5 })], pairName: names, coverage: 3 * 8192 + 5 };
    const b = yieldsOf(buildContactViewSteps(input));
    expect(b.value.n).toBeGreaterThan(8192);
    expect(b.yields, "the build").toBeGreaterThan(20);
    expect(yieldsOf(viewCountsSteps(b.value)).yields, "the counts").toBeGreaterThan(10);
    expect(yieldsOf(contactBandsSteps(b.value, 4000, input.coverage)).yields, "the bands").toBeGreaterThan(10);
    expect(yieldsOf(startTargetsSteps(b.value)).yields, "the start targets").toBeGreaterThanOrEqual(0);
    // and the same view as at once
    const once = buildContactView(input);
    expect([once.n, Array.from(once.tgt.refs)]).toEqual([b.value.n, Array.from(b.value.tgt.refs)]);
  });
  it("the boundary contacts' stretches read every episode in counted steps (Codex R158 VP-I115)", () => {
    const st = new ContactStore(1, 0, REQUEST_BUDGET);
    for (let e = 0; e < REQUEST_BUDGET.episodes; e++) {
      st.episodes.append({ pair: e % 64, ordinal: e, flags: e % 1000 === 0 ? ORIGIN_BOUNDARY : 0, onset: e, end: e + 0.5, closeAt: e, closeDist: 1, firstIv: NONE, ivCount: 0 });
    }
    const v = buildContactView({ sources: [src(st, { ownCoverage: REQUEST_BUDGET.episodes + 1 })], pairName: names, coverage: REQUEST_BUDGET.episodes + 1 });
    const proto = ColumnTable.prototype as unknown as { get: (...a: unknown[]) => number };
    const get = proto.get;
    let reads = 0, most = 0;
    proto.get = function (...a: unknown[]) { reads++; return get.apply(this, a); };
    try {
      const job = boundaryStretchesSteps(v);
      for (;;) { reads = 0; const r = job.next(); most = Math.max(most, reads); if (r.done) { expect(r.value.length).toBe(Math.ceil(REQUEST_BUDGET.episodes / 1000)); break; } }
    } finally { proto.get = get; }
    expect(most, "episode cells read in one step").toBeLessThanOrEqual(4 * STEP_OPS);
  });
  // Plan 3.6: the work of every STEP is bounded, not only the number of steps
  // — counted, never timed: every table cell read between two yields (the
  // build's direct block reads too), and no list sorted or copied at once. A
  // held generation's coverage read all its rows in the build's first step,
  // the target lists were copied at once (16 and 20 ms in the browser); a
  // coarse held contact over a rerun's every contact was gathered at once, a
  // piece's intervals described at once, one pair's gaps sorted at once
  // (Codex R157 VP-I115).
  const D = IV_ENTER_DECIDED | IV_EXIT_DECIDED;
  const shapes: Array<[string, () => { input: Parameters<typeof buildContactViewSteps>[0]; cov: number }]> = [
    ["many pairs, both generations, every contact with its separation's free sample", () => {
      const mk = (g: number, shift: number) => {
        const st = new ContactStore(1, g, REQUEST_BUDGET);
        for (let e = 0; e < 2048; e++) {
          const ep = st.episodes.append({ pair: e % 7, ordinal: Math.floor(e / 7), onset: 12 * e + shift, end: 12 * e + 10 + shift, closeAt: 12 * e + shift,
            closeDist: 0, firstIv: NONE, ivCount: 4 });
          let last = -1;
          for (let k = 0; k < 4; k++) {
            const a = 12 * e + 3 * k + shift;
            const iv = st.intervals.append({ episode: ep, enter: a, exit: a + 1, flags: D, next: NONE, witness: a + 0.5, freeAt: a + 1.25, freeR: 0.2 });
            if (last < 0) st.episodes.set(ep, "firstIv", iv); else st.intervals.set(last, "next", iv);
            last = iv;
          }
        }
        return st;
      };
      const cov = 12 * 2048 + 5;
      return { input: { sources: [src(mk(1, 1.5), { held: [mk(0, 0)], heldCoverage: [cov], ownCoverage: cov })], pairName: names, coverage: cov }, cov };
    }],
    ["a coarse held contact over a rerun's every contact (Codex R157)", () => {
      const n = 16384, held = new ContactStore(1, 0, REQUEST_BUDGET), cur = new ContactStore(1, 1, REQUEST_BUDGET);
      const e0 = held.episodes.append({ pair: 0, ordinal: 0, onset: 0, end: 4 * n, closeAt: 0, closeDist: 0, firstIv: NONE, ivCount: 1 });
      held.episodes.set(e0, "firstIv", held.intervals.append({ episode: e0, enter: 0, exit: 4 * n, flags: D, next: NONE, witness: 0.5, freeAt: NaN, freeR: 0 }));
      for (let k = 0; k < n; k++) {
        const e = cur.episodes.append({ pair: 0, ordinal: k, onset: 4 * k, end: 4 * k + 1, closeAt: 4 * k, closeDist: 0, firstIv: NONE, ivCount: 1 });
        cur.episodes.set(e, "firstIv", cur.intervals.append({ episode: e, enter: 4 * k, exit: 4 * k + 1, flags: D, next: NONE, witness: 4 * k + 0.5, freeAt: 4 * k + 2, freeR: 0.25 }));
      }
      const cov = 4 * n + 5;
      return { input: { sources: [src(cur, { held: [held], heldCoverage: [cov], ownCoverage: cov })], pairName: names, coverage: cov }, cov };
    }],
    ["one piece of the gaps' budget of contacts ended at gaps", () => {
      const n = 4096, held = new ContactStore(1, 0, REQUEST_BUDGET), cur = new ContactStore(1, 1, REQUEST_BUDGET);
      const e0 = held.episodes.append({ pair: 0, ordinal: 0, onset: 0, end: 4 * n + 8, closeAt: 0, closeDist: 0, firstIv: NONE, ivCount: 1 });
      held.episodes.set(e0, "firstIv", held.intervals.append({ episode: e0, enter: 0, exit: 4 * n + 8, flags: D, next: NONE, witness: 0.5, freeAt: NaN, freeR: 0 }));
      for (let k = 0; k < n; k++) {
        const e = cur.episodes.append({ pair: 0, ordinal: k, onset: 4 * k, end: 4 * k + 1, closeAt: 4 * k, closeDist: 0, firstIv: NONE, ivCount: 1 });
        cur.episodes.set(e, "firstIv", cur.intervals.append({ episode: e, enter: 4 * k, exit: 4 * k + 1, flags: IV_ENTER_DECIDED | IV_ENDED_AT_GAP, next: NONE,
          witness: 4 * k + 0.5, freeAt: NaN, freeR: 0 }));
        cur.gaps.append({ pair: 0, start: 4 * k + 1, end: 4 * k + 2, reason: GAP_UNDECIDABLE });
      }
      const cov = 4 * n + 13;
      return { input: { sources: [src(cur, { held: [held], heldCoverage: [cov], ownCoverage: cov })], pairName: names, coverage: cov }, cov };
    }],
    ["every pair starting at one point, both generations alike (the start pairs ask each)", () => {
      const mk = (g: number) => {
        const st = new ContactStore(1, g, REQUEST_BUDGET);
        for (let e = 0; e < 4096; e++) {
          const ep = st.episodes.append({ pair: e, ordinal: 0, onset: 0, end: 3, closeAt: 0, closeDist: 0, firstIv: NONE, ivCount: 2 });
          const a = st.intervals.append({ episode: ep, enter: 0, exit: 1, flags: D, next: NONE, witness: 0.5, freeAt: 1.5, freeR: 0.2 });
          const b = st.intervals.append({ episode: ep, enter: 2, exit: 3, flags: D, next: NONE, witness: 2.5, freeAt: 3.5, freeR: 0.2 });
          st.episodes.set(ep, "firstIv", a); st.intervals.set(a, "next", b);
        }
        return st;
      };
      const cov = 10;
      return { input: { sources: [src(mk(1), { held: [mk(0)], heldCoverage: [cov], ownCoverage: cov })], pairName: names, coverage: cov }, cov };
    }],
    // Codex R158 VP-I115 rest A: an undecidable answer suspends a contact,
    // never ends it — one open contact over its pair's every gap, alone and
    // as a union of two such generations
    ...[false, true].map((union): [string, () => { input: Parameters<typeof buildContactViewSteps>[0]; cov: number }] => [
      `one open contact over the gap budget of undecidable gaps${union ? ", a union of two" : ""} (Codex R158)`, () => {
        const n = REQUEST_BUDGET.gaps, cov = 4 * n + 1;
        const mk = (g: number) => {
          const st = new ContactStore(1, g, REQUEST_BUDGET);
          const ep = st.episodes.append({ pair: 0, ordinal: 0, onset: 0, end: NaN, closeAt: 0, closeDist: 0, firstIv: NONE, ivCount: 1 });
          st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: 0, exit: NaN, flags: IV_ENTER_DECIDED, next: NONE, witness: 0, freeAt: NaN, freeR: 0 }));
          for (let i = 0; i < n; i++) st.gaps.append({ pair: 0, start: 4 * i + 1, end: 4 * i + 2, reason: GAP_UNDECIDABLE });
          return st;
        };
        return { input: { sources: [src(mk(1), { ...(union ? { held: [mk(0)], heldCoverage: [cov] } : {}), ownCoverage: cov })], pairName: names, coverage: cov }, cov };
      }]),
    ["one pair's gaps, both generations", () => {
      const n = 4096, gens = [0, 1].map(g => new ContactStore(1, g, REQUEST_BUDGET));
      gens.forEach((st, g) => {
        for (let k = 0; k < n; k++) {
          st.gaps.append({ pair: 0, start: 10 * k + 5 + g / 2, end: 10 * k + 6 + g / 2, reason: GAP_TOOL_UNKNOWN });
          const e = st.episodes.append({ pair: 0, ordinal: k, onset: 10 * k + 1, end: 10 * k + 2, closeAt: 10 * k + 1, closeDist: 0, firstIv: NONE, ivCount: 1 });
          st.episodes.set(e, "firstIv", st.intervals.append({ episode: e, enter: 10 * k + 1, exit: 10 * k + 2, flags: D, next: NONE, witness: 10 * k + 1.5, freeAt: NaN, freeR: 0 }));
        }
      });
      const cov = 10 * n + 5;
      return { input: { sources: [src(gens[1]!, { held: [gens[0]!], heldCoverage: [cov], ownCoverage: cov })], pairName: names, coverage: cov }, cov };
    }],
  ];
  /** A shape's one source as the page's publisher holds it: request 1, its
   *  earlier generation held — for the build the page runs (buildShownSteps). */
  const asShown = (input: Parameters<typeof buildContactViewSteps>[0], cov: number) => {
    const s = input.sources[0]!;
    const tables = (id: number): GenerationTables | null => (id === 1 ? { generation: 1, stores: [...s.stores], pairs: null, deltas: 1 } : null);
    const held = (id: number): GenerationTables | null => (id === 1 && s.held?.length
      ? { generation: 0, stores: [...s.held], pairs: null, deltas: 1, covered: (s.heldCoverage ?? []).map(c => c / cov) } : null);
    const spec: ShownSpec = { base: { id: 1, map: null, coverage: cov, ownEnd: cov, ownCoverage: s.ownCoverage ?? cov }, side: null, axisEnd: cov };
    return { tables, held, spec };
  };
  // Codex R170 VP-I124: one pair's undecidable gaps in both generations, apart
  shapes.push(["one pair's undecidable gaps, both generations, interleaved (Codex R170)", () => {
    const n = REQUEST_BUDGET.gaps >> 1, gens = [0, 1].map(g => new ContactStore(1, g, REQUEST_BUDGET));
    gens.forEach((st, g) => {
      for (let k = 0; k < n; k++) st.gaps.append({ pair: 0, start: 4 * k + 2 * (1 - g), end: 4 * k + 2 * (1 - g) + 0.5, reason: GAP_UNDECIDABLE });
    });
    const cov = 4 * n + 1;
    return { input: { sources: [src(gens[1]!, { held: [gens[0]!], heldCoverage: [cov], ownCoverage: cov })], pairName: names, coverage: cov }, cov };
  }]);
  for (const [name, make] of shapes) {
    it(`every step reads a bounded number of table cells, sorts and copies no list at once — ${name}`, () => {
      const { input, cov } = make();
      const proto = ColumnTable.prototype as unknown as { get: (...a: unknown[]) => number; blocksOf: (n: string) => ArrayLike<number>[] };
      const get = proto.get, blocksOf = proto.blocksOf;
      let reads = 0, sorted = 0, copied = 0;
      const counted = new WeakMap<object, object>();
      const cell = <A extends object>(a: A): A => {
        let w = counted.get(a) as A | undefined;
        if (!w) counted.set(a, w = new Proxy(a, { get(t, k) { if (typeof k === "string" && /^\d+$/.test(k)) reads++; return Reflect.get(t, k, t); } }));
        return w;
      };
      proto.get = function (...a: unknown[]) { reads++; return get.apply(this, a); };
      proto.blocksOf = function (n: string) {
        const blocks = blocksOf.call(this, n) as object[];
        return new Proxy(blocks, { get(t, k) { const x = Reflect.get(t, k, t); return typeof k === "string" && /^\d+$/.test(k) && x ? cell(x as object) : x; } }) as never;
      };
      const restore: Array<() => void> = [];
      for (const P of [Array.prototype, Float64Array.prototype, Uint32Array.prototype, Int32Array.prototype] as Array<{ sort: (...a: unknown[]) => unknown }>) {
        const o = P.sort;
        P.sort = function (this: { length: number }, ...a: unknown[]) { sorted = Math.max(sorted, this.length); return o.apply(this, a); };
        restore.push(() => { P.sort = o; });
      }
      for (const T of [Float64Array, Uint32Array, Int32Array] as unknown as Array<{ from: (...a: unknown[]) => unknown }>) {
        const o = T.from;
        T.from = function (src: unknown, ...r: unknown[]) { copied = Math.max(copied, (src as { length?: number })?.length ?? 0); return o.call(this, src, ...r); };
        restore.push(() => { T.from = o; });
      }
      let worst = 0, worstQueries = 0, oneQuery = 0;
      let fresh: ContactView | undefined;
      const drive = <R,>(job: Steps<R>, queries = false): R => {
        for (;;) {
          reads = 0;
          const r = job.next();
          if (queries) worstQueries = Math.max(worstQueries, reads); else worst = Math.max(worst, reads);
          if (r.done) return r.value;
        }
      };
      try {
        // the build and the bands ask no query: the step's share alone
        const v = drive(buildContactViewSteps(input));
        drive(contactBandsSteps(v, 1200, cov));
        drive(boundaryStretchesSteps(v));
        drive(undecidableStretchesSteps(v));
        // the start pairs and the marks ask positions: one search past it at most
        drive(startTargetsSteps(v), true);
        drive(clashTicksSteps(clashIndexOfView(v, () => 1), 1200, cov), true);
        // the build the page runs, whole (Codex R170 VP-I124: a derivation
        // added there alone was in no guard) — its steps ask queries too
        const sh = asShown(input, cov);
        expect(drive(buildShownSteps(sh.tables, sh.spec, sh.held, () => 1, 1200, cov), true)?.derived?.undecidable, "the page's build derives the notes").toBeDefined();
        // one query cannot be split: the most one target's position and kind
        // read (a union piece decodes its piece — linear in its intervals)
        // (a fresh view: the build's queries left a piece decoded in the first)
        fresh = runToEnd(buildContactViewSteps(input));
        for (let i = 0; i < fresh.n; i++) { reads = 0; targetPos(fresh, i); targetKind(fresh, i); oneQuery = Math.max(oneQuery, reads); }
      } finally {
        proto.get = get; proto.blocksOf = blocksOf;
        for (const r of restore) r();
      }
      // a binary search over the targets is one query of up to log2(n) + 1 positions
      const search = (Math.ceil(Math.log2(fresh!.n + 1)) + 1) * oneQuery;
      expect(worst, "table cells read in one step of the build or the bands").toBeLessThanOrEqual(4 * STEP_OPS);
      expect(worstQueries, "in one step of the start pairs or the marks: the share and at most one search past it").toBeLessThanOrEqual(4 * STEP_OPS + search);
      expect(sorted, "the longest list sorted natively at once").toBeLessThanOrEqual(64);
      expect(copied, "the longest list copied into a typed array at once").toBeLessThanOrEqual(STEP_OPS);
    }, 120_000);   // every cell read through a counting proxy: slow on purpose
  }

});
