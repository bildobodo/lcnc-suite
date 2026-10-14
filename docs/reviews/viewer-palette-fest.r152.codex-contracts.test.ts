import { afterAll, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { ContactStore, IV_ENTER_DECIDED, IV_EXIT_DECIDED, IV_ENDED_AT_GAP, IV_AFTER_UNKNOWN_TOOL, GAP_TOOL_UNKNOWN, NONE } from './contactStore';
import { buildContactView, targetAt, targetKey, targetEnd, tintAt, viewCounts, findKey, contactBands } from './contactView';
import { shownContactView, type ShownSpec } from './shownContacts';
import type { GenerationTables } from './contactsReceiver';
const report:Record<string,unknown>={};
afterAll(()=>writeFileSync('/tmp/codex-r152-706x1qnd/contracts.json',JSON.stringify(report,null,2)+'\n'));
const D=IV_ENTER_DECIDED|IV_EXIT_DECIDED;
interface I {a:number;b:number;w?:number;f?:number;r?:number;flags?:number}
function gen(id:number,g:number,ivs:I[]){
 const s=new ContactStore(id,g);
 for(const [k,v] of ivs.entries()){
  const e=s.episodes.append({pair:0,ordinal:k,flags:0,onset:v.a,end:v.b,closeAt:v.w??v.a,closeDist:0,firstIv:NONE,ivCount:1});
  s.episodes.set(e,'firstIv',s.intervals.append({episode:e,enter:v.a,exit:v.b,witness:v.w??v.a,freeAt:v.f??NaN,freeR:v.r??0,flags:v.flags??D,next:NONE}));
 }
 return s;
}
const names=()=>({a:'tool',b:'work'});
const table=(s:ContactStore,covered?:number[]):GenerationTables=>({generation:s.generation,stores:[s],pairs:[['tool','work']],deltas:1,...(covered?{covered}:{})});
const targets=(v:ReturnType<typeof buildContactView>)=>Array.from({length:v.n},(_,i)=>targetAt(v,i,p=>Math.floor(p)+1));
it('a base contact joined to an entry is still counted once after the base falls back',()=>{
 const base0=gen(1,0,[{a:0,b:3}]), base1=gen(1,1,[{a:0,b:3}]), entry=gen(-1,0,[{a:2,b:NaN}]);
 const current=new Map([[1,table(base1)],[-1,table(entry)]]),held=new Map([[1,table(base0,[1])]]);
 const spec:ShownSpec={base:{id:1,map:{kind:'plus',shift:10},coverage:15,ownEnd:5},side:{id:-1,map:null,coverage:10,ownEnd:10,entry:true,entryEnd:10,sweptToEnd:true},axisEnd:15};
 const before=shownContactView(id=>id===1?table(base0):current.get(id)??null,spec)!;
 const after=shownContactView(id=>current.get(id)??null,spec,undefined,id=>held.get(id)??null)!;
 report.join={before:targets(before),after:targets(after),counts:viewCounts(after),tint:[...tintAt(after,12)]};
 expect(before.n).toBe(1);expect(targetEnd(before,0)).toBe(13);
 expect(after.n,'same joined contact must not reappear as a second base finding').toBe(1);
 expect(targetEnd(after,0)).toBe(13);
});
it('two old contacts separated by a tool-unknown gap retain both navigation identities when fallback has no new evidence',()=>{
 const old=gen(1,0,[{a:0,b:NaN,w:.5,flags:IV_ENTER_DECIDED|IV_ENDED_AT_GAP},{a:3,b:4,w:3.5}]);
 old.gaps.append({pair:0,start:1,end:3,reason:GAP_TOOL_UNKNOWN});
 const empty=gen(1,1,[]);
 const before=buildContactView({sources:[{stores:[old],at:x=>x,ownCoverage:5}],pairName:names,coverage:5});
 const after=buildContactView({sources:[{stores:[empty],held:[old],heldCoverage:[5],at:x=>x,ownCoverage:0}],pairName:names,coverage:5});
 report.separate={before:targets(before),after:targets(after),counts:viewCounts(after)};
 expect(after.n).toBe(before.n);
 for(let i=0;i<before.n;i++)expect(findKey(after,targetKey(before,i))).toBeGreaterThanOrEqual(0);
});
it('an exact free sample stays dark after a union whose free radius is zero',()=>{
 // Uncertainty caused a cautious exit to the left, with one actual free
 // sample at 1; the next generation's coarse contact is split there.
 const old=gen(1,0,[{a:0,b:.5,w:.25,f:1,r:0},{a:1.5,b:2,w:1.75}]);
 const cur=gen(1,1,[{a:0,b:2,w:.25}]);
 const v=buildContactView({sources:[{stores:[cur],held:[old],at:x=>x,ownCoverage:2}],pairName:names,coverage:2});
 report.pointFree={targets:targets(v),tintAtFree:[...tintAt(v,1)],left:[...tintAt(v,.999)],right:[...tintAt(v,1.001)],bands:contactBands(v,2000,2)};
 expect(v.n).toBe(2);expect([...tintAt(v,1)]).toEqual([]);expect([...tintAt(v,.999)]).toHaveLength(2);expect([...tintAt(v,1.001)]).toHaveLength(2);
});
it('two already distinct events meeting at a point gap retain the selected second event on an empty fallback',()=>{
 const old=gen(1,0,[{a:0,b:NaN,w:.5,flags:IV_ENTER_DECIDED|IV_ENDED_AT_GAP},{a:1,b:2,w:1.5,flags:D|IV_AFTER_UNKNOWN_TOOL}]);
 old.episodes.set(0,'end',1);
 old.gaps.append({pair:0,start:1,end:1,reason:GAP_TOOL_UNKNOWN});
 const before=buildContactView({sources:[{stores:[old],at:x=>x,ownCoverage:2}],pairName:names,coverage:2});
 const empty=gen(1,1,[]);
 const after=buildContactView({sources:[{stores:[empty],held:[old],heldCoverage:[2],at:x=>x,ownCoverage:0}],pairName:names,coverage:2});
 const selected=targetKey(before,1);
 report.pointGapIdentity={before:targets(before),after:targets(after),selected,selectedIndex:findKey(after,selected),atGap:[...tintAt(after,1)]};
 expect(before.n).toBe(2);
 expect(findKey(after,selected),'a new empty generation must not drop the selected held event').toBeGreaterThanOrEqual(0);
});
it('a confirmed point more than 1e-3 deep in a free certificate is named even when its radius is below 2e-3',()=>{
 const held=gen(1,0,[{a:1,b:2,w:1.5,flags:0}]);
 const cur=gen(1,1,[{a:0,b:.5,w:.25,f:1.5,r:.0015}]);
 const v=buildContactView({sources:[{stores:[cur],held:[held],at:x=>x,ownCoverage:2}],pairName:names,coverage:2});
 report.conflictThreshold={radius:cur.intervals.get(0,'freeR'),witness:1.5,freeProbe:1.5,conflicts:v.conflicts,tint:[...tintAt(v,1.5)]};
 expect([...tintAt(v,1.5)]).toHaveLength(2);
 expect(v.conflicts.count,'the touch lies about 0.0015 from both edges, beyond the named tolerance').toBeGreaterThan(0);
});

it('a known point between touching tool-unknown stretches stays a separate event after empty fallback',()=>{
 const old=gen(1,0,[{a:0,b:NaN,w:.5,flags:IV_ENTER_DECIDED|IV_ENDED_AT_GAP},{a:2,b:NaN,w:2,flags:IV_ENTER_DECIDED|IV_AFTER_UNKNOWN_TOOL|IV_ENDED_AT_GAP},{a:3,b:4,w:3.5,flags:D|IV_AFTER_UNKNOWN_TOOL}]);
 old.episodes.set(0,'end',1);old.episodes.set(1,'end',2);
 old.gaps.append({pair:0,start:1,end:2,reason:GAP_TOOL_UNKNOWN});
 old.gaps.append({pair:0,start:2,end:3,reason:GAP_TOOL_UNKNOWN});
 const before=buildContactView({sources:[{stores:[old],at:x=>x,ownCoverage:4}],pairName:names,coverage:4});
 const after=buildContactView({sources:[{stores:[gen(1,1,[])],held:[old],heldCoverage:[4],at:x=>x,ownCoverage:0}],pairName:names,coverage:4});
 report.touchingToolGaps={before:targets(before),after:targets(after),selectedIndex:findKey(after,targetKey(before,1))};
 expect(before.n).toBe(3);expect(after.n,'the known point is not new ignorance').toBe(3);
 expect(findKey(after,targetKey(before,1))).toBeGreaterThanOrEqual(0);
});
