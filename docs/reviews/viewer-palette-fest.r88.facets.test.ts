import {it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {ExtendedTriangle} from 'three-mesh-bvh';
import {buildCollisionModel,withoutArealessFacets,geometryNote,sweepCollisions,sweepCollisionsIter,type CollisionMachine} from './collision';
import {triangleDistance} from './triDistance';
import {writeFileSync} from 'node:fs';
const out:Record<string,unknown>={};const save=()=>writeFileSync('../evidence/viewer-palette-fest.r87.facets.json',JSON.stringify(out,null,2)+'\n');
const machine:CollisionMachine={groups:[{id:'frame',parent:'root'},{id:'slide',parent:'root'}],kinematics:[{group:'slide',joint:0,type:'translate',direction:'x',sign:1}],workGroup:'frame',toolGroup:'slide',unitScale:1,axes:['X','Y','Z']};
const line=[0,0,0,4,0,0,2,0,0],valid=[0,-10,0,4,-10,0,2,-9,0],plate=[0,1.5,0,2,1.5,0,1,2.5,0];
const track={pos:new Float32Array([0,0,0,5,0,0]),abc:new Float32Array(6),cum:new Float32Array([0,5]),lines:new Uint32Array([1,2]),rapid:new Uint8Array(2),count:2};
const wcs={g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0};
it('the R86 all-collinear body follows the new explicit unsupported-geometry contract, even in an early abort',()=>{
 const model=buildCollisionModel(machine,[{id:'line',group:'frame',positions:new Float32Array(line)},{id:'plate',group:'slide',positions:new Float32Array(plate)}]);
 const result=sweepCollisions(model,track,wcs,{margin:2});
 const n=65538,t={...track,count:n,pos:new Float32Array(n*3),abc:new Float32Array(n*3),cum:new Float32Array(n),lines:new Uint32Array(n),rapid:new Uint8Array(n)};
 const gen=sweepCollisionsIter(model,t,wcs,{margin:2});gen.next();const early=gen.next(true);
 out.empty={unusable:model.unusable,note:geometryNote(model),result,early};save();
 expect(model.unusable).toEqual(['line']);expect(result.uncertified).toContain('line');expect(early.done).toBe(true);expect((early.value as any).uncertified).toContain('line');
});
it('a non-finite facet in an otherwise usable body is reported as unchecked geometry',()=>{
 const bad=[0,0,0,100,0,0,50,NaN,100];
 const model=buildCollisionModel(machine,[{id:'damaged',group:'frame',positions:new Float32Array([...valid,...bad])},{id:'plate',group:'slide',positions:new Float32Array(plate)}]);
 const result=sweepCollisions(model,track,wcs,{margin:2});
 out.partial={unusable:model.unusable,result};save();expect(result.uncertified, 'partly damaged geometry must not be certified').not.toBeNull();expect(result.uncertified).toContain('damaged');
});
it('thin retained Float32 triangles versus the separate reference, seed 20261007',()=>{
 let seed=20261007;const rand=()=>{seed|=0;seed=(seed+0x6d2b79f5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};
 const bad=[];let retained=0,dropped=0,nanReference=0;
 for(let k=0;k<20000;k++){
  const p=()=>new THREE.Vector3((rand()-.5)*20,(rand()-.5)*20,(rand()-.5)*20);
  const a=[p(),p(),p()],b=[p(),p(),p()];
  a[2]=a[0]!.clone().lerp(a[1]!,.4).addScaledVector(p(),10**(-11+rand()*8));
  const flat=new Float32Array(a.flatMap(v=>v.toArray()));
  if(withoutArealessFacets(flat).dropped){dropped++;continue;}
  for(let i=0;i<3;i++){a[i]!.fromArray(flat,i*3);b[i]!.set(Math.fround(b[i]!.x),Math.fround(b[i]!.y),Math.fround(b[i]!.z));}
  const got=new ExtendedTriangle(...a as [THREE.Vector3,THREE.Vector3,THREE.Vector3]).distanceToTriangle(new ExtendedTriangle(...b as [THREE.Vector3,THREE.Vector3,THREE.Vector3]));
  const want=triangleDistance(a,b);retained++;if(!Number.isFinite(want)){nanReference++;continue;}
  if(!Number.isFinite(got)||Math.abs(got-want)>1e-5)if(bad.length<12)bad.push({k,got,want,a:a.map(v=>v.toArray()),b:b.map(v=>v.toArray())});
 }
 out.slivers={retained,dropped,nanReference,bad};save();expect(bad).toEqual([]);
});
it('worker with no remaining moving pair preserves the missing-body reason',async()=>{
 const sent:any[]=[];vi.stubGlobal('self',{postMessage:(v:any)=>sent.push(v),onmessage:null});
 await import('./collisionWorker');
 (self as any).onmessage({data:{id:87,modelKey:'r87-empty',machine,bodies:[{id:'line',group:'frame',positions:new Float32Array(line)},{id:'plate',group:'slide',positions:new Float32Array(plate)}],tool:null,track,wcs,options:{margin:2}}});
 out.worker=sent;save();expect(sent[0].result.uncertified).toContain('line');expect(sent[0].result.pairCount).toBe(0);vi.unstubAllGlobals();
});
