import { ContactStore, NONE, IV_ENTER_DECIDED, IV_EXIT_DECIDED } from './src/viewer/contactStore';
import { buildContactView, heldBytes, targetAt, codexInspectLastGroup } from './src/viewer/contactView';
const n=Number(process.env.R152_N??65536);
function gen(g:number){
 const s=new ContactStore(1,g);let ep=-1,last=-1;
 for(let i=0;i<n;i++){
  if(i%4===0){ep=s.episodes.append({pair:0,ordinal:i/4,flags:0,onset:3*i,end:3*(i+3)+1,closeAt:3*i,closeDist:0,firstIv:NONE,ivCount:4});last=-1;}
  const iv=s.intervals.append({episode:ep,enter:3*i,exit:3*i+1,witness:3*i+.5,flags:IV_ENTER_DECIDED|IV_EXIT_DECIDED,freeAt:3*i+2,freeR:.25,next:NONE});
  if(last<0)s.episodes.set(ep,'firstIv',iv);else s.intervals.set(last,'next',iv);last=iv;
 }
 return s;
}
const h=gen(0),c=gen(1);const t0=performance.now();
const v=buildContactView({sources:[{stores:[c],held:[h],at:x=>x,ownCoverage:n*3}],pairName:()=>({a:'tool',b:'work'}),coverage:n*3});
const buildMs=performance.now()-t0;
(globalThis as any).gc();const heapBefore=process.memoryUsage().heapUsed;
let checksum=0;const t1=performance.now();for(let i=0;i<v.n;i++)checksum+=targetAt(v,i,()=>1).cum;
const queryAllMs=performance.now()-t1;(globalThis as any).gc();const heapAfter=process.memoryUsage().heapUsed;
const secondStart=performance.now(); for(let i=0;i<v.n;i++) checksum+=targetAt(v,i,()=>1).cum;
const secondMs=performance.now()-secondStart; (globalThis as any).gc(); const heapSecond=process.memoryUsage().heapUsed;
console.log(JSON.stringify({secondMs,heapSecond,secondRetainedGrowth:heapSecond-heapAfter,n,vn:v.n,heldBytes:heldBytes(v),buildMs,queryAllMs,checksum,heapBefore,heapAfter,retainedHeapGrowth:heapAfter-heapBefore,cache:codexInspectLastGroup(v)},null,2));
