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
describe('R145 pool drain boundary probes',()=>{
 it('control: delayed acknowledgement without a failure delivers both rows with one outstanding delta',async()=>{
  const {sent,workers,send}=await setup();send({...req(180),contacts:{generation:0}});
  const a=new ContactStore(180,0),b=new ContactStore(180,0);addEp(a,1);addEp(b,2);
  workers[0]!.emit({id:180,contacts:[a.takeDelta()!]});workers[1]!.emit({id:180,contacts:[b.takeDelta()!]});
  const before=sent.filter(m=>m.contacts).length;
  send({contactsAck:180,generation:0});
  const packets=sent.filter(m=>m.contacts);
  const rows=packets.flatMap(m=>m.contacts as StoreDelta[]).reduce((n,d)=>n+d.episodes.count,0);
  console.log(JSON.stringify({control:{before,generations:packets.map(m=>m.contacts[0].generation),rows}}));
  expect(before).toBe(1);expect(rows).toBe(2);expect(packets.every(m=>m.contacts[0].generation===0)).toBe(true);
 });
 it('old data are delivered before the generation changes, with only one owner delta outstanding',async()=>{
  const {sent,workers,send}=await setup();send({...req(181),contacts:{generation:0}});
  const a=new ContactStore(181,0),b=new ContactStore(181,0);addEp(a,1);addEp(b,2);
  workers[0]!.emit({id:181,contacts:[a.takeDelta()!]});
  workers[1]!.emit({id:181,contacts:[b.takeDelta()!]});
  workers[1]!.fail();await vi.runAllTimersAsync();
  const beforeAck=sent.filter(m=>m.id===181&&m.contacts).map(m=>m.contacts[0].generation);
  send({contactsAck:181,generation:0});await vi.runAllTimersAsync();
  const packets=sent.filter(m=>m.id===181&&m.contacts);
  // The accepted plan discards an older generation after a switch. Keep its
  // already delivered rows, but never patch the held generation with late data.
  let generation=-1, receivedRows=0, droppedRows=0;
  for(const m of packets)for(const dl of m.contacts as StoreDelta[]){
   if(dl.generation<generation)droppedRows+=dl.episodes.count;
   else{generation=dl.generation;receivedRows+=dl.episodes.count;}
  }
  console.log(JSON.stringify({beforeAck,generations:packets.map(m=>m.contacts[0].generation),receivedRows,droppedRows}));
  expect.soft(droppedRows,'the delayed old row must reach a consumer obeying the accepted generation contract').toBe(0);
  expect.soft(beforeAck,'one unacknowledged message on the owner path').toHaveLength(1);
 });
});
