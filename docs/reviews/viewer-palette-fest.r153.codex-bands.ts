// Codex R153: the bounded timeline result remains in Vue's computed value.
// Uses the same expression as ScrubBar.vue:1025, with an unchanged view.
import { computed } from 'vue';
import { writeFileSync } from 'node:fs';
import { ContactStore, IV_ENTER_DECIDED, IV_EXIT_DECIDED, NONE, REQUEST_BUDGET, shareOf } from './contactStore';
import { buildContactView, contactBands, derivationBound, heldBytes } from './contactView';
const st = new ContactStore(1,0);
for(let i=0;i<4096;i++) {
 const at=2*i+.25;
 const e=st.episodes.append({pair:0,ordinal:i,flags:0,onset:at,end:at,closeAt:at,closeDist:0,firstIv:NONE,ivCount:1});
 st.episodes.set(e,'firstIv',st.intervals.append({episode:e,enter:at,exit:at,witness:at,freeAt:NaN,freeR:0,flags:IV_ENTER_DECIDED|IV_EXIT_DECIDED,next:NONE}));
}
const v=buildContactView({sources:[{stores:[st],at:x=>x,ownCoverage:8192}],coverage:8192,pairName:()=>({a:'tool',b:'work'})});
let evaluations=0;
const bands=computed(()=>{ evaluations++; return contactBands(v,8192,8192).map(([a,b])=>[a*100,b*100]); });
const result=bands.value;
const report={targets:v.n,bandCount:result.length,evaluations,secondReadIsSameArray:bands.value===result,bandNumberPayloadBytes:result.length*2*8,viewHeldBytes:heldBytes(v),bound:derivationBound(REQUEST_BUDGET,shareOf(REQUEST_BUDGET,8)),note:'Numeric payload only; JavaScript array/object overhead and transient build buffers are separate. Maximum runs = ceil(8192/2).'};
if(result.length!==4096 || bands.value!==result || evaluations!==1) throw Error('unexpected band result');
writeFileSync('/tmp/codex-r153-rt47y2tc/bands.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
