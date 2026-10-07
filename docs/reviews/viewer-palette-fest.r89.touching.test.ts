import {it,expect} from 'vitest';
import * as THREE from 'three';
import {buildCollisionModel,sweepCollisions,poseModel,pairDistance,type CollisionMachine,type CollisionBody,type CollisionTrack} from './collision';
import {writeFileSync} from 'node:fs';
const box=(w:number,h:number,d:number,x:number,y:number)=>{const g=new THREE.BoxGeometry(w,h,d).translate(x,y,0).toNonIndexed();const p=new Float32Array(g.getAttribute('position').array);g.dispose();return p;};
const join=(...a:Float32Array[])=>{const p=new Float32Array(a.reduce((n,v)=>n+v.length,0));let i=0;for(const v of a){p.set(v,i);i+=v.length;}return p;};
const machine:CollisionMachine={groups:[{id:'frame',parent:'root'},{id:'arm',parent:'root'}],kinematics:[{group:'arm',joint:3,type:'rotate',direction:'z',sign:1}],workGroup:'frame',toolGroup:'arm',unitScale:1,axes:['X','Y','Z','A']};
const wcs={g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0};
const R=1000,rad=Math.PI/180;
function run(second:number,fine=false,suffix=false){
 const defs:CollisionBody[]=[{id:'stock',group:'frame',stock:true,positions:join(box(10,10,10,R*Math.cos(10*rad),R*Math.sin(10*rad)),box(10,10,10,R*Math.cos(second*rad),R*Math.sin(second*rad)))},{id:'tool',group:'arm',tool:true,positions:box(2,20,20,R,0)}];
 const model=buildCollisionModel(machine,defs),distances=[];
 for(const a of [10,(10+second)/2,second,20]){poseModel(model,[0,0,0,a]);distances.push({a,d:pairDistance(model.bodies[0]!,model.bodies[1]!,20,2)});}
 const angles=suffix?[(10+second)/2,15,20]:[5,10,15,20];
 const track:CollisionTrack={pos:new Float32Array(angles.length*3),abc:new Float32Array(angles.flatMap(a=>[a,0,0])),cum:new Float32Array(angles.map(a=>a-angles[0]!)),lines:new Uint32Array(suffix?[1,3,4]:[1,2,3,4]),rapid:new Uint8Array(angles.map((_,i)=>!suffix&&i<=1?0:1)),count:angles.length};
 const result=sweepCollisions(model,track,wcs,{margin:2,...fine?{linStepMm:.25,rotStepDeg:.25}:{}});
 return {second,fine,suffix,distances,result};
}
it('a feed-to-rapid recontact remains detected when the next coarse query is touching again',()=>{
 const cases=[13,14.5,15,15.5].map(second=>({standard:run(second),fine:run(second,true),suffix:run(second,false,true)}));
 writeFileSync('../evidence/viewer-palette-fest.r88.touching.json',JSON.stringify(cases,null,2)+'\n');
 const clash=(r:ReturnType<typeof run>)=>r.result.hits.some(h=>h.rapid&&h.line===3&&h.dist<=1e-4);
 expect(cases.every(r=>clash(r.fine)&&clash(r.suffix)),'controls: finer queries or the independently checked suffix after the gap').toBe(true);
 expect(cases.every(r=>clash(r.standard)),'production defaults, every phase of the second block').toBe(true);
});
