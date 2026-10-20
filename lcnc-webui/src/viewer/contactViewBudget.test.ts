// Round B4 after Codex R152 (VP-I112): what a view holds besides its tables
// stays within the bound derived from the store budgets (contactView
// derivationBound) — at the budget, after the queries, in the shapes that
// drive each term: a request's and a side run's two generations as unions,
// every free sample cutting; full gap budgets of both reasons on one pair and
// on a pair each; pieces begun at separators (generations that disagree on
// the tool); every episode beside the contacts a near miss, matched.
import { describe, expect, it } from "vitest";
import {
  ContactStore, GAP_TOOL_UNKNOWN, GAP_UNDECIDABLE, IV_AFTER_UNKNOWN_TOOL, IV_ENDED_AT_GAP, IV_ENTER_DECIDED, IV_EXIT_DECIDED, NONE,
  REQUEST_BUDGET, shareOf, type StoreBudget,
} from "./contactStore";
import { buildContactView, contactBands, derivationBound, findKey, heldBytes, targetAt, targetKey, targetWindow, tintAt, type ContactView } from "./contactView";

const D = IV_ENTER_DECIDED | IV_EXIT_DECIDED;
const SIDE = shareOf(REQUEST_BUDGET, 8);
const names = (p: number) => ({ a: `t${p}`, b: `w${p}` });

interface Shape {
  /** One episode holds all the contacts (the rest of the episode budget is free for near misses). */
  oneEpisode?: boolean;
  /** Every episode the contacts leave is a near miss, the two generations' matched. */
  nears?: boolean;
  gaps?: "none" | "one pair" | "a pair each";
  reason?: number;
}
/** A generation of request `req` at budget `b`: the interval budget on pair 0,
 *  the later generation shifted by 1.5 so each free sample (radius 0.1) cuts
 *  the other's contact without lying on a confirmed point. */
function table(req: number, generation: number, b: StoreBudget, o: Shape): ContactStore {
  const st = new ContactStore(req, generation, b);
  const later = generation === 1;
  let ep = -1, last = -1, used = 0;
  for (let i = 0; i < b.intervals; i++) {
    if (o.oneEpisode ? i === 0 : i % 4 === 0) {
      const at = 3 * i + (later ? 1.5 : 0);
      ep = st.episodes.append({ pair: 0, ordinal: used, flags: 0, onset: at, end: at + 12, closeAt: at, closeDist: 0, firstIv: NONE,
                                ivCount: o.oneEpisode ? b.intervals : 4 });
      used++;
      last = -1;
    }
    const enter = 3 * i + (later ? 1.5 : 0);
    const iv = st.intervals.append({ episode: ep, enter, exit: enter + 1, flags: D, next: NONE, witness: later ? enter + 0.1 : enter + 0.5,
                                     freeAt: later ? 3 * i + 3.2 : 3 * i + 2, freeR: 0.1 });
    if (last < 0) st.episodes.set(ep, "firstIv", iv); else st.intervals.set(last, "next", iv);
    last = iv;
  }
  if (o.nears) {
    for (let e = used; e < b.episodes; e++) {
      const at = 3 * b.intervals + 10 + 4 * e;
      st.episodes.append({ pair: 1 + (e % 64), ordinal: e, flags: 0, onset: at, end: at + 1, closeAt: at + 0.5, closeDist: 1, firstIv: NONE, ivCount: 0 });
    }
  }
  if (o.gaps && o.gaps !== "none") {
    for (let g = 0; g < b.gaps; g++) {
      const at = 3 * b.intervals + 10 + 4 * b.episodes + 3 * g;
      st.gaps.append({ pair: o.gaps === "one pair" ? 1 : 1 + g, start: at, end: at + 1, reason: o.reason ?? GAP_TOOL_UNKNOWN });
    }
  }
  return st;
}
/** Generations that disagree on the tool: the earlier one's long contacts
 *  reach over tool gaps only the later one saw — each a piece begun at a
 *  separator. */
function separatorTables(req: number, b: StoreBudget): [ContactStore, ContactStore] {
  const held = new ContactStore(req, 0, b), cur = new ContactStore(req, 1, b);
  const n = Math.min(b.episodes, b.gaps);
  for (let i = 0; i < n; i++) {
    const ep = held.episodes.append({ pair: 0, ordinal: i, flags: 0, onset: 6 * i, end: 6 * i + 5, closeAt: 6 * i, closeDist: 0, firstIv: NONE, ivCount: 1 });
    held.episodes.set(ep, "firstIv", held.intervals.append({ episode: ep, enter: 6 * i, exit: 6 * i + 5, flags: D, next: NONE, witness: 6 * i + 0.5,
                                                             freeAt: 6 * i + 5.5, freeR: 0.2 }));
    // the later run: unknown in the middle of it, contacts ended at the gap and after it
    const e2 = cur.episodes.append({ pair: 0, ordinal: 2 * i, flags: 0, onset: 6 * i, end: 6 * i + 2, closeAt: 6 * i, closeDist: 0, firstIv: NONE, ivCount: 1 });
    cur.episodes.set(e2, "firstIv", cur.intervals.append({ episode: e2, enter: 6 * i, exit: NaN, flags: IV_ENTER_DECIDED | IV_ENDED_AT_GAP, next: NONE,
                                                           witness: 6 * i + 0.5, freeAt: NaN, freeR: 0 }));
    cur.gaps.append({ pair: 0, start: 6 * i + 2, end: 6 * i + 2.5, reason: GAP_TOOL_UNKNOWN });
    if (2 * i + 1 < b.episodes) {
      const e3 = cur.episodes.append({ pair: 0, ordinal: 2 * i + 1, flags: 0, onset: 6 * i + 3, end: 6 * i + 5, closeAt: 6 * i + 3, closeDist: 0, firstIv: NONE, ivCount: 1 });
      cur.episodes.set(e3, "firstIv", cur.intervals.append({ episode: e3, enter: 6 * i + 3, exit: 6 * i + 5, flags: D | IV_AFTER_UNKNOWN_TOOL, next: NONE,
                                                             witness: 6 * i + 3.5, freeAt: 6 * i + 5.5, freeR: 0.2 }));
    }
  }
  return [held, cur];
}

/** What the views ask: the window, the bands, the tint, a target every 64th, a key. */
function queries(v: ContactView, end: number): void {
  targetWindow(v, v.n >> 1, 50, () => 1);
  contactBands(v, 8192, end);
  for (let q = 0; q < 200; q++) tintAt(v, (q * 7919.37) % end);
  for (let i = 0; i < v.n; i += 64) targetAt(v, i, () => 1);
  if (v.n) findKey(v, targetKey(v, v.n - 1));
}
function view(main: [ContactStore, ContactStore], side: [ContactStore, ContactStore], end: number): ContactView {
  return buildContactView({ sources: [
    { stores: [main[1]], held: [main[0]], heldCoverage: [end], at: c => c, ownCoverage: end },
    { stores: [side[1]], held: [side[0]], heldCoverage: [end], at: c => c, entry: true, ownCoverage: end },
  ], pairName: names, coverage: end });
}

describe("what a view holds stays within the bound derived from the budgets (Codex R152 VP-I112)", () => {
  const bound = derivationBound(REQUEST_BUDGET, SIDE);
  it("the bound, term by term", () => {
    console.log(`[B4 bound] ${(bound.bytes / 1e6).toFixed(3)} MB: ${Object.entries(bound.terms).map(([k, x]) => `${k} ${(x / 1e6).toFixed(3)}`).join(", ")}`);
    // 10.91 MB (R152) + Codex R158 VP-I115: the component ends 2.36 MB (the
    // u32 an interval accepted), the block indexes 0.07 MB, two u32 a gap
    // 0.29 MB, the episode index 0.59 MB, the near misses' order 0.29 MB;
    // R159: the third block index (the previous free sample) 0.04 MB, the
    // targets' least and largest jump point per block 0.37 MB; R168 VP-I122:
    // the fourth block index (the next interval of a rapid's move) 0.04 MB
    expect(bound.bytes, "the derived bound, 14.96 MB").toBe(14_962_848);
    expect(bound.terms.componentEnds).toBe(2_359_296);
  });

  const shapes: Array<[string, Shape]> = [
    ["every free sample cutting, no gaps", {}],
    ["Codex R152: full gap budgets on one pair, undecidable", { gaps: "one pair", reason: GAP_UNDECIDABLE }],
    ["Codex R152: full gap budgets on one pair, tool unknown", { gaps: "one pair", reason: GAP_TOOL_UNKNOWN }],
    ["tool gaps on a pair each", { gaps: "a pair each", reason: GAP_TOOL_UNKNOWN }],
    ["one episode of contacts, every other episode a matched near miss, tool gaps on a pair each", { oneEpisode: true, nears: true, gaps: "a pair each" }],
  ];
  it.each(shapes)("%s", { timeout: 300_000 }, (_, o) => {
    const end = 3 * REQUEST_BUDGET.intervals + 10 + 4 * REQUEST_BUDGET.episodes + 3 * REQUEST_BUDGET.gaps + 10;
    const v = view([table(1, 0, REQUEST_BUDGET, o), table(1, 1, REQUEST_BUDGET, o)], [table(-1, 0, SIDE, o), table(-1, 1, SIDE, o)], end);
    const before = heldBytes(v);
    queries(v, end);
    const held = heldBytes(v);
    console.log(`[B4 bound] ${_}: targets ${v.n}, conflicts ${v.conflicts.count}, held ${(held / 1e6).toFixed(3)} MB = ${(100 * held / bound.bytes).toFixed(1)} % of the bound`);
    expect(v.conflicts.count, "no confirmed point contradicted: the shape is possible").toBe(0);
    expect(held, "the queries hold nothing more").toBe(before);
    expect(held).toBeLessThanOrEqual(bound.bytes);
  });

  it("pieces begun at separators: generations that disagree on the tool", { timeout: 300_000 }, () => {
    const end = 6 * REQUEST_BUDGET.gaps + 10;
    const v = view(separatorTables(1, REQUEST_BUDGET), separatorTables(-1, SIDE), end);
    queries(v, end);
    const held = heldBytes(v);
    console.log(`[B4 bound] pieces begun at separators: targets ${v.n}, held ${(held / 1e6).toFixed(3)} MB = ${(100 * held / bound.bytes).toFixed(1)} % of the bound`);
    // each earlier contact two pieces: before the gap, and from its end on
    expect(v.n).toBe(2 * REQUEST_BUDGET.gaps + 2 * SIDE.gaps);
    expect(held).toBeLessThanOrEqual(bound.bytes);
  });
});
