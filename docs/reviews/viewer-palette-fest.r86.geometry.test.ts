import {it,expect} from 'vitest';
import * as THREE from 'three';
import {ExtendedTriangle} from 'three-mesh-bvh';
import {buildCollisionModel,poseModel,pairDistance,type CollisionMachine} from './collision';
import {triangleDistance} from './triDistance';
import {writeFileSync} from 'node:fs';
const out:Record<string,unknown>={};const save=()=>writeFileSync('../evidence/viewer-palette-fest.r86.geometry.json',JSON.stringify(out,null,2)+'\n');
const vecs=(a:number[][])=>a.map(v=>new THREE.Vector3(...v as [number,number,number])) as [THREE.Vector3,THREE.Vector3,THREE.Vector3];
const machine:CollisionMachine={groups:[{id:'frame',parent:'root'},{id:'slide',parent:'root'}],kinematics:[{group:'slide',joint:0,type:'translate',direction:'x',sign:1}],workGroup:'frame',toolGroup:'slide',unitScale:1,axes:['X','Y','Z']};
it('control: 20000 ordinary Float32 triangle pairs agree with the separate reference',()=>{
 let seed=20261007;const rand=()=>{seed|=0;seed=(seed+0x6d2b79f5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};
 const bad=[];let badCount=0;
 for(let k=0;k<20000;k++){
  const p=()=>new THREE.Vector3(Math.fround((rand()-.5)*20),Math.fround((rand()-.5)*20),Math.fround((rand()-.5)*20));
  const a=[p(),p(),p()] as [THREE.Vector3,THREE.Vector3,THREE.Vector3],b=[p(),p(),p()] as typeof a;
  if(k%7===0){for(const v of b)v.z=0;for(const v of a)v.z=k%14===0?0:1.5;}
  const got=new ExtendedTriangle(...a).distanceToTriangle(new ExtendedTriangle(...b)),want=triangleDistance(a,b);
  if(!Number.isFinite(got)||!Number.isFinite(want)||Math.abs(got-want)>1e-5){badCount++;if(bad.length<10)bad.push({k,got,want,a:a.map(v=>v.toArray()),b:b.map(v=>v.toArray())});}
 }
 out.ordinary={seed:20261007,compared:20000,badCount,bad};save();expect(badCount).toBe(0);
});
it('three distinct collinear Float32 vertices must not create a contact 1.5 millimetres away',()=>{
 const a=[[0,0,0],[4,0,0],[2,0,0]],b=[[0,1.5,0],[2,1.5,0],[1,2.5,0]];
 const ta=new ExtendedTriangle(...vecs(a)),tb=new ExtendedTriangle(...vecs(b));
 const direct=ta.distanceToTriangle(tb);
 const model=buildCollisionModel(machine,[{id:'line',group:'frame',positions:new Float32Array(a.flat())},{id:'triangle',group:'slide',positions:new Float32Array(b.flat())}]);
 poseModel(model,[0,0,0]);
 const viaProduct=pairDistance(model.bodies[0]!,model.bodies[1]!,20,2);
 out.collinear={a,b,analyticDistance:1.5,direct,viaProduct,detectedDegenerate:ta.isDegenerateIntoSegment};save();
 expect(viaProduct).toBeCloseTo(1.5,8);
});
