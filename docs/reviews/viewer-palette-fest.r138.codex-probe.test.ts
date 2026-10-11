// The parallel sweep's coordinator (collisionWorker.ts) — the messages it
// owes its owner, driven through fake sub-workers (Codex R90's probe, made a
// test): every shard's latest word in a partial (VP-I47), a side request
// answered when the pool fails (VP-I48), the owner's pause, park, stop and
// cancel kept through the fall back to this core (VP-I49), the side id −1
// (VP-I50) — and the bodies the coordinator keeps for its shards never wear
// a tool pushed by a run on this core. The local runs are real sweeps on a
// two-triangle model that never comes near (the result is clear).
import { afterEach, describe, expect, it, vi } from "vitest";
import { firstOnly, holdsFirst, withFirstContact } from "./firstContact";
import { confirmedContact, type CollisionResult } from "./collision";
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { clashTargets } from "./clashTargets";
import { findingWords } from "./sweepWords";
import { collisionLineMarks } from "./collisionMarks";
import { buildEntryTrack, sliceTrack } from "./scrubTrack";
import { emptyLineIndex } from "./lineIndex";

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


const observations: Record<string, unknown> = {};
function save(name: string, value: unknown) {
  observations[name] = value;
  fs.writeFileSync('/tmp/codex-r138-0vg78d9n/probe.json', JSON.stringify(observations, null, 2));
}
function owner() {
  const src = fs.readFileSync(path.resolve(__dirname, '../ThreeViewer.vue'), 'utf8');
  const script = src.slice(src.indexOf('<script setup lang="ts">') + 24, src.indexOf('</script>'));
  const ast = ts.createSourceFile('ThreeViewer.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ['_colGetWorker', '_colShowFirst', '_colEmitMarks'];
  const funcs = names.map(name => ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!.getText(ast));
  const prelude = `
    let _colWorker = null, _colModelSent = null, _colSide = null, _colReqId = 12, _colKeepShown = false, _colFirstHeld = null;
    const TRACK = {}, _colPendingTrack = TRACK;
    const collisionPartial = { value: null }, collisionPartialTrack = { value: null };
    const collisionProgress = { value: 0 };
    const collisionResultShown = { value: null }, collisionPartialShown = { get value() { return collisionPartial.value; } };
    const emitted = [], emit = (e, x) => emitted.push([e, x]), _colRetint = () => {};
    class Worker { postMessage() {} }
  `;
  const body = ts.transpileModule(prelude + funcs.join('\n').replaceAll('import.meta.url', '"https://test.invalid/ThreeViewer.js"') + `
    return {
      send: (data) => _colGetWorker().onmessage({ data }),
      shown: () => collisionPartial.value,
      emitted,
    };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return new Function('confirmedContact', 'collisionLineMarks', 'firstOnly', 'holdsFirst', 'withFirstContact', body)(confirmedContact, collisionLineMarks, firstOnly, holdsFirst, withFirstContact);
}

describe('R136 Codex: first-contact delivery end to end', () => {
  it('upgrades the existing onset instead of adding a second finding with the same key', () => {
    const ui = owner();
    const near = { ...hit(), dist: 1.5, intervals: undefined };
    ui.send({ id: 12, progress: 0.1, partial: result([near], 0.1) });
    ui.send({ id: 12, progress: 0.2, first: { ...near, touches: true } });
    const targets = clashTargets(ui.shown().hits);
    save('duplicate', { targets, summary: findingWords(targets) });
    expect(targets, 'one physical contact, one marker and list row').toHaveLength(1);
    expect(findingWords(targets).text).toBe('1 collision');
  });
  it('a first contact survives a pooled partial built from older shard words', async () => {
    const { sent, workers, send } = await setup();
    send(req(12));
    const near = { ...hit(), dist: 1.5, intervals: undefined };
    workers[0]!.emit({ id: 12, progress: 0.1, partial: result([near], 0.1) });
    await vi.advanceTimersByTimeAsync(100);
    workers[1]!.emit({ id: 12, progress: 0.1, partial: result([], 0.1) });
    await vi.advanceTimersByTimeAsync(500);
    workers[0]!.emit({ id: 12, progress: 0.2, first: { ...near, touches: true } });
    const ui = owner();
    const states: unknown[] = [];
    for (const m of sent) {
      ui.send(m);
      states.push({ message: m.first ? 'first' : m.partial ? 'partial' : 'progress', words: findingWords(clashTargets(ui.shown()?.hits ?? [])).text });
    }
    save('pool', { sent, states });
    expect(findingWords(clashTargets(ui.shown().hits)).collisions, 'known contact must not revert to near miss').toBe(1);
  });
  it('the side sweep also publishes a known contact before completion', async () => {
    vi.doMock('./sweepPump', () => ({ runSweepSlice: (it: Iterator<number | undefined, CollisionResult>) => {
      const r = it.next();
      return r.done ? { done: true, cancelled: false, result: r.value, progress: 1, checkpoints: 1 }
        : { done: false, cancelled: false, result: null, progress: r.value ?? 0, checkpoints: 1 };
    } }));
    const { sent, send } = await setup(2);
    const n = 2001, pos = new Float32Array(n * 3), cum = new Float32Array(n), lines = new Uint32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = 10 - i * 0.1; cum[i] = i * 0.1; lines[i] = i + 1; }
    // A whole-program G91-style dependency: the same binding and slicing
    // used by runEntryCheck/_startRunCheck, not an invented short side path.
    const base = { pos, abc: new Float32Array(n * 3), cum: new Float32Array(n),
      rapid: new Uint8Array(n).fill(1), lines, count: n, depEnd: n,
      dep: new Uint8Array(n).fill(7), depBrk: new Uint8Array(n), depDur: cum,
      depBasis: new Uint8Array(n).fill(1), startBelieved:[10,0,0],
      lineIndex: emptyLineIndex(), timeBased: false };
    const bound = buildEntryTrack(base, [10,0,0], ['X','Y','Z'], {g5x:[],g92:[],rotationDeg:0}, undefined, undefined, 0)!;
    const end = Math.min(base.depEnd + 1, bound.count - 1);
    const side = sliceTrack(bound,0,end+1);
    save('sideBinding', { baseCount:base.count, depEnd:base.depEnd, boundCount:bound.count, sideCount:side.count });
    expect(side.count).toBeGreaterThanOrEqual(base.count);
    send({ ...req(-1, { side: true }), track: side });
    for (let i = 0; i < 800 && !sent.some(terminal); i++) await vi.advanceTimersToNextTimerAsync();
    const r = sent.find(m => m.result)?.result;
    save('side', { messages: sent.map(m => ({ progress: m.progress, first: m.first, result: !!m.result })), summary: r && findingWords(clashTargets(r.hits)) });
    expect(r, 'the real sweep completed').toBeTruthy();
    expect(r.hits.some(confirmedContact), 'the real sweep proves a contact').toBe(true);
    expect(sent.some(m => m.first || m.partial?.hits.some(confirmedContact)), 'no need to await the whole dependent prefix').toBe(true);
  });
  it('positive controls: unrelated near miss retained, progress and a stale request do not erase first', () => {
    const ui = owner();
    ui.send({ id: 12, progress: 0.1, partial: result([{ ...hit(9), dist: 1.5 }], 0.1) });
    ui.send({ id: 12, progress: 0.2, first: hit(7) });
    ui.send({ id: 12, progress: 0.3 });
    ui.send({ id: 11, progress: 0.4, partial: result([], 0.4) });
    save('positive', findingWords(clashTargets(ui.shown().hits)));
    expect(findingWords(clashTargets(ui.shown().hits)).text).toBe('1 collision · 1 near miss');
  });
});

// New R137 follow-on: one display must not forget what its sibling retains.
describe('R137 Codex: knowledge after subsequent partials', () => {
  it('code panel marks keep the known contact as the Sim list does', () => {
    const ui = owner();
    ui.send({ id:12, progress:0.2, first:hit() });
    ui.send({ id:12, progress:0.25, partial:result([],0.25) });
    const shownMarks=collisionLineMarks(ui.shown().hits);
    save('codeMarks', {shown:ui.shown(), emitted:ui.emitted.at(-1), expected:shownMarks});
    expect(ui.emitted.at(-1)).toEqual(['collision-lines',shownMarks]);
  });
  it('after a partial carries the contact a pool fallback does not erase it', async () => {
    vi.doMock('./sweepPump', () => ({ runSweepSlice: (it: Iterator<number | undefined, CollisionResult>) => {
      const r=it.next();
      return r.done ? {done:true,cancelled:false,result:r.value,progress:1,checkpoints:1}
        : {done:false,cancelled:false,result:null,progress:r.value??0,checkpoints:1};
    }}));
    const {sent, workers, send}=await setup();
    const n=2001, pos=new Float32Array(n*3), cum=new Float32Array(n), lines=new Uint32Array(n);
    for(let i=0;i<n;i++){pos[i*3]=10-i*0.0045;cum[i]=i*0.0045;lines[i]=i+1;}
    send({...req(12),track:{pos,abc:new Float32Array(n*3),cum,rapid:new Uint8Array(n).fill(1),lines,count:n}});
    workers[0]!.emit({id:12,progress:0.2,first:hit()});
    workers[0]!.emit({id:12,progress:0.3,partial:result([hit()],0.3)});
    await vi.advanceTimersByTimeAsync(600);
    workers[1]!.emit({id:12,progress:0.3,partial:result([],0.3)});
    const before=sent.length;
    expect(sent.some(m=>m.partial?.hits.some(confirmedContact))).toBe(true);
    expect(workers[1]!.fail()).toBe(true);
    for(let i=0;i<1500 && !sent.slice(before).some(m=>m.partial);i++) await vi.advanceTimersToNextTimerAsync();
    const ui=owner(); const states:any[]=[];
    for(const m of sent) {
      // inspect interim knowledge, not the deliberately clear fixture's final result
      if(terminal(m)) break;
      ui.send(m); states.push({message:m.first?'first':m.partial?'partial':'progress',words:findingWords(clashTargets(ui.shown()?.hits??[])).text});
    }
    save('fallback',{messages:sent,states});
    expect(sent.slice(before).some(m=>m.partial),'a local fallback partial was observed').toBe(true);
    expect(findingWords(clashTargets(ui.shown().hits)).collisions).toBe(1);
  });
});
