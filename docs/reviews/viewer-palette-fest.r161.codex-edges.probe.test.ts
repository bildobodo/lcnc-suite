import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {ContactStore,ColumnTable,REQUEST_BUDGET,IV_ENTER_DECIDED,IV_EXIT_DECIDED,NONE} from './contactStore';
import {buildContactView,findKey,targetKey,viewWork} from './contactView';
import {eachPieceSteps,unionReach,NO_SEPARATORS,PROTECT,type UnionSide} from './contactUnion';
import {runToEnd} from './steps';
const D=IV_ENTER_DECIDED|IV_EXIT_DECIDED;
const out=(name:string,x:unknown)=>writeFileSync(`${process.env.R161_OUT}/${name}.json`,JSON.stringify(x,null,2)+'\n');
function add(st:ContactStore,pair:number,a:number,b:number,w:number,p:number,r:number,flags=D){
 const ep=st.episodes.append({pair,ordinal:st.episodes.rows,flags:0,onset:a,end:b,closeAt:w,closeDist:0,firstIv:NONE,ivCount:1});
 st.episodes.set(ep,'firstIv',st.intervals.append({episode:ep,enter:a,exit:b,flags,next:NONE,witness:w,freeAt:p,freeR:r}));
}
it('an unrelated kept wide stretch must not make a local key search scan every sample',()=>{
 const results=[];
 for(const n of [1024,8192]){
  for(const wide of ['none','other-pair','later-same-pair']){
   const h=new ContactStore(1,0,REQUEST_BUDGET),c=new ContactStore(1,1,REQUEST_BUDGET);
   for(let k=0;k<n;k++) {add(h,0,4*k,4*k+1,4*k+.5,4*k+2,.1);add(c,0,4*k+.1,4*k+.9,4*k+.4,4*k+2,.1);}
   // A valid wide free certificate, ending before the next confirmed witness;
   // its next interval's entry is undecided. Either another pair or a later
   // stretch of the same pair (after all local contacts).
   if(wide!=='none'){
    const pair=wide==='other-pair'?1:0,shift=wide==='other-pair'?0:1e6;
    add(h,pair,shift,shift+1,shift+.5,shift+1e6,999999);
    add(h,pair,shift+1e6+1,shift+4e6,shift+3e6,NaN,0,IV_EXIT_DECIDED);
   }
   const v=buildContactView({sources:[{stores:[c],held:[h],heldCoverage:[5e6],ownCoverage:5e6,at:x=>x}],coverage:5e6,pairName:i=>({a:`a${i}`,b:`b${i}`})});
   const key=`C0|${n-1}|0`,index=findKey(v,key);expect(index).toBeGreaterThanOrEqual(0);expect(targetKey(v,index)).toBe(key);
   const get=ColumnTable.prototype.get;let reads=0;
   ColumnTable.prototype.get=function(...args:Parameters<typeof get>){reads++;return get.apply(this,args);};
   const before=viewWork.n;let found=-1;
   try{found=findKey(v,key);}finally{ColumnTable.prototype.get=get;}
   const cost=reads+viewWork.n-before;
   expect(found).toBe(index);
   results.push({n,wide,key,index,cost,conflicts:v.conflicts.count});
  }
 }
 out('search-windows',results);
 for(const wide of ['none','other-pair','later-same-pair']){
  const [small,large]=results.filter(x=>x.wide===wide);
  expect.soft(large!.cost,`${wide}: the local key query stays bounded`).toBeLessThanOrEqual(1.5*small!.cost+256);
 }
});

interface Iv {a:number;b:number;w:number;ed:boolean;xd:boolean;open:boolean;p:number;r:number}
function side(ivs:Iv[]):UnionSide{
 const reach=unionReach(ivs.length,k=>ivs[k]!.a,k=>ivs[k]!.p,k=>ivs[k]!.r,()=>true);
 return {n:ivs.length,enter:k=>ivs[k]!.a,end:k=>ivs[k]!.b,witness:k=>ivs[k]!.w,enterDecided:k=>ivs[k]!.ed,exitDecided:k=>ivs[k]!.xd,open:k=>ivs[k]!.open,freeAt:k=>ivs[k]!.p,freeR:k=>ivs[k]!.r,afterTool:()=>false,...reach};
}
it('a contradicted sample is named once at its least deep confirmed point, against full enumeration',()=>{
 let seed=161;const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
 let named=0,held=0,cases=0;
 for(let j=0;j<2500;j++){
  const gens:Iv[][]=[[],[]];
  for(const ivs of gens){let x=-10;
   for(let k=0;k<2+Math.floor(rnd()*25);k++){
    const a=x,b=a+Math.floor(rnd()*12)/4,w=a+(b-a)*Math.floor(rnd()*5)/4;
    const p=b+Math.floor(rnd()*8)/4;
    ivs.push({a,b,w,ed:rnd()<.5,xd:rnd()<.5,open:false,p:rnd()<.2?NaN:p,r:[0,.0009,.001,.0015,.25,1,3,1e7][Math.floor(rnd()*8)]!});x=p+Math.floor(rnd()*5)/4;
   }
   // Only the last may be open; it still has its finite coverage endpoint.
   if(rnd()<.5){ivs[ivs.length-1]!.open=true;ivs[ivs.length-1]!.p=NaN;}
  }
  const pts=gens.flatMap(g=>g.flatMap(iv=>[iv.w,...(iv.ed?[iv.a]:[]),...(iv.xd&&!iv.open?[iv.b]:[])]));
  const expected:number[]=[],expectedHeld:string[]=[];
  gens.forEach((g,si)=>g.forEach((iv,k)=>{
   if(Number.isNaN(iv.p))return;
   if(!pts.includes(iv.p))expectedHeld.push(`${si}:${k}`);
   if(iv.r<=PROTECT)return;
   const deep=pts.filter(x=>x-(iv.p-iv.r)>PROTECT && iv.p+iv.r-x>PROTECT);
   if(deep.length)expected.push(Math.min(...deep));
  }));
  const actual:number[]=[],actualHeld:string[]=[];
  runToEnd(eachPieceSteps(gens.map(side),NO_SEPARATORS,()=>{},x=>actual.push(x),undefined,undefined,undefined,(s,k)=>actualHeld.push(`${s}:${k}`)));
  expect(actual,`seed161 case${j} conflicts`).toEqual(expected);
  expect(actualHeld,`seed161 case${j} kept`).toEqual(expectedHeld);
  named+=actual.length;held+=actualHeld.length;cases++;
 }
 out('conflict-enumeration',{seed:161,cases,named,held});
});
