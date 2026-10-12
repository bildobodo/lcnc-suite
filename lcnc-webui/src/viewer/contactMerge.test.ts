import { describe, expect, it } from "vitest";
import { ContactStore, NONE } from "./contactStore";
import { entryJoins, poolCoverage, toBaseAxis } from "./contactMerge";

/** A store with episodes of the given pairs, each with its intervals [enter, exit] (NaN = open). */
function store(eps: Array<{ pair: number; ivs: Array<[number, number]> }>): ContactStore {
  const s = new ContactStore(1, 0);
  for (const [k, e] of eps.entries()) {
    const ep = s.episodes.append({ pair: e.pair, ordinal: k, onset: e.ivs[0]?.[0] ?? 0, end: NaN, closeAt: 0, closeDist: 0, firstIv: NONE });
    let last = -1;
    for (const [a, b] of e.ivs) {
      const iv = s.intervals.append({ episode: ep, enter: a, exit: b, next: NONE, witness: a, freeAt: NaN });
      if (last < 0) s.episodes.set(ep, "firstIv", iv); else s.intervals.set(last, "next", iv);
      s.episodes.set(ep, "ivCount", s.episodes.get(ep, "ivCount") + 1);
      last = iv;
    }
  }
  return s;
}

describe("the entry move's contacts joined with the program's, on tables (plan 3.3)", () => {
  it("an entry contact on at the first point continues the base's first interval there — its re-entries stay the program's", () => {
    const entry = store([{ pair: 4, ivs: [[3, NaN]] }, { pair: 5, ivs: [[1, 2]] }]);
    const base = store([{ pair: 4, ivs: [[0, 1], [2, 3]] }, { pair: 5, ivs: [[0, 1]] }, { pair: 6, ivs: [[0, 1]] }]);
    const j = entryJoins(entry, base, 10);
    expect([...j.entries()], "pair 4's first base interval only").toEqual([[0, 0]]);
  });

  it("an entry contact closed AT the first point joins too; a base contact beginning after the first point does not", () => {
    const entry = store([{ pair: 1, ivs: [[8, 10]] }, { pair: 2, ivs: [[9, 10]] }]);
    const base = store([{ pair: 1, ivs: [[0, 4]] }, { pair: 2, ivs: [[0.5, 4]] }]);
    expect([...entryJoins(entry, base, 10).entries()]).toEqual([[0, 0]]);
  });

  it("one to one: two base episodes of a pair in contact at the start take one entry contact each, never the same", () => {
    const entry = store([{ pair: 1, ivs: [[9, NaN]] }]);
    const base = store([{ pair: 1, ivs: [[0, 1]] }, { pair: 1, ivs: [[0, 2]] }]);
    expect(entryJoins(entry, base, 10).size).toBe(1);
  });
});

describe("the beginning on the base axis and a pool's coverage", () => {
  it("max(0, c − shift); rows are not merged by position", () => {
    expect([toBaseAxis(3, 5), toBaseAxis(5, 5), toBaseAxis(7.5, 5)]).toEqual([0, 0, 2.5]);
  });
  it("the least any shard swept and the earliest budget stop", () => {
    expect(poolCoverage([{ covered: 0.8 }, { covered: 0.5, incompleteFrom: 40 }, { covered: 1, incompleteFrom: 12 }]))
      .toEqual({ covered: 0.5, incompleteFrom: 12 });
    expect(poolCoverage([{ covered: 1 }, { covered: 1 }])).toEqual({ covered: 1 });
  });
});
