// Plan 3.6 (Form 1, Fassung 2; Codex R152, R154–R156): the publisher's
// transitions with real tables and deltas, its steps driven one at a time.
import { describe, expect, it } from "vitest";
import { ContactStore, IV_ENTER_DECIDED, IV_EXIT_DECIDED, NONE } from "./contactStore";
import { buildContactViewSteps, targetPos, type ContactView } from "./contactView";
import { ContactPublisher, type GenerationTables, type PublisherMessage } from "./contactPublisher";

const D = IV_ENTER_DECIDED | IV_EXIT_DECIDED;
const names = (p: number) => ({ a: `t${p}`, b: `w${p}` });

/** One shard's sender: contacts of pair `pair` at `at`, deltas one at a time. */
class Sender {
  st: ContactStore;
  id: number;
  constructor(id: number, gen: number) { this.id = id; this.st = new ContactStore(id, gen); }
  contact(pair: number, at: number, len = 1): this {
    const E = this.st.episodes, I = this.st.intervals;
    const ep = E.append({ pair, ordinal: E.rows, flags: 0, onset: at, end: at + len, closeAt: at, closeDist: 0, firstIv: NONE, ivCount: 1 });
    E.set(ep, "firstIv", I.append({ episode: ep, enter: at, exit: at + len, flags: D, next: NONE, witness: at + len / 2, freeAt: at + len + 0.5, freeR: 0.1 }));
    return this;
  }
  /** Every interval moved: an update-heavy delta. */
  touchAll(): this { for (let k = 0; k < this.st.intervals.rows; k++) this.st.intervals.set(k, "witness", this.st.intervals.get(k, "witness")); return this; }
  msg(extra: Record<string, unknown> = {}): PublisherMessage {
    const d = this.st.takeDelta(true)!;
    this.st.ack();
    return { id: this.id, contacts: [d], ...(d.episodes.from === 0 ? { contactPairs: [["t", "w"]] as Array<[string, string]> } : {}), ...extra };
  }
}

interface Shown { tag: string; n: number }
/** A publisher over one track, its steps run by hand (each slice is one step). */
function harness(o: { owners?: Set<number> } = {}) {
  const queue: Array<() => void> = [];
  const acks: Array<{ contactsAck: number; generation: number }> = [];
  const effects: PublisherMessage[] = [];
  const published: Array<{ shown: Shown; views: ContactView | null }> = [];
  const events: string[] = [];
  let live: Shown = { tag: "start", n: 0 };
  const owners = o.owners ?? new Set([1]);
  const track = { name: "base" };
  /** Tracks shown beside the base (the simulation's entry track …). */
  const extra: Array<typeof track> = [];
  let views: ContactView | null = null;
  const p: ContactPublisher<typeof track, ContactView, Shown> = new ContactPublisher({
    tracks: () => [track, ...extra],
    specOf: t => ({ key: `${(t as { name: string }).name}|${live.tag}`, ids: [...owners], spec: null }),
    *build(_t, _s, tables: (id: number) => GenerationTables | null, held: (id: number) => GenerationTables | null) {
      const t = tables(1), h = held(1);
      if (!t) return null;
      return yield* buildContactViewSteps({ sources: [{ stores: t.stores, ...(h?.stores.length ? { held: h.stores, heldCoverage: h.stores.map(() => 1e9) } : {}),
        at: c => c, ownCoverage: 1e9 }], pairName: names, coverage: 1e9 });
    },
    effect: m => { effects.push(m); events.push(m.heldCoverage ? "effect:held" : "effect"); if (typeof m.tag === "string") live = { tag: m.tag, n: effects.length }; },
    stage: () => { events.push("stage"); return { ...live }; },
    publish: s => { events.push("publish"); views = p.viewOf(track); published.push({ shown: s, views }); },
    ack: a => { events.push("ack"); acks.push(a); },
    owners: () => owners,
    schedule: f => queue.push(f),
    sliceMs: 0,   // every slice one step
    now: () => 0,
  });
  /** Runs slices until `until` holds (or nothing is left). */
  const run = (until: () => boolean = () => false, max = 1e6) => {
    for (let k = 0; k < max && queue.length && !until(); k++) queue.shift()!();
  };
  return { p, queue, acks, effects, published, events, track, extra, run, owners, views: () => views, setLive: (tag: string) => { live = { tag, n: effects.length }; } };
}
const posOf = (v: ContactView | null) => v ? Array.from({ length: v.n }, (_, i) => targetPos(v, i)) : [];


// Own R157 counterexamples. These assert the agreed contract, not observed behavior.
describe('Codex R157 lifecycle and memory', () => {
 it('retires an old view at publication, before its backing table is written',()=>{
  const h=harness(),s=new Sender(1,0);
  h.p.receive(s.contact(0,10).msg());h.p.kick();h.run();const old=h.views()!;
  h.p.receive(s.contact(1,20).msg());h.p.kick();h.run(()=>h.p.phase===4);
  expect(posOf(h.views())).toEqual([10,20]);
  expect(()=>targetPos(old,0),'plan 3.6: dead at publication').toThrow();
 });
 it('retires the old view even on a publication without table writes',()=>{
  const h=harness(),s=new Sender(1,0);
  h.p.receive(s.contact(0,10).msg());h.p.kick();h.run();const old=h.views()!;
  h.p.receive({id:1,tag:'coverage changed'});h.p.kick();h.run();
  expect(h.views()).not.toBe(old);
  expect(()=>targetPos(old,0),'old references must not survive a metadata-only publication').toThrow();
 });
 it('accounts for the still displayed old-generation copy during the new-generation build',()=>{
  const h=harness(),s=new Sender(1,0);
  h.p.receive(s.contact(0,10).msg());h.p.kick();h.run();
  h.p.receive({id:1,heldCoverage:{generation:0,covered:[1]}});h.p.kick();h.run();
  const shown=h.p.viewOf(h.track)!;
  h.p.receive(new Sender(1,1).contact(0,10).msg());h.p.kick();h.run(()=>h.p.phase===2);
  expect(h.p.viewOf(h.track)).toBe(shown);
  const t=h.p.tablesOf(1)!;const live=new Set<ContactStore>();
  for(const g of [t.pub,t.work,t.held])for(const st of g?.stores??[])live.add(st);
  for(const ti of shown.tables)if(ti)live.add(ti.st);
  const actual=[...live].reduce((n,st)=>n+st.allocatedBytes(),0);
  console.log('r157 memory',JSON.stringify({reported:h.p.stats().allocated,live:actual,omitted:actual-h.p.stats().allocated}));
  expect(h.p.stats().allocated,'all simultaneously live owner buffers').toBe(actual);
 });
 it('stops a released request build at the next bounded step',()=>{
  const tasks:Array<()=>void>=[],owners=new Set([1]);let oldSteps=0;
  const track={};
  const p=new ContactPublisher({tracks:()=>owners.size?[track]:[],specOf:()=>({key:'one',ids:[1],spec:null}),
   *build(){for(let i=0;i<100;i++){oldSteps++;yield;}return {};}, effect:()=>{},stage:()=>({}),publish:()=>{},ack:()=>{},owners:()=>owners,
   schedule:f=>tasks.push(f),sliceMs:0,now:()=>0});
  p.receive({id:1});p.kick();while(tasks.length && oldSteps<5)tasks.shift()!();
  const atCancel=oldSteps;owners.clear();p.release();p.kick();
  for(let i=0;i<1000&&tasks.length;i++)tasks.shift()!();
  console.log('r157 cancel',JSON.stringify({atCancel,after:oldSteps,extra:oldSteps-atCancel}));
  expect(oldSteps-atCancel,'an abandoned build must stop; no full stale build before the new request').toBeLessThanOrEqual(1);
 });
});
