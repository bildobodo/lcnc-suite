import { afterAll, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { ContactStore, GAP_UNDECIDABLE, NONE, REQUEST_BUDGET, shareOf } from './contactStore';
import { entryJoins, toBaseAxis } from './contactMerge';
import { buildContactView, contactBands, heldBytes, lineMark, targetAt, targetEnd, targetKey, targetPos, tintAt, viewCounts, type ContactSource } from './contactView';
import { findingWords } from './sweepWords';

const results:Record<string,unknown>={};
afterAll(()=>{ if (process.env.R148_REST_RESULTS) writeFileSync(process.env.R148_REST_RESULTS,JSON.stringify(results,null,2)+'\n'); });
const names=(pair:number)=>({a:`t${pair}`,b:`w${pair}`});
const src=(st:ContactStore,props:Partial<ContactSource>={}):ContactSource=>({stores:[st],at:c=>c,...props});
function ep(st:ContactStore,pair:number,ordinal:number,ivs:Array<[number,number]>,onset=ivs[0]![0],end=ivs.at(-1)![1]) {
 const e=st.episodes.append({pair,ordinal,flags:0,onset,end,closeAt:onset,closeDist:0,firstIv:NONE,ivCount:ivs.length});
 let last=NONE;
 for(const [enter,exit]of ivs){const row=st.intervals.append({episode:e,enter,exit,flags:0,witness:enter,freeAt:NaN,next:NONE});
  if(last===NONE)st.episodes.set(e,'firstIv',row);else st.intervals.set(last,'next',row);last=row;}
 return e;
}

it('a gap separate from a contact on the source axis does not erase it when BOTH map to zero',()=>{
 const st=new ContactStore(-1,0);ep(st,0,0,[[1,2]],1,2);
 const make=()=>buildContactView({sources:[src(st,{entry:true,at:c=>toBaseAxis(c,10),coverage:0})],pairName:names,coverage:20});
 const read=(v:ReturnType<typeof make>)=>({n:v.n,pos:targetPos(v,0),key:targetKey(v,0),tint:[...tintAt(v,0)],band:contactBands(v,100,10),mark:lineMark(v,1,[[0,0]])});
 // R149: a view reads its tables as built — read before the write
 const before=read(make());st.gaps.append({pair:0,start:5,end:6,reason:GAP_UNDECIDABLE});const after=make();
 results.collapsedGap={before,after:read(after),sourceContact:[1,2],sourceGap:[5,6],shift:10};
 expect(before.tint.length).toBe(2);expect(after.n).toBe(1);
 expect.soft([...tintAt(after,0)]).toEqual(before.tint);
 expect.soft(contactBands(after,100,10)).toEqual(before.band);
 expect(lineMark(after,1,[[0,0]])).toEqual({line:1});
});

function joined(gapOnBase:boolean) {
 const side=new ContactStore(-1,0),base=new ContactStore(1,0);
 ep(side,0,0,[[3,NaN]],3,NaN);ep(base,0,0,[[0,5]],0,5);
 if(gapOnBase)base.gaps.append({pair:0,start:1,end:2,reason:GAP_UNDECIDABLE});
 const sources=[src(side,{entry:true,entryEnd:10,coverage:10}),src(base,{at:c=>c+10,coverage:15})];
 const joins=entryJoins(side,base);
 return {joins,plain:buildContactView({sources,pairName:names,coverage:15}),view:buildContactView({sources,pairName:names,coverage:15,joins:[{entrySrc:0,baseSrc:1,entryShard:0,baseShard:0,joins}]})};
}
it('positive control: a joined contact without a gap counts once and continues its tint',()=>{
 const x=joined(false);expect(x.joins.size).toBe(1);expect(x.view.n).toBe(1);expect(targetEnd(x.view,0)).toBe(15);expect(tintAt(x.view,11.5).size).toBe(2);
});
it('joining the same event does not fill the base portion\'s knowledge gap',()=>{
 const x=joined(true);expect(x.joins.size).toBe(1);expect(x.view.n).toBe(1);
 const read=(v:typeof x.view)=>({n:v.n,tint:[...tintAt(v,11.5)],bands:contactBands(v,150,15),mark:lineMark(v,20,[[11.25,11.75]])});
 results.joinedGap={unjoined:read(x.plain),joined:read(x.view),baseGapOnAxis:[11,12]};
 expect(tintAt(x.plain,11.5).size).toBe(0);expect(tintAt(x.view,12.5).size).toBe(2);
 expect.soft([...tintAt(x.view,11.5)]).toEqual([]);
 expect(contactBands(x.view,150,15)).toEqual(contactBands(x.plain,150,15));
});

it('the held view keeps one event classification after an existing open near stay gains a contact',()=>{
 const st=new ContactStore(1,0);
 const e=st.episodes.append({pair:0,ordinal:0,flags:0,onset:1,end:NaN,closeAt:2,closeDist:1,firstIv:NONE,ivCount:0});
 const v=buildContactView({sources:[src(st)],pairName:names,coverage:10});
 const read=(w:typeof v)=>({counts:viewCounts(w),target:targetAt(w,0,()=>1),words:findingWords([targetAt(w,0,()=>1)]).text,tint:[...tintAt(w,5)]});
 const before=read(v);
 const iv=st.intervals.append({episode:e,enter:4,exit:6,flags:0,next:NONE,witness:4,freeAt:NaN});
 st.episodes.set(e,'firstIv',iv);st.episodes.set(e,'ivCount',1);st.episodes.set(e,'closeAt',4);st.episodes.set(e,'closeDist',0);
 // R149: the held view never answers from a mixed state — it answers nothing
 expect(()=>read(v)).toThrow(/tables changed since it was built/);
 const rebuilt=read(buildContactView({sources:[src(st)],pairName:names,coverage:10}));
 results.liveNear={before,rebuilt};
 expect(before.counts.nearMisses).toBe(1);expect(before.words).toContain('near miss');
 expect([rebuilt.target.cum, rebuilt.target.dist]).toEqual([4,0]);
 expect(rebuilt.words).toContain('collision');
});

it('all held indices stay within the total budget at a legal high pair count too',()=>{
 function full(id:number,generation:number,side=false) {
  const b=side?shareOf(REQUEST_BUDGET,8):REQUEST_BUDGET,st=new ContactStore(id,generation,b);
  for(let e=0;e<b.episodes;e++){const p=e*4;ep(st,e,0,[[p,p+.25],[p+1,p+1.25],[p+2,p+2.25],[p+3,p+3.25]],p,p+3.25);}
  return st;
 }
 const a=full(1,0),b=full(1,1),c=full(-1,0,true),d=full(-1,1,true);
 const v=buildContactView({sources:[src(a),src(b),src(c,{entry:true}),src(d,{entry:true})],pairName:names,coverage:4*REQUEST_BUDGET.episodes+1});
 // R149: no per-pair maps; heldBytes sums every typed array the view holds
 results.budget={sources:[a,b,c,d].map(s=>({request:s.request,generation:s.generation,episodes:s.episodes.rows,intervals:s.intervals.rows,tableBytes:s.allocatedBytes()})),n:v.n,reportedHeldBytes:heldBytes(v),limit:8_400_000};
 expect(v.n).toBe(2*REQUEST_BUDGET.intervals+2*shareOf(REQUEST_BUDGET,8).intervals);
 expect(heldBytes(v)).toBeLessThanOrEqual(8_400_000);
});
