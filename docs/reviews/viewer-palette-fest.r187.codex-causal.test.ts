// Review-only causal chain through the real collector and unchanged viewer function.
import './testGlobals';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync,writeFileSync } from 'node:fs';
import ts from 'typescript';
const events: any[]=[];
vi.mock('./ws/telemetry',()=>({emitTelemetry:(tag:string,row:any)=>events.push({tag:`browser.${tag}`,page:'P',...row})}));
import { noteHeartbeatReply,noteHeartbeatSentAt,setWitnessTickSink,resetViewerPerf,flushViewerPerf,recordApply } from './viewerPerf';
const source=readFileSync(new URL('./ThreeViewer.vue',import.meta.url),'utf8');
const start=source.indexOf('function _colNoteWitness('),end=source.indexOf('/** A witness tick',start);
if(start<0||end<start)throw Error('Cannot locate unchanged viewer consumer');
const js=ts.transpile(source.slice(start,end),{target:ts.ScriptTarget.ES2022});
const out:Record<string,any>={};
const T0=performance.timeOrigin;
beforeEach(()=>{resetViewerPerf();events.length=0;});
afterEach(()=>{setWitnessTickSink(null);writeFileSync('/tmp/codex-r187-b4k897uq/causal-evidence.json',JSON.stringify(out,null,2));});
it('a word not yet delivered to the WS worker cannot attach itself to an earlier heartbeat',()=>{
  const ticks:number[]=[],queued:any[]=[];
  setWitnessTickSink(t=>ticks.push(t));
  const note=new Function('_colRunReqs','emitTelemetry','noteWitnessDone',`let _colWitnessN=0; ${js}; return _colNoteWitness;`)(
    new Map([[42,{gen:7,range:0}]]),
    (tag:string,row:any)=>events.push({tag:`browser.${tag}`,page:'P',...row}),
    (tick:number,n:number)=>queued.push({tick,n}),
  );
  // A answered; the page issues tick 1. Browser clock offset does not enter R.
  noteHeartbeatSentAt(T0+20100,1,0,0);noteHeartbeatReply(T0+20200,10,1,10150,1);
  expect(ticks).toEqual([1]);
  // The real worker's before/after slice protocol is covered by its repository
  // and browser tests. Here a completed slice returns that tick to the real consumer.
  note(42,{shard:0,gen:1,tick:ticks[0]});
  expect(queued).toEqual([{tick:1,n:1}]);
  // B already left before this queued word reaches the WS worker.
  noteHeartbeatSentAt(T0+20400,2,0,0);noteHeartbeatReply(T0+20500,10,2,10450,1);
  // C is later, after delivery. Its captured send metadata must link the word.
  const w=queued.shift();
  noteHeartbeatSentAt(T0+20800,3,w.tick,w.n);noteHeartbeatReply(T0+20900,10,3,10850,1);
  recordApply(1,21000);flushViewerPerf();
  const row=events.find(e=>e.tag==='browser.viewer.perf');
  expect(row.hb_pairs.map((p:any)=>[p.seq,p.ta,p.dt,p.dn])).toEqual([[1,1,0,0],[2,2,0,0],[3,3,1,1]]);
  const word=events.find(e=>e.tag==='browser.collision.sweep_witness');
  expect(word).toMatchObject({id:42,run_gen:7,shard:0,tick:1,n:1});
  expect(word).not.toHaveProperty('s');expect(word).not.toHaveProperty('ahead_ms');
  out.delayedWord={events,actualSlice:[10250,10300],actualParse:[10000,11000]};
});
