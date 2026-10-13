// The collision check's contact store (step 4 package 2, plan
// docs/reviews/kollision-paket2.plan.md Fassung 5, Codex R139–R143): what one
// request found, as typed COLUMN blocks — episodes (a pair's stay inside the
// margin), touch intervals and knowledge gaps — instead of one record object
// per (line, pair). Pure: no Three, no worker; the sweep writes it, the
// coordinator and the viewer receive it as deltas.
//
// Blocks of BLOCK rows are appended, never copied (plan 1.4). A row changed
// after it was sent carries a dirty mark and goes out ONCE with its latest
// state however often it changed (3.1); a sender holds at most one
// unacknowledged delta (VP139-03), so a slow receiver queues nothing — the
// changes wait as marks in the sender's own table.
export const BLOCK = 4096;
export const BLOCK_SHIFT = 12;

export type ColType = "u8" | "u16" | "u32" | "f32" | "f64";
type Typed = Uint8Array | Uint16Array | Uint32Array | Float32Array | Float64Array;
const CTOR: Record<ColType, { new (n: number): Typed; BYTES_PER_ELEMENT: number }> = {
  u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, f32: Float32Array, f64: Float64Array,
};

/** One table's columns, in order — the row layout of plan 1.4. */
export type Schema = ReadonlyArray<readonly [name: string, type: ColType]>;

export const EPISODE: Schema = [
  ["pair", "u32"], ["ordinal", "u32"], ["flags", "u16"], ["onset", "f64"], ["end", "f64"],
  ["closeAt", "f64"], ["closeDist", "f32"], ["firstIv", "u32"], ["ivCount", "u32"],
];
export const INTERVAL: Schema = [
  ["episode", "u32"], ["enter", "f64"], ["exit", "f64"], ["flags", "u8"], ["next", "u32"],
  ["witness", "f64"], ["freeAt", "f64"], ["freeR", "f32"],
];
export const GAP: Schema = [["pair", "u32"], ["start", "f64"], ["end", "f64"], ["reason", "u8"]];

/** Bytes of one row (the plan's 46 / 45 / 21). */
export const rowBytes = (schema: Schema): number => schema.reduce((n, [, t]) => n + CTOR[t].BYTES_PER_ELEMENT, 0);

/** "No row" in a u32 link column (`next`, `firstIv`). */
export const NONE = 0xffffffff;

// Episode flags (u16): the origin in the low two bits.
export const ORIGIN_PROGRAM = 0, ORIGIN_ENTRY = 1, ORIGIN_BEGINNING = 2, ORIGIN_BOUNDARY = 3;
export const EP_ORIGIN_MASK = 3;
export const EP_RAPID = 1 << 2;      // the margin entry fell on a rapid
export const EP_AT_START = 1 << 3;   // touching at the program's first pose (proven)
export const EP_POSSIBLE = 1 << 4;   // every sample on a probe's braking range

// Interval flags (u8).
export const IV_POSSIBLE = 1;            // every touching sample on a braking range
export const IV_ENTER_DECIDED = 2;       // the bisection's contact-side end was a decided touch / inside
export const IV_EXIT_DECIDED = 4;
export const IV_AFTER_UNKNOWN_TOOL = 8;  // begins after a stretch with the tool unknown — no geometric re-entry
export const IV_ENDED_AT_GAP = 16;       // ended where the tool became unknown: no exit is claimed
export const IV_ENDED_AT_FEED = 32;      // a cutting contact's rapid part ended where the move became a feed: machining from there
export const IV_CONTINUES_CUT = 64;     // a later rapid part of the same cutting contact (one finding with the part before)

// Gap reasons (u8).
export const GAP_UNDECIDABLE = 1, GAP_TOOL_UNKNOWN = 2;

/** One table of the store: column blocks, a budget in rows, dirty marks. */
export class ColumnTable {
  readonly schema: Schema;
  readonly budget: number;
  private readonly blocks: Map<string, Typed[]> = new Map();
  private readonly dirtyBlocks: Uint8Array[] = [];
  private dirtyList: number[] = [];
  /** Rows written. */
  rows = 0;
  /** Rows up to here went out in a delta: a later change is an update. */
  sent = 0;
  /** Bumped by every write (a row appended, a cell set): a view built on the
   *  table knows whether it still reads what it was built from (Codex R148
   *  VP-I107). */
  revision = 0;

  constructor(schema: Schema, budget: number) {
    this.schema = schema;
    this.budget = budget;
    for (const [name] of schema) this.blocks.set(name, []);
  }

  private col(name: string): Typed[] {
    const c = this.blocks.get(name);
    if (!c) throw new Error(`contactStore: no column ${name}`);
    return c;
  }

  /** Append a row (missing columns 0); -1 when the budget is spent. */
  append(values: Readonly<Record<string, number>>): number {
    if (this.rows >= this.budget) return -1;
    const row = this.rows++;
    this.revision++;
    const b = Math.floor(row / BLOCK), o = row % BLOCK;
    if (o === 0) {
      for (const [name, type] of this.schema) this.col(name).push(new CTOR[type](BLOCK));
      this.dirtyBlocks.push(new Uint8Array(BLOCK));
    }
    for (const [name] of this.schema) this.col(name)[b]![o] = values[name] ?? 0;
    return row;
  }

  get(row: number, name: string): number {
    return this.col(name)[Math.floor(row / BLOCK)]![row % BLOCK]!;
  }
  /** A column's blocks, for a reader that holds them (contactView): row r is
   *  `blocks[r >>> BLOCK_SHIFT][r & (BLOCK - 1)]`. Read only — a write goes
   *  through set() (its dirty mark, its revision). */
  blocksOf(name: string): readonly ArrayLike<number>[] { return this.col(name); }

  /** Change one cell. A row already sent is marked dirty — once. */
  set(row: number, name: string, value: number): void {
    const b = Math.floor(row / BLOCK), o = row % BLOCK;
    this.col(name)[b]![o] = value;
    this.revision++;
    if (row < this.sent && !this.dirtyBlocks[b]![o]) {
      this.dirtyBlocks[b]![o] = 1;
      this.dirtyList.push(row);
    }
  }

  /** The rows a delta carries now: [first new row, end) and the dirty rows
   *  before it — each with every column (a dirty row's whole latest state). */
  take(): TableDelta {
    const from = this.sent, to = this.rows;
    const updates = Uint32Array.from(this.dirtyList).sort();
    const pick = (rows: (i: number) => number, n: number): Record<string, Typed> => {
      const out: Record<string, Typed> = {};
      for (const [name, type] of this.schema) {
        const a = new CTOR[type](n), col = this.col(name);
        for (let i = 0; i < n; i++) { const r = rows(i); a[i] = col[Math.floor(r / BLOCK)]![r % BLOCK]!; }
        out[name] = a;
      }
      return out;
    };
    const delta: TableDelta = { from, count: to - from, rows: pick(i => from + i, to - from), updates,
                                updated: pick(i => updates[i]!, updates.length) };
    for (const r of this.dirtyList) this.dirtyBlocks[Math.floor(r / BLOCK)]![r % BLOCK] = 0;
    this.dirtyList = [];
    this.sent = to;
    return delta;
  }

  /** A sender's delta on a receiving table: new rows appended where the
   *  sender's were (out of order is refused, never patched), updates set. */
  apply(d: TableDelta): void {
    if (d.from !== this.rows) throw new Error(`contactStore: delta from row ${d.from}, table has ${this.rows}`);
    for (let i = 0; i < d.count; i++) {
      const v: Record<string, number> = {};
      for (const [name] of this.schema) v[name] = d.rows[name]![i]!;
      if (this.append(v) < 0) throw new Error("contactStore: receiving table over its budget");
    }
    // through set(): a receiver that forwards (the coordinator) sends the new
    // rows as its own new rows and the updates of rows it already forwarded
    // as its own updates — once each, coalesced like the sender's
    for (let i = 0; i < d.updates.length; i++) {
      const r = d.updates[i]!;
      for (const [name] of this.schema) this.set(r, name, d.updated[name]![i]!);
    }
  }

  /** Allocated bytes: whole blocks of every column and the dirty marks —
   *  what the budget accounts (plan 3.4), not the used rows alone. */
  allocatedBytes(): number {
    const blocks = this.dirtyBlocks.length;
    return blocks * BLOCK * (rowBytes(this.schema) + 1);
  }
  usedBytes(): number { return this.rows * rowBytes(this.schema); }
  /** Rows marked dirty since the last delta (at most one mark per row). */
  pending(): number { return this.dirtyList.length + (this.rows - this.sent); }
}

export interface TableDelta {
  /** First new row and their count. */
  from: number;
  count: number;
  rows: Record<string, Typed>;
  /** Rows before `from` changed since the last delta, ascending, and their state. */
  updates: Uint32Array;
  updated: Record<string, Typed>;
}

export interface StoreDelta {
  /** The request and its run: a delta of another generation is dropped. */
  request: number;
  generation: number;
  episodes: TableDelta;
  intervals: TableDelta;
  gaps: TableDelta;
}

/** Row budgets of one request (plan 1.4): split over K shards by the caller. */
export interface StoreBudget { episodes: number; intervals: number; gaps: number }
export const REQUEST_BUDGET: StoreBudget = { episodes: 65536, intervals: 262144, gaps: 16384 };
/** A shard's share (1/K, plan 2.4); a side run's T/8. */
export const shareOf = (b: StoreBudget, k: number): StoreBudget =>
  ({ episodes: Math.floor(b.episodes / k), intervals: Math.floor(b.intervals / k), gaps: Math.floor(b.gaps / k) });

/** One request's three tables, its identity, and the delta handshake. */
export class ContactStore {
  readonly request: number;
  readonly generation: number;
  readonly episodes: ColumnTable;
  readonly intervals: ColumnTable;
  readonly gaps: ColumnTable;
  /** A delta is out and not acknowledged (VP139-03: at most one). */
  private inFlight = false;

  constructor(request: number, generation: number, budget: StoreBudget = REQUEST_BUDGET) {
    this.request = request;
    this.generation = generation;
    this.episodes = new ColumnTable(EPISODE, budget.episodes);
    this.intervals = new ColumnTable(INTERVAL, budget.intervals);
    this.gaps = new ColumnTable(GAP, budget.gaps);
  }

  /** The next delta, or null while the last one is unacknowledged or
   *  nothing changed. Its buffers are fresh — transferable. */
  takeDelta(force = false): StoreDelta | null {
    if (this.inFlight) return null;
    if (!force && !this.pending()) return null;
    this.inFlight = true;
    return { request: this.request, generation: this.generation,
             episodes: this.episodes.take(), intervals: this.intervals.take(), gaps: this.gaps.take() };
  }
  /** The receiver applied the last delta. */
  ack(): void { this.inFlight = false; }
  get waiting(): boolean { return this.inFlight; }

  /** A sender's delta on this (receiving) store; another request or
   *  generation is refused (the caller drops it). */
  apply(d: StoreDelta): boolean {
    if (d.request !== this.request || d.generation !== this.generation) return false;
    this.episodes.apply(d.episodes);
    this.intervals.apply(d.intervals);
    this.gaps.apply(d.gaps);
    return true;
  }

  pending(): number { return this.episodes.pending() + this.intervals.pending() + this.gaps.pending(); }
  /** Bumped by every write to any of its tables. */
  get revision(): number { return this.episodes.revision + this.intervals.revision + this.gaps.revision; }
  allocatedBytes(): number {
    return this.episodes.allocatedBytes() + this.intervals.allocatedBytes() + this.gaps.allocatedBytes();
  }
  usedBytes(): number { return this.episodes.usedBytes() + this.intervals.usedBytes() + this.gaps.usedBytes(); }
}

/** The ArrayBuffers of a delta, for postMessage's transfer list. */
export function deltaTransfer(d: StoreDelta): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const t of [d.episodes, d.intervals, d.gaps]) {
    for (const a of Object.values(t.rows)) out.push(a.buffer as ArrayBuffer);
    for (const a of Object.values(t.updated)) out.push(a.buffer as ArrayBuffer);
    out.push(t.updates.buffer as ArrayBuffer);
  }
  return out;
}

/** A free radius stored as f32 never grows the proven free stretch (plan 2.2,
 *  Codex R142): rounded toward zero. */
export function f32Inward(r: number): number {
  if (!(r > 0)) return 0;
  const f = Math.fround(r);
  if (f <= r) return f;
  // the next f32 below: step the bit pattern down by one
  const buf = new Float32Array([f]), bits = new Uint32Array(buf.buffer);
  bits[0] = bits[0]! - 1;
  return buf[0]!;
}
