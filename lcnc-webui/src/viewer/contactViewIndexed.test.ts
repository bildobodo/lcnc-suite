// Codex R158 VP-I115 rest B: a union piece's questions answered from indexes
// — the next free sample by blocks, the component's end the build's walk
// wrote, the piece's facts by bisections — give exactly what the walk over
// every interval gave (the test seam `linearPiecesForTest`), on random
// generations: positions, ends, kinds, keys, the objects, the tint, the
// marks, a key found again.
import { describe, expect, it } from "vitest";
import { buildCollisionModel, sweepCollisions, type CollisionMachine } from "./collision";
import { boxPositions } from "./collisionFixtures";
import { emptyLineIndex } from "./lineIndex";
import {
  ColumnTable, ContactStore, REQUEST_BUDGET, EP_AT_START, EP_RAPID, GAP_TOOL_UNKNOWN, GAP_UNDECIDABLE, IV_AFTER_UNKNOWN_TOOL, IV_CONTINUES_CUT, IV_ENDED_AT_FEED, IV_ENDED_AT_GAP,
  IV_ENTER_DECIDED, IV_EXIT_DECIDED, IV_POSSIBLE, NONE, ORIGIN_BOUNDARY,
} from "./contactStore";
import {
  buildContactView, contactBands, findKey, indexAfter, indexBefore, lineMark, linearPiecesForTest, targetAt, targetEnd, targetKey, targetKind, targetPos, targetWindow,
  tintAt, type ContactView, type ContactViewInput, type SourceJoin,
} from "./contactView";

const names = (p: number) => ({ a: `t${p}`, b: `w${p}` });

/** One generation: per pair and origin, episodes of intervals in time order
 *  (apart, a witness in each, a free sample between them mostly — its radius
 *  within the room, now and then past it), ended at a tool gap or at a feed
 *  now and then, possible ones, undecidable gaps inside contacts, near misses. */
function generation(rnd: () => number, req: number, gen: number): ContactStore {
  const st = new ContactStore(req, gen);
  const E = st.episodes, I = st.intervals;
  const grid = (x: number) => Math.round(x * 8) / 8;
  for (let pair = 0; pair < 3; pair++) {
    for (const origin of [0, ORIGIN_BOUNDARY]) {
      if (origin && rnd() < 0.7) continue;
      let x = grid(rnd() * 3), ordinal = 0;
      const eps = Math.floor(rnd() * 5);
      for (let e = 0; e < eps; e++) {
        if (rnd() < 0.15) {
          // a near miss
          E.append({ pair, ordinal: ordinal++, flags: origin, onset: x, end: x + 0.5, closeAt: x + 0.25, closeDist: 1, firstIv: NONE, ivCount: 0 });
          x += 1 + grid(rnd());
          continue;
        }
        const allPossible = rnd() < 0.25;
        const ep = E.append({ pair, ordinal: ordinal++, flags: origin | (rnd() < 0.2 ? EP_RAPID : 0) | (e === 0 && rnd() < 0.2 ? EP_AT_START : 0),
                              onset: x, end: NaN, closeAt: x, closeDist: 0, firstIv: NONE, ivCount: 0 });
        const ivs = 1 + Math.floor(rnd() * 4);
        let last = -1, count = 0, epEnd = x, after = false;
        for (let k = 0; k < ivs; k++) {
          const len = rnd() < 0.1 ? 0 : grid(0.125 + rnd() * 2);
          const enter = x, exit = x + len;
          const lastOne = e === eps - 1 && k === ivs - 1;
          const open = lastOne && rnd() < 0.3;
          const atGap = !open && rnd() < 0.15, atFeed = !open && !atGap && rnd() < 0.1;
          let flags = (rnd() < 0.7 ? IV_ENTER_DECIDED : 0) | (!open && !atGap && rnd() < 0.7 ? IV_EXIT_DECIDED : 0);
          if (allPossible || rnd() < 0.1) flags |= IV_POSSIBLE;
          if (atGap) flags |= IV_ENDED_AT_GAP;
          if (atFeed) flags |= IV_ENDED_AT_FEED;
          if (k > 0 && rnd() < 0.1) flags |= IV_CONTINUES_CUT;
          if (after) flags |= IV_AFTER_UNKNOWN_TOOL;
          const room = 0.25 + grid(rnd() * 1.5);
          let freeAt = NaN, freeR = 0;
          if (!open && !atGap && !atFeed && rnd() < 0.7) {
            // now and then on the grid, where the other run's decided enters lie:
            // a sample a confirmed point refutes (Codex R160 VP-I115 rest D)
            freeAt = exit + (rnd() < 0.5 ? grid(room * rnd()) : room * rnd());
            freeR = rnd() < 0.2 ? 0 : rnd() < 0.1 ? 3 * rnd() : Math.min(freeAt - exit, exit + room - freeAt) * rnd();
          }
          const witness = enter + len * (rnd() < 0.3 ? 0 : rnd());
          const iv = I.append({ episode: ep, enter, exit: open || atGap ? NaN : exit, flags, next: NONE, witness, freeAt, freeR });
          if (last < 0) E.set(ep, "firstIv", iv); else I.set(last, "next", iv);
          last = iv; count++; epEnd = exit;
          // undecidable answers inside the contact, now and then many
          if (len > 0 && rnd() < 0.3) for (let g = Math.floor(rnd() * 12); g > 0; g--) {
            const s0 = enter + len * rnd();
            st.gaps.append({ pair, start: s0, end: Math.min(exit, s0 + 0.05 * rnd()), reason: GAP_UNDECIDABLE });
          }
          if (atGap) {
            // the tool became unknown where it ended; the next begins after it
            const ge = exit + (rnd() < 0.3 ? 0 : 0.125 + grid(rnd()));
            st.gaps.append({ pair, start: exit, end: ge, reason: GAP_TOOL_UNKNOWN });
            x = ge + (rnd() < 0.5 ? 0 : grid(0.125 + rnd()));
          } else x = exit + room;
          after = atGap;
          if (open) break;
        }
        E.set(ep, "ivCount", count);
        E.set(ep, "end", epEnd);
        x += grid(rnd());
      }
    }
  }
  return st;
}

/** The free samples of one generation a confirmed point of the other refutes
 *  (on the sample itself, same pair and origin) — the cases the free index skips. */
function refutedSamples(a: ContactStore, b: ContactStore): number {
  const group = (st: ContactStore, k: number) => { const e = st.intervals.get(k, "episode"); return st.episodes.get(e, "pair") * 4 + (st.episodes.get(e, "flags") & ORIGIN_BOUNDARY); };
  const points = new Set<string>();
  for (let k = 0; k < b.intervals.rows; k++) {
    const g = group(b, k), f = b.intervals.get(k, "flags");
    points.add(`${g}:${b.intervals.get(k, "witness")}`);
    if (f & IV_ENTER_DECIDED) points.add(`${g}:${b.intervals.get(k, "enter")}`);
    if (f & IV_EXIT_DECIDED) points.add(`${g}:${b.intervals.get(k, "exit")}`);
  }
  let n = 0;
  for (let k = 0; k < a.intervals.rows; k++) if (points.has(`${group(a, k)}:${a.intervals.get(k, "freeAt")}`)) n++;
  return n;
}

/** The view's free block index reads too: after a fallback its test reads
 *  the walk's verdict in the component ends, no table cell — a search that
 *  steps through it reads none (R161: three block-skip mutations went green). */
function countIndex(v: ContactView, inc: () => void): void {
  for (const u of (v as unknown as { unions: Array<{ gens: Array<{ comp: Uint32Array }> } | undefined> }).unions) {
    if (!u) continue;
    for (const g of u.gens) g.comp = new Proxy(g.comp, { get(t, k) { if (typeof k === "string" && /^\d+$/.test(k)) inc(); return Reflect.get(t, k, t); } });
  }
}

/** Everything a page asks of a view, as plain data. */
function answers(v: ContactView, cov: number, earlier: Array<[string, number]> = []): unknown {
  const lineAt = (p: number) => Math.floor(p);
  const targets = Array.from({ length: v.n }, (_, i) => [targetPos(v, i), targetEnd(v, i), targetKind(v, i), targetKey(v, i), targetAt(v, i, lineAt)]);
  const tint = Array.from({ length: 80 }, (_, q) => [...tintAt(v, (q / 80) * cov)].sort());
  const marks = Array.from({ length: 30 }, (_, l) => lineMark(v, l, [[l * cov / 30, (l + 0.7) * cov / 30]], lineAt));
  const keys = Array.from({ length: v.n }, (_, i) => findKey(v, targetKey(v, i)));
  // the keys shown before the fallback, asked after it: where they stood, and anywhere
  const kept = earlier.map(([k, p]) => [findKey(v, k, p), findKey(v, k)]);
  return { targets, tint, marks, keys, kept };
}

describe("a union piece asked of the indexes answers as the walk over its intervals did (Codex R158 VP-I115)", () => {
  it("random generations: every target, the tint, the marks, the keys", { timeout: 600_000 }, () => {
    let pieces = 0, found = 0, asked = 0, refuted = 0;
    for (const seed0 of [1, 2, 3, 58, 158, 2026]) {
      let seed = seed0;
      const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      for (let c = 0; c < 100; c++) {
        const held = generation(rnd, 1, 0), cur = generation(rnd, 1, 1);
        refuted += refutedSamples(held, cur) + refutedSamples(cur, held);
        // an entry move's union beside it, some of the base's intervals its continuation
        const eHeld = generation(rnd, 2, 0), eCur = generation(rnd, 2, 1);
        let cov = 1;
        for (const st of [held, cur, eHeld, eCur]) for (let k = 0; k < st.intervals.rows; k++) cov = Math.max(cov, st.intervals.get(k, "enter") + 4);
        const joins: SourceJoin[] = [];
        for (const [base, baseHeld] of [[held, true], [cur, false]] as const) {
          for (const [entry, entryHeld] of [[eHeld, true], [eCur, false]] as const) {
            const m = new Map<number, number>();
            for (let k = 0; k < base.intervals.rows && entry.intervals.rows; k++) if (rnd() < 0.15) m.set(k, Math.floor(rnd() * entry.intervals.rows));
            if (m.size) joins.push({ entrySrc: 1, baseSrc: 0, joins: m, baseShard: 0, entryShard: 0, entryHeld, baseHeld });
          }
        }
        // either run may have swept less far than the other (Codex R159 VP-I119)
        const covH = rnd() < 0.35 ? cov * (0.3 + 0.6 * rnd()) : cov, covC = rnd() < 0.35 ? cov * (0.3 + 0.6 * rnd()) : cov;
        const input = { sources: [{ stores: [cur], held: [held], heldCoverage: [covH], at: (x: number) => x, ownCoverage: covC },
                                  { stores: [eCur], held: [eHeld], heldCoverage: [cov], at: (x: number) => x, ownCoverage: cov, entry: true }],
                        pairName: names, coverage: cov, joins };
        const v = buildContactView(input);
        pieces += v.n;
        const tag = `seed ${seed0} case ${c}`;
        // what the page showed before the pool fell back: the earlier run alone
        const before = buildContactView({ sources: [{ stores: [held], at: (x: number) => x, ownCoverage: cov },
                                                    { stores: [eHeld], at: (x: number) => x, ownCoverage: cov, entry: true }], pairName: names, coverage: cov });
        const earlier = Array.from({ length: before.n }, (_, i): [string, number] => [targetKey(before, i), targetPos(before, i) + 0.5]);
        const indexed = answers(v, cov, earlier) as { kept: number[][] };
        for (const [, anywhere] of indexed.kept) { asked++; if (anywhere! >= 0) found++; }
        linearPiecesForTest.on = true;
        try {
          const w = buildContactView(input);
          expect(indexed, tag).toEqual(answers(w, cov, earlier));
        } finally { linearPiecesForTest.on = false; }
      }
    }
    console.log(`[R158 indexed] ${pieces} targets compared; of ${asked} earlier keys ${found} found again after the fallback; ${refuted} free samples on the other run's confirmed points`);
    expect(pieces).toBeGreaterThan(1000);
    expect(refuted, "samples the other run refutes: the free index skips them (Codex R160 VP-I115 rest D)").toBeGreaterThan(100);
    expect(found, "earlier keys found again: the lookup is exercised").toBeGreaterThan(asked / 4);
  });
});

const D = IV_ENTER_DECIDED | IV_EXIT_DECIDED;
describe("a key among simultaneous starts is found by its reference (Codex R159 VP-I115 rest B)", () => {
  // every pair's own contact [0, 1]: at one position, n targets; a union of
  // two such runs with the earlier run's keys (each carried by the piece
  // holding its witness)
  const run = (gen: number, n: number, shift: number) => {
    const st = new ContactStore(1, gen, REQUEST_BUDGET);
    for (let i = 0; i < n; i++) {
      const ep = st.episodes.append({ pair: i, ordinal: 0, flags: 0, onset: 0, end: 1, closeAt: 0, closeDist: 0, firstIv: NONE, ivCount: 1 });
      st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: 0, exit: 1 + shift, flags: D, next: NONE, witness: 0.5 + shift, freeAt: 2, freeR: 0.1 }));
    }
    return st;
  };
  const counter = () => {
    const proto = ColumnTable.prototype as unknown as { get: (...a: unknown[]) => number; blocksOf: (n: string) => ArrayLike<number>[] };
    const get = proto.get, blocksOf = proto.blocksOf, box = { reads: 0 };
    const counted = new WeakMap<object, object>();
    const cell = <A extends object>(a: A): A => {
      let w = counted.get(a) as A | undefined;
      if (!w) counted.set(a, w = new Proxy(a, { get(t, k) { if (typeof k === "string" && /^\d+$/.test(k)) box.reads++; return Reflect.get(t, k, t); } }));
      return w;
    };
    proto.get = function (...a: unknown[]) { box.reads++; return get.apply(this, a); };
    proto.blocksOf = function (nm: string) {
      const blocks = blocksOf.call(this, nm) as object[];
      return new Proxy(blocks, { get(t, k) { const x = Reflect.get(t, k, t); return typeof k === "string" && /^\d+$/.test(k) && x ? cell(x as object) : x; } }) as never;
    };
    return { box, restore: () => { proto.get = get; proto.blocksOf = blocksOf; } };
  };
  /** The target list's references read too (a search that steps through them reads no table cell). */
  const countRefs = (v: ContactView, box: { reads: number }) => {
    const l = v.tgt as unknown as { refs: Uint32Array };
    l.refs = new Proxy(l.refs, { get(t, k) { if (typeof k === "string" && /^\d+$/.test(k)) box.reads++; return Reflect.get(t, k, t); } });
  };
  it("the steps from a position over n pairs' findings at one point — the same at 1024 and at 8192 pairs", { timeout: 300_000 }, () => {
    // n near misses at 0 (their jump point 0) and a contact at 1: the step
    // after 0 passes them all; n contacts [0, 1] (their jump point a hair
    // past 0) and a near miss at −1: the step before the hair passes them all
    const worst: number[] = [];
    for (const n of [1024, 8192]) {
      const c = counter();
      let w = 0;
      try {
        const nears = new ContactStore(1, 0, REQUEST_BUDGET);
        for (let i = 0; i < n; i++) nears.episodes.append({ pair: i, ordinal: 0, flags: 0, onset: 0, end: 0, closeAt: 0, closeDist: 1, firstIv: NONE, ivCount: 0 });
        const ep = nears.episodes.append({ pair: n, ordinal: 0, flags: 0, onset: 1, end: 2, closeAt: 1, closeDist: 0, firstIv: NONE, ivCount: 1 });
        nears.episodes.set(ep, "firstIv", nears.intervals.append({ episode: ep, enter: 1, exit: 2, flags: D, next: NONE, witness: 1.5, freeAt: NaN, freeR: 0 }));
        const contacts = run(0, n, 0);
        contacts.episodes.append({ pair: n, ordinal: 0, flags: 0, onset: -1, end: -1, closeAt: -1, closeDist: 1, firstIv: NONE, ivCount: 0 });
        const va = buildContactView({ sources: [{ stores: [nears], ownCoverage: 3, at: (x: number) => x }], pairName: names, coverage: 3 });
        const vb = buildContactView({ sources: [{ stores: [contacts], ownCoverage: 3, at: (x: number) => x }], pairName: names, coverage: 3 });
        for (const [f, want] of [[() => indexAfter(va, 0, null), (i: number) => targetPos(va, i) === 1],
                                  [() => indexBefore(vb, 1e-3, null), (i: number) => targetPos(vb, i) === -1]] as const) {
          c.box.reads = 0;
          const i = f();
          w = Math.max(w, c.box.reads);
          expect(want(i), "past all the ties: the contact at 1, the near miss at −1").toBe(true);
        }
      } finally { c.restore(); }
      worst.push(w);
    }
    console.log(`[R159 steps] ${worst[0]} → ${worst[1]} reads`);
    expect(worst[1]!).toBeLessThanOrEqual(1.5 * worst[0]! + 256);
  });

  it("an earlier event's key late in a run without free samples: its piece from the indexes — the same at 1024 and at 8192 contacts", { timeout: 300_000 }, () => {
    // one pair, contacts ended at the feed (no free sample between them), the
    // current run the same: the key of the earlier run's last contact
    const feedRun = (gen: number, n: number) => {
      const st = new ContactStore(1, gen, REQUEST_BUDGET);
      const ep = st.episodes.append({ pair: 0, ordinal: 0, flags: 0, onset: 0, end: 4 * n, closeAt: 0, closeDist: 0, firstIv: NONE, ivCount: n });
      let last = -1;
      for (let k = 0; k < n; k++) {
        const iv = st.intervals.append({ episode: ep, enter: 4 * k, exit: 4 * k + 1, flags: IV_ENTER_DECIDED | IV_ENDED_AT_FEED, next: NONE,
                                         witness: 4 * k + 0.5, freeAt: NaN, freeR: 0 });
        if (last < 0) st.episodes.set(ep, "firstIv", iv); else st.intervals.set(last, "next", iv);
        last = iv;
      }
      return st;
    };
    const worst: number[] = [];
    for (const n of [1024, 8192]) {
      // (the counter before the builds: the views read the cells it counts)
      const c = counter();
      try {
        const held = feedRun(0, n), cov = 4 * n + 2;
        const before = buildContactView({ sources: [{ stores: [held], ownCoverage: cov, at: (x: number) => x }], pairName: names, coverage: cov });
        const v = buildContactView({ sources: [{ stores: [feedRun(1, n)], held: [held], heldCoverage: [cov], ownCoverage: cov, at: (x: number) => x }], pairName: names, coverage: cov });
        countIndex(v, () => { c.box.reads++; });
        const key = targetKey(before, before.n - 1);
        c.box.reads = 0;
        const i = findKey(v, key);
        worst.push(c.box.reads);
        expect(i, "found").toBeGreaterThanOrEqual(0);
        expect(targetKey(v, i)).toBe(key);
      } finally { c.restore(); }
    }
    console.log(`[R159 late key] ${worst[0]} → ${worst[1]} reads`);
    expect(worst[1]!).toBeLessThanOrEqual(1.5 * worst[0]! + 256);
  });

  it("an earlier event's key over a chain of refuted free samples: its piece from the indexes — the same at 1024 and at 8192 contacts (Codex R160 VP-I115 rest D)", { timeout: 300_000 }, () => {
    // Codex R160's probe: every free sample of both runs refuted by the other
    // run's witness — the index skips them, both ways; the answer the walk's
    const worst: number[] = [];
    for (const n of [1024, 8192]) {
      const c = counter();
      try {
        const { input } = refutedChain(n, 0.1);
        const v = buildContactView(input);
        countIndex(v, () => { c.box.reads++; });
        expect(v.n, "one piece").toBe(1);
        expect(targetEnd(v, 0)).toBe(4 * n + 0.5);
        const key = `C0|${n - 1}|0`;
        c.box.reads = 0;
        const i = findKey(v, key);
        worst.push(c.box.reads);
        expect(i, "handed over to the one piece").toBe(0);
        linearPiecesForTest.on = true;
        try { expect(findKey(buildContactView(input), key), "as the walk over every interval").toBe(i); } finally { linearPiecesForTest.on = false; }
      } finally { c.restore(); }
    }
    console.log(`[R160 refuted key] ${worst[0]} → ${worst[1]} reads`);
    expect(worst[1]!).toBeLessThanOrEqual(1.5 * worst[0]! + 256);
  });

  it.each([["other pair"], ["later, same pair"]] as const)("the earlier run's last key beside one long valid free stretch (%s): the same at 1024 and at 8192 contacts (Codex R161 VP-I115 rest F)", { timeout: 300_000 }, wide => {
    // Codex R161's probe: the windows came from the generation's reach — one
    // long free stretch anywhere made every local search scan every sample
    const worst: number[] = [], plain: number[] = [];
    for (const n of [1024, 8192]) {
      for (const w of [wide, "none"] as const) {
        const c = counter();
        try {
          const { input } = wideStretch(n, w);
          const v = buildContactView(input);
          countIndex(v, () => { c.box.reads++; });
          expect(v.conflicts.count, "no conflict").toBe(0);
          const key = `C0|${n - 1}|0`, i = findKey(v, key);
          expect(targetKey(v, i), "found").toBe(key);
          c.box.reads = 0;
          expect(findKey(v, key)).toBe(i);
          (w === "none" ? plain : worst).push(c.box.reads);
        } finally { c.restore(); }
      }
    }
    console.log(`[R161 wide] ${wide}: ${worst[0]} → ${worst[1]} reads (without it ${plain[0]} → ${plain[1]})`);
    expect(worst[1]!, "the local key query stays bounded").toBeLessThanOrEqual(1.5 * worst[0]! + 256);
    expect(worst[1]!, "and as cheap as without the long stretch, near enough").toBeLessThanOrEqual(1.5 * plain[1]! + 256);
  });

  it.each([["one run", false], ["a union, the earlier run's keys", true]])("%s: at its place, moved, anywhere — the same at 1024 and at 8192 pairs", { timeout: 300_000 }, (_, union) => {
    const worst: Array<Record<string, number>> = [];
    for (const n of [1024, 8192]) {
      const c = counter();
      try {
        const held = run(0, n, 0);
        const v = union
          ? buildContactView({ sources: [{ stores: [run(1, n, 0.25)], held: [held], heldCoverage: [3], ownCoverage: 3, at: (x: number) => x }], pairName: names, coverage: 3 })
          : buildContactView({ sources: [{ stores: [held], ownCoverage: 3, at: (x: number) => x }], pairName: names, coverage: 3 });
        countRefs(v, c.box);
        countIndex(v, () => { c.box.reads++; });
        const keys = union ? (() => { const b = buildContactView({ sources: [{ stores: [held], ownCoverage: 3, at: (x: number) => x }], pairName: names, coverage: 3 });
                                      return [0, b.n >> 1, b.n - 1].map(i => targetKey(b, i)); })()
                           : [0, v.n >> 1, v.n - 1].map(i => targetKey(v, i));
        const w: Record<string, number> = {};
        for (const key of keys) {
          for (const [mode, near] of [["at its place", 0], ["moved", 123456], ["anywhere", undefined]] as const) {
            c.box.reads = 0;
            const i = findKey(v, key, near);
            w[mode] = Math.max(w[mode] ?? 0, c.box.reads);
            expect(i, `${key} ${mode}`).toBeGreaterThanOrEqual(0);
            expect(targetKey(v, i), "the target its key names").toBe(key);
          }
        }
        worst.push(w);
      } finally { c.restore(); }
    }
    console.log(`[R159 keys] ${union ? "union" : "one run"}: ${JSON.stringify(worst[0])} → ${JSON.stringify(worst[1])}`);
    for (const k of Object.keys(worst[0]!)) expect(worst[1]![k]!, k).toBeLessThanOrEqual(1.5 * worst[0]![k]! + 256);
  });
});

/** One interval of its own episode. */
function iv(st: ContactStore, pair: number, a: number, b: number, flags: number, free = NaN, r = 0) {
  const ep = st.episodes.append({ pair, ordinal: st.episodes.rows, flags: 0, onset: a, end: b, closeAt: a, closeDist: 0, firstIv: NONE, ivCount: 1 });
  st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: a, exit: flags & IV_ENDED_AT_FEED ? b : b, flags, next: NONE, witness: a + (b - a) / 2, freeAt: free, freeR: r }));
}
/** A real cutting sweep (Codex R158's probe): the cutter into the stock on a
 *  rapid, then a feed, then a rapid again — every contact ended at the feed,
 *  none with a free sample, no gap. */
function sweepStore(cycles: number): { st: ContactStore; end: number } {
  const machine: CollisionMachine = { groups: [{ id: "table", parent: "root" }, { id: "part", parent: "table" }, { id: "head", parent: "root", translate: [0, 0, 50] }],
    kinematics: [{ group: "head", joint: 2, type: "translate", direction: "z", sign: 1 }], workGroup: "part", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"] };
  const model = buildCollisionModel(machine, [{ id: "stock", group: "part", positions: boxPositions(10, 10, 10), stock: true }, { id: "tool", group: "head", positions: boxPositions(10, 10, 10), tool: true }]);
  const zs = [0, -43], rr = [0, 1];
  for (let i = 0; i < cycles; i++) { zs.push(-44, -43); rr.push(0, 1); }
  const n = zs.length, cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1]! + Math.abs(zs[i]! - zs[i - 1]!);
  const track = { pos: Float32Array.from(zs.flatMap(z => [0, 0, z])), abc: new Float32Array(n * 3), lines: Uint32Array.from(zs, (_, i) => i + 1), rapid: Uint8Array.from(rr), cum, count: n, lineIndex: emptyLineIndex(), timeBased: false };
  const st = new ContactStore(1, 0, REQUEST_BUDGET);
  sweepCollisions(model, track as never, { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 }, { margin: 2, contacts: { store: st } });
  return { st, end: cum[n - 1]! };
}
/** Two generations apart by 1.5, each free sample cutting the other's contact: many pieces. */
function table(req: number, generation: number, n: number): ContactStore {
  const st = new ContactStore(req, generation, REQUEST_BUDGET);
  const later = generation === 1;
  let ep = -1, last = -1, used = 0;
  for (let i = 0; i < n; i++) {
    if (i % 4 === 0) { const at = 3 * i + (later ? 1.5 : 0); ep = st.episodes.append({ pair: 0, ordinal: used++, flags: 0, onset: at, end: at + 12, closeAt: at, closeDist: 0, firstIv: NONE, ivCount: 4 }); last = -1; }
    const enter = 3 * i + (later ? 1.5 : 0);
    const iv = st.intervals.append({ episode: ep, enter, exit: enter + 1, flags: D, next: NONE, witness: later ? enter + 0.1 : enter + 0.5, freeAt: later ? 3 * i + 3.2 : 3 * i + 2, freeR: 0.1 });
    if (last < 0) st.episodes.set(ep, "firstIv", iv); else st.intervals.set(last, "next", iv);
    last = iv;
  }
  return st;
}
/** Codex R160's chain: each run's contacts overlapping the other's, each run's
 *  free sample on the other run's witness — every one refuted (named as a
 *  conflict where its radius reaches past the tolerance), the union one piece. */
function refutedChain(n: number, r: number): { input: ContactViewInput; cov: number } {
  const mk = (gen: number) => {
    const st = new ContactStore(1, gen, REQUEST_BUDGET);
    for (let k = 0; k < n; k++) {
      const a = 4 * k + 2 * gen;
      const ep = st.episodes.append({ pair: 0, ordinal: k, flags: 0, onset: a, end: a + 2.5, closeAt: a + 1, closeDist: 0, firstIv: NONE, ivCount: 1 });
      st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: a, exit: a + 2.5, flags: D, next: NONE, witness: a + 1, freeAt: a + 3, freeR: r }));
    }
    return st;
  };
  const cov = 4 * n + 4;
  return { input: { sources: [{ stores: [mk(1)], held: [mk(0)], heldCoverage: [cov], at: x => x, ownCoverage: cov }], pairName: names, coverage: cov }, cov };
}
/** Codex R161's shape: pair 0's n short contacts in both runs, small free
 *  stretches between, and — `wide` — one long VALID free stretch of the
 *  earlier run, in pair 1 or later in pair 0 (a contact [s, s+1], its free
 *  sample at s+1e6 with radius 999 999, then a contact to s+4e6 whose enter is
 *  undecided and whose witness lies past the stretch): no conflict. */
function wideStretch(n: number, wide: "none" | "other pair" | "later, same pair"): { input: ContactViewInput; cov: number } {
  const h = new ContactStore(1, 0, REQUEST_BUDGET), c = new ContactStore(1, 1, REQUEST_BUDGET);
  const one = (st: ContactStore, pair: number, a: number, b: number, w: number, p: number, r: number, flags = D) => {
    const ep = st.episodes.append({ pair, ordinal: st.episodes.rows, flags: 0, onset: a, end: b, closeAt: w, closeDist: 0, firstIv: NONE, ivCount: 1 });
    st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: a, exit: b, flags, next: NONE, witness: w, freeAt: p, freeR: r }));
  };
  for (let k = 0; k < n; k++) { one(h, 0, 4 * k, 4 * k + 1, 4 * k + 0.5, 4 * k + 2, 0.1); one(c, 0, 4 * k + 0.1, 4 * k + 0.9, 4 * k + 0.4, 4 * k + 2, 0.1); }
  if (wide !== "none") {
    const pair = wide === "other pair" ? 1 : 0, s = wide === "other pair" ? 0 : 1e6;
    one(h, pair, s, s + 1, s + 0.5, s + 1e6, 999999);
    one(h, pair, s + 1e6 + 1, s + 4e6, s + 3e6, NaN, 0, IV_EXIT_DECIDED);
  }
  const cov = 5e6;
  return { input: { sources: [{ stores: [c], held: [h], heldCoverage: [cov], at: x => x, ownCoverage: cov }], pairName: names, coverage: cov }, cov };
}
/** The shapes of the questions' costs (Codex R158 VP-I115 rest B). */
const costShapes: Record<string, (n: number) => { input: ContactViewInput; cov: number }> = {
  pieces: n => { const cov = 3 * n + 10; return { input: { sources: [{ stores: [table(1, 1, n)], held: [table(1, 0, n)], heldCoverage: [cov], at: x => x, ownCoverage: cov }], pairName: names, coverage: cov }, cov }; },
  sweep: n => { const { st, end } = sweepStore(n); return { input: { sources: [{ stores: [new ContactStore(1, 1)], held: [st], heldCoverage: [end], at: x => x, ownCoverage: end }], pairName: names, coverage: end }, cov: end }; },
  coarseFine: n => {
    const h = new ContactStore(1, 0, REQUEST_BUDGET), c = new ContactStore(1, 1, REQUEST_BUDGET);
    iv(h, 0, 0, 4 * n, D);
    for (let k = 0; k < n; k++) iv(c, 0, 4 * k, 4 * k + 1, IV_ENTER_DECIDED | IV_ENDED_AT_FEED);
    const cov = 4 * n + 5;
    return { input: { sources: [{ stores: [c], held: [h], heldCoverage: [cov], at: x => x, ownCoverage: cov }], pairName: names, coverage: cov }, cov };
  },
  chain: n => {
    const h = new ContactStore(1, 0, REQUEST_BUDGET), c = new ContactStore(1, 1, REQUEST_BUDGET);
    for (let k = 0; k < n; k++) { iv(h, 0, 4 * k, 4 * k + 2.5, IV_ENTER_DECIDED | IV_ENDED_AT_FEED); iv(c, 0, 4 * k + 2, 4 * k + 4.5, IV_ENTER_DECIDED | IV_ENDED_AT_FEED); }
    const cov = 4 * n + 5;
    return { input: { sources: [{ stores: [c], held: [h], heldCoverage: [cov], at: x => x, ownCoverage: cov }], pairName: names, coverage: cov }, cov };
  },
  refuted: n => refutedChain(n, 0.1),
  // one long valid free stretch elsewhere: the windows are the witnesses around a range (Codex R161 VP-I115 rest F)
  widePair: n => wideStretch(n, "other pair"),
  wideLater: n => wideStretch(n, "later, same pair"),
  refutedPoints: n => refutedChain(n, 0),
  // the earlier run's every free sample with a raw radius over everything,
  // cut back by the rerun's contacts between: the searches' windows are the
  // kept stretches' reach, never the raw radius (beside Codex R160 VP-I115 rest D)
  wideRadius: n => {
    const h = new ContactStore(1, 0, REQUEST_BUDGET), c = new ContactStore(1, 1, REQUEST_BUDGET);
    for (let k = 0; k < n; k++) { iv(h, 0, 4 * k, 4 * k + 1, D, 4 * k + 2, 1e7); iv(c, 0, 4 * k + 2.5, 4 * k + 3, D, 4 * k + 3.5, 0.1); }
    const cov = 4 * n + 4;
    return { input: { sources: [{ stores: [c], held: [h], heldCoverage: [cov], at: x => x, ownCoverage: cov }], pairName: names, coverage: cov }, cov };
  },
  gaps: n => {
    const mk = (g: number) => { const st = new ContactStore(1, g, REQUEST_BUDGET);
      const ep = st.episodes.append({ pair: 0, ordinal: 0, flags: 0, onset: 0, end: NaN, closeAt: 0, closeDist: 0, firstIv: NONE, ivCount: 1 });
      st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: 0, exit: NaN, flags: IV_ENTER_DECIDED, next: NONE, witness: 0, freeAt: NaN, freeR: 0 }));
      for (let i = 0; i < n; i++) st.gaps.append({ pair: 0, start: 4 * i + 1, end: 4 * i + 2, reason: GAP_UNDECIDABLE });
      return st; };
    const cov = 4 * n + 1;
    return { input: { sources: [{ stores: [mk(1)], held: [mk(0)], heldCoverage: [cov], at: x => x, ownCoverage: cov }], pairName: names, coverage: cov }, cov };
  },
};

describe("the tint by each interval's own coverage (Codex R159 VP-I119)", () => {
  // one open contact from 0 in both runs: the earlier swept to `held`, the current to `cur`
  const view = (held: number, cur: number) => {
    const mk = (gen: number) => {
      const st = new ContactStore(1, gen);
      const e = st.episodes.append({ pair: 0, ordinal: 0, flags: 0, onset: 0, end: NaN, closeAt: 0, closeDist: 0, firstIv: NONE, ivCount: 1 });
      st.episodes.set(e, "firstIv", st.intervals.append({ episode: e, enter: 0, exit: NaN, flags: IV_ENTER_DECIDED, next: NONE, witness: 0, freeAt: NaN, freeR: 0 }));
      return st;
    };
    return buildContactView({ sources: [{ stores: [mk(1)], held: [mk(0)], heldCoverage: [held], ownCoverage: cur, at: (x: number) => x }],
                              pairName: () => ({ a: "tool", b: "stock" }), coverage: 10 });
  };
  it.each([["the earlier run shorter (Codex's probe)", 5, 10], ["the current run shorter", 10, 5], ["both to the end", 10, 10]])(
    "%s: the band, the target's end and the tint agree", (_, held, cur) => {
      const v = view(held, cur), reach = Math.max(held, cur);
      expect(contactBands(v, 100, 10), "the band").toEqual([[0, reach / 10]]);
      expect(targetEnd(v, 0), "the target's end").toBe(reach);
      for (const x of [1, 4, 4.9, 6, 7, 9.9]) {
        expect([...tintAt(v, x)].sort(), `the tint at ${x}`).toEqual(x <= reach ? ["stock", "tool"] : []);
      }
    });
});

describe("every question about a union piece reads a bounded number of cells (Codex R158 VP-I115 rest B)", () => {
  // counted, never timed (contactView.test's proxy over every table cell):
  // the worst single question at a size and at eight times it — bounded by
  // bisections, never by the intervals a piece holds or a search passes
  const sizes: Record<string, [number, number]> = { sweep: [256, 2048], pieces: [1024, 8192], coarseFine: [2048, 16384], chain: [2048, 16384], gaps: [2048, 16384],
                                                  refuted: [1024, 8192], refutedPoints: [1024, 8192], wideRadius: [1024, 8192],
                                                  widePair: [1024, 8192], wideLater: [1024, 8192] };
  const ask = (v: ContactView, cov: number, q: (k: string, f: () => unknown) => void) => {
    const lineAt = (p: number) => Math.floor(p), step = Math.max(1, Math.floor(v.n / 64));
    for (let i = 0; i < v.n; i += step) {
      q("one target", () => targetPos(v, i)); q("one target", () => targetEnd(v, i)); q("one target", () => targetKind(v, i));
      q("one target", () => targetKey(v, i)); q("one target", () => targetAt(v, i, lineAt));
      const key = targetKey(v, i), pos = targetPos(v, i);
      q("navigation", () => findKey(v, key, pos)); q("navigation", () => indexAfter(v, pos, { key, pos })); q("navigation", () => indexBefore(v, pos, { key, pos }));
      // a key asked where it no longer stands (a fallback moved it), and one that is gone
      q("navigation", () => findKey(v, key, pos + cov / 3)); q("navigation", () => findKey(v, key));
    }
    for (let s = 0; s < 64; s++) {
      const x = (s / 64) * cov;
      q("tint", () => tintAt(v, x)); q("mark", () => lineMark(v, s, [[x, x + cov / 64]], lineAt)); q("navigation", () => indexAfter(v, x, null));
    }
    q("window of 50", () => targetWindow(v, v.n >> 1, 50, lineAt));
    q("navigation", () => findKey(v, "C0|999999|0")); q("navigation", () => findKey(v, "C0|0|999999"));
  };
  for (const [name, [n0, n1]] of Object.entries(sizes)) {
    it(`${name}: the same at ${n0} and at ${n1}`, { timeout: 300_000 }, () => {
      const proto = ColumnTable.prototype as unknown as { get: (...a: unknown[]) => number; blocksOf: (n: string) => ArrayLike<number>[] };
      const get = proto.get, blocksOf = proto.blocksOf;
      let reads = 0;
      const counted = new WeakMap<object, object>();
      const cell = <A extends object>(a: A): A => {
        let w = counted.get(a) as A | undefined;
        if (!w) counted.set(a, w = new Proxy(a, { get(t, k) { if (typeof k === "string" && /^\d+$/.test(k)) reads++; return Reflect.get(t, k, t); } }));
        return w;
      };
      proto.get = function (...a: unknown[]) { reads++; return get.apply(this, a); };
      proto.blocksOf = function (nm: string) {
        const blocks = blocksOf.call(this, nm) as object[];
        return new Proxy(blocks, { get(t, k) { const x = Reflect.get(t, k, t); return typeof k === "string" && /^\d+$/.test(k) && x ? cell(x as object) : x; } }) as never;
      };
      const worst = [n0, n1].map(n => {
        const { input, cov } = costShapes[name]!(n);
        const v = buildContactView(input), w: Record<string, number> = {};
        countIndex(v, () => { reads++; });
        ask(v, cov, (k, f) => { reads = 0; f(); w[k] = Math.max(w[k] ?? 0, reads); });
        return w;
      });
      proto.get = get; proto.blocksOf = blocksOf;
      console.log(`[R158 questions] ${name}: ${JSON.stringify(worst[0])} → ${JSON.stringify(worst[1])}`);
      for (const k of Object.keys(worst[0]!)) {
        // eight times the rows: three more bisection steps at most, never eight times the reads
        expect(worst[1]![k]!, `${name}: ${k}`).toBeLessThanOrEqual(1.5 * worst[0]![k]! + 256);
      }
      const limit: Record<string, number> = { "one target": 2048, navigation: 8192, tint: 64 * 2048, mark: 2048, "window of 50": 50 * 2048 };
      for (const [k, x] of Object.entries(worst[1]!)) expect(x, `${name}: ${k} at ${n1}`).toBeLessThanOrEqual(limit[k]!);
    });
  }
});
