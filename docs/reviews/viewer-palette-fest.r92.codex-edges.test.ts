import {it,expect,vi,afterEach} from 'vitest';
import {writeFileSync} from 'node:fs';
import type {CollisionResult} from './collision';
const out:Record<string,unknown>={};
const save=()=>writeFileSync('../evidence/viewer-palette-fest.r91.codex-edges.json',JSON.stringify(out,null,2)+'\n');
const hit=()=>({line:7,cum:2,cumEnd:3,a:'moving',b:'fixed',dist:0,rapid:true,intervals:[[2,3] as [number,number]]});
const result=(covered?:number,reason:'running'|'stopped'|'samples'='running'):CollisionResult=>({hits:[hit()],staticContacts:[],samples:20,coarsened:false,uncertified:null,pairCount:2,pairsPrescreened:0,bvhMs:1,sweepMs:20,truncated:covered===undefined?null:{covered,reason}});
const machine={groups:[{id:'fixed',parent:'root'},{id:'moving',parent:'root'}],kinematics:[{group:'moving',joint:0,type:'translate',direction:'x',sign:1}],workGroup:'fixed',toolGroup:'moving',unitScale:1,axes:['X','Y','Z']};
const req=(id:number)=>({id,modelKey:'r91-simple',machine,bodies:[{id:'fixed',group:'fixed',positions:new Float32Array([0,0,0,0,10,0,0,0,10])},{id:'moving',group:'moving',positions:new Float32Array([0,0,0,0,10,0,0,0,10])}],tool:null,track:{pos:new Float32Array([10,0,0,20,0,0]),abc:new Float32Array(6),cum:new Float32Array([0,10]),rapid:new Uint8Array([1,1]),lines:new Uint32Array([1,2]),count:2},wcs:{g5x:[],g92:[],rotationDeg:0},options:{margin:2},maxShards:2});
async function setup(){
 vi.resetModules();vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});
 const sent:any[]=[],workers:FakeWorker[]=[];
 class FakeWorker {
  onmessage:((e:any)=>void)|null=null;onerror:((e:any)=>void)|null=null;messages:any[]=[];terminated=false;
  constructor(){workers.push(this);}
  postMessage(v:any){this.messages.push(structuredClone(v));}
  terminate(){this.terminated=true;}
  emit(v:any){this.onmessage?.({data:structuredClone(v)});}
  fail(){this.onerror?.({message:'synthetic module failure',preventDefault(){}});}
 }
 const scope={onmessage:null as any,postMessage:(m:any)=>sent.push(structuredClone(m)),navigator:{hardwareConcurrency:4},location:{href:'https://test.invalid/collisionWorker.js'}};
 vi.stubGlobal('self',scope);vi.stubGlobal('Worker',FakeWorker);await import('./collisionWorker');
 return {sent,workers,send:(data:any)=>scope.onmessage({data})};
}
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
it('a shard ended at the sample backstop limits the running coverage',async()=>{
 const {sent,workers,send}=await setup();send(req(91));
 workers[0]!.emit({id:91,result:{...result(.2,'samples'),coarsened:true}});
 vi.advanceTimersByTime(600);
 workers[1]!.emit({id:91,progress:.8,partial:result(.8)});
 out.truncatedShard=sent;save();
 const latest=sent.at(-1);expect(latest.partial.truncated.covered).toBe(.2);
 expect(latest.progress,'coverage read by the live timeline and Sim view must include the ended, truncated shard').toBe(.2);
});
it('a stop before any shard snapshot is answered even when the owner has paused hidden',async()=>{
 const {sent,workers,send}=await setup();send(req(92));send({pause:92,why:'hidden'});send({stop:92});
 workers[1]!.fail();await vi.advanceTimersByTimeAsync(60000);
 out.stopBeforeSnapshot={sent,timers:vi.getTimerCount(),terminated:workers.map(w=>w.terminated)};save();
 expect(sent.some(m=>m.id===92&&m.error),'explicit non-resumable error while hidden, without waiting for resume').toBe(true);
 expect(sent.some(m=>m.id===92&&m.result&&!m.stopped)).toBe(false);
});
it('both pause reasons remain independent through fallback',async()=>{
 const {sent,workers,send}=await setup();send(req(93));send({pause:93,why:'camera'});send({pause:93,why:'hidden'});workers[0]!.fail();
 await vi.advanceTimersByTimeAsync(31000);expect(sent.some(m=>m.result)).toBe(false);
 send({resume:93,why:'camera'});await vi.advanceTimersByTimeAsync(500);expect(sent.some(m=>m.result)).toBe(false);
 send({resume:93,why:'hidden'});await vi.runAllTimersAsync();expect(sent.filter(m=>m.id===93&&m.result)).toHaveLength(1);
 out.twoPauses=sent;save();
});
it('a continued lost parked run obeys a new hidden pause and ignores an old worker error',async()=>{
 const {sent,workers,send}=await setup();send(req(94));send({stop:94});
 for(const w of workers)w.emit({id:94,stopped:true,result:result(.3,'stopped')});workers[0]!.fail();sent.length=0;
 send({pause:94,why:'hidden'});send({continue:94});workers[1]!.fail();await vi.advanceTimersByTimeAsync(1000);expect(sent.some(m=>m.result)).toBe(false);
 send({resume:94,why:'hidden'});await vi.runAllTimersAsync();expect(sent.filter(m=>m.id===94&&m.result)).toHaveLength(1);
 out.lostParked=sent;save();
});
