import { describe, expect, it } from "vitest";
import { ContactStore, NONE } from "./contactStore";
import { ContactsReceiver, contactOwners } from "./contactsReceiver";

const ep = (s: ContactStore, pair: number) => s.episodes.append({ pair, ordinal: 0, onset: pair, end: NaN, closeAt: pair, closeDist: 1, firstIv: NONE });

describe("the owner's contact receiver (round B2, plan 3.1/3.5)", () => {
  it("applies a request's deltas per shard and says what to acknowledge — the delta's generation", () => {
    const r = new ContactsReceiver();
    const a = new ContactStore(7, 0), b = new ContactStore(7, 0);
    ep(a, 1); ep(b, 2);
    expect(r.apply({ id: 7, contacts: [a.takeDelta()!, b.takeDelta()!], contactPairs: [["t", "w"], ["t", "x"], ["t", "y"]] }))
      .toEqual({ contactsAck: 7, generation: 0 });
    a.ack(); b.ack();
    a.episodes.set(0, "end", 3);
    expect(r.apply({ id: 7, contacts: [a.takeDelta(true)!, b.takeDelta(true)!] })).toEqual({ contactsAck: 7, generation: 0 });
    const cur = r.current(7)!;
    expect([cur.generation, cur.stores.length, cur.stores[0]!.episodes.get(0, "end"), cur.stores[1]!.episodes.rows, cur.pairs?.length, cur.deltas])
      .toEqual([0, 2, 3, 1, 3, 2]);
    expect(r.apply({ id: 7 }), "a message without deltas").toBeNull();
  });

  it("a newer generation becomes the current one and the one before is HELD; an older one after the switch is dropped (and acknowledged)", () => {
    const r = new ContactsReceiver();
    const g0 = new ContactStore(9, 0), g1 = new ContactStore(9, 1);
    ep(g0, 1); ep(g1, 1); ep(g1, 2);
    r.apply({ id: 9, contacts: [g0.takeDelta()!] }); g0.ack();
    r.apply({ id: 9, contacts: [g1.takeDelta()!] });
    expect([r.current(9)!.generation, r.held(9)!.generation, r.current(9)!.stores[0]!.episodes.rows]).toEqual([1, 0, 2]);
    ep(g0, 3);
    expect(r.apply({ id: 9, contacts: [g0.takeDelta()!] }), "acknowledged so its path never stalls").toEqual({ contactsAck: 9, generation: 0 });
    expect([r.dropped, r.held(9)!.stores[0]!.episodes.rows], "dropped, never patched into the held generation").toEqual([1, 1]);
  });

  it("a delta out of order is refused by its table, counted, never patched in; requests are let go", () => {
    const r = new ContactsReceiver();
    const s = new ContactStore(3, 0);
    ep(s, 1); s.takeDelta(); s.ack();   // the first delta never reaches the receiver
    ep(s, 2);
    r.apply({ id: 3, contacts: [s.takeDelta()!] });
    expect([r.dropped, r.current(3)!.stores[0]!.episodes.rows]).toEqual([1, 0]);
    r.keepOnly(new Set([4]));
    expect(r.current(3)).toBeNull();
  });

  it("counts the tables' memory it holds: current and held, allocated blocks and rows in use", () => {
    const r = new ContactsReceiver();
    const a = new ContactStore(5, 0), b = new ContactStore(5, 1);
    ep(a, 1); ep(b, 1); ep(b, 2);
    r.apply({ id: 5, contacts: [a.takeDelta()!] });
    r.apply({ id: 5, contacts: [b.takeDelta()!] });
    const st = r.stats();
    expect([st.requests, st.rows.episodes]).toEqual([1, 3]);
    expect(st.used).toBe(3 * 46);
    expect(st.allocated).toBeGreaterThanOrEqual(st.used);
  });
});

// Codex R147 VP-I106: a side run's result stays shown after its run ended —
// its tables must outlive the run until the result is replaced or dropped.
describe("whose tables stay (Codex R147 VP-I106)", () => {
  const owners = (o: Partial<Parameters<typeof contactOwners>[0]> & { main: number }) =>
    contactOwners({ side: null, result: null, entry: null, runSide: null, sideFirst: null, ...o });
  const side = (r: ContactsReceiver, id: number) => { const s = new ContactStore(id, 0); ep(s, 1); r.apply({ id, contacts: [s.takeDelta()!] }); };
  const mainDelta = (r: ContactsReceiver, s: ContactStore, keep: Set<number>) => { r.keepOnly(keep); ep(s, s.episodes.rows + 2); r.apply({ id: 7, contacts: [s.takeDelta(true)!] }); s.ack(); };

  it("the side run ends first, the main request sends on: the shown entry result's tables stay; a replacing side lets them go", () => {
    for (const shown of ["entry", "runSide"] as const) {
      const r = new ContactsReceiver(), main = new ContactStore(7, 0);
      mainDelta(r, main, owners({ main: 7 }));
      side(r, -1);                                   // the side's result, with its tables; the run is over
      mainDelta(r, main, owners({ main: 7, [shown]: -1 }));
      expect(r.current(-1), `${shown}: kept while shown`).not.toBeNull();
      // the next side run replaces it: once its result is the shown one, -1 is no one's
      side(r, -2);
      mainDelta(r, main, owners({ main: 7, [shown]: -2 }));
      expect([r.current(-1), r.current(-2) !== null], `${shown}: replaced`).toEqual([null, true]);
    }
  });

  it("the main request ends first: the side's tables, the result's and a cancelled request's shown result stay", () => {
    const r = new ContactsReceiver(), main = new ContactStore(7, 0);
    mainDelta(r, main, owners({ main: 7 }));
    side(r, -1);
    // a cancel moved the request id on (8) while request 7's result is shown
    r.keepOnly(owners({ main: 8, result: 7, entry: -1 }));
    expect([r.current(7) !== null, r.current(-1) !== null]).toEqual([true, true]);
    r.keepOnly(owners({ main: 8 }));
    expect(r.ids(), "nothing shown: only the request in flight").toEqual([]);
  });

  it("every field counts", () => {
    expect([...contactOwners({ main: 1, side: -1, result: 2, entry: -2, runSide: -3, sideFirst: -4 })].sort((a, b) => a - b))
      .toEqual([-4, -3, -2, -1, 1, 2]);
  });
});
