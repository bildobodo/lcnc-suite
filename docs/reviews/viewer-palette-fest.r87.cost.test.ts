import {it,expect} from 'vitest';
import * as THREE from 'three';
import {buildCollisionModel,sweepCollisionsIter,withoutArealessFacets,type CollisionMachine} from './collision';
import {buildCollisionModel as oldBuild,sweepCollisionsIter as oldIter} from './r87.old-collision';
import {writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const box=(w:number,h:number,d:number,x:number,y:number)=>{const g=new THREE.BoxGeometry(w,h,d).translate(x,y,0).toNonIndexed();const a=new Float32Array(g.getAttribute('position').array);g.dispose();return a;};
const join=(...a:Float32Array[])=>{const r=new Float32Array(a.reduce((s,p)=>s+p.length,0));let k=0;for(const p of a){r.set(p,k);k+=p.length;}return r;};
const machine:CollisionMachine={groups:[{id:'frame',parent:'root'},{id:'slide',parent:'root'}],kinematics:[{group:'slide',joint:0,type:'translate',direction:'x',sign:1}],workGroup:'frame',toolGroup:'slide',unitScale:1,axes:['X','Y','Z']};
const rows:any[]=[];
it('cost on many short contacts, measured on analytic bodies, not a machine command',()=>{
 for(const bumps of [30,100,200])for(const variant of ['before','after']){
  const end=120+bumps*12;
  const defs=[{id:'wall',group:'frame',positions:join(box(end-20,10,10,(end+20)/2,11.5),...Array.from({length:bumps},(_,i)=>box(1,2.5,10,100.5+i*12,5.25)))},{id:'slide',group:'slide',positions:box(1,10,10,0,0)}];
  const track={pos:new Float32Array([48,0,0,end,0,0]),abc:new Float32Array(6),cum:new Float32Array([0,end-48]),lines:new Uint32Array([1,2]),rapid:new Uint8Array(2),count:2};
  const build=variant==='before'?oldBuild:buildCollisionModel,run=variant==='before'?oldIter:sweepCollisionsIter;
  const model=build(machine,defs),it=run(model as any,track,{g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0},{margin:2});
  let result:any,maxResumeMs=0,resumes=0;const t0=performance.now();
  for(;;){const start=performance.now(),step=it.next();maxResumeMs=Math.max(maxResumeMs,performance.now()-start);resumes++;if(step.done){result=step.value;break;}}
  rows.push({bumps,variant,elapsedMs:performance.now()-t0,maxResumeMs,resumes,samples:result.samples,hits:result.hits.length,truncated:result.truncated});
  expect(result.truncated).toBeNull();
 }
 writeFileSync('../evidence/viewer-palette-fest.r87.cost.json',JSON.stringify(rows,null,2)+'\n');
});
it('the new threshold retains all shipped collision facets',()=>{
 const root=resolve(__dirname,'../../..'),rows=[];
 for(const rel of ['lcnc-gateway/machine','examples/sim_config/machine-5axis-xyzac','examples/sim_config/machine-xyzacb-gantry']){
  const dir=resolve(root,rel),model=JSON.parse(readFileSync(resolve(dir,'machine.json'),'utf8'));
  for(const p of model.parts){if(p.collide===false)continue;const buf=readFileSync(resolve(dir,p.collision||p.file)),n=buf.readUInt32LE(80),a=new Float32Array(n*9);
   for(let i=0;i<n;i++)for(let j=0;j<9;j++)a[9*i+j]=buf.readFloatLE(84+50*i+12+4*j);
   rows.push({model:rel,body:p.id,triangles:n,dropped:withoutArealessFacets(a).dropped});
  }
 }
 writeFileSync('../evidence/viewer-palette-fest.r87.shipped-filter.json',JSON.stringify(rows,null,2)+'\n');
 expect(rows.every(r=>r.dropped===0)).toBe(true);
});
