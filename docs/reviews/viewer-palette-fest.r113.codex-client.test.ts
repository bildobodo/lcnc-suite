import fs from 'node:fs';
import * as THREE from 'three';
import { it, expect } from 'vitest';
import { buildLineIndex } from './lineIndex';
import { projectOntoTrack, sliceTrack, type ScrubTrack } from './scrubTrack';
import { buildCollisionModel, sweepCollisions, type CollisionMachine } from './collision';
const out=process.env.R113_EVIDENCE!;
const WCS={g5x:[],g92:[],rotationDeg:0,tool:[]};
const XYZ:CollisionMachine={groups:[{id:'x',parent:'root'},{id:'y',parent:'x'},{id:'head',parent:'y'},{id:'table',parent:'root'}],kinematics:[{group:'x',joint:0,type:'translate',direction:'x',sign:1},{group:'y',joint:1,type:'translate',direction:'y',sign:1},{group:'head',joint:2,type:'translate',direction:'z',sign:1}],workGroup:'table',toolGroup:'head',unitScale:1,axes:['X','Y','Z']};
function track(p:number[][],unknownAt?:number):ScrubTrack{
 const cum=new Float32Array(p.length);for(let i=1;i<p.length;i++) cum[i]=cum[i-1]!+(i===unknownAt?0:Math.hypot(...p[i]!.map((x,k)=>x-p[i-1]![k]!)));
 const lines=new Uint32Array(p.map((_,i)=>i+1));
 const ustart=new Uint8Array(p.length),brk=new Uint8Array(p.length);if(unknownAt!=null)ustart[unknownAt]=brk[unknownAt]=1;
 return {pos:new Float32Array(p.flat()),abc:new Float32Array(p.length*3),cum,lines,rapid:new Uint8Array(p.length),count:p.length,timeBased:false,lineIndex:buildLineIndex(lines,cum),ustart,brk};
}
// Executable reading of PLAN 3b. restFloor does not yet exist in product.
// The real projector measures each candidate; unknown segments are excluded as planned.
function proposedFloor(t:ScrubTrack,m:number[],tau=10){
 const candidates=[];
 for(let i=1;i<t.count;i++){
  if(t.ustart?.[i]||t.brk?.[i]||t.unpredicted?.[i])continue;
  const p=projectOntoTrack(sliceTrack(t,i-1,i+1),m,WCS,undefined,null);
  if(p&&p.dist2<=tau*tau)candidates.push({seg:i,dist2:p.dist2});
 }
 return {candidates,from:candidates.length?candidates[0]!.seg-1:0,fallback:!candidates.length};
}
function sweep(t:ScrubTrack,p:[number,number,number]){
 const cube=()=>{const g=new THREE.BoxGeometry(.5,.5,.5).toNonIndexed();const a=new Float32Array(g.getAttribute('position').array);g.dispose();return a;};
 const m=buildCollisionModel(XYZ,[{id:'fixed',group:'table',positions:cube(),translate:p},{id:'head',group:'head',positions:cube()}]);
 return sweepCollisions(m,t,WCS,{margin:.1});
}
function write(n:string,x:unknown){fs.writeFileSync(out+'/'+n+'.json',JSON.stringify(x,null,2)+'\n');}
it('R113 plan counterexample: an unresolved unknown occurrence cannot be discarded because a later known segment fits',()=>{
 const points=[[0,0,0],[100,0,0],[100,20,0],[0,20,0],[0,0,0]],t=track(points,1),machine=[1,0,0,0,0,0];
 const floor=proposedFloor(t,machine),full=sweep(t,[100,10,0]),rest=sweep(sliceTrack(t,floor.from,t.count),[100,10,0]);
 write('unknown-floor',{points,machine,assumedActualOccurrence:1,ustart:[...t.ustart!],cum:[...t.cum],floor,full,rest});
 expect(floor.candidates.map(c=>c.seg)).toEqual([4]);expect(floor.from).toBe(3);expect(floor.fallback).toBe(false);
 expect(full.hits.some(h=>h.line===3)).toBe(true);expect(rest.hits).toHaveLength(0);
});
it('R113 positive control: earliest-known candidate fixes the all-known R112 parallel path example',()=>{
 const points=[[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,.1,0],[10,.1,0]],t=track(points),machine=[1,.1,0,0,0,0];
 const floor=proposedFloor(t,machine),rest=sweep(sliceTrack(t,floor.from,t.count),[10,5,0]);
 write('known-control',{points,machine,floor,rest});
 expect(floor.from).toBe(0);expect(rest.hits.some(h=>h.line===3)).toBe(true);
});
it('R113 control: absence of every known candidate chooses the full-preview fallback',()=>{
 const t=track([[0,0,0],[100,0,0],[100,20,0],[0,20,0],[0,0,0]],1),machine=[50,-100,0,0,0,0];
 const floor=proposedFloor(t,machine);expect(floor.fallback).toBe(true);expect(floor.from).toBe(0);
 write('offpath-control',{machine,floor});
});
