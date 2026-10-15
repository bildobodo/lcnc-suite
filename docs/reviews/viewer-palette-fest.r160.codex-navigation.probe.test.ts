import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {ContactStore,IV_ENTER_DECIDED,IV_EXIT_DECIDED,GAP_TOOL_UNKNOWN,NONE} from './contactStore';
import {buildContactView,findKey,indexAfter,indexBefore,targetAt,targetKey} from './contactView';
import {sampleCum,targetAfter,targetBefore} from './findingNav';
const D=IV_ENTER_DECIDED|IV_EXIT_DECIDED;
function add(st:ContactStore,pair:number,a:number,b:number,witness=(a+b)/2){
 const e=st.episodes.append({pair,ordinal:0,flags:0,onset:a,end:b,closeAt:a,closeDist:0,firstIv:NONE,ivCount:1});
 st.episodes.set(e,'firstIv',st.intervals.append({episode:e,enter:a,exit:b,flags:D,next:NONE,witness,freeAt:NaN,freeR:0}));
}
it.each([false,true])('position steps match the plain public navigation rule with ties, folds and unequal extents; union=%s',union=>{
 const mk=(gen:number)=>{const st=new ContactStore(1,gen);
  for(let p=0;p<768;p++) { const a=(p%13)/4, len=p%3===0?0:p%3===1?.0004:3;
   if(p%7===0)st.episodes.append({pair:p,ordinal:0,flags:0,onset:a,end:a,closeAt:a,closeDist:1,firstIv:NONE,ivCount:0});
   else add(st,p,a,a+len);
  }return st;
 };
 const v=buildContactView({sources:[{stores:[mk(1)],...(union?{held:[mk(0)],heldCoverage:[8]}:{}),ownCoverage:8,at:(x:number)=>Math.max(0,x-1)}],coverage:7,pairName:p=>({a:`t${p}`,b:`w${p}`})});
 const list=Array.from({length:v.n},(_,i)=>targetAt(v,i,()=>1));
 let checked=0;
 for(const s of new Set([-1,0,1,7,...list.flatMap(t=>[t.cum,sampleCum(t),sampleCum(t)+1e-8])])) {
  expect(targetKey(v,indexAfter(v,s,null)),`next at ${s}`).toBe(targetAfter(list,s,null)!.key);
  expect(targetKey(v,indexBefore(v,s,null)),`previous at ${s}`).toBe(targetBefore(list,s,null)!.key);
  checked++;
 }
 for(let i=0;i<list.length;i+=37){const t=list[i]!,s=sampleCum(t),sel={key:t.key,pos:s};
  expect(indexAfter(v,s,sel)).toBe((i+1)%v.n);expect(indexBefore(v,s,sel)).toBe((i-1+v.n)%v.n);
 }
 writeFileSync(`${process.env.R160_OUT}/navigation-${union?'union':'plain'}.json`,JSON.stringify({targets:v.n,positions:checked})+'\n');
});
it('no handover to an arbitrary neighbour when only the other run has a separator over the old witness',()=>{
 const held=new ContactStore(1,0),cur=new ContactStore(1,1);add(held,0,0,10,5);
 cur.gaps.append({pair:0,start:4,end:6,reason:GAP_TOOL_UNKNOWN});
 const v=buildContactView({sources:[{stores:[cur],held:[held],heldCoverage:[10],ownCoverage:10,at:(x:number)=>x}],coverage:10,pairName:()=>({a:'tool',b:'stock'})});
 expect(v.n).toBe(2);expect(findKey(v,'C0|0|0')).toBe(-1);
 const targets=Array.from({length:v.n},(_,i)=>targetAt(v,i,()=>1));
 for(let i=0;i<v.n;i++)expect(findKey(v,targets[i]!.key)).toBe(i);
 writeFileSync(`${process.env.R160_OUT}/handover.json`,JSON.stringify({targets,earlierKey:'C0|0|0',found:findKey(v,'C0|0|0')},null,2)+'\n');
});
