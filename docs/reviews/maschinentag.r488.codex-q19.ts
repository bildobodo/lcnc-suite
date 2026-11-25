// an OPEN stock with a notch: fed out into the notch (> 2 x margin clear, inside the whole box), rapid into the step; R0 against A / S; and are the shipped stock bodies open?
import { readFileSync } from "node:fs";
import { Prog, sweep, boxPositions, MACHINE, buildCollisionModel } from "./lib";
import { partCollisionFile } from "@coll";
import { parseBinSTL, shippedCases } from "@src/collisionFixtures";
console.warn = () => {};
const at = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => boxPositions(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2 + 200, (y0 + y1) / 2 + 150, (z0 + z1) / 2 - 100);
const join = (...a: Float32Array[]) => Float32Array.from(a.flatMap(x => [...x]));
// a 120 x 80 block with a notch x 60..110 above z -20: two boxes (low slab, high block)
const two = join(at(-10, 60, -10, 70, -30, 0), at(60, 110, -10, 70, -30, -20));
// the same block as ONE closed solid (an L extruded along Y), and it with one facet missing
const L2 = [[-10, -30], [110, -30], [110, -20], [60, -20], [60, 0], [-10, 0]] as const;   // x, z, counter-clockwise
const ell = (() => { const o: number[] = []; const v = (k: number, y: number) => [L2[k]![0] + 200, y + 150, L2[k]![1] - 100]; const tri = (a: number[], b: number[], c: number[]) => o.push(...a, ...b, ...c);
  for (let k = 0; k < 6; k++) { const n = (k + 1) % 6; tri(v(k, -10), v(n, -10), v(n, 70)); tri(v(k, -10), v(n, 70), v(k, 70)); }
  const cap = [[0, 1, 2], [0, 2, 3], [0, 3, 5], [3, 4, 5]]; for (const [a, b, c] of cap) { tri(v(a!, -10), v(c!, -10), v(b!, -10)); tri(v(a!, 70), v(b!, 70), v(c!, 70)); } return Float32Array.from(o); })();
const run = (stock: Float32Array, p: Prog, o: any = {}) => [["R0", ""], ["S", ""], ["S", "U"]].map(([r, u]) => { (globalThis as any).__RULE = r; (globalThis as any).__OPEN = u; const x = sweep(p.track(), { stock, ...o }); return `${r}${u ? "+U" : ""} ${JSON.stringify(x.by).replace(/"/g, "")}`; }).join(" | ");
const closed = (s: Float32Array) => buildCollisionModel(MACHINE, [{ id: "s", group: "table", positions: s, stock: true }]).bodies[0]!.insideClosed;
for (const [label, stock] of [["L as one solid", ell], ["L, one facet missing", ell.slice(9)], ["two boxes that share a face", two]] as const) {
  console.log(`-- ${label}: closed ${closed(stock)}`);
  for (const clear of [1, 3, 8, 20]) { const p = new Prog(); p.g0({ x: 30, y: 30, z: 15 }).g0({ z: 5 }).g1({ z: -8 }).g1({ x: 63 + clear }).g0({ y: 40 }).g0({ x: 40 }).g0({ z: 15 }); console.log(`   fed out ${clear} clear into the notch, rapid back beside: ${run(stock, p)}`); }
  const q = new Prog(); q.g0({ x: 30, y: 30, z: 15 }).g0({ z: 5 }).g1({ z: -15 }).g0({ x: 40 }).g0({ z: 15 }); console.log(`   a short tool (5) fed wholly inside, rapid sideways, rapid up out: ${run(stock, q, { toolL: 5 })}`);
}
const ROOT = "/tmp/r487/base/";
for (const d of ["examples/sim_config/machine-5axis-xyzac", "examples/sim_config/machine-xyzacb-gantry", "scripts/test_fixtures/legacy_sim/machine-xyzacb-trsrn"]) {
  const mj = JSON.parse(readFileSync(ROOT + d + "/machine.json", "utf8"));
  for (const q of mj.parts.filter((p: any) => p.stock)) { const m = buildCollisionModel(MACHINE, [{ id: q.id, group: "table", positions: parseBinSTL(new Uint8Array(readFileSync(`${ROOT}${d}/${partCollisionFile(q)}`))), stock: true }]); console.log(`${d}: stock ${q.id}: ${m.bodies[0]!.geom.attributes.position!.count / 3} facets, closed ${m.bodies[0]!.insideClosed}, open list ${JSON.stringify(m.open)}`); }
}
