import { ContactStore } from "@src/contactStore";
import { Prog, MACHINE, WCS, box, buildCollisionModel, toolCylinderPositions } from "./lib";
import { sweepCollisionsIter } from "@coll";
import { fs } from "./fedpath2";
(globalThis as any).__RULE = "S";
const p = new Prog(); p.g0({ x: 50, y: 30, z: 30 });
for (let i = 0; i < 1100; i++) p.g1({ z: 30 + i % 2 });
p.g0({ z: -6 });
const track = p.track();
const digest = (st: ContactStore) => JSON.stringify([st.episodes, st.intervals, st.gaps].map(t => Array.from({ length: t.rows }, (_, r) => Object.keys((t as any).cols ?? {}).map(c => (t as any).get(r, c)))));
for (const pairs of [1, 4, 16, 64]) {
  const model = buildCollisionModel(MACHINE, [...Array.from({ length: pairs }, (_, i) => ({ id: "stock" + i, group: "table", positions: box(-10, 110, -10, 70, -30, 0), stock: true })), { id: "tool", group: "tool", positions: toolCylinderPositions(6, 60), tool: true }] as any);
  const rows: string[] = [];
  for (const check of [false, true]) for (const yieldMs of [0, 8, 1e9]) {
    (globalThis as any).__HCHECK = check; fs.asks = fs.steps = fs.maxSteps = 0;
    const st = new ContactStore(1, 0);
    let yields = 0, maxAsks = 0, maxSteps = 0, maxMs = 0;
    const it = sweepCollisionsIter(model, track as any, WCS as any, { margin: 2, yieldMs, contacts: { store: st } } as any);
    for (;;) {
      const a = fs.asks, s = fs.steps, t = performance.now(), r = it.next(), ms = performance.now() - t;
      maxAsks = Math.max(maxAsks, fs.asks - a); maxSteps = Math.max(maxSteps, fs.steps - s); maxMs = Math.max(maxMs, ms);
      if (r.done) { rows.push(digest(st) + st.episodes.rows + "/" + st.intervals.rows); console.log(JSON.stringify({ pairs, check, yieldMs, yields, maxAsks, maxSteps, maxMs: +maxMs.toFixed(1), asks: fs.asks, steps: fs.steps, ep: st.episodes.rows, iv: st.intervals.rows })); break; }
      yields++;
    }
  }
  console.log("  rows equal in all six:", new Set(rows).size === 1);
}
