// Plan 3.6 after Codex R158 (VP-I118): the memory of a view in the making.
// What a build allocates is counted from its first step — the view it is
// making and every build buffer — until the view is published or discarded,
// apart from the published views and the built ones waiting; no typed array
// of a build escapes the count, and no JS array grows with the rows.
import { describe, expect, it } from "vitest";
import {
  ContactStore, GAP_TOOL_UNKNOWN, GAP_UNDECIDABLE, IV_ENDED_AT_FEED, IV_ENTER_DECIDED, IV_EXIT_DECIDED, NONE, REQUEST_BUDGET, shareOf, type StoreBudget,
} from "./contactStore";
import { unionScratch } from "./contactUnion";
import { ContactPublisher } from "./contactPublisher";
import { shownContactViewSteps, type ShownContacts, type ShownSpec } from "./shownContacts";
import {
  buildContactViewSteps, contactBandsSteps, heldBytes, retireView, startTargetsSteps, viewCountsSteps, type ContactView, type ContactViewInput,
} from "./contactView";
import { clashIndexOfView, clashTicksSteps } from "./simWindow";
import { STEP_OPS, withMeter, type Steps } from "./steps";

const D = IV_ENTER_DECIDED | IV_EXIT_DECIDED;
const names = (p: number) => ({ a: `t${p}`, b: `w${p}` });

/** A generation at budget `b` (contactViewBudget's shape, smaller): the
 *  intervals on pair 0, the later generation shifted so each free sample cuts
 *  the other's contact; near misses on 64 pairs; gaps as asked. */
function table(req: number, generation: number, b: StoreBudget, o: { nears?: boolean; gaps?: "one pair" | "a pair each"; reason?: number }): ContactStore {
  const st = new ContactStore(req, generation, b);
  const later = generation === 1;
  let ep = -1, last = -1, used = 0;
  for (let i = 0; i < b.intervals; i++) {
    if (i % 4 === 0) {
      const at = 3 * i + (later ? 1.5 : 0);
      ep = st.episodes.append({ pair: 0, ordinal: used++, flags: 0, onset: at, end: at + 12, closeAt: at, closeDist: 0, firstIv: NONE, ivCount: 4 });
      last = -1;
    }
    const enter = 3 * i + (later ? 1.5 : 0);
    const iv = st.intervals.append({ episode: ep, enter, exit: enter + 1, flags: D, next: NONE, witness: later ? enter + 0.1 : enter + 0.5,
                                     freeAt: later ? 3 * i + 3.2 : 3 * i + 2, freeR: 0.1 });
    if (last < 0) st.episodes.set(ep, "firstIv", iv); else st.intervals.set(last, "next", iv);
    last = iv;
  }
  if (o.nears) {
    for (let e = used; e < b.episodes; e++) {
      const at = 3 * b.intervals + 10 + 4 * e;
      st.episodes.append({ pair: 1 + (e % 64), ordinal: e, flags: 0, onset: at, end: at + 1, closeAt: at + 0.5, closeDist: 1, firstIv: NONE, ivCount: 0 });
    }
  }
  if (o.gaps) {
    for (let g = 0; g < b.gaps; g++) {
      const at = 3 * b.intervals + 10 + 4 * b.episodes + 3 * g;
      st.gaps.append({ pair: o.gaps === "one pair" ? 1 : 1 + g, start: at, end: at + 1, reason: o.reason ?? GAP_TOOL_UNKNOWN });
    }
  }
  return st;
}
const endOf = (b: StoreBudget) => 3 * b.intervals + 10 + 4 * b.episodes + 3 * b.gaps + 10;

/** The build ThreeViewer runs (its callback's order): the view, then what the bar reads of it. */
function* fullBuild(input: ContactViewInput, cols: number, axisEnd: number): Steps<ContactView> {
  const view = yield* buildContactViewSteps(input);
  yield* viewCountsSteps(view);
  yield* startTargetsSteps(view);
  yield* clashTicksSteps(clashIndexOfView(view, () => 1), cols, axisEnd);
  yield* contactBandsSteps(view, cols, axisEnd);
  return view;
}

/** Every typed array CONSTRUCTED while `fn` runs (fatPaths.test's spy: a view
 *  on an existing buffer is no allocation), and the longest any JS array grew
 *  by a push — both independent of the meter they check. */
function spy<T>(fn: () => T): { out: T; bytes: number; longest: number } {
  const g = globalThis as unknown as Record<string, unknown>;
  const typed = ["Float32Array", "Float64Array", "Uint32Array", "Uint16Array", "Uint8Array", "Int32Array", "Int16Array", "Int8Array"];
  const saved = typed.map(n => g[n]);
  const proto = Object.getPrototypeOf(Uint8Array).prototype as Record<string, (...a: unknown[]) => unknown>;
  const savedProto = { slice: proto.slice!, map: proto.map!, filter: proto.filter! };
  const push = Array.prototype.push;
  let bytes = 0, longest = 0;
  const note = (a: ArrayBufferView) => { bytes += a.buffer.byteLength; };
  typed.forEach((n, i) => {
    const C = saved[i] as new (...a: unknown[]) => ArrayBufferView;
    g[n] = new Proxy(C, {
      construct(t, args) { const a = Reflect.construct(t, args) as ArrayBufferView; if (!(args[0] instanceof ArrayBuffer)) note(a); return a; },
      get(t, key, r) {
        const v = Reflect.get(t, key, r);
        if (key !== "from" && key !== "of") return v;
        return (...a: unknown[]) => { const x = (v as (...b: unknown[]) => ArrayBufferView).apply(t, a); note(x); return x; };
      },
    });
  });
  for (const k of ["slice", "map", "filter"] as const) {
    const f = savedProto[k];
    proto[k] = function (this: unknown, ...a: unknown[]) { const x = f.apply(this, a) as ArrayBufferView; note(x); return x; };
  }
  Array.prototype.push = function (this: unknown[], ...a: unknown[]) { const n = push.apply(this, a); if (n > longest) longest = n; return n; };
  try {
    return { out: fn(), bytes, longest };
  } finally {
    typed.forEach((n, i) => { g[n] = saved[i]; });
    Object.assign(proto, savedProto);
    Array.prototype.push = push;
  }
}

describe("a build's memory is counted where it is made (plan 3.6, Codex R158 VP-I118)", () => {
  const B = shareOf(REQUEST_BUDGET, 16), S = shareOf(REQUEST_BUDGET, 128);
  const shapes: Array<[string, { nears?: boolean; gaps?: "one pair" | "a pair each"; reason?: number }]> = [
    ["two generations, every free sample cutting", {}],
    ["undecidable gaps on one pair", { gaps: "one pair", reason: GAP_UNDECIDABLE }],
    ["tool gaps on one pair", { gaps: "one pair", reason: GAP_TOOL_UNKNOWN }],
    ["tool gaps on a pair each, near misses matched", { gaps: "a pair each", nears: true }],
  ];
  it.each(shapes)("%s: the meter holds every typed array the build made, and no JS array grows with the rows", { timeout: 120_000 }, (_, o) => {
    const end = endOf(B), cols = 1200;
    const input: ContactViewInput = { sources: [
      { stores: [table(1, 1, B, o)], held: [table(1, 0, B, o)], heldCoverage: [end], at: x => x, ownCoverage: end },
      { stores: [table(-1, 1, S, o)], held: [table(-1, 0, S, o)], heldCoverage: [end], at: x => x, entry: true, ownCoverage: end },
    ], pairName: names, coverage: end };
    const m = { bytes: 0 };
    const job = fullBuild(input, cols, end);
    // each step metered, as the publisher drives it
    const { out: view, bytes, longest } = spy(() => { for (;;) { const r = withMeter(m, () => job.next()); if (r.done) return r.value; } });
    expect(m.bytes, "every typed array the build made is counted").toBe(bytes);
    expect(m.bytes, "the view itself among them").toBeGreaterThanOrEqual(heldBytes(view));
    // rows: tens of thousands; what may push stays with the columns and the pairs
    const rows = B.intervals + S.intervals;
    expect(rows).toBeGreaterThan(16_000);
    expect(longest, "a JS array grows with the columns or the pairs only").toBeLessThanOrEqual(2 * cols);
  });

  it("one open contact over its pair's every gap (Codex R158 VP-I115): no buffer grows with the gaps", () => {
    const n = REQUEST_BUDGET.gaps, end = 4 * n + 1, cols = 1200;
    const mk = (g: number) => {
      const st = new ContactStore(1, g, REQUEST_BUDGET);
      const ep = st.episodes.append({ pair: 0, ordinal: 0, onset: 0, end: NaN, closeAt: 0, closeDist: 0, firstIv: NONE, ivCount: 1 });
      st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: 0, exit: NaN, flags: IV_ENTER_DECIDED, next: NONE, witness: 0, freeAt: NaN, freeR: 0 }));
      for (let i = 0; i < n; i++) st.gaps.append({ pair: 0, start: 4 * i + 1, end: 4 * i + 2, reason: GAP_UNDECIDABLE });
      return st;
    };
    for (const union of [false, true]) {
      const input: ContactViewInput = { sources: [{ stores: [mk(1)], ...(union ? { held: [mk(0)], heldCoverage: [end] } : {}), at: x => x, ownCoverage: end }],
                                        pairName: names, coverage: end };
      const m = { bytes: 0 }, job = fullBuild(input, cols, end);
      const { bytes, longest } = spy(() => { for (;;) { const r = withMeter(m, () => job.next()); if (r.done) return r.value; } });
      expect(m.bytes).toBe(bytes);
      expect(longest, "the pieces between the gaps are lit as found, never listed").toBeLessThanOrEqual(2 * cols);
    }
  });

  it("no native copy longer than the steps' share between two steps — the lists grow by blocks (Codex R159 VP-I115 rest C)", { timeout: 120_000 }, () => {
    // Codex R159's probe: 32 769 targets cross a power of two in every growing list; and the unions above
    const many = (n: number): ContactViewInput => {
      const st = new ContactStore(1, 0);
      for (let i = 0; i < n; i++) {
        const ep = st.episodes.append({ pair: i, ordinal: 0, flags: 0, onset: 4 * i, end: 4 * i + 1, closeAt: 4 * i, closeDist: 0, firstIv: NONE, ivCount: 1 });
        st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: 4 * i, exit: 4 * i + 1, flags: D, next: NONE, witness: 4 * i + 0.5, freeAt: 4 * i + 2, freeR: 0.1 }));
      }
      return { sources: [{ stores: [st], ownCoverage: 4 * n, at: x => x }], pairName: names, coverage: 4 * n };
    };
    const end = endOf(B);
    const union: ContactViewInput = { sources: [{ stores: [table(1, 1, B, { nears: true })], held: [table(1, 0, B, { nears: true })], heldCoverage: [end], at: x => x, ownCoverage: end }],
                                      pairName: names, coverage: end };
    const proto = Object.getPrototypeOf(Uint8Array).prototype as { set: (a: ArrayLike<number>, ...r: unknown[]) => void };
    const set = proto.set;
    for (const [input, cov] of [[many(32_769), 4 * 32_769], [union, end]] as const) {
      let copied = 0, most = 0;
      proto.set = function (a: ArrayLike<number>, ...r: unknown[]) { copied += a.length; return set.call(this, a, ...r); };
      try {
        const job = fullBuild(input, 1200, cov);
        for (;;) { copied = 0; const r = job.next(); most = Math.max(most, copied); if (r.done) break; }
      } finally { proto.set = set; }
      expect(most, "elements copied natively in one step").toBeLessThanOrEqual(4 * STEP_OPS);
    }
  });

  it("Codex R158's probe: the view in the making counts while its derived data are built — beside the published one", () => {
    const queue: Array<() => void> = [], track = {}, n = 8192, end = n * 4;
    const st = new ContactStore(1, 0);
    for (let i = 0; i < n; i++) {
      const at = 4 * i, ep = st.episodes.append({ pair: i, ordinal: 0, flags: 0, onset: at, end: at + 1, closeAt: at, closeDist: 0, firstIv: NONE, ivCount: 1 });
      st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: at, exit: at + 1, flags: D, next: NONE, witness: at + 0.5, freeAt: at + 2, freeR: 0.1 }));
    }
    const seen: { view: ContactView | null } = { view: null };
    const spec: ShownSpec = { base: { id: 1, map: null, coverage: end, ownEnd: end }, side: null, axisEnd: end };
    const p = new ContactPublisher<object, ShownContacts, object>({
      tracks: () => [track], specOf: () => ({ key: "one", ids: [1], spec }),
      *build(_t, s, tables, held) {
        // ThreeViewer's callback order; `seen` only notes the view
        const view = yield* shownContactViewSteps(tables, s as ShownSpec, undefined, held);
        if (!view) return null;
        seen.view = view;
        const lineAt = () => 1, cols = 1200;
        const counts = yield* viewCountsSteps(view), starts = yield* startTargetsSteps(view);
        const ticks = yield* clashTicksSteps(clashIndexOfView(view, lineAt), cols, end), bands = yield* contactBandsSteps(view, cols, end);
        return { view, lineAt, derived: { counts, starts, ticks, bands, cols, axisEnd: end } };
      },
      viewBytes: sv => heldBytes(sv.view), retire: sv => retireView(sv.view),
      effect: () => {}, stage: () => ({}), publish: () => {}, ack: () => {}, owners: () => new Set([1]),
      schedule: f => queue.push(f), sliceMs: 0, now: () => 0,
    });
    p.receive({ id: 1, contacts: [st.takeDelta(true)!], contactPairs: Array.from({ length: n }, (_, i) => [`t${i}`, `w${i}`] as [string, string]) });
    p.kick();
    for (let k = 0; k < 100_000 && queue.length; k++) queue.shift()!();
    const old = p.viewOf(track)!.view;
    expect(p.stats().views).toEqual({ published: heldBytes(old), waiting: 0, inProgress: 0, building: 0 });
    seen.view = null;
    p.receive({ id: 1 });
    p.kick();
    // stops by itself in phase 2, after the view is made, inside its derived data
    for (let k = 0; k < 100_000 && queue.length && seen.view === null; k++) queue.shift()!();
    expect(seen.view).not.toBeNull();
    expect(p.phase).toBe(2);
    expect(p.viewOf(track)!.view).toBe(old);
    const v = p.stats().views, made = heldBytes(seen.view!);
    expect(v.published, "the published view apart").toBe(heldBytes(old));
    expect(v.waiting, "nothing built and waiting yet").toBe(0);
    expect(v.inProgress, "the view in the making, from its allocation on").toBeGreaterThanOrEqual(made);
    expect(v.building).toBe(v.waiting + v.inProgress);
    // to its publication: then it is the published one, nothing in the making
    // — in the catch-up after it too
    for (let k = 0; k < 100_000 && queue.length && p.phase !== 4; k++) queue.shift()!();
    expect(p.phase).toBe(4);
    expect(p.stats().views).toEqual({ published: made, waiting: 0, inProgress: 0, building: 0 });
    for (let k = 0; k < 100_000 && queue.length; k++) queue.shift()!();
    expect(p.viewOf(track)!.view).toBe(seen.view);
    expect(p.stats().views).toEqual({ published: made, waiting: 0, inProgress: 0, building: 0 });
  });

  it("a build that ends without a publication (a discarded one) leaves nothing counted", () => {
    const queue: Array<() => void> = [], track = {};
    const st = new ContactStore(1, 0);
    for (let i = 0; i < 4096; i++) {
      const ep = st.episodes.append({ pair: i, ordinal: 0, flags: 0, onset: 4 * i, end: 4 * i + 1, closeAt: 4 * i, closeDist: 0, firstIv: NONE, ivCount: 1 });
      st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: 4 * i, exit: 4 * i + 1, flags: D, next: NONE, witness: 4 * i + 0.5, freeAt: 4 * i + 2, freeR: 0.1 }));
    }
    let owners = new Set([1]);
    const p = new ContactPublisher<object, ContactView, object>({
      tracks: () => [track], specOf: () => ({ key: "one", ids: [1], spec: null }),
      *build(_t, _s, tables) {
        const t = tables(1);
        return t ? yield* buildContactViewSteps({ sources: [{ stores: t.stores, at: x => x, ownCoverage: 1e9 }], pairName: names, coverage: 1e9 }) : null;
      },
      viewBytes: v => heldBytes(v), retire: v => retireView(v),
      effect: () => {}, stage: () => ({}), publish: () => {}, ack: () => {}, owners: () => owners,
      schedule: f => queue.push(f), sliceMs: 0, now: () => 0,
    });
    p.receive({ id: 1, contacts: [st.takeDelta(true)!], contactPairs: [["t", "w"]] });
    p.kick();
    // into the build, then the request is let go
    while (queue.length && !(p.phase === 2 && p.stats().views.inProgress > 0)) queue.shift()!();
    expect(p.stats().views.inProgress).toBeGreaterThan(0);
    owners = new Set();
    p.release();
    for (let k = 0; k < 100_000 && queue.length; k++) queue.shift()!();
    expect(p.running).toBe(false);
    expect(p.stats().views).toEqual({ published: 0, waiting: 0, inProgress: 0, building: 0 });
  });
});

describe("the build's walk counts every sample it looks at (Codex R160 VP-I115 rest E)", () => {
  // Codex R160's probes: the reads of the walk's reusable scratch (six of its
  // columns) between two steps of the build — the view, then its bands on the
  // same scratch, as ThreeViewer runs them — never more than 4 × STEP_OPS,
  // whatever the samples are (a dropped one was not counted, and the search
  // for the other side's interval before a sample walked inside one step)
  const one = (st: ContactStore, a: number, b: number, w: number, flags: number, freeAt: number, freeR: number) => {
    const ep = st.episodes.append({ pair: 0, ordinal: st.episodes.rows, flags: 0, onset: a, end: b, closeAt: a, closeDist: 0, firstIv: NONE, ivCount: 1 });
    st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: a, exit: b, flags, next: NONE, witness: w, freeAt, freeR }));
  };
  const union = (held: ContactStore, cur: ContactStore, cov: number): ContactViewInput =>
    ({ sources: [{ stores: [cur], held: [held], heldCoverage: [cov], ownCoverage: cov, at: x => x }], pairName: names, coverage: cov });
  const shapes: Array<[string, number[], (n: number) => ContactViewInput]> = [
    // each run's free point sample on the other run's witness: every one refuted
    ["free point samples, each refuted by the other run's witness", [1024, 8192], n => {
      const h = new ContactStore(1, 0, REQUEST_BUDGET), c = new ContactStore(1, 1, REQUEST_BUDGET);
      for (let k = 0; k < n; k++) { one(h, 4 * k, 4 * k + 2.5, 4 * k + 1, D, 4 * k + 3, 0); one(c, 4 * k + 2, 4 * k + 4.5, 4 * k + 3, D, 4 * k + 5, 0); }
      return union(h, c, 4 * n + 4);
    }],
    // an empty rerun beside contacts that ended at the feed: no free sample at all
    ["no free samples: the earlier run's contacts end at the feed, the rerun is empty", [1024, 32768], n => {
      const h = new ContactStore(1, 0, REQUEST_BUDGET);
      for (let k = 0; k < n; k++) one(h, 4 * k, 4 * k + 2.5, 4 * k + 1, IV_ENTER_DECIDED | IV_ENDED_AT_FEED, NaN, 0);
      return union(h, new ContactStore(1, 1, REQUEST_BUDGET), 4 * n + 4);
    }],
    // one coarse earlier contact, its free sample after n finer current ones
    ["one late free sample after a coarse earlier contact, over n finer current ones", [1024, 32768], n => {
      const h = new ContactStore(1, 0, REQUEST_BUDGET), c = new ContactStore(1, 1, REQUEST_BUDGET);
      one(h, 0, 4 * n, 0.5, D, 4 * n + 1, 0.25);
      for (let k = 0; k < n; k++) one(c, 4 * k, 4 * k + 1, 4 * k + 0.5, IV_ENTER_DECIDED | IV_ENDED_AT_FEED, NaN, 0);
      return union(h, c, 4 * n + 2);
    }],
  ];
  it.each(shapes)("%s", { timeout: 120_000 }, (_, sizes, make) => {
    for (const n of sizes) {
      const input = make(n), cov = input.coverage, scratch = unionScratch();
      const build = function* (): Steps<void> {
        const v = yield* buildContactViewSteps(input, scratch);
        yield* contactBandsSteps(v, 1200, cov, { n: 0 }, scratch);
      };
      // its capacities first, then the reads of the scratch it reuses
      for (const job = build(); !job.next().done;);
      let reads = 0, most = 0;
      for (const side of scratch.sides) {
        for (const key of ["enter", "end", "witness", "freeAt", "freeR", "flags"] as const) {
          side[key] = new Proxy(side[key], { get(t, k) { if (typeof k === "string" && /^\d+$/.test(k)) reads++; return Reflect.get(t, k, t); } }) as never;
        }
      }
      for (const job = build(); ;) { reads = 0; const r = job.next(); most = Math.max(most, reads); if (r.done) break; }
      expect(most, `scratch reads between two steps at ${n}`).toBeLessThanOrEqual(4 * STEP_OPS);
    }
  });
});
