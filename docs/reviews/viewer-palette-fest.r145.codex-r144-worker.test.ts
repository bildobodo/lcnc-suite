// Codex R144. Harness from repository collisionWorker.test.ts; new cases below.
// The parallel sweep's coordinator (collisionWorker.ts) — the messages it
// owes its owner, driven through fake sub-workers (Codex R90's probe, made a
// test): every shard's latest word in a partial (VP-I47), a side request
// answered when the pool fails (VP-I48), the owner's pause, park, stop and
// cancel kept through the fall back to this core (VP-I49), the side id −1
// (VP-I50) — and the bodies the coordinator keeps for its shards never wear
// a tool pushed by a run on this core. The local runs are real sweeps on a
// two-triangle model that never comes near (the result is clear).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollisionResult } from "./collision";
import { ContactStore, NONE, type StoreDelta } from "./contactStore";
import { boxPositions } from "./collisionFixtures";

type Msg = Record<string, any>;
const hit = (line = 7) => ({ line, cum: 2, cumEnd: 3, a: "moving", b: "fixed", dist: 0, rapid: true, intervals: [[2, 3] as [number, number]] });
const result = (hits: ReturnType<typeof hit>[] = [], covered?: number, reason: "running" | "stopped" = "running"): CollisionResult => ({
  hits, staticContacts: [], samples: 20, coarsened: false, uncertified: null, pairCount: 2, pairsPrescreened: 0,
  bvhMs: 1, sweepMs: 20, truncated: covered === undefined ? null : { covered, reason } });
const machine = { groups: [{ id: "fixed", parent: "root" }, { id: "moving", parent: "root" }],
  kinematics: [{ group: "moving", joint: 0, type: "translate", direction: "x", sign: 1 }],
  workGroup: "fixed", toolGroup: "moving", unitScale: 1, axes: ["X", "Y", "Z"] };
const triangle = () => new Float32Array([0, 0, 0, 0, 10, 0, 0, 0, 10]);
const req = (id: number, o: { side?: boolean; maxShards?: number; bodies?: boolean; tool?: boolean } = {}) => ({
  id, side: !!o.side, modelKey: "simple" + (o.tool ? "+tool" : ""), machine,
  bodies: o.bodies === false ? undefined : [{ id: "fixed", group: "fixed", positions: triangle() }, { id: "moving", group: "moving", positions: triangle() }],
  tool: o.tool ? { diam: 1, len: 2 } : null,
  track: { pos: new Float32Array([10, 0, 0, 20, 0, 0]), abc: new Float32Array(6), cum: new Float32Array([0, 10]),
           rapid: new Uint8Array([1, 1]), lines: new Uint32Array([1, 2]), count: 2 },
  wcs: { g5x: [], g92: [], rotationDeg: 0 }, options: { margin: 2 }, maxShards: o.maxShards ?? 2 });

async function setup(cores = 4) {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const sent: Msg[] = [], workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((e: { data: Msg }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    messages: Msg[] = [];
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(v: Msg) { this.messages.push(structuredClone(v)); }
    terminate() { this.terminated = true; }
    emit(v: Msg) { this.onmessage?.({ data: structuredClone(v) }); }
    /** An error the sub-worker did not handle; says whether it was handled. */
    fail(): boolean {
      let prevented = false;
      this.onerror?.({ message: "synthetic failure", preventDefault: () => { prevented = true; } });
      return prevented;
    }
  }
  const scope = { onmessage: null as ((e: { data: Msg }) => void) | null, postMessage: (m: Msg) => sent.push(structuredClone(m)),
    navigator: { hardwareConcurrency: cores }, location: { href: "https://test.invalid/collisionWorker.js" } };
  vi.stubGlobal("self", scope);
  vi.stubGlobal("Worker", FakeWorker);
  await import("./collisionWorker");
  return { sent, workers, send: (data: Msg) => scope.onmessage!({ data }) };
}
const last = (a: Msg[]) => a[a.length - 1]!;
const terminal = (m: Msg) => !!(m.result || m.error || m.cancelled || m.needBodies);

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock("./sweepPump"); });

const addEp=(s:ContactStore,pair:number)=>s.episodes.append({pair,ordinal:0,onset:pair,end:NaN,closeAt:pair,closeDist:1,firstIv:NONE});
const boxReq=(id:number,maxShards=2)=>{
 const n=161,pos=new Float32Array(n*3),cum=new Float32Array(n),lines=new Uint32Array(n);
 for(let i=0;i<n;i++){pos[i*3]=-40+i*.5;cum[i]=i*.5;lines[i]=i+1;}
 return {...req(id,{maxShards}),modelKey:'boxes',bodies:[{id:'fixed',group:'fixed',positions:boxPositions(10,10,10)},{id:'moving',group:'moving',positions:boxPositions(10,10,10)}],track:{pos,abc:new Float32Array(n*3),cum,rapid:new Uint8Array(n).fill(1),lines,count:n},contacts:{generation:0}};
};
describe('R144 worker own probes',()=>{
 it('a pool failure hands over received but still unforwarded contacts',async()=>{
  const {sent,workers,send}=await setup();send({...req(81),contacts:{generation:0}});
  const a=new ContactStore(81,0),b=new ContactStore(81,0);addEp(a,1);addEp(b,2);
  workers[0]!.emit({id:81,contacts:[a.takeDelta()!]});
  workers[1]!.emit({id:81,contacts:[b.takeDelta()!]}); // received, behind owner backpressure
  workers[1]!.fail();await vi.runAllTimersAsync();send({contactsAck:81,generation:0});await vi.runAllTimersAsync();
  const packets=sent.filter(m=>m.contacts).flatMap(m=>m.contacts as StoreDelta[]);
  const oldRows=packets.filter(d=>d.generation===0).reduce((n,d)=>n+d.episodes.count,0);
  console.log(JSON.stringify({pool_failure_old_rows_delivered:oldRows,packets:packets.map(d=>({g:d.generation,count:d.episodes.count}))}));
  expect(oldRows).toBe(2);
 });
 it('the old generation acknowledgement cannot release an unacknowledged new generation delta',async()=>{
  vi.doMock('./sweepPump',()=>({runSweepSlice:(it:Iterator<number|undefined,CollisionResult>)=>{
   const r=it.next();return r.done?{done:true,cancelled:false,result:r.value,progress:1,checkpoints:1}:{done:false,cancelled:false,result:null,progress:r.value??0,checkpoints:1};
  }}));
  const {sent,workers,send}=await setup();send(boxReq(82));
  const s=new ContactStore(82,0);addEp(s,1);workers[0]!.emit({id:82,contacts:[s.takeDelta()!]});
  workers[1]!.fail();await vi.runAllTimersAsync();
  const count=()=>sent.filter(m=>m.contacts?.[0]?.generation===1).length;
  expect(count()).toBe(1);
  send({contactsAck:82,generation:0}); // delayed ACK for generation 0; generation 1 not applied yet
  console.log(JSON.stringify({new_generation_messages_after_old_ack:count(),results:sent.filter(m=>m.result).length}));
  expect(count()).toBe(1);
 });
 it('a side run restarted after pool failure has a new generation too',async()=>{
  const {sent,workers,send}=await setup();send(req(83));
  send({...req(-83,{side:true}),contacts:{generation:7}});
  const old=new ContactStore(-83,7);addEp(old,1);workers[0]!.emit({id:-83,contacts:[old.takeDelta()!]});
  workers[1]!.fail();await vi.runAllTimersAsync();
  const generations=sent.filter(m=>m.id===-83&&m.contacts).map(m=>m.contacts[0].generation);
  console.log(JSON.stringify({side_run_generations:generations}));
  expect(generations).toEqual([7,8]);
 });
 it('a final held for acknowledgement survives a worker error',async()=>{
  const {sent,workers,send}=await setup();send({...req(84),contacts:{generation:0}});
  const a=new ContactStore(84,0),b=new ContactStore(84,0);addEp(a,1);
  workers[0]!.emit({id:84,contacts:[a.takeDelta()!]});a.ack();
  workers[0]!.emit({id:84,result:result(),contacts:[a.takeDelta(true)!]});
  workers[1]!.emit({id:84,result:result(),contacts:[b.takeDelta(true)!]});
  expect(sent.some(m=>m.result)).toBe(false);
  workers[1]!.fail();send({contactsAck:84,generation:0});await vi.runAllTimersAsync();
  const finals=sent.filter(m=>m.id===84&&terminal(m));console.log(JSON.stringify({terminal_after_held_final_worker_error:finals}));
  expect(finals).toHaveLength(1);
 });
 it('pooled budget result preserves the exact incompleteFrom',async()=>{
  const {sent,workers,send}=await setup();send({...req(85),contacts:{generation:0}});
  workers[0]!.emit({id:85,result:{...result([],0.2),truncated:{covered:.2,reason:'budget'},incompleteFrom:4},contacts:[new ContactStore(85,0).takeDelta(true)!]});
  send({contactsAck:85,generation:0});
  workers[1]!.emit({id:85,result:result(),contacts:[new ContactStore(85,0).takeDelta(true)!]});send({contactsAck:85,generation:0});
  const fin=sent.find(m=>m.result)!.result;console.log(JSON.stringify({pooled_budget_result:fin}));
  expect(fin.incompleteFrom).toBe(4);
 });
});
