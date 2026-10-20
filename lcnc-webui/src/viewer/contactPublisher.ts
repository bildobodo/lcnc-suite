// Step 4 package 2, plan 3.6 (Form 1, Fassung 2; Codex R152, R154–R156): the
// contact tables, their views and the state the page shows, published
// together, in bounded steps.
//
// Each request's current generation lives in TWO copies: the published one
// (`pub`), which is never written, and the work copy. A PASS:
//   1 takes the messages received so far, in arrival order: each one's deltas
//     go into the work copy (bounded steps, inside a delta too — VP155-01),
//     then its other effects reach the viewer's live state;
//   2 builds the views of the tracks the live state shows from the work
//     copies (bounded steps, inside a group too), with its specs;
//   3 publishes in ONE task, when the live state still shows exactly what
//     was built (else the build begins anew): the work copies become `pub`,
//     the views and the state the viewer STAGES then (`stage`) — the page
//     never shows a state ahead of its tables. A pass never discards itself:
//     its own effects are in what it builds, and what changes meanwhile from
//     outside is either staged with it or a changed spec that restarts it;
//   4 catches the other, now dead copy up by the same deltas (bounded steps)
//     and only then acknowledges them, each message apart — one
//     unacknowledged delta per path (the one with a request's first interval
//     beside it, once: two at most), the sender coalesces meanwhile; no queue
//     grows here.
// A FALLBACK (the pool fell back to one core; `heldCoverage`, then the old
// generation's drain, then a new generation): the build is discarded, never
// the evidence. The complete copy that is not published takes the drain
// (acknowledged as each delta lands there) and becomes the HELD generation at
// the new generation's first delta; `pub` stays shown, untouched, until the
// union is published. A delta of an older generation after a switch is
// dropped and acknowledged. A request no one owns goes with its tables, its
// queue and its tickets (its cancel went out; the worker waits for nothing).
// Acknowledgements come from these transitions alone — never from a
// discarded pass, whose continuation ends at its next step.
//
// Pure apart from the scheduler and the callbacks it is given.
import { ContactStore, REQUEST_BUDGET, type StoreDelta } from "./contactStore";
import { macrotaskSchedule, runSteps, withMeter, type AllocMeter, type StepRun, type Steps } from "./steps";

/** One generation's tables of a request, one store per shard. */
export interface GenerationTables {
  generation: number;
  stores: ContactStore[];
  /** The model pairs' body ids (tool side, work side), sent with the
   *  generation's first delta. */
  pairs: Array<[string, string]> | null;
  deltas: number;
  /** How far each of its shards swept (track fractions, by shard) when its
   *  pool fell back — the earlier generation's own coverage (Codex R150
   *  VP150-02); none while it is the request's live generation. */
  covered?: number[];
}

/** The collision worker's contact transport (plan Fassung 5, 3.1/3.4/3.5):
 *  each request's tables as deltas, one per shard, at most one
 *  unacknowledged per request (the one with its first interval beside it,
 *  once — C2); acknowledged as `{contactsAck, generation}`,
 *  the delta's own generation. */
export interface ContactsMessage {
  id: number; contacts?: StoreDelta[]; contactPairs?: Array<[string, string]>;
  /** A pool fell back: how far each shard of `generation` swept. */
  heldCoverage?: { generation: number; covered: number[] };
}

/** The requests whose tables someone still reads (Codex R147 VP-I106): the
 *  request and the side run in flight, and every request behind what is
 *  shown — the result on screen (a provisional one kept while its full check
 *  runs; a cancel moves the request id on while the result stays), the entry
 *  move's result, a run check's bound beginning, a side run's first contact.
 *  "The run ended" and "nobody reads its result" are two lifetimes: a side
 *  run's tables outlive its run while its result is shown. Every field is
 *  named — a caller cannot forget one. */
export function contactOwners(o: { main: number; side: number | null; result: number | null; entry: number | null;
                                   runSide: number | null; sideFirst: number | null }): Set<number> {
  const out = new Set<number>([o.main]);
  for (const id of [o.side, o.result, o.entry, o.runSide, o.sideFirst]) if (id !== null) out.add(id);
  return out;
}

/** A worker message as received: its deltas go into the tables, the rest is
 *  handed to `effect` when a pass takes it. */
export type PublisherMessage = ContactsMessage & { readonly [k: string]: unknown };

/** One request: its current generation in two copies, the held one. */
interface Req {
  /** The current generation (−1: none yet). */
  gen: number;
  copies: [GenerationTables, GenerationTables] | null;
  /** Which copy the published views read. */
  pub: 0 | 1;
  held: GenerationTables | null;
  /** A fallback was signalled for the current generation: it drains into the
   *  work copy, which becomes the held one at the next generation's first delta. */
  fallen: boolean;
  /** Messages whose deltas are in the work copy and not yet in the other: their tickets are open. */
  ahead: PublisherMessage[];
}

export interface PublisherDeps<T extends object, V, S> {
  /** The tracks that may show contacts now (the live state). */
  tracks(): readonly T[];
  /** What a track shows now (the live state): a key (its spec's data), the
   *  requests it reads and the spec the build takes; null — nothing. */
  specOf(track: T): { key: string; ids: readonly number[]; spec: unknown } | null;
  /** A track's view from the given tables, in bounded steps. */
  build(track: T, spec: unknown, tables: (id: number) => GenerationTables | null, held: (id: number) => GenerationTables | null): Steps<V | null>;
  /** A taken message's effects on the live state (its deltas are in the work copy). */
  effect(m: PublisherMessage): void;
  /** What the page will show, taken from the live state at the publication. */
  stage(): S;
  /** The publication (one task): the staged state and the views. */
  publish(s: S): void;
  /** A view that is no longer published (replaced, or its request let go):
   *  every later query of it must fail (plan 3.6, Codex R157 VP-I117). */
  retire?(view: V): void;
  /** What a view holds itself, in bytes (its index and derived data). */
  viewBytes?(view: V): number;
  /** An acknowledgement for the worker. */
  ack(a: { contactsAck: number; generation: number }): void;
  /** The requests someone still reads; the others go. */
  owners(): ReadonlySet<number>;
  schedule?: (f: () => void) => void;
  now?: () => number;
  sliceMs?: number;
}

/** A slice that has worked this long ends before the publication. */
const PUBLISH_ALONE_MS = 1;

interface Pass {
  run: StepRun<void> | null;
  /** 1 take, 2 build, 3 publish, 4 catch up. */
  phase: number;
  /** A fallback or a released request: its build is discarded — at its next step. */
  discard: boolean;
  /** The views built so far (not published yet). */
  built: Map<unknown, Built<unknown>>;
  /** What the build running now has allocated (its view, its derived data,
   *  its buffers) — from its first step to its end; then its view counts as
   *  built (Codex R158 VP-I118). */
  meter: AllocMeter | null;
}

/** A built view: the spec it was built for, the requests it reads, the
 *  generations' tables it read (they live while it is shown). */
interface Built<V> { key: string; ids: readonly number[]; view: V | null; uses: Set<GenerationTables> }

const newTables = (generation: number, pairs: Array<[string, string]> | null): GenerationTables =>
  ({ generation, stores: [], pairs, deltas: 0 });

export class ContactPublisher<T extends object, V, S> {
  private readonly reqs = new Map<number, Req>();
  private queue: PublisherMessage[] = [];
  private views = new Map<T, Built<V>>();
  private pass: Pass | null = null;
  private again = false;
  private dirty = false;
  private staged: S | null = null;
  /** The next step begins a task of its own (the publication). */
  private sliceEnd = false;
  /** The macrotask the passes' later slices go in (made once). */
  private nextTask: ((f: () => void) => void) | null = null;
  /** Deltas dropped: an older generation's after a switch, or refused by a table. */
  dropped = 0;
  /** Publications so far. */
  version = 0;
  /** How long the last pass took, start to end (the caller's cadence follows it). */
  lastPassMs = 0;
  /** Passes started, and those whose build was discarded (a fallback, a
   *  release, what is shown changed under the build). */
  passes = 0;
  discards = 0;
  /** The last pass's longest step per phase (1 take, 2 build, 3 publish, 4
   *  catch up), in ms — the work between two yields, measured (plan 3.6). */
  longestStepMs = [0, 0, 0, 0];

  private readonly deps: PublisherDeps<T, V, S>;
  constructor(deps: PublisherDeps<T, V, S>) { this.deps = deps; }

  /** A message of a request's path. */
  receive(m: PublisherMessage): void {
    this.queue.push(m);
    // a fallback signalled while a pass builds this request: that build is discarded (plan 3.6)
    if (m.heldCoverage && this.pass && this.pass.phase <= 2 && this.reqs.get(m.id)?.gen === m.heldCoverage.generation) this.pass.discard = true;
  }

  /** Something the page shows changed without a message (a new request, the
   *  simulation's entry track …): the next pass builds and publishes it. A
   *  running build goes on — its publication checks what is shown then. */
  markDirty(): void { this.dirty = true; }

  /** The published view of `track` (null: none) — a pure read: the page
   *  shows the last publication until the next one. A request it reads may
   *  have no tables yet (nothing found so far); one that was let go takes its
   *  views with it (`release`). */
  viewOf(track: T): V | null { return this.views.get(track)?.view ?? null; }

  /** The state published last (null: none yet). */
  get shown(): S | null { return this.staged; }
  get pending(): boolean { return this.queue.length > 0 || this.dirty; }
  get running(): boolean { return this.pass !== null; }
  get phase(): number { return this.pass?.phase ?? 0; }

  /** Lets go of every request no one owns: its tables, its queued messages,
   *  its open tickets. A pass building one is discarded. */
  release(): void {
    const owners = this.deps.owners();
    const gone = new Set<number>();
    for (const id of [...this.reqs.keys()]) if (!owners.has(id)) { this.reqs.delete(id); gone.add(id); }
    this.queue = this.queue.filter(m => owners.has(m.id));
    if (!gone.size) return;
    for (const [t, p] of this.views) if (p.ids.some(id => gone.has(id))) { this.views.delete(t); this.retire(p); }
    this.markDirty();
    if (this.pass && this.pass.phase <= 2) this.pass.discard = true;
  }

  /** Starts a pass when none runs and there is work (`inline`: its first
   *  slice in this task — a small table publishes before the caller
   *  returns); else one follows the running pass. */
  kick(inline = false): void {
    if (this.pass) { this.again = true; return; }
    if (!this.pending) return;
    this.dirty = false;
    const me: Pass = { run: null, phase: 1, discard: false, built: new Map(), meter: null };
    this.pass = me;
    this.passes++;
    const now = this.deps.now ?? (() => performance.now()), t0 = now();
    const schedule = this.deps.schedule;
    let first = inline;
    const done = () => {
      if (this.pass !== me) return;
      this.pass = null;
      this.lastPassMs = now() - t0;
      if (this.again || this.pending) { this.again = false; this.kick(); }
    };
    me.run = runSteps(this.passSteps(me), {
      ...(this.deps.sliceMs !== undefined ? { sliceMs: this.deps.sliceMs } : {}),
      ...(this.deps.now ? { now: this.deps.now } : {}),
      // (a macrotask, never a timer: Chromium held the slices back under key input)
      schedule: f => { if (first) { first = false; f(); } else (schedule ?? (this.nextTask ??= macrotaskSchedule()))(f); },
      // in the task the pass ends in: the next one may start right after
      onDone: done, onError: e => { console.error("[contacts] a pass failed:", e); done(); },
      // the publication begins its own task when the slice has done work
      // before it (its task was up to a slice longer — 52 ms in Codex R159's
      // run); a small table's, in a slice that took next to nothing, goes on
      endSlice: (ms: number) => { const e = this.sliceEnd && ms >= PUBLISH_ALONE_MS; this.sliceEnd = false; return e; },
    });
    void me.run.promise.catch(() => {});
  }

  private req(id: number): Req {
    let r = this.reqs.get(id);
    if (!r) this.reqs.set(id, r = { gen: -1, copies: null, pub: 0, held: null, fallen: false, ahead: [] });
    return r;
  }
  private workOf(r: Req): GenerationTables | null { return r.copies ? r.copies[1 - r.pub]! : null; }
  /** What a pass builds from: the work copy — a fallen request's published one
   *  (its work copy drains and is never shown). */
  private buildTables(id: number): GenerationTables | null {
    const r = this.reqs.get(id);
    if (!r?.copies) return null;
    return r.fallen ? r.copies[r.pub]! : this.workOf(r);
  }

  /** A message's deltas into one copy, in bounded steps. A refusal is
   *  counted where it is first met (`count`): the copies hold the same rows,
   *  so the catch-up refuses exactly what the work copy refused. */
  private *applyTo(t: GenerationTables, m: PublisherMessage, c: { n: number }, count = true, live: () => boolean = () => true): Steps<void> {
    const deltas: readonly StoreDelta[] = m.contacts ?? [];
    for (let k = 0; k < deltas.length; k++) {
      while (t.stores.length <= k) t.stores.push(new ContactStore(m.id, t.generation, REQUEST_BUDGET));
      // a request let go meanwhile: its copy goes with it — stop at the next step (Codex R157 VP-I116)
      try { const ok = yield* this.whileLive(t.stores[k]!.applySteps(deltas[k]!, c), live); if (ok === null) return; if (!ok && count) this.dropped++; }
      catch (e) { if (count) { this.dropped++; console.error(`[contacts] request ${m.id}: ${String(e)}`); } }
    }
    t.deltas++;
    if (m.contactPairs) t.pairs = m.contactPairs;
  }

  private clock(): number { return (this.deps.now ?? (() => performance.now()))(); }
  /** Runs a job's steps, each one's time into `longestStepMs[k]`; `stop`
   *  ends it before its next step (closed — its data goes): null then. */
  private *timed<R>(job: Steps<R>, k: number, stop?: () => boolean, meter: AllocMeter | null = null): Steps<{ value: R } | null> {
    for (;;) {
      if (stop?.()) { job.return(undefined as never); return null; }
      const t0 = this.clock(), r = withMeter(meter, () => job.next()), dt = this.clock() - t0;
      if (dt > this.longestStepMs[k]!) this.longestStepMs[k] = dt;
      if (r.done) return { value: r.value };
      yield;
    }
  }
  /** A job while `live` holds: its result, or null — closed at the step it stopped. */
  private *whileLive<R>(job: Steps<R>, live: () => boolean): Steps<R | null> {
    for (;;) {
      if (!live()) { job.return(undefined as never); return null; }
      const r = job.next();
      if (r.done) return r.value;
      yield;
    }
  }
  private retire(p: Built<V>): void { if (p.view !== null) this.deps.retire?.(p.view); }

  /** Whether the live state shows exactly the built views' specs. */
  private shows(built: ReadonlyMap<T, { key: string }>): boolean {
    let n = 0;
    for (const track of new Set(this.deps.tracks())) {
      const s = this.deps.specOf(track);
      if (!s) continue;
      if (built.get(track)?.key !== s.key) return false;
      n++;
    }
    return n === built.size;
  }

  private ackOf(m: PublisherMessage): void {
    const d = m.contacts;
    if (d?.length) this.deps.ack({ contactsAck: m.id, generation: d[0]!.generation });
  }

  /** Phase 1 for one message: its deltas into the right copy, its ticket, its effects. */
  private *take(m: PublisherMessage, c: { n: number }): Steps<void> {
    if (!this.deps.owners().has(m.id)) return;   // superseded: its cancel went out
    const r = this.req(m.id);
    if (m.heldCoverage) {
      const g = m.heldCoverage.generation;
      if (r.gen === g && r.copies && !r.fallen) {
        // the fallback: the work copy holds every taken delta — it takes the
        // drain and becomes the held one; its open tickets close now
        r.fallen = true;
        for (const a of r.ahead) this.ackOf(a);
        r.ahead = [];
      }
      const t = r.gen === g && r.fallen ? this.workOf(r) : r.held?.generation === g ? r.held : null;
      if (t) t.covered = m.heldCoverage.covered.slice();
    }
    const deltas = m.contacts;
    if (deltas?.length) {
      const g = deltas[0]!.generation;
      if (r.gen >= 0 && g < r.gen) {
        this.dropped += deltas.length;
        console.warn(`[contacts] request ${m.id}: a generation-${g} delta after generation ${r.gen} — dropped`);
        this.deps.ack({ contactsAck: m.id, generation: g });
      } else {
        if (r.gen < 0 || g > r.gen) {
          if (r.copies) {
            // the new generation's first delta: the complete copy that is not
            // published is the held one now; its open tickets close here
            r.held = this.workOf(r);
            for (const a of r.ahead) this.ackOf(a);
            r.ahead = [];
          }
          r.copies = [newTables(g, m.contactPairs ?? null), newTables(g, m.contactPairs ?? null)];
          r.pub = 0;
          r.gen = g;
          r.fallen = false;
        }
        yield* this.applyTo(this.workOf(r)!, m, c, true, () => this.reqs.get(m.id) === r);
        if (this.reqs.get(m.id) !== r) return;   // let go meanwhile: its cancel went out
        if (r.fallen) this.ackOf(m);   // the drain lands in the copy that is held
        else r.ahead.push(m);
      }
    }
    this.deps.effect(m);
  }

  private *passSteps(me: Pass): Steps<void> {
    const c = { n: 0 };
    // 1 — every message received so far, in arrival order
    const taken = this.queue;
    this.queue = [];
    this.longestStepMs = [0, 0, 0, 0];
    for (const m of taken) yield* this.timed(this.take(m, c), 0);
    const discarded = () => { this.dirty = true; this.discards++; };
    if (me.discard) { discarded(); return; }
    yield;
    // 2 — the views of the tracks shown, from the work copies (a fallen
    // request's from `pub`)
    me.phase = 2;
    const built = me.built as Map<T, Built<V>>;
    for (;;) {
      built.clear();
      for (const track of new Set(this.deps.tracks())) {
        const s = this.deps.specOf(track);
        if (!s) continue;
        // the generations' tables it reads: they live while the view is shown
        const uses = new Set<GenerationTables>();
        const tables = (id: number) => { const t = this.buildTables(id); if (t) uses.add(t); return t; };
        const held = (id: number) => { const h = this.reqs.get(id)?.held ?? null; if (h) uses.add(h); return h; };
        // a discarded build (a fallback, a request let go) stops at its next
        // step — never run to its end (Codex R157 VP-I116)
        // what it allocates is counted from its first step (its view and its
        // buffers while it builds them), then as a built view
        me.meter = { bytes: 0 };
        const out = yield* this.timed(this.deps.build(track, s.spec, tables, held), 1, () => me.discard, me.meter);
        me.meter = null;
        if (!out) { discarded(); return; }
        built.set(track, { key: s.key, ids: s.ids, view: out.value, uses });
      }
      this.sliceEnd = true;
      yield;
      if (me.discard) { discarded(); return; }
      // 3 — one task, and only for what is shown now: a spec changed or a
      // track came or went under the build (another program, a cancel, the
      // timeline's width) — it begins anew, the messages stay taken
      if (this.shows(built)) break;
      this.discards++;
    }
    // the work copies become `pub` (a fallen request keeps its own), the
    // views and the state staged now
    me.phase = 3;
    const staged = this.deps.stage();
    for (const r of this.reqs.values()) if (r.copies && !r.fallen) r.pub = r.pub === 0 ? 1 : 0;
    // the views published before are dead from here on — every query of one
    // fails, wherever it is still held (Codex R157 VP-I117)
    const old = this.views;
    this.views = new Map(built);
    built.clear();
    for (const p of old.values()) this.retire(p);
    this.staged = staged;
    this.version++;
    const p0 = this.clock();
    this.deps.publish(staged);
    this.longestStepMs[2] = this.clock() - p0;
    // 4 — the other, now dead copy catches up; then the tickets (the page
    // renders the publication first)
    me.phase = 4;
    yield;
    for (const [id, r] of [...this.reqs]) {
      if (!r.copies || r.fallen || !r.ahead.length) continue;
      const dead = this.workOf(r)!, ahead = r.ahead;
      for (const m of ahead) yield* this.timed(this.applyTo(dead, m, c, false, () => this.reqs.get(id) === r), 3);
      if (this.reqs.get(id) !== r || r.ahead !== ahead) continue;   // released, or a fallback closed them
      for (const m of ahead) this.ackOf(m);
      r.ahead = [];
    }
  }

  // ---- for tests and diagnostics ----
  /** A request's copies: the published one, the work one, the held one. */
  tablesOf(id: number): { pub: GenerationTables | null; work: GenerationTables | null; held: GenerationTables | null; fallen: boolean } | null {
    const r = this.reqs.get(id);
    return r ? { pub: r.copies ? r.copies[r.pub]! : null, work: this.workOf(r), held: r.held, fallen: r.fallen } : null;
  }
  ids(): number[] { return [...this.reqs.keys()]; }
  /** The tables' memory here (allocated blocks with their marks, rows in
   *  use), in all and by owner — the published copies, the work copies, the
   *  held generations (plan 3.4 / 3.6: each owner measured). */
  stats(): { requests: number; rows: { episodes: number; intervals: number; gaps: number }; allocated: number; used: number;
             byOwner: { pub: number; work: number; held: number; shown: number };
             views: { published: number; waiting: number; inProgress: number; building: number } } {
    // every store that lives counted ONCE, by its first owner: the request's
    // published copy, its work copy, its held generation — and the tables only
    // a published view still reads (the old generation's published copy until
    // the union replaces it; Codex R157 VP-I118)
    const rows = { episodes: 0, intervals: 0, gaps: 0 }, byOwner = { pub: 0, work: 0, held: 0, shown: 0 };
    const seen = new Set<ContactStore>();
    let allocated = 0, used = 0;
    const add = (t: GenerationTables | null, owner: keyof typeof byOwner, count: boolean) => {
      for (const st of t?.stores ?? []) {
        if (seen.has(st)) continue;
        seen.add(st);
        if (count) { rows.episodes += st.episodes.rows; rows.intervals += st.intervals.rows; rows.gaps += st.gaps.rows; }
        allocated += st.allocatedBytes(); used += st.usedBytes(); byOwner[owner] += st.allocatedBytes();
      }
    };
    for (const r of this.reqs.values()) {
      add(r.copies ? r.copies[r.pub]! : null, "pub", true);
      add(this.workOf(r), "work", false);
      add(r.held, "held", true);
    }
    for (const p of this.views.values()) for (const t of p.uses) add(t, "shown", false);
    const bytes = (ps: Iterable<Built<V>>) => { let n = 0; for (const p of ps) if (p.view !== null) n += this.deps.viewBytes?.(p.view) ?? 0; return n; };
    // apart: the published views, the built ones waiting for their
    // publication, and what the build running now has allocated so far
    // (Codex R158 VP-I118); building = the two of this pass
    const waiting = bytes(this.pass ? (this.pass.built as Map<T, Built<V>>).values() : []), inProgress = this.pass?.meter?.bytes ?? 0;
    return { requests: this.reqs.size, rows, allocated, used, byOwner,
             views: { published: bytes(this.views.values()), waiting, inProgress, building: waiting + inProgress } };
  }
  /** Puts tables in as a request's current generation, both copies (the
   *  diagnostic seam that lays made-up findings over a result). */
  inject(id: number, stores: ContactStore[], pairs: Array<[string, string]>, copy: (st: ContactStore) => ContactStore): void {
    const g = stores[0]?.generation ?? 0;
    this.reqs.set(id, { gen: g, pub: 0, held: null, fallen: false, ahead: [],
      copies: [{ generation: g, stores, pairs, deltas: 0 }, { generation: g, stores: stores.map(copy), pairs, deltas: 0 }] });
    this.markDirty();
  }
}
