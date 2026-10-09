import fs from 'node:fs';
import * as THREE from 'three';
import { it, expect } from 'vitest';
import { buildLineIndex } from './lineIndex';
import { projectOntoTrack, sliceTrack, type ScrubTrack } from './scrubTrack';
import { createRunWatcher } from './runWatcher';
import { epochTermsFor, type WcsEpoch } from './wcsEpochs';
import { toolForIndex } from './tloEvents';
import { buildCollisionModel, sweepCollisions, type CollisionMachine } from './collision';
const out=process.env.R112_EVIDENCE!;
const WCS={g5x:[],g92:[],rotationDeg:0,tool:[]};
const XYZ:CollisionMachine={groups:[{id:'x',parent:'root'},{id:'y',parent:'x'},{id:'head',parent:'y'},{id:'table',parent:'root'}],kinematics:[{group:'x',joint:0,type:'translate',direction:'x',sign:1},{group:'y',joint:1,type:'translate',direction:'y',sign:1},{group:'head',joint:2,type:'translate',direction:'z',sign:1}],workGroup:'table',toolGroup:'head',unitScale:1,axes:['X','Y','Z']};
function track(p:number[][]):ScrubTrack{
 const cum=new Float32Array(p.length);for(let i=1;i<p.length;i++) cum[i]=cum[i-1]!+Math.hypot(...p[i]!.map((x,k)=>x-p[i-1]![k]!));
 const lines=new Uint32Array(p.map((_,i)=>i+1));
 return {pos:new Float32Array(p.flat()),abc:new Float32Array(p.length*3),cum,lines,rapid:new Uint8Array(p.length),count:p.length,timeBased:false,lineIndex:buildLineIndex(lines,cum)};
}
function sweep(t:ScrubTrack,p:[number,number,number]){
 const cube=()=>{const g=new THREE.BoxGeometry(.5,.5,.5).toNonIndexed();const a=new Float32Array(g.getAttribute('position').array);g.dispose();return a;};
 const m=buildCollisionModel(XYZ,[{id:'fixed',group:'table',positions:cube(),translate:p},{id:'head',group:'head',positions:cube()}]);
 return sweepCollisions(m,t,WCS,{margin:.1});
}
function write(n:string,x:unknown){fs.writeFileSync(out+'/'+n+'.json',JSON.stringify(x,null,2)+'\n');}
it('R112 observation: closest projection can choose a future segment and omit an intervening clash',()=>{
 const points=[[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,.1,0],[10,.1,0]];
 const t=track(points),machine=[1,.1,0,0,0,0];
 const early=projectOntoTrack(t,machine,WCS,undefined,{lo:0,hi:9});
 const best=projectOntoTrack(t,machine,WCS,undefined,null)!;
 const watched=createRunWatcher().update({track:t,machine,wcs:WCS,nowMs:0});
 const k=best.index-1,full=sweep(t,[10,5,0]),rest=sweep(sliceTrack(t,k,t.count),[10,5,0]);
 write('projection',{points,machine,assumedActualSegment:1,early,best,watched,k,full,rest});
 expect(early!.index).toBe(1);expect(early!.dist2).toBeCloseTo(.01);expect(best.index).toBe(5);expect(watched.phase).toBe('attached');expect(watched.index).toBe(5);
 expect(full.hits.length).toBeGreaterThan(0);expect(rest.hits).toHaveLength(0);
});
it('R112 observation: a rest slice turns an existing and a future contact into a static exception',()=>{
 const points=[[5,0,0],[0,0,0],[5,0,0],[0,0,0],[5,0,0]],t=track(points);
 const full=sweep(t,[0,0,0]),rest=sweep(sliceTrack(t,1,t.count),[0,0,0]);
 write('baseline',{points,cut:1,full,rest});
 expect(full.staticContacts).toHaveLength(0);expect(full.hits.some(h=>h.line>=4)).toBe(true);
 expect(rest.staticContacts).toHaveLength(1);expect(rest.hits).toHaveLength(0);
});
it('R112 observation: same payload resolves earlier WCS and inherited tool differently after live state changes',()=>{
 const events:WcsEpoch[]=[{seq:0,idx:1,rotationDeg:0,rewritten:false,g5x:[0,0,0],g92:[]},{seq:2,idx:1,rotationDeg:0,rewritten:true,g5x:[100,0,0],g92:[]}];
 const before=epochTermsFor(events,WCS,[{x:0}]),after=epochTermsFor(events,WCS,[{x:100}]);
 const inheritedBefore=toolForIndex(undefined,undefined,1),inheritedAfter=toolForIndex(undefined,undefined,2);
 write('basis',{events,before,after,inheritedBefore,inheritedAfter});
 expect(before.map(t=>t.ox)).toEqual([0,100]);expect(after.map(t=>t.ox)).toEqual([100,100]);expect(inheritedBefore).toBe(1);expect(inheritedAfter).toBe(2);
});
