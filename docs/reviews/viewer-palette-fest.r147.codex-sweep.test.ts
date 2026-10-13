// The sweep's side of an UNDECIDABLE inside check (collision-inside.plan.md,
// VP96-03): every ray degenerate is rare on real meshes, so the rays are
// made degenerate here — `pointInside` answers "undecidable" wherever the
// test says. What such an answer must never give: a record, a separation, a
// clearance certificate, a static exclusion — and its stretch stays named,
// also through the parallel sweep's merge.
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { buildCollisionModel, sweepCollisions, type CollisionBody, type CollisionMachine, type CollisionResult } from "./collision";
import { emptyLineIndex } from "./lineIndex";
import { mergeShardResults } from "./sweepShards";
import type { ScrubTrack } from "../ws/bulkData";
import { ContactStore, GAP_UNDECIDABLE, IV_EXIT_DECIDED } from "./contactStore";

// undecidable where `when` says (the point in the container's frame)
const ctl = vi.hoisted(() => ({ when: null as ((p: { x: number; y: number; z: number }) => boolean) | null }));
vi.mock("./insideCheck", async orig => {
  const m = await orig<typeof import("./insideCheck")>();
  return {
    ...m,
    pointInside: (...a: Parameters<typeof m.pointInside>) =>
      (ctl.when?.(a[2]) ? "undecidable" as const : m.pointInside(...a)),
  };
});

const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 };
const box = (size: number): Float32Array => {
  const g = new THREE.BoxGeometry(size, size, size).toNonIndexed();
  const p = new Float32Array(g.getAttribute("position").array as Float32Array);
  g.dispose();
  return p;
};
// The cube and the 60 mm post of collision.test.ts's inside block.
const machine = (headX = 0): CollisionMachine => ({
  groups: [{ id: "table", parent: "root" }, { id: "part", parent: "table" }, { id: "head", parent: "root", translate: [headX, 0, 0] }],
  kinematics: [{ group: "head", joint: 0, type: "translate", direction: "x", sign: 1 }],
  workGroup: "part", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
});
const POST: CollisionBody = { id: "post", group: "table", positions: box(60) };
const nub = (id = "nub", y = 0): CollisionBody => ({ id, group: "head", positions: box(1), translate: [0, y, 0] });
const xs = (points: number[]): ScrubTrack => {
  const n = points.length;
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1]! + Math.abs(points[i]! - points[i - 1]!);
  return { pos: new Float32Array(points.flatMap(x => [x, 0, 0])), abc: new Float32Array(n * 3),
           lines: Uint32Array.from({ length: n }, (_, i) => i + 1), rapid: new Uint8Array(n), cum, count: n,
           lineIndex: emptyLineIndex(), timeBased: false };
};
const onsets = (r: CollisionResult) => r.hits.filter(h => h.continuation === undefined).map(h => h.line);
const iv = (r: CollisionResult, line: number) =>
  r.hits.find(h => h.line === line)!.intervals!.map(([a, b]) => [Number(a.toFixed(2)), Number(b.toFixed(2))]);

// Harness and ray-answer seam from collisionInside.test.ts. This case forces
// an undecidable refinement point in the cavity, not the final free pose.
import { buildContactView, tintAt } from './contactView';
import { writeFileSync } from 'node:fs';
it('the actual sweep refinement point stays unknown in contactView', () => {
 const outer=box(60),inner=box(40);
 for(let i=0;i<inner.length;i+=9)for(let k=0;k<3;k++){const v=inner[i+k]!;inner[i+k]=inner[i+3+k]!;inner[i+3+k]=v;}
 const hollow:CollisionBody={...POST,positions:new Float32Array([...outer,...inner])};
 const store=new ContactStore(1,0,{episodes:100,intervals:100,gaps:100});
 try {
  ctl.when=p=>p.x>19.7&&p.x<19.9;
  const model=buildCollisionModel(machine(),[hollow,nub()]);
  const r=sweepCollisions(model,xs([40,30,19]),WCS0,{margin:.1,contacts:{store}});
  const v=buildContactView({sources:[{stores:[store],at:c=>c}],coverage:21,pairName:i=>({a:model.bodies[model.pairs[i]![0]]!.id,b:model.bodies[model.pairs[i]![1]]!.id})});
  expect(store.gaps.rows).toBe(1);
  const point=store.gaps.get(0,'start');
  expect(point).toBe(store.gaps.get(0,'end'));
  const tint=[...tintAt(v,point,0)];
  writeFileSync(process.env.R147_SWEEP_RESULTS!,JSON.stringify({gap:{point,end:store.gaps.get(0,'end'),reason:store.gaps.get(0,'reason')},intervals:Array.from({length:store.intervals.rows},(_,i)=>({enter:store.intervals.get(i,'enter'),exit:store.intervals.get(i,'exit'),witness:store.intervals.get(i,'witness')})),spans:[...v.touch.values()].map(a=>[...a]),tint,truncated:r.truncated??null},null,2)+'\n');
  expect(tint).toEqual([]);
 } finally {ctl.when=null;}
});
