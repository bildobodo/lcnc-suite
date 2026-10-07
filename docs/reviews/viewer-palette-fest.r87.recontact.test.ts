import {it,expect} from 'vitest';
import * as THREE from 'three';
import {buildCollisionModel,sweepCollisions,poseModel,pairDistance,type CollisionMachine,type CollisionBody} from './collision';
import {writeFileSync} from 'node:fs';
const slab=(w:number,h:number,d:number,x:number,y:number,z:number)=>{const g=new THREE.BoxGeometry(w,h,d).translate(x,y,z).toNonIndexed();const p=new Float32Array(g.getAttribute('position').array);g.dispose();return p;};
const join=(...a:Float32Array[])=>{const p=new Float32Array(a.reduce((n,v)=>n+v.length,0));let i=0;for(const v of a){p.set(v,i);i+=v.length;}return p;};
const machine:CollisionMachine={groups:[{id:'frame',parent:'root'},{id:'slide',parent:'root'}],kinematics:[{group:'slide',joint:0,type:'translate',direction:'x',sign:1}],workGroup:'frame',toolGroup:'slide',unitScale:1,axes:['X','Y','Z']};
const defs:CollisionBody[]=[{id:'wall',group:'frame',positions:join(slab(180,10,10,110,11.5,0),slab(1,2.5,10,100.5,5.25,0),slab(.25,2.5,10,103.375,5.25,0))},{id:'slide',group:'slide',positions:slab(1,10,10,0,0,0)}];
const out:Record<string,unknown>={};const save=()=>writeFileSync('../evidence/viewer-palette-fest.r86.recontact.json',JSON.stringify(out,null,2)+'\n');
function run(x0:number,fine=false){
 const model=buildCollisionModel(machine,defs);
 const distances=[99,100,102,103,105].map(x=>{poseModel(model,[x,0,0]);return {x,d:pairDistance(model.bodies[0]!,model.bodies[1]!,20,2)};});
 const result=sweepCollisions(model,{pos:new Float32Array([x0,0,0,180,0,0]),abc:new Float32Array(6),cum:new Float32Array([0,180-x0]),lines:new Uint32Array([1,2]),rapid:new Uint8Array(2),count:2},{g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0},{margin:2,...fine?{linStepMm:.25,rotStepDeg:.25}:{}});
 const ivs=result.hits.flatMap(h=>(h.intervals??[]).map(([a,b])=>[a+x0,b+x0]));
 return {x0,fine,distances,expected:[[99.5,101.5],[102.75,104]],intervals:ivs,secondTouchCovered:ivs.some(([a,b])=>a!<=103&&b!>=103),hits:result.hits,truncated:result.truncated,uncertified:result.uncertified};
}
it('control: surface distances agree with analytic boxes; the smaller exploration step resolves both contacts',()=>{
 const fine=run(48,true),suffix=run(102);out.controls={fine,suffix};save();
 expect(fine.distances.find(p=>p.x===100)!.d).toBe(0);
 expect(fine.distances.find(p=>p.x===102)!.d).toBeCloseTo(.5,7);
 expect(fine.distances.find(p=>p.x===103)!.d).toBe(0);
 expect(fine.secondTouchCovered).toBe(true);expect(suffix.secondTouchCovered).toBe(true);
});
it('both contacts wider than MIN_ADV must be represented with the production defaults',()=>{
 const rows=[48,48.3,48.6,49,49.5].map(x=>run(x));out.production=rows;save();
 expect(rows.every(r=>r.truncated===null&&r.uncertified===null)).toBe(true);
 expect(rows.every(r=>r.secondTouchCovered)).toBe(true);
});
