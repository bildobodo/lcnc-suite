// pin (Ø3) against the stepped body (Ø3 flutes 10 long, Ø6 above) on random programs: which pin findings (rapid intervals) has the body no interval for?
import * as THREE from "three";
import { buildCollisionModel, sweepCollisions, toolCylinderPositions, boxPositions, MACHINE, ContactStore } from "./lib";
import { rng } from "@src/collisionFixtures";
const lathe = (prof: [number, number][]) => { const g = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 20); g.rotateX(Math.PI / 2); const n = g.toNonIndexed(); return new Float32Array(n.getAttribute("position").array as Float32Array); };
const hull = lathe([[0, 0], [1.5, 0], [1.5, 10], [3, 10], [3, 40], [0, 40]]);
const pin = toolCylinderPositions(3, 40);
console.warn = () => {};
const SEEDS = Number(process.env.SEEDS ?? 300);
for (const [label, zmin] of [["tip at most 9.5 deep (shank above the stock)", -9.5], ["tip to 19 deep (shank in the stock)", -19]] as const) {
  let pinN = 0, miss = 0, missReal = 0, missOwn = 0; const ex: string[] = [];
  for (const seed of [67]) {
    const R = rng(seed * 31 + 7);
    const pts: number[][] = [[R() * 56 - 8, R() * 56 - 8, 6]]; const rapid = [1];
    const n = 10 + Math.floor(R() * 8);
    for (let i = 1; i < n; i++) {
      const p = pts[i - 1]!.slice(), k = R();
      if (k < 0.45) p[2] = R() < 0.5 ? R() * 7 : zmin * R(); else if (k < 0.75) p[0] = R() * 56 - 8; else if (k < 0.85) p[1] = R() * 56 - 8;
      else if (k < 0.93) { const q = pts[Math.max(0, i - 2)]!; p[0] = q[0]!; p[1] = q[1]!; p[2] = q[2]!; } else { p[0] = R() * 56 - 8; p[1] = R() * 56 - 8; p[2] = Math.max(zmin, R() * 14 - 8); }
      pts.push(p.map(v => Math.round(v * 1000) / 1000)); rapid.push(R() < 0.55 ? 1 : 0);
    }
    const N = pts.length, pos = new Float32Array(pts.flat()), cum = new Float32Array(N);
    for (let i = 1; i < N; i++) cum[i] = cum[i - 1]! + Math.hypot(pos[i * 3]! - pos[i * 3 - 3]!, pos[i * 3 + 1]! - pos[i * 3 - 2]!, pos[i * 3 + 2]! - pos[i * 3 - 1]!);
    const track: any = { pos, abc: new Float32Array(N * 3), lines: Uint32Array.from(pts.map((_, i) => i + 1)), rapid: Uint8Array.from(rapid), cum, count: N };
    const run = (rule: string, tool: Float32Array) => {
      (globalThis as any).__RULE = rule;
      const model = buildCollisionModel(MACHINE, [{ id: "stock", group: "table", positions: boxPositions(40, 40, 24, 20, 20, -12), stock: true }, { id: "tool", group: "tool", positions: tool, tool: true }]);
      const st = new ContactStore(1, 0);
      sweepCollisions(model, track, { g5x: [0, 0, 0, 0, 0, 0], g92: [0, 0, 0, 0, 0, 0], rotationDeg: 0, tool: [0, 0, 0] } as any, { margin: 2, contacts: { store: st } });
      return Array.from({ length: st.intervals.rows }, (_, k) => [st.intervals.get(k, "enter"), Number.isNaN(st.intervals.get(k, "exit")) ? cum[N - 1]! : st.intervals.get(k, "exit")] as const);
    };
    const hit = (l: readonly (readonly [number, number])[], x: number, y: number) => l.some(([u, v]) => u <= y + 0.01 && v >= x - 0.01);
    const a = run("R0", pin), b = run("C", hull), p = run("C", pin), pa = run("A", pin);
    console.log(JSON.stringify({case:label,seed,pts,rapid,oldPin:a,body:b,newPin:p,plainPin:pa})); pinN += a.length;
    for (const [x, y] of a) if (!hit(b, x, y)) { miss++; if (hit(p, x, y)) { missReal++; if (ex.length < 4) ex.push(`seed ${seed} ${x.toFixed(2)}..${y.toFixed(2)}`); } else if (hit(pa, x, y)) missOwn++; }
  }
  console.log(`${label}: today's pin ${pinN} intervals; not covered by the body under A + H: ${miss} — of these a rapid touch the contract reports for the pin too: ${missReal}, excused as own hole: ${missOwn}, neither (today's false ones): ${miss - missReal - missOwn}  ${ex.join("; ")}`);
}
