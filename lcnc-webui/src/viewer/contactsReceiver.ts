// Step 4 package 2, round B2: the owner's side of the contact transport (plan
// Fassung 5, 3.1/3.4/3.5; Codex R144–R146). The collision worker sends each
// request's tables as deltas — `{id, contacts: StoreDelta[], contactPairs?}`,
// one delta per shard, at most one unacknowledged per request — and this
// receiver applies them, says what to acknowledge (`{contactsAck, generation}`,
// the delta's own generation), and keeps per request the CURRENT generation
// and the one before it (HELD: a pool that fell back to this core runs again
// as the next generation; the views unite both, plan 3.5). An older
// generation's delta after a switch is dropped (the worker's drain delivers an
// older generation whole before the newer one speaks, so it does not happen;
// dropping it is the plan's rule). Pure apart from its own state.
import { ContactStore, REQUEST_BUDGET, type StoreDelta } from "./contactStore";

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

interface RequestTables { current: GenerationTables | null; held: GenerationTables | null }

export interface ContactsMessage {
  id: number; contacts?: StoreDelta[]; contactPairs?: Array<[string, string]>;
  /** A pool fell back: how far each shard of `generation` swept. */
  heldCoverage?: { generation: number; covered: number[] };
}

export class ContactsReceiver {
  private reqs = new Map<number, RequestTables>();
  /** Deltas dropped: an older generation's after a switch, or refused by a
   *  table (out of order, another request) — counted, logged, never patched in. */
  dropped = 0;

  /** Applies a message's deltas; returns the acknowledgement to send (null:
   *  the message carried none). */
  apply(m: ContactsMessage): { contactsAck: number; generation: number } | null {
    if (m.heldCoverage) {
      // it goes with its generation's tables, kept with them at the switch
      const r = this.reqs.get(m.id), g = m.heldCoverage.generation;
      for (const t of [r?.current, r?.held]) if (t && t.generation === g) t.covered = m.heldCoverage.covered.slice();
    }
    const deltas = m.contacts;
    if (!deltas?.length) return null;
    const g = deltas[0]!.generation;
    let r = this.reqs.get(m.id);
    if (!r) this.reqs.set(m.id, r = { current: null, held: null });
    if (r.current && g < r.current.generation) {
      this.dropped += deltas.length;
      console.warn(`[contacts] request ${m.id}: a generation-${g} delta after generation ${r.current.generation} — dropped`);
      return { contactsAck: m.id, generation: g };
    }
    if (!r.current || g > r.current.generation) {
      if (r.current) r.held = r.current;
      r.current = { generation: g, stores: deltas.map(() => new ContactStore(m.id, g, REQUEST_BUDGET)), pairs: null, deltas: 0 };
    }
    const cur = r.current;
    if (m.contactPairs) cur.pairs = m.contactPairs;
    deltas.forEach((d, k) => {
      while (cur.stores.length <= k) cur.stores.push(new ContactStore(m.id, g, REQUEST_BUDGET));
      let ok = false;
      try { ok = cur.stores[k]!.apply(d); } catch (e) { console.error(`[contacts] request ${m.id}: ${String(e)}`); }
      if (!ok) this.dropped++;
    });
    cur.deltas++;
    return { contactsAck: m.id, generation: g };
  }

  current(id: number): GenerationTables | null { return this.reqs.get(id)?.current ?? null; }
  /** Puts tables in as a request's current generation — the diagnostic seam
   *  that lays made-up findings over a result (`__viewerDiag.setCollisionHits`). */
  inject(id: number, stores: ContactStore[], pairs: Array<[string, string]>): void {
    this.reqs.set(id, { current: { generation: stores[0]?.generation ?? 0, stores, pairs, deltas: 0 }, held: null });
  }
  /** The requests whose tables are held. */
  ids(): number[] { return [...this.reqs.keys()]; }
  held(id: number): GenerationTables | null { return this.reqs.get(id)?.held ?? null; }

  /** Lets go of every request but `keep` (a superseded request's tables are
   *  no one's). */
  keepOnly(keep: ReadonlySet<number>): void {
    for (const id of [...this.reqs.keys()]) if (!keep.has(id)) this.reqs.delete(id);
  }

  /** The tables' memory as held here (allocated blocks with their marks, and
   *  the rows in use) — the owner's share of the budget (plan 3.4, 7.4). */
  stats(): { requests: number; rows: { episodes: number; intervals: number; gaps: number }; allocated: number; used: number } {
    const rows = { episodes: 0, intervals: 0, gaps: 0 };
    let allocated = 0, used = 0;
    for (const r of this.reqs.values()) for (const t of [r.current, r.held]) for (const st of t?.stores ?? []) {
      rows.episodes += st.episodes.rows; rows.intervals += st.intervals.rows; rows.gaps += st.gaps.rows;
      allocated += st.allocatedBytes(); used += st.usedBytes();
    }
    return { requests: this.reqs.size, rows, allocated, used };
  }
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
