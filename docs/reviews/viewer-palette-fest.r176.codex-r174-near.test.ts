import { it, expect } from 'vitest';
import fs from 'node:fs';
import { buildCollisionModel, sweepCollisionsIter, type CollisionMachine, type CollisionTrack } from './collision';
import { boxPositions } from './collisionFixtures';
import { ContactStore } from './contactStore';
const machine: CollisionMachine = { groups: [{id:'fixed',parent:'root'},{id:'moving',parent:'root'},{id:'spinner',parent:'root'}], kinematics:[{group:'moving',joint:0,type:'translate',direction:'x',sign:1},{group:'spinner',joint:3,type:'rotate',direction:'z',sign:1}],workGroup:'fixed',toolGroup:'moving',unitScale:1,axes:['X','Y','Z','A'] };
const wcs:any={g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0};
it('reports how much work can run without a checkpoint when a fast near stretch becomes slow',()=>{
 const out:any[]=[];
 for(const turns of [360,3600,36000]) for(const lineSample of [true,false]) {
  const model=buildCollisionModel(machine,[{id:'fixed',group:'fixed',positions:boxPositions(2,20,20)},{id:'moving',group:'moving',positions:boxPositions(2,20,20,0,21)}]);
  const track:CollisionTrack={count:3,pos:Float32Array.from([-8,0,0,3.5,0,0,5.5,0,0]),abc:Float32Array.from([0,0,0,0,0,0,turns,0,0]),cum:Float32Array.from([0,11.5,11.5+turns]),lines:Uint32Array.from([10,11,12]),rapid:new Uint8Array(3)};
  const profile:any={}; const store=new ContactStore(1,0);
  const run=sweepCollisionsIter(model,track,wcs,{margin:2,contacts:{store},profile,lineSample,yieldMs:2,maxMs:60000});
  let lastProbes=0,maxProbes=0,maxMs=0,yields=0; const t0=performance.now();let result:any;
  for(;;){const t=performance.now();const n=run.next();maxMs=Math.max(maxMs,performance.now()-t);const ps=Array.from(profile.probes??[]).reduce((a:number,b:any)=>a+b,0);maxProbes=Math.max(maxProbes,ps-lastProbes);lastProbes=ps;if(n.done){result=n.value;break;}yields++;}
  out.push({turns,lineSample,ms:performance.now()-t0,maxSliceMs:maxMs,maxProbesBetweenYields:maxProbes,yields,probes:lastProbes,truncated:result.truncated,episodes:store.episodes.rows});
  expect(result.truncated).toBeNull();
 }
 fs.writeFileSync('/tmp/codex-r176-f1ztm26r/r174-near.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
 expect(out.find(r=>r.turns===3600 && !r.lineSample).maxProbesBetweenYields, 'the new walk must reach a checkpoint within the 512-sample contract').toBeLessThanOrEqual(512);
},60000);

it('honours a deterministic deadline while re-sampling the near stretch',()=>{
 const model=buildCollisionModel(machine,[{id:'fixed',group:'fixed',positions:boxPositions(2,20,20)},{id:'moving',group:'moving',positions:boxPositions(2,20,20,0,21)}]);
 const track:CollisionTrack={count:3,pos:Float32Array.from([-8,0,0,3.5,0,0,5.5,0,0]),abc:Float32Array.from([0,0,0,0,0,0,3600,0,0]),cum:Float32Array.from([0,11.5,3611.5]),lines:Uint32Array.from([10,11,12]),rapid:new Uint8Array(3)};
 const profile:any={};const store=new ContactStore(1,0);
 // One off-main distance query spends one virtual millisecond. This is a work bound, independent of VM scheduling.
 const clock=()=>Array.from(profile.probes??[]).reduce((a:number,b:any)=>a+b,0);
 const run=sweepCollisionsIter(model,track,wcs,{margin:2,contacts:{store},profile,yieldMs:8,maxMs:64,clock});
 let n=run.next();let yields=0;while(!n.done){yields++;n=run.next();}
 const data={virtualMs:clock(),budgetMs:64,yields,truncated:n.value.truncated};
 fs.writeFileSync('/tmp/codex-r176-f1ztm26r/r174-near-budget.json',JSON.stringify(data,null,2));
 expect(clock(), 'the deadline must be checked during the near walk, not after thousands of queries').toBeLessThanOrEqual(96);
},60000);
