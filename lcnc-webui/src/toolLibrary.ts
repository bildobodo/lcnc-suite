// The form library of ONE tool library revision (P6-c plan v8 §1.5–1.6, Codex
// R477 MT477-04, R480): one bounded record per tool (toolForm.ts), shared by
// reference, never copied. It lies under the tool table's store: only
// toolTableStore.ts fills it, and what it holds is content bound to a revision
// — no statement about the current table. Pure, three-free.
import { drawCounter, type DrawCounter } from "./toolDrawing";
import { baseBytes, FORM_PAYLOAD_FIELDS, formSteps, rawForm, RECORD_BYTES, TOO_DETAILED, type FormRecord, type FormState, type RawForm,
  type ShapeScalars } from "./toolForm";
import type { Steps } from "./viewer/steps";

/** The records of one library, ALL of them (Codex R492 MT-I48): every record's
 *  base (RECORD_BYTES and its note), the branch it keeps and its holder. In
 *  ascending T each record may take what is left after the bases of the rows
 *  still to come; what does not fit is refused, its base reserved. */
export const LIBRARY_BYTES_MAX = 64 * 1024 * 1024;

/** The one record of every row whose base no longer fits (more rows than any
 *  tool table has: some 21 800 of the largest notes): shared, counted once. */
export const LIBRARY_FULL: FormRecord = Object.freeze({
  kind: "refused", scalars: Object.freeze({}) as ShapeScalars, mesh: null, profile: null, segments: null, shaft: null, holder: null,
  holderWhy: null, refused: Object.freeze({ why: TOO_DETAILED, field: "library", size: null }), bytes: RECORD_BYTES,
});

/** What a form is bound to: the table (path, LinuxCNC instance), the length
 *  unit of its numbers (units per mm) and the library's revision. */
export interface ToolBinding { readonly path: string; readonly instance: string; readonly units: number; readonly rev: string }
export const sameBinding = (a: ToolBinding | null, b: ToolBinding | null): boolean =>
  !!a && !!b && a.path === b.path && a.instance === b.instance && a.units === b.units && a.rev === b.rev;

/** A decoded row as the normaliser owns it: its payload, then nothing; `rest`
 *  the bases of the rows after it. */
interface Todo { T: number; row: Record<string, unknown>; raw: RawForm; rest: number }

export class FormLibrary {
  private readonly forms = new Map<number, FormRecord | "pending">();
  private todo: Array<Todo | null>;
  private left: number;
  private taken = 0;
  /** What it is bound to; null: a reply that names no revision or no table (an
   *  older gateway) — its forms are drawn, and nothing else ever uses them. */
  readonly binding: ToolBinding | null;
  private readonly u: number;

  /** Takes over the decoded geometry of `rows` — the payload is taken OUT of
   *  the row objects, so nobody else holds it. */
  constructor(binding: ToolBinding | null, rows: Iterable<Record<string, unknown>>, units: number) {
    this.binding = binding;
    this.u = units;
    const byT = new Map<number, Todo>();
    for (const row of rows) {
      const T = row.T;
      if (typeof T !== "number" || !Number.isInteger(T)) continue;
      // a table with a number twice: one library entry
      if (!byT.has(T)) byT.set(T, { T, row, raw: rawForm(row), rest: 0 });
      for (const k of FORM_PAYLOAD_FIELDS) delete row[k];
    }
    const all = [...byT.values()].sort((a, b) => a.T - b.T), bases = all.map(t => baseBytes(t.row));
    // the bases of every row fit — or, in T order, those that fit beside the one shared record
    let own = all.length;
    if (bases.reduce((n, b) => n + b, 0) > LIBRARY_BYTES_MAX) {
      let sum = RECORD_BYTES;
      own = 0;
      while (sum + bases[own]! <= LIBRARY_BYTES_MAX) sum += bases[own++]!;
    }
    let rest = own < all.length ? RECORD_BYTES : 0;
    for (let i = own - 1; i >= 0; i--) { all[i]!.rest = rest; rest += bases[i]!; }
    if (own < all.length) this.taken = RECORD_BYTES;
    for (const t of all.slice(own)) this.forms.set(t.T, LIBRARY_FULL);
    this.todo = all.slice(0, own);
    this.left = this.todo.length;
    for (const t of this.todo) this.forms.set(t!.T, "pending");
  }

  /** A tool's form; null: no row of this library. */
  of(T: number): FormState { return this.forms.get(T) ?? null; }
  has(T: number): boolean { const f = this.forms.get(T); return f !== undefined && f !== "pending"; }
  /** Every row has its record. */
  get settled(): boolean { return this.left === 0; }
  /** What its records count. */
  get bytes(): number { return this.taken; }
  get size(): number { return this.forms.size; }

  /** Makes the records, tool by tool in ascending T: a tool's decoded lists go
   *  with its record. `done` after each. */
  *normalise(c: DrawCounter = drawCounter(), done: (T: number) => void = () => {}): Steps<void> {
    for (let i = 0; i < this.todo.length; i++) {
      const t = this.todo[i];
      if (!t) continue;
      const room = LIBRARY_BYTES_MAX - this.taken - t.rest;
      const rec: FormRecord = yield* formSteps(t.row, t.raw, this.u, room, c);
      if (rec.bytes > room) throw new Error(`tool form T${t.T}: ${rec.bytes} B past its room ${room} B`);
      this.taken += rec.bytes;
      this.forms.set(t.T, rec);
      this.todo[i] = null;
      this.left--;
      done(t.T);
      yield;
    }
    this.todo = [];
  }
  /** Ends it before it is settled: the decoded lists left go, the tools
   *  without a record stay pending. It can no longer be used for a `same`. */
  drop(): void { this.todo = []; }
}

