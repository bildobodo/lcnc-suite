import {sweepCollisionsIter as normal,sweepCollisions} from './src/viewer/collision';
import {sweepCollisionsIter as forced} from './src/viewer/collisionR497Forced';
import {sweepCollisionsIter as removed} from './src/viewer/collisionR497NoRestore';
import {start,modelOf,WCS,digest,Prog} from './src/viewer/stockMuteHarness';
import {ContactStore} from './src/viewer/contactStore';
const opts={tloEvents:[{seq:0,xyz:[0,0,0],tool:1},{seq:1,xyz:[0,0,0],tool:2},{seq:2,xyz:[0,0,4],tool:1}],toolDims:{1:{diam:6,len:60},2:{diam:12,len:60}},liveTool:1};
const cases=[];
for (const what of ['tool','offset','relabel','unknown'] as const) for(const z of [.5,1.5]){
 const p=start().g0({z}).g0({x:51});
 if(what==='tool')p.tlo=1; if(what==='offset')p.tlo=2;
 p.g0({x:52});if(what==='relabel'||what==='unknown')Object.assign(p.pts.at(-1)!,{brk:true,ustart:what==='unknown'});
 const t=p.g0({z:-3}).g0({z:15}).track();
 const one=(fn:typeof normal, perturb:boolean)=>{
  const m=modelOf({stocks:4}),st=new ContactStore(1,0);
  (globalThis as any).__R497_forced=0;
  const it=fn(m,t,WCS as any,{...opts,margin:2,contacts:{store:st},clock:()=>0,yieldMs:1e9} as any);
  for(let r=it.next();!r.done;r=it.next())if(perturb){
   sweepCollisions(m,new Prog().g0({x:300,y:20,z:100}).g0({x:400,y:20,z:200}).track(),WCS as any,{margin:2});
  }
  return {table:digest(st),forced:(globalThis as any).__R497_forced};
 };
 const base=one(normal,false),yes=one(forced,true),no=one(removed,true);
 cases.push({what,z,forced:yes.forced,removedForced:no.forced,sameWithRestore:base.table===yes.table,sameWithoutRestore:base.table===no.table});
}
console.log(JSON.stringify({cases},null,2));
