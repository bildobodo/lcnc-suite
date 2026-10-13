import { describe, expect, it } from "vitest";
import { ContactStore, GAP_TOOL_UNKNOWN, IV_ENDED_AT_GAP, NONE } from "./contactStore";
import { entryJoins, toBaseAxis } from "./contactMerge";

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
    const j = entryJoins(entry, base);
    expect([...j.entries()], "pair 4's first base interval only").toEqual([[0, 0]]);
  });

  it("an entry contact with an exit never joins — the sweep closed it at a decided free sample; nor does a base contact beginning after the first point", () => {
    const entry = store([{ pair: 1, ivs: [[8, 10]] }, { pair: 2, ivs: [[9, NaN]] }]);
    const base = store([{ pair: 1, ivs: [[0, 4]] }, { pair: 2, ivs: [[0.5, 4]] }]);
    expect([...entryJoins(entry, base).entries()]).toEqual([]);
  });

  it("one to one: two base episodes of a pair in contact at the start take one entry contact each, never the same", () => {
    const entry = store([{ pair: 1, ivs: [[9, NaN]] }]);
    const base = store([{ pair: 1, ivs: [[0, 1]] }, { pair: 1, ivs: [[0, 2]] }]);
    expect(entryJoins(entry, base).size).toBe(1);
  });

  it("a contact ended at an unknown tool is not on at the end; the contact after the gap is (Codex R144 VP-I97)", () => {
    const entry = new ContactStore(1, 0), base = store([{ pair: 0, ivs: [[0, NaN]] }]);
    entry.episodes.append({ pair: 0, firstIv: 0, ivCount: 1, onset: 1, end: 2 });
    entry.intervals.append({ episode: 0, enter: 1, exit: NaN, flags: IV_ENDED_AT_GAP, next: NONE, witness: 1, freeAt: NaN });
    entry.gaps.append({ pair: 0, start: 2, end: 9, reason: GAP_TOOL_UNKNOWN });
    entry.episodes.append({ pair: 0, firstIv: 1, ivCount: 1, onset: 9, end: NaN });
    entry.intervals.append({ episode: 1, enter: 9, exit: NaN, next: NONE, witness: 9, freeAt: NaN });
    expect([...entryJoins(entry, base).entries()]).toEqual([[0, 1]]);
  });

  it("a proven separation just before a long entry's end is never bridged, whatever the entry's length (Codex R144 VP-I97)", () => {
    const entry = new ContactStore(1, 0), base = store([{ pair: 0, ivs: [[0, NaN]] }]);
    entry.episodes.append({ pair: 0, firstIv: 0, ivCount: 1, onset: 900, end: 999.5 });
    entry.intervals.append({ episode: 0, enter: 900, exit: 999.5, next: NONE, witness: 990, freeAt: 999.75 });
    expect([...entryJoins(entry, base).entries()]).toEqual([]);
  });

  it("the base's first checked point is where it starts: a start-dependent beginning's end, not cum 0", () => {
    const entry = store([{ pair: 3, ivs: [[5, NaN]] }]);
    expect([...entryJoins(entry, store([{ pair: 3, ivs: [[12.5, 20]] }]), 12.5).entries()]).toEqual([[0, 0]]);
    expect([...entryJoins(entry, store([{ pair: 3, ivs: [[12.75, 20]] }]), 12.5).entries()], "a re-entry after it").toEqual([]);
  });
});

describe("the beginning on the base axis", () => {
  it("max(0, c − shift); rows are not merged by position", () => {
    expect([toBaseAxis(3, 5), toBaseAxis(5, 5), toBaseAxis(7.5, 5)]).toEqual([0, 0, 2.5]);
  });
});
