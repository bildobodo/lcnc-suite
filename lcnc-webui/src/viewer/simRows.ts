// The Simulation tab's list (operator 2026-10-05, from renders): ONE row per
// mark on the timeline — × collision, ▲ soft limit, ● tool change — in
// timeline order, built from the SAME targets the bar marks and navigates
// (viewer/clashTargets.ts, the limit and tool targets of ScrubBar), so the
// list, the marks and prev/next can never disagree. Pure; unit-tested.
import { limitViolationText, type LimitViolation } from "../ws/bulkData";
import { fmtDist, fmtElapsed, fmtPct } from "../format";
import type { ClashTarget } from "./clashTargets";

export type SimRowKind = "clash" | "limit" | "tool";

export interface SimRow {
  /** The target's own key (C…/E… a collision, L<line> a limit, T<line> a
   *  tool change) — what a jump and the shown finding are named by. */
  key: string;
  kind: SimRowKind;
  /** The program line; a contact on the entry move reads "entry". */
  lineLabel: string;
  line: number;
  cum: number;
  cumEnd: number;
  /** What happened: the body pair, the axis and its limit, the tool. */
  what: string;
  /** A muted addition: re-entry, near miss, how far a contact reaches. */
  note: string;
  /** A collision's move: rapid or feed; null for the other kinds. */
  rapid: boolean | null;
  /** Where on the timeline: mm:ss on a time axis, else a percentage. */
  at: string;
}

/** A body id as the operator reads it: "spindle_nose" → "Spindle nose",
 *  "a_yoke_casting" → "A yoke casting", the parametric cutter "tool" → "Tool". */
export function partLabel(id: string): string {
  const words = id.split(/[_\s]+/).filter(Boolean);
  if (!words.length) return id;
  const out = words.map((w, i) => (w.length === 1 ? w.toUpperCase() : i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w));
  return out.join(" ");
}

export interface SimRowInput {
  clash: readonly ClashTarget[];
  limit: readonly { key: string; line: number; cum: number; cumEnd: number }[];
  tool: readonly { key: string; line: number; tool: number; cum: number; cumEnd: number }[];
  /** The program's limit records (several axes may share a line). */
  violations: readonly LimitViolation[];
  unit: string;
  /** The displayed track's axis: seconds when time-based, else its length. */
  timeBased: boolean;
  axisEnd: number;
  /** The first PREDICTED limit crossing: the first track point a move ENDS
   *  beyond the joint window at (the gateway's per-vertex flag — wire
   *  feed_outside / rapid_outside), with its line; null without flags. Where
   *  the run actually stops is not determined (Codex R97 VP-I55). */
  stop?: { cum: number; line: number } | null;
  /** The note of the tool measurement a tool-change row's CALL made, by its
   *  line (probeStop.m600ToolNotes): on that line's row of that tool only. */
  toolNotes?: ReadonlyMap<number, { tool: number; note: string }>;
  /** Where each predicted tool measurement's braking range begins (its trip
   *  point on the displayed track) with its call line (0 = not verified):
   *  every row after one is CONDITIONAL on it (docs/reviews/parity-ef.plan.md
   *  F3, Codex R124 — the path assumes the table length and the modeled
   *  probe sequence). Ascending. */
  measurements?: readonly { cum: number; line: number }[];
}

const KIND_ORDER: Record<SimRowKind, number> = { tool: 0, limit: 1, clash: 2 };

/** The measurement note of a tool-change row: its line's, for its tool. */
function toolNote(notes: SimRowInput["toolNotes"], t: { line: number; tool: number }): string {
  const n = notes?.get(t.line);
  return n && n.tool === t.tool ? n.note : "";
}

/** THE order of the list AND of the steps through it (Codex R78 VP-I38: the
 *  steps sorted by position alone and went down, then back up, where two
 *  marks share a moment): the position, then tool → limit → collision (a
 *  stable sort keeps a kind's own order). */
export function simRowOrder(a: { cum: number; kind: SimRowKind }, b: { cum: number; kind: SimRowKind }): number {
  return a.cum - b.cum || KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
}

export function buildSimRows(i: SimRowInput): SimRow[] {
  const at = (cum: number) => i.timeBased
    ? fmtElapsed(Math.floor(cum))
    : fmtPct(i.axisEnd > 0 ? cum / i.axisEnd : 0);
  const byLine = new Map<number, LimitViolation[]>();
  for (const v of i.violations) {
    const l = byLine.get(v.line);
    if (l) l.push(v); else byLine.set(v.line, [v]);
  }
  const rows: SimRow[] = [];
  for (const t of i.clash) {
    const notes: string[] = [];
    if (t.reentry) notes.push("re-entry");
    if ((t.dist ?? 0) > 1e-3) notes.push(`near miss, ${fmtDist(t.dist ?? 0, i.unit)} apart`);
    if ((t.spanEndLine ?? t.line) > t.line) notes.push(`through L${t.spanEndLine}`);
    if (t.possible) notes.push("possible — in the probe's braking range");
    rows.push({ key: t.key, kind: "clash", line: t.line, lineLabel: t.entry ? "entry" : `L${t.line}`,
      cum: t.cum, cumEnd: t.cumEnd,
      what: t.a && t.b ? `${partLabel(t.a)} ↔ ${partLabel(t.b)}` : "Collision",
      note: notes.join(" · "), rapid: !!t.rapid, at: at(t.cum) });
  }
  for (const t of i.limit) {
    const recs = byLine.get(t.line) ?? [];
    rows.push({ key: t.key, kind: "limit", line: t.line, lineLabel: `L${t.line}`, cum: t.cum, cumEnd: t.cumEnd,
      what: recs.length ? recs.map(v => limitViolationText(v, i.unit)).join(" · ") : "Soft limit",
      note: "", rapid: null, at: at(t.cum) });
  }
  for (const t of i.tool) {
    rows.push({ key: t.key, kind: "tool", line: t.line, lineLabel: `L${t.line}`, cum: t.cum, cumEnd: t.cumEnd,
      what: `Tool change → T${t.tool || "?"}`, note: toolNote(i.toolNotes, t), rapid: null, at: at(t.cum) });
  }
  rows.sort(simRowOrder);
  markLimitStop(rows, i.stop ?? null);
  markConditional(rows, i.measurements ?? []);
  return rows;
}

/** Rows after a predicted tool measurement (docs/reviews/parity-ef.plan.md
 *  F3, Codex R124/R125): the path from its trip point on assumes the table
 *  length and the modeled probe sequence — "conditional", with the call line
 *  (the full words are the check's "?", probeStop.conditionalHelp). A row AT
 *  the trip point or before (the tool change itself) is not. */
function markConditional(rows: SimRow[], ms: readonly { cum: number; line: number }[]): void {
  if (!ms.length) return;
  for (const r of rows) {
    const before = ms.filter(m => m.cum < r.cum);
    if (!before.length) continue;
    const ls = [...new Set(before.map(m => m.line).filter(l => l > 0))];
    const text = `conditional — after the measurement${ls.length > 1 ? "s" : ""}${ls.length ? ` at ${ls.map(l => "L" + l).join(", ")}` : ""}`;
    r.note = r.note ? `${r.note} · ${text}` : text;
  }
}

/** The predicted measurements on a displayed track (`SimRowInput.measurements`):
 *  where the braking-range count `cond` rises, the point before it is the
 *  trip point; the call lines come with the payload's ranges, in order. */
export function measurementsOf(t: { count: number; cum: ArrayLike<number>; cond?: ArrayLike<number> } | null | undefined,
                               lines: readonly number[]): { cum: number; line: number }[] {
  const c = t?.cond;
  if (!t || !c) return [];
  const out: { cum: number; line: number }[] = [];
  let k = 0;
  for (let i = 1; i < t.count; i++) {
    while ((c[i] ?? 0) > k) {
      out.push({ cum: t.cum[i - 1]!, line: lines[k] ?? 0 });
      k++;
    }
  }
  return out;
}

/** The first point of a track a move ends beyond the joint window at (the
 *  gateway's per-vertex flag) with its line — `SimRowInput.stop`; null
 *  without flags or with none set. */
export function limitStopOf(t: { count: number; cum: ArrayLike<number>; lines: ArrayLike<number>; outside?: ArrayLike<number> } | null | undefined):
    { cum: number; line: number } | null {
  const o = t?.outside;
  if (!t || !o) return null;
  for (let i = 0; i < t.count; i++) if (o[i]) return { cum: t.cum[i]!, line: t.lines[i]! };
  return null;
}

/** Rows after the first PREDICTED limit crossing (operator 2026-10-08: a
 *  program past its first violation shows moments a machine would not run
 *  through; the check runs on). The boundary is the first track point a move
 *  ends beyond the joint window at (`stop`, the gateway's per-vertex flag) —
 *  the line's start was claimed for an arc whose ends lie inside (Codex R96
 *  VP-I55). It is a crossing, not a proven stop: LinuxCNC refuses a move
 *  whose END is outside when it is queued (2.9 command.c `inRange` →
 *  `tpAbort`), and an arc runs until control.c's run-time check sees the
 *  commanded joint past the limit — then the trajectory still DECELERATES
 *  (tp.c `tpHandleAbort`), so the stop may lie past the crossing (Codex R97:
 *  ≥ 1.25 mm at 5 mm/s and 10 mm/s²). Where it stops is not determined, and
 *  the notes say only what is known: the crossing line's limit row "first
 *  predicted limit crossing — where the run stops is not determined", every
 *  row starting after the point (strictly) "after the first limit crossing
 *  at L…". Everything stays listed. */
function markLimitStop(rows: SimRow[], stop: { cum: number; line: number } | null): void {
  if (!stop) return;
  const add = (r: SimRow, text: string) => { r.note = r.note ? `${r.note} · ${text}` : text; };
  const own = rows.find(r => r.kind === "limit" && r.line === stop.line && r.cum <= stop.cum);
  if (own) add(own, "first predicted limit crossing — where the run stops is not determined");
  for (const r of rows) if (r !== own && r.cum > stop.cum) add(r, `after the first limit crossing at L${stop.line}`);
}

/** The first row AFTER the position (the run's look-ahead and the
 *  simulation's "next"), or null past the last. */
export function nextRowKey(rows: readonly SimRow[], pos: number): string | null {
  for (const r of rows) if (r.cum > pos) return r.key;
  return null;
}
