import fs from 'node:fs';
import * as THREE from 'three';
import { it, expect } from 'vitest';
import { buildLineIndex } from './lineIndex';
import { sliceTrack, type ScrubTrack } from './scrubTrack';
import { mergeEntryResult } from './sweepMerge';
import { buildCollisionModel, sweepCollisions, poseModel, pairDistance, type CollisionMachine, type CollisionResult, type CollisionHit } from './collision';
const out=process.env.R114_EVIDENCE!;
const WCS={g5x:[],g92:[],rotationDeg:0,tool:[]};
function track(p:number[][],rapids?:number[],unknownAt?:number):ScrubTrack{
 const cum=new Float32Array(p.length);for(let i=1;i<p.length;i++)cum[i]=cum[i-1]!+(i===unknownAt?0:Math.hypot(...p[i]!.map((x,k)=>x-p[i-1]![k]!)));
 const lines=new Uint32Array(p.map((_,i)=>i+7)),ustart=new Uint8Array(p.length),brk=new Uint8Array(p.length);if(unknownAt!=null)ustart[unknownAt]=brk[unknownAt]=1;
 return {pos:new Float32Array(p.flat()),abc:new Float32Array(p.length*3),cum,lines,rapid:new Uint8Array(rapids??p.map(()=>0)),count:p.length,timeBased:false,lineIndex:buildLineIndex(lines,cum),ustart,brk};
}
function cube(size:number){const g=new THREE.BoxGeometry(size,size,size).toNonIndexed();const a=new Float32Array(g.getAttribute('position').array);g.dispose();return a;}
const PLUNGE:CollisionMachine={groups:[{id:'table',parent:'root'},{id:'platter',parent:'table'},{id:'head',parent:'root',translate:[0,0,50]}],kinematics:[{group:'table',joint:0,type:'translate',direction:'x',sign:1},{group:'head',joint:2,type:'translate',direction:'z',sign:1}],workGroup:'platter',toolGroup:'head',unitScale:1,axes:['X','Y','Z']};
function cutter(t:ScrubTrack){
 const model=buildCollisionModel(PLUNGE,[{id:'stock',group:'platter',positions:cube(10),stock:true},{id:'cutter',group:'head',positions:cube(10),tool:true}]);
 const result=sweepCollisions(model,t,WCS,{margin:2});poseModel(model,[0,0,-43]);const distanceAtCut=pairDistance(model.bodies[0]!,model.bodies[1]!,2,2);
 return {result,distanceAtCut};
}
// Explicit PLAN boundary record; neither range nor boundary currently exists in product.
function withBoundary(r:CollisionResult,line:number):CollisionResult{
 const hit:CollisionHit&{boundary:true}={line,cum:0,cumEnd:0,a:'cutter',b:'stock',dist:0,rapid:false,boundary:true};
 return {...r,hits:[hit,...r.hits]};
}
function write(n:string,x:unknown){fs.writeFileSync(out+'/'+n+'.json',JSON.stringify(x,null,2)+'\n');}
it('R114 seam: a benign feed contact has no prefix finding to continue',()=>{
 const t=track([[0,0,0],[0,0,-43],[0,0,0]],[0,0,1]),h=1;
 const full=cutter(t),prefix=cutter(sliceTrack(t,0,h+1)),suffix=cutter(sliceTrack(t,h,t.count));
 const boundary=withBoundary(suffix.result,9),merged=mergeEntryResult(prefix.result,boundary,t.cum[h]!,t.cum[t.count-1]!-t.cum[h]!);
 write('feed-seam',{h,full,prefix,suffix,syntheticBoundary:boundary,entryMergeAnalogy:merged});
 expect(full.distanceAtCut).toBe(0);expect(full.result.hits).toHaveLength(0);expect(prefix.result.hits).toHaveLength(0);expect(suffix.result.hits).toHaveLength(0);
 expect(merged.hits).toHaveLength(1);expect((merged.hits[0] as any).boundary).toBe(true);
});
it('R114 seam: rapid onset before the cut governs later rapids after a feed segment',()=>{
 const t=track([[0,0,0],[0,0,-43],[0,0,-44],[0,0,-43],[0,0,0]],[0,1,0,1,1]),h=1;
 const full=cutter(t),prefix=cutter(sliceTrack(t,0,h+1)),suffix=cutter(sliceTrack(t,h,t.count));
 const boundary=withBoundary(suffix.result,9),merged=mergeEntryResult(prefix.result,boundary,t.cum[h]!,t.cum[t.count-1]!-t.cum[h]!);
 write('rapid-seam',{h,full,prefix,suffix,syntheticBoundary:boundary,entryMergeAnalogy:merged});
 expect(full.result.hits.some(x=>x.line===10&&x.rapid)).toBe(true);expect(prefix.result.hits.some(x=>x.line===8&&x.rapid)).toBe(true);expect(suffix.result.hits).toHaveLength(0);
 expect(merged.hits.some(x=>x.line===10)).toBe(false);
});
it('R114 positive control: prefix phase recovers R113 missed known motion',()=>{
 const XYZ:CollisionMachine={groups:[{id:'x',parent:'root'},{id:'y',parent:'x'},{id:'head',parent:'y'},{id:'table',parent:'root'}],kinematics:[{group:'x',joint:0,type:'translate',direction:'x',sign:1},{group:'y',joint:1,type:'translate',direction:'y',sign:1},{group:'head',joint:2,type:'translate',direction:'z',sign:1}],workGroup:'table',toolGroup:'head',unitScale:1,axes:['X','Y','Z']};
 const t=track([[0,0,0],[100,0,0],[100,20,0],[0,20,0],[0,0,0]],undefined,1),h=3;
 const sweep=(x:ScrubTrack)=>sweepCollisions(buildCollisionModel(XYZ,[{id:'fixed',group:'table',positions:cube(.5),translate:[100,10,0]},{id:'head',group:'head',positions:cube(.5)}]),x,WCS,{margin:.1});
 const full=sweep(t),phase1=sweep(sliceTrack(t,h,t.count)),phase2=sweep(sliceTrack(t,0,h+1));
 write('two-phase-control',{h,full,phase1,phase2});
 expect(phase1.hits).toHaveLength(0);expect(full.hits.some(x=>x.line===9)).toBe(true);expect(phase2.hits.some(x=>x.line===9)).toBe(true);expect(phase2.notes?.some(n=>n.includes('cannot know'))).toBe(true);
});
