// Plan 3.6 (Form 1, Fassung 2; Codex R152, R154–R156): the publisher's
// transitions with real tables and deltas, its steps driven one at a time.
import { describe, expect, it } from "vitest";
import { ContactStore, IV_ENTER_DECIDED, IV_EXIT_DECIDED, NONE, shareOf, REQUEST_BUDGET } from "./contactStore";
import { buildContactViewSteps, heldBytes, retireView, targetKey, targetPos, type ContactView } from "./contactView";
import { ContactPublisher, contactOwners, type GenerationTables, type PublisherMessage } from "./contactPublisher";

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
    retire: v => retireView(v),
    viewBytes: v => heldBytes(v),
    ack: a => { events.push("ack"); acks.push(a); },
    owners: () => owners,
    schedule: f => queue.push(f),
    sliceMs: 0,   // every slice one step
    now: () => 0,
  });
  /** Runs slices until `until` holds (or nothing is left) — at most `max`:
   *  a pass that never ends (discarded by every read) fails here, on an
   *  assertion, not on the worker's memory. */
  const run = (until: () => boolean = () => false, max = 20_000) => {
    let k = 0;
    for (; k < max && queue.length && !until(); k++) queue.shift()!();
    expect(k < max || !queue.length || until(), `the passes end within ${max} slices`).toBe(true);
  };
  return { p, queue, acks, effects, published, events, track, extra, run, owners, views: () => views, setLive: (tag: string) => { live = { tag, n: effects.length }; } };
}
const keysOf = (v: ContactView | null) => v ? Array.from({ length: v.n }, (_, i) => targetKey(v, i)) : [];
const posOf = (v: ContactView | null) => v ? Array.from({ length: v.n }, (_, i) => targetPos(v, i)) : [];

describe("the publication begins a task of its own (Codex R159: a slice's build steps before it made its task longer)", () => {
  it("with time for every step in one slice, a slice that has worked ends before the publication", () => {
    const queue: Array<() => void> = [], track = {};
    let clock = 0;
    const st = new ContactStore(1, 0);
    for (let i = 0; i < 64; i++) {
      const ep = st.episodes.append({ pair: i, ordinal: 0, onset: 4 * i, end: 4 * i + 1, closeAt: 4 * i, closeDist: 0, firstIv: NONE, ivCount: 1, flags: 0 });
      st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: 4 * i, exit: 4 * i + 1, flags: D, next: NONE, witness: 4 * i + 0.5, freeAt: NaN, freeR: 0 }));
    }
    let published = 0;
    const p = new ContactPublisher<object, ContactView, object>({
      tracks: () => [track], specOf: () => ({ key: "one", ids: [1], spec: null }),
      *build(_t, _s, tables) { const t = tables(1); return t ? yield* buildContactViewSteps({ sources: [{ stores: t.stores, at: c => c, ownCoverage: 1e9 }], pairName: names, coverage: 1e9 }) : null; },
      viewBytes: v => heldBytes(v), retire: v => retireView(v),
      effect: () => {}, stage: () => ({}), publish: () => { published++; }, ack: () => {}, owners: () => new Set([1]),
      schedule: f => queue.push(f), sliceMs: 1e9, now: () => (clock += 1),
    });
    p.receive({ id: 1, contacts: [st.takeDelta(true)!], contactPairs: [["t", "w"]] });
    p.kick();
    queue.shift()!();
    expect([published, p.phase], "the first slice: the take and the build, not the publication").toEqual([0, 2]);
    queue.shift()!();
    expect(published, "the next task publishes").toBe(1);
  });
});

describe("the publisher: two copies, one published, never written (plan 3.6)", () => {
  it("a delta: into the work copy, the views from it, published in one step; the other copy catches up; acknowledged only then", () => {
    const h = harness(), s = new Sender(1, 0);
    h.p.viewOf(h.track);
    h.p.receive(s.contact(0, 10).msg({ tag: "a" }));
    h.p.kick();
    h.run(() => h.p.phase === 4);
    expect(h.published.length, "published").toBe(1);
    expect(h.acks, "no acknowledgement before the catch-up").toEqual([]);
    expect(posOf(h.published[0]!.views)).toEqual([10]);
    expect(h.published[0]!.shown.tag, "the state the page shows, staged with its tables").toBe("a");
    h.run();
    expect(h.acks).toEqual([{ contactsAck: 1, generation: 0 }]);
    const t = h.p.tablesOf(1)!;
    expect(t.pub).not.toBe(t.work);
    expect([t.pub!.stores[0]!.intervals.rows, t.work!.stores[0]!.intervals.rows], "both copies hold it").toEqual([1, 1]);
  });

  it("two deltas of one request out at once — the first interval beside a near miss's (C2, Codex R167): taken in order, each acknowledged", () => {
    const h = harness(), st = new ContactStore(1, 0);
    h.p.viewOf(h.track);
    st.episodes.append({ pair: 0, ordinal: 0, flags: 0, onset: 5, end: NaN, closeAt: 5, closeDist: 1, firstIv: NONE, ivCount: 0 });
    const d1 = st.takeDelta()!;                       // a near miss: its acknowledgement not back
    st.episodes.set(0, "end", 6);
    const ep = st.episodes.append({ pair: 1, ordinal: 1, flags: 0, onset: 10, end: 11, closeAt: 10, closeDist: 0, firstIv: NONE, ivCount: 1 });
    st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: 10, exit: 11, flags: D, next: NONE, witness: 10.5, freeAt: 11.5, freeR: 0.1 }));
    const d2 = st.takeDelta()!;                       // the first interval, beside it
    expect(d2, "out beside the first").not.toBeNull();
    h.p.receive({ id: 1, contacts: [d1], contactPairs: [["t", "w"], ["t", "x"]] });
    h.p.kick();
    h.run(() => h.p.phase === 2);                     // the near miss's pass builds
    h.p.receive({ id: 1, contacts: [d2] });           // the touch arrives meanwhile
    h.p.kick();
    h.run();
    expect(h.acks, "each acknowledged, in order").toEqual([{ contactsAck: 1, generation: 0 }, { contactsAck: 1, generation: 0 }]);
    expect(posOf(h.views()), "the touch published").toContain(10);
    const t = h.p.tablesOf(1)!;
    for (const c of [t.pub!, t.work!]) {
      expect([c.stores[0]!.episodes.rows, c.stores[0]!.intervals.rows, c.stores[0]!.episodes.get(0, "end")], "both copies equal the sender").toEqual([2, 1, 6]);
    }
  });

  it("the published copy is never written; a view held across the next publication and its catch-up throws", () => {
    const h = harness(), s = new Sender(1, 0);
    h.p.viewOf(h.track);
    h.p.receive(s.contact(0, 10).msg());
    h.p.kick(); h.run();
    const old = h.published[0]!.views!;
    const pub1 = h.p.tablesOf(1)!.pub!, rev1 = pub1.stores[0]!.revision;
    h.p.receive(s.contact(0, 20).msg());
    h.p.kick();
    // while it applies and builds, the published copy stays as it was and its view reads
    h.run(() => h.p.phase === 3 || h.p.phase === 4);
    expect(pub1.stores[0]!.revision, "never written while published").toBe(rev1);
    h.run();
    expect(posOf(h.views())).toEqual([10, 20]);
    // dead since the publication that replaced it
    expect(() => targetPos(old, 0)).toThrow(/no longer published|changed/);
  });

  it("an update-heavy delta goes in in steps, in both copies (Codex R155 VP155-01)", () => {
    const h = harness(), s = new Sender(1, 0);
    for (let i = 0; i < 3000; i++) s.contact(i % 64, 3 * i);
    h.p.viewOf(h.track);
    h.p.receive(s.msg()); h.p.kick(); h.run();
    s.touchAll();
    h.p.receive(s.msg()); h.p.kick();
    let slices = 0, phase1 = 0, phase4 = 0;
    for (let k = 0; k < 1_000_000 && h.queue.length; k++) { const ph = h.p.phase; h.queue.shift()!(); slices++; if (ph === 1) phase1++; if (ph === 4) phase4++; }
    expect(phase1, "the updates into the work copy: several steps").toBeGreaterThan(3);
    expect(phase4, "and into the other copy: several steps").toBeGreaterThan(3);
    expect(h.acks.length).toBe(2);
  });
});

describe("a fallback in every phase: the build discarded, never the evidence (plan 3.6 Fassung 2, VP155-02)", () => {
  const phases: Array<[string, number | "after"]> = [["taking", 1], ["building", 2], ["catching up", 4], ["after the pass", "after"]];
  it.each(phases)("the fallback while %s: D1 and the drain's D2 in the held generation, every ticket once, `pub` untouched until the union", (_, at) => {
    const h = harness(), s = new Sender(1, 0);
    h.p.viewOf(h.track);
    h.p.receive(s.contact(0, 10).msg()); h.p.kick(); h.run();                // D0, published and caught up
    // D1: one contact at 20, then enough rows that its apply takes several steps
    s.contact(1, 20);
    for (let i = 0; i < 3000; i++) s.contact(5 + (i % 50), 1000 + 3 * i);
    h.p.receive(s.msg()); h.p.kick();
    if (at === "after") h.run();
    else {
      h.run(() => h.p.phase === at);
      h.queue.shift()!();   // a step inside the phase
      expect(h.p.phase, "still in the phase").toBe(at);
    }
    const pubBefore = h.p.tablesOf(1)!.pub!, revBefore = pubBefore.stores[0]!.revision;
    // the fallback, then the old generation's drain with another contact
    h.p.receive({ id: 1, heldCoverage: { generation: 0, covered: [0.7] } });
    h.p.receive(s.contact(2, 30).msg());                                         // D2 (generation 0)
    h.p.kick(); h.run();
    const t = h.p.tablesOf(1)!;
    expect(t.fallen).toBe(true);
    expect(t.pub, "the copy published before the fallback is still the published one").toBe(pubBefore);
    expect(pubBefore.stores[0]!.revision, "and untouched").toBe(revBefore);
    expect(t.work!.stores[0]!.intervals.rows, "the copy that becomes held: D0, D1, D2").toBe(3003);
    // the drain is acknowledged as it lands: the worker's new generation says
    // nothing until it is (a drain waiting for the new generation deadlocks)
    expect(h.acks.filter(a => a.generation === 0).length, "D0, D1 and the drain's D2 before any word of generation 1").toBe(3);
    // the new generation: the union of the held one and the new
    const n = new Sender(1, 1);
    h.p.receive(n.contact(0, 10).msg()); h.p.kick(); h.run();
    const after = h.p.tablesOf(1)!;
    expect(after.held!.stores[0]!.intervals.rows, "held: D0, D1, D2").toBe(3003);
    expect(after.held!.covered, "with its own coverage").toEqual([0.7]);
    expect(posOf(h.views()).slice(0, 3), "the union shows every earlier contact").toEqual([10, 20, 30]);
    // each ticket exactly once: D0, D1, D2 (generation 0), then the new one
    expect(h.acks.filter(a => a.generation === 0).length).toBe(3);
    expect(h.acks.filter(a => a.generation === 1).length).toBe(1);
    expect(keysOf(h.views()).length).toBe(3003);
  });

  it("a discarded pass acknowledges nothing; its deltas are acknowledged by the transition that keeps them", () => {
    const h = harness(), s = new Sender(1, 0);
    h.p.viewOf(h.track);
    h.p.receive(s.contact(0, 10).msg()); h.p.kick();
    h.run(() => h.p.phase === 2);
    h.p.receive({ id: 1, heldCoverage: { generation: 0, covered: [1] } });   // discards the build
    h.p.kick(); h.run();
    // the discarded pass published nothing and caught nothing up: the one
    // acknowledgement is the fallback's, given while the next pass takes it
    expect(h.acks).toEqual([{ contactsAck: 1, generation: 0 }]);
    const e = h.events;
    expect(e.slice(0, 1), "the discarded pass: D1 taken, nothing staged or published").toEqual(["effect"]);
    expect(e.slice(1, 3), "then the fallback's transition closes the ticket").toEqual(["ack", "effect:held"]);
    expect([h.p.passes, h.p.discards]).toEqual([2, 1]);
  });
});

describe("cancel and the shown state (plan 3.6)", () => {
  it("a request no one owns goes with its tables and its tickets — while it is taken or caught up", () => {
    for (const at of [1, 4]) {
      const owners = new Set([1, 2]);
      const h = harness({ owners }), a = new Sender(1, 0), b = new Sender(2, 0);
      h.p.viewOf(h.track);
      h.p.receive(a.contact(0, 10).msg()); h.p.receive(b.contact(0, 5).msg()); h.p.kick();
      h.run(() => h.p.phase === at);
      owners.delete(2);
      h.p.release();
      h.p.kick(); h.run();
      expect(h.acks.map(x => x.contactsAck), `cancel in phase ${at}: no ticket of the released request`).not.toContain(2);
      expect(h.p.ids()).toEqual([1]);
    }
  });

  it("progress alone during a build, then quiet: the last state is published — no endless pass, no waiting for a delta (Codex R155 answer 2)", () => {
    const h = harness(), s = new Sender(1, 0);
    for (let i = 0; i < 500; i++) s.contact(i % 9, 3 * i);
    h.p.viewOf(h.track);
    h.p.receive(s.msg({ tag: "p0" })); h.p.kick();
    h.run(() => h.p.phase === 2);
    for (const tag of ["p1", "p2", "p3"]) { h.p.receive({ id: 1, tag }); h.p.kick(); }
    h.run();
    expect(h.queue.length, "quiet").toBe(0);
    expect(h.published[h.published.length - 1]!.shown.tag, "the last progress is published").toBe("p3");
    expect(h.published.length, "a pass for the build, one for the progress — no restart loop").toBeLessThanOrEqual(3);
  });

  it("a pass never discards itself: reads of the published view and its own effects between its steps change nothing (the viewer reads while a pass runs)", () => {
    const h = harness(), s = new Sender(1, 0);
    for (let i = 0; i < 500; i++) s.contact(i % 9, 3 * i);
    h.p.receive(s.msg({ tag: "p0" })); h.p.kick(); h.run();
    const before = { passes: h.p.passes, discards: h.p.discards, published: h.published.length };
    for (let i = 0; i < 200; i++) s.contact(i % 9, 2000 + 3 * i);
    h.p.receive(s.msg({ tag: "p1" })); h.p.kick();
    // the page between every two steps: it renders the published views (21
    // steps here; a pass discarded by every read never ends — bounded, so it
    // fails on the assertion below, not on the worker's memory)
    for (let k = 0; k < 2_000 && h.queue.length; k++) { h.queue.shift()!(); h.p.viewOf(h.track); }
    expect(h.queue.length, "the passes end").toBe(0);
    expect([h.p.passes - before.passes, h.p.discards - before.discards, h.published.length - before.published, h.p.pending],
      "one pass, no discard, one publication, nothing left").toEqual([1, 0, 1, false]);
    expect(h.published[h.published.length - 1]!.shown.tag).toBe("p1");
    expect(posOf(h.views()).length).toBe(700);
  });

  it("what is shown changes under the build: the build begins anew from the work copy, the messages stay taken, the publication carries what is shown then", () => {
    const h = harness(), s = new Sender(1, 0);
    for (let i = 0; i < 500; i++) s.contact(i % 9, 3 * i);
    h.p.receive(s.msg({ tag: "a" })); h.p.kick();
    h.run(() => h.p.phase === 2);
    h.queue.shift()!();                       // a step of the build
    h.setLive("outside");                     // another spec (a cancel, the timeline's width …)
    h.extra.push({ name: "entry" });          // and a track that comes
    h.run();
    expect([h.p.passes, h.p.discards, h.published.length, h.effects.length]).toEqual([1, 1, 1, 1]);
    expect(h.published[0]!.shown.tag, "staged at the publication").toBe("outside");
    expect([posOf(h.p.viewOf(h.track)).length, posOf(h.p.viewOf(h.extra[0]!)).length], "both tracks built").toEqual([500, 500]);
    expect(h.acks.length, "acknowledged once, after the catch-up").toBe(1);
  });

  it("a track that goes under the build is not published", () => {
    const h = harness(), s = new Sender(1, 0), entry = { name: "entry" };
    h.extra.push(entry);
    for (let i = 0; i < 500; i++) s.contact(i % 9, 3 * i);
    h.p.receive(s.msg({ tag: "a" })); h.p.kick();
    h.run(() => h.p.phase === 2);
    h.queue.shift()!();
    h.extra.pop();
    h.run();
    expect([h.p.discards, h.published.length]).toEqual([1, 1]);
    expect([h.p.viewOf(entry), posOf(h.p.viewOf(h.track)).length]).toEqual([null, 500]);
  });

  it("a view reads a request without tables yet (nothing found so far); letting a request go takes its views", () => {
    const owners = new Set([1, 99]);
    const h = harness({ owners }), s = new Sender(1, 0);
    h.p.receive(s.contact(0, 10).msg({ tag: "a" })); h.p.kick(); h.run();
    expect(h.p.tablesOf(99), "request 99 sent nothing").toBeNull();
    expect(posOf(h.p.viewOf(h.track)), "its view is published and read").toEqual([10]);
    owners.delete(99); h.p.release();
    expect(posOf(h.p.viewOf(h.track)), "99 held no tables: nothing of it to let go").toEqual([10]);
    owners.delete(1); h.p.release();
    expect(h.p.viewOf(h.track), "request 1's tables went: its view with them").toBeNull();
  });

  it("its later slices go in a macrotask, never a timer (R163: Chromium held timers and posted messages back under key input)", async () => {
    const g = globalThis as unknown as Record<string, unknown>, saved = g.setTimeout;
    const s = new Sender(1, 0), tk = {};
    let pub = false;
    const p2 = new ContactPublisher<object, number, string>({
      tracks: () => [tk], specOf: () => ({ key: "k", ids: [1], spec: null }), *build() { for (let i = 0; i < 4; i++) yield; return 1; }, effect: () => {},
      stage: () => "s", publish: () => { pub = true; }, ack: () => {}, owners: () => new Set([1]), sliceMs: 0, now: () => 0,
    });
    g.setTimeout = () => { throw new Error("a slice in a timer"); };
    try {
      p2.receive(s.contact(0, 20).msg());
      p2.kick(true);
      for (let i = 0; i < 50 && !pub; i++) await new Promise<void>(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); r(); }; ch.port2.postMessage(0); });
    } finally { g.setTimeout = saved; }
    expect(pub, "published through macrotasks").toBe(true);
  });

  it("a small table publishes before the caller returns when the first slice runs inline", () => {
    const h = harness(), s = new Sender(1, 0);
    h.p.viewOf(h.track);
    h.p.receive(s.contact(0, 10).msg({ tag: "x" }));
    // inline with a slice long enough for the whole pass — on a standing clock:
    // a slice that worked 1 ms publishes in a task of its own (R160), and a
    // loaded gate once took that long for this table (R162, 17 ms)
    const q: Array<() => void> = [];
    const tk = {};
    const p2 = new ContactPublisher<object, number, string>({
      tracks: () => [tk], specOf: () => ({ key: "k", ids: [1], spec: null }), *build() { yield; return 1; }, effect: () => {}, stage: () => "s",
      publish: () => { pub = true; }, ack: () => {}, owners: () => new Set([1]), schedule: f => q.push(f), sliceMs: 1e9, now: () => 0,
    });
    let pub = false;
    p2.receive(s.contact(0, 20).msg());
    p2.kick(true);
    expect(pub, "published in this task").toBe(true);
    expect(p2.viewOf(tk)).toBe(1);
  });
});

// The transport's rules, kept from the receiver of round B2 (plan 3.1/3.5,
// Codex R144–R150) — the publisher replaced it and carries them over.
const ep = (s: ContactStore, pair: number) => s.episodes.append({ pair, ordinal: 0, onset: pair, end: NaN, closeAt: pair, closeDist: 1, firstIv: NONE });
/** A publisher whose every pass runs at once (a standing clock, inline slices). */
function quick(owners: () => ReadonlySet<number>) {
  const acks: Array<{ contactsAck: number; generation: number }> = [];
  const p = new ContactPublisher<object, null, null>({ tracks: () => [], specOf: () => null, *build() { yield; return null; }, effect: () => {}, stage: () => null,
    publish: () => {}, ack: a => acks.push(a), owners, now: () => 0, schedule: f => f() });
  const send = (m: PublisherMessage) => { p.receive(m); p.kick(true); };
  return { p, acks, send };
}

describe("the transport's rules (round B2, plan 3.1/3.5)", () => {
  it("a request's deltas per shard, its pairs; acknowledged by the delta's generation; both copies equal", () => {
    const q = quick(() => new Set([7]));
    const a = new ContactStore(7, 0), b = new ContactStore(7, 0);
    ep(a, 1); ep(b, 2);
    q.send({ id: 7, contacts: [a.takeDelta()!, b.takeDelta()!], contactPairs: [["t", "w"], ["t", "x"], ["t", "y"]] });
    expect(q.acks).toEqual([{ contactsAck: 7, generation: 0 }]);
    a.ack(); b.ack();
    a.episodes.set(0, "end", 3);
    q.send({ id: 7, contacts: [a.takeDelta(true)!, b.takeDelta(true)!] });
    for (const which of ["pub", "work"] as const) {
      const t = q.p.tablesOf(7)![which]!;
      expect([t.generation, t.stores.length, t.stores[0]!.episodes.get(0, "end"), t.stores[1]!.episodes.rows, t.pairs?.length, t.deltas], which)
        .toEqual([0, 2, 3, 1, 3, 2]);
    }
    q.send({ id: 7 });
    expect(q.acks.length, "a message without deltas: nothing to acknowledge").toBe(2);
  });

  it("a newer generation is the current one and the one before is HELD; an older one after the switch is dropped (and acknowledged)", () => {
    const q = quick(() => new Set([9]));
    const g0 = new ContactStore(9, 0), g1 = new ContactStore(9, 1);
    ep(g0, 1); ep(g1, 1); ep(g1, 2);
    q.send({ id: 9, contacts: [g0.takeDelta()!] }); g0.ack();
    q.send({ id: 9, contacts: [g1.takeDelta()!] });
    const t = q.p.tablesOf(9)!;
    expect([t.pub!.generation, t.held!.generation, t.pub!.stores[0]!.episodes.rows]).toEqual([1, 0, 2]);
    ep(g0, 3);
    q.send({ id: 9, contacts: [g0.takeDelta()!] });
    expect(q.acks[q.acks.length - 1], "acknowledged so its path never stalls").toEqual({ contactsAck: 9, generation: 0 });
    expect([q.p.dropped, q.p.tablesOf(9)!.held!.stores[0]!.episodes.rows], "dropped, never patched into the held generation").toEqual([1, 1]);
  });

  it("a pool's coverage goes with its generation's tables and stays with them at the switch (Codex R150 VP150-02)", () => {
    const q = quick(() => new Set([9]));
    const g0 = new ContactStore(9, 0), g1 = new ContactStore(9, 1);
    ep(g0, 1); ep(g1, 1);
    q.send({ id: 9, contacts: [g0.takeDelta()!] }); g0.ack();
    q.send({ id: 9, heldCoverage: { generation: 0, covered: [0.25, 0.5] } });
    expect(q.acks.length, "the coverage carries no ticket").toBe(1);
    const t0 = q.p.tablesOf(9)!;
    expect([t0.fallen, t0.work!.covered, t0.pub!.covered], "the copy that drains holds it; the published one is untouched").toEqual([true, [0.25, 0.5], undefined]);
    q.send({ id: 9, contacts: [g1.takeDelta()!] });
    const t1 = q.p.tablesOf(9)!;
    expect([t1.held!.generation, t1.held!.covered, t1.pub!.covered]).toEqual([0, [0.25, 0.5], undefined]);
    // a word for another generation touches neither
    q.send({ id: 9, heldCoverage: { generation: 5, covered: [1] } });
    expect([t1.held!.covered, q.p.tablesOf(9)!.pub!.covered, q.p.tablesOf(9)!.work!.covered]).toEqual([[0.25, 0.5], undefined, undefined]);
  });

  it("a delta out of order is refused by its table, counted once, never patched in — and acknowledged; requests are let go", () => {
    const own = new Set([3]);
    const q = quick(() => own);
    const s = new ContactStore(3, 0);
    ep(s, 1); s.takeDelta(); s.ack();   // the first delta never reaches the owner
    ep(s, 2);
    q.send({ id: 3, contacts: [s.takeDelta()!] });
    expect([q.p.dropped, q.p.tablesOf(3)!.pub!.stores[0]!.episodes.rows, q.p.tablesOf(3)!.work!.stores[0]!.episodes.rows, q.acks.length]).toEqual([1, 0, 0, 1]);
    own.clear(); own.add(4);
    q.p.release();
    expect(q.p.tablesOf(3)).toBeNull();
  });

  it("counts the tables' memory: rows of the published and held generations, the bytes of every copy by owner", () => {
    const q = quick(() => new Set([5]));
    const a = new ContactStore(5, 0), b = new ContactStore(5, 1);
    ep(a, 1); ep(b, 1); ep(b, 2);
    q.send({ id: 5, contacts: [a.takeDelta()!] });
    q.send({ id: 5, contacts: [b.takeDelta()!] });
    const st = q.p.stats();
    expect([st.requests, st.rows.episodes]).toEqual([1, 3]);
    expect(st.used, "published 2, work 2, held 1 rows").toBe(5 * 46);
    expect(st.allocated).toBeGreaterThanOrEqual(st.used);
    expect([st.byOwner.pub > 0, st.byOwner.work > 0, st.byOwner.held > 0]).toEqual([true, true, true]);
    expect(st.byOwner.pub + st.byOwner.work + st.byOwner.held).toBe(st.allocated);
  });
});

// Codex R147 VP-I106: a side run's result stays shown after its run ended —
// its tables must outlive the run until the result is replaced or dropped.
describe("whose tables stay (Codex R147 VP-I106)", () => {
  const owners = (o: Partial<Parameters<typeof contactOwners>[0]> & { main: number }) =>
    contactOwners({ side: null, result: null, entry: null, runSide: null, sideFirst: null, ...o });
  function rig() {
    let own = owners({ main: 7 });
    const q = quick(() => own), main = new ContactStore(7, 0);
    /** Who owns what now; the publisher lets the rest go (the viewer releases on every change of it). */
    const set = (o: Set<number>) => { own = o; q.p.release(); };
    const mainDelta = () => { ep(main, main.episodes.rows + 2); q.send({ id: 7, contacts: [main.takeDelta(true)!] }); main.ack(); };
    /** A side run `id` in flight sends its tables (its result follows). */
    const side = (id: number, also: Partial<Parameters<typeof contactOwners>[0]> = {}) => {
      set(owners({ main: 7, side: id, ...also }));
      const s = new ContactStore(id, 0); ep(s, 1); q.send({ id, contacts: [s.takeDelta()!] });
    };
    return { q, set, mainDelta, side };
  }
  it("the side run ends first, the main request sends on: the shown entry result's tables stay; a replacing side lets them go", () => {
    for (const shown of ["entry", "runSide"] as const) {
      const r = rig();
      r.mainDelta();
      r.side(-1);                                       // the side's result, with its tables; the run is over
      r.set(owners({ main: 7, [shown]: -1 }));
      r.mainDelta();
      expect(r.q.p.tablesOf(-1), `${shown}: kept while shown`).not.toBeNull();
      // the next side run replaces it: once its result is the shown one, -1 is no one's
      r.side(-2, { [shown]: -1 });
      r.set(owners({ main: 7, [shown]: -2 }));
      r.mainDelta();
      expect([r.q.p.tablesOf(-1), r.q.p.tablesOf(-2) !== null], `${shown}: replaced`).toEqual([null, true]);
    }
  });

  it("the main request ends first: the side's tables, the result's and a cancelled request's shown result stay", () => {
    const r = rig();
    r.mainDelta();
    r.side(-1);
    // a cancel moved the request id on (8) while request 7's result is shown
    r.set(owners({ main: 8, result: 7, entry: -1 }));
    expect([r.q.p.tablesOf(7) !== null, r.q.p.tablesOf(-1) !== null]).toEqual([true, true]);
    r.set(owners({ main: 8 }));
    expect(r.q.p.ids(), "nothing shown: only the request in flight").toEqual([]);
  });

  it("a message of a request no one owns is never taken (its cancel went out)", () => {
    const r = rig();
    r.set(owners({ main: 8 }));
    r.mainDelta();
    expect([r.q.p.ids(), r.q.acks.length]).toEqual([[], 0]);
  });

  it("every field counts", () => {
    expect([...contactOwners({ main: 1, side: -1, result: 2, entry: -2, runSide: -3, sideFirst: -4 })].sort((a, b) => a - b))
      .toEqual([-4, -3, -2, -1, 1, 2]);
  });
});
void shareOf; void REQUEST_BUDGET;

// Codex R157's counterexamples (VP-I116–VP-I118), kept as guards: a view's
// life ends at the publication that replaces it, a discarded build stops at
// its next step, and the memory counts every store that lives — the old
// generation's published copy too while a view still shows it.
describe("a view's life, a discarded build, the live memory (Codex R157)", () => {
  it("VP-I117: an old view is dead at the publication that replaces it — before its tables are written", () => {
    const h = harness(), s = new Sender(1, 0);
    h.p.receive(s.contact(0, 10).msg()); h.p.kick(); h.run();
    const old = h.views()!;
    h.p.receive(s.contact(1, 20).msg()); h.p.kick(); h.run(() => h.p.phase === 4);
    expect(posOf(h.views())).toEqual([10, 20]);
    expect(() => targetPos(old, 0), "dead at the publication").toThrow(/no longer published/);
  });
  it("VP-I117: and at a publication without any table write", () => {
    const h = harness(), s = new Sender(1, 0);
    h.p.receive(s.contact(0, 10).msg()); h.p.kick(); h.run();
    const old = h.views()!;
    h.p.receive({ id: 1, tag: "coverage changed" }); h.p.kick(); h.run();
    expect(h.views()).not.toBe(old);
    expect(() => targetPos(old, 0)).toThrow(/no longer published/);
    expect(posOf(h.views()), "the new view reads the same tables").toEqual([10]);
  });
  it("VP-I117: a request let go takes its views — dead at once", () => {
    const owners = new Set([1]);
    const h = harness({ owners }), s = new Sender(1, 0);
    h.p.receive(s.contact(0, 10).msg()); h.p.kick(); h.run();
    const old = h.views()!;
    owners.clear(); h.p.release();
    expect(h.p.viewOf(h.track)).toBeNull();
    expect(() => targetPos(old, 0)).toThrow(/no longer published/);
  });
  it("VP-I118: the old generation's published copy counts while a view still shows it — every live store once", () => {
    const h = harness(), s = new Sender(1, 0);
    h.p.receive(s.contact(0, 10).msg()); h.p.kick(); h.run();
    h.p.receive({ id: 1, heldCoverage: { generation: 0, covered: [1] } }); h.p.kick(); h.run();
    const shown = h.p.viewOf(h.track)!;
    h.p.receive(new Sender(1, 1).contact(0, 10).msg()); h.p.kick(); h.run(() => h.p.phase === 2);
    expect(h.p.viewOf(h.track), "the old view still shown").toBe(shown);
    const t = h.p.tablesOf(1)!, live = new Set<ContactStore>();
    for (const g of [t.pub, t.work, t.held]) for (const st of g?.stores ?? []) live.add(st);
    for (const ti of shown.tables) if (ti) live.add(ti.st);
    const actual = [...live].reduce((n, st) => n + st.allocatedBytes(), 0), st = h.p.stats();
    expect(st.allocated, "all simultaneously live owners").toBe(actual);
    expect(st.byOwner.shown, "the shown old copy, named").toBeGreaterThan(0);
    expect(st.views.published, "the published view's own bytes").toBe(heldBytes(shown));
  });
  it("VP-I116: a request let go stops its build at the next step — no stale build to its end", () => {
    const tasks: Array<() => void> = [], owners = new Set([1]);
    let steps = 0;
    const track = {};
    const p = new ContactPublisher<object, object, object>({ tracks: () => (owners.size ? [track] : []), specOf: () => ({ key: "one", ids: [1], spec: null }),
      *build() { for (let i = 0; i < 100; i++) { steps++; yield; } return {}; }, effect: () => {}, stage: () => ({}), publish: () => {}, ack: () => {},
      owners: () => owners, schedule: f => tasks.push(f), sliceMs: 0, now: () => 0 });
    p.receive({ id: 1 }); p.kick();
    while (tasks.length && steps < 5) tasks.shift()!();
    const atCancel = steps;
    owners.clear(); p.release(); p.kick();
    for (let i = 0; i < 1000 && tasks.length; i++) tasks.shift()!();
    expect(steps - atCancel, "steps after it was let go").toBeLessThanOrEqual(1);
    expect([p.discards, p.running], "discarded, ended").toEqual([1, false]);
  });
  it("VP-I116: a request let go while its delta goes in, or while the other copy catches up, stops there", () => {
    for (const at of [1, 4]) {
      const owners = new Set([1]);
      const h = harness({ owners }), s = new Sender(1, 0);
      for (let i = 0; i < 3000; i++) s.contact(i % 64, 3 * i);
      h.p.receive(s.msg()); h.p.kick(); h.run();
      const acks = h.acks.length;
      // an update over every row goes in in pieces: let go inside it
      s.touchAll();
      h.p.receive(s.msg()); h.p.kick();
      h.run(() => h.p.phase === at);
      const st = h.p.tablesOf(1)!.work!.stores[0]!, rev0 = st.revision;
      h.queue.shift()!();
      expect(st.revision > rev0, `phase ${at}: the update under way`).toBe(true);
      const atRelease = st.revision;
      owners.clear(); h.p.release();
      for (let k = 0; k < 1000 && h.queue.length; k++) h.queue.shift()!();
      expect(st.revision - atRelease, `phase ${at}: at most one step more written`).toBeLessThanOrEqual(4096);
      expect(st.revision - rev0, `phase ${at}: never written to its end`).toBeLessThan(3000 * 8);
      expect(h.acks.length, `phase ${at}: nothing more acknowledged`).toBe(acks);
    }
  });

  it("VP-I116: a fallback during the build stops it at the next step too; its drain is taken by the next pass", () => {
    const h = harness(), s = new Sender(1, 0);
    for (let i = 0; i < 3000; i++) s.contact(i % 64, 3 * i);
    h.p.receive(s.msg()); h.p.kick();
    h.run(() => h.p.phase === 2);
    let after = 0;
    h.p.receive({ id: 1, heldCoverage: { generation: 0, covered: [1] } });
    const at = h.p.discards;
    while (h.queue.length && h.p.discards === at) { h.queue.shift()!(); after++; }
    expect(after, "slices until the build stopped").toBeLessThanOrEqual(2);
    h.p.kick(); h.run();
    expect(h.p.tablesOf(1)!.fallen, "the fallback taken").toBe(true);
  });
});
