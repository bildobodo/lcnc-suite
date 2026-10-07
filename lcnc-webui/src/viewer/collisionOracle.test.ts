// The sweep against a brute-force oracle (the soundness hunt after the
// horizon bug, operator 2026-10-06: "kann es sein, dass sich noch weitere
// ähnliche Fehler eingeschlichen haben?"). The oracle poses the shipped
// machine models along random tracks every STEP of the sweep's own distance
// parameter (1° ≙ 1 mm) and asks each pair exactly whether it is inside the
// margin — and whether it touches. Then:
//  · every touch the oracle finds lies in a contact interval of its pair,
//    and every in-margin pose has a record of its pair on its line — unless
//    the run around it is no wider than the sweep's guarantee (MIN_ADV);
//  · every reported onset is a real touch, every near miss a real distance.
// What the oracle shares with the sweep is the pose (the kinematics mirror
// and the group-tree compose, each pinned by its own tests) and the
// estimators collisionBounds.test.ts proves; the stepping, the certificates,
// the in-margin cadence, the records and their refinement are what it
// checks. A body wholly inside another reads as clear to both (surface
// distance) — the inside check is its own step of the plan.
import * as fs from "node:fs";
import * as path from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  boxLowerBound, buildCollisionModel, partCollides, partCollisionFile, poseModel, sweepCollisions, toolCylinderPositions,
  type BuiltBody, type CollisionBody, type CollisionHit, type CollisionMachine, type CollisionModel, type CollisionTrack,
} from "./collision";
import { kinsForSegment, type KinsSpec } from "./kins";

const ROOT = path.resolve(__dirname, "../../..");
const MARGIN = 2, CONTACT = 1e-4, MIN_ADV = 0.25;
const STEP = 0.5;           // the oracle's stride along the sweep's distance parameter
const TOL = 0.01;           // interval boundaries are bisected to 1e-3
// COLLISION_HUNT=deep runs the hunt: every case's tracks at full length,
// hours on this VM, and requires each case to reach touches and near poses.
// The default is the gate's share: one short track per case — the bugs the
// hunt found have their own unit tests; this keeps the walk itself honest.
const DEEP = process.env.COLLISION_HUNT === "deep";
// Per case: a slow run fails by name, never hangs; COLLISION_HUNT_BUDGET=0
// lifts it (a seed that ran out of time in the gate's search).
const BUDGET_MS = process.env.COLLISION_HUNT_BUDGET === "0" || DEEP ? Infinity : 60_000;
const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 } as any;

function parseBinSTL(buf: Buffer): Float32Array {
  const n = buf.readUInt32LE(80);
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const off = 84 + i * 50 + 12;
    for (let v = 0; v < 9; v++) out[i * 9 + v] = buf.readFloatLE(off + v * 4);
  }
  return out;
}
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// The setp lines of a shipped INI: the kins constants the sim runs with.
function iniSetp(ini: string, comp: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of fs.readFileSync(path.join(ROOT, ini), "utf8").matchAll(new RegExp(`setp\\s+${comp}\\.([\\w-]+)\\s+(-?[\\d.]+)`, "g"))) out[m[1]!] = Number(m[2]);
  return out;
}

interface Case {
  name: string; dir: string; axes: string[]; kins?: KinsSpec;
  /** Raw switchkins type for the whole track; undefined = no mode channel. */
  mode?: number;
  /** Program-coordinate box the waypoints stay in, per letter X Y Z A B C. */
  box: Record<string, [number, number]>;
  /** Tracks × segments in a hunt (deep); the gate runs 1 × 3, shorter. */
  tracks: number; segments: number;
  /** The gate's seed: one whose short track reaches contact (searched with
   *  COLLISION_HUNT_SEED; a hunt runs the case's own). */
  seed?: number;
}
const xyzac = iniSetp("examples/sim_config/lcnc_suite_sim_5axis_xyzac.ini", "xyzac-trt-kins");
const trsrn = iniSetp("examples/sim_config/lcnc_suite_sim_6axis_twp_xyzabc.ini", "xyzacb_trsrn_kins");
const XYZAC_KINS: KinsSpec = { type: "xyzac-trt", identityFirst: true, params: {
  xRotPoint: xyzac["x-rot-point"], yRotPoint: xyzac["y-rot-point"], zRotPoint: xyzac["z-rot-point"],
  xOffset: xyzac["x-offset"], yOffset: xyzac["y-offset"], zOffset: xyzac["z-offset"] } };
const TRSRN_KINS: KinsSpec = { type: "xyzacb-trsrn", identityFirst: false, trsrn: {
  yPivot: trsrn["y-pivot"]!, zPivot: trsrn["z-pivot"]!, xOffset: trsrn["x-offset"]!, yOffset: trsrn["y-offset"]!,
  yRotAxis: trsrn["y-rot-axis"]!, zRotAxis: trsrn["z-rot-axis"]!, nutAngle: trsrn["nut-angle"]! } };

const CASES: Case[] = [
  { name: "XYZAC identity", dir: "examples/sim_config/machine-5axis-xyzac", axes: ["X", "Y", "Z", "A", "C"], kins: XYZAC_KINS, mode: 0,
    box: { X: [-300, 300], Y: [-500, 250], Z: [-450, 0], A: [-110, 60], C: [-180, 180] }, tracks: 6, segments: 6 },
  { name: "XYZAC TCP", dir: "examples/sim_config/machine-5axis-xyzac", axes: ["X", "Y", "Z", "A", "C"], kins: XYZAC_KINS, mode: 1,
    box: { X: [-200, 200], Y: [-200, 200], Z: [-150, 150], A: [-100, 50], C: [-180, 180] }, tracks: 6, segments: 6, seed: 12 },
  { name: "TWP gantry TCP", dir: "examples/sim_config/machine-xyzacb-gantry", axes: ["X", "Y", "Z", "A", "B", "C"], kins: TRSRN_KINS, mode: 1,
    box: { X: [-1400, 1400], Y: [-1200, 1200], Z: [-1300, 0], A: [-180, 180], B: [-90, 90], C: [-180, 180] }, tracks: 4, segments: 5, seed: 13 },
  { name: "3 axis", dir: "lcnc-gateway/machine", axes: ["X", "Y", "Z"],
    box: { X: [-50, 750], Y: [-50, 750], Z: [-280, 30] }, tracks: 4, segments: 6, seed: 22 },
];

function loadModel(c: Case): { model: CollisionModel; stock: Set<string> } {
  const dir = path.join(ROOT, c.dir);
  const mj = JSON.parse(fs.readFileSync(path.join(dir, "machine.json"), "utf8"));
  const machine: CollisionMachine = { groups: mj.groups, kinematics: mj.kinematics, workGroup: mj.workGroup, toolGroup: mj.toolGroup,
    unitScale: 1, axes: c.axes, ...(c.kins ? { kins: c.kins } : {}) };
  const defs: CollisionBody[] = mj.parts.filter(partCollides).map((p: any) => ({
    id: p.id, group: p.group ?? "root", positions: parseBinSTL(fs.readFileSync(path.join(dir, partCollisionFile(p)))),
    translate: p.translate, rotate: p.rotate, stock: !!p.stock,
  }));
  // The live sweep always carries the cutter (the worker's parametric body).
  defs.push({ id: "tool", group: mj.toolGroup, positions: toolCylinderPositions(10, 80), tool: true });
  return { model: buildCollisionModel(machine, defs), stock: new Set(defs.filter(d => d.stock).map(d => d.id)) };
}

// A random track: rapid and feed moves, linear, rotary and both at once, in
// the case's program box. Its cum IS the sweep's distance parameter, so the
// result's cums need no conversion.
function randomTrack(c: Case, rand: () => number): CollisionTrack {
  const L = ["X", "Y", "Z", "A", "B", "C"];
  const at = (k: string, f: number) => { const b = c.box[k]; return b ? b[0] + f * (b[1] - b[0]) : 0; };
  const pts: number[][] = [L.map(k => at(k, rand()))];
  const reach = DEEP ? 0.6 : 0.25;   // a segment's move, of the box's range
  for (let s = 0; s < (DEEP ? c.segments : 3); s++) {
    const p = pts[pts.length - 1]!.slice(), kind = rand();
    for (let j = 0; j < 6; j++) {
      const k = L[j]!, b = c.box[k];
      if (!b) continue;
      const rot = j >= 3;
      if ((kind < 0.4 && rot) || (kind >= 0.4 && kind < 0.7 && !rot)) continue;   // linear only / rotary only / both
      p[j] = Math.min(b[1], Math.max(b[0], p[j]! + (rand() - 0.5) * (b[1] - b[0]) * reach));
    }
    pts.push(p);
  }
  const n = pts.length;
  const pos = new Float32Array(n * 3), abc = new Float32Array(n * 3), cum = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos.set(pts[i]!.slice(0, 3), i * 3); abc.set(pts[i]!.slice(3), i * 3); }
  for (let i = 1; i < n; i++) {
    const j = i * 3, k = j - 3;
    const lin = Math.hypot(pos[j]! - pos[k]!, pos[j + 1]! - pos[k + 1]!, pos[j + 2]! - pos[k + 2]!);
    const rot = Math.max(Math.abs(abc[j]! - abc[k]!), Math.abs(abc[j + 1]! - abc[k + 1]!), Math.abs(abc[j + 2]! - abc[k + 2]!));
    cum[i] = cum[i - 1]! + Math.max(lin, rot);
  }
  return {
    pos, abc, cum, count: n,
    lines: Uint32Array.from({ length: n }, (_, i) => 10 + i),
    rapid: Uint8Array.from({ length: n }, () => (rand() < 0.5 ? 1 : 0)),
    ...(c.mode !== undefined ? { mode: new Uint8Array(n).fill(c.mode) } : {}),
  };
}

describe("the sweep against a brute-force oracle", () => {
  for (const c of CASES) {
    it(`${c.name}: every touch and every in-margin pose the oracle finds is reported, every report is real`, { timeout: 600_000 }, () => {
      const { model, stock } = loadModel(c);
      const t0 = performance.now();
      const seed = Number(process.env.COLLISION_HUNT_SEED) || (DEEP ? 20261007 + c.name.length : c.seed ?? 20261007 + c.name.length);
      const rand = rng(seed);
      const inv = new THREE.Matrix4(), rel = new THREE.Matrix4();
      const t1 = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 }, t2 = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 };
      const world = [0, 0, 0, 0, 0, 0], joints: (number | null)[] = new Array(c.axes.length).fill(0);
      let touches = 0, nears = 0, onsets = 0, narrow = 0;
      for (let ti = 0; ti < (DEEP ? c.tracks : 1); ti++) {
        const track = randomTrack(c, rand);
        const r = sweepCollisions(model, track, WCS0, { margin: MARGIN });
        const where = `${c.name} track ${ti}`;
        expect(r.truncated, `${where}: swept whole`).toBeNull();
        expect(r.uncertified, `${where}: certified`).toBeNull();
        expect(r.hits.length, `${where}: under the record cap — the comparison is complete`).toBeLessThan(200);
        const modelFor = (i: number) => kinsForSegment(c.axes, c.kins, track.mode?.[i] ?? null, null, undefined, "oracle");
        const poseAt = (s: number): number => {
          let i = 1;
          while (i < track.count - 1 && track.cum[i]! < s) i++;
          const c0 = track.cum[i - 1]!, c1 = track.cum[i]!;
          const u = c1 > c0 ? Math.min(1, Math.max(0, (s - c0) / (c1 - c0))) : 1;
          const j = i * 3, k = j - 3;
          for (let a = 0; a < 3; a++) {
            world[a] = track.pos[k + a]! + (track.pos[j + a]! - track.pos[k + a]!) * u;
            world[a + 3] = track.abc[k + a]! + (track.abc[j + a]! - track.abc[k + a]!) * u;
          }
          modelFor(i).inverse(world, joints);
          poseModel(model, joints.map(v => v ?? 0));
          return i;
        };
        // The pair's true distance when below `e`, else null (see
        // collisionBounds.test.ts); a touch stops the search at the first
        // triangle pair under CONTACT / 2 — touching is all the oracle asks.
        const below = (A: BuiltBody, B: BuiltBody, e: number): number | null => {
          if (A.worldCenter.distanceTo(B.worldCenter) - A.radius - B.radius >= e) return null;
          const O = A.extent >= B.extent ? A : B, I = O === A ? B : A;
          inv.copy(O.world).invert(); rel.multiplyMatrices(inv, I.world);
          if (boxLowerBound(O, I, rel) >= e) return null;
          const hit = O.bvh.closestPointToGeometry(I.geom, rel, t1, t2, CONTACT / 2, e);
          return hit && t1.distance < e ? t1.distance : null;
        };
        // The main walk's question per pair, answered again only when the
        // pair's RELATIVE pose changed: the same two meshes in the same
        // relative pose are the same distance — exact, no certificate (a
        // linear move leaves most pairs' relative pose as it was).
        const lastRel = model.pairs.map(() => new Float64Array(16).fill(NaN));
        const lastAns: Array<number | null> = model.pairs.map(() => null);
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
        // Is the run around s where the pair is below `e` wider than the
        // sweep's guarantee? Walked at MIN_ADV, it stops as soon as it is:
        // a missed run of a metre would otherwise cost thousands of poses.
        const WIDE = 3 * MIN_ADV;
        const runWide = (pi: number, s: number, e: number): boolean => {
          const A = model.bodies[model.pairs[pi]![0]]!, B = model.bodies[model.pairs[pi]![1]]!;
          const inside = (x: number) => { poseAt(x); return below(A, B, e) !== null; };
          const end = track.cum[track.count - 1]!;
          let lo = s, hi = s;
          while (hi - lo <= WIDE && lo > 0 && inside(Math.max(0, lo - MIN_ADV))) lo = Math.max(0, lo - MIN_ADV);
          while (hi - lo <= WIDE && hi < end && inside(Math.min(end, hi + MIN_ADV))) hi = Math.min(end, hi + MIN_ADV);
          return hi - lo > WIDE;
        };
        const end = track.cum[track.count - 1]!;
        for (let s = STEP / 2; s < end; s += STEP) {
          if (performance.now() - t0 > BUDGET_MS) expect.fail(`${where}: over the case's budget at s ${s.toFixed(1)} of ${end.toFixed(1)}`);
          const seg = poseAt(s), line = track.lines[seg]!;
          for (let pi = 0; pi < model.pairs.length; pi++) {
            if (exempt(pi)) continue;
            const d = belowMargin(pi);
            if (d === null) continue;
            const recs = byPair.get(ids(pi)) ?? [];
            const what = `${where} s ${s.toFixed(2)} (L${line}) ${ids(pi)} true ${d.toFixed(4)}`;
            if (d <= CONTACT) {
              touches++;
              if (!inInterval(recs, s)) {
                if (runWide(pi, s, CONTACT * 10)) expect.fail(`${what}: a touch wider than ${WIDE} of path outside every contact interval — ${JSON.stringify(recs.map(h => [h.line, h.dist, h.intervals]))}`);
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
              expect(d, `${where} L${h.line} ${h.a}/${h.b}: touches at its onset ${a.toFixed(3)}`).not.toBeNull();
              expect(d!, `${where} L${h.line} ${h.a}/${h.b}: touches at its onset ${a.toFixed(3)}`).toBeLessThanOrEqual(1e-3);
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
        `${c.name} seed ${seed}: ${touches} touching, ${nears} near, ${onsets} onsets, ${narrow} narrow runs, ${((performance.now() - t0) / 1000).toFixed(0)} s\n`);
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
});
