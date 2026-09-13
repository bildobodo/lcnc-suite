// The wall gantry is a separate TWP candidate. Exercise the shipped assets
// through the same chain and collision engine used by the running viewer.
import * as fs from "node:fs";
import * as path from "node:path";
import { Box3, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { buildChain, evalChainTip, tipInWorkFrame, type PartFrameMachine } from "./partFrame";
import { TrsrnKins } from "./kins";
import { buildCollisionModel, sweepCollisions, type CollisionBody, type CollisionMachine } from "./collision";
import { emptyLineIndex } from "./lineIndex";
import type { ScrubTrack } from "../ws/bulkData";

const SIM = path.resolve(__dirname, "../../../examples/sim_config");
const DIR = path.join(SIM, "machine-xyzacb-gantry");
const mj = JSON.parse(fs.readFileSync(path.join(DIR, "machine.json"), "utf8"));
const ini = fs.readFileSync(path.join(SIM, "lcnc_suite_sim_twp_gantry.ini"), "utf8");
function setting(section: string, key: string): string {
  const body = ini.split(/^\[/m).find(s => s.startsWith(`${section}]`));
  const match = body?.match(new RegExp(`^${key}\\s*=([^\\n]*)`, "m"));
  if (!match) throw new Error(`Missing ${section}.${key}`);
  return match[1]!.trim();
}
const limits = Array.from({ length: 6 }, (_, j) =>
  ["MIN_LIMIT", "MAX_LIMIT"].map(k => Number(setting(`JOINT_${j}`, k))));
const pins = Object.fromEntries([...ini.matchAll(
  /^HALCMD = setp xyzacb_trsrn_kins\.([\w-]+) ([-\d.]+)$/gm,
)].map(m => [m[1]!, Number(m[2])]));
const params = {
  nutAngle: pins["nut-angle"], yPivot: pins["y-pivot"], zPivot: pins["z-pivot"],
  xOffset: pins["x-offset"], yOffset: pins["y-offset"],
  yRotAxis: pins["y-rot-axis"], zRotAxis: pins["z-rot-axis"],
};
const machine: CollisionMachine & PartFrameMachine = {
  ...mj, unitScale: 1, axes: ["X", "Y", "Z", "A", "B", "C"],
  kins: { type: "xyzacb-trsrn", identityFirst: false, trsrn: params },
};
function stl(file: string): Float32Array {
  const data = fs.readFileSync(path.join(DIR, file));
  if (data.subarray(0, 7).toString() === "version") throw new Error(`Run git lfs pull: ${file}`);
  const n = data.readUInt32LE(80);
  expect(n).toBeGreaterThan(0);
  expect(data.length).toBe(84 + n * 50);
  const pos = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) for (let v = 0; v < 9; v++) {
    const x = data.readFloatLE(84 + i * 50 + 12 + v * 4);
    if (!Number.isFinite(x)) throw new Error(`Non-finite vertex: ${file}`);
    pos[i * 9 + v] = x;
  }
  return pos;
}
const bodies: CollisionBody[] = mj.parts.map((p: any) => ({
  ...p, group: p.group ?? "root", positions: stl(p.file),
}));
const chain = buildChain(machine);
const tmp = new Vector3();

function bodyBounds(id: string, q: number[], select = (_p: Vector3) => true): Box3 {
  evalChainTip(chain, q, [], tmp);
  const body = bodies.find(b => b.id === id)!;
  const node = chain.nodes.find(n => n.id === body.group);
  const box = new Box3();
  for (let i = 0; i < body.positions.length; i += 3) {
    tmp.fromArray(body.positions, i);
    if (node) tmp.applyMatrix4(node.world);
    if (select(tmp)) box.expandByPoint(tmp);
  }
  return box;
}

describe("TWP wall-gantry configuration", () => {
  it("ships its own state/model and the complete seven-pin geometry", () => {
    expect(pins).toEqual({ "nut-angle": 45, "y-pivot": 140, "z-pivot": 480,
      "x-offset": 0, "y-offset": 0, "y-rot-axis": 140, "z-rot-axis": -1325 });
    expect(setting("DISPLAY", "WEBUI_MACHINE_DIR")).toBe("machine-xyzacb-gantry");
    expect(setting("RS274NGC", "PARAMETER_FILE")).toBe("sim_twp_gantry.var");
    expect(setting("EMCIO", "TOOL_TABLE")).toBe("tool_twp_gantry.tbl");
    for (const [sec, key] of [["RS274NGC", "PARAMETER_FILE"], ["EMCIO", "TOOL_TABLE"]])
      expect(fs.existsSync(path.join(SIM, setting(sec!, key!)))).toBe(true);
    expect(bodies).toHaveLength(32);
    expect(bodies.filter(p => p.stock).map(p => p.id)).toEqual(["work_piece"]);
    expect(bodies.some(p => p.id === "x_rail_seats")).toBe(false);
  });

  it("keeps homing legal and axis/joint windows paired", () => {
    expect(limits).toEqual([[-1500, 1500], [-1300, 1300], [-1325, 0.01],
      [-360, 360], [-185, 185], [-320, 320]]);
    for (const [j, letter] of machine.axes.entries()) {
      expect(["MIN_LIMIT", "MAX_LIMIT"].map(k => Number(setting(`AXIS_${letter}`, k))))
        .toEqual(limits[j]);
      const home = Number(setting(`JOINT_${j}`, "HOME"));
      expect(home).toBeGreaterThan(limits[j]![0]!);
      expect(home).toBeLessThan(limits[j]![1]!);
    }
    expect(setting("HAL", "POSTGUI_HALFILE")).toBe("hallib/limit_window.hal");
  });

  it("fits the SRG100 guides, saddle plates and carriage without losing symmetry", () => {
    const q = [0, 0, 0, 0, 0, 0];
    const lane = (p: Vector3) => p.y < -2550;
    const rail = bodyBounds("x_guide_rails", q, lane);
    const block = bodyBounds("x_guide_blocks", q, lane);
    expect(rail.max.y - rail.min.y).toBe(100);
    expect(rail.max.z - rail.min.z).toBe(77);
    expect(block.max.y - block.min.y).toBe(250);
    expect(block.max.z - rail.min.z).toBe(120);
    const plates = bodyBounds("x_saddle_plates", q);
    const beam = bodyBounds("x_bridge_casting", q);
    const blocks = bodyBounds("x_guide_blocks", q);
    expect(plates.min.z).toBe(blocks.max.z);
    expect(beam.min.z).toBe(plates.max.z);
    expect(plates.max.z - plates.min.z).toBe(200);
    const centre = (b: Box3) => (b.min.x + b.max.x) / 2;
    expect(centre(plates)).toBeCloseTo(centre(beam), 4);
    expect(centre(plates)).toBeCloseTo(centre(blocks), 4);
    expect(plates.min.y + plates.max.y).toBe(0);
    const carriage = bodyBounds("y_carriage", q);
    expect(carriage.max.x - carriage.min.x).toBe(220);
    expect(carriage.max.y - carriage.min.y).toBe(1020);
    expect(bodyBounds("y_guide_blocks", q).max.x).toBe(carriage.min.x);
    expect(bodyBounds("z_guide_blocks", q).min.x).toBe(carriage.max.x);
  });

  it("keeps the longer blocks fully supported across the existing linear travels", () => {
    for (const [j, axis] of ["x", "y", "z"].entries()) {
      for (const value of limits[j]!) {
        const q = [0, 0, 0, 0, 0, 0];
        q[j] = value;
        const rails = bodyBounds(`${axis}_guide_rails`, q);
        const blocks = bodyBounds(`${axis}_guide_blocks`, q)
          .union(bodyBounds(`${axis}_guide_endcaps`, q));
        const near = blocks.min.getComponent(j) - rails.min.getComponent(j);
        const far = rails.max.getComponent(j) - blocks.max.getComponent(j);
        expect(near, `${axis}=${value}: start engagement`).toBeGreaterThan(27);
        expect(far, `${axis}=${value}: end engagement`).toBeGreaterThan(27);
      }
    }
  });

  it("centres the ram at Y0 and preserves the intentional neutral tool offset", () => {
    const tip = evalChainTip(chain, [0, 0, 0, 0, 0, 0], [], tmp).clone();
    const c = new Vector3().setFromMatrixPosition(chain.nodes.find(n => n.id === "c_swivel")!.world);
    expect(c.y).toBe(0);
    expect(tip.toArray()).toEqual([-1000, -140, 1325]);
    expect(tip.y - c.y).toBe(-140);
    for (let j = 0; j < 3; j++) expect(mj.kinematics.find((k: any) => k.joint === j))
      .toMatchObject({ group: ["x_bridge", "y_saddle", "xyz_head"][j], sign: 1 });
    const vars = Object.fromEntries(fs.readFileSync(path.join(SIM, "sim_twp_gantry.var"), "utf8")
      .trim().split("\n").map(s => s.trim().split(/\s+/).map(Number)));
    // G54 is the centre of the stock's top at A0, expressed in machine coords.
    expect([vars[5221], vars[5222], vars[5223]]).toEqual([-100, 140, -725]);
  });

  it("matches the oracle-backed TCP kinematics over 303 poses, zero tool length", () => {
    const kins = new TrsrnKins(1, params);
    let seed = 14048045;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    const poses = [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 90, 0], [0, 0, 0, 0, 0, 90],
      ...Array.from({ length: 300 }, () => limits.map(([lo, hi]) => lo! + random() * (hi! - lo!)))];
    for (const q of poses) {
      const actual = tipInWorkFrame(chain, q, [], tmp).toArray();
      const expected = kins.forward(q, []);
      for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i]!, 8);
    }
  });

  it("bounds continuous wall clearance for every B/C angle and full Y travel", () => {
    evalChainTip(chain, [0, 0, 0, 0, 0, 0], [], tmp);
    const pivot = new Vector3().setFromMatrixPosition(chain.nodes.find(n => n.id === "c_swivel")!.world);
    const wall = bodies.find(b => b.id === "x_side_walls")!;
    let inner = Infinity, wallMin = Infinity, wallMax = -Infinity;
    for (let i = 0; i < wall.positions.length; i += 3) {
      inner = Math.min(inner, Math.abs(wall.positions[i + 1]!));
      wallMin = Math.min(wallMin, wall.positions[i + 2]!);
      wallMax = Math.max(wallMax, wall.positions[i + 2]!);
    }
    expect(inner).toBeCloseTo(2110, 3);
    expect(wallMax - wallMin).toBeCloseTo(3075, 3);
    let radius = Math.hypot(140 + 7, 480 + 200); // entire 200 mm, diameter 14 tool
    for (const b of bodies) {
      const node = chain.nodes.find(n => n.id === b.group);
      if (!node || ["a_table", "a_work", "x_bridge"].includes(b.group)) continue;
      for (let i = 0; i < b.positions.length; i += 3) {
        tmp.fromArray(b.positions, i).applyMatrix4(node.world).sub(pivot);
        const rotary = ["b_nut", "c_swivel"].includes(b.group);
        radius = Math.max(radius, (rotary ? tmp.length() : Math.abs(tmp.y)) + 1.3);
      }
    }
    const left = inner + limits[1]![0]! - radius;
    const right = inner - limits[1]![1]! - radius;
    expect(left).toBeCloseTo(right, 8);
    expect(left).toBeGreaterThan(114);
  });

  it("keeps both head halves in disjoint half-spaces for every B angle", () => {
    // Dot(n, p) is invariant under rotation about B's n axis. This proves
    // separation continuously, including the bearing pairs the current BVH
    // reports as baseline contacts at these close diagonal faces.
    const normal = new Vector3(0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4));
    for (const id of ["c_head", "b_head", "b_joint_ring", "spindle_nose"]) {
      const b = bodies.find(p => p.id === id)!;
      const sign = id === "c_head" ? 1 : -1;
      for (let i = 0; i < b.positions.length; i += 3)
        expect(sign * tmp.fromArray(b.positions, i).dot(normal)).toBeGreaterThan(1.9999);
    }
  });
});

function track(points: number[][]): ScrubTrack {
  const n = points.length;
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1]! + Math.max(
    ...points[i]!.map((p, j) => Math.abs(p - points[i - 1]![j]!)));
  return { pos: new Float32Array(points.flatMap(p => p.slice(0, 3))),
    abc: new Float32Array(points.flatMap(p => p.slice(3))), cum, count: n,
    lines: new Uint32Array(points.map((_, i) => i + 1)), rapid: new Uint8Array(n),
    lineIndex: emptyLineIndex(), timeBased: false };
}

it("sweeps linear limits and parked rotary moves without machine self-collisions", { timeout: 300_000 }, () => {
  // Index at the top, descend to the floor in the clear area beside the stock.
  // This is an intended motion sequence, not a claim that the whole six-axis
  // travel hypercube clears the fixture. Program collisions remain meaningful.
  const points = [[0, 0, 0, 0, 0, 0], [0, 0, 0, 90, 90, 90],
    [0, 0, 0, 0, 180, 180], [0, 0, 0, 0, 0, 0],
    [-1500, 0, 0, 0, 0, 0], [1500, 0, 0, 0, 0, 0],
    [0, -1300, 0, 0, 0, 0], [0, 1300, 0, 0, 0, 0],
    [0, 1000, 0, 0, 0, 0], [0, 1000, -1325, 0, 0, 0],
    [0, 1000, 0, 0, 0, 0], [0, 140, -475, 0, 0, 0], [0, 140, 0, 0, 0, 0]];
  const result = sweepCollisions(buildCollisionModel(machine, bodies), track(points),
    { g5x: [], g92: [], rotationDeg: 0 }, { margin: 2, maxSamples: 400_000 });
  const allowed = new Set(["a_bearing_ring/a_faceplate", "c_head/c_mount_ring",
    "b_head/c_head", "b_joint_ring/c_head", // independently bounded above
    ...["x", "y", "z"].flatMap(a => [`${a}_guide_blocks/${a}_guide_rails`, `${a}_guide_endcaps/${a}_guide_rails`])]);
  expect(result.staticContacts.map(p => [p.a, p.b].sort().join("/"))
    .filter(p => !allowed.has(p))).toEqual([]);
  expect(result.hits.map(h => `L${h.line} ${h.a}/${h.b} d=${h.dist}`)).toEqual([]);
  expect(result.coarsened).toBe(false);
  expect(result.uncertified).toBeNull();
});
