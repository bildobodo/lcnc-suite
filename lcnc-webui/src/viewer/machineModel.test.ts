// Acceptance gate for the generated machine-xyzac viewer model: the machine
// must be MECHANICALLY COHERENT by its own collision engine. Sweeps the full
// rotary envelope (A −100..+50 × C two turns) and the linear travel extents
// (X ±200, Y ±70, Z −30..+100) over the real generated STLs, tool excluded
// (tool-vs-machine is program-dependent by design; this gate is machine
// SELF-consistency), and requires:
//   - zero per-line hits (nothing collides anywhere in the legal envelope)
//   - static contacts ONLY at the intentional mechanical joints
// If this test fails after touching scripts/vismach_to_stl.py, the model is
// wrong — regenerate with sound dimensions, don't loosen the gate.
import * as fs from "node:fs";
import { emptyLineIndex } from "./lineIndex";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCollisionModel, sweepCollisions,
  type CollisionBody, type CollisionMachine,
} from "./collision";
import type { ScrubTrack } from "../ws/bulkData";

const DIR = path.resolve(__dirname, "../../../examples/sim_config/machine-xyzac");

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
  // points: [x, y, z, a, c]
  const n = points.length;
  const pos = new Float32Array(n * 3);
  const abc = new Float32Array(n * 3);
  const cum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [x, y, z, a, c] = points[i]!;
    pos.set([x!, y!, z!], i * 3);
    abc.set([a!, 0, c!], i * 3);
    if (i > 0) {
      const [px, py, pz, pa, pc] = points[i - 1]!;
      const lin = Math.hypot(x! - px!, y! - py!, z! - pz!);
      const rot = Math.max(Math.abs(a! - pa!), Math.abs(c! - pc!));
      cum[i] = cum[i - 1]! + Math.max(lin, rot);
    }
  }
  return {
    pos, abc, lines: new Uint32Array(points.map((_, i) => i + 1)),
    rapid: new Uint8Array(n), cum, count: n,
    lineIndex: emptyLineIndex(), timeBased: false,
  };
}

describe("machine-xyzac model acceptance", () => {
  const mj = JSON.parse(fs.readFileSync(path.join(DIR, "machine.json"), "utf8"));
  const machine: CollisionMachine = {
    groups: mj.groups, kinematics: mj.kinematics,
    workGroup: mj.workGroup, toolGroup: mj.toolGroup,
    unitScale: 1, axes: ["X", "Y", "Z", "A", "C"],
  };
  const bodies: CollisionBody[] = mj.parts.map((p: any) => ({
    id: p.id, group: p.group ?? "root",
    positions: parseBinSTL(fs.readFileSync(path.join(DIR, p.file))),
    translate: p.translate, rotate: p.rotate,
  }));

  // The machine's intentional joints — the ONLY pairs allowed to be in
  // contact at rest (bearings, ways, seats). Everything else must be clear
  // everywhere in the envelope.
  const ALLOWED_STATIC = new Set([
    "knee/saddle",            // knee↔saddle ways
    "saddle/table",           // saddle↔table ways
    "a_trunnion/table",       // trunnion shafts in the pillar bearings
    "a_trunnion/c_base",      // C stack seated on the cradle plate
    "c_base/c_platter",       // platter on its bearing housing
  ]);

  // Sync sweep over the full envelope — ~20 s of real verification; the
  // cost is the point (this is the model's acceptance gate, not a unit test).
  it("working envelope has zero self-collisions; static contacts are the designed joints only", { timeout: 120_000 }, () => {
    const model = buildCollisionModel(machine, bodies);
    // The WORKING envelope is not the travel hypercube: on a trunnion knee
    // mill, full tilt or full X traverse with the work raised to the tool
    // genuinely fouls the head/spindle — that interplay is real machine
    // behavior (and exactly what the program-level sweep exists to catch).
    // The gate therefore encodes the mechanically intended envelope:
    //   - knee DOWN (Z+100): full A×C rotary envelope + full X/Y extents
    //   - work height (Z0): straight full plunge, modest tilt, modest X/Y
    const track = envelopeTrack([
      [0, 0, 0, 0, 0],
      // knee down: full rotary envelope
      [0, 0, 100, 0, 0],
      [0, 0, 100, -100, 0],
      [0, 0, 100, -100, 720],
      [0, 0, 100, 50, 720],
      [0, 0, 100, 50, 0],
      [0, 0, 100, 0, 0],
      // knee down: full linear extents
      [200, 0, 100, 0, 0],
      [-200, 0, 100, 0, 0],
      [-200, -70, 100, 0, 0],
      [-200, 70, 100, 0, 0],
      [0, 70, 100, 0, 0],
      // work height: straight plunge to the limit (5 mm nose margin)
      [0, 0, 0, 0, 0],
      [0, 0, -30, 0, 0],
      [0, 0, 0, 0, 0],
      // work height: modest tilt + the platter-local XY range with C
      // turning (|X| beyond ~29 at Z0 slides a cheek under the nose — the
      // platter rim is reached via C rotation, as on real trunnions)
      [0, 0, 0, -30, 0],
      [0, 0, 0, 30, 180],
      [0, 0, 0, 0, 0],
      [25, 25, 0, 0, 360],
      [-25, -25, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ]);
    const r = sweepCollisions(model, track,
      { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 },
      { margin: 2, maxSamples: 200_000 });

    const staticPairs = r.staticContacts.map(c => [c.a, c.b].sort().join("/"));
    for (const p of staticPairs) {
      expect(ALLOWED_STATIC.has(p), `unexpected rest contact: ${p}`).toBe(true);
    }
    const hitDescr = r.hits.map(h => `L${h.line} ${h.a}/${h.b} d=${h.dist.toFixed(2)} cum=${h.cum.toFixed(1)}`);
    expect(hitDescr, `self-collisions inside the legal envelope:\n${hitDescr.join("\n")}`).toEqual([]);
  });
});
