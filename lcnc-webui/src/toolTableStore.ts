// THE one reader of the tool table on the page (P6-c plan v8 §1.1 / §1.8,
// Codex R477 MT477-03, R480, R482): the Tools tab and the strip used to read
// on every ping each, and each reply carries every mesh. One reply is composed
// — a `same` reply completed with the forms the page holds, or replaced by one
// full read — and goes to two outputs that never read each other:
//  - `current`: the CURRENT read, for the Tools tab, the strip and the edits —
//    a failed one shows no rows and names no table, a superseded one changes
//    nothing, a closed connection clears it;
//  - `record` (toolShapeRecord.ts): the historical, bound evidence for library
//    shapes, written by an ok reply of this connection only.
// The decoded geometry of a reply is this store's alone: the rows it hands on
// carry the reply's scalar and text fields (of THIS reply, never of a cache),
// the geometry becomes bounded records in counted steps (toolLibrary.ts).
import type { ToolTableIdentity } from "./lcnc";
import { drawCounter } from "./toolDrawing";
import { rowFields, type FormState } from "./toolForm";
import { FormLibrary, type ToolBinding } from "./toolLibrary";
import { ToolShapeRecord, type ToolRowRaw } from "./toolShapeRecord";
import { ToolTableReads, toolTableView, type ToolReadTicket, type ToolTableView } from "./toolTableRead";
import { runSteps, type StepRun, type Steps } from "./viewer/steps";

/** A row as the store hands it on: the reply's own fields, no geometry. */
export type ToolRowFields = { T: number } & Record<string, any>;

/** The read on screen. `view` null: none of this connection yet. */
export interface CurrentRead {
  /** a connection to read from */
  open: boolean;
  /** a read is under way (or about to be) */
  reading: boolean;
  view: ToolTableView<ToolRowFields> | null;
  /** the table it names; null: a failed read, or a gateway that names none */
  table: ToolTableIdentity | null;
  error: string | null;
  /** counts the reads that were applied — what a consumer acts on */
  applied: number;
}

export const NOT_CONNECTED = "Not connected — the table reads again on reconnect";
const NO_REPLY = "No reply from the gateway — retry";
const NO_REPLY_YET = "No reply from the gateway yet — retry";
/** A `same` that was not asked for: no forms to complete it with. */
const NO_FORMS = "Tool table without its shapes — retry";
export const READ_SLOW_MS = 8000;
export const READ_TIMEOUT_MS = 60_000;

export interface ToolStoreDeps {
  /** One read (get_tool_table); `have`: the library revision the page holds. */
  ask(have: string | null, timeoutMs: number): Promise<any>;
  /** The machine's length unit (units per mm); null: not known yet. */
  units(): number | null;
  /** Runs a job in slices; the default is the page's. */
  run?: (job: Steps<void>, onError: (e: unknown) => void) => StepRun<void>;
  onCurrent(c: CurrentRead): void;
  /** Records of the library changed (a tool's form was made, another library). */
  onForms(): void;
  trace?(event: string, fields: Record<string, unknown>): void;
}

/** 4 ms slices: the runner's 8 ms with one allocation or collection on top came
 *  near a frame (plan v8 §3.1). */
export const FORM_SLICE_MS = 4;
const pageRun: NonNullable<ToolStoreDeps["run"]> = (job, onError) => {
  const run = runSteps(job, { sliceMs: FORM_SLICE_MS, onError });
  run.promise.catch(() => {});           // reported by onError
  return run;
};

const isIdentity = (t: unknown): t is ToolTableIdentity =>
  !!t && typeof (t as ToolTableIdentity).path === "string" && typeof (t as ToolTableIdentity).instance === "string";
const num = (x: unknown): number => (typeof x === "number" ? x : NaN);

export class ToolTableStore {
  readonly record = new ToolShapeRecord();
  private readonly reads = new ToolTableReads();
  private cur: CurrentRead = { open: false, reading: false, view: null, table: null, error: NOT_CONNECTED, applied: 0 };
  private library: FormLibrary | null = null;
  private job: StepRun<void> | null = null;
  /** The tools a held decision needs (P6-c bell 2 fills it). */
  needed: () => ReadonlySet<number> = () => new Set();
  private readonly deps: ToolStoreDeps;

  constructor(deps: ToolStoreDeps) { this.deps = deps; }

  get current(): CurrentRead { return this.cur; }
  private set(c: Partial<CurrentRead>): void {
    this.cur = { ...this.cur, ...c };
    this.deps.onCurrent(this.cur);
  }

  /** The form of a tool of the library on hand (null: no row of it). */
  formOf(T: number): FormState { return this.library?.of(T) ?? null; }
  /** What the library holds (guards, diagnostics). */
  get libraryState(): { binding: ToolBinding | null; bytes: number; settled: boolean; size: number } | null {
    const l = this.library;
    return l ? { binding: l.binding, bytes: l.bytes, settled: l.settled, size: l.size } : null;
  }

  // ---- the connection -------------------------------------------------------

  /** A connection opened: a new read epoch. The read itself is the caller's
   *  (it waits its delay, the state says it reads). */
  opened(): void {
    this.reads.opened();
    this.set({ open: true, reading: true, error: null });
  }
  /** It closed: nothing of its epoch applies any more. The library stays — its
   *  content is bound to its revision — but proves nothing; what was not
   *  normalised yet goes. */
  closed(): void {
    this.reads.closed();
    this.endJob();
    this.record.clear();
    this.set({ open: false, reading: false, view: null, table: null, error: NOT_CONNECTED });
  }
  /** The machine's length unit is another one: no form and no row of the old
   *  one is comparable. */
  unitsChanged(): void {
    this.endJob();
    this.library = null;
    this.record.clear();
    this.deps.onForms();
  }

  // ---- the read ---------------------------------------------------------------

  /** Reads the table. Only the newest read of the current connection applies. */
  async read(): Promise<void> {
    if (!this.reads.isOpen) { this.set({ error: NOT_CONNECTED }); return; }
    let ticket: ToolReadTicket = this.reads.begin();
    this.set({ reading: true, error: null });
    const slow = setTimeout(() => {
      if (this.reads.applies(ticket) && this.cur.reading) this.set({ error: NO_REPLY_YET });
    }, READ_SLOW_MS);
    try {
      let have = this.haveRev();
      for (;;) {
        const reply = await this.deps.ask(have, READ_TIMEOUT_MS);
        if (!this.reads.applies(ticket)) return;
        const unresolved = reply?.ok && reply.library?.state === "same" && !this.resolves(reply);
        if (!unresolved) { this.apply(reply); return; }
        // nothing of it is delivered; ONE full read in its place
        this.deps.trace?.("tools.same_unresolved", { asked: !!have });
        this.dropLibrary();
        if (!have) { this.apply({ ok: false, error: NO_FORMS }); return; }   // never a loop
        have = null;
        ticket = this.reads.begin();
      }
    } finally {
      clearTimeout(slow);
    }
  }

  /** The revision to name: of a settled, bound library in the current units. */
  private haveRev(): string | null {
    const l = this.library;
    return l?.binding && l.settled && l.binding.units === this.deps.units() ? l.binding.rev : null;
  }
  /** Can a `same` reply be completed with the library on hand: its revision,
   *  table, LinuxCNC instance and units, and a record for every row. */
  private resolves(reply: any): boolean {
    const b = this.library?.binding, t = reply.table;
    return !!b && this.library!.settled && reply.library.rev === b.rev && reply.rev?.library === b.rev
      && isIdentity(t) && t.path === b.path && t.instance === b.instance && this.deps.units() === b.units
      && Array.isArray(reply.tools) && reply.tools.every((r: any) => this.library!.has(r?.T));
  }

  /** The reply this read shows: rows, forms, then the evidence. */
  private apply(reply: any): void {
    const ok = !!reply?.ok && Array.isArray(reply.tools);
    const raw: Record<string, unknown>[] = ok ? reply.tools : [];
    const rows = raw.map(r => rowFields(r) as ToolRowFields);
    const view = toolTableView<ToolRowFields>(ok ? { ...reply, tools: rows } : reply, this.cur.open ? NO_REPLY : NOT_CONNECTED);
    const table = view.kind !== "failed" && isIdentity(reply.table) ? { path: reply.table.path, instance: reply.table.instance } : null;
    if (view.kind !== "failed") {
      const binding = this.bindingOf(reply, table);
      if (reply.library?.state !== "same") this.takeForms(binding, raw);
      this.record.apply({
        binding, library: this.library,
        rows: rows.map((r): ToolRowRaw => ({ T: r.T, D: num(r.D), Z: num(r.Z) })),
        proven: view.kind === "complete" || view.kind === "partial" ? view.proven : null,
        missing: Array.isArray(reply.proof?.missing) ? reply.proof.missing : [],
      }, this.needed());
    }
    this.set({ reading: false, view, table, error: view.error, applied: this.cur.applied + 1 });
  }
  private bindingOf(reply: any, table: ToolTableIdentity | null): ToolBinding | null {
    const rev = reply.library?.rev ?? reply.rev?.library, units = this.deps.units();
    return table && typeof rev === "string" && rev && units !== null ? { ...table, units, rev } : null;
  }

  // ---- the forms --------------------------------------------------------------

  private takeForms(binding: ToolBinding | null, raw: Record<string, unknown>[]): void {
    this.endJob();
    const lib = new FormLibrary(binding, raw, this.deps.units() ?? 1);
    this.library = lib;
    this.deps.onForms();
    const c = drawCounter(), t0 = performance.now();
    // a tool's record is seen once made: the preview and the notices follow
    this.job = (this.deps.run ?? pageRun)(this.formJob(lib, c, t0), e => {
      // (a fault of the page, no shape's: formSteps refuses those by name)
      this.deps.trace?.("tools.forms_failed", { error: String(e) });
      if (this.library === lib) this.dropLibrary();
    });
  }
  private *formJob(lib: FormLibrary, c: ReturnType<typeof drawCounter>, t0: number): Steps<void> {
    yield* lib.normalise(c, () => this.deps.onForms());
    this.deps.trace?.("tools.forms", { tools: lib.size, bytes: lib.bytes, ops: c.total, ms: Math.round(performance.now() - t0) });
  }
  /** The job of an older reply, binding or connection ends at its next yield;
   *  what it had not normalised goes. */
  private endJob(): void {
    if (!this.job) return;
    this.job.cancel();
    this.job = null;
    if (this.library && !this.library.settled) { this.library.drop(); this.library = null; this.deps.onForms(); }
  }
  private dropLibrary(): void {
    this.endJob();
    this.library = null;
    this.deps.onForms();
  }
}
