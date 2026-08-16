// Acceptance gate for the machine-dmu160p viewer model (Sigma1912's
// vtk-vismach DMU 160 P, converted by fetch-model.sh): the assembled
// machine must be mechanically coherent by its own collision engine, and
// the nutating-head kinematics must place the spindle nose where the
// vismach math says. Sweeps the working envelope high above the table
// (tool excluded — tool-vs-machine is program-dependent) and requires
// zero hits with static contacts only at the designed joints.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCollisionModel, sweepCollisions,
  type CollisionBody, type CollisionMachine,
} from "./collision";
import { transformToPartFrame, type PartFrameMachine } from "./partFrame";
import type { ScrubTrack } from "../ws/bulkData";

const DIR = path.resolve(__dirname, "../../../examples/sim_config/machine-dmu160p");

function parseBinSTL(buf: Buffer): Float32Array {
  const n = buf.readUInt32LE(80);
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const off = 84 + i * 50 + 12;
    for (let v = 0; v < 9; v++) out[i * 9 + v] = buf.readFloatLE(off + v * 4);
  }
  return out;
}

function envelopeTrack(points: number[][]): ScrubTrack {
  // points: [x, y, z, b, c]
  const n = points.length;
  const pos = new Float32Array(n * 3);
  const abc = new Float32Array(n * 3);
  const cum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [x, y, z, b, c] = points[i]!;
    pos.set([x!, y!, z!], i * 3);
    abc.set([0, b!, c!], i * 3);
    if (i > 0) {
      const [px, py, pz, , ] = points[i - 1]!;
      const pb = points[i - 1]![3]!, pc = points[i - 1]![4]!;
      const lin = Math.hypot(x! - px!, y! - py!, z! - pz!);
      const rot = Math.max(Math.abs(b! - pb), Math.abs(c! - pc));
      cum[i] = cum[i - 1]! + Math.max(lin, rot);
    }
  }
  return {
    pos, abc, lines: new Uint32Array(points.map((_, i) => i + 1)),
    rapid: new Uint8Array(n), cum, count: n,
    lineCum: new Map(), lineSpan: new Map(), timeBased: false,
  };
}

const mj = JSON.parse(fs.readFileSync(path.join(DIR, "machine.json"), "utf8"));
const AXES = ["X", "Y", "Z", "B", "C"];

describe("machine-dmu160p model acceptance", () => {
  const machine: CollisionMachine = {
    groups: mj.groups, kinematics: mj.kinematics,
    workGroup: mj.workGroup, toolGroup: mj.toolGroup,
    unitScale: 1, axes: AXES,
  };
  const bodies: CollisionBody[] = mj.parts.map((p: any) => ({
    id: p.id, group: p.group ?? "root",
    positions: parseBinSTL(fs.readFileSync(path.join(DIR, p.file))),
    translate: p.translate, rotate: p.rotate, stock: p.stock,
  }));

  it("declares exactly one stock body — the workpiece", () => {
    expect(mj.parts.filter((p: any) => p.stock).map((p: any) => p.id)).toEqual(["work_piece"]);
  });

  it("nutating-head kinematics place the nose per the vismach math", () => {
    const pfm: PartFrameMachine = {
      groups: mj.groups, kinematics: mj.kinematics,
      workGroup: mj.workGroup, toolGroup: mj.toolGroup,
      unitScale: 1, axes: AXES,
    };
    const wcs = { g5x: [], g92: [], rotationDeg: 0 };
    // transformToPartFrame with an untransformed work chain (C=0) returns
    // the tool tip in the work frame — i.e. machine coords here. Feed it
    // machine-coord inputs (identity WCS) and check the nose landing.
    // B=0: nose = pivot + (0,0,80); the chain must return the input point.
    const at = (x: number, y: number, z: number, b: number) => {
      const r = transformToPartFrame(pfm, wcs, {
        pos: new Float32Array([x, y, z]),
        abc: new Float32Array([0, b, 0]),
      });
      return [r.pos[0]!, r.pos[1]!, r.pos[2]!];
    };
    // Pure-translate pose: identity by construction (machine Z0 = top of
    // travel; the work chain carries the +1120 world lift, so the peel
    // returns exactly the machine coords — the trivkins identity).
    const p0 = at(100, -50, -420, 0);
    expect(p0[0]).toBeCloseTo(100, 4);
    expect(p0[1]).toBeCloseTo(-50, 4);
    expect(p0[2]).toBeCloseTo(-420, 4);
    // B=180 about the 45°-nutated axis n=(0,s,c)/√2: R·(0,0,80) =
    // 2n(n·v)−v = (0,80,0) — the nose swings to horizontal +Y at pivot
    // height. Program z means JOINT z (trivkins), so the tip in machine
    // coords = input + (R·t − t) where t=(0,0,80): offset (0,80,−80).
    const p180 = at(0, 0, -420, 180);
    expect(p180[0]).toBeCloseTo(0, 3);
    expect(p180[1]).toBeCloseTo(80, 3);
    expect(p180[2]).toBeCloseTo(-420 - 80, 3);
  });

  // The machine's intentional joints — the ONLY pairs allowed to be in
  // contact at rest. The stock is glued to the platter it sits on but is a
  // CUTTING body, so it never appears in staticContacts by construction.
  // Entries are the SORTED "a/b" form (the assertion sorts pair names).
  const ALLOWED_STATIC = new Set([
    "base/portal",            // portal shoes on the bed ways
    "base/ytable",            // Y carriage on the bed ways
    "portal/zslide",          // Z slide on the portal ways
    "bhead/zslide",           // head on the Z-slide bearing
    "ctable/ytable",          // rotary table on the Y carriage
  ]);

  // ~20 min of real verification (170k-triangle meshes, C spins priced by
  // the 700 mm table lever) — far too heavy for the routine suite. Run it
  // after touching the model:  LCNC_MODEL_GATES=1 npx vitest run
  // src/viewer/machineDmu160p.test.ts   (the fast tests above always run).
  it.runIf(!!process.env.LCNC_MODEL_GATES)(
    "sweeps the working envelope with zero self-collisions", { timeout: 3_600_000 }, () => {
    const model = buildCollisionModel(machine, bodies);
    expect(model.pairs.length).toBeGreaterThan(0);

    // Machine coords, Z0 = top of travel (nose 1120 above the table; the
    // stock top sits at machine −620). Envelope tour with the nose kept
    // at/above the stock top: full B swing at every station; C turns are
    // BOUNDED away from center (conservative advancement prices a C spin
    // by the 700 mm table lever — full turns everywhere made the gate run
    // for half an hour; the asymmetric stock cube only reaches anything
    // near the center station, which keeps its full spins).
    const pts: number[][] = [[0, 0, 0, 0, 0]];
    for (const [x, y] of [[-800, -600], [800, -600], [800, 625], [-800, 625]]) {
      pts.push([x, y, -20, 0, 0]);
      pts.push([x, y, -420, -30, 45]);
      pts.push([x, y, -420, 180, 90]);
      pts.push([x, y, -420, 0, 0]);
    }
    // Center: full C spin at B0, then B to full tilt through another half
    // turn — the cube sweeps under the head through the whole range.
    pts.push([0, 0, -20, 0, 0]);
    pts.push([0, 0, -420, 0, 0]);
    pts.push([0, 0, -420, 0, 360]);
    pts.push([0, 0, -420, 180, 540]);
    pts.push([0, 0, -420, -30, 540]);
    pts.push([0, 0, -420, 0, 540]);
    // Deep-Z stations far from the stock (|x|>400 keeps the head clear of
    // the 500-cube even at full B tilt), plus a straight vertical plunge
    // to the mechanical floor (−970 = nose 150, slide bottom 26 clear).
    pts.push([-700, 0, -600, 0, 540], [-700, 0, -600, 90, 630], [-700, 0, -320, 0, 630]);
    pts.push([700, 0, -600, 0, 630], [700, 0, -600, 90, 720], [700, 0, -320, 0, 720]);
    pts.push([700, 0, -970, 0, 720], [700, 0, -320, 0, 720]);
    pts.push([0, 0, 0, 0, 720]);

    const res = sweepCollisions(model, envelopeTrack(pts),
      { g5x: [], g92: [], rotationDeg: 0 }, { margin: 2, maxSamples: 200_000 });

    const staticPairs = res.staticContacts.map(s => [s.a, s.b].sort().join("/"));
    for (const p of staticPairs) {
      expect(ALLOWED_STATIC.has(p), `unexpected rest contact: ${p}`).toBe(true);
    }
    const hitDescr = res.hits.map(h => `L${h.line} ${h.a}/${h.b} d=${h.dist.toFixed(2)} cum=${h.cum.toFixed(1)}`);
    expect(hitDescr, `self-collisions inside the legal envelope:\n${hitDescr.join("\n")}`).toEqual([]);
  });
});
