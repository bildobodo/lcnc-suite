import {it,expect} from 'vitest';
import {ContactStore,ColumnTable,IV_ENTER_DECIDED,NONE,GAP_UNDECIDABLE,REQUEST_BUDGET} from './contactStore';
import {buildContactView,contactBandsSteps} from './contactView';
import {STEP_OPS} from './steps';
it.each([false,true])('counts and yields inside one contact spanning the entire gap budget, union=%s',(union)=>{
 const n=REQUEST_BUDGET.gaps,end=4*n+1;
 const mk=(g:number)=>{const st=new ContactStore(1,g);const ep=st.episodes.append({pair:0,ordinal:0,flags:0,onset:0,end:NaN,closeAt:0,closeDist:0,firstIv:NONE,ivCount:1});
 st.episodes.set(ep,'firstIv',st.intervals.append({episode:ep,enter:0,exit:NaN,flags:IV_ENTER_DECIDED,next:NONE,witness:0,freeAt:NaN,freeR:0}));
 for(let i=0;i<n;i++)st.gaps.append({pair:0,start:4*i+1,end:4*i+2,reason:GAP_UNDECIDABLE});return st;};
 const cur=mk(1),held=union?mk(0):null;
 const v=buildContactView({sources:[{stores:[cur],...(held?{held:[held],heldCoverage:[end]}:{}),at:x=>x,ownCoverage:end}],pairName:()=>({a:'tool',b:'work'}),coverage:end});
 let reads=0,most=0,steps=0;
 // The view already has its column-block references; wrap their actual cells.
 const restore:Array<()=>void>=[];
 for(const st of [cur,held])if(st)for(const table of [st.episodes,st.intervals,st.gaps]){
  const names=table===st.gaps?['pair','start','end','reason']:table===st.episodes?['pair','flags']:['episode','enter','exit','witness','flags','freeAt','freeR'];
  for(const name of names){const blocks=table.blocksOf(name) as any[];for(let i=0;i<blocks.length;i++){const old=blocks[i];blocks[i]=new Proxy(old,{get(t,k){if(typeof k==='string'&&/^\d+$/.test(k))reads++;return Reflect.get(t,k,t);}});restore.push(()=>{blocks[i]=old;});}}
 }
 const get=ColumnTable.prototype.get;ColumnTable.prototype.get=function(...args:Parameters<typeof get>){reads++;return get.apply(this,args);};
 try{const job=contactBandsSteps(v,1200,end);for(;;){reads=0;const r=job.next();most=Math.max(most,reads);steps++;if(r.done)break;}}
 finally{ColumnTable.prototype.get=get;for(const undo of restore)undo();}
 console.log('r158 bands',JSON.stringify({union,gaps:n,intervals:cur.intervals.rows,steps,most,budget:4*STEP_OPS}));
 expect(most,'the band builder must also split the gaps within a single interval').toBeLessThanOrEqual(4*STEP_OPS);
});
