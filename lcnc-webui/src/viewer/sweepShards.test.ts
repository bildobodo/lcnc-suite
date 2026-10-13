// The parallel sweep's partition and merge (sweepShards.ts) — and the merged
// result held to the single sweep on the shipped models. The relation is not
// byte equality: a shard steps to the nearest certificate expiry over ITS
// pairs, so a pair is sampled at other points than in the single sweep. What
// must agree is what the sweep promises per pair: the same static contacts
// and prescreen (pair-local, at the same poses), the same records — a record
// one run has and the other lacks only for a run no wider than MIN_ADV, the
// truth decides — and every contact interval's start inside the other's
// intervals within the bisection's tolerance, both ways. The contact tables
// (step 4 package 2, plan 7.3 "Shards") the same way: every touch interval's
// witness and boundaries inside the other run's intervals of its pair, else a
// touch run no wider than MIN_ADV by the truth.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_HITS, sweepCollisions, type CollisionHit, type CollisionOptions, type CollisionResult } from "./collision";
import { ContactStore } from "./contactStore";
import { CONTACT, MARGIN, insideTrack, loadShippedModel, randomTrack, rng, shippedCases, trackTruth, type FixtureFiles } from "./collisionFixtures";
import { assignPairs, mergeShardResults } from "./sweepShards";

const ROOT = path.resolve(__dirname, "../../..");
const FILES: FixtureFiles = {
  text: rel => fs.readFileSync(path.join(ROOT, rel), "utf8"),
  bytes: rel => fs.readFileSync(path.join(ROOT, rel)),
};
const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 } as any;
const TOL = 0.01;   // interval boundaries are bisected to 1e-3

describe("assignPairs", () => {
  it("puts every pair in exactly one shard, the costliest first onto the least loaded", () => {
    const cost = [5, 1, 9, 3, 3, 7, 0, 2];
    const masks = assignPairs(cost, 3);
    for (let i = 0; i < cost.length; i++) expect(masks.reduce((n, m) => n + m[i]!, 0), `pair ${i}`).toBe(1);
    const load = masks.map(m => cost.reduce((s, c, i) => s + (m[i] ? c : 0), 0));
    expect(Math.max(...load) - Math.min(...load), `balanced: ${load}`).toBeLessThanOrEqual(Math.max(...cost));
    expect(assignPairs(cost, 3), "deterministic").toEqual(masks);
  });
  it("more shards than pairs leaves the extra shards empty", () => {
    const masks = assignPairs([1, 1], 4);
    expect(masks.map(m => m.reduce((a, b) => a + b, 0))).toEqual([1, 1, 0, 0]);
  });
});

describe("mergeShardResults", () => {
  const hit = (line: number, cum: number, cont?: number): CollisionHit =>
    ({ line, cum, cumEnd: cum, a: "a", b: `b${line}`, dist: 0, rapid: false, ...(cont !== undefined ? { continuation: cont } : {}) });
  const result = (hits: CollisionHit[], extra: Partial<CollisionResult> = {}): CollisionResult => ({
    hits, staticContacts: [], samples: 10, coarsened: false, uncertified: null, pairCount: 9,
    pairsPrescreened: 2, bvhMs: 5, sweepMs: 100, truncated: null, ...extra });
  it("concatenates, sums and orders by position", () => {
    const m = mergeShardResults([
      result([hit(3, 30), hit(1, 10)], { staticContacts: [{ a: "x", b: "y", dist: 0 }], samples: 7, sweepMs: 80 }),
      result([hit(2, 20)], { samples: 5, pairsPrescreened: 1, bvhMs: 9, coarsened: true }),
    ]);
    expect(m.hits.map(h => h.line)).toEqual([1, 2, 3]);
    expect(m.staticContacts).toHaveLength(1);
    expect([m.samples, m.pairsPrescreened, m.pairCount, m.bvhMs, m.sweepMs, m.coarsened]).toEqual([12, 3, 9, 9, 100, true]);
  });
  it("keeps the earliest point any shard's contact store stopped writing (Codex R144 VP-I100)", () => {
    const m = mergeShardResults([
      result([hit(1, 1)], { truncated: { covered: 0.2, reason: "budget" }, incompleteFrom: 4 }),
      result([hit(2, 2)]),
      result([], { truncated: { covered: 0.5, reason: "budget" }, incompleteFrom: 9 })]);
    expect([m.incompleteFrom, m.truncated]).toEqual([4, { covered: 0.2, reason: "budget" }]);
    expect(mergeShardResults([result([hit(1, 1)]), result([hit(2, 2)])]).incompleteFrom, "no store stopped").toBeUndefined();
  });
  it("keeps the model's body classes — one model for every shard", () => {
    const bodies = { unusable: [], damaged: ["chipped"], open: ["frame"] };
    expect(mergeShardResults([result([hit(1, 1)], { bodies }), result([hit(2, 2)], { bodies })]).bodies).toEqual(bodies);
  });
  it("caps the single sweep's way: onsets before continuations", () => {
    const onsets = Array.from({ length: MAX_HITS - 10 }, (_, i) => hit(1000 + i, 1000 + i));
    const conts = Array.from({ length: 50 }, (_, i) => hit(i, i, 1));   // earlier, but continuations
    const m = mergeShardResults([result(onsets.slice(0, 100)), result([...onsets.slice(100), ...conts])]);
    expect(m.hits).toHaveLength(MAX_HITS);
    expect(m.hits.filter(h => h.continuation === undefined)).toHaveLength(MAX_HITS - 10);
    expect(m.hits.map(h => h.cum)).toEqual([...m.hits.map(h => h.cum)].sort((x, y) => x - y));
  });
  it("says what the caps left out: every shard's own and what the merge cuts again (`capped`)", () => {
    const onsets = Array.from({ length: MAX_HITS - 10 }, (_, i) => hit(1000 + i, 1000 + i));
    const conts = Array.from({ length: 50 }, (_, i) => hit(i, i, 1));
    const m = mergeShardResults([result(onsets.slice(0, 100), { capped: 7 }), result([...onsets.slice(100), ...conts], { capped: 3 })]);
    expect(m.capped).toBe(7 + 3 + (MAX_HITS - 10 + 50 - MAX_HITS));
    expect(mergeShardResults([result([hit(1, 1)]), result([hit(2, 2)])]).capped, "nothing cut").toBeUndefined();
    expect(m.cappedOnsets, "every onset listed").toBeUndefined();
  });
  it("counts the contact beginnings the caps left out apart (`cappedOnsets`): every shard's own and the merge's", () => {
    const onsets = Array.from({ length: MAX_HITS + 6 }, (_, i) => hit(1000 + i, 1000 + i));
    const m = mergeShardResults([result(onsets.slice(0, 100), { capped: 4, cappedOnsets: 2 }), result(onsets.slice(100))]);
    expect(m.hits.filter(h => h.continuation === undefined)).toHaveLength(MAX_HITS);
    expect(m.cappedOnsets).toBe(2 + 6);
    expect(m.capped).toBe(4 + 6);
  });
  it("carries a range sweep's start and every shard's boundary contacts; a boundary record is no onset for the cap", () => {
    const range = { fromCum: 40, fromLine: 7 };
    const bc = (b: string) => ({ a: "a", b, line: 7, cum: 40, dist: 0, cutting: false });
    const m = mergeShardResults([result([], { range, boundaryContacts: [bc("x")] }),
      result([], { range, boundaryContacts: [bc("y"), bc("z")] })]);
    expect(m.range).toEqual(range);
    expect(m.boundaryContacts?.map(b => b.b)).toEqual(["x", "y", "z"]);
    expect(mergeShardResults([result([]), result([])]).boundaryContacts, "absent on a full sweep").toBeUndefined();
    const onsets = Array.from({ length: MAX_HITS - 10 }, (_, i) => hit(1000 + i, 1000 + i));
    const prov = Array.from({ length: 50 }, (_, i) => ({ ...hit(i, i), boundary: true as const }));
    const capped = mergeShardResults([result(onsets.slice(0, 100)), result([...onsets.slice(100), ...prov])]);
    expect(capped.hits.filter(h => !h.boundary)).toHaveLength(MAX_HITS - 10);
  });
  it("is only as covered as its least covered shard", () => {
    const m = mergeShardResults([result([], { truncated: { covered: 0.8, reason: "time" } }), result([]),
      result([], { truncated: { covered: 0.3, reason: "stopped" } })]);
    expect(m.truncated).toEqual({ covered: 0.3, reason: "stopped" });
  });
});

describe("the merged shards against the single sweep", () => {
  const CASES = shippedCases(FILES).filter(c => c.name !== "3 axis");
  for (const c of CASES) {
    it(`${c.name}: the same per-pair findings with 2, 3 and a random split`, { timeout: 600_000 }, () => {
      const { model } = loadShippedModel(c, FILES);
      // the random track, and a track from the case's pose where a body lies
      // wholly inside another (the inside check's state is per pair too)
      const tracks = [randomTrack(c, rng(c.seed ?? 20261007 + c.name.length), 3, 0.25)];
      if (c.inside) tracks.push(insideTrack(c, c.inside, rng(5)));
      for (const [ti, track] of tracks.entries()) {
      // every run writes its contact tables beside its records
      type Run = { r: CollisionResult; st: ContactStore };
      const sweep = (o: CollisionOptions): Run => { const st = new ContactStore(1, 0); return { r: sweepCollisions(model, track, WCS0, { ...o, contacts: { store: st } }), st }; };
      const singleRun = sweep({ margin: MARGIN });
      const single = singleRun.r;
      expect(single.hits.length, "under the cap — the comparison is complete").toBeLessThan(MAX_HITS);
      const truth = trackTruth(model, c, track);
      const pairIndex = new Map(model.pairs.map(([a, b], i) => [[model.bodies[a]!.id, model.bodies[b]!.id].sort().join("/"), i]));
      const key = (h: CollisionHit) => `${h.boundary ? "B" : ""}${h.line}|${[h.a, h.b].sort().join("/")}`;
      const byKey = (r: CollisionResult) => new Map(r.hits.map(h => [key(h), h]));
      const rand = rng(7);
      const byMask = (masks: Uint8Array[]) => () => masks.map(m => sweep({ margin: MARGIN, pairMask: m }));
      const splits: Array<[string, () => Run[]]> = [
        ["2 shards", byMask(assignPairs(new Float64Array(model.pairs.length).fill(1), 2))],
        ["3 shards", byMask(assignPairs(new Float64Array(model.pairs.length).fill(1), 3))],
        ["a random split", byMask(assignPairs(Float64Array.from(model.pairs, () => rand()), 4))],
        // The workers' own split: each shard assigns itself after the baseline.
        ["the shard option, 3", () => [0, 1, 2].map(index => sweep({ margin: MARGIN, shard: { index, of: 3 } }))],
      ];
      // A range sweep from the middle point too (plan „Prüfung im Lauf“ 3b):
      // the shards' boundary contacts are each its own pairs'.
      const mid = Math.floor(track.count / 2);
      const singleRange = sweep({ margin: MARGIN, range: { from: mid } });
      const runs: Array<[string, () => Run[], Run]> = [
        ...splits.map(([n, r]) => [n, r, singleRun] as [string, () => Run[], Run]),
        ["a range from the middle, the shard option, 3", () => [0, 1, 2].map(index =>
          sweep({ margin: MARGIN, range: { from: mid }, shard: { index, of: 3 } })), singleRange],
      ];
      for (const [name, run, singleOf] of runs) {
        const single = singleOf.r;
        const shardRuns = run();
        const merged = mergeShardResults(shardRuns.map(x => x.r));
        const where = `${c.name}${ti ? " inside track" : ""}, ${name}`;
        expect(merged.range, `${where}: the range`).toEqual(single.range);
        const bcs = (r: CollisionResult) => (r.boundaryContacts ?? []).map(b => `${[b.a, b.b].sort().join("/")} ${b.cutting}`).sort();
        expect(bcs(merged), `${where}: boundary contacts`).toEqual(bcs(single));
        expect(merged.uncertified, where).toBe(single.uncertified);
        expect(merged.truncated, where).toBeNull();
        expect([merged.pairCount, merged.pairsPrescreened], `${where}: pairs and prescreen`).toEqual([single.pairCount, single.pairsPrescreened]);
        const sc = (r: CollisionResult) => r.staticContacts.map(s => `${[s.a, s.b].sort().join("/")} ${s.dist.toFixed(6)}`).sort();
        expect(sc(merged), `${where}: static contacts`).toEqual(sc(single));
        const A = byKey(single), B = byKey(merged);
        // A record only one run has, or a touch only one run calls a touch:
        // the truth must show a run no wider than MIN_ADV there.
        const narrow = (h: CollisionHit, touch: boolean) => !truth.runWide(pairIndex.get([h.a, h.b].sort().join("/"))!, h.cum, touch ? CONTACT * 10 : MARGIN, touch);
        for (const [k, h] of A) if (!B.has(k)) expect(narrow(h, h.dist <= CONTACT), `${where}: ${k} only in the single sweep`).toBe(true);
        for (const [k, h] of B) if (!A.has(k)) expect(narrow(h, h.dist <= CONTACT), `${where}: ${k} only in the merged shards`).toBe(true);
        for (const [k, a] of A) {
          const b = B.get(k);
          if (!b) continue;
          expect(b.continuation, `${where}: ${k} onset or continuation`).toBe(a.continuation);
          if ((a.dist <= CONTACT) !== (b.dist <= CONTACT)) {
            const t = a.dist <= CONTACT ? a : b;
            expect(narrow(t, true), `${where}: ${k} a touch in one run only`).toBe(true);
            continue;
          }
          const inside = (x: number, ivs?: Array<[number, number]>) => (ivs ?? []).some(([p, q]) => x >= p - TOL && x <= q + TOL);
          for (const [s] of a.intervals ?? []) expect(inside(s, b.intervals), `${where}: ${k} contact from ${s} in the merged shards`).toBe(true);
          for (const [s] of b.intervals ?? []) expect(inside(s, a.intervals), `${where}: ${k} contact from ${s} in the single sweep`).toBe(true);
        }
        // The contact tables: the shards' are the union of their pairs' (disjoint), each pair's
        // touch intervals agree with the single sweep's — witness, entry and a decided exit inside
        // the other run's intervals of the pair, else the truth shows a touch run no wider than MIN_ADV.
        const ivs = (stores: ContactStore[]) => {
          const m = new Map<number, Array<{ a: number; b: number; w: number }>>();
          for (const st of stores) for (let k = 0; k < st.intervals.rows; k++) {
            const pair = st.episodes.get(st.intervals.get(k, "episode"), "pair");
            const b = st.intervals.get(k, "exit");
            m.set(pair, [...(m.get(pair) ?? []), { a: st.intervals.get(k, "enter"), b: Number.isNaN(b) ? Infinity : b, w: st.intervals.get(k, "witness") }]);
          }
          return m;
        };
        const S = ivs([singleOf.st]), M = ivs(shardRuns.map(x => x.st));
        const shardPairs = shardRuns.map(x => new Set(Array.from({ length: x.st.episodes.rows }, (_, e) => x.st.episodes.get(e, "pair"))));
        for (let i = 0; i < shardPairs.length; i++) for (let j = i + 1; j < shardPairs.length; j++) {
          for (const p of shardPairs[i]!) expect(shardPairs[j]!.has(p), `${where}: pair ${p} in two shards' tables`).toBe(false);
        }
        let compared = 0;
        for (const [X, Y, side] of [[S, M, "the single sweep"], [M, S, "the merged shards"]] as const) {
          for (const [pair, list] of X) {
            const other = Y.get(pair) ?? [];
            const covered = (x: number) => other.some(v => x >= v.a - TOL && x <= v.b + TOL);
            const ids = `${model.bodies[model.pairs[pair]![0]]!.id}/${model.bodies[model.pairs[pair]![1]]!.id}`;
            for (const v of list) {
              for (const [what, x] of [["witness", v.w], ["entry", v.a], ...(Number.isFinite(v.b) ? [["exit", v.b] as const] : [])] as const) {
                if (covered(x)) { compared++; continue; }
                expect(truth.runWide(pair, x, CONTACT * 10, true), `${where}: ${ids} ${what} at ${x.toFixed(4)} only in ${side}`).toBe(false);
              }
            }
          }
        }
        expect(compared, `${where}: touch intervals compared`).toBeGreaterThan(0);
      }
      }
    });
  }
});
