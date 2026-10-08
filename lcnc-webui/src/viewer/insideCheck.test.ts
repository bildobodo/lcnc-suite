// The inside check's contract (collision-inside.plan.md Fassung 2, step 1):
// Codex R96's counter-probes — a ray along a box's shared edge (plain hit
// parity said "outside" three times over), a rotated slab wholly inside a box
// (an inflated transformed box filter rejected it) — the hollow body, the
// closure test, and the rays held to the winding number on analytic shapes
// and on every closed body of the shipped models.
import * as fs from "node:fs";
import * as path from "node:path";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { describe, expect, it } from "vitest";
import { componentBoxes, partCollides, partCollisionFile } from "./collision";
import { inLocalBoxes, meshClosure, pointInside, rayVerdict, RAY_DIRS, windingNumber } from "./insideCheck";

const ROOT = path.resolve(__dirname, "../../..");

function boxSoup(w: number, h: number, d: number, at: [number, number, number] = [0, 0, 0], flip = false): Float32Array {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(...at);
  const p = new Float32Array(g.getAttribute("position").array);
  g.dispose();
  if (flip) for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]!; p[i + 3 + k] = p[i + 6 + k]!; p[i + 6 + k] = t; }
  return p;
}
function concat(...a: Float32Array[]): Float32Array {
  const out = new Float32Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of a) { out.set(x, o); o += x.length; }
  return out;
}
function body(pos: Float32Array) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(pos.slice(), 3));
  const bvh = new MeshBVH(geom);
  geom.computeBoundingBox();
  const scale = geom.boundingBox!.getSize(new THREE.Vector3()).length();
  return { geom, bvh, scale, pos };
}
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe("the inside check's contract", () => {
  it("a ray along a box's shared edge is degenerate, never a parity (Codex R96 VP96-02)", () => {
    const b = body(boxSoup(2, 2, 2));
    const codex = [v(1, 1, 0.213), v(0.317, 1, 1), v(1, 0.411, 1)].map(d => d.normalize());
    for (const d of codex) expect(rayVerdict(b.bvh, b.geom, v(0, 0, 0), d, b.scale), `${d.toArray()}`).toBeNull();
    // all of them degenerate: undecidable — never "outside"
    expect(pointInside(b.bvh, b.geom, v(0, 0, 0), b.scale, codex)).toBe("undecidable");
    // the fixed directions decide it
    expect(pointInside(b.bvh, b.geom, v(0, 0, 0), b.scale)).toBe("inside");
    expect(pointInside(b.bvh, b.geom, v(3, 0.2, 0.1), b.scale)).toBe("outside");
    expect(windingNumber(b.pos, v(0, 0, 0))).toBeCloseTo(1, 9);
    expect(windingNumber(b.pos, v(3, 0.2, 0.1))).toBeCloseTo(0, 9);
  });

  it("each degeneracy rule stands on its own", () => {
    // a single triangle hit exactly on its edge: one hit, barycentric 0
    const tri = new Float32Array([0, -1, -1, 0, 1, -1, 0, 0, 1]);
    const t = body(tri);
    expect(rayVerdict(t.bvh, t.geom, v(-1, 0, -1), v(1, 0, 0), t.scale), "an edge hit").toBeNull();
    expect(rayVerdict(t.bvh, t.geom, v(-1, 0, 0), v(1, 0, 0), t.scale), "an interior hit").toBe("inside");
    // the same face twice: two interior hits at one distance
    const twice = body(concat(tri, tri));
    expect(rayVerdict(twice.bvh, twice.geom, v(-1, 0, 0), v(1, 0, 0), twice.scale), "two hits at one place").toBeNull();
    // a ray almost in the face's plane (|cos| ≈ 1e-7) crosses it in its
    // interior, but its crossing point is a matter of rounding: degenerate
    expect(rayVerdict(t.bvh, t.geom, v(-5e-8, -0.5, 0), v(1e-7, 1, 0).normalize(), t.scale), "a grazing hit").toBeNull();
    // the fixed directions: unit length, off every axis, pairwise far apart
    for (const d of RAY_DIRS) {
      expect(d.length()).toBeCloseTo(1, 9);
      expect(Math.min(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z))).toBeGreaterThan(0.1);
    }
    for (let i = 0; i < RAY_DIRS.length; i++) for (let j = i + 1; j < RAY_DIRS.length; j++)
      expect(Math.abs(RAY_DIRS[i]!.dot(RAY_DIRS[j]!))).toBeLessThan(0.9);
  });

  it("a hollow body: the cavity is outside, the wall inside — rays and winding number agree", () => {
    const hollow = concat(boxSoup(4, 4, 4), boxSoup(2, 2, 2, [0, 0, 0], true));   // the inner shell faces in
    const b = body(hollow);
    expect(meshClosure(hollow).closed).toBe(true);
    expect(pointInside(b.bvh, b.geom, v(0.1, 0.2, 0.3), b.scale)).toBe("outside");       // in the cavity
    expect(windingNumber(hollow, v(0.1, 0.2, 0.3))).toBeCloseTo(0, 9);
    expect(pointInside(b.bvh, b.geom, v(1.5, 0.2, 0.3), b.scale)).toBe("inside");        // in the wall
    expect(windingNumber(hollow, v(1.5, 0.2, 0.3))).toBeCloseTo(1, 9);
    expect(pointInside(b.bvh, b.geom, v(2.5, 0.2, 0.3), b.scale)).toBe("outside");
  });

  it("two components: one vertex each, each decided by itself", () => {
    const two = concat(boxSoup(2, 2, 2), boxSoup(2, 2, 2, [5, 0, 0]));
    const c = meshClosure(two);
    expect([c.components, c.closed, c.repVerts.length]).toEqual([2, true, 6]);
    const b = body(two);
    expect(pointInside(b.bvh, b.geom, v(5.1, 0.2, -0.3), b.scale)).toBe("inside");
    expect(pointInside(b.bvh, b.geom, v(2.5, 0.2, -0.3), b.scale)).toBe("outside");
  });

  it("only a closed surface has an inside: a hole or a repeated edge is named", () => {
    const box = boxSoup(2, 2, 2);
    expect(meshClosure(box)).toMatchObject({ closed: true, open: 0, repeated: 0, components: 1 });
    const holed = box.slice(9);                       // one triangle missing
    expect(meshClosure(holed)).toMatchObject({ closed: false, open: 3 });
    const doubled = concat(box, box.slice(0, 9));     // one triangle twice
    expect(meshClosure(doubled).closed).toBe(false);
    expect(meshClosure(doubled).repeated).toBeGreaterThan(0);
  });

  it("the exclusion is a point in the container's local boxes, never an inflated transformed box (Codex R96 VP96-01)", () => {
    // A 2 × 0.2 × 0.2 slab turned +45° about Z in its own frame and posed at
    // −45°: wholly inside the ±1.05 box. Its local box, transformed, spans
    // ±1.1 in X and Y — a containment test of that box rejects it.
    const slab = boxSoup(2, 0.2, 0.2);
    const local = new THREE.Matrix4().makeRotationZ(Math.PI / 4), pose = new THREE.Matrix4().makeRotationZ(-Math.PI / 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(slab.slice(), 3));
    g.applyMatrix4(local);
    g.computeBoundingBox();
    const inflated = g.boundingBox!.clone().applyMatrix4(pose);
    const outer = new THREE.Box3(v(-1.05, -1.05, -1.05), v(1.05, 1.05, 1.05));
    expect(outer.containsBox(inflated), "the inflated box filter rejects a real inclusion").toBe(false);
    // the exact rule: the slab's representative vertex, posed into the
    // container's frame, lies in the container's local box
    const rep = meshClosure(slab).repVerts;
    const p = v(rep[0]!, rep[1]!, rep[2]!).applyMatrix4(local).applyMatrix4(pose);
    expect(inLocalBoxes(p, componentBoxes(boxSoup(2.1, 2.1, 2.1)))).toBe(true);
    expect(inLocalBoxes(v(1.2, 0, 0), componentBoxes(boxSoup(2.1, 2.1, 2.1)))).toBe(false);
  });
});

describe("the shipped models", () => {
  function parseBinSTL(buf: Buffer): Float32Array {
    const n = buf.readUInt32LE(80);
    const out = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) { const off = 84 + i * 50 + 12; for (let k = 0; k < 9; k++) out[i * 9 + k] = buf.readFloatLE(off + k * 4); }
    return out;
  }
  const MODELS = ["lcnc-gateway/machine", "examples/sim_config/machine-5axis-xyzac", "examples/sim_config/machine-xyzacb-gantry"];
  const bodies = (dir: string) => {
    const mj = JSON.parse(fs.readFileSync(path.join(ROOT, dir, "machine.json"), "utf8"));
    return mj.parts.filter(partCollides).map((p: any) => ({ id: p.id as string, pos: parseBinSTL(fs.readFileSync(path.join(ROOT, dir, partCollisionFile(p)))) }));
  };

  it("every collidable body is closed but the 3-axis model's frame, x_axis and y_axis", { timeout: 300_000 }, () => {
    const notClosed: string[] = [];
    for (const dir of MODELS) for (const b of bodies(dir)) if (!meshClosure(b.pos).closed) notClosed.push(`${path.basename(dir)}/${b.id}`);
    expect(notClosed.sort()).toEqual(["machine/frame", "machine/x_axis", "machine/y_axis"]);
  });

  it("on every closed body of the 5-axis and the gantry models the rays agree with the winding number", { timeout: 300_000 }, () => {
    // Deterministic points in each body's box; a ray verdict must match the
    // winding number's (|w − round(w)| < 0.25 decides it; none undecided by
    // the rays on these meshes).
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    let checked = 0, inside = 0;
    for (const dir of MODELS.slice(1)) for (const raw of bodies(dir)) {
      const b = body(raw.pos);
      const bb = b.geom.boundingBox!;
      for (let k = 0; k < 12; k++) {
        const p = v(bb.min.x + rnd() * (bb.max.x - bb.min.x), bb.min.y + rnd() * (bb.max.y - bb.min.y), bb.min.z + rnd() * (bb.max.z - bb.min.z));
        const w = windingNumber(raw.pos, p);
        if (Math.abs(w - Math.round(w)) >= 0.25) continue;      // the winding number cannot tell here
        const truth = Math.round(w) % 2 !== 0 ? "inside" : "outside";
        const got = pointInside(b.bvh, b.geom, p, b.scale);
        expect(got, `${raw.id} at ${p.toArray().map(x => x.toFixed(3))}: w = ${w.toFixed(4)}`).toBe(truth);
        checked++;
        if (got === "inside") inside++;
      }
    }
    expect(checked).toBeGreaterThan(400);
    expect(inside).toBeGreaterThan(50);
  });
});
