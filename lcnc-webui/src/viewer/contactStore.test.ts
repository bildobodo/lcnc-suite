import { describe, expect, it } from "vitest";
import {
  BLOCK, ColumnTable, ContactStore, EPISODE, GAP, INTERVAL, NONE, REQUEST_BUDGET, deltaTransfer, f32Inward, rowBytes, shareOf,
  type TableDelta,
} from "./contactStore";

describe("the contact store's tables (step 4 package 2, plan 1.4)", () => {
  it("rows are the plan's sizes: episode 46, interval 45, gap 21 bytes", () => {
    expect([rowBytes(EPISODE), rowBytes(INTERVAL), rowBytes(GAP)]).toEqual([46, 45, 21]);
  });

  it("appends across blocks without copying, reads back, refuses past its budget", () => {
    const t = new ColumnTable(GAP, BLOCK + 3);
    for (let i = 0; i < BLOCK + 3; i++) expect(t.append({ pair: i, start: i * 0.5, end: i * 0.5 + 0.25, reason: 1 })).toBe(i);
    expect(t.append({ pair: 0 }), "the budget spent").toBe(-1);
    expect([t.get(BLOCK + 2, "pair"), t.get(BLOCK + 2, "start"), t.get(5, "end")]).toEqual([BLOCK + 2, (BLOCK + 2) * 0.5, 2.75]);
    // allocated: two whole blocks with their marks, used: the rows
    expect(t.allocatedBytes()).toBe(2 * BLOCK * (21 + 1));
    expect(t.usedBytes()).toBe((BLOCK + 3) * 21);
  });

  it("a missing column is 0, a link column says NONE explicitly", () => {
    const t = new ColumnTable(INTERVAL, 4);
    const r = t.append({ episode: 2, enter: 1, exit: NaN, next: NONE });
    expect([t.get(r, "flags"), t.get(r, "next"), Number.isNaN(t.get(r, "exit"))]).toEqual([0, NONE, true]);
  });
});

describe("deltas: appended rows, coalesced updates, one unacknowledged (plan 3.1, Codex VP139-03)", () => {
  const ep = (s: ContactStore, pair: number, onset: number) =>
    s.episodes.append({ pair, ordinal: 0, onset, end: NaN, closeAt: onset, closeDist: 1.5, firstIv: NONE });

  it("a delta carries the new rows; a changed sent row goes once with its LATEST state", () => {
    const s = new ContactStore(7, 0);
    const a = ep(s, 3, 10);
    const d1 = s.takeDelta()!;
    expect([d1.episodes.from, d1.episodes.count, d1.episodes.updates.length]).toEqual([0, 1, 0]);
    s.ack();
    // the open episode's closest approach improves a thousand times
    for (let k = 0; k < 1000; k++) s.episodes.set(a, "closeDist", 1.5 - k * 1e-3);
    const b = ep(s, 4, 20);
    const d2 = s.takeDelta()!;
    expect([d2.episodes.from, d2.episodes.count], "the new row").toEqual([1, 1]);
    expect(Array.from(d2.episodes.updates), "the changed row, once").toEqual([a]);
    expect(d2.episodes.updated["closeDist"]![0]).toBeCloseTo(1.5 - 999e-3, 5);
    expect(b).toBe(1);
  });

  it("a stalled receiver: no second delta until the first is acknowledged — the changes wait as marks", () => {
    const s = new ContactStore(1, 0);
    const a = ep(s, 0, 0);
    expect(s.takeDelta()).not.toBeNull();
    for (let k = 0; k < 5000; k++) s.episodes.set(a, "end", k);   // the same open episode, again and again
    for (let k = 0; k < 10; k++) ep(s, k + 1, k);
    expect(s.takeDelta(), "one in flight").toBeNull();
    expect(s.pending(), "one dirty mark + ten new rows, not 5000 updates").toBe(11);
    s.ack();
    const d = s.takeDelta()!;
    expect([d.episodes.count, d.episodes.updates.length]).toEqual([10, 1]);
    expect(d.episodes.updated["end"]![0]).toBe(4999);
  });

  it("a receiver built from the deltas equals the sender; another request or generation is refused", () => {
    const s = new ContactStore(9, 2), r = new ContactStore(9, 2);
    for (let k = 0; k < 3; k++) ep(s, k, k);
    const iv = s.intervals.append({ episode: 1, enter: 1.2, exit: NaN, next: NONE, witness: 1.3, freeAt: NaN });
    s.gaps.append({ pair: 1, start: 2, end: NaN, reason: 1 });
    expect(r.apply(s.takeDelta()!)).toBe(true);
    s.ack();
    s.intervals.set(iv, "exit", 1.9);
    s.intervals.set(iv, "freeAt", 1.95);
    s.intervals.set(iv, "freeR", f32Inward(0.01));
    expect(r.apply(s.takeDelta()!)).toBe(true);
    for (const [t, rt] of [[s.episodes, r.episodes], [s.intervals, r.intervals], [s.gaps, r.gaps]] as const) {
      expect(rt.rows).toBe(t.rows);
      for (let row = 0; row < t.rows; row++) for (const [name] of t.schema) expect(Object.is(rt.get(row, name), t.get(row, name)), `${name} ${row}`).toBe(true);
    }
    s.ack();
    ep(s, 5, 5);
    const d = s.takeDelta()!;
    expect(new ContactStore(9, 3).apply(d), "another generation").toBe(false);
    expect(new ContactStore(8, 2).apply(d), "another request").toBe(false);
  });

  it("a receiver that forwards (the coordinator): received rows are its new rows, updates of forwarded rows its updates — once", () => {
    const shard = new ContactStore(4, 0), coord = new ContactStore(4, 0), viewer = new ContactStore(4, 0);
    const a = ep(shard, 1, 1);
    coord.apply(shard.takeDelta()!); shard.ack();
    viewer.apply(coord.takeDelta()!);          // forwarded, not yet acknowledged
    ep(shard, 2, 2);
    for (let k = 0; k < 50; k++) shard.episodes.set(a, "end", 10 + k);
    coord.apply(shard.takeDelta()!); shard.ack();   // the shard is never held up by the viewer
    expect(coord.takeDelta(), "one in flight to the viewer").toBeNull();
    coord.ack();
    const d = coord.takeDelta()!;
    expect([d.episodes.from, d.episodes.count, Array.from(d.episodes.updates)]).toEqual([1, 1, [a]]);
    viewer.apply(d);
    expect([viewer.episodes.rows, viewer.episodes.get(a, "end")]).toEqual([2, 59]);
  });

  it("a delta goes in by blocks exactly as row by row: the cells, the revision, the forwarded rows and updates (Form 1 groundwork)", () => {
    // the reference: the receiving side as it was, a row appended and a cell set at a time
    const byRows = (t: ColumnTable, d: TableDelta) => {
      if (d.from !== t.rows) throw new Error("out of order");
      for (let i = 0; i < d.count; i++) {
        const v: Record<string, number> = {};
        for (const [name] of t.schema) v[name] = d.rows[name]![i]!;
        if (t.append(v) < 0) throw new Error("over budget");
      }
      for (let i = 0; i < d.updates.length; i++) for (const [name] of t.schema) t.set(d.updates[i]!, name, d.updated[name]![i]!);
    };
    let seed = 1501;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const cells = (t: ColumnTable) => t.schema.map(([name]) => Array.from({ length: t.rows }, (_, r) => t.get(r, name)));
    let rows = 0, updates = 0, crossings = 0;
    for (let c = 0; c < 40; c++) {
      const sender = new ColumnTable(INTERVAL, 3 * BLOCK), fast = new ColumnTable(INTERVAL, 3 * BLOCK), ref = new ColumnTable(INTERVAL, 3 * BLOCK);
      for (let step = 0; step < 12; step++) {
        // the sender writes: new rows (across blocks, at times many), changes to rows already sent
        const add = rnd() < 0.2 ? Math.floor(rnd() * 2 * BLOCK) : Math.floor(rnd() * 300);
        for (let k = 0; k < add && sender.rows < sender.budget; k++) {
          sender.append({ episode: Math.floor(rnd() * 99), enter: rnd() * 1e3, exit: rnd() * 1e3, flags: Math.floor(rnd() * 128),
                          next: rnd() < 0.5 ? NONE : Math.floor(rnd() * 1e4), witness: rnd(), freeAt: rnd(), freeR: rnd() });
        }
        for (let k = Math.floor(rnd() * 40); k > 0 && sender.sent; k--) sender.set(Math.floor(rnd() * sender.sent), "exit", rnd() * 1e3);
        const before = fast.rows;
        const d = sender.take();
        fast.apply(d);
        byRows(ref, d);
        rows += d.count; updates += d.updates.length;
        if (Math.floor(before / BLOCK) !== Math.floor(fast.rows / BLOCK)) crossings++;
        expect([fast.rows, fast.revision, fast.pending()], `case ${c} step ${step}`).toEqual([ref.rows, ref.revision, ref.pending()]);
        expect(cells(fast)).toEqual(cells(ref));
        // as a forwarder (the coordinator): what each sends on is the same
        if (rnd() < 0.5) {
          const a = fast.take(), b = ref.take();
          expect([a.from, a.count, Array.from(a.updates)]).toEqual([b.from, b.count, Array.from(b.updates)]);
          for (const [name] of INTERVAL) expect([Array.from(a.rows[name]!), Array.from(a.updated[name]!)]).toEqual([Array.from(b.rows[name]!), Array.from(b.updated[name]!)]);
        }
      }
    }
    expect([rows > 50_000, updates > 2_000, crossings > 20], "rows, updates, block crossings").toEqual([true, true, true]);
    // past its budget the delta is refused whole — nothing of it is written
    const s = new ColumnTable(GAP, 10), r = new ColumnTable(GAP, 6);
    for (let k = 0; k < 8; k++) s.append({ pair: k, start: k, end: k + 1, reason: 1 });
    expect(() => r.apply(s.take())).toThrow(/over its budget/);
    expect([r.rows, r.revision]).toEqual([0, 0]);
  });

  it("a delta out of order is refused, never patched in", () => {
    const s = new ContactStore(1, 0), r = new ContactStore(1, 0);
    ep(s, 0, 0);
    s.takeDelta(); s.ack();
    ep(s, 1, 1);
    expect(() => r.apply(s.takeDelta()!)).toThrow(/from row 1/);
  });

  it("the transfer list holds every buffer of the delta", () => {
    const s = new ContactStore(1, 0);
    ep(s, 0, 0);
    const d = s.takeDelta()!;
    const bufs = deltaTransfer(d);
    expect(bufs.length).toBe(3 * 1 + EPISODE.length * 2 + INTERVAL.length * 2 + GAP.length * 2);
    expect(new Set(bufs).size, "no buffer twice").toBe(bufs.length);
  });

  it("budgets: the request's and a shard's share", () => {
    expect(REQUEST_BUDGET).toEqual({ episodes: 65536, intervals: 262144, gaps: 16384 });
    expect(shareOf(REQUEST_BUDGET, 4)).toEqual({ episodes: 16384, intervals: 65536, gaps: 4096 });
    // T of plan 1.4: the tables, a dirty byte per row, and per shard and table one block begun (K = 8)
    const t = 65536 * 46 + 262144 * 45 + 16384 * 21 + (65536 + 262144 + 16384) + 8 * BLOCK * (46 + 45 + 21 + 3);
    expect(t).toBe(19267584);
  });
});

describe("a free radius stored as f32 never grows the proven stretch (plan 2.2, Codex R142)", () => {
  it("rounds toward zero", () => {
    for (const r of [0.1, 1 / 3, 2 / 3, 1e-7, 123.456789, 0.30000001]) {
      const f = f32Inward(r);
      expect(f).toBeLessThanOrEqual(r);
      expect(Math.fround(f)).toBe(f);
      expect(r - f).toBeLessThan(Math.abs(r) * 2 ** -22);
    }
    expect([f32Inward(0), f32Inward(-1), f32Inward(NaN)]).toEqual([0, 0, 0]);
  });
});
