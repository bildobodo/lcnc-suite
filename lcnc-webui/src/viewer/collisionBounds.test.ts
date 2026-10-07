// Every clearance the sweep rests on is a LOWER bound on the true distance
// (2026-10-06: three-mesh-bvh's bounded closest-point query answered 291 mm
// at a true 82 and the sweep stepped 230 mm past a crash — the operator's
// haus.ngc on the XYZAC sim). Each estimator — the bounding-sphere gap, the
// component-box bound and pairDistance at the sweep's two thresholds — is
// held to the true distance over random poses of every SHIPPED machine
// model, at and well past its travel, for every pair the sweep checks; and
// contact is never hidden: a pair within the margin is answered exactly.
//
// The sphere and the component boxes are bounds BY CONSTRUCTION when each
// body's sphere holds every vertex and each triangle lies in one of its
// body's boxes — checked per body, so they hold at every pose. What a pose
// can get wrong is the query: "is any triangle pair closer than e?" is the
// soundness question itself, and the library's bounded query answers it —
// it visits every bound nearer than e, so a result below e is the true
// minimum, and null or a result at or above e proves no pair is closer. The
// checks ask it at the sweep's own scale (≤ HORIZON): the unbounded query,
// the obvious truth, took 278 s for one pair on the 1.1 M-triangle 3-axis
// table, and a 60 mm one minutes per pose. That answer rests on the
// library's pruning, so small pairs are also held to a BRUTE-FORCE minimum
// over every triangle pair (triDistance.ts — written apart from the library).
// It found the pruning wrong: the library's box-to-box distance came out too
// large and a query below 121 mm missed a pair 120 mm apart (bvhBoxDistance.ts).
import * as fs from "node:fs";
import * as path from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  boxLowerBound, buildCollisionModel, pairDistance, partCollides, partCollisionFile, poseModel,
  type BuiltBody, type CollisionBody, type CollisionMachine,
} from "./collision";
import { triangleDistance } from "./triDistance";

const ROOT = path.resolve(__dirname, "../../..");
const MARGIN = 2, HORIZON = 20, EPS = 1e-3;
const NEAR = 60;            // pairs farther by their spheres rest on the sphere bound alone (checked per body)
const BRUTE_MAX = 40_000;   // triangle pairs a brute-force minimum may cost
const BRUTE_PER_MODEL = 60; // brute-force checks per model
// COLLISION_HUNT=deep: four times the poses, no budget (collisionOracle.test.ts).
const DEEP = process.env.COLLISION_HUNT === "deep";
const BUDGET_MS = DEEP ? Infinity : 240_000;  // per model: a slow run fails, it never hangs a gate (the unit stage runs files side by side)

function parseBinSTL(buf: Buffer): Float32Array {
  const n = buf.readUInt32LE(80);
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const off = 84 + i * 50 + 12;
    for (let v = 0; v < 9; v++) out[i * 9 + v] = buf.readFloatLE(off + v * 4);
  }
  return out;
}
// Deterministic: a failure names its seed and pose.
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function triangles(body: BuiltBody, m: THREE.Matrix4): THREE.Vector3[][] {
  const pos = body.geom.attributes.position!, idx = body.geom.index;
  const n = idx ? idx.count : pos.count, out: THREE.Vector3[][] = [];
  for (let i = 0; i < n; i += 3) {
    const t: THREE.Vector3[] = [];
    for (let k = 0; k < 3; k++) { const vi = idx ? idx.getX(i + k) : i + k; t.push(new THREE.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(m)); }
    out.push(t);
  }
  return out;
}
const triCount = (b: BuiltBody) => ((b.geom.index ? b.geom.index.count : b.geom.attributes.position!.count) / 3) | 0;

// Each shipped model with its joint ranges: the example INI's travel and
// past it (a program can drive a joint beyond its window — haus.ngc reached
// Y −477 on a −200 window), rotaries over their whole range.
// `brute`: a model whose bodies are all too large for the brute force (the
// 3-axis model: 22 844 to 1.1 M triangles) relies on the others for it.
const MODELS: Array<{ name: string; dir: string; poses: number; brute?: false; ranges: Array<[number, number]> }> = [
  { name: "3 axis", dir: "lcnc-gateway/machine", poses: 60, brute: false, ranges: [[-100, 800], [-100, 800], [-300, 50]] },
  { name: "XYZAC", dir: "examples/sim_config/machine-5axis-xyzac", poses: 30, ranges: [[-350, 350], [-550, 300], [-500, 50], [-120, 120], [-180, 180]] },
  { name: "TWP gantry", dir: "examples/sim_config/machine-xyzacb-gantry", poses: 30, ranges: [[-1700, 1700], [-1500, 1500], [-1500, 50], [-180, 180], [-185, 185], [-320, 320]] },
];

describe("the sweep's clearance estimates are lower bounds", () => {
  for (const M of MODELS) {
    it(`${M.name}: every estimator ≤ the true distance, contact never hidden`, { timeout: DEEP ? 86_400_000 : 2 * BUDGET_MS }, () => {
      const t0 = performance.now();
      const dir = path.join(ROOT, M.dir);
      const mj = JSON.parse(fs.readFileSync(path.join(dir, "machine.json"), "utf8"));
      const machine: CollisionMachine = {
        groups: mj.groups, kinematics: mj.kinematics, workGroup: mj.workGroup, toolGroup: mj.toolGroup,
        unitScale: 1, axes: "XYZABC".slice(0, M.ranges.length).split(""),
      };
      const defs: CollisionBody[] = mj.parts.filter(partCollides).map((p: any) => ({
        id: p.id, group: p.group ?? "root",
        positions: parseBinSTL(fs.readFileSync(path.join(dir, partCollisionFile(p)))),
        translate: p.translate, rotate: p.rotate,
      }));
      const model = buildCollisionModel(machine, defs);
      // The sphere bound holds at every pose iff each body's sphere holds its mesh.
      for (const b of model.bodies) {
        const pos = b.geom.attributes.position!.array as Float32Array;
        let far = 0;
        for (let i = 0; i < pos.length; i += 3) far = Math.max(far, Math.hypot(pos[i]! - b.center.x, pos[i + 1]! - b.center.y, pos[i + 2]! - b.center.z));
        expect(far, `${b.id}: its bounding sphere holds every vertex`).toBeLessThanOrEqual(b.radius + EPS);
        const c = b.comps, idx = b.geom.index, n = idx ? idx.count : pos.length / 3;
        expect(c.length, `${b.id}: has component boxes`).toBeGreaterThan(0);
        let outside = 0;
        for (let t = 0; t < n; t += 3) {
          const v = [0, 1, 2].map(k => (idx ? idx.getX(t + k) : t + k) * 3);
          let inOne = false;
          for (let j = 0; j < c.length && !inOne; j += 6) {
            inOne = v.every(o => pos[o]! >= c[j]! - EPS && pos[o]! <= c[j + 3]! + EPS
              && pos[o + 1]! >= c[j + 1]! - EPS && pos[o + 1]! <= c[j + 4]! + EPS
              && pos[o + 2]! >= c[j + 2]! - EPS && pos[o + 2]! <= c[j + 5]! + EPS);
          }
          if (!inOne) outside++;
        }
        expect(outside, `${b.id}: every triangle lies in one of its component boxes`).toBe(0);
      }
      const rand = rng(20261006);
      const inv = new THREE.Matrix4(), rel = new THREE.Matrix4(), ident = new THREE.Matrix4();
      const t1 = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 }, t2 = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 };
      // The true distance when it is below e, else null (see the head).
      let O!: BuiltBody, I!: BuiltBody;
      const closerThan = (e: number): number | null => {
        if (!(e > 0)) return null;
        const r = O.bvh.closestPointToGeometry(I.geom, rel, t1, t2, 0, e);
        return r && t1.distance < e ? t1.distance : null;
      };
      let checked = 0, contacts = 0, behindBox = 0, brute = 0;
      for (let pose = 0; pose < M.poses * (DEEP ? 4 : 1); pose++) {
        const jv = M.ranges.map(([lo, hi]) => lo + rand() * (hi - lo));
        poseModel(model, jv);
        for (const [ai, bi] of model.pairs) {
          const A = model.bodies[ai]!, B = model.bodies[bi]!;
          const sphereGap = A.worldCenter.distanceTo(B.worldCenter) - A.radius - B.radius;
          if (sphereGap > NEAR) continue;
          O = A.extent >= B.extent ? A : B; I = O === A ? B : A;
          inv.copy(O.world).invert(); rel.multiplyMatrices(inv, I.world);
          const where = `${M.name} pose ${pose} [${jv.map(v => v.toFixed(2)).join(", ")}] ${A.id}/${B.id}`;
          const lb = boxLowerBound(O, I, rel);
          const hit = (e: number, what: string) => {
            const t = closerThan(e - EPS);
            expect(t, `${where} — ${what} ${e.toFixed(3)} above the true ${t?.toFixed(3)}`).toBeNull();
          };
          // At the sweep's scale the pose itself is checked too (rel, the
          // box transform); past it the per-body checks above carry them.
          if (sphereGap <= HORIZON) hit(sphereGap, "sphere gap");
          if (lb <= HORIZON) hit(lb, "component boxes");
          const inMargin = closerThan(MARGIN);
          for (const maxT of [MARGIN, HORIZON]) {
            const d = pairDistance(A, B, maxT, MARGIN);
            if (d === Infinity) hit(maxT, `pairDistance(${maxT}) says beyond`);
            else if (d <= HORIZON) hit(d, `pairDistance(${maxT})`);
            // Past the sweep's scale pairDistance answers with one of the
            // bounds the per-body checks carry.
            else expect(Math.min(Math.abs(d - sphereGap), Math.abs(d - lb)), `${where} — pairDistance(${maxT}) ${d} is the sphere gap or the box bound`).toBeLessThan(1e-9);
            if (inMargin !== null) expect(Math.abs(d - inMargin), `${where} — within the margin, pairDistance(${maxT}) ${d} answers the true ${inMargin}`).toBeLessThanOrEqual(EPS);
          }
          // The library against an independent minimum, where one is affordable.
          if (brute < BRUTE_PER_MODEL && triCount(O) * triCount(I) <= BRUTE_MAX) {
            const ta = triangles(O, ident), tb = triangles(I, rel);
            let bf = Infinity;
            for (const x of ta) for (const y of tb) { bf = Math.min(bf, triangleDistance(x, y)); if (bf === 0) break; }
            expect(sphereGap, `${where} — sphere gap vs brute force ${bf}`).toBeLessThanOrEqual(bf + EPS);
            expect(lb, `${where} — component boxes vs brute force ${bf}`).toBeLessThanOrEqual(bf + EPS);
            for (const e of [MARGIN, HORIZON, bf + 1]) {
              const t = closerThan(e);
              if (bf < e - EPS) expect(t === null ? Infinity : Math.abs(t - bf), `${where} — the library below ${e} vs brute force ${bf}`).toBeLessThanOrEqual(EPS);
              else if (bf > e + EPS) expect(t, `${where} — the library finds ${t} below ${e}, brute force ${bf}`).toBeNull();
            }
            brute++;
          }
          checked++;
          if (inMargin !== null) contacts++;
          if (lb <= MARGIN && closerThan(HORIZON) === null) behindBox++;
        }
        expect(performance.now() - t0, `${M.name}: inside its budget at pose ${pose}`).toBeLessThan(BUDGET_MS);
      }
      // The sample reached the cases that matter: contact, the far mesh
      // behind a box overlap (the class of the 2026-10-06 bug), and pairs
      // small enough for the brute force.
      expect(checked, `${M.name}: pairs checked`).toBeGreaterThan(100);
      expect(contacts, `${M.name}: pairs within the margin`).toBeGreaterThan(5);
      expect(behindBox, `${M.name}: far meshes behind a box overlap`).toBeGreaterThanOrEqual(3);
      if (M.brute !== false) expect(brute, `${M.name}: brute-force checks`).toBeGreaterThan(5);
      console.log(`${M.name}: ${checked} pairs, ${contacts} in the margin, ${behindBox} behind a box overlap, ${brute} brute force, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    });
  }
});
