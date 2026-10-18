// The sweep against a brute-force oracle (the soundness hunt after the
// horizon bug, operator 2026-10-06: "kann es sein, dass sich noch weitere
// ähnliche Fehler eingeschlichen haben?"). The oracle poses the shipped
// machine models along random tracks every STEP of the sweep's own distance
// parameter (1° ≙ 1 mm) and asks each pair exactly whether it is inside the
// margin — and whether it touches. Then:
//  · every touch the oracle finds lies in a touch interval of its pair,
//    and every in-margin pose has a stay of its pair reaching its line —
//    unless the run around it, its ends bisected, is no wider than the
//    sweep's guarantee (MIN_ADV); for the line's stay, the run inside its
//    line (a run crossing a line's end by less than MIN_ADV is seen on the
//    next). The oracle's own grid sees runs of STEP and wider: the gate's
//    0.5, a hunt's 0.25, plan 7.3 check 2's 0.05 (COLLISION_STEP);
//  · every reported onset is a real touch, every near miss a real distance.
// What the oracle shares with the sweep is the pose (the kinematics mirror
// and the group-tree compose, each pinned by its own tests), the estimators
// collisionBounds.test.ts proves and the library's bounded query — a search
// tool, not an independent proof (Codex R86); the stepping, the certificates,
// the in-margin cadence, the contact tables and their bisections are what it
// checks (step 4 package 2, plan 7.3 — the records went with C2).
// COLLISION_SHORT_LINES=1 cuts every track into short lines (shortLines:
// 0.05–1.5 each, the kind flipping now and then), where a line has no sample
// of its own since the per-line sample went (plan 5, B8) — a stay must still
// reach every line its pair is inside the margin on.
// A body wholly inside another is a touch too (collision-inside.plan.md
// §5): its truth is the winding number (collisionFixtures.insideTruth — no
// BVH, no rays, apart from the product's way), and every case also sweeps a
// track through a pose where one body lies wholly inside another.
import * as fs from "node:fs";
import * as path from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { geometryNote, sweepCollisions, type CollisionTrack } from "./collision";
import { CONTACT, MARGIN, MIN_ADV, generatedCase, inSpans, insideAt, insidePose, insideTrack, insideTruth, loadShippedModel, meetsSpan, randomTrack, rng, shippedCases, shortLines,
         tablesByPair, trackTruth, type Case, type FixtureFiles, type PairTables } from "./collisionFixtures";
import { ContactStore } from "./contactStore";
import type { CollisionModel } from "./collision";

const ROOT = path.resolve(__dirname, "../../..");
const TOL = 0.01;           // interval boundaries are bisected to 1e-3
// COLLISION_HUNT=deep runs the hunt: every case's tracks at full length,
// hours on this VM, and requires each case to reach touches and near poses.
// The default is the gate's share: one short track per case — the bugs the
// hunt found have their own unit tests; this keeps the walk itself honest.
const DEEP = process.env.COLLISION_HUNT === "deep";
// the oracle's stride along the sweep's distance parameter (COLLISION_STEP: plan 7.3 check 2's 0.05)
const STEP = Number(process.env.COLLISION_STEP) || (DEEP ? MIN_ADV : 0.5);
const SHORT_LINES = process.env.COLLISION_SHORT_LINES === "1";
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
/** The oracle's walk over one case: random tracks (and a track from a pose
 *  where a body lies wholly inside another), each swept and held to the
 *  truth. `insideTries`: search an inside pose afresh with that many tries
 *  (a generated machine has none recorded). What it reached is returned. */
function oracleWalk(c: Case, model: CollisionModel, stock: Set<string>,
                    opts: { insideTries?: number; seed?: number; tracks?: number; segments?: number; reach?: number } = {}) {
  const insideTries = opts.insideTries ?? 0;
  const t0 = performance.now();
  const seed = Number(process.env.COLLISION_HUNT_SEED) || opts.seed || (DEEP ? 20261007 + c.name.length : c.seed ?? 20261007 + c.name.length);
  const rand = rng(seed);
  let touches = 0, nears = 0, onsets = 0, narrow = 0, insides = 0;
  const tracks: Array<{ track: CollisionTrack; where: string }> = [];
  for (let ti = 0; ti < (DEEP ? c.tracks : opts.tracks ?? 1); ti++)
    tracks.push({ track: randomTrack(c, rand, DEEP ? c.segments : opts.segments ?? 3, DEEP ? 0.6 : opts.reach ?? 0.25), where: `${c.name} track ${ti}` });
  if (SHORT_LINES) for (const t of tracks) { t.track = shortLines(t.track, rand); t.where += " (short lines)"; }
  // A body wholly inside another: a pose the winding number finds, and a
  // short track from it (`insideTrack`).
  // The gate takes the case's recorded pose (a case without one has none
  // to find: the 3-axis model's search costs 73 s for nothing); a hunt
  // searches afresh.
  const found = DEEP || insideTries ? insidePose(model, c, rand, DEEP ? 4000 : insideTries) : c.inside ? insideAt(model, c, c.inside) : null;
  if (!DEEP && !insideTries && c.inside && !found) expect.fail(`${c.name}: the recorded inside pose has no body inside another any more — search again (COLLISION_HUNT=deep)`);
  if (found) {
    const t = insideTrack(c, found.at, rand);
    tracks.push({ track: SHORT_LINES ? shortLines(t, rand) : t, where: `${c.name} inside track (${found.a} in ${found.b})${SHORT_LINES ? " (short lines)" : ""}` });
    insideCases.push(c.name);
  }
  for (const { track, where } of tracks) {
    const store = new ContactStore(1, 0);
    const r = sweepCollisions(model, track, WCS0, { margin: MARGIN, contacts: { store } });
    const { poseAt, below, runWide, lineSpan, WIDE } = trackTruth(model, c, track);
    expect(r.truncated, `${where}: swept whole`).toBeNull();
    // certified but for what the model itself cannot promise (a surface
    // that is not closed has no inside — named once for the model)
    expect(r.uncertified, `${where}: certified`).toBe(geometryNote(model));
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
    // A pair the sweep must stay quiet about: a static contact, or the
    // cutter in the stock (cutting — its own tests). The oracle's own
    // reading of the model, not the sweep's pair flags: the cutter is
    // the body it added, the stock what machine.json marks.
    const exempt = (pi: number) => {
      const [a, b] = model.pairs[pi]!.map(i => model.bodies[i]!.id) as [string, string];
      return staticPairs.has(ids(pi)) || (a === "tool" && stock.has(b)) || (b === "tool" && stock.has(a));
    };
    const end = track.cum[track.count - 1]!;
    // the tables: per pair its touch intervals, its stays in the margin,
    // its witnesses, decided entries and near misses
    const tabs = tablesByPair(store, end), NO_TABLES: PairTables = { touches: [], stays: [], gaps: [], witnesses: [], enters: [], nears: [], boundary: 0 };
    for (let s = STEP / 2; s < end; s += STEP) {
      if (performance.now() - t0 > BUDGET_MS) expect.fail(`${where}: over the case's budget at s ${s.toFixed(1)} of ${end.toFixed(1)}`);
      const seg = poseAt(s), line = track.lines[seg]!;
      for (let pi = 0; pi < model.pairs.length; pi++) {
        if (exempt(pi)) continue;
        const d = belowMargin(pi);
        const inside = d === null || d > CONTACT ? insideNow(pi) === true : false;
        if (d === null && !inside) continue;
        const tab = tabs.get(pi) ?? NO_TABLES;
        const what = `${where} s ${s.toFixed(2)} (L${line}) ${ids(pi)} true ${inside ? "inside" : d!.toFixed(4)}`;
        if (inside || d! <= CONTACT) {
          touches++;
          if (inside) insides++;
          if (!inSpans(tab.touches, s, TOL)) {
            if (runWide(pi, s, CONTACT * 10, true)) {
              expect.fail(`${what}: a touch wider than ${WIDE} of path outside every touch interval of the tables — ${JSON.stringify(tab.touches)}`);
            }
            narrow++;
            poseAt(s);
          }
        } else {
          nears++;
          // a stay of the pair reaching into the pose's line (the stay runs
          // from the sample that found it to its last sample in the margin),
          // or a touch around it
          const [l0, l1] = lineSpan(seg);
          if (!meetsSpan(tab.stays, l0, l1) && !inSpans(tab.touches, s, TOL)) {
            if (runWide(pi, s, MARGIN, false, lineSpan(seg))) {
              expect.fail(`${what}: inside the margin wider than ${WIDE} of path on its line with no stay of the tables reaching it — ${JSON.stringify(tab.stays)}`);
            }
            narrow++;
            poseAt(s);
          }
        }
      }
    }
    // Every report is real: every witness and every decided entry touches
    // (or lies inside), every near miss is as near as it says
    for (const [pi, tab] of tabs) {
      const A = model.bodies[model.pairs[pi]![0]]!, B = model.bodies[model.pairs[pi]![1]]!;
      for (const x of [...tab.witnesses, ...tab.enters]) {
        poseAt(x);
        const d = below(A, B, MARGIN);
        const real = (d !== null && d <= 1e-3) || insideTruth(A, B) === true || insideTruth(B, A) === true;
        expect(real, `${where} ${ids(pi)}: the tables' touch at ${x.toFixed(3)} touches or lies inside (distance ${d})`).toBe(true);
        onsets++;
      }
      for (const n of tab.nears) {
        poseAt(n.at);
        const d = below(A, B, MARGIN + 1e-3);
        expect(d, `${where} ${ids(pi)}: the tables' near miss at ${n.at.toFixed(3)}`).not.toBeNull();
        expect(Math.abs(d! - n.dist), `${where} ${ids(pi)}: the tables' near miss ${n.dist} is the true ${d}`).toBeLessThanOrEqual(1e-3);
      }
    }
  }
  return { seed, touches, nears, onsets, narrow, insides, t0 };
}

describe("the sweep against a brute-force oracle", () => {
  for (const c of CASES) {
    it(`${c.name}: every touch and every in-margin pose the oracle finds is reported, every report is real`, { timeout: TIMEOUT_MS }, () => {
      const { model, stock } = loadShippedModel(c, FILES);
      const { seed, touches, nears, onsets, narrow, insides, t0 } = oracleWalk(c, model, stock);
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

// The same walk on machines nobody built (step 4 plan package 2, 7.3;
// operator 2026-10-11: the check is general by construction — show it):
// generatedCase draws the family, the axes' sides and order, the pivots and
// the bodies per seed. COLLISION_GEN sets how many (the gate's ten: two per
// family; a hunt fifty).
const GEN = Number(process.env.COLLISION_GEN) || (DEEP ? 50 : 10);
describe("the sweep against a brute-force oracle on generated machines", () => {
  const reached: Array<{ name: string; touches: number; onsets: number }> = [];
  for (let i = 0; i < GEN; i++) {
    const seed = 20261012 + i;
    it(`generated machine ${seed}: every touch and every in-margin pose the oracle finds is reported, every report is real`, { timeout: TIMEOUT_MS }, () => {
      const { c, model, stock } = generatedCase(seed);
      const w = oracleWalk(c, model, stock, { seed, insideTries: 300, tracks: 2, segments: 4, reach: 0.5 });
      reached.push({ name: c.name, touches: w.touches, onsets: w.onsets });
      if (process.env.COLLISION_HUNT_LOG) fs.appendFileSync(process.env.COLLISION_HUNT_LOG,
        `${c.name}: ${w.touches} touching (${w.insides} inside), ${w.nears} near, ${w.onsets} onsets, ${w.narrow} narrow runs, ${((performance.now() - w.t0) / 1000).toFixed(0)} s\n`);
    });
  }
  it("the generated machines reach contact", () => {
    // the walk must have something to check: most machines touch somewhere
    expect(reached.filter(r => r.touches > 0).length, JSON.stringify(reached)).toBeGreaterThanOrEqual(Math.ceil(GEN / 2));
    expect(reached.reduce((n, r) => n + r.onsets, 0), "onsets checked").toBeGreaterThanOrEqual(GEN);
  });
});
