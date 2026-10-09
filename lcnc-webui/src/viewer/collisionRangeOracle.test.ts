// The RANGE sweep (plan „Prüfung im Lauf“ 3b) against the brute-force oracle
// on the shipped models — the oracle of collisionOracle.test.ts, asked about
// the part of the track a provisional check covers. For a range from point h:
//  (a) every touch and in-margin pose after h is reported (a boundary
//      record counts — it is the contact in progress at h), unless its run is
//      no wider than the sweep's guarantee;
//  (b) every reported interval begins with a real touch;
//  (c) the boundary contacts are exactly the pairs inside the margin (or
//      wholly inside) at h — cutting pairs too — that the program's baseline
//      does not exclude;
//  (d) nothing before h: no record, no interval;
//  (e) the static exclusions are the program's (the full sweep's).
import * as fs from "node:fs";
import * as path from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { sweepCollisions, type CollisionHit, type CollisionTrack } from "./collision";
import { CONTACT, MARGIN, insideAt, insideTruth, loadShippedModel, randomTrack, rng, shippedCases, trackOf, trackTruth,
  type FixtureFiles } from "./collisionFixtures";

const ROOT = path.resolve(__dirname, "../../..");
const TOL = 0.01;
const STEP = 0.5;
const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 } as any;
const FILES: FixtureFiles = {
  text: rel => fs.readFileSync(path.join(ROOT, rel), "utf8"),
  bytes: rel => fs.readFileSync(path.join(ROOT, rel)),
};
const CASES = shippedCases(FILES);

/** The track with a vertex inserted at its parameter `s` — the segment there
 *  split in two, its line, kind and mode kept: the same path. */
function splitAt(t: CollisionTrack, s: number): { track: CollisionTrack; at: number } {
  let i = 1;
  while (i < t.count - 1 && t.cum[i]! < s) i++;
  const u = (s - t.cum[i - 1]!) / (t.cum[i]! - t.cum[i - 1]!);
  const ins = <T extends Float32Array | Uint32Array | Uint8Array>(a: T, w: number, v: (k: number) => number): T => {
    const out = new (a.constructor as any)(a.length + w) as T;
    out.set(a.subarray(0, i * w), 0);
    for (let k = 0; k < w; k++) out[i * w + k] = v(k);
    out.set(a.subarray(i * w), (i + 1) * w);
    return out;
  };
  const lerp = (a: Float32Array) => (k: number) => a[(i - 1) * 3 + k]! + (a[i * 3 + k]! - a[(i - 1) * 3 + k]!) * u;
  return { at: i, track: {
    ...t, count: t.count + 1,
    pos: ins(t.pos, 3, lerp(t.pos)), abc: ins(t.abc, 3, lerp(t.abc)),
    cum: ins(t.cum, 1, () => s), lines: ins(t.lines, 1, () => t.lines[i]!), rapid: ins(t.rapid, 1, () => t.rapid[i]!),
    ...(t.mode ? { mode: ins(t.mode, 1, () => t.mode![i]!) } : {}),
  } };
}

describe("the range sweep against the brute-force oracle", () => {
  for (const c of CASES) {
    it(`${c.name}: from its middle, from inside a contact and from an inside pose: what lies after the start — and exactly the contacts in progress there`, { timeout: 600_000 }, () => {
      const { model, stock } = loadShippedModel(c, FILES);
      const rand = rng(c.seed ?? 20261007 + c.name.length);
      // Each track with the range starts it is checked from: the base
      // track's middle point, the point split into a contact, the inside pose.
      const base = randomTrack(c, rand, 3, 0.25);
      const tracks: Array<{ track: CollisionTrack; where: string; from: number[] }> = [
        { track: base, where: `${c.name} track`, from: [Math.floor(base.count / 2)] }];
      // a body wholly inside another at the range start
      if (c.inside && insideAt(model, c, c.inside)) {
        const L = ["X", "Y", "Z", "A", "B", "C"];
        const near = (p: number[], f: number) => p.map((v, j) => { const b = c.box[L[j]!]; return b ? v + f * (b[1] - b[0]) : v; });
        tracks.push({ track: trackOf(c, [near(c.inside, 0.05), c.inside, near(c.inside, -0.005)], rand), where: `${c.name} inside track`, from: [1] });
      }
      // A point inside a contact as a vertex of its own (the segment split
      // there — the same path): a range can start there.
      const fullOf = new Map<CollisionTrack, ReturnType<typeof sweepCollisions>>();
      const fullSweep = (t: CollisionTrack) => {
        let f = fullOf.get(t);
        if (!f) fullOf.set(t, f = sweepCollisions(model, t, WCS0, { margin: MARGIN }));
        return f;
      };
      for (const t of tracks.slice()) {
        const f = fullSweep(t.track);
        const iv = f.hits.flatMap(x => x.intervals ?? []).find(([a, b]) => b - a > 1);
        if (iv) {
          const sp = splitAt(t.track, (iv[0] + iv[1]) / 2);
          tracks.push({ track: sp.track, where: `${t.where} split in a contact`, from: [sp.at] });
        }
      }
      let boundaries = 0, checked = 0;
      for (const { track, where, from } of tracks) {
        const full = fullSweep(track);
        const { poseAt, below, runWide, WIDE } = trackTruth(model, c, track);
        const staticPairs = new Set(full.staticContacts.map(sc => [sc.a, sc.b].sort().join("/")));
        const ids = (pi: number) => [model.bodies[model.pairs[pi]![0]]!.id, model.bodies[model.pairs[pi]![1]]!.id].sort().join("/");
        const isCutting = (pi: number) => {
          const [a, b] = model.pairs[pi]!.map(i => model.bodies[i]!.id) as [string, string];
          return (a === "tool" && stock.has(b)) || (b === "tool" && stock.has(a));
        };
        const insideEither = (pi: number) => {
          const A = model.bodies[model.pairs[pi]![0]]!, B = model.bodies[model.pairs[pi]![1]]!;
          return insideTruth(A, B) === true || insideTruth(B, A) === true;
        };
        // the pair's answer per RELATIVE pose (the oracle's own cache: the same
        // meshes in the same relative pose are the same distance)
        const lastRel = model.pairs.map(() => new Float64Array(16).fill(NaN));
        const lastAns: Array<number | null> = model.pairs.map(() => null);
        const lastIn: Array<boolean> = model.pairs.map(() => false);
        const relNow = new THREE.Matrix4();
        const cached = (pi: number): { d: number | null; inside: boolean } => {
          const A = model.bodies[model.pairs[pi]![0]]!, B = model.bodies[model.pairs[pi]![1]]!;
          relNow.copy(A.world).invert().multiply(B.world);
          const e = relNow.elements, prev = lastRel[pi]!;
          let same = true;
          for (let k = 0; k < 16 && same; k++) same = Math.abs(e[k]! - prev[k]!) <= 1e-9;
          if (!same) {
            prev.set(e);
            lastAns[pi] = below(A, B, MARGIN);
            lastIn[pi] = lastAns[pi] === null || lastAns[pi]! > CONTACT ? insideEither(pi) : false;
          }
          return { d: lastAns[pi]!, inside: lastIn[pi]! };
        };
        for (const h of from) {
          const hCum = track.cum[h]!;
          const r = sweepCollisions(model, track, WCS0, { margin: MARGIN, range: { from: h } });
          const w = `${where} from ${h}`;
          checked++;
          expect(r.truncated, `${w}: swept to the end`).toBeNull();
          expect(r.range?.fromCum, `${w}: says where it starts`).toBe(hCum);
          // (e) the program's static exclusions
          expect(r.staticContacts, `${w}: the program's static contacts`).toEqual(full.staticContacts);
          // (d) nothing before h
          for (const hit of r.hits) {
            expect(hit.cum, `${w} L${hit.line}: no record before the start`).toBeGreaterThanOrEqual(hCum - TOL);
            for (const [a] of hit.intervals ?? []) expect(a, `${w} L${hit.line}: no interval before the start`).toBeGreaterThanOrEqual(hCum - TOL);
          }
          // (c) the boundary contacts: the pose at h as the range's first
          // segment labels it (a hair past h on the next segment)
          poseAt(hCum + 1e-9);
          const expected = new Set<string>(), unsure = new Set<string>();
          for (let pi = 0; pi < model.pairs.length; pi++) {
            if (staticPairs.has(ids(pi))) continue;
            const A = model.bodies[model.pairs[pi]![0]]!, B = model.bodies[model.pairs[pi]![1]]!;
            const d = below(A, B, MARGIN + 1e-3);
            if (d !== null && Math.abs(d - MARGIN) <= 1e-3) { unsure.add(ids(pi)); continue; }   // at the margin: either way
            if ((d !== null && d <= MARGIN) || insideEither(pi)) expected.add(ids(pi));
          }
          const got = new Set((r.boundaryContacts ?? []).map(b => [b.a, b.b].sort().join("/")));
          for (const k of unsure) { expected.delete(k); got.delete(k); }
          expect([...got].sort(), `${w}: the boundary contacts are the pairs inside the margin at the start`).toEqual([...expected].sort());
          for (const b of r.boundaryContacts ?? []) {
            const pi = model.pairs.findIndex((_, i) => ids(i) === [b.a, b.b].sort().join("/"));
            expect(b.cutting, `${w} ${b.a}/${b.b}: cutting as the model says`).toBe(isCutting(pi));
          }
          boundaries += got.size;
          // (a) every touch and in-margin pose after h reported
          const byPair = new Map<string, CollisionHit[]>();
          for (const hit of r.hits) { const k = [hit.a, hit.b].sort().join("/"); byPair.set(k, [...(byPair.get(k) ?? []), hit]); }
          const boundaryPairs = new Set((r.boundaryContacts ?? []).map(b => [b.a, b.b].sort().join("/")));
          const inInterval = (recs: CollisionHit[], s: number) => recs.some(hit =>
            (hit.intervals ?? []).some(([a, b]) => s >= a - TOL && s <= b + TOL)
            || (hit.spanCumEnd !== undefined && s >= hit.cum - TOL && s <= hit.spanCumEnd + TOL));
          const end = track.cum[track.count - 1]!;
          for (let s = hCum + STEP / 2; s < end; s += STEP) {
            const seg = poseAt(s), line = track.lines[seg]!;
            for (let pi = 0; pi < model.pairs.length; pi++) {
              const k = ids(pi);
              if (staticPairs.has(k) || isCutting(pi)) continue;   // cutting: its own tests
              const { d, inside } = cached(pi);
              if (d === null && !inside) continue;
              const recs = byPair.get(k) ?? [];
              const what = `${w} s ${s.toFixed(2)} (L${line}) ${k} true ${inside ? "inside" : d!.toFixed(4)}`;
              if (inside || d! <= CONTACT) {
                if (!inInterval(recs, s) && runWide(pi, s, CONTACT * 10, true))
                  expect.fail(`${what}: a touch wider than ${WIDE} after the start outside every interval — ${JSON.stringify(recs.map(x => [x.line, x.boundary ?? false, x.intervals]))}`);
              } else if (!recs.some(x => x.line === line) && !inInterval(recs, s) && runWide(pi, s, MARGIN)) {
                expect.fail(`${what}: inside the margin wider than ${WIDE} after the start with no record on its line${boundaryPairs.has(k) ? " (a boundary pair)" : ""}`);
              }
              if (!inInterval(recs, s)) { lastRel[pi]!.fill(NaN); poseAt(s); }   // runWide re-posed the model
            }
          }
          // (b) every reported interval begins with a real touch (or inside)
          for (const hit of r.hits) {
            const pi = model.pairs.findIndex((_, i) => ids(i) === [hit.a, hit.b].sort().join("/"));
            const A = model.bodies[model.pairs[pi]![0]]!, B = model.bodies[model.pairs[pi]![1]]!;
            for (const [a] of hit.intervals ?? []) {
              poseAt(a + (a <= hCum + 1e-9 ? 1e-9 : 0));
              const d = below(A, B, MARGIN);
              const real = (d !== null && d <= 1e-3) || insideEither(pi);
              expect(real, `${w} L${hit.line} ${hit.a}/${hit.b}: touches or lies inside where its interval begins (${a.toFixed(3)}, distance ${d})`).toBe(true);
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(0);
      // the gate's seeds reach contact: some range starts inside one
      expect(boundaries, `${c.name}: boundary contacts met`).toBeGreaterThan(0);
    });
  }
});
