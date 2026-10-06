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
}

const KIND_ORDER: Record<SimRowKind, number> = { tool: 0, limit: 1, clash: 2 };

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
      what: `Tool change → T${t.tool || "?"}`, note: "", rapid: null, at: at(t.cum) });
  }
  return rows.sort((a, b) => a.cum - b.cum || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/** The first row AFTER the position (the run's look-ahead and the
 *  simulation's "next"), or null past the last. */
export function nextRowKey(rows: readonly SimRow[], pos: number): string | null {
  for (const r of rows) if (r.cum > pos) return r.key;
  return null;
}
