import assert from 'node:assert/strict';
import { Prog, MACHINE, WCS, box, buildCollisionModel, toolCylinderPositions } from './lib';
import { sweepCollisionsIter } from '@coll';
import { fs } from './fedpath2';
(globalThis as any).__RULE='S';
const p=new Prog();p.g0({x:50,y:30,z:30});
for(let i=0;i<1100;i++)p.g1({z:30+i%2});
p.g0({z:-6});
for(const pairs of [1,4,16]){
 const model=buildCollisionModel(MACHINE,[...Array.from({length:pairs},(_,i)=>({id:'stock'+i,group:'table',positions:box(-10,110,-10,70,-30,0),stock:true})),{id:'tool',group:'tool',positions:toolCylinderPositions(6,60),tool:true}]);
 assert.equal(model.pairs.length,pairs);fs.asks=fs.steps=fs.maxSteps=0;
 let yields=0,maxAsks=0,maxSteps=0,maxMs=0;
 const it=sweepCollisionsIter(model,p.track(),WCS as any,{margin:2,yieldMs:0});
 for(;;){const a=fs.asks,s=fs.steps,t=performance.now(),r=it.next();const ms=performance.now()-t;
 maxAsks=Math.max(maxAsks,fs.asks-a);maxSteps=Math.max(maxSteps,fs.steps-s);maxMs=Math.max(maxMs,ms);
 if(r.done){console.log(JSON.stringify({pairs,yields,maxAsks,maxSteps,maxMs,asks:fs.asks,steps:fs.steps,samples:r.value.samples}));break;}yields++;}
}
