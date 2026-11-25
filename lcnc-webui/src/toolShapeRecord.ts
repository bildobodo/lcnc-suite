// The HISTORICAL evidence a tool's library shape is paired by (P6-c plan v8
// §1.1–1.4, Codex R461/R465/R477/R480): which raw table rows LinuxCNC's own
// table proved (rule R, `seen`) under ONE binding (table, instance, units,
// library revision), and what that decides for a preview's tool row. It is
// written by an ok reply of the current connection only, is never shown as a
// table and never an edit's basis — the Tools tab reads the CURRENT read
// (toolTableStore.ts currentRead) and does not import this (a test scans).
// Pure, three-free. Its consumers (the collision body, the card, the scrub
// marker) come with P6-c bell 2: nothing is shown as checked by it yet.
import type { FormRecord } from "./toolForm";
import { sameBinding, type FormLibrary, type ToolBinding } from "./toolLibrary";

/** The drift edge's own tolerance (gateway_util.evaluate_tlo_drift), for D and
 *  Z, in machine units, at the comparison only. */
export const PAIR_EPS = 1e-4;
/** Raw rows kept per tool, newest proof first. */
export const SEEN_MAX = 8;

/** A tool row as the preview's parse read it (`parse_tlos`: raw zoffset, its
 *  sign kept, and diameter) — never toolDimsFor's magnitudes and stubs. */
export interface ToolRowRaw { T: number; D: number; Z: number }

export const SHAPE_NOT_READ = "shape not read";
export const NO_LIBRARY_SHAPE = "no library shape";
export const NO_DIAMETER = "no diameter in the table";
export const ROW_NOT_CONFIRMED = "tool row not confirmed by LinuxCNC";
export const TABLE_CHANGED = "tool table changed since the preview";

/** What a tool's row is drawn and checked as. Immutable; `form` is the record
 *  its body is built from (dropped once it is), never an owner of the library. */
export interface ShapeDecision {
  readonly T: number;
  readonly D: number;
  readonly Z: number;
  /** shape: around the library's revolved shape; envelope: around an imported
   *  mesh, all round as it spins; table: today's cylinder, `why` */
  readonly body: "shape" | "envelope" | "table";
  readonly why: string | null;
  /** a shape exists and is not used, or nobody knows: said as a caveat. A
   *  proven "no library shape" is none. */
  readonly warns: boolean;
  readonly binding: ToolBinding | null;
  readonly form: FormRecord | null;
}

/** One ok reply, as far as the evidence needs it. */
export interface ProvenRead {
  binding: ToolBinding | null;
  library: FormLibrary | null;
  /** its rows: raw values */
  rows: readonly ToolRowRaw[];
  /** rule R's proven tools; null: `unchecked` — proves and frees nothing */
  proven: ReadonlySet<number> | null;
  /** the tools LinuxCNC has and the file does not */
  missing: readonly number[];
}

export class ToolShapeRecord {
  private bound: ToolBinding | null = null;
  private lib: FormLibrary | null = null;
  private readonly seen = new Map<number, ToolRowRaw[]>();
  private lastProven: ReadonlySet<number> = new Set();

  get binding(): ToolBinding | null { return this.bound; }
  /** Tools with evidence (a guard counts them). */
  get keys(): number[] { return [...this.seen.keys()].sort((a, b) => a - b); }
  rowsOf(T: number): readonly ToolRowRaw[] { return this.seen.get(T) ?? []; }

  /** The connection ended, or the units are other ones: nothing is known. */
  clear(): void { this.bound = null; this.lib = null; this.seen.clear(); this.lastProven = new Set(); }

  /** An ok reply of the current connection. `needed`: the tools a held
   *  decision needs. Another binding starts anew from this reply; a reply that
   *  names none leaves nothing. */
  apply(r: ProvenRead, needed: ReadonlySet<number>): void {
    if (!r.binding || !sameBinding(this.bound, r.binding)) this.clear();
    this.bound = r.binding;
    this.lib = r.binding ? r.library : null;
    if (!r.binding || r.proven === null) return;
    this.lastProven = new Set(r.proven);
    for (const row of r.rows) {
      if (!(row.T > 0) || !r.proven.has(row.T) || !Number.isFinite(row.D) || !Number.isFinite(row.Z)) continue;
      const was = this.seen.get(row.T) ?? [];
      const rest = was.filter(x => x.D !== row.D || x.Z !== row.Z);
      this.seen.set(row.T, [{ T: row.T, D: row.D, Z: row.Z }, ...rest].slice(0, SEEN_MAX));
    }
    // a key lives while the table, LinuxCNC or a held decision names its tool
    const keep = new Set<number>([...r.rows.map(x => x.T), ...r.missing, ...needed]);
    for (const T of [...this.seen.keys()]) if (!keep.has(T)) this.seen.delete(T);
  }

  /** What a tool row is, as the evidence stands. Null: no tool. */
  decide(row: ToolRowRaw): ShapeDecision | null {
    if (!(row.T > 0)) return null;
    const out = (body: ShapeDecision["body"], why: string | null, warns: boolean, form: FormRecord | null): ShapeDecision =>
      Object.freeze({ T: row.T, D: row.D, Z: row.Z, body, why, warns, binding: this.bound, form });
    const table = (why: string, warns = true) => out("table", why, warns, null);
    if (!this.bound || !this.lib) return table(SHAPE_NOT_READ);
    const form = this.lib.of(row.T);
    if (form === "pending") return table(SHAPE_NOT_READ);
    if (form?.kind === "none") return table(NO_LIBRARY_SHAPE, false);
    if (form && !(row.D > 0) && form.kind !== "mesh" && form.kind !== "profile" && form.kind !== "refused") return table(NO_DIAMETER);
    const paired = this.rowsOf(row.T).some(x => Math.abs(x.D - row.D) <= PAIR_EPS && Math.abs(x.Z - row.Z) <= PAIR_EPS);
    if (!paired) return table(this.lastProven.has(row.T) ? TABLE_CHANGED : ROW_NOT_CONFIRMED);
    if (!form) return table(ROW_NOT_CONFIRMED);
    if (form.refused) return table(form.refused.why);
    return out(form.kind === "mesh" ? "envelope" : "shape", null, false, form);
  }
}

// ---- decisions and their owners (plan v8 §1.4) --------------------------------

/** The decisions of one check (its group): program tools and base tool. */
export interface ShapeSet {
  readonly binding: ToolBinding | null;
  readonly tools: ReadonlyMap<number, ShapeDecision>;
  readonly base: ShapeDecision | null;
}
export function decideSet(record: ToolShapeRecord, program: Iterable<ToolRowRaw>, base: ToolRowRaw | null): ShapeSet {
  const tools = new Map<number, ShapeDecision>();
  for (const r of program) {
    const d = record.decide(r);
    if (d && !tools.has(r.T)) tools.set(r.T, d);
  }
  return Object.freeze({ binding: record.binding, tools, base: base ? record.decide(base) : null });
}
/** The tools a set needs (a key of `seen` lives for them). */
export function toolsOf(s: ShapeSet | null): number[] {
  return s ? [...s.tools.keys(), ...(s.base ? [s.base.T] : [])] : [];
}

/** The decisions of the publication on screen before any check shows its own:
 *  refined as rows are proven, kept through a lost connection, gone with the
 *  publication. A shape once paired stays while the binding does. */
export function refineSet(was: ShapeSet | null, now: ShapeSet): ShapeSet {
  if (!was || now.binding === null || !sameBinding(was.binding, now.binding)) return now.binding === null && was ? was : now;
  const keep = (a: ShapeDecision | null | undefined, b: ShapeDecision | null): ShapeDecision | null =>
    a && a.body !== "table" && b?.body === "table" ? a : b;
  const tools = new Map<number, ShapeDecision>();
  for (const [T, d] of now.tools) tools.set(T, keep(was.tools.get(T), d)!);
  return Object.freeze({ binding: now.binding, tools, base: keep(was.base?.T === now.base?.T ? was.base : null, now.base) });
}

/** The ONE visible decision (Codex R477 MT477-02): the shown check's, when it
 *  has any — a new publication, proof or connection changes nothing of it —,
 *  else the publication's own. */
export function visibleDecision(shown: ShapeSet | null, prospective: ShapeSet | null, T: number): ShapeDecision | null {
  const of = (s: ShapeSet | null) => (s ? s.tools.get(T) ?? (s.base?.T === T ? s.base : null) : null);
  return shown ? of(shown) : of(prospective);
}

/** What is known NOW beside a held set. `not-read`: no current read (closed,
 *  failed, timed out, superseded, unchecked) — no statement. `known`: the
 *  binding a read, the status or the machine model names — units apart from
 *  table and instance: a known change needs no table read. */
export type ShapesNow =
  | { state: "not-read" }
  | { state: "known"; path?: string | null; instance?: string | null; units?: number | null; set: ShapeSet | null };

/** Is the held set still what a check would be built from? `sameBody` compares
 *  two bodies by their exact numbers (across two library revisions). */
export function sameShapes(held: ShapeSet, now: ShapesNow, sameBody: (a: ShapeDecision, b: ShapeDecision) => boolean): boolean {
  if (now.state === "not-read") return true;                           // no statement is no change
  const b = held.binding;
  if (b) {
    if (now.units != null && now.units !== b.units) return false;
    if (now.path != null && now.path !== b.path) return false;
    if (now.instance != null && now.instance !== b.instance) return false;
  }
  const live = now.set;
  if (!live || live.binding === null) return true;
  const sameLib = sameBinding(b, live.binding);
  const pair = (a: ShapeDecision | null | undefined, l: ShapeDecision | null | undefined): boolean => {
    if (!a || !l) return (a ?? null) === (l ?? null);
    // the same library: only a tool that could not be paired and now can is a
    // change — a row that left `seen` unpairs nothing that is held
    if (sameLib) return !(a.body === "table" && l.body !== "table");
    if (a.body === "table" || l.body === "table") return a.body === l.body;
    return a.body === l.body && sameBody(a, l);
  };
  for (const [T, a] of held.tools) if (!pair(a, live.tools.get(T))) return false;
  return pair(held.base, live.base);
}
