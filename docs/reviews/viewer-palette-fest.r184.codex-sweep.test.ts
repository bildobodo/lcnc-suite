// Review only. Actual viewer functions run over controlled refs/IPC delivery.
// No actual worker, machine, socket, or product modification.
import { expect, it } from 'vitest';
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
const text=readFileSync(new URL('./ThreeViewer.vue', import.meta.url),'utf8');
const script=text.slice(text.indexOf('<script setup lang="ts">')+24,text.indexOf('</script>'));
const ast=ts.createSourceFile('viewer.ts',script,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const names=['_colOnMessage','_colSetPaused'];
const fns=names.map(name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!.getText(ast));
const events:any[]=[];const posts:any[]=[]; let now=0;
const body=`
let _colSide=null, _colReqId=3, _colReqRunGen=1, _colResultReq=null, _colKeepShown=false;
let _colStopPending=false, _colNeedBodiesRetried=false, _colPendingTrack={count:2}, _colPendingCtx={};
const collisionBusy={value:true}, collisionPartial={value:null}, collisionTrack={value:null};
const collisionResult={value:null}, collisionContext={value:null}, collisionResumable={value:false}, collisionStopped={value:null};
const collisionRun={value:{gen:1,phase:'full'}}, _colRunLog=[], _colHoldLog=[];
const _colStartedAt=10000, _intervalRows=()=>0;
const _colWorker={postMessage: m=>posts.push(m)};
${fns.join('\n')}
return {_colOnMessage,_colSetPaused};`;
const emitted=(kind:string,fields:any)=>events.push({tag:'browser.'+kind,page:'p',t_perf_ms:now,t_wall_ns:now*1e6,...fields});
const api=new Function('emitTelemetry','performance','posts',ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(emitted,{now:()=>now},posts);
it('characterization: completed work is stamped at consumption, not its worker completion',()=>{
 const message={id:3,result:{samples:10,coarsened:false,bvhMs:0,sweepMs:2000,truncated:null,pairCount:1,pairsPrescreened:0}};
 // Sweep starts at 10 s, finishes at 12 s. Main thread is blocked 11–26 s.
 // A separate WS worker receives parse-on at 20.1 s, off at 25.1 s.
 // This worker completion is the first queued callback delivered at 26 s.
 now=26000; api._colOnMessage(message);
 expect(events[0]).toMatchObject({tag:'browser.collision.sweep_done',id:3,run_gen:1,t_perf_ms:26000});
 const out={actualWorkerStart:10000,actualWorkerEnd:12000,mainBlocked:[11000,26000],actualParse:[20000,25000],events:[...events]};
 writeFileSync('/tmp/codex-r184-44844luo/sweep-evidence.json',JSON.stringify(out,null,2));
});
it('characterization: pauses and resumes reach the worker but are absent from telemetry',()=>{
 // A new isolated harness in busy state.
 const a=new Function('emitTelemetry','performance','posts',ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(emitted,{now:()=>now},posts);
 const before=events.length;
 now=19000;a._colSetPaused('camera',true);now=27000;a._colSetPaused('camera',false);
 expect(posts).toEqual([{pause:3,why:'camera'},{resume:3,why:'camera'}]);
 expect(events.length).toBe(before);
 const p='/tmp/codex-r184-44844luo/sweep-evidence.json'; const o=JSON.parse(readFileSync(p,'utf8'));
 o.pause={posts,actualHold:[19000,27000],telemetry:events.slice(before)};writeFileSync(p,JSON.stringify(o,null,2));
});
