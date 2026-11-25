import * as THREE from "three";
import { Prog, sweep, MACHINE, WCS, box, boxPositions, buildCollisionModel, sweepCollisions, toolCylinderPositions, ContactStore } from "./lib";
import { pairDistance, pairInside } from "@coll";
import { rng } from "@src/collisionFixtures";
import { fedOver, fs, CAP } from "./fedpath2";
const run = (p: Prog | any, o: any = {}) => ["A", "S"].map(r => { (globalThis as any).__RULE = r; const x = sweep(p instanceof Prog ? p.track() : p, { stock: [-10, 110, -10, 70, -30, 0], ...o }); return `${r} ${JSON.stringify(x.by).replace(/"/g, "")}`; }).join(" | ");
console.log("== MT484-02: lateral offset of the re-entry");
for (const dx of [0, 0.00005, 0.0015, 0.0021, 0.02]) { const p = new Prog(); p.g0({ x: 50, y: 30, z: 15 }).g0({ z: 3 }).g1({ z: -6 }).g0({ z: 3 }).g0({ x: 50 + dx }).g0({ z: -5 }).g1({ z: -8 }).g0({ z: 15 }); const t = p.track(); console.log(`dx ${dx} stored ${t.pos[5 * 3] - t.pos[2 * 3]}: ${run(t)}`); }
console.log("== changes at points without length (a T/G43 row, a fixture, a relabel, an unknown start between the feed and the re-entry; and inside the rapid run)");
const base = () => { const p = new Prog(); p.g0({ x: 50, y: 30, z: 15 }).g0({ z: 3 }).g1({ z: -6 }).g0({ z: 3 }); return p; };
for (const where of ["back", "forward"]) for (const kind of ["none", "tlo", "wcs", "mode", "frame", "brk", "ustart", "band", "unpredicted", "abc"]) {
  const p = base();
  if (where === "back") p.g0({}).g0({ z: -5 }).g1({ z: -8 }).g0({ z: 15 });
  else p.g0({ z: -3 }).g0({}).g0({ z: -5 }).g1({ z: -8 }).g0({ z: 15 });
  const t = p.track(); const z = where === "back" ? 4 : 5;   // the zero-length point
  const n = t.count, u8 = () => new Uint8Array(n), u32 = () => new Uint32Array(n);
  if (kind === "tlo") { t.tlo = u32(); t.tlo.fill(1, z); } if (kind === "wcs") { t.wcs = u32(); t.wcs.fill(1, z); } if (kind === "mode") { t.mode = u8(); t.mode.fill(1, z); } if (kind === "frame") { t.frame = u32(); t.frame.fill(1, z); }
  if (kind === "brk" || kind === "ustart") { t.brk = u8(); t.brk[z] = 1; } if (kind === "ustart") { t.ustart = u8(); t.ustart[z] = 1; } if (kind === "band") { t.band = u8(); t.band[z] = 1; } if (kind === "unpredicted") { t.unpredicted = u8(); t.unpredicted[z] = 1; }
  if (kind === "abc") for (let i = z; i < n; i++) t.abc[i * 3] = 1e-5;
  const seg = where === "back" ? 5 : 4;
  const u = where === "back" ? 0.3 : 0.4;   // a pose above the top on the rapid
  console.log(`${where} ${kind.padEnd(11)} fedOver ${fedOver(t, seg, u)}`);
}
console.log("== the top bound is one-sided: the feed starts below the free side of the bracket");
for (const z0 of [0.5, 0.0005, 0, -0.0005]) { const p = new Prog(); p.g0({ x: 50, y: 30, z: 15 }).g0({ z: 3 }).g0({ z: z0 }).g1({ z: -6 }).g0({ z: 3 }).g0({ z: -5 }).g1({ z: -8 }).g0({ z: 15 }); console.log(`the hole fed from ${z0}: ${run(p)}`); }
console.log("== analytic 1-D reference (independent of the sweep and of fedOver): random moves on one line, full interval union in integers");
{
  let pos = 0, posHit = 0, neg = 0, unsound = 0, missed = 0;
  for (let seed = 1; seed <= 20000; seed++) {
    const R = rng(seed), n = 4 + Math.floor(R() * 14); const z: number[] = [20], rapid: number[] = [1];
    for (let i = 1; i < n; i++) { z.push(Math.floor(R() * 41) - 20); rapid.push(R() < 0.5 ? 1 : 0); }
    const segs = []; for (let i = 1; i < n; i++) if (rapid[i] && z[i]! < z[i - 1]!) segs.push(i);
    if (!segs.length) continue;
    const seg = segs[Math.floor(R() * segs.length)]!, L = z[seg - 1]! - z[seg]!, a = Math.floor(R() * L), u = a / L;   // the pose a below the start, an integer height
    const t: any = { pos: new Float32Array(n * 3), abc: new Float32Array(n * 3), rapid: Uint8Array.from(rapid), count: n };
    for (let i = 0; i < n; i++) t.pos[i * 3 + 2] = z[i]!;
    const top = z[seg - 1]! - a; let low = z[seg]!; for (let i = seg + 1; i < n && rapid[i]; i++) low = Math.min(low, z[i]!);
    // unit cells [c, c+1): covered by an earlier feed?
    const cov = new Set<number>(); for (let i = 1; i < seg; i++) if (!rapid[i]) for (let c = Math.min(z[i]!, z[i - 1]!); c < Math.max(z[i]!, z[i - 1]!); c++) cov.add(c);
    let want = top > low; for (let c = low; c < top; c++) if (!cov.has(c)) want = false;
    const got = fedOver(t, seg, u);
    if (want) { pos++; if (got) posHit++; else missed++; } else { neg++; if (got) unsound++; }
  }
  console.log(`positive ${pos}: excused ${posHit}, refused ${missed} (the greedy union drops an interval that does not meet it yet: conservative); negative ${neg}: excused ${unsound}`);
}
console.log("== MT484-01: open stock (no top facets), closed tool 2 x 2 x 60 from z -5 (through the opening)");
const tris = (p: Float32Array) => Array.from({ length: p.length / 9 }, (_, i) => Array.from(p.slice(i * 9, i * 9 + 9)));
const openStock = Float32Array.from(tris(boxPositions(20, 20, 30, 0, 0, -15)).filter(t => !(t[2] === 0 && t[5] === 0 && t[8] === 0)).flat());
const apart = (A: any, B: any) => { for (const [P, Q] of [[A, B], [B, A]]) { if (Q.insideClosed) continue; const rel = new THREE.Matrix4().copy(Q.world).invert().multiply(P.world); if (P.geom.boundingBox.clone().applyMatrix4(rel).intersectsBox(Q.geom.boundingBox)) return false; } return true; };
for (const [label, dz] of [["5 deep through the opening", 0], ["wholly above (0.5)", 5.5], ["touching the open rim's plane", 5]] as const) {
  const seen = new Set<string>();
  for (let s = 0; s < 40; s++) {
    const R = rng(s + 1), ts = tris(boxPositions(2, 2, 60, 0, 0, 25 + dz)); for (let i = ts.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [ts[i], ts[j]] = [ts[j]!, ts[i]!]; }
    const so = tris(openStock); for (let i = so.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [so[i], so[j]] = [so[j]!, so[i]!]; }
    const m = buildCollisionModel(MACHINE, [{ id: "stock", group: "table", positions: Float32Array.from(so.flat()), stock: true }, { id: "tool", group: "tool", positions: Float32Array.from(ts.flat()), tool: true }]);
    const a = m.bodies[0]!, b = m.bodies[1]!; a.world.identity(); b.world.identity();
    seen.add(`apart ${apart(a, b)} distance ${pairDistance(a, b, 100, 2).toFixed(2)} inside ${pairInside(a, b)}`);
  }
  console.log(`${label}: 40 facet orders of both bodies: ${[...seen].join(" / ")}`);
}
{
  // the sweep over it: feed through the opening, rapid up and beside, rapid in
  const st = (o: boolean) => { const g = boxPositions(120, 80, 30, 50 + 200, 30 + 150, -15 - 100); return o ? Float32Array.from(tris(g).filter(t => !(t[2] === -100 && t[5] === -100 && t[8] === -100)).flat()) : g; };
  for (const o of [false, true]) { const p = new Prog(); p.g0({ x: 50, y: 30, z: 15 }).g0({ z: 5 }).g1({ z: -5 }).g0({ z: 5 }).g0({ x: 60 }).g0({ z: -5 }).g0({ z: 15 }); console.log(`${o ? "open" : "closed"} stock, feed in, rapid out 5 above, rapid in beside: ${run(p, { stock: st(o) })}`);
    const q = new Prog(); q.g0({ x: 50, y: 30, z: 15 }).g0({ z: 5 }).g1({ x: 112, z: -5 }).g1({ x: 114 }).g0({ x: 90 }).g0({ z: 15 }); console.log(`${o ? "open" : "closed"} stock, feed out of the side 1 free (boxes: beside the stock), rapid back: ${run(q, { stock: st(o) })}`); }
}
console.log("== cost of one ask");
{
  const N = 400_000, t: any = { pos: new Float32Array(N * 3), abc: new Float32Array(N * 3), rapid: new Uint8Array(N), count: N };
  // worst case back: one line, never off it, no earlier feed ever reaches the rapid's depth: the whole CAP is read, then refused
  const Z = [-1, -2, 5, -10], RP = [1, 0, 1, 1];
  for (let i = 0; i < N; i++) { t.pos[i * 3 + 2] = Z[i % 4]!; t.rapid[i] = RP[i % 4]!; }
  const bench = (label: string, segs: (k: number) => number, n: number) => {
    const times: number[] = []; fs.asks = fs.steps = fs.maxSteps = 0; let yes = 0;
    for (let k = 0; k < n; k++) { const t0 = performance.now(); if (fedOver(t, segs(k), 0)) yes++; times.push(performance.now() - t0); }
    times.sort((a, b) => a - b);
    console.log(`${label}: ${n} asks (${yes} excused), median ${(times[n >> 1]! * 1000).toFixed(0)} µs, p99 ${(times[Math.floor(n * 0.99)]! * 1000).toFixed(0)} µs, max ${(times[n - 1]! * 1000).toFixed(0)} µs, steps ${(fs.steps / fs.asks).toFixed(0)} (max ${fs.maxSteps})`);
  };
  bench(`cold: the first 200, back ${CAP}`, k => 20003 + 4 * k, 200);
  bench(`back ${CAP}`, k => 30003 + 4 * k, 20000);
  for (let i = 0; i < N; i++) t.rapid[i] = 1;
  bench(`forward ${CAP} (all rapid, refused)`, k => 10003 + 4 * k, 5000);
}
