// Acceptance gate for the generated machine-xyzacb-trsrn viewer model — the
// TWP (tilted work plane) demo machine.
//
// Its layout is a third topology: machine-xyzac has both rotaries on the work
// side, machine-dmu160p has both on the tool side, and this one is SPLIT —
// the A faceplate carries the work while B (nutating) and C (swivel) carry
// the tool. That split is what the group tree has to say, and getting a sign
// or an axis wrong there produces a model that looks plausible and poses
// wrongly, so the fast tests below pin the chain analytically before the
// expensive sweep runs.
//
// If a test here fails after touching scripts/vismach_to_stl_trsrn.py, the
// model is wrong — regenerate with sound dimensions, don't loosen the gate.
import * as fs from "node:fs";
import { emptyLineIndex } from "./lineIndex";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { transformToPartFrame, type PartFrameMachine } from "./partFrame";
import {
  buildCollisionModel, sweepCollisions,
  type CollisionBody, type CollisionMachine,
} from "./collision";
import type { ScrubTrack } from "../ws/bulkData";

const DIR = path.resolve(__dirname, "../../../examples/sim_config/machine-xyzacb-trsrn");
const AXES = ["X", "Y", "Z", "A", "B", "C"];

const mj = JSON.parse(fs.readFileSync(path.join(DIR, "machine.json"), "utf8"));

// The seven kins geometry pins the INI must `setp`. Duplicated here ON
// PURPOSE: this is the assertion that the model and the kinematics did not
// drift apart, so it has to state the values independently of the generator.
const NUT_ANGLE = 55, PIVOT_Y = 50, PIVOT_Z = 120;
const Y_ROT_AXIS = -1000, Z_ROT_AXIS = -2000;
const MZ = [-1000, 1000, 2000];

// The Z window the INI grants the type-0 (identity) kinematics — read from the
// config itself so the model and the limits cannot drift apart silently: the
// parked pose and every envelope station must lie inside it, the sweep must
// reach the declared floor, and the AXIS and JOINT windows must agree (the
// ini.z.* lift under TCP/TOOL kins relies on the joint window being the
// physical one). 2026-09-05: Z0 became the top of travel (−2000..0.01).
const INI = fs.readFileSync(
  path.resolve(__dirname, "../../../examples/sim_config/lcnc_suite_sim_twp.ini"), "utf8");
function iniFloat(section: string, key: string): number {
  const body = INI.split(/^\[/m).find(s => s.startsWith(`${section}]`));
  const m = body?.match(new RegExp(`^${key}\\s*=\\s*(-?[\\d.]+)`, "m"));
  if (!m) throw new Error(`${section}.${key} missing from the TWP INI`);
  return parseFloat(m[1]);
}
const Z_MIN = iniFloat("JOINT_2", "MIN_LIMIT"), Z_MAX = iniFloat("JOINT_2", "MAX_LIMIT");

describe("machine-xyzacb-trsrn model structure", () => {
  it("drives joints 0..5 exactly once each, with the vismach signs", () => {
    const byJoint = new Map<number, any>();
    for (const k of mj.kinematics) {
      expect(byJoint.has(k.joint), `joint ${k.joint} driven twice`).toBe(false);
      byJoint.set(k.joint, k);
    }
    expect([...byJoint.keys()].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    // Head-moving linear slides: the head carries all three, so they share a
    // group and all read +1 (contrast the xyzac knee mill, where table/saddle/
    // knee move under a fixed head and every sign is -1).
    for (const [j, dir] of [[0, "x"], [1, "y"], [2, "z"]] as [number, string][]) {
      expect(byJoint.get(j)).toMatchObject({
        group: "xyz_head", type: "translate", direction: dir, sign: 1,
      });
    }
    // A: vismach turns the faceplate by -A about its local +Z, and the two
    // static 90-degree placements map that onto world +X.
    expect(byJoint.get(3)).toMatchObject({
      group: "a_table", type: "rotate", direction: "x", sign: -1,
    });
    // B: the nutating joint needs the arbitrary-axis form, not a `direction`.
    const b = byJoint.get(4);
    expect(b.group).toBe("b_nut");
    expect(b.type).toBe("rotate");
    expect(b.direction).toBeUndefined();
    expect(b.axis[0]).toBeCloseTo(0, 12);
    expect(b.axis[1]).toBeCloseTo(Math.sin(NUT_ANGLE * Math.PI / 180), 9);
    expect(b.axis[2]).toBeCloseTo(Math.cos(NUT_ANGLE * Math.PI / 180), 9);
    expect(b.sign).toBe(1);
    expect(byJoint.get(5)).toMatchObject({
      group: "c_swivel", type: "rotate", direction: "z", sign: 1,
    });
  });

  it("carries the kins pin values in the group frame, not just in comments", () => {
    const g = Object.fromEntries(mj.groups.map((x: any) => [x.id, x]));
    // The C swivel sits at the B pivot, which the two pivot pins define.
    expect(g.c_swivel.translate).toEqual([0, PIVOT_Y, PIVOT_Z]);
    // The tool group steps back down to the spindle nose.
    expect(g.tool.translate).toEqual([0, -PIVOT_Y, -PIVOT_Z]);
    // The A axis lies at machine zero + the rot-axis pins.
    expect(g.a_table.translate[1]).toBeCloseTo(MZ[1]! + Y_ROT_AXIS, 9);
    expect(g.a_table.translate[2]).toBeCloseTo(MZ[2]! + Z_ROT_AXIS, 9);
    expect(g.xyz_head.translate).toEqual(MZ);
  });

  it("declares exactly one stock body — the workpiece", () => {
    expect(mj.parts.filter((p: any) => p.stock).map((p: any) => p.id))
      .toEqual(["work_piece"]);
  });

  it("every part file exists and every group is reachable from root", () => {
    const ids = new Set<string>(["root"]);
    for (const g of mj.groups) ids.add(g.id);
    for (const g of mj.groups) expect(ids.has(g.parent), `${g.id} -> ${g.parent}`).toBe(true);
    for (const p of mj.parts) {
      expect(fs.existsSync(path.join(DIR, p.file)), p.file).toBe(true);
      if (p.group != null) expect(ids.has(p.group), `part ${p.id} -> ${p.group}`).toBe(true);
    }
    expect(ids.has(mj.workGroup)).toBe(true);
    expect(ids.has(mj.toolGroup)).toBe(true);
  });
});

describe("machine-xyzacb-trsrn kinematic chain", () => {
  const pfm: PartFrameMachine = {
    groups: mj.groups, kinematics: mj.kinematics,
    workGroup: mj.workGroup, toolGroup: mj.toolGroup,
    unitScale: 1, axes: AXES,
  };
  const wcs = { g5x: [], g92: [], rotationDeg: 0 };
  const at = (x: number, y: number, z: number, a = 0, b = 0, c = 0) => {
    const r = transformToPartFrame(pfm, wcs, {
      pos: new Float32Array([x, y, z]),
      abc: new Float32Array([a, b, c]),
    });
    return [r.pos[0]!, r.pos[1]!, r.pos[2]!];
  };

  it("peels to machine coords exactly when the rotaries are at zero", () => {
    // The work frame is origined at MACHINE ZERO (a_work), not at the table
    // centre, so the tool-vs-work relative pose IS the machine coordinate.
    // Without that split the peel would carry the constant nose-to-table
    // offset and the drawn toolpath would sit that far from the tool.
    for (const p of [[0, 0, 0], [100, -50, -420], [-1234.5, 678.25, -1900]]) {
      const out = at(p[0]!, p[1]!, p[2]!);
      expect(out[0]).toBeCloseTo(p[0]!, 3);
      expect(out[1]).toBeCloseTo(p[1]!, 3);
      expect(out[2]).toBeCloseTo(p[2]!, 3);
    }
  });

  it("B swings the nose about the nutation axis, per the vismach math", () => {
    // B = 180 about n = (0, sin nu, cos nu) maps the nose offset
    // t = (0, -PIVOT_Y, -PIVOT_Z) to 2n(n.t) - t, so the tip moves by
    // (2n(n.t) - t) - t. With nu = 55 that is (0, -79.864, +114.059) — a
    // number that changes if the axis, the sign or the nut angle is wrong,
    // which a plain "it renders" check would not notice.
    const nu = NUT_ANGLE * Math.PI / 180;
    const n = [0, Math.sin(nu), Math.cos(nu)];
    const t = [0, -PIVOT_Y, -PIVOT_Z];
    const ndt = n[1]! * t[1]! + n[2]! * t[2]!;
    const delta = [0, 2 * ndt * n[1]! - t[1]! - t[1]!, 2 * ndt * n[2]! - t[2]! - t[2]!];
    const base = at(0, 0, 0, 0, 0, 0);
    const swung = at(0, 0, 0, 0, 180, 0);
    expect(swung[0]! - base[0]!).toBeCloseTo(delta[0]!, 3);
    expect(swung[1]! - base[1]!).toBeCloseTo(delta[1]!, 3);
    expect(swung[2]! - base[2]!).toBeCloseTo(delta[2]!, 3);
    expect(swung[1]! - base[1]!).toBeCloseTo(-79.864, 2);
    expect(swung[2]! - base[2]!).toBeCloseTo(114.059, 2);
  });

  it("B's DIRECTION is pinned too — a half turn alone cannot see a sign flip", () => {
    // R(180, n) == R(-180, n), so the case above passes just as happily with
    // the B sign inverted. A QUARTER turn does not: Rodrigues' cross-product
    // term flips with the sign, and it is the only term with an x component
    // here, so the nose swings to x = -69.619 one way and +69.619 the other.
    const base = at(0, 0, 0);
    const quarter = at(0, 0, 0, 0, 90, 0);
    expect(quarter[0]! - base[0]!).toBeCloseTo(-69.619, 2);
    expect(quarter[1]! - base[1]!).toBeCloseTo(-39.932, 2);
    expect(quarter[2]! - base[2]!).toBeCloseTo(57.029, 2);
  });

  it("C swivels the nose about the pivot, not about the nose itself", () => {
    // The C axis runs through the B pivot, which is PIVOT_Y off the spindle
    // axis — so a 180-degree C turn walks the nose 2*PIVOT_Y across. A model
    // that put the C axis through the spindle would show no motion at all.
    const base = at(0, 0, 0);
    const half = at(0, 0, 0, 0, 0, 180);
    expect(half[0]! - base[0]!).toBeCloseTo(0, 3);
    expect(half[1]! - base[1]!).toBeCloseTo(2 * PIVOT_Y, 3);
    expect(half[2]! - base[2]!).toBeCloseTo(0, 3);
  });

  it("A turns the WORK, so the tool's part-frame position orbits the axis", () => {
    // The faceplate axis is world +X at machine-zero + the rot-axis pins, so
    // a point on the spindle nose at machine zero sits |rot-axis| away from
    // it and a 180-degree A turn must mirror it across that axis. This is the
    // assertion that catches an A sign flip, which is otherwise invisible.
    const turned = at(0, 0, 0, 180);
    expect(turned[0]!).toBeCloseTo(0, 3);
    expect(turned[1]!).toBeCloseTo(2 * Y_ROT_AXIS, 3);
    expect(turned[2]!).toBeCloseTo(2 * Z_ROT_AXIS, 3);
  });
});

// ── envelope acceptance sweep ───────────────────────────────────────────────

function parseBinSTL(buf: Buffer): Float32Array {
  const n = buf.readUInt32LE(80);
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const off = 84 + i * 50 + 12;
    for (let v = 0; v < 9; v++) out[i * 9 + v] = buf.readFloatLE(off + v * 4);
  }
  return out;
}

/** points: [x, y, z, a, b, c]. `mode`/`frames` make the sweep actually route
 *  through the trsrn kins — without them every pose falls back to identity
 *  and the sweep would exercise none of the machinery it is here to gate. */
function envelopeTrack(points: number[][], mode?: number[]): ScrubTrack {
  const n = points.length;
  const pos = new Float32Array(n * 3);
  const abc = new Float32Array(n * 3);
  const cum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [x, y, z, a, b, c] = points[i]!;
    pos.set([x!, y!, z!], i * 3);
    abc.set([a!, b!, c!], i * 3);
    if (i > 0) {
      const p = points[i - 1]!;
      const lin = Math.hypot(x! - p[0]!, y! - p[1]!, z! - p[2]!);
      const rot = Math.max(Math.abs(a! - p[3]!), Math.abs(b! - p[4]!), Math.abs(c! - p[5]!));
      cum[i] = cum[i - 1]! + Math.max(lin, rot);
    }
  }
  const t: ScrubTrack = {
    pos, abc, lines: new Uint32Array(points.map((_, i) => i + 1)),
    rapid: new Uint8Array(n), cum, count: n,
    lineIndex: emptyLineIndex(), timeBased: false,
  };
  if (mode) {
    t.mode = new Uint8Array(mode);
    // A frame for every vertex; only the type-2 ones consult it. The triplet
    // is the live-validated plane from the TWP spike capture.
    t.frame = new Uint8Array(n);
    t.frames = [[-1.781762, 130.2455, -40.8555]];
  }
  return t;
}

const machine: CollisionMachine = {
  groups: mj.groups, kinematics: mj.kinematics,
  workGroup: mj.workGroup, toolGroup: mj.toolGroup,
  unitScale: 1, axes: AXES,
  kins: {
    type: "xyzacb-trsrn", identityFirst: false,
    trsrn: { yPivot: PIVOT_Y, zPivot: PIVOT_Z, xOffset: 0, yOffset: 0,
             yRotAxis: Y_ROT_AXIS, zRotAxis: Z_ROT_AXIS, nutAngle: NUT_ANGLE },
  },
};
const bodies: CollisionBody[] = mj.parts.map((p: any) => ({
  id: p.id, group: p.group ?? "root",
  positions: parseBinSTL(fs.readFileSync(path.join(DIR, p.file))),
  translate: p.translate, rotate: p.rotate, stock: p.stock,
}));
const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 };

describe("machine-xyzacb-trsrn envelope acceptance", () => {
  // The only pairs allowed to touch at rest. Both are real bearings; anything
  // else in contact means the model is drawn wrong, not that the gate is too
  // strict.
  const ALLOWED_STATIC = new Set([
    "c_head/ram",          // the C bearing plate seated on the ram
    "platter/table_base",  // the A faceplate in its bearing block
  ]);

  // Not the travel hypercube. The INI's X +/-1500 and Y -2000..1300 (model-
  // derived, 2026-09-12; the upstream +/-5000 swept a 10 m square through
  // the portal and the table alike) still run the head into the trunnion
  // block low in Z; that is what the program-level sweep exists to catch.
  // This is the mechanically intended envelope:
  //   - at parked height (Z0 = the top of travel, nose 2 m above the table):
  //     the full rotary envelope and the linear extents the portal allows
  //   - down at the work: traverse over the stock, stopping just above it
  //   - the Z floor (INI MIN_LIMIT): straight down from the parked pose over
  //     the clear region — NOT over the stock at Y-1000, which would be 600 mm
  //     through the work piece onto the console
  // Rotaries are exercised HIGH and the descent happens with the rotaries
  // parked, which is how the machine is actually driven — indexing the
  // faceplate with the head down swings a 941 mm radius into the spindle,
  // and correctly so.
  const ENVELOPE: number[][] = [
    [0, 0, 0, 0, 0, 0],
    // full rotary envelope, head parked high
    [0, 0, 0, 360, 0, 0],
    [0, 0, 0, 360, 180, 0],
    [0, 0, 0, 360, 180, 180],
    [0, 0, 0, 360, -180, -180],
    [0, 0, 0, 0, 0, 0],
    // linear extents at parked height (portal opening bounds X)
    [200, 0, 0, 0, 0, 0],
    [-600, 0, 0, 0, 0, 0],
    [-600, -1400, 0, 0, 0, 0],
    [200, -1400, 0, 0, 0, 0],
    [0, -1000, 0, 0, 0, 0],
    // descend over the stock and traverse it, rotaries parked
    [0, -1000, -1300, 0, 0, 0],
    [200, -1000, -1300, 0, 0, 0],
    [-400, -1000, -1300, 0, 0, 0],
    [0, -1000, -1380, 0, 0, 0],
    [0, -1000, 0, 0, 0, 0],
    // the Z floor: nose at the A-axis height at world (-1000, 1000, 0) — 50 mm
    // from the console edge, the C-collar dip outside it, the ram inside the
    // portal opening (computed from vismach_to_stl_trsrn.py; B = C = 0)
    [0, 0, 0, 0, 0, 0],
    [0, 0, -2000, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ];

  it("the INI Z window: Z0 is the top, AXIS == JOINT, every station inside, the sweep reaches the floor", () => {
    expect([iniFloat("AXIS_Z", "MIN_LIMIT"), iniFloat("AXIS_Z", "MAX_LIMIT")]).toEqual([Z_MIN, Z_MAX]);
    expect(Z_MAX).toBeGreaterThan(0);   // HOME = 0 strictly inside (homing legality)
    expect(Z_MAX).toBeLessThan(1);      // …and Z0 IS the top of travel
    const zs = ENVELOPE.map(p => p[2]);
    for (const z of zs) {
      expect(z).toBeGreaterThanOrEqual(Z_MIN);
      expect(z).toBeLessThanOrEqual(Z_MAX);
    }
    expect(Math.min(...zs)).toBe(Z_MIN); // a floor change without a station change fails here
  });

  it("working envelope has zero self-collisions; static contacts are the designed bearings only", { timeout: 300_000 }, () => {
    const track = envelopeTrack(ENVELOPE);
    const r = sweepCollisions(buildCollisionModel(machine, bodies), track, WCS0,
                              { margin: 2, maxSamples: 400_000 });

    const staticPairs = r.staticContacts.map(c => [c.a, c.b].sort().join("/"));
    for (const p of staticPairs) {
      expect(ALLOWED_STATIC.has(p), `unexpected rest contact: ${p}`).toBe(true);
    }
    const hitDescr = r.hits.map(h => `L${h.line} ${h.a}/${h.b} d=${h.dist.toFixed(2)} cum=${h.cum.toFixed(1)}`);
    expect(hitDescr, `self-collisions inside the legal envelope:\n${hitDescr.join("\n")}`).toEqual([]);
    // A coarsened sweep is a sample, not a proof — the assertion above would
    // be vacuous under one.
    expect(r.coarsened).toBe(false);
    expect(r.uncertified).toBeNull();
  });

  it("stays certified and inside budget through TCP and plane segments", { timeout: 300_000 }, () => {
    // The envelope gate above runs in identity kins, where the poses are the
    // machine coords by construction and the geometry claim is exact. This
    // one drives the SAME model through raw switchkins types 0 -> 1 (TCP) ->
    // 2 (TOOL/plane) with a transition between them, which is what routes the
    // sweep through TrsrnKins and its clearance bound on real STL geometry.
    //
    // It deliberately does NOT assert zero hits: under TCP and plane kins the
    // same words mean different joints, so these poses are not an envelope
    // anyone designed and a contact would prove nothing about the model. What
    // it does assert is that the machinery holds up — the kins route resolves
    // for every segment, and the bound does not blow the sample budget, which
    // is the failure mode that would silently downgrade a real sweep to a
    // sample.
    const track = envelopeTrack([
      [0, 0, 0, 0, 0, 0],
      [100, -200, -300, 0, 0, 0],
      [100, -200, -300, 20, 0, 0],
      [150, -250, -350, 20, 15, 30],
      [200, -300, -400, 40, 30, 60],
      [200, -300, -400, 40, 30, 60],
      [250, -350, -450, 40, 30, 60],
    ], [0, 0, 1, 1, 1, 2, 2]);
    const r = sweepCollisions(buildCollisionModel(machine, bodies), track, WCS0,
                              { margin: 2, maxSamples: 400_000 });
    expect(r.uncertified).toBeNull();
    expect(r.coarsened).toBe(false);
    expect(r.pairCount).toBeGreaterThan(0);
  });
});
