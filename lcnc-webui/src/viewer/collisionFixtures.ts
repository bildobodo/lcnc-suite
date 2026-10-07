// The shipped machine models as collision fixtures — the cases, the model
// loader and the random tracks the oracle (collisionOracle.test.ts) and the
// shard comparison (sweepShards.test.ts) share. File access comes in from the
// test (`FixtureFiles`), so this module stays free of node imports: the app
// project type-checks it and only node-side TESTS may hide from it
// (tsconfigCoverage.test.ts).
import * as THREE from "three";
import {
  boxLowerBound, buildCollisionModel, partCollides, partCollisionFile, poseModel, toolCylinderPositions,
  type BuiltBody, type CollisionBody, type CollisionMachine, type CollisionModel, type CollisionTrack,
} from "./collision";
import { kinsForSegment, type KinsSpec } from "./kins";

/** The sweep's constants the truth is held to (collision.ts: margin 2 by
 *  the callers, CONTACT_EPS, MIN_ADV). */
export const MARGIN = 2, CONTACT = 1e-4, MIN_ADV = 0.25;

/** Repo-relative file reads, supplied by the node-side test. */
export interface FixtureFiles {
  text(rel: string): string;
  bytes(rel: string): Uint8Array;
}

export function parseBinSTL(buf: Uint8Array): Float32Array {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = view.getUint32(80, true);
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const off = 84 + i * 50 + 12;
    for (let v = 0; v < 9; v++) out[i * 9 + v] = view.getFloat32(off + v * 4, true);
  }
  return out;
}

/** Deterministic: a failure names its seed. */
export function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// The setp lines of a shipped INI: the kins constants the sim runs with.
function iniSetp(files: FixtureFiles, ini: string, comp: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of files.text(ini).matchAll(new RegExp(`setp\\s+${comp}\\.([\\w-]+)\\s+(-?[\\d.]+)`, "g"))) out[m[1]!] = Number(m[2]);
  return out;
}

export interface Case {
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

export function shippedCases(files: FixtureFiles): Case[] {
  const xyzac = iniSetp(files, "examples/sim_config/lcnc_suite_sim_5axis_xyzac.ini", "xyzac-trt-kins");
  const trsrn = iniSetp(files, "examples/sim_config/lcnc_suite_sim_6axis_twp_xyzabc.ini", "xyzacb_trsrn_kins");
  const XYZAC_KINS: KinsSpec = { type: "xyzac-trt", identityFirst: true, params: {
    xRotPoint: xyzac["x-rot-point"], yRotPoint: xyzac["y-rot-point"], zRotPoint: xyzac["z-rot-point"],
    xOffset: xyzac["x-offset"], yOffset: xyzac["y-offset"], zOffset: xyzac["z-offset"] } };
  const TRSRN_KINS: KinsSpec = { type: "xyzacb-trsrn", identityFirst: false, trsrn: {
    yPivot: trsrn["y-pivot"]!, zPivot: trsrn["z-pivot"]!, xOffset: trsrn["x-offset"]!, yOffset: trsrn["y-offset"]!,
    yRotAxis: trsrn["y-rot-axis"]!, zRotAxis: trsrn["z-rot-axis"]!, nutAngle: trsrn["nut-angle"]! } };
  return [
    { name: "XYZAC identity", dir: "examples/sim_config/machine-5axis-xyzac", axes: ["X", "Y", "Z", "A", "C"], kins: XYZAC_KINS, mode: 0,
      box: { X: [-300, 300], Y: [-500, 250], Z: [-450, 0], A: [-110, 60], C: [-180, 180] }, tracks: 6, segments: 6 },
    { name: "XYZAC TCP", dir: "examples/sim_config/machine-5axis-xyzac", axes: ["X", "Y", "Z", "A", "C"], kins: XYZAC_KINS, mode: 1,
      box: { X: [-200, 200], Y: [-200, 200], Z: [-150, 150], A: [-100, 50], C: [-180, 180] }, tracks: 6, segments: 6, seed: 12 },
    { name: "TWP gantry TCP", dir: "examples/sim_config/machine-xyzacb-gantry", axes: ["X", "Y", "Z", "A", "B", "C"], kins: TRSRN_KINS, mode: 1,
      box: { X: [-1400, 1400], Y: [-1200, 1200], Z: [-1300, 0], A: [-180, 180], B: [-90, 90], C: [-180, 180] }, tracks: 4, segments: 5, seed: 13 },
    { name: "3 axis", dir: "lcnc-gateway/machine", axes: ["X", "Y", "Z"],
      box: { X: [-50, 750], Y: [-50, 750], Z: [-280, 30] }, tracks: 4, segments: 6, seed: 22 },
  ];
}

/** The case's model as the live sweep sees it: every colliding part (its
 *  collision proxy where it has one) and the cutter, a 10 × 80 cylinder. */
export function loadShippedModel(c: Case, files: FixtureFiles): { model: CollisionModel; stock: Set<string> } {
  const mj = JSON.parse(files.text(`${c.dir}/machine.json`));
  const machine: CollisionMachine = { groups: mj.groups, kinematics: mj.kinematics, workGroup: mj.workGroup, toolGroup: mj.toolGroup,
    unitScale: 1, axes: c.axes, ...(c.kins ? { kins: c.kins } : {}) };
  const defs: CollisionBody[] = mj.parts.filter(partCollides).map((p: any) => ({
    id: p.id, group: p.group ?? "root", positions: parseBinSTL(files.bytes(`${c.dir}/${partCollisionFile(p)}`)),
    translate: p.translate, rotate: p.rotate, stock: !!p.stock,
  }));
  // The live sweep always carries the cutter (the worker's parametric body).
  defs.push({ id: "tool", group: mj.toolGroup, positions: toolCylinderPositions(10, 80), tool: true });
  return { model: buildCollisionModel(machine, defs), stock: new Set(defs.filter(d => d.stock).map(d => d.id)) };
}

/** A random track: rapid and feed moves, linear, rotary and both at once, in
 *  the case's program box; each segment moves up to `reach` of the box's
 *  range. Its cum IS the sweep's distance parameter, so a result's cums need
 *  no conversion. */
export function randomTrack(c: Case, rand: () => number, segments: number, reach: number): CollisionTrack {
  const L = ["X", "Y", "Z", "A", "B", "C"];
  const at = (k: string, f: number) => { const b = c.box[k]; return b ? b[0] + f * (b[1] - b[0]) : 0; };
  const pts: number[][] = [L.map(k => at(k, rand()))];
  for (let s = 0; s < segments; s++) {
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

/** The truth along a track, apart from the sweep's stepping: the model posed
 *  at any point of the track the sweep's way (the segment's kins, program
 *  coords = machine coords — WCS and tool offset zero), a pair's exact
 *  distance below a threshold, and whether the run around a point is wider
 *  than the sweep's guarantee. Shared with the sweep: the pose and the
 *  library's bounded query (Codex R86 — a search tool, not a proof). */
export function trackTruth(model: CollisionModel, c: Case, track: CollisionTrack) {
  const inv = new THREE.Matrix4(), rel = new THREE.Matrix4();
  const t1 = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 }, t2 = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 };
  const world = [0, 0, 0, 0, 0, 0], joints: (number | null)[] = new Array(c.axes.length).fill(0);
  const modelFor = (i: number) => kinsForSegment(c.axes, c.kins, track.mode?.[i] ?? null, null, undefined, "oracle");
  /** Pose at the track parameter s; returns the segment (the vertex it ends at). */
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
  // Is the run around s where the pair is below `e` wider than the
  // sweep's guarantee? Each end is walked out at MIN_ADV — stopping as
  // soon as the run is wider than WIDE (a missed run of a metre would
  // otherwise cost thousands of poses) — then bisected to 1e-3, so a test
  // holds the sweep to MIN_ADV itself, not to a grid's slack
  // (Codex R86: 0.75 let a 1.25-wide miss of the same kind look narrow).
  const WIDE = MIN_ADV + 1e-3;
  const runWide = (pi: number, s: number, e: number): boolean => {
    const A = model.bodies[model.pairs[pi]![0]]!, B = model.bodies[model.pairs[pi]![1]]!;
    const inside = (x: number) => { poseAt(x); return below(A, B, e) !== null; };
    const end = track.cum[track.count - 1]!;
    const edge = (dir: 1 | -1): number => {
      let x = s;
      for (;;) {
        const y = dir > 0 ? Math.min(end, x + MIN_ADV) : Math.max(0, x - MIN_ADV);
        if (y === x) return x;                  // the track's end: the run reaches it
        if (Math.abs(y - s) > WIDE + MIN_ADV) return y;   // wide already
        if (!inside(y)) {                       // bracketed: bisect between x (in) and y (out)
          let a = x, b = y;
          while (Math.abs(b - a) > 1e-3) { const m = (a + b) / 2; if (inside(m)) a = m; else b = m; }
          return a;
        }
        x = y;
      }
    };
    return edge(1) - edge(-1) > WIDE;
  };
  return { poseAt, below, runWide, WIDE };
}
