// The parallel sweep's partition and merge (sweepShards.ts) — and the merged
// result held to the single sweep on the shipped models. The relation is not
// byte equality: a shard steps to the nearest certificate expiry over ITS
// pairs, so a pair is sampled at other points than in the single sweep. What
// must agree is what the sweep promises per pair: the same static contacts
// and prescreen (pair-local, at the same poses), the same records — a record
// one run has and the other lacks only for a run no wider than MIN_ADV, the
// truth decides — and every contact interval's start inside the other's
// intervals within the bisection's tolerance, both ways.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_HITS, sweepCollisions, type CollisionHit, type CollisionResult } from "./collision";
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
  it("caps the single sweep's way: onsets before continuations", () => {
    const onsets = Array.from({ length: MAX_HITS - 10 }, (_, i) => hit(1000 + i, 1000 + i));
    const conts = Array.from({ length: 50 }, (_, i) => hit(i, i, 1));   // earlier, but continuations
    const m = mergeShardResults([result(onsets.slice(0, 100)), result([...onsets.slice(100), ...conts])]);
    expect(m.hits).toHaveLength(MAX_HITS);
    expect(m.hits.filter(h => h.continuation === undefined)).toHaveLength(MAX_HITS - 10);
    expect(m.hits.map(h => h.cum)).toEqual([...m.hits.map(h => h.cum)].sort((x, y) => x - y));
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
      const single = sweepCollisions(model, track, WCS0, { margin: MARGIN });
      expect(single.hits.length, "under the cap — the comparison is complete").toBeLessThan(MAX_HITS);
      const truth = trackTruth(model, c, track);
      const pairIndex = new Map(model.pairs.map(([a, b], i) => [[model.bodies[a]!.id, model.bodies[b]!.id].sort().join("/"), i]));
      const key = (h: CollisionHit) => `${h.line}|${[h.a, h.b].sort().join("/")}`;
      const byKey = (r: CollisionResult) => new Map(r.hits.map(h => [key(h), h]));
      const rand = rng(7);
      const byMask = (masks: Uint8Array[]) => () => masks.map(m => sweepCollisions(model, track, WCS0, { margin: MARGIN, pairMask: m }));
      const splits: Array<[string, () => CollisionResult[]]> = [
        ["2 shards", byMask(assignPairs(new Float64Array(model.pairs.length).fill(1), 2))],
        ["3 shards", byMask(assignPairs(new Float64Array(model.pairs.length).fill(1), 3))],
        ["a random split", byMask(assignPairs(Float64Array.from(model.pairs, () => rand()), 4))],
        // The workers' own split: each shard assigns itself after the baseline.
        ["the shard option, 3", () => [0, 1, 2].map(index => sweepCollisions(model, track, WCS0, { margin: MARGIN, shard: { index, of: 3 } }))],
      ];
      for (const [name, run] of splits) {
        const merged = mergeShardResults(run());
        const where = `${c.name}${ti ? " inside track" : ""}, ${name}`;
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
      }
      }
    });
  }
});
