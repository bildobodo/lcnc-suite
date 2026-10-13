// Step 4 package 2, round A7 — the speed bound itself (plan Fassung 5, 7.3
// check 3): the sweep's certificates and the free radius of a separation
// both stand on `V`, the pair's bound on its relative surface speed per unit
// of the sweep's distance parameter. The walk oracles see a wrong V only
// through a miss, and the bound's slack (×2, the MIN_ADV floor) hid a halved
// lever, a lever without the body's radius and a rotary axis taken as Z
// (the sensitivity measurement of 2026-10-12). Here V is held to the truth
// directly: inside every chunk of random tracks on generated machines, at
// interior points (not the ends — several rotaries and growing levers live in
// between), every vertex of each body moves relative to the other body no
// faster than V — measured by a difference quotient in the same parameter
// basis (mm and degrees, 1° ≙ 1; Codex R140). The bodies are boxes and
// cylinders: a convex mesh's fastest point is a vertex (speed is convex in
// the position under a rigid motion).
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildCollisionModel, sweepCollisions, type CollisionMachine, type CollisionModel } from "./collision";
import { MARGIN, boxPositions, generatedCase, randomTrack, rng, trackOf, trackTruth, type Case } from "./collisionFixtures";

const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 } as any;
const INTERIOR = [0.07, 0.21, 0.36, 0.5, 0.64, 0.79, 0.93];

/** Every vertex of `A` in `B`'s frame at the current pose. */
function relVerts(model: CollisionModel, ai: number, bi: number, out: Float64Array): void {
  const A = model.bodies[ai]!, B = model.bodies[bi]!;
  const m = new THREE.Matrix4().copy(B.world).invert().multiply(A.world);
  const p = A.geom.attributes.position!.array as Float32Array, v = new THREE.Vector3();
  for (let i = 0; i * 3 < p.length; i++) {
    v.set(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!).applyMatrix4(m);
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
  }
}

describe("the pair's speed bound holds inside every chunk (plan 7.3 check 3)", () => {
  it("V ≥ every vertex's speed relative to the other body, at interior points, on generated machines", { timeout: 600_000 }, () => {
    let checked = 0, worst = 0;
    for (let k = 0; k < 10; k++) {
      const g = generatedCase(20261012 + k);
      const rand = rng(g.c.seed! + 7);
      const track = randomTrack(g.c, rand, 4, 0.5);
      const chunks: Array<{ pi: number; s0: number; s1: number; V: number }> = [];
      sweepCollisions(g.model, track, WCS0, { margin: MARGIN, onChunkSpeed: (pi, s0, s1, V) => chunks.push({ pi, s0, s1, V }) });
      const { poseAt } = trackTruth(g.model, g.c, track);
      // by chunk: one pose pair per interior point serves every pair of the chunk
      const byChunk = new Map<string, typeof chunks>();
      for (const c of chunks) { const key = `${c.s0}|${c.s1}`; byChunk.set(key, [...(byChunk.get(key) ?? []), c]); }
      for (const list of byChunk.values()) {
        const { s0, s1 } = list[0]!;
        const L = s1 - s0;
        if (!(L > 1e-6)) continue;
        const h = Math.min(1e-3, L / 200);
        for (const f of INTERIOR) {
          const s = s0 + f * L;
          // both bodies' vertices in the other's frame, at s and s + h
          const at = (x: number) => {
            poseAt(x);
            return list.map(c => {
              const [ai, bi] = g.model.pairs[c.pi]!;
              const a = new Float64Array(g.model.bodies[ai]!.geom.attributes.position!.count * 3);
              const b = new Float64Array(g.model.bodies[bi]!.geom.attributes.position!.count * 3);
              relVerts(g.model, ai, bi, a);
              relVerts(g.model, bi, ai, b);
              return [a, b] as const;
            });
          };
          const p0 = at(s), p1 = at(s + h);
          list.forEach((c, i) => {
            let speed = 0;
            for (const side of [0, 1] as const) {
              const u = p0[i]![side], w = p1[i]![side];
              for (let q = 0; q < u.length; q += 3) {
                speed = Math.max(speed, Math.hypot(w[q]! - u[q]!, w[q + 1]! - u[q + 1]!, w[q + 2]! - u[q + 2]!) / h);
              }
            }
            const ids = `${g.model.bodies[g.model.pairs[c.pi]![0]]!.id}/${g.model.bodies[g.model.pairs[c.pi]![1]]!.id}`;
            expect(speed, `${g.c.name} ${ids} at ${s.toFixed(4)} in [${s0.toFixed(3)}, ${s1.toFixed(3)}]: V ${c.V.toFixed(4)}`).toBeLessThanOrEqual(c.V * (1 + 1e-6) + 1e-6);
            if (c.V > 0) worst = Math.max(worst, speed / c.V);
            checked++;
          });
        }
      }
    }
    expect(checked, "chunk-pair-points checked").toBeGreaterThan(1000);
    // the bound is conservative but not absurdly so: the fastest point reaches a sizable share of it
    expect(worst, "the tightest ratio speed / V").toBeGreaterThan(0.1);
  });
  it("a rotary axis that is not Z: bodies far out ON the Z axis turn about X — their lever about Z is nearly nothing", () => {
    // the random machines rarely put both bodies where the axes' levers part
    // ways; here a rotary axis taken as Z (a lever about the wrong line) gives
    // V of the bodies' radii while they sweep 300 mm out
    const machine: CollisionMachine = { groups: [{ id: "frame", parent: "root" }, { id: "a", parent: "frame" }],
      kinematics: [{ group: "a", joint: 3, type: "rotate", direction: "x", sign: 1 }],
      workGroup: "frame", toolGroup: "a", unitScale: 1, axes: ["X", "Y", "Z", "A"] };
    const model = buildCollisionModel(machine, [
      { id: "arm", group: "a", positions: boxPositions(10, 10, 10, 0, 0, 300) },
      // near where the arm ends its 30° swing (0, −150, 260): the pair is in reach, so it is swept
      { id: "post", group: "frame", positions: boxPositions(10, 10, 10, 0, -165, 262) }]);
    const c: Case = { name: "A about X", dir: "", axes: ["X", "Y", "Z", "A"], box: { A: [0, 30] }, tracks: 1, segments: 1 };
    const track = trackOf(c, [[0, 0, 0, 0, 0, 0], [0, 0, 0, 30, 0, 0]], () => 0.9);
    const chunks: Array<{ s0: number; s1: number; V: number }> = [];
    sweepCollisions(model, track, WCS0, { margin: MARGIN, onChunkSpeed: (_pi, s0, s1, V) => chunks.push({ s0, s1, V }) });
    const { poseAt } = trackTruth(model, c, track);
    const a = new Float64Array(model.bodies[0]!.geom.attributes.position!.count * 3), b = a.slice();
    expect(chunks.length).toBeGreaterThan(0);
    for (const ch of chunks) {
      const s = (ch.s0 + ch.s1) / 2, h = 1e-3;
      poseAt(s); relVerts(model, 0, 1, a);
      poseAt(s + h); relVerts(model, 0, 1, b);
      let speed = 0;
      for (let q = 0; q < a.length; q += 3) speed = Math.max(speed, Math.hypot(b[q]! - a[q]!, b[q + 1]! - a[q + 1]!, b[q + 2]! - a[q + 2]!) / h);
      expect(speed, "about 300 mm × π/180 per degree").toBeGreaterThan(5);
      expect(speed, `V ${ch.V.toFixed(3)}`).toBeLessThanOrEqual(ch.V * (1 + 1e-6) + 1e-6);
    }
  });
});
