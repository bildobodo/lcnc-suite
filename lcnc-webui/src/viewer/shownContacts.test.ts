// Round B3: which tables a shown track reads, as one view (shownContacts.ts).
import { describe, expect, it } from "vitest";
import { ContactStore, NONE } from "./contactStore";
import { lineMark, targetAt, targetEnd, tintAt, trackLineAt } from "./contactView";
import type { GenerationTables } from "./contactsReceiver";
import { shownContactView, specKey, type ShownSpec } from "./shownContacts";

function tables(id: number, ivs: Array<[number, number]>, pairs: Array<[string, string]>): GenerationTables {
  const st = new ContactStore(id, 0);
  ivs.forEach(([a, b], k) => {
    const ep = st.episodes.append({ pair: 0, ordinal: k, onset: a, end: b, closeAt: a, closeDist: 0, firstIv: NONE, ivCount: 1 });
    st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: a, exit: b, flags: 0, next: NONE, witness: a, freeAt: NaN }));
  });
  return { generation: 0, stores: [st], pairs, deltas: 1 };
}

describe("a run check's bound beginning, folded onto the base (plan 3.3, 1.3)", () => {
  // the bound track: lines 21 (0..2), 22 (2..4), 23 (4..10); K at 10 — all of it folds to 0 on the base
  const bound = { count: 4, cum: [0, 2, 4, 10], lines: [21, 21, 22, 23] };
  // the base track: line 5 owns 0 .. 5
  const base = { count: 2, cum: [0, 5], lines: [5, 5] };
  const T = new Map<number, GenerationTables>([[1, tables(1, [], [["tool", "work"]])], [-1, tables(-1, [[2.5, 3]], [["tool", "work"]])]]);
  const spec: ShownSpec = { base: { id: 1, map: null, coverage: 5, ownEnd: 5 },
    side: { id: -1, map: { kind: "minus", shift: 10 }, coverage: 0, ownEnd: 10, entry: true, entryEnd: 1, sweptToEnd: true, track: bound }, axisEnd: 5 };
  it("its event's line is its own track's, and it marks its own lines — never every line the fold lands on", () => {
    const v = shownContactView(id => T.get(id) ?? null, spec)!;
    const t = targetAt(v, 0, trackLineAt(base));
    expect([v.n, t.line, t.cum]).toEqual([1, 22, 0]);
    expect(lineMark(v, 22, [], trackLineAt(base)), "its own line").toEqual({ line: 22 });
    expect(lineMark(v, 21, [], trackLineAt(base)), "its own line before it: nothing").toBeNull();
    expect(lineMark(v, 5, [[0, 5]], trackLineAt(base)), "the base line at 0: not by the fold").toBeNull();
  });
  it("the cache key leaves the track's arrays out", () => {
    expect(specKey(spec)).not.toContain("cum");
    expect(JSON.parse(specKey(spec)).side.id).toBe(-1);
  });
});

describe("after a fallback: the earlier generation beside the current one, with its own coverage (plan 3.5, Codex R150 VP150-02)", () => {
  /** A generation of request 1 with one open contact of pair 0 from 0. */
  function openGen(generation: number, covered?: number[]): GenerationTables {
    const st = new ContactStore(1, generation);
    const ep = st.episodes.append({ pair: 0, ordinal: 0, onset: 0, end: NaN, closeAt: 0, closeDist: 0, firstIv: NONE, ivCount: 1 });
    st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: 0, exit: NaN, flags: 0, next: NONE, witness: 0, freeAt: NaN }));
    return { generation, stores: [st], pairs: [["tool", "work"]], deltas: 1, ...(covered ? { covered } : {}) };
  }
  it("the earlier run's open contact keeps the stretch its pool had swept while the new run has nothing yet", () => {
    // the pool fell back at 15 of a 32 track: its open contact's rows name 0 alone
    const held = openGen(0, [15 / 32]);
    const cur: GenerationTables = { generation: 1, stores: [new ContactStore(1, 1)], pairs: null, deltas: 1 };
    const spec: ShownSpec = { base: { id: 1, map: null, coverage: 0, ownEnd: 32 }, side: null, axisEnd: 32 };
    const v = shownContactView(id => (id === 1 ? cur : null), spec, undefined, id => (id === 1 ? held : null))!;
    expect([v.n, targetEnd(v, 0)], "one event, to where the pool had swept").toEqual([1, 15]);
    expect([...tintAt(v, 7.5)].sort()).toEqual(["tool", "work"]);
    // without the pool's word, its rows alone would say 0
    const bare = shownContactView(id => (id === 1 ? cur : null), spec, undefined, id => (id === 1 ? openGen(0) : null))!;
    expect(targetEnd(bare, 0), "the lower bound alone").toBe(0);
  });
});
