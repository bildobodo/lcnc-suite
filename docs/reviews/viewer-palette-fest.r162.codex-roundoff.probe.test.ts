import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {ContactStore,ColumnTable,REQUEST_BUDGET,IV_ENTER_DECIDED,IV_EXIT_DECIDED,NONE} from './contactStore';
import {buildContactView,findKey,targetKey,viewWork} from './contactView';
const D=IV_ENTER_DECIDED|IV_EXIT_DECIDED;
function add(st:ContactStore,pair:number,a:number,b:number,w:number,p:number,r:number,flags=D){
 const ep=st.episodes.append({pair,ordinal:st.episodes.rows,flags:0,onset:a,end:b,closeAt:w,closeDist:0,firstIv:NONE,ivCount:1});
 st.episodes.set(ep,'firstIv',st.intervals.append({episode:ep,enter:a,exit:b,flags,next:NONE,witness:w,freeAt:p,freeR:r}));
}
it('rounding at a confirmed point must not disable the bounded windows for the entire generation',()=>{
 const results=[];
 for(const n of [1024,8192]){
  for(const kind of ['control','exact-binary','decimal']){
   const h=new ContactStore(1,0,REQUEST_BUDGET),c=new ContactStore(1,1,REQUEST_BUDGET);
   for(let k=0;k<n;k++){add(h,0,4*k,4*k+1,4*k+.5,4*k+2,.1);add(c,0,4*k+.1,4*k+.9,4*k+.4,4*k+2,.1);}
   // Unchanged R161 large valid certificate, in another pair.
   add(h,1,0,1,.5,1e6,999999);add(h,1,1e6+1,4e6,3e6,NaN,0,IV_EXIT_DECIDED);
   let rounding:unknown=null;
   if(kind!=='control'){
    const w=kind==='decimal'?.1:.125,p=kind==='decimal'?.9:.875,r=p-w;
    // Two disjoint, completely decided intervals. The free sample belongs
    // to the first and lies before the next entry and next witness.
    add(h,2,0,w,w,p,r);add(h,2,2,2.5,2.25,NaN,0);
    const stored=h.intervals.get(h.intervals.rows-2,'freeR'),d=p-w,cut=Math.min(stored,d);
    rounding={w,p,storedRadius:stored,cut,lower:p-cut,upper:p+cut,belowWitness:p-cut<w};
   }
   const v=buildContactView({sources:[{stores:[c],held:[h],heldCoverage:[5e6],ownCoverage:5e6,at:x=>x}],coverage:5e6,pairName:i=>({a:`a${i}`,b:`b${i}`})});
   const key=`C0|${n-1}|0`,index=findKey(v,key);expect(index).toBeGreaterThanOrEqual(0);expect(targetKey(v,index)).toBe(key);
   const local=(v as unknown as {unions:Array<{gens:Array<{local:boolean}>}>}).unions[0]!.gens.map(g=>g.local);
   const get=ColumnTable.prototype.get;let reads=0;
   ColumnTable.prototype.get=function(...args:Parameters<typeof get>){reads++;return get.apply(this,args);};
   const before=viewWork.n;let found=-1;
   try{found=findKey(v,key);}finally{ColumnTable.prototype.get=get;}
   const cost=reads+viewWork.n-before;
   expect(found).toBe(index);expect(v.conflicts.count).toBe(0);
   results.push({n,kind,key,index,cost,local,rounding});
  }
 }
 writeFileSync(`${process.env.R162_OUT}/roundoff.json`,JSON.stringify(results,null,2)+'\n');
 for(const kind of ['control','exact-binary','decimal']){
  const [small,large]=results.filter(x=>x.kind===kind);
  expect.soft(large!.cost,`${kind}: the local key query stays bounded`).toBeLessThanOrEqual(1.5*small!.cost+256);
 }
});
