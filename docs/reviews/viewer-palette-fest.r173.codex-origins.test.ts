import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { ColumnTable, ContactStore, GAP_UNDECIDABLE, GAP_TOOL_UNKNOWN } from './contactStore';
import { buildContactView, displayLineAt, undecidableNote, undecidableStretchesSteps } from './contactView';
import { buildShownSteps, type ShownSpec } from './shownContacts';
import type { GenerationTables } from './contactPublisher';
import { Grow, runToEnd, STEP_OPS, withMeter } from './steps';

const output = process.env.R173_OUT!;
const pairs: [string, string][] = [['spindle', 'stock'], ['holder', 'machine'], ['A', 'C'], ['A', 'B']];
const track = (side: boolean, call: boolean) => ({ count: 11, cum: Float64Array.from({length:11}, (_,i)=>i*10),
 lines: Uint32Array.from({length:11},(_,i)=>side ? i+1 : 100+i), lineOk: new Uint8Array(11).fill(side?0:1),
 cline: new Uint16Array(11).fill(side&&call?7:0), sub: new Uint8Array(11).fill(side?0:255), subNames: ['touch'] });

it('R173: the full builder keeps independent origins and unions both generations and shards within each origin', () => {
 let seed=0x173;
 const rng=()=>{ seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32; };
 const cases: object[]=[];
 for(let scenario=0;scenario<48;scenario++) {
  const baseTrack=track(false,false), sideTrack=track(true,!!(scenario%2));
  const baseLine=displayLineAt(baseTrack,true), sideLine=displayLineAt(sideTrack,true);
  const spec:ShownSpec={base:{id:1,map:null,coverage:100,ownEnd:100,ownCoverage:70},
   side:{id:2,map:{kind:'minus',shift:100},coverage:0,ownEnd:100,ownCoverage:60,track:sideTrack,linesTrusted:true},axisEnd:100};
  const current=new Map<number,GenerationTables>(),held=new Map<number,GenerationTables>();
  const raw=new Map<string,Array<[number,number]>>();
  for(const id of [1,2]) for(const gen of [0,1]) {
   const cov=gen===0?100:id===1?70:60;
   const stores:ContactStore[]=[];
   for(let shard=0;shard<2;shard++) {
    const rows=[];
    for(let k=0;k<32;k++) {
     const pair=Math.floor(rng()*4),start=Math.floor(rng()*100);
     const end=k%7?Math.min(100,start+Math.floor(rng()*10)):NaN;
     const reason=k%6?GAP_UNDECIDABLE:GAP_TOOL_UNKNOWN;
     rows.push({pair,start,end,reason});
     if(reason!==GAP_UNDECIDABLE||start>cov)continue;
     const key=`${id}:${pair}`, spans=raw.get(key)??[];
     spans.push([start,Math.max(start,Math.min(cov,Number.isNaN(end)?cov:end))]);raw.set(key,spans);
    }
    const st=new ContactStore(id,gen);
    for(const r of (scenario%2?rows.reverse():rows))st.gaps.append(r);
    stores.push(st);
   }
   (gen?current:held).set(id,{generation:gen,stores,pairs,deltas:1,...(gen===0?{covered:[1,1]}:{})});
  }
  const expected=[...raw].map(([key, spans])=>{
   const union:Array<[number,number]>=[];
   for(const [s,e] of spans.sort((a,b)=>a[0]-b[0]||a[1]-b[1])) {
    const p=union.at(-1);if(p&&s<=p[1]+1e-9)p[1]=Math.max(e,p[1]);else union.push([s,e]);
   }
   return {key,spans:union.slice(0,3),more:union.length>3};
  }).sort((a,b)=>a.key.localeCompare(b.key));
  const sv=runToEnd(buildShownSteps(id=>current.get(id)??null,spec,id=>held.get(id)??null,baseLine,100,100))!;
  const notes=sv.derived!.undecidable!;
  const actual=notes.map(u=>({key:`${u.lineAt?2:1}:${pairs.findIndex(p=>p[0]===u.a&&p[1]===u.b)}`,spans:u.spans,more:u.more})).sort((a,b)=>a.key.localeCompare(b.key));
  expect(actual,`scenario ${scenario}`).toEqual(expected);
  const shownStarts=notes.map(u=>u.lineAt?0:u.spans[0]![0]);
  expect(shownStarts).toEqual([...shownStarts].sort((a,b)=>a-b));
  for(const u of notes) {
   if(u.lineAt) {
    expect(undecidableNote(u,baseLine)).toBe(undecidableNote({...u,lineAt:sideLine},baseLine));
    expect(undecidableNote(u,baseLine)).not.toMatch(/L10\d/);
   } else expect(undecidableNote(u,baseLine)).toMatch(/L10\d/);
  }
  cases.push({scenario,origins:2,shardsPerGeneration:2,gaps:256,groups:notes.length,pass:true});
 }
 writeFileSync(output+'/origins.json',JSON.stringify(cases,null,2)+'\n');
});

it('R173: own-axis grouping retains the bounded reads and metered buffers of the gap derivation',()=>{
 const results=[];
 for(const n of [1024,8192,16384]) {
  const end=n*4, ownLine=(p:number)=>Math.floor(p)+1;
  const source=(id:number,limit:number,own:boolean)=>{
   const stores=[0,1].map(gen=>{
    const st=new ContactStore(id,gen);
    for(let k=0;k<limit;k++) st.gaps.append({pair:0,start:k*4+gen*2,end:k*4+gen*2+0.5,reason:GAP_UNDECIDABLE});
    return st;
   });
   return {stores:[stores[1]!],held:[stores[0]!],heldCoverage:[end],ownCoverage:end,at:own?(_x:number)=>0:(x:number)=>x,
    ...(own?{ownTrack:{lineAt:ownLine,runs:()=>[]}}:{})};
  };
  const v=buildContactView({sources:[source(1,n,false),source(2,n/8,true)],pairName:()=>({a:'spindle',b:'stock'}),coverage:end});
  const get=ColumnTable.prototype.get,at=Grow.prototype.at,sort=Array.prototype.sort;
  let reads=0,worst=0,maxSort=0,steps=0;
  ColumnTable.prototype.get=function(...args){reads++;return get.apply(this,args);};
  Grow.prototype.at=function(i){reads++;return at.call(this,i);};
  Array.prototype.sort=function(...args){maxSort=Math.max(maxSort,this.length);return sort.apply(this,args);};
  const meter={bytes:0};
  try {
   const job=undecidableStretchesSteps(v);
   for(;;){reads=0;const r=withMeter(meter,()=>job.next());worst=Math.max(worst,reads);steps++;
    if(r.done){expect(r.value).toHaveLength(2);for(const u of r.value){expect(u.spans).toEqual([[0,0.5],[2,2.5],[4,4.5]]);expect(u.more).toBe(true);}break;}
   }
  }finally{ColumnTable.prototype.get=get;Grow.prototype.at=at;Array.prototype.sort=sort;}
  expect(worst).toBeLessThanOrEqual(4*STEP_OPS);expect(maxSort).toBe(0);expect(meter.bytes).toBeGreaterThanOrEqual(24*2*(n+n/8));
  results.push({baseGapsPerGeneration:n,sideGapsPerGeneration:n/8,steps,maxReadsPerStep:worst,maxNativeArraySort:maxSort,allocatedBytes:meter.bytes});
 }
 writeFileSync(output+'/bounded-reads.json',JSON.stringify(results,null,2)+'\n');
});
