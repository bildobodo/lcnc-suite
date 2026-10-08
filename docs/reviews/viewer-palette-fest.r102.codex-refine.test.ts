// The sweep's side of an UNDECIDABLE inside check (collision-inside.plan.md,
// VP96-03): every ray degenerate is rare on real meshes, so the rays are
// made degenerate here — `pointInside` answers "undecidable" wherever the
// test says. What such an answer must never give: a record, a separation, a
// clearance certificate, a static exclusion — and its stretch stays named,
// also through the parallel sweep's merge.
import { writeFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { buildCollisionModel, sweepCollisions, type CollisionBody, type CollisionMachine, type CollisionResult } from "./collision";
import { emptyLineIndex } from "./lineIndex";
import { mergeShardResults } from "./sweepShards";
import type { ScrubTrack } from "../ws/bulkData";

// undecidable where `when` says (the point in the container's frame)
const ctl = vi.hoisted(() => ({ calls: [] as any[], mode: false, when: null as ((p: { x: number; y: number; z: number }) => boolean) | null }));
vi.mock("./insideCheck", async orig => {
  const m = await orig<typeof import("./insideCheck")>();
  return {
    ...m,
    pointInside: (...a: Parameters<typeof m.pointInside>) =>
      (() => {const stage = new Error().stack?.includes("contactAtDist") ? "refine" : "sweep"; const original=m.pointInside(...a); const forced=!!ctl.when?.(a[2]); ctl.calls.push({p:a[2].toArray(),stage,original,forced}); return forced ? "undecidable" as const : original; })(),
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



function hollowPost(): CollisionBody {
 const outer=box(60), inner=box(40);
 for(let i=0;i<inner.length;i+=9) for(let k=0;k<3;k++) {
  const v=inner[i+k]!; inner[i+k]=inner[i+3+k]!; inner[i+3+k]=v;
 }
 return {...POST, positions:new Float32Array([...outer,...inner])};
}
const evidence:any[]=[];
function run(unknown:boolean) {
 ctl.calls=[];
 // Same contract injection as collisionInside.test.ts: the predicate is
 // POSITION ONLY. It does not know which sweep stage asks it.
 ctl.when=unknown ? p => p.x>18 && p.x<19.5 : null;
 try {
  const result=sweepCollisions(buildCollisionModel(machine(40),[hollowPost(),nub()]),xs([-40,-20]),WCS0,{margin:0.1});
  const row={unknown,calls:ctl.calls,result}; evidence.push(row);
  writeFileSync("../evidence/viewer-palette-fest.r102.codex-refine.json",JSON.stringify(evidence,null,2));
  return row;
 } finally { ctl.when=null; }
}
it("control: a 1 mm cube in a 40 mm cavity reaches the wall at X=19.5",()=>{
 const {result}=run(false);
 expect(result.hits).toHaveLength(1);
 expect(result.hits[0]!.cum).toBeCloseTo(19.5,2);
 expect(result.notes).toEqual([]);
});
it("a positional unknown found only during refinement remains named",()=>{
 const {result,calls}=run(true);
 const undecidable=calls.filter((c:any)=>c.forced);
 expect(undecidable.length).toBeGreaterThan(0);
 // Diagnostic stack classification never changes the predicate's answer.
 expect(undecidable.every((c:any)=>c.stage==="refine")).toBe(true);
 expect(result.hits[0]!.cum).toBeLessThan(19);
 expect(result.notes?.some(n=>n.includes("inside check undecidable") && n.includes("nub") && n.includes("post") && n.includes("L2"))).toBe(true);
});
