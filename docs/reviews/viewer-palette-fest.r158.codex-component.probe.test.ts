import {expect,it} from 'vitest';
import {eachPieceSteps, NO_SEPARATORS, unionScratch, type UnionSide} from './contactUnion';
import {STEP_OPS,runToEnd} from './steps';
// One coarse held contact, and a finer rerun: disjoint current contacts with
// a proven free sample after every one. Each side obeys the documented order.
it.each([20_000,262_144])('bounds scratch reads inside a single connected component (n=%i)',(n)=>{
 const held:UnionSide={n:1,enter:()=>0,end:()=>4*n,open:()=>false,witness:()=>0.5,
 enterDecided:()=>false,exitDecided:()=>false,afterTool:()=>false,freeAt:()=>NaN,freeR:()=>NaN,back:0,front:0};
 const cur:UnionSide={n,enter:k=>4*k,end:k=>4*k+1,open:()=>false,witness:k=>4*k+0.5,
 enterDecided:()=>true,exitDecided:()=>true,afterTool:()=>false,freeAt:k=>4*k+2,freeR:()=>0.25,back:0,front:0};
 const scratch=unionScratch();
 runToEnd(eachPieceSteps([held,cur],NO_SEPARATORS,()=>{},undefined,scratch)); // allocate reusable scratch
 let reads=0,most=0,steps=0,pieces=0;
 // Count existing array reads, no injected delay or altered production code.
 for(const s of scratch.sides) for(const key of ['enter','end'] as const){
  s[key]=new Proxy(s[key],{get(t,p){if(typeof p==='string' && /^\d+$/.test(p))reads++;return Reflect.get(t,p,t);}});
 }
 const job=eachPieceSteps([held,cur],NO_SEPARATORS,()=>{pieces++;},undefined,scratch);
 for(;;){reads=0;const r=job.next();most=Math.max(most,reads);steps++;if(r.done)break;}
 console.log('r157 component',JSON.stringify({n,steps,pieces,most,budget:STEP_OPS}));
 expect(pieces).toBeGreaterThan(n);
 expect(most,'no whole connected component before the next yield (same 4x allowance as existing read guard)').toBeLessThanOrEqual(4*STEP_OPS);
});
