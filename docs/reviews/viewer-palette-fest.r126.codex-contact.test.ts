// Unit tests for viewer/collision.ts — synthetic machines with box bodies.
import * as THREE from "three";
import { emptyLineIndex } from "./lineIndex";
import { describe, expect, it } from "vitest";
import {
  buildCollisionModel, sweepCollisions, withoutArealessFacets, poseModel, pairDistance, sweepCollisionsIter, toolCylinderPositions, restoreBaseTool, type SnapshotHandle,
  type CollisionBody, type CollisionMachine, type CollisionResult, type CollisionOptions, type CollisionHit, mergeContiguousIntervals, componentBoxes } from "./collision";
import type { ScrubTrack } from "../ws/bulkData";
import { buildScrubTrack } from "./scrubTrack";
import { TLO_NONE } from "./tloEvents";
import { runSweepSlice } from "./sweepPump";
import { clashTargets } from "./clashTargets";

const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 };

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


import { writeFileSync } from "node:fs";


const observations: any[] = [];
describe("Codex R126 contact provenance", () => {
  for (const cutting of [false, true]) {
    it(`band-only feed contact must not swallow a subsequent real rapid: cutting=${cutting}`, () => {
      const bodies: CollisionBody[] = cutting ? [
        { id: "stock", group: "platter", positions: boxPositions(10), stock: true },
        { id: "spindle", group: "head", positions: boxPositions(10), tool: true },
      ] : PLUNGE_BODIES;
      const model = buildCollisionModel(PLUNGE, bodies);
      // P=-36 (4 apart), hull down to -41, back to P+r=-33 (7 apart),
      // then an ordinary rapid into the obstacle. Only the two hull legs
      // are artificial; contact on L11 must not borrow their feed onset.
      const pts = [[0,0,0],[0,0,-36],[0,0,-41],[0,0,-33],[0,0,-43]];
      const t=track(pts,undefined,[7,8,9,10,11],[0,0,0,0,1]);
      t.band=new Uint8Array([0,0,1,1,0]); t.cond=new Uint8Array([0,0,1,1,1]);
      const actual=sweepCollisions(model,t,WCS0,{margin:2});
      // Control: skip just the modeled excursion; the normal rapid remains.
      const control=sweepCollisions(model,track([pts[0]!,pts[1]!,pts[3]!,pts[4]!],undefined,[7,8,10,11],[0,0,0,1]),WCS0,{margin:2});
      const targets=clashTargets(actual.hits);
      observations.push({kind:"band_rapid",cutting,actual,targets,control});
      writeFileSync('../r126.codex-contact.json',JSON.stringify(observations,null,2));
      expect(control.hits.some(h=>h.line===11)).toBe(true);
      expect(targets.some(h=>h.line===11 && !h.possible)).toBe(true);
    });
  }
  it("a later real hit on a continuing pair must be navigable as more than possible",()=>{
    const model=buildCollisionModel(PLUNGE,PLUNGE_BODIES);
    const t=track([[0,0,0],[0,0,-36],[0,0,-41],[0,0,-42]],undefined,[7,8,9,10]);
    t.band=new Uint8Array([0,0,1,0]);
    const r=sweepCollisions(model,t,WCS0,{margin:2});
    const targets=clashTargets(r.hits);
    observations.push({kind:"band_continuation",result:r,targets});
    writeFileSync('../r126.codex-contact.json',JSON.stringify(observations,null,2));
    expect(r.hits.find(h=>h.line===10)?.possible).toBeUndefined();
    expect(targets.some(h=>!h.possible)).toBe(true);
  });
});
