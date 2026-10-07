import {it,expect} from 'vitest';
import * as THREE from 'three';
import {buildCollisionModel,sweepCollisions,type CollisionMachine,type CollisionBody,type CollisionTrack,type CollisionResult} from './collision';
import {writeFileSync} from 'node:fs';
const WCS={g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0};
const machine:CollisionMachine={groups:[{id:'frame',parent:'root'},{id:'arm',parent:'root'}],kinematics:[{group:'arm',joint:3,type:'rotate',direction:'z',sign:1}],workGroup:'frame',toolGroup:'arm',unitScale:1,axes:['X','Y','Z','A']};
const R=1000,rad=Math.PI/180;
const box=(w:number,h:number,d:number,x:number,y:number)=>{const g=new THREE.BoxGeometry(w,h,d).translate(x,y,0).toNonIndexed();const p=new Float32Array(g.getAttribute('position').array);g.dispose();return p;};
const join=(a:Float32Array[])=>{const p=new Float32Array(a.reduce((n,v)=>n+v.length,0));let i=0;for(const v of a){p.set(v,i);i+=v.length;}return p;};
function run(blocks:number[],angles:number[],rapid:number[],fine=false,lines?:number[]):CollisionResult {
 const defs:CollisionBody[]=[{id:'stock',group:'frame',stock:true,positions:join(blocks.map(a=>box(10,10,10,R*Math.cos(a*rad),R*Math.sin(a*rad))))},{id:'tool',group:'arm',tool:true,positions:box(2,20,20,R,0)}];
 const cum=[0]; for(let i=1;i<angles.length;i++)cum.push(cum[i-1]!+Math.abs(angles[i]!-angles[i-1]!));
 const track:CollisionTrack={pos:new Float32Array(angles.length*3),abc:new Float32Array(angles.flatMap(a=>[a,0,0])),cum:new Float32Array(cum),lines:new Uint32Array(lines??angles.map((_,i)=>i+1)),rapid:new Uint8Array(rapid),count:angles.length};
 return sweepCollisions(buildCollisionModel(machine,defs),track,WCS,{margin:2,...fine?{linStepMm:.25,rotStepDeg:.25}:{}});
}
const out:Record<string,unknown>={};const save=()=>writeFileSync('../evidence/viewer-palette-fest.r89.edges.json',JSON.stringify(out,null,2)+'\n');
const rapidTouch=(r:CollisionResult)=>r.hits.some(h=>h.rapid&&h.dist<=1e-4);
const brief=(r:CollisionResult)=>({hits:r.hits,samples:r.samples,truncated:r.truncated,uncertified:r.uncertified});
it('detects separated rapid re-entries across block and cadence phases in both rotary directions',()=>{
 const rows=[];
 for(const sign of [1,-1])for(const start of [4.5,4.75,5,5.25,5.5])for(const second of [13,13.25,13.5,13.75,14,14.25,14.5,14.75,15,15.25,15.5,15.75,16]){
  const blocks=[10,second].map(a=>a*sign),angles=[start,10,15,20].map(a=>a*sign),rapid=[0,0,1,1];
  const standard=run(blocks,angles,rapid),fine=run(blocks,angles,rapid,true);
  const ok=rapidTouch(standard)&&rapidTouch(fine)&&standard.truncated===null&&standard.uncertified===null;
  rows.push({sign,start,second,ok,standard:brief(standard),fine:brief(fine)});
 }
 out.phases=rows;save();expect(rows.filter(r=>!r.ok)).toEqual([]);
});
it('keeps machining and uninterrupted feed-contact retracts benign',()=>{
 const rows=[];
 for(const sign of [1,-1])for(const second of [13,14.5,15,15.5]){
  const machining=run([10,second].map(a=>a*sign),[5,10,15,20].map(a=>a*sign),[0,0,0,0]);
  const retract=run([10*sign],[5,10,15,20].map(a=>a*sign),[0,0,1,1]);
  rows.push({sign,second,machining:brief(machining),retract:brief(retract)});
 }
 out.benign=rows;save();expect(rows.every(r=>r.machining.hits.length===0&&r.retract.hits.length===0)).toBe(true);
});
it('finds a rapid re-entry even when the next main contact lies back on feed',()=>{
 const rows=[];
 for(const sign of [1,-1])for(const second of [13,14,14.5,15]){
  // The rapid ends 0.5 degree past the second block centre. The following
  // feed begins inside that contact; the rapid onset still needs a record.
  const angles=[5,10,11.5,second+.5,20].map(a=>a*sign),rapid=[0,0,0,1,0],blocks=[10,second].map(a=>a*sign);
  const standard=run(blocks,angles,rapid),fine=run(blocks,angles,rapid,true);
  rows.push({sign,second,standard:brief(standard),fine:brief(fine),ok:rapidTouch(standard)&&rapidTouch(fine)});
 }
 out.rapidThenFeed=rows;save();expect(rows.filter(r=>!r.ok)).toEqual([]);
});
it('retains a rapid onset across many short and zero-length segments',()=>{
 const rows=[];
 for(const sign of [1,-1])for(const sameLine of [false,true]){
  const angles=[5,10,10,...Array.from({length:100},(_,i)=>10+(i+1)*.1)].map(a=>a*sign);
  const rapid=angles.map((_,i)=>i>2?1:0),lines=angles.map((_,i)=>sameLine?(i>2?3:2):i+1);
  const standard=run([10,15].map(a=>a*sign),angles,rapid,false,lines),fine=run([10,15].map(a=>a*sign),angles,rapid,true,lines);
  rows.push({sign,sameLine,standard:brief(standard),fine:brief(fine),ok:rapidTouch(standard)&&rapidTouch(fine)});
 }
 out.shortLines=rows;save();expect(rows.filter(r=>!r.ok)).toEqual([]);
});
