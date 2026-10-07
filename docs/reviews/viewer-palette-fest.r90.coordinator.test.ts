import {it,expect,vi,afterEach} from 'vitest';
import {writeFileSync} from 'node:fs';
import type {CollisionResult} from './collision';
const out:Record<string,unknown>={};
const save=()=>writeFileSync('../evidence/viewer-palette-fest.r90.coordinator.json',JSON.stringify(out,null,2)+'\n');
const hit=(line=7)=>({line,cum:2,cumEnd:3,a:'moving',b:'fixed',dist:0,rapid:true,intervals:[[2,3] as [number,number]]});
const result=(hits:ReturnType<typeof hit>[]=[],covered?:number):CollisionResult=>({hits,staticContacts:[],samples:20,coarsened:false,uncertified:null,pairCount:2,pairsPrescreened:0,bvhMs:1,sweepMs:20,truncated:covered===undefined?null:{covered,reason:'running'}});
const machine={groups:[{id:'fixed',parent:'root'},{id:'moving',parent:'root'}],kinematics:[{group:'moving',joint:0,type:'translate',direction:'x',sign:1}],workGroup:'fixed',toolGroup:'moving',unitScale:1,axes:['X','Y','Z']};
const req=(id:number,side=false)=>({id,side,modelKey:'r90-simple',machine,bodies:[{id:'fixed',group:'fixed',positions:new Float32Array([0,0,0,0,10,0,0,0,10])},{id:'moving',group:'moving',positions:new Float32Array([0,0,0,0,10,0,0,0,10])}],tool:null,track:{pos:new Float32Array([10,0,0,20,0,0]),abc:new Float32Array(6),cum:new Float32Array([0,10]),rapid:new Uint8Array([1,1]),lines:new Uint32Array([1,2]),count:2},wcs:{g5x:[],g92:[],rotationDeg:0},options:{margin:2},maxShards:2});
async function setup(){
 vi.resetModules();vi.useFakeTimers();
 const sent:any[]=[],workers:FakeWorker[]=[];
 class FakeWorker {
  onmessage:((e:any)=>void)|null=null;onerror:((e:any)=>void)|null=null;messages:any[]=[];terminated=false;
  constructor(){workers.push(this);}
  postMessage(v:any){this.messages.push(structuredClone(v));}
  terminate(){this.terminated=true;}
  emit(v:any){this.onmessage?.({data:structuredClone(v)});}
  fail(){this.onerror?.({message:'synthetic module failure'});}
 }
 const scope={onmessage:null as any,postMessage:(m:any)=>sent.push(structuredClone(m)),navigator:{hardwareConcurrency:3},location:{href:'https://test.invalid/collisionWorker.js'}};
 vi.stubGlobal('self',scope);vi.stubGlobal('Worker',FakeWorker);
 await import('./collisionWorker');
 return {sent,workers,send:(data:any)=>scope.onmessage({data})};
}
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();vi.doUnmock('./sweepPump');});
it('completed shards contribute their final hits to every later partial',async()=>{
 const {sent,workers,send}=await setup();send(req(1));expect(workers).toHaveLength(2);
 workers[0]!.emit({id:1,result:result([hit()])});
 workers[1]!.emit({id:1,progress:.3,partial:result([],.3)});
 out.finishedShard=sent;save();
 const partial=sent.find(m=>m.partial)?.partial;
 expect(partial.hits.some((h:any)=>h.line===7),'a completed shard has found L7; it must already be shown').toBe(true);
});
it('an unfinished shard without a snapshot cannot be treated as covered by another snapshot',async()=>{
 const {sent,workers,send}=await setup();send(req(2));
 workers[0]!.emit({id:2,progress:.8,partial:result([hit()],.8)});
 out.coverage=sent;save();const m=sent.at(-1);
 expect(m.progress).toBe(0);expect(m.partial.truncated.covered,'no word yet from shard 1').toBe(0);
 expect(m.partial.shards,'both workers belong to this partial').toBe(2);
});
it('a shard load failure resolves the outstanding side request',async()=>{
 const {sent,workers,send}=await setup();send(req(3));send(req(-3,true));
 expect(workers[0]!.messages.some(m=>m.id===-3)).toBe(true);
 workers[1]!.fail();await vi.runAllTimersAsync();
 out.sideFailure={sent,terminated:workers.map(w=>w.terminated)};save();
 expect(sent.some(m=>m.id===-3&&(m.result||m.error||m.cancelled||m.needBodies)),'the side request needs one terminal answer or an explicit retry').toBe(true);
});
it('a shard failure preserves a hidden-tab pause in the local replacement',async()=>{
 const {sent,workers,send}=await setup();send(req(4));send({pause:4,why:'hidden'});
 expect(workers.every(w=>w.messages.some(m=>m.pause===4))).toBe(true);
 workers[1]!.fail();
 out.pausedFailure={sent};save();expect(sent.some(m=>m.id===4&&m.result),'hidden run must wait for resume').toBe(false);
});
it('a shard failure does not resume a parked sweep without continue',async()=>{
 const {sent,workers,send}=await setup();send(req(5));send({stop:5});
 for(const w of workers)w.emit({id:5,stopped:true,result:{...result([],.2),truncated:{covered:.2,reason:'stopped'}}});
 expect(sent.at(-1).stopped).toBe(true);sent.length=0;
 workers[1]!.fail();
 out.parkedFailure={sent};save();expect(sent.some(m=>m.id===5&&m.result&&!m.stopped),'parked sweep must wait for continue').toBe(false);
});
it('normal stop, continue, finish and explicit error still reach the owner',async()=>{
 const {sent,workers,send}=await setup();send(req(6));
 workers[0]!.emit({id:6,result:result([hit()])});send({stop:6});
 workers[1]!.emit({id:6,stopped:true,result:{...result([],.2),truncated:{covered:.2,reason:'stopped'}}});
 expect(sent.at(-1).stopped).toBe(true);expect(sent.at(-1).result.hits).toHaveLength(1);
 send({continue:6});workers[1]!.emit({id:6,result:result()});
 expect(sent.at(-1).result.hits).toHaveLength(1);expect(sent.at(-1).result.shards).toBe(2);
 send(req(7));workers[0]!.emit({id:7,error:'deliberate shard error'});expect(sent.at(-1)).toEqual({id:7,error:'deliberate shard error'});
 expect(workers[1]!.messages.at(-1)).toEqual({cancel:7});
 out.normal=sent;save();
});

it('the first local side request with id minus one can be cancelled',async()=>{
 // Deterministically hold the local sweep at its first slice boundary. The
 // real worker still owns the cancel flag, routes the message, and pumps it.
 const checks:boolean[]=[];
 vi.doMock('./sweepPump',()=>({runSweepSlice:(_it:any,_ms:number,cancelled:()=>boolean)=>{
  const c=cancelled();checks.push(c);return {done:c,cancelled:c,result:null,progress:0,checkpoints:1};
 }}));
 const {sent,workers,send}=await setup();send(req(-1,true));expect(workers).toHaveLength(0);
 send({cancel:-1});await vi.advanceTimersToNextTimerAsync();
 out.firstSideCancel={sent,checks};save();
 expect(sent.some(m=>m.id===-1&&m.cancelled),'id -1 is a real first side id, not the no-side sentinel').toBe(true);
});
