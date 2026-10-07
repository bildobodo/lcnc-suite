import {it,expect} from 'vitest';
import * as THREE from 'three';
import {buildCollisionModel,sweepCollisions,poseModel,pairDistance,type CollisionMachine,type CollisionBody,type CollisionTrack} from './collision';
import {writeFileSync} from 'node:fs';
const box=(w:number,h:number,d:number,x:number,y:number,z=0)=>{const g=new THREE.BoxGeometry(w,h,d).translate(x,y,z).toNonIndexed();const p=new Float32Array(g.getAttribute('position').array);g.dispose();return p;};
const join=(...a:Float32Array[])=>{const p=new Float32Array(a.reduce((n,v)=>n+v.length,0));let i=0;for(const v of a){p.set(v,i);i+=v.length;}return p;};
const machine:CollisionMachine={groups:[{id:'frame',parent:'root'},{id:'slide',parent:'root'}],kinematics:[{group:'slide',joint:0,type:'translate',direction:'x',sign:1}],workGroup:'frame',toolGroup:'slide',unitScale:1,axes:['X','Y','Z']};
const WCS={g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0};
const defs=(cutting=false):CollisionBody[]=>[{id:'wall',group:'frame',stock:cutting,positions:join(box(180,10,10,110,11.5),box(1,2.5,10,100.5,5.25),box(.25,2.5,10,103.375,5.25))},{id:'slide',group:'slide',tool:cutting,positions:box(1,10,10,0,0)}];
function track(xs:number[],lines:number[],rapid:number[],brk?:number[]):CollisionTrack {
 const c=[0];for(let i=1;i<xs.length;i++)c.push(c[i-1]!+(brk?.[i]?0:Math.abs(xs[i]!-xs[i-1]!)));
 return {pos:new Float32Array(xs.flatMap(x=>[x,0,0])),abc:new Float32Array(xs.length*3),cum:new Float32Array(c),lines:new Uint32Array(lines),rapid:new Uint8Array(rapid),count:xs.length,...brk?{brk:new Uint8Array(brk)}:{}};
}
const out:Record<string,unknown>={};const save=()=>writeFileSync('../evidence/viewer-palette-fest.r87.boundaries.json',JSON.stringify(out,null,2)+'\n');
it('a feed engagement followed by real separation and a rapid re-entry reports the rapid contact',()=>{
 const m=buildCollisionModel(machine,defs(true));const d=[];
 for(const x of [100,102,103,105]){poseModel(m,[x,0,0]);d.push({x,d:pairDistance(m.bodies[0]!,m.bodies[1]!,20,.2)});}
 const t=track([48,100,105,180],[1,2,3,4],[0,0,1,1]);
 const standard=sweepCollisions(m,t,WCS,{margin:.2});
 const fine=sweepCollisions(buildCollisionModel(machine,defs(true)),t,WCS,{margin:.2,linStepMm:.25,rotStepDeg:.25});
 const suffix=sweepCollisions(buildCollisionModel(machine,defs(true)),track([102,105,180],[1,3,4],[1,1,1]),WCS,{margin:.2});
 out.cutting={distances:d,standard,fine,suffix};save();
 expect(fine.hits.some(h=>h.rapid&&h.line===3&&h.dist===0)).toBe(true);
 expect(suffix.hits.some(h=>h.rapid&&h.line===3&&h.dist===0)).toBe(true);
 expect(standard.hits.some(h=>h.rapid&&h.line===3&&h.dist===0)).toBe(true);
});
it('recontact across ordinary lines and zero-length breaks preserves later contacts',()=>{
 const rows=[];
 for(const [xs,lines,brk] of [
  [[48,100,102,105,180],[1,2,3,4,5],undefined],
  [[48,100,100,105,180],[1,2,3,4,5],[0,0,1,0,0]],
  [[48,100,102,105,180],[1,2,3,4,5],[0,0,1,0,0]],
 ] as [number[],number[],number[]|undefined][]){
  const t=track(xs,lines,xs.map(()=>0),brk);const r=sweepCollisions(buildCollisionModel(machine,defs()),t,WCS,{margin:2});
  const si=xs.indexOf(105),cum103=t.cum[si-1]!+103-xs[si-1]!;
  const covered=r.hits.some(h=>h.intervals?.some(([a,b])=>a<=cum103&&b>=cum103));rows.push({xs,lines,brk,cum103,covered,result:r});
 }
 out.boundaries=rows;save();expect(rows.every(r=>r.covered)).toBe(true);
});
it('rotary rapid re-entry after feed and a gap beyond twice the DEFAULT 2 mm margin is reported',()=>{
 const R=1000,rad=Math.PI/180;
 const rotMachine:CollisionMachine={...machine,axes:['X','Y','Z','A'],kinematics:[{group:'slide',joint:3,type:'rotate',direction:'z',sign:1}]};
 const rotDefs:CollisionBody[]=[{id:'stock',group:'frame',stock:true,positions:join(box(10,10,10,R*Math.cos(10*rad),R*Math.sin(10*rad)),box(10,10,10,R*Math.cos(13*rad),R*Math.sin(13*rad)))},{id:'tool',group:'slide',tool:true,positions:box(2,20,20,R,0)}];
 const angles=[5,10,15,20];
 const t:CollisionTrack={pos:new Float32Array(12),abc:new Float32Array(angles.flatMap(a=>[a,0,0])),cum:new Float32Array([0,5,10,15]),lines:new Uint32Array([1,2,3,4]),rapid:new Uint8Array([0,0,1,1]),count:4};
 const m=buildCollisionModel(rotMachine,rotDefs),distances=[];
 for(const a of [10,11.5,13,15]){poseModel(m,[0,0,0,a]);distances.push({a,d:pairDistance(m.bodies[0]!,m.bodies[1]!,20,2)});}
 const standard=sweepCollisions(m,t,WCS,{margin:2});
 const fine=sweepCollisions(buildCollisionModel(rotMachine,rotDefs),t,WCS,{margin:2,linStepMm:.25,rotStepDeg:.25});
 out.rotary={distances,standard,fine};save();
 expect(distances[1]!.d).toBeGreaterThan(4);expect(fine.hits.some(h=>h.rapid&&h.line===3&&h.dist===0)).toBe(true);
 expect(standard.hits.some(h=>h.rapid&&h.line===3&&h.dist===0)).toBe(true);
});
