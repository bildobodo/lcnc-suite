// Round B4: the view after a fallback (plan 3.5) — a source with its earlier
// generation's tables shows the union of both, through the real tables.
import { describe, expect, it } from "vitest";
import {
  ContactStore, EP_RAPID, GAP_TOOL_UNKNOWN, GAP_UNDECIDABLE, IV_AFTER_UNKNOWN_TOOL, IV_ENDED_AT_GAP, IV_ENTER_DECIDED, IV_EXIT_DECIDED, IV_RAPID,
  NONE, ORIGIN_BOUNDARY, REQUEST_BUDGET, shareOf, type StoreBudget,
} from "./contactStore";
import { derivationBound,
  buildContactView, contactBands, findKey, heldBytes, indexAfter, indexBefore, lineMark, T_EARLIER, T_RAPID, T_REENTRY, targetAt, targetEnd, targetKey,
  targetKind, targetPos, targetWindow, tintAt, viewCounts, type ContactSource,
} from "./contactView";

const names = (p: number) => ({ a: `t${p}`, b: `w${p}` });
const D = IV_ENTER_DECIDED | IV_EXIT_DECIDED;

interface Iv { pair: number; enter: number; exit: number; witness?: number; flags?: number; freeAt?: number; freeR?: number }
/** A generation's table: each interval its own episode unless `episodes` groups them. */
function gen(generation: number, ivs: Iv[], o: { near?: Array<{ pair: number; onset: number; end: number; at: number; dist?: number }>;
                                                 gaps?: Array<[number, number, number, number?]>; budget?: StoreBudget } = {}): ContactStore {
  const st = new ContactStore(1, generation, o.budget ?? REQUEST_BUDGET);
  const ord = new Map<number, number>();
  const next = (p: number) => { const k = ord.get(p) ?? 0; ord.set(p, k + 1); return k; };
  for (const iv of ivs) {
    const ep = st.episodes.append({ pair: iv.pair, ordinal: next(iv.pair), flags: 0, onset: iv.enter, end: iv.exit, closeAt: iv.enter,
                                    closeDist: 0, firstIv: NONE, ivCount: 1 });
    st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: iv.enter, exit: iv.exit, flags: iv.flags ?? D, next: NONE,
                                                         witness: iv.witness ?? iv.enter, freeAt: iv.freeAt ?? NaN, freeR: iv.freeR ?? 0 }));
  }
  for (const n of o.near ?? []) {
    st.episodes.append({ pair: n.pair, ordinal: next(n.pair), flags: 0, onset: n.onset, end: n.end, closeAt: n.at, closeDist: n.dist ?? 1,
                         firstIv: NONE, ivCount: 0 });
  }
  for (const [pair, s, e, reason] of o.gaps ?? []) st.gaps.append({ pair, start: s, end: e, reason: reason ?? GAP_UNDECIDABLE });
  return st;
}
/** The current generation swept to `own`; the shown axis runs to 100. */
const view = (held: ContactStore[], cur: ContactStore[], own = 100, over: Partial<ContactSource> = {}) =>
  buildContactView({ sources: [{ stores: cur, held, at: c => c, ownCoverage: own, ...over }], pairName: names, coverage: 100 });
const list = (v: ReturnType<typeof view>) =>
  Array.from({ length: v.n }, (_, i) => ({ pos: targetPos(v, i), end: targetEnd(v, i), key: targetKey(v, i), kind: targetKind(v, i) }));
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

describe("the view after a fallback: both generations' union (plan 3.5)", () => {
  it("R142 through the tables: the new free stretch cuts the old cautious boundary; the piece keeps the old key by its witness", () => {
    const held = gen(0, [{ pair: 0, enter: 0, exit: 0.5 }, { pair: 0, enter: 1.00037, exit: 3, witness: 2.5, flags: IV_EXIT_DECIDED }]);
    const cur = gen(1, [{ pair: 0, enter: 0, exit: 0.5, freeAt: 0.875, freeR: 0.375 }, { pair: 0, enter: 2, exit: 3, witness: 2.2 }]);
    const v = view([held], [cur]);
    expect(list(v).map(t => [r4(t.pos), r4(t.end), t.key])).toEqual([[0, 0.5, "C0|0|0"], [1.25, 3, "C0|1|0"]]);
    expect(targetKind(v, 1) & T_REENTRY, "the old event's own kind, kept").toBe(0);
    expect([...tintAt(v, 1.1)], "the cut cautious stretch: dark").toEqual([]);
    expect([...tintAt(v, 1.3)].sort()).toEqual(["t0", "w0"]);
  });

  it("R140: one coarse new contact over two old ones apart by a free sample — two events, each its old key", () => {
    const held = gen(0, [{ pair: 0, enter: 0, exit: 1, witness: 0.5, freeAt: 1.0005, freeR: 0.0002 }, { pair: 0, enter: 1.001, exit: 2, witness: 1.5 }]);
    const cur = gen(1, [{ pair: 0, enter: 0, exit: 2, witness: 0.4 }]);
    const v = view([held], [cur]);
    expect(list(v).map(t => [r4(t.pos), r4(t.end), t.key])).toEqual([[0, 1.0003, "C0|0|0"], [1.0007, 2, "C0|1|0"]]);
  });

  it("R141: reaching is no refutation — the narrow old contact stays", () => {
    const held = gen(0, [{ pair: 0, enter: 0, exit: 1 }, { pair: 0, enter: 1.4, exit: 1.6, witness: 1.5 }, { pair: 0, enter: 2, exit: 3 }]);
    const cur = gen(1, [{ pair: 0, enter: 0, exit: 1, freeAt: 1.125, freeR: 0.12 }, { pair: 0, enter: 2, exit: 3 }]);
    expect(list(view([held], [cur])).map(t => [t.pos, t.end, t.key])).toEqual([[0, 1, "C0|0|0"], [1.4, 1.6, "C0|1|0"], [2, 3, "C0|2|0"]]);
  });

  it("a piece no earlier event's witness lies in is new: keyed by its generation, its lead and the evidence it begins at", () => {
    // the old run saw nothing on pair 1; the new one found [5, 6], and a free stretch of the old run splits an old contact
    const held = gen(0, [{ pair: 0, enter: 0, exit: 4, witness: 0.5, flags: IV_ENTER_DECIDED }, { pair: 2, enter: 9, exit: 9.5, freeAt: 3, freeR: 0.5 }]);
    const cur = gen(1, [{ pair: 1, enter: 5, exit: 6 }, { pair: 2, enter: 0, exit: 8, witness: 7 }]);
    const v = view([held], [cur]);
    const keys = list(v).map(t => [t.pos, t.key]);
    expect(keys).toContainEqual([5, "C1|0|0#g1/b"]);
    // pair 2: the old free stretch (2.5, 3.5) cuts the new [0, 8]; the part after it begins at the free stretch's end
    expect(keys).toContainEqual([0, "C2|0|0#g1/b"]);
    expect(keys).toContainEqual([3.5, "C2|0|0#g1/f0:C2|0|0"]);
    expect(targetKind(v, keys.findIndex(k => k[0] === 3.5)) & T_REENTRY, "after a proven separation").toBe(T_REENTRY);
    // the keys answer the navigation
    expect(findKey(v, "C2|0|0#g1/f0:C2|0|0")).toBe(keys.findIndex(k => k[0] === 3.5));
  });

  it("a gap does not split an event; its generation's contact is dark in it, the other's not", () => {
    // the old interval [0, 10] with its gap [2, 4]; the new run touches [3, 5]
    const held = gen(0, [{ pair: 0, enter: 0, exit: 10 }], { gaps: [[0, 2, 4]] });
    const cur = gen(1, [{ pair: 0, enter: 3, exit: 5, witness: 3.5 }]);
    const v = view([held], [cur]);
    expect(v.n, "one event").toBe(1);
    expect([...tintAt(v, 2.5)], "in the old gap, before the new contact").toEqual([]);
    expect([...tintAt(v, 3.5)].sort(), "the new contact in the old gap").toEqual(["t0", "w0"]);
    expect(contactBands(v, 100, 100), "the band less the old gap before the new contact").toEqual([[0, 0.02], [0.03, 0.1]]);
  });

  it("near misses are matched one to one: a matched one keeps the earlier key, an earlier one found no more says so, a new one is new", () => {
    const held = gen(0, [], { near: [{ pair: 0, onset: 1, end: 2, at: 1.5 }, { pair: 1, onset: 5, end: 6, at: 5.5 }] });
    const cur = gen(1, [], { near: [{ pair: 0, onset: 1.2, end: 2.2, at: 1.6, dist: 0.5 }, { pair: 2, onset: 7, end: 8, at: 7.5 }] });
    const v = view([held], [cur]);
    const t = Array.from({ length: v.n }, (_, i) => targetAt(v, i, () => 1));
    expect(t.map(x => [x.cum, x.key, !!x.earlier])).toEqual([[1.6, "C0|0|n", false], [5.5, "C1|0|n", true], [7.5, "C2|0|n#g1", false]]);
    expect(targetKind(v, 1) & T_EARLIER).toBe(T_EARLIER);
    expect(viewCounts(v).nearMisses).toBe(3);
  });

  it("Codex R150 VP150-02: a fallback inside an open contact — the shown stretch stays through an empty and a still-touching new run, and only a free stretch makes it smaller", () => {
    // the pool reported 15 swept; its open contact's rows name 0 alone
    const held = gen(0, [{ pair: 0, enter: 0, exit: NaN, flags: IV_ENTER_DECIDED }]);
    const shown = (cur: ContactStore, own: number) => buildContactView({
      sources: [{ stores: [cur], held: [held], heldCoverage: [15], at: c => c, ownCoverage: own }], pairName: names, coverage: 32 });
    // 1. the new run has nothing yet
    let v = shown(gen(1, []), 0);
    expect(list(v).map(t => [t.pos, t.end]), "the stretch the pool had shown").toEqual([[0, 15]]);
    expect([...tintAt(v, 7.5)].sort()).toEqual(["t0", "w0"]);
    // 2. the new run touches from 0 on, swept to 5 — no evidence of a separation
    v = shown(gen(1, [{ pair: 0, enter: 0, exit: NaN, flags: IV_ENTER_DECIDED }]), 5);
    expect(list(v).map(t => [t.pos, t.end, t.key])).toEqual([[0, 15, "C0|0|0"]]);
    expect([...tintAt(v, 12)].sort(), "the earlier stretch stays").toEqual(["t0", "w0"]);
    // 3. the new run left the contact at 8 and proved (8.5, 9.5) free: now, and only now, it is smaller
    v = shown(gen(1, [{ pair: 0, enter: 0, exit: 8, freeAt: 9, freeR: 0.5 }]), 10);
    expect(list(v).map(t => [t.pos, t.end, t.key]), "split at the free stretch; the earlier event keeps its key").toEqual(
      [[0, 8.5, "C0|0|0"], [9.5, 15, "C0|0|0#g0/f1:C0|0|0"]]);
    expect([...tintAt(v, 9)], "proven free").toEqual([]);
    // without the pool's word the rows alone would show nothing past 0
    const bare = buildContactView({ sources: [{ stores: [gen(1, [])], held: [held], at: c => c, ownCoverage: 0 }], pairName: names, coverage: 32 });
    expect(targetEnd(bare, 0)).toBe(0);
  });

  it("Codex R150 VP150-01 through the tables: a confirmed exit just inside its own free stretch keeps the exit and the free sample — two events", () => {
    const held = gen(0, [{ pair: 0, enter: 0, exit: 1.0001, witness: 0.5, freeAt: 1.0005, freeR: 0.0005 }]);
    const cur = gen(1, [{ pair: 0, enter: 0, exit: 2, witness: 1.5, flags: 0 }]);
    const v = view([held], [cur]);
    expect(list(v).map(t => [r4(t.pos), r4(t.end)])).toEqual([[0, 1.0001], [1.0009, 2]]);
    expect([...tintAt(v, 1.0001)].sort(), "the confirmed exit").toEqual(["t0", "w0"]);
    expect([...tintAt(v, 1.0005)], "the free sample").toEqual([]);
    expect(v.conflicts.count, "within the tolerance: not named").toBe(0);
  });

  it("a confirmed touch deep in a proven free stretch: the radius ends at it, counted and placed as a contradiction", () => {
    const held = gen(0, [{ pair: 0, enter: 1, exit: 2, witness: 1.4, flags: 0 }]);
    const cur = gen(1, [{ pair: 0, enter: 0, exit: 0.5, freeAt: 1.5, freeR: 0.2 }]);
    const v = view([held], [cur]);
    expect(v.conflicts).toEqual({ count: 1, at: 1.4 });
    expect([...tintAt(v, 1.4)].sort(), "the witness stays").toEqual(["t0", "w0"]);
    expect([...tintAt(v, 1.5)], "the free sample stays free").toEqual([]);
    expect([...tintAt(v, 1.65)], "the radius ends at the witness's distance").toEqual(["t0", "w0"]);
  });

  it("per pair AND origin (plan 3.5): a range sweep's boundary contact never merges with a program contact of the pair", () => {
    const held = gen(0, [{ pair: 0, enter: 0, exit: 1 }]);
    const cur = gen(1, [{ pair: 0, enter: 0.5, exit: 2 }]);
    cur.episodes.set(0, "flags", ORIGIN_BOUNDARY);
    const v = view([held], [cur]);
    expect(list(v).map(t => [t.pos, t.end, t.key]), "the program's contact alone is a finding, to its own end").toEqual([[0, 1, "C0|0|0"]]);
    expect([...tintAt(v, 1.5)].sort(), "the boundary contact still touches").toEqual(["t0", "w0"]);
  });

  it("the words: a piece counts once, by what it holds (a rapid old one stays rapid)", () => {
    const held = gen(0, [{ pair: 0, enter: 1, exit: 2 }]);
    held.episodes.set(0, "flags", EP_RAPID);
    const cur = gen(1, [{ pair: 0, enter: 1.1, exit: 2.1 }]);
    const v = view([held], [cur]);
    expect(viewCounts(v)).toEqual({ collisions: 1, entryCollisions: 0, nearMisses: 0, possible: 0, startsIn: false });
    expect(targetAt(v, 0, () => 3).rapid).toBe(true);
    expect(lineMark(v, 3, [[0, 3]]), "the marks read both generations' stays").toEqual({ line: 3 });
  });

  it("a piece's move kind: a re-entry is a rapid's only by its own touch (IV_RAPID) — never by its episode's margin entry (R168)", () => {
    // one episode entered on a rapid, three touches: the first, a feed
    // re-entry, a rapid re-entry — in both generations, so every target is a
    // union piece of the two
    const twoGen = (g: number) => {
      const st = new ContactStore(1, g, REQUEST_BUDGET);
      const ep = st.episodes.append({ pair: 0, ordinal: 0, flags: EP_RAPID, onset: 1, end: 6, closeAt: 1, closeDist: 0, firstIv: NONE, ivCount: 3 });
      let last = -1;
      for (const [a, b, f] of [[1, 2, 0], [3, 4, 0], [5, 6, IV_RAPID]] as const) {
        const iv = st.intervals.append({ episode: ep, enter: a + g * 0.01, exit: b, flags: D | f, next: NONE, witness: a + 0.5, freeAt: b + 0.25, freeR: 0.1 });
        if (last < 0) st.episodes.set(ep, "firstIv", iv); else st.intervals.set(last, "next", iv);
        last = iv;
      }
      return st;
    };
    const v = view([twoGen(0)], [twoGen(1)]);
    expect(list(v).map(t => (t.kind & T_RAPID) !== 0)).toEqual([true, false, true]);
  });

  it("Codex R151 VP-I113: two old contacts a tool gap apart stay two after an empty rerun — a wide gap and a point gap, both keys, the second selectable and navigable", () => {
    const empty = gen(1, []);
    for (const [label, s0, e0] of [["a wide gap", 1, 3], ["a point gap", 1, 1]] as const) {
      // ended where the tool became unknown (no exit claimed); after it a contact begins anew
      const old = gen(0, [{ pair: 0, enter: 0, exit: NaN, witness: 0.5, flags: IV_ENTER_DECIDED | IV_ENDED_AT_GAP },
                          { pair: 0, enter: e0, exit: e0 + 1, witness: e0 + 0.5, flags: D | IV_AFTER_UNKNOWN_TOOL }],
                     { gaps: [[0, s0, e0, GAP_TOOL_UNKNOWN]] });
      const before = buildContactView({ sources: [{ stores: [old], at: c => c, ownCoverage: 5 }], pairName: names, coverage: 5 });
      const after = buildContactView({ sources: [{ stores: [empty], held: [old], heldCoverage: [5], at: c => c, ownCoverage: 0 }], pairName: names, coverage: 5 });
      expect([before.n, after.n], label).toEqual([2, 2]);
      expect(list(after).map(t => [t.pos, t.end, t.key]), label).toEqual(list(before).map(t => [t.pos, t.end, t.key]));
      const second = targetKey(before, 1);
      expect(findKey(after, second), `${label}: the second event selectable`).toBe(1);
      // navigation from the second event, shown where the timeline stands
      const at = targetPos(after, 1);
      expect(indexAfter(after, at, { key: second, pos: at }), `${label}: the next after it, wrapping`).toBe(0);
      expect([...tintAt(after, s0)], `${label}: the gap itself stays dark`).toEqual([]);
    }
  });

  it("a separator only one generation saw: the other's interval reaching over it is two events — the part after begins at the zone's start, named by the gap", () => {
    // the rerun's contact ended where the tool became unknown at 1 (known again at 1.5); the earlier run, coarser, [0, 3]
    const cur = gen(1, [{ pair: 0, enter: 0, exit: NaN, witness: 0.25, flags: IV_ENTER_DECIDED | IV_ENDED_AT_GAP }], { gaps: [[0, 1, 1.5, GAP_TOOL_UNKNOWN]] });
    const held = gen(0, [{ pair: 0, enter: 0, exit: 3, witness: 0.25 }]);
    const v = view([held], [cur], 3);
    expect(list(v).map(t => [t.pos, t.end, t.key]), "before the gap the earlier event; after it a piece of its own, begun at the gap's end")
      .toEqual([[0, 1, "C0|0|0"], [1.5, 3, "C0|0|0#g0/s1:0"]]);
    expect(findKey(v, "C0|0|0#g0/s1:0")).toBe(1);
    expect(targetKind(v, 1) & T_REENTRY, "not begun at an enter").toBe(T_REENTRY);
    // inside a separator lies no event (the two runs of one request cannot differ on the tool — this is the defensive case)
    expect([...tintAt(v, 1.25)], "inside the separator: dark").toEqual([]);
    expect([[...tintAt(v, 0.5)].length, [...tintAt(v, 2)].length], "beside it: contact").toEqual([2, 2]);
  });

  it("Codex R151 VP-I113 at one shown position: a point contact ended at a point gap and the contact after it — two events, each selectable, navigation between them", () => {
    // the earlier run touched at 1 only and the tool became unknown there; known again at once, a contact [1, 2]
    const old = gen(0, [{ pair: 0, enter: 1, exit: NaN, witness: 1, flags: IV_ENTER_DECIDED | IV_ENDED_AT_GAP },
                        { pair: 0, enter: 1, exit: 2, witness: 1.5, flags: D | IV_AFTER_UNKNOWN_TOOL }], { gaps: [[0, 1, 1, GAP_TOOL_UNKNOWN]] });
    const before = buildContactView({ sources: [{ stores: [old], at: c => c, ownCoverage: 5 }], pairName: names, coverage: 5 });
    const after = buildContactView({ sources: [{ stores: [gen(1, [])], held: [old], heldCoverage: [5], at: c => c, ownCoverage: 0 }], pairName: names, coverage: 5 });
    for (const [label, v] of [["before the fallback", before], ["after it", after]] as const) {
      expect(list(v).map(t => [t.pos, t.end, t.key]), label).toEqual([[1, 1, "C0|0|0"], [1, 2, "C0|1|0"]]);
      expect([findKey(v, "C0|0|0", 1), findKey(v, "C0|1|0", 1)], `${label}: each by its key at the one position`).toEqual([0, 1]);
      expect(indexAfter(v, 1, { key: "C0|0|0", pos: 1 }), `${label}: next from the first`).toBe(1);
      expect(indexBefore(v, 1, { key: "C0|1|0", pos: 1 }), `${label}: previous from the second`).toBe(0);
    }
  });

  it("a bisection's point gap inside a longer gap: the longer one still darkens its stretch (ends need not rise with starts)", () => {
    // the main loop's undecidable stretch [1, 3]; a bisection named a point at 2 inside it, written later; then [5, 6]
    const st = gen(0, [{ pair: 0, enter: 0, exit: 7, witness: 0.5 }], { gaps: [[0, 1, 3], [0, 5, 6], [0, 2, 2]] });
    const v = buildContactView({ sources: [{ stores: [st], at: c => c, ownCoverage: 8 }], pairName: names, coverage: 8 });
    expect([...tintAt(v, 2.5)], "inside [1, 3], past the point at 2").toEqual([]);
    expect([[...tintAt(v, 0.5)].length, [...tintAt(v, 4)].length, [...tintAt(v, 5.5)].length]).toEqual([2, 2, 0]);
    expect(contactBands(v, 8, 8), "the bands: [0, 1], [3, 5], [6, 7]").toEqual([[0, 0.125], [0.375, 0.625], [0.75, 0.875]]);
  });

  it("Codex R151 VP-I113, the defined handover: two old events one piece holds (a confirmed point on the free sample between them) — the second key selects that piece", () => {
    // old: [0, 1] and [1.25, 2] apart by a point free sample at 1.125; the new run touched exactly there
    const old = gen(0, [{ pair: 0, enter: 0, exit: 1, witness: 0.5, freeAt: 1.125, freeR: 0 }, { pair: 0, enter: 1.25, exit: 2, witness: 1.5 }]);
    const cur = gen(1, [{ pair: 0, enter: 0.75, exit: 1.5, witness: 1.125, flags: 0 }]);
    const v = view([old], [cur]);
    expect(list(v).map(t => [t.pos, t.end, t.key]), "one piece, the earlier witness's key").toEqual([[0, 2, "C0|0|0"]]);
    expect(findKey(v, "C0|1|0"), "the second event's key: the piece holding its interval").toBe(0);
    expect(indexAfter(v, 0, { key: "C0|1|0", pos: 0 }), "and navigation from it").toBe(0);
    expect(findKey(v, "C0|2|0"), "an event never there: none").toBe(-1);
  });

  it("Codex R151: an exact point free sample stays dark after the union — its two neighbours touch, two events", () => {
    const old = gen(0, [{ pair: 0, enter: 0, exit: 0.5, witness: 0.25, freeAt: 1, freeR: 0 }, { pair: 0, enter: 1.5, exit: 2, witness: 1.75 }]);
    const cur = gen(1, [{ pair: 0, enter: 0, exit: 2, witness: 0.25 }]);
    const v = view([old], [cur], 2);
    expect(v.n).toBe(2);
    expect([[...tintAt(v, 1)], [...tintAt(v, 0.999)].length, [...tintAt(v, 1.001)].length]).toEqual([[], 2, 2]);
  });

  it("Codex R151 VP-I114 through the tables: a touch on a free sample of radius 0.0015 — 0.0015 from both edges — is named", () => {
    const held = gen(0, [{ pair: 0, enter: 1, exit: 2, witness: 1.5, flags: 0 }]);
    const near = (r: number) => view([held], [gen(1, [{ pair: 0, enter: 0, exit: 0.5, witness: 0.25, freeAt: 1.5, freeR: r }])], 2);
    expect(near(0.0015).conflicts.count, "above the tolerance (f32 0.0015000000130…)").toBe(1);
    expect(near(0.0009).conflicts.count, "below it").toBe(0);
    expect([...tintAt(near(0.0015), 1.5)].length, "kept as contact").toBe(2);
  });

  it("at the budget: two generations of the request and of a side run, as one union each — held within 8.4 MB after the queries, one pair holding the budget too", { timeout: 300_000 }, () => {
    const full = (generation: number, b: StoreBudget, shift: number, free: boolean) => {
      const st = new ContactStore(1, generation, b);
      const per = Math.floor(b.intervals / b.episodes);
      for (let e = 0; e < b.episodes; e++) {
        const p = e * 4;
        const ep = st.episodes.append({ pair: e, ordinal: 0, flags: 0, onset: p + shift, end: p + shift + 3.25, closeAt: p, closeDist: 0, firstIv: NONE, ivCount: per });
        let last = -1;
        for (let k = 0; k < per; k++) {
          // a free sample after every exit, its stretch inside the other generation's contact
          const enter = p + k + shift, exit = enter + (free ? 0.75 : 0.25);
          const iv = st.intervals.append({ episode: ep, enter, exit, flags: D, next: NONE, witness: enter,
                                           freeAt: free ? exit + 0.125 : NaN, freeR: free ? 0.05 : 0 });
          if (last < 0) st.episodes.set(ep, "firstIv", iv); else st.intervals.set(last, "next", iv);
          last = iv;
        }
      }
      for (let g = 0; g < b.gaps; g++) st.gaps.append({ pair: g, start: g * 4 + 0.5, end: g * 4 + 0.6, reason: GAP_UNDECIDABLE });
      return st;
    };
    const side = shareOf(REQUEST_BUDGET, 8);
    // the 8.4 MB of R148, and what Codex R158 (VP-I115) added — the component
    // ends, the block indexes, two u32 a gap, the episode index, the near
    // misses' order (derivationBound's terms)
    const terms = derivationBound(REQUEST_BUDGET, side).terms;
    const LIMIT = 8_400_000 + terms.componentEnds! + terms.blockIndexes! + 8 * 2 * (REQUEST_BUDGET.gaps + side.gaps)
                + terms.episodeIndex! + 4 * (REQUEST_BUDGET.episodes + side.episodes);
    /** One pair holding the whole interval budget (Codex R151): 4 contacts an episode, a free sample between. */
    const onePair = (generation: number, b: StoreBudget) => {
      const st = new ContactStore(1, generation, b);
      let ep = -1, last = -1;
      for (let i = 0; i < b.intervals; i++) {
        if (i % 4 === 0) { ep = st.episodes.append({ pair: 0, ordinal: i / 4, flags: 0, onset: 3 * i, end: 3 * i + 12, closeAt: 3 * i, closeDist: 0, firstIv: NONE, ivCount: 4 }); last = -1; }
        const iv = st.intervals.append({ episode: ep, enter: 3 * i, exit: 3 * i + 1, flags: D, next: NONE, witness: 3 * i + 0.5, freeAt: 3 * i + 2, freeR: 0.25 });
        if (last < 0) st.episodes.set(ep, "firstIv", iv); else st.intervals.set(last, "next", iv);
        last = iv;
      }
      return st;
    };
    const queries = (v: ReturnType<typeof buildContactView>, end: number) => {
      // what the views ask: the window, the bands, the tint, a target in every 64th, a key
      targetWindow(v, v.n >> 1, 50, () => 1);
      contactBands(v, 8192, end);
      for (let q = 0; q < 200; q++) tintAt(v, (q * 7919.37) % end);
      for (let i = 0; i < v.n; i += 64) targetAt(v, i, () => 1);
      findKey(v, targetKey(v, v.n - 1));
    };
    {
      const cov1 = 3 * REQUEST_BUDGET.intervals + 10, covS = 3 * side.intervals + 10;
      const v = buildContactView({ sources: [
        { stores: [onePair(1, REQUEST_BUDGET)], held: [onePair(0, REQUEST_BUDGET)], heldCoverage: [cov1], at: c => c, ownCoverage: cov1 },
        { stores: [onePair(1, side)], held: [onePair(0, side)], heldCoverage: [covS], at: c => c, entry: true, ownCoverage: covS },
      ], pairName: names, coverage: cov1 });
      const before = heldBytes(v);
      queries(v, cov1);
      console.log(`[B4 union budget] one pair holding the budget: targets ${v.n}, held ${(heldBytes(v) / 1e6).toFixed(2)} MB after the queries`);
      expect(heldBytes(v), "the queries hold nothing more").toBe(before);
      expect(heldBytes(v)).toBeLessThanOrEqual(LIMIT);
    }
    for (const [name, shift, free] of [["the same contacts twice", 0, false], ["shifted, every free sample cutting", 0.5, true]] as const) {
      const t0 = performance.now();
      const v = buildContactView({ sources: [
        { stores: [full(1, REQUEST_BUDGET, shift, free)], held: [full(0, REQUEST_BUDGET, 0, free)], at: c => c, ownCoverage: 4 * REQUEST_BUDGET.episodes + 1 },
        { stores: [full(1, side, shift, free)], held: [full(0, side, 0, free)], at: c => c, entry: true, ownCoverage: 4 * side.episodes + 1 },
      ], pairName: names, coverage: 4 * REQUEST_BUDGET.episodes + 1 });
      const ms = performance.now() - t0;
      const t1 = performance.now();
      const c = viewCounts(v);
      const bands = contactBands(v, 8192, 4 * REQUEST_BUDGET.episodes + 1);
      const t2 = performance.now();
      queries(v, 4 * REQUEST_BUDGET.episodes + 1);
      const held = heldBytes(v);
      console.log(`[B4 union budget] ${name}: targets ${v.n}, held ${(held / 1e6).toFixed(2)} MB (limit 8.4), build ${ms.toFixed(0)} ms, ` +
                  `counts + bands ${(t2 - t1).toFixed(0)} ms (${c.collisions} collisions, ${bands.length} band runs)`);
      expect(held).toBeLessThanOrEqual(LIMIT);
      // what it answers stays exact at that size: pair 1000's contact; shifted, pair 999's new one reaches it too
      expect([...tintAt(v, 4 * 1000 + 0.1)].sort()).toEqual(shift ? ["t1000", "t999", "w1000", "w999"] : ["t1000", "w1000"]);
    }
  });
});
