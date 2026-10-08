// The sweep against a brute-force oracle (the soundness hunt after the
// horizon bug, operator 2026-10-06: "kann es sein, dass sich noch weitere
// ähnliche Fehler eingeschlichen haben?"). The oracle poses the shipped
// machine models along random tracks every STEP of the sweep's own distance
// parameter (1° ≙ 1 mm) and asks each pair exactly whether it is inside the
// margin — and whether it touches. Then:
//  · every touch the oracle finds lies in a contact interval of its pair,
//    and every in-margin pose has a record of its pair on its line — unless
//    the run around it, its ends bisected, is no wider than the sweep's
//    guarantee (MIN_ADV). The oracle's own grid sees runs of STEP and wider:
//    the gate's 0.5, a hunt's 0.25;
//  · every reported onset is a real touch, every near miss a real distance.
// What the oracle shares with the sweep is the pose (the kinematics mirror
// and the group-tree compose, each pinned by its own tests), the estimators
// collisionBounds.test.ts proves and the library's bounded query — a search
// tool, not an independent proof (Codex R86); the stepping, the certificates,
// the in-margin cadence, the records and their refinement are what it
// checks. A body wholly inside another is a touch too (collision-inside.plan.md
// §5): its truth is the winding number (collisionFixtures.insideTruth — no
// BVH, no rays, apart from the product's way), and every case also sweeps a
// track through a pose where one body lies wholly inside another.
import * as fs from "node:fs";
import * as path from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { geometryNote, sweepCollisions, type CollisionHit, type CollisionTrack } from "./collision";
import { CONTACT, MARGIN, MIN_ADV, insideAt, insidePose, insideTrack, insideTruth, loadShippedModel, randomTrack, rng, shippedCases, trackTruth, type FixtureFiles } from "./collisionFixtures";

const ROOT = path.resolve(__dirname, "../../..");
const TOL = 0.01;           // interval boundaries are bisected to 1e-3
// COLLISION_HUNT=deep runs the hunt: every case's tracks at full length,
// hours on this VM, and requires each case to reach touches and near poses.
// The default is the gate's share: one short track per case — the bugs the
// hunt found have their own unit tests; this keeps the walk itself honest.
const DEEP = process.env.COLLISION_HUNT === "deep";
const STEP = DEEP ? MIN_ADV : 0.5;   // the oracle's stride along the sweep's distance parameter
// Per case: a slow run fails by name, never hangs; COLLISION_HUNT_BUDGET=0
// lifts it (a seed that ran out of time in the gate's search).
const BUDGET_MS = process.env.COLLISION_HUNT_BUDGET === "0" || DEEP ? Infinity : 60_000;
// vitest cannot interrupt a synchronous test, but it marks one that ran past
// its timeout failed after all its checks passed: a hunt lifts it (a day).
const TIMEOUT_MS = BUDGET_MS === Infinity ? 86_400_000 : 600_000;
const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 } as any;

// Repo-relative reads for the shared fixtures (collisionFixtures.ts).
const FILES: FixtureFiles = {
  text: rel => fs.readFileSync(path.join(ROOT, rel), "utf8"),
  bytes: rel => fs.readFileSync(path.join(ROOT, rel)),
};
const CASES = shippedCases(FILES);

const insideCases: string[] = [];
describe("the sweep against a brute-force oracle", () => {
  for (const c of CASES) {
    it(`${c.name}: every touch and every in-margin pose the oracle finds is reported, every report is real`, { timeout: TIMEOUT_MS }, () => {
      const { model, stock } = loadShippedModel(c, FILES);
      const t0 = performance.now();
      const seed = Number(process.env.COLLISION_HUNT_SEED) || (DEEP ? 20261007 + c.name.length : c.seed ?? 20261007 + c.name.length);
      const rand = rng(seed);
      let touches = 0, nears = 0, onsets = 0, narrow = 0, insides = 0;
      const tracks: Array<{ track: CollisionTrack; where: string }> = [];
      for (let ti = 0; ti < (DEEP ? c.tracks : 1); ti++)
        tracks.push({ track: randomTrack(c, rand, DEEP ? c.segments : 3, DEEP ? 0.6 : 0.25), where: `${c.name} track ${ti}` });
      // A body wholly inside another: a pose the winding number finds, and a
      // short track from it (`insideTrack`).
      // The gate takes the case's recorded pose (a case without one has none
      // to find: the 3-axis model's search costs 73 s for nothing); a hunt
      // searches afresh.
      const found = DEEP ? insidePose(model, c, rand, 4000) : c.inside ? insideAt(model, c, c.inside) : null;
      if (!DEEP && c.inside && !found) expect.fail(`${c.name}: the recorded inside pose has no body inside another any more — search again (COLLISION_HUNT=deep)`);
      if (found) {
        tracks.push({ track: insideTrack(c, found.at, rand), where: `${c.name} inside track (${found.a} in ${found.b})` });
        insideCases.push(c.name);
      }
      for (const { track, where } of tracks) {
        const r = sweepCollisions(model, track, WCS0, { margin: MARGIN });
        const { poseAt, below, runWide, WIDE } = trackTruth(model, c, track);
        expect(r.truncated, `${where}: swept whole`).toBeNull();
        // certified but for what the model itself cannot promise (a surface
        // that is not closed has no inside — named once for the model)
        expect(r.uncertified, `${where}: certified`).toBe(geometryNote(model));
        expect(r.hits.length, `${where}: under the record cap — the comparison is complete`).toBeLessThan(200);
        // The main walk's question per pair, answered again only when the
        // pair's RELATIVE pose changed: the same two meshes in the same
        // relative pose are the same distance — exact, no certificate (a
        // linear move leaves most pairs' relative pose as it was).
        const lastRel = model.pairs.map(() => new Float64Array(16).fill(NaN));
        const lastAns: Array<number | null> = model.pairs.map(() => null);
        const lastInRel = model.pairs.map(() => new Float64Array(16).fill(NaN));
        const lastIn: Array<boolean | null> = model.pairs.map(() => null);
        const relNow = new THREE.Matrix4();
        const belowMargin = (pi: number): number | null => {
          const A = model.bodies[model.pairs[pi]![0]]!, B = model.bodies[model.pairs[pi]![1]]!;
          relNow.copy(A.world).invert().multiply(B.world);
          const e = relNow.elements, prev = lastRel[pi]!;
          let same = true;
          for (let k = 0; k < 16 && same; k++) same = Math.abs(e[k]! - prev[k]!) <= 1e-9;
          if (same) return lastAns[pi]!;
          prev.set(e);
          return (lastAns[pi] = below(A, B, MARGIN));
        };
        // Wholly inside (either way round), by the winding number — asked
        // where the surfaces are apart; null where it cannot tell.
        const insideNow = (pi: number): boolean | null => {
          const A = model.bodies[model.pairs[pi]![0]]!, B = model.bodies[model.pairs[pi]![1]]!;
          relNow.copy(A.world).invert().multiply(B.world);
          const e = relNow.elements, prev = lastInRel[pi]!;
          let same = true;
          for (let k = 0; k < 16 && same; k++) same = Math.abs(e[k]! - prev[k]!) <= 1e-9;
          if (same) return lastIn[pi]!;
          prev.set(e);
          const ab = insideTruth(A, B), ba = insideTruth(B, A);
          return (lastIn[pi] = ab === true || ba === true ? true : ab === null || ba === null ? null : false);
        };
        const ids = (pi: number) => [model.bodies[model.pairs[pi]![0]]!.id, model.bodies[model.pairs[pi]![1]]!.id].sort().join("/");
        const staticPairs = new Set(r.staticContacts.map(sc => [sc.a, sc.b].sort().join("/")));
        const byPair = new Map<string, CollisionHit[]>();
        for (const h of r.hits) { const k = [h.a, h.b].sort().join("/"); byPair.set(k, [...(byPair.get(k) ?? []), h]); }
        // A pair the sweep must stay quiet about: a static contact, or the
        // cutter in the stock (cutting — its own tests). The oracle's own
        // reading of the model, not the sweep's pair flags: the cutter is
        // the body it added, the stock what machine.json marks.
        const exempt = (pi: number) => {
          const [a, b] = model.pairs[pi]!.map(i => model.bodies[i]!.id) as [string, string];
          return staticPairs.has(ids(pi)) || (a === "tool" && stock.has(b)) || (b === "tool" && stock.has(a));
        };
        const inInterval = (recs: CollisionHit[], s: number) => recs.some(h =>
          (h.intervals ?? []).some(([a, b]) => s >= a - TOL && s <= b + TOL)
          || (h.spanCumEnd !== undefined && s >= h.cum - TOL && s <= h.spanCumEnd + TOL));
        const end = track.cum[track.count - 1]!;
        for (let s = STEP / 2; s < end; s += STEP) {
          if (performance.now() - t0 > BUDGET_MS) expect.fail(`${where}: over the case's budget at s ${s.toFixed(1)} of ${end.toFixed(1)}`);
          const seg = poseAt(s), line = track.lines[seg]!;
          for (let pi = 0; pi < model.pairs.length; pi++) {
            if (exempt(pi)) continue;
            const d = belowMargin(pi);
            const inside = d === null || d > CONTACT ? insideNow(pi) === true : false;
            if (d === null && !inside) continue;
            const recs = byPair.get(ids(pi)) ?? [];
            const what = `${where} s ${s.toFixed(2)} (L${line}) ${ids(pi)} true ${inside ? "inside" : d!.toFixed(4)}`;
            if (inside || d! <= CONTACT) {
              touches++;
              if (inside) insides++;
              if (!inInterval(recs, s)) {
                if (runWide(pi, s, CONTACT * 10, true)) expect.fail(`${what}: a touch wider than ${WIDE} of path outside every contact interval — ${JSON.stringify(recs.map(h => [h.line, h.dist, h.intervals]))}`);
                narrow++;
                poseAt(s);
              }
            } else {
              nears++;
              if (!recs.some(h => h.line === line) && !inInterval(recs, s)) {
                if (runWide(pi, s, MARGIN)) expect.fail(`${what}: inside the margin wider than ${WIDE} of path with no record on its line`);
                narrow++;
                poseAt(s);
              }
            }
          }
        }
        // Every report is real: an onset touches where it says, a near miss
        // is as near as it says.
        for (const h of r.hits) {
          const pi = model.pairs.findIndex(([a, b]) => [model.bodies[a]!.id, model.bodies[b]!.id].sort().join("/") === [h.a, h.b].sort().join("/"));
          const A = model.bodies[model.pairs[pi]![0]]!, B = model.bodies[model.pairs[pi]![1]]!;
          if (h.intervals) {
            for (const [a] of h.intervals) {
              poseAt(a);
              const d = below(A, B, MARGIN);
              // a touch, or wholly inside (a contact from the track's start)
              const real = (d !== null && d <= 1e-3) || insideTruth(A, B) === true || insideTruth(B, A) === true;
              expect(real, `${where} L${h.line} ${h.a}/${h.b}: touches or lies inside at its onset ${a.toFixed(3)} (distance ${d})`).toBe(true);
              onsets++;
            }
          } else {
            poseAt(h.cum);
            const d = below(A, B, MARGIN + 1e-3);
            expect(d, `${where} L${h.line} ${h.a}/${h.b}: near miss at ${h.cum.toFixed(3)}`).not.toBeNull();
            expect(Math.abs(d! - h.dist), `${where} L${h.line} ${h.a}/${h.b}: near miss ${h.dist} is the true ${d}`).toBeLessThanOrEqual(1e-3);
          }
        }
      }
      // COLLISION_HUNT_LOG=<file>: what each case reached, for a hunt's record.
      if (process.env.COLLISION_HUNT_LOG) fs.appendFileSync(process.env.COLLISION_HUNT_LOG,
        `${c.name} seed ${seed}: ${touches} touching (${insides} inside), ${nears} near, ${onsets} onsets, ${narrow} narrow runs, ${((performance.now() - t0) / 1000).toFixed(0)} s\n`);
      // The gate's seeds were chosen to reach contact; a hunt must reach
      // what matters too: touches, near poses, onsets.
      expect(touches, `${c.name}: touching poses`).toBeGreaterThan(0);
      expect(onsets, `${c.name}: onsets checked`).toBeGreaterThan(0);
      if (DEEP) {
        expect(touches, `${c.name}: touching poses`).toBeGreaterThan(20);
        expect(nears, `${c.name}: in-margin poses`).toBeGreaterThan(20);
        expect(onsets, `${c.name}: onsets checked`).toBeGreaterThan(3);
      }
    });
  }
  it("the inside tracks reach a body wholly inside another", () => {
    // The search must find one somewhere, or the inside truth checks nothing.
    expect(insideCases.length, "cases with an inside track").toBeGreaterThan(0);
  });
});
