// The distance query's horizon (operator 2026-10-06, live on haus.ngc on the
// XYZAC sim, TCP, A 61.3°): the entry move drove the Y saddle, the yoke, the
// A bearing pedestals and the drive covers into the rear column, and the
// sweep reported the yoke 230 mm of travel late and the others not at all.
// three-mesh-bvh's closestPointToGeometry searches only the bounds nearer
// than its maxThreshold; a distance it returns ABOVE that threshold is the
// closest among the triangles it happened to visit, not the minimum (291 mm
// returned at a true 82). The sweep took it for the clearance and its
// certificate jumped past the onset.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyLineIndex } from "./lineIndex";
import { buildCollisionModel, sweepCollisions, type CollisionBody, type CollisionMachine } from "./collision";
import { tablesByPair } from "./collisionFixtures";
import { ContactStore } from "./contactStore";
import type { ScrubTrack } from "../ws/bulkData";

const DIR = path.resolve(__dirname, "../../../examples/sim_config/machine-5axis-xyzac");

function parseBinSTL(buf: Buffer): Float32Array {
  const n = buf.readUInt32LE(80);
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const off = 84 + i * 50 + 12;
    for (let v = 0; v < 9; v++) out[i * 9 + v] = buf.readFloatLE(off + v * 4);
  }
  return out;
}

describe("the sweep's distance horizon", () => {
  const mj = JSON.parse(fs.readFileSync(path.join(DIR, "machine.json"), "utf8"));
  const machine: CollisionMachine = {
    groups: mj.groups, kinematics: mj.kinematics, workGroup: mj.workGroup, toolGroup: mj.toolGroup,
    unitScale: 1, axes: ["X", "Y", "Z", "A", "C"],
  };
  const bodies: CollisionBody[] = mj.parts.filter((p: any) => p.collide !== false).map((p: any) => ({
    id: p.id, group: p.group ?? "root",
    positions: parseBinSTL(fs.readFileSync(path.join(DIR, p.file))),
    translate: p.translate, rotate: p.rotate,
  }));

  it("the operator's entry move: every pair driven into the column is found where it touches", { timeout: 60_000 }, () => {
    // The live entry move in joint space (identity kins, A held at 61.315°):
    // from the machine's position to the program's first point.
    const from = [193.5, -114.368, -11.535], to = [-238.281, -477.580, -401.600];
    const len = Math.hypot(to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!);
    const track: ScrubTrack = {
      pos: new Float32Array([...from, ...to]), abc: new Float32Array([61.315, 0, 0, 61.315, 0, 0]),
      lines: new Uint32Array([1, 2]), rapid: new Uint8Array([0, 1]), cum: new Float32Array([0, len]),
      count: 2, lineIndex: emptyLineIndex(), timeBased: false,
    };
    const model = buildCollisionModel(machine, bodies);
    const store = new ContactStore(1, 0);
    sweepCollisions(model, track, { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0, tool: [0, 0, 0] } as any, { margin: 2, contacts: { store } });
    // the contact tables (step 4 package 2): the pair's first touch interval
    // enters there (the sweep's parameter is the move's mm)
    const tabs = tablesByPair(store, len);
    const pairOf = (b: string) => model.pairs.findIndex(([x, y]) => [model.bodies[x]!.id, model.bodies[y]!.id].sort().join("/") === ["rear_column", b].sort().join("/"));
    const tableOnset = (b: string) => tabs.get(pairOf(b))?.touches.map(([a]) => a).sort((x, y) => x - y)[0];
    // Each part's first contact with the column, mm along the 686 mm move —
    // measured apart from the sweep: the same poses stepped every 0.5 mm with
    // an unbounded closest-point query, then bisected.
    const TRUE: Record<string, number> = {
      a_yoke_casting: 275.401, y_saddle: 308.241, a_bearing_pedestals: 366.928, a_bearing_rings: 495.130, a_drive_covers: 561.254,
    };
    for (const [b, at] of Object.entries(TRUE)) {
      const t = tableOnset(b);
      expect(t, `rear_column/${b}: a touch interval in the tables`).toBeDefined();
      expect(Math.abs(t! - at), `rear_column/${b}: the tables' first touch at its first contact (${at} mm), got ${t?.toFixed(3)}`).toBeLessThan(0.01);
    }
  });
});
