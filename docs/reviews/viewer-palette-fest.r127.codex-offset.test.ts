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



import { basisFromLive, basisFromRun } from './checkBasis';
import { parseRunBasis } from '../runBasis';
import { mergeEntryResult } from './sweepMerge';
import { readFileSync } from 'node:fs';
const results:any[]=[];
it('the external-offset reason follows idle and run snapshots, and entry merge',()=>{
 const live:any={g5x:[],g92:[],rotationXy:0,toolOffset:[0,0,0],wcsTable:null,toolNum:2,toolDiam:2,toolLen:80,eoffsetZ:0,eoffsetEnabled:false};
 const wire=JSON.parse(readFileSync('../scripts/test_fixtures/run_check_wire.json','utf8'));
 const t=track([[0,0,0],[0,0,-36],[0,0,-41],[0,0,-33],[0,0,-20]],undefined,[7,8,9,10,11]);
 t.band=new Uint8Array([0,0,1,1,0]); t.cond=new Uint8Array([0,0,1,1,1]);
 for(const [enabled,z,part] of [[true,0,'is enabled'],[false,.25,'0.25 is applied'],[null,0,'was not read'],[false,null,'was not read'],[false,0,null]] as const){
  const a=basisFromLive({...live,eoffsetEnabled:enabled,eoffsetZ:z},null);
  const rb=parseRunBasis({...wire.run_basis,start:{...wire.run_basis.start,eoffset_enabled:enabled,eoffset_z:z}})!;
  const b=basisFromRun(rb,null)!;
  for(const [kind,base] of [['idle',a],['run',b]] as const){
   const r=sweepCollisions(buildCollisionModel(PLUNGE,PLUNGE_BODIES),t,WCS0,{margin:2,externalOffsetZ:{enabled:base.eoffsetEnabled,z:base.eoffsetZ}});
   const entry={...r,hits:[],notes:[],uncertified:null};
   const merged=mergeEntryResult(entry,r,3,t.cum.at(-1)!);
   const note=(merged.notes??[]).find(n=>n.startsWith("At the check's basis"));
   results.push({kind,enabled,z,note:note??null});
   if(part) expect(note).toContain(part); else expect(note).toBeUndefined();
  }
 }
 writeFileSync('../r127.codex-offset.json',JSON.stringify(results,null,2));
});
