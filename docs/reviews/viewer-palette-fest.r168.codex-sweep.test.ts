import * as THREE from "three";
import { writeFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { buildCollisionModel, sweepCollisions, sweepCollisionsIter, type CollisionBody, type CollisionMachine } from "./collision";
import { ContactStore, IV_RAPID } from "./contactStore";
import { buildContactView, targetAt, targetKind, T_RAPID } from "./contactView";
import { emptyLineIndex } from "./lineIndex";
import type { ScrubTrack } from "../ws/bulkData";
const WCS0 = { g5x: [], g92: [], rotationDeg: 0 };
function boxPositions(size: number): Float32Array {
  const g = new THREE.BoxGeometry(size, size, size).toNonIndexed();
  const pos = new Float32Array(g.getAttribute("position").array as Float32Array);
  g.dispose();
  return pos;
}

function track(points: number[][], abc?: number[][], lines?: number[], rapid?: number[]): ScrubTrack {
  const n = points.length;
  const pos = new Float32Array(points.flat());
  const abcArr = new Float32Array((abc ?? points.map(() => [0, 0, 0])).flat());
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const j = i * 3, k = j - 3;
    const lin = Math.hypot(pos[j]! - pos[k]!, pos[j + 1]! - pos[k + 1]!, pos[j + 2]! - pos[k + 2]!);
    const rot = Math.max(
      Math.abs(abcArr[j]! - abcArr[k]!),
      Math.abs(abcArr[j + 1]! - abcArr[k + 1]!),
      Math.abs(abcArr[j + 2]! - abcArr[k + 2]!));
    cum[i] = cum[i - 1]! + Math.max(lin, rot);
  }
  return {
    pos, abc: abcArr,
    lines: new Uint32Array(lines ?? points.map((_, i) => i + 1)),
    rapid: rapid ? new Uint8Array(rapid) : new Uint8Array(n), cum, count: n,
    lineIndex: emptyLineIndex(), timeBased: false,
  };
}

// Plunge mill: tool box rides a Z-driven tool group above a work box on an
// X-driven table. Tool group base z=50, box half-size 5 → tool bottom at
// 40+Z; work box top at +5. Contact at Z=-35, margin 2 breached below Z=-33.
const PLUNGE: CollisionMachine = {
  groups: [
    { id: "table", parent: "root" },
    // workGroup is a LEAF under the table so the vise (group "table") is a
    // fixture body, not a cutting body — cutting semantics get their own test.
    { id: "platter", parent: "table" },
    { id: "head", parent: "root", translate: [0, 0, 50] },
  ],
  kinematics: [
    { group: "table", joint: 0, type: "translate", direction: "x", sign: 1 },
    { group: "head", joint: 2, type: "translate", direction: "z", sign: 1 },
  ],
  workGroup: "platter",
  toolGroup: "head",
  unitScale: 1,
  axes: ["X", "Y", "Z"],
};
const PLUNGE_BODIES: CollisionBody[] = [
  { id: "vise", group: "table", positions: boxPositions(10) },
  { id: "spindle", group: "head", positions: boxPositions(10) },
];


it("R168: real sweep continued after fallback keeps the rapid fact with the earlier key", () => {
  const t = track([[0, 0, 0], [0, 0, -43], [3, 0, -43], [3, 0, 0]], undefined, [6, 7, 8, 9], [0, 0, 1, 0]);
  const held = new ContactStore(1, 0), current = new ContactStore(1, 1);
  let clock = 0;
  const m0 = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
  const it = sweepCollisionsIter(m0, t, WCS0, { margin: 2, contacts: { store: held }, yieldMs: 0, clock: () => ++clock });
  let step = it.next(), steps = 0;
  while (!step.done && !held.intervals.rows && steps++ < 10000) step = it.next();
  expect(step.done).toBe(false);
  expect(held.intervals.rows).toBe(1);
  expect(held.intervals.get(0, "flags") & IV_RAPID).toBe(0);
  const oldCoverage = (step.value as number) * t.cum[t.count - 1]!;
  const m1 = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
  sweepCollisions(m1, t, WCS0, { margin: 2, contacts: { store: current } });
  expect(current.intervals.rows).toBe(1);
  expect(current.intervals.get(0, "flags") & IV_RAPID).toBe(IV_RAPID);
  const pairName = (p: number) => { const [a,b]=m1.pairs[p]!; return { a: m1.bodies[a]!.id, b: m1.bodies[b]!.id }; };
  const end = t.cum[t.count - 1]!;
  const union = buildContactView({ sources: [{ stores: [current], held: [held], heldCoverage: [oldCoverage], ownCoverage: end, at: c => c }], pairName, coverage: end });
  const alone = buildContactView({ sources: [{ stores: [current], ownCoverage: end, at: c => c }], pairName, coverage: end });
  const ivs = (s: ContactStore) => Array.from({ length: s.intervals.rows }, (_, k) => ({ enter:s.intervals.get(k,"enter"),exit:s.intervals.get(k,"exit"),flags:s.intervals.get(k,"flags"),witness:s.intervals.get(k,"witness") }));
  writeFileSync(process.env.R168_OUT! + "/sweep-union.json", JSON.stringify({oldCoverage, end, held:ivs(held),current:ivs(current), union:targetAt(union,0,()=>7),alone:targetAt(alone,0,()=>7)},null,2)+"\n");
  expect(union.n).toBe(1);
  expect(targetKind(alone,0)&T_RAPID).toBe(T_RAPID);
  expect(targetKind(union,0)&T_RAPID, "the continued real contact touched during the rapid").toBe(T_RAPID);
});
