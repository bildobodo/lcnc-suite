// Step 4 package 2, round A: the contact store against the records, from the
// SAME sweep (plan docs/reviews/kollision-paket2.plan.md Fassung 5, 7.2). The
// sweep writes both sinks from one sample stream, so the comparison is exact
// up to what the plan names: per pair, the union of the touch intervals is
// the records' union — except where the records bridged a PROVEN free sample
// (CLUSTER_GAP, the contiguous merge: the store keeps the separation) and
// where a record's refinement stopped at its line's start (R90: the store's
// entry lies earlier, at the crossing). The stays without a touch are the
// records' near misses, one for one.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTACT_EPS, sweepCollisions, type CollisionHit, type CollisionModel, type CollisionTrack } from "./collision";
import { ContactStore, EP_ORIGIN_MASK, IV_ENTER_DECIDED, IV_POSSIBLE, NONE, ORIGIN_PROGRAM } from "./contactStore";
import { MARGIN, generatedCase, insideTruth, loadShippedModel, randomTrack, rng, shippedCases, trackTruth, type Case, type FixtureFiles } from "./collisionFixtures";

const ROOT = path.resolve(__dirname, "../../..");
const FILES: FixtureFiles = {
  text: rel => fs.readFileSync(path.join(ROOT, rel), "utf8"),
  bytes: rel => fs.readFileSync(path.join(ROOT, rel)),
};
const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 } as any;
const TOL = 3e-3;   // boundaries are bisected to 1e-3 in both sinks

type Span = [number, number];
const unite = (spans: Span[]): Span[] => {
  const s = spans.filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0]);
  const out: Span[] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-9) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
};
/** a \ b, pieces longer than TOL. */
const minus = (a: Span[], b: Span[]): Span[] => {
  const out: Span[] = [];
  for (const [x0, x1] of a) {
    let cur = x0;
    for (const [y0, y1] of b) {
      if (y1 <= cur || y0 >= x1) continue;
      if (y0 > cur) out.push([cur, y0]);
      cur = Math.max(cur, y1);
    }
    if (cur < x1) out.push([cur, x1]);
  }
  return out.filter(([p, q]) => q - p > TOL);
};

/** The store's rows per pair, as plain objects. */
function storeView(store: ContactStore, end: number) {
  const E = store.episodes, I = store.intervals;
  const byPair = new Map<number, { episodes: Array<{ onset: number; ivCount: number; origin: number }>; spans: Span[];
                                    free: number[]; freeR: number[]; witnesses: number[]; enters: Array<{ at: number; decided: boolean }> }>();
  const of = (pi: number) => {
    let v = byPair.get(pi);
    if (!v) byPair.set(pi, v = { episodes: [], spans: [], free: [], freeR: [], witnesses: [], enters: [] });
    return v;
  };
  for (let e = 0; e < E.rows; e++) {
    const pi = E.get(e, "pair"), v = of(pi);
    v.episodes.push({ onset: E.get(e, "onset"), ivCount: E.get(e, "ivCount"), origin: E.get(e, "flags") & EP_ORIGIN_MASK });
    // the chain of its intervals, in order
    let iv = E.get(e, "firstIv"), seen = 0;
    while (iv !== NONE) {
      expect(I.get(iv, "episode"), "an interval names its episode").toBe(e);
      const exit = I.get(iv, "exit");
      v.spans.push([I.get(iv, "enter"), Number.isNaN(exit) ? end : exit]);
      v.witnesses.push(I.get(iv, "witness"));
      v.enters.push({ at: I.get(iv, "enter"), decided: (I.get(iv, "flags") & IV_ENTER_DECIDED) !== 0 });
      if (!Number.isNaN(I.get(iv, "freeAt"))) { v.free.push(I.get(iv, "freeAt")); v.freeR.push(I.get(iv, "freeR")); }
      iv = I.get(iv, "next");
      seen++;
    }
    expect(seen, "the chain holds the episode's intervals").toBe(E.get(e, "ivCount"));
  }
  return byPair;
}

function compare(c: Case, model: CollisionModel, track: CollisionTrack, where: string) {
  const store = new ContactStore(1, 0);
  // every chunk the sweep bounds a pair's speed over — a free radius holds only there
  const chunks = new Map<number, Array<[number, number]>>();
  const r = sweepCollisions(model, track, WCS0, { margin: MARGIN, contacts: { store },
    onChunkSpeed: (pi, s0, s1) => { let l = chunks.get(pi); if (!l) chunks.set(pi, l = []); l.push([s0, s1]); } });
  expect(r.truncated, `${where}: swept whole`).toBeNull();
  const end = track.cum[track.count - 1]!;
  if ((r.capped ?? 0) > 0) return { skipped: true, touches: 0, nears: 0, collapsed: 0 };   // the records were cut: no full comparison
  const view = storeView(store, end);
  const ids = (pi: number) => [model.bodies[model.pairs[pi]![0]]!.id, model.bodies[model.pairs[pi]![1]]!.id].sort().join("/");
  const oldByPair = new Map<string, CollisionHit[]>();
  for (const h of r.hits) { const k = [h.a, h.b].sort().join("/"); oldByPair.set(k, [...(oldByPair.get(k) ?? []), h]); }
  // where a line begins on the track — the records' refinement floor (R90)
  const lineStarts = new Set<number>();
  for (let i = 1; i < track.count; i++) if (track.lines[i] !== track.lines[i - 1]) lineStarts.add(track.cum[i - 1]!);
  const nearLineStart = (x: number) => [...lineStarts].some(l => Math.abs(l - x) <= TOL);
  let touches = 0, nears = 0, collapsed = 0, bridgedN = 0, flooredN = 0, freeChecked = 0;
  const pairsSeen = new Set<number>([...view.keys()]);
  for (let pi = 0; pi < model.pairs.length; pi++) if (oldByPair.has(ids(pi))) pairsSeen.add(pi);
  const { poseAt, below } = trackTruth(model, c, track);
  for (const pi of pairsSeen) {
    const recs = oldByPair.get(ids(pi)) ?? [];
    const v = view.get(pi) ?? { episodes: [], spans: [], free: [], freeR: [], witnesses: [], enters: [] };
    const oldU = unite(recs.filter(h => h.dist <= CONTACT_EPS || h.intervals)
      .flatMap(h => (h.intervals ?? [[h.cum, h.cumEnd]]) as Span[]));
    const newU = unite(v.spans.map(s => [s[0], s[1]] as Span));
    touches += newU.length;
    // the records cover more only where they bridged a proven free sample
    for (const [a, b] of minus(oldU, newU)) {
      bridgedN++;
      const free = v.free.find(f => f >= a - TOL && f <= b + TOL);
      expect(free, `${where} ${ids(pi)}: the records cover [${a.toFixed(4)}, ${b.toFixed(4)}] the store leaves out — no free sample proves it apart (old ${JSON.stringify(oldU)}, new ${JSON.stringify(newU)})`).toBeDefined();
    }
    // the store covers more only before a record that stopped at its line's start
    for (const [a, b] of minus(newU, oldU)) {
      flooredN++;
      const floored = oldU.some(([o0]) => Math.abs(o0 - b) <= TOL && nearLineStart(o0));
      expect(floored, `${where} ${ids(pi)}: the store covers [${a.toFixed(4)}, ${b.toFixed(4)}] the records do not — not a line-start floor (old ${JSON.stringify(oldU)}, new ${JSON.stringify(newU)})`).toBe(true);
    }
    // every witness touches, every decided entry touches — the truth, not the sweep
    const [ai, bi] = model.pairs[pi]!;
    const A = model.bodies[ai]!, B = model.bodies[bi]!;
    for (const w of v.witnesses) {
      poseAt(w);
      const d = below(A, B, MARGIN);
      // a touch, or wholly inside (the winding number, apart from the sweep's rays)
      const real = (d !== null && d <= 1e-3) || insideTruth(A, B) === true || insideTruth(B, A) === true;
      expect(real, `${where} ${ids(pi)}: the witness at ${w.toFixed(4)} touches or lies inside (distance ${d})`).toBe(true);
    }
    // a free sample's proven stretch (its open radius) holds no touch — the
    // truth at dense points across it (plan 2.2, 7.5; Codex R141/R142)
    for (let q = 0; q < v.free.length; q++) {
      const f = v.free[q]!, r = v.freeR[q]!;
      // the radius stays inside the chunk whose V proves it (plan 2.2, Codex R142):
      // the track's cum is the sweep's distance parameter in these tracks
      if (r > 0) expect((chunks.get(pi) ?? []).some(([s0, s1]) => f - r >= s0 - 1e-3 && f + r <= s1 + 1e-3),
        `${where} ${ids(pi)}: the free stretch ${f.toFixed(4)} ± ${r.toFixed(4)} lies inside one chunk of the pair`).toBe(true);
      for (let k = -8; k <= 8; k++) {
        const x = f + (r * k) / 8.0001;   // inside the open stretch
        if (x < 0 || x > end) continue;
        poseAt(x);
        const d = below(A, B, MARGIN);
        const inside = insideTruth(A, B) === true || insideTruth(B, A) === true;
        expect((d === null || d > CONTACT_EPS / 2) && !inside,
          `${where} ${ids(pi)}: the free stretch ${f.toFixed(4)} ± ${r.toFixed(4)} holds a touch at ${x.toFixed(4)} (distance ${d})`).toBe(true);
        freeChecked++;
      }
    }
    // the stays without a touch are the records' near misses, one for one —
    // except where the records keyed a second stay on the SAME line into one
    // record (one per line and pair: a touch later on the line replaced the
    // near miss, the repeated-line case of Codex VP84-01)
    const oldNear = recs.filter(h => h.continuation === undefined && !h.boundary && !h.possible && h.dist > CONTACT_EPS && !h.touches);
    const newNear = v.episodes.filter(e => e.ivCount === 0 && e.origin === ORIGIN_PROGRAM);
    nears += newNear.length;
    // a sample ON a segment's end is the next segment's in the sweep's loop
    // (a chunk starts there): both lines there
    const linesOf = (cum: number): number[] => {
      let i = 1;
      while (i < track.count - 1 && track.cum[i]! < cum) i++;
      const out = [track.lines[i]!];
      if (Math.abs(track.cum[i]! - cum) <= 1e-6 && i + 1 < track.count) out.push(track.lines[i + 1]!);
      return out;
    };
    const unmatchedOld = oldNear.slice();
    for (const e of newNear) {
      const lns = linesOf(e.onset);
      const k = unmatchedOld.findIndex(h => lns.includes(h.line));
      if (k >= 0) { unmatchedOld.splice(k, 1); continue; }
      expect(recs.some(h => lns.includes(h.line)), `${where} ${ids(pi)}: a near-miss stay at ${e.onset.toFixed(4)} (L${lns.join("/")}) the records have no record of on its line`).toBe(true);
      collapsed++;
    }
    expect(unmatchedOld.map(h => `L${h.line} @${h.cum.toFixed(3)}`), `${where} ${ids(pi)}: near misses of the records the store has no stay for`).toEqual([]);
  }
  void IV_POSSIBLE;
  if (process.env.COLLISION_CONTACTS_LOG) fs.appendFileSync(process.env.COLLISION_CONTACTS_LOG,
    `${where}: ${touches} touch intervals, ${nears} near stays; records bridged a proven free sample ${bridgedN}×, floored at a line start ${flooredN}×, collapsed a second stay of a line ${collapsed}×; free stretches checked at ${freeChecked} points\n`);
  return { skipped: false, touches, nears, collapsed };
}

describe("the contact store against the records, one sweep (step 4 package 2, plan 7.2)", () => {
  const cases: Array<{ c: Case; load: () => { model: CollisionModel } }> = [
    ...shippedCases(FILES).map(c => ({ c, load: () => loadShippedModel(c, FILES) })),
    ...Array.from({ length: 10 }, (_, k) => { const g = generatedCase(20261012 + k); return { c: g.c, load: () => g }; }),
  ];
  let reached = 0;
  for (const { c, load } of cases) {
    it(`${c.name}: the same contacts, the named differences only`, { timeout: 600_000 }, () => {
      const { model } = load();
      const rand = rng(c.seed ?? 20261012);
      for (let t = 0; t < 2; t++) {
        const res = compare(c, model, randomTrack(c, rand, 4, 0.5), `${c.name} track ${t}`);
        if (!res.skipped && res.touches > 0) reached++;
      }
    });
  }
  it("the comparison reaches contacts", () => {
    expect(reached, "tracks with touches compared").toBeGreaterThan(5);
  });
});

describe("a spent budget stops the sweep and says from where (step 4 package 2, plan 2.4)", () => {
  it("rows up to the budget, the same as a full run's first rows; open contacts stay open; incompleteFrom", { timeout: 600_000 }, () => {
    const g = generatedCase(20261016);
    const rand = rng(g.c.seed!);
    const track = randomTrack(g.c, rand, 4, 0.5);
    const full = new ContactStore(1, 0);
    sweepCollisions(g.model, track, WCS0, { margin: MARGIN, contacts: { store: full } });
    expect(full.intervals.rows, "the full run has more than the small budget").toBeGreaterThan(3);
    const small = new ContactStore(1, 0, { episodes: 65536, intervals: 3, gaps: 16384 });
    const r = sweepCollisions(g.model, track, WCS0, { margin: MARGIN, contacts: { store: small } });
    expect(r.truncated?.reason).toBe("budget");
    expect(r.incompleteFrom, "said from where").toBeDefined();
    expect(r.incompleteFrom!).toBeLessThan(track.cum[track.count - 1]!);
    expect(small.intervals.rows).toBe(3);
    // the gathered findings are the full run's first ones: nothing summarized
    for (let iv = 0; iv < 3; iv++) {
      expect(small.intervals.get(iv, "enter")).toBe(full.intervals.get(iv, "enter"));
      expect(small.intervals.get(iv, "witness")).toBe(full.intervals.get(iv, "witness"));
      const exit = small.intervals.get(iv, "exit");
      // closed as in the full run, or still open at the stop — never an invented exit
      if (!Number.isNaN(exit)) expect(exit).toBe(full.intervals.get(iv, "exit"));
      else expect(small.intervals.get(iv, "witness")).toBeLessThanOrEqual(r.incompleteFrom! + 1e-9);
    }
  });
});
