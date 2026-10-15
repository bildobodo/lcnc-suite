import {it,expect} from 'vitest';
import {ContactStore,IV_ENTER_DECIDED,NONE} from './contactStore';
import {buildContactView,tintAt,targetAt,contactBands,viewCounts} from './contactView';
import {writeFileSync} from 'node:fs';
it('the current generation tints its proven contact beyond the held generation coverage',()=>{
 const mk=(gen:number)=>{const s=new ContactStore(1,gen); const e=s.episodes.append({pair:0,ordinal:0,flags:0,onset:0,end:NaN,closeAt:0,closeDist:0,firstIv:NONE,ivCount:1});
 s.episodes.set(e,'firstIv',s.intervals.append({episode:e,enter:0,exit:NaN,flags:IV_ENTER_DECIDED,next:NONE,witness:0,freeAt:NaN,freeR:0}));return s;};
 const input={sources:[{stores:[mk(1)],held:[mk(0)],heldCoverage:[5],ownCoverage:10,at:(x:number)=>x}],pairName:()=>({a:'tool',b:'stock'}),coverage:10};
 const v=buildContactView(input);
 const out={targets:Array.from({length:v.n},(_,i)=>targetAt(v,i,()=>1)),counts:viewCounts(v),bands:contactBands(v,100,10),tint4:[...tintAt(v,4)],tint7:[...tintAt(v,7)]};
 writeFileSync(`${process.env.R159_OUT}/tint.json`,JSON.stringify(out,null,2)+'\n');
 expect(out.bands).toEqual([[0,1]]);expect(out.tint4.sort()).toEqual(['stock','tool']);
 expect(out.tint7.sort(),'current contact is proven beyond the older coverage').toEqual(['stock','tool']);
});
