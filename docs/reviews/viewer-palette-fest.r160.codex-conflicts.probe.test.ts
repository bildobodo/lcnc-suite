import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {ContactStore,ColumnTable,REQUEST_BUDGET,IV_ENTER_DECIDED,IV_EXIT_DECIDED,IV_ENDED_AT_FEED,NONE} from './contactStore';
import {buildContactView,buildContactViewSteps,findKey,targetKey,targetEnd,viewWork} from './contactView';
import {STEP_OPS} from './steps';
import {unionScratch} from './contactUnion';
const D=IV_ENTER_DECIDED|IV_EXIT_DECIDED;
function input(n:number, r:number) {
 const mk=(gen:number)=>{
  const st=new ContactStore(1,gen,REQUEST_BUDGET);
  for(let k=0;k<n;k++) {
   const a=4*k+2*gen;
   const e=st.episodes.append({pair:0,ordinal:k,flags:0,onset:a,end:a+2.5,closeAt:a+1,closeDist:0,firstIv:NONE,ivCount:1});
   st.episodes.set(e,'firstIv',st.intervals.append({episode:e,enter:a,exit:a+2.5,flags:D,next:NONE,witness:a+1,freeAt:a+3,freeR:r}));
  }
  return st;
 };
 const held=mk(0),cur=mk(1),cov=4*n+4;
 return {sources:[{stores:[cur],held:[held],heldCoverage:[cov],ownCoverage:cov,at:(x:number)=>x}],pairName:()=>({a:'tool',b:'stock'}),coverage:cov};
}
it('a handed-over key is bounded even when free samples are refuted on their point',()=>{
 const results=[];
 for(const n of [1024,8192]){
  const v=buildContactView(input(n,.1));
  expect(v.n).toBe(1);expect(targetEnd(v,0)).toBe(4*n+.5);
  const key=`C0|${n-1}|0`;
  const get=ColumnTable.prototype.get;let reads=0;
  ColumnTable.prototype.get=function(...a:Parameters<typeof get>){reads++;return get.apply(this,a);};
  const w=viewWork.n;let found=-1;
  try {found=findKey(v,key);} finally {ColumnTable.prototype.get=get;}
  const measuredReads=reads+viewWork.n-w;
  results.push({n,key,found,carriedKey:targetKey(v,found),reads:measuredReads,conflicts:v.conflicts.count});
  expect(found).toBe(0);
 }
 writeFileSync(`${process.env.R160_OUT}/conflicts-keys.json`,JSON.stringify(results,null,2)+'\n');
 expect(results[1]!.reads,'same 1.5x+256 query-cost contract').toBeLessThanOrEqual(1.5*results[0]!.reads+256);
});
it.each([['refuted point samples',0],['no free samples',NaN]] as const)('the build counts scratch reads even for %s',(_,radius)=>{
 const results=[];
 for(const n of Number.isNaN(radius)?[1024,32768]:[1024,8192]) {
  const data=input(n,radius);
  if(Number.isNaN(radius)) {
   // Normal cutter rapid parts ending at feed: no free sample. An empty
   // rerun keeps the old intervals, without any cross-run contradiction.
   data.sources[0]!.stores=[new ContactStore(1,1,REQUEST_BUDGET)];
   const st=data.sources[0]!.held[0]!;
   for(let k=0;k<st.intervals.rows;k++) {st.intervals.set(k,'freeAt',NaN);st.intervals.set(k,'flags',IV_ENTER_DECIDED|IV_ENDED_AT_FEED);}
  }
  const scratch=unionScratch();
  // Warm the capacities, then count real reads from the reusable scratch.
  const warm=buildContactViewSteps(data,scratch);while(!warm.next().done){}
  let reads=0;
  for(const side of scratch.sides) for(const key of ['enter','end','witness','freeAt','freeR','flags'] as const){
   const ary=side[key];side[key]=new Proxy(ary,{get(t,p){if(typeof p==='string'&&/^\d+$/.test(p))reads++;return Reflect.get(t,p,t);}}) as never;
  }
  let most=0,steps=0,targets=0;
  const job=buildContactViewSteps(data,scratch);
  for(;;) {reads=0;const r=job.next();most=Math.max(most,reads);steps++;if(r.done){targets=r.value.n;break;}}
  results.push({n,most,steps,targets,budget:4*STEP_OPS});expect(targets).toBe(Number.isNaN(radius)?n:1);
 }
 writeFileSync(`${process.env.R160_OUT}/build-${Number.isNaN(radius)?'absent':'refuted'}.json`,JSON.stringify(results,null,2)+'\n');
 expect(results[1]!.most,'scratch reads between two generator steps').toBeLessThanOrEqual(4*STEP_OPS);
});

it('one free sample after a long opposite run counts the predecessor walk inside that sample',()=>{
 const results=[];
 for(const n of [1024,32768]) {
  const held=new ContactStore(1,0,REQUEST_BUDGET),cur=new ContactStore(1,1,REQUEST_BUDGET);
  const add=(st:ContactStore,a:number,b:number,freeAt:number,flags:number)=>{
   const ep=st.episodes.append({pair:0,ordinal:st.episodes.rows,flags:0,onset:a,end:b,closeAt:a,closeDist:0,firstIv:NONE,ivCount:1});
   st.episodes.set(ep,'firstIv',st.intervals.append({episode:ep,enter:a,exit:b,flags,next:NONE,witness:a+.5,freeAt,freeR:.25}));
  };
  add(held,0,4*n,4*n+1,D);
  for(let k=0;k<n;k++)add(cur,4*k,4*k+1,NaN,IV_ENTER_DECIDED|IV_ENDED_AT_FEED);
  const data={sources:[{stores:[cur],held:[held],heldCoverage:[4*n+2],ownCoverage:4*n+2,at:(x:number)=>x}],coverage:4*n+2,pairName:()=>({a:'tool',b:'stock'})};
  const scratch=unionScratch();const warm=buildContactViewSteps(data,scratch);while(!warm.next().done){}
  let reads=0;
  for(const side of scratch.sides)for(const key of ['enter','end','witness','freeAt','freeR','flags'] as const){
   side[key]=new Proxy(side[key],{get(t,p){if(typeof p==='string'&&/^\d+$/.test(p))reads++;return Reflect.get(t,p,t);}}) as never;
  }
  const job=buildContactViewSteps(data,scratch);let most=0,targets=0;
  for(;;){reads=0;const r=job.next();most=Math.max(most,reads);if(r.done){targets=r.value.n;break;}}
  results.push({n,most,targets,budget:4*STEP_OPS});expect(targets).toBe(1);
 }
 writeFileSync(`${process.env.R160_OUT}/build-sparse.json`,JSON.stringify(results,null,2)+'\n');
 expect(results[1]!.most,'predecessor walk inside one free sample').toBeLessThanOrEqual(4*STEP_OPS);
});
