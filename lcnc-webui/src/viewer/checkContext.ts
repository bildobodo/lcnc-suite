// What a collision check was computed with (step 4 plan, package 1c): the
// card "Check basis" behind a button in the Sim tab's check row. Captured
// ONCE when the check is requested — from the check's own basis
// (`CheckBasis`, viewer/checkBasis.ts) and what the viewer read beside it at
// that moment — never re-read from the live status: a status that changes
// after the check began does not change the card (Codex R85, note 2). A
// basis that is no longer the machine's state is said, not hidden. Pure.
import type { CheckBasis } from "./checkBasis";
import type { CollisionResult } from "./collision";
import type { LineAt } from "./contactView";
import type { TloEvent } from "./tloEvents";
import { fmtCoord } from "../format";
import { g5xLabel } from "../wcs";
import { lineWordAt, partLabel } from "./simRows";

const CANON = "XYZABCUVW";
const ROTARY = new Set(["A", "B", "C"]);

export interface CheckTool {
  num: number;
  /** The tool table's values the parse read (`parse_tlos`), null = none. */
  len: number | null;
  diam: number | null;
  /** A length the preview takes from the table at a predicted M600
   *  measurement (`toollen_table`): assumed, never measured. */
  assumed: boolean;
  /** No length in the table: the tool's own pairs are not checked. */
  unknown: boolean;
}

export interface CheckContext {
  basis: CheckBasis;
  /** The machine's axis letters (viewer_init.axes, joint order). */
  axes: string[];
  /** The kinematics the check poses the program in — the parse's labeling of
   *  its first move (0 machine frame, 1 TCP, 2 plane; a track without labels
   *  is posed in the machine frame), null = a label this family does not
   *  know. */
  kins: number | null;
  /** The labeling changes along the program (M428 / M429 / M430). */
  kinsSwitches: boolean;
  /** The rotary axes when the check began — idle the status's, in a run the
   *  run's start joints; null = not read. */
  rotary: Array<{ letter: string; deg: number }> | null;
  /** The active fixture (1 = G54 …); null = not read. */
  fixture: number | null;
  /** The program's tools in the order they first run. */
  programTools: CheckTool[];
  /** A provisional check during a run: from this line on. */
  fromLine: number | null;
}

export interface ContextInputs {
  basis: CheckBasis;
  axes: readonly string[];
  /** The program's first move's kinematics (semanticKinsMode of the track's
   *  first label; 0 for a track without labels), null = unknown label. */
  kins: number | null;
  kinsSwitches: boolean;
  /** Idle: the live A/B/C (status rotary_abc). Ignored in a run. */
  rotaryAbc: readonly (number | null | undefined)[] | null | undefined;
  fixture: number | null | undefined;
  tloEvents?: readonly TloEvent[] | null;
  parseTlos?: readonly (readonly (number | undefined)[])[] | null;
  toollenTable?: readonly (readonly (number | undefined)[])[] | null;
  unknownTools?: readonly number[] | null;
  fromLine?: number | null;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The program's tools with the table values the parse read. */
export function programToolsOf(i: Pick<ContextInputs, "tloEvents" | "parseTlos" | "toollenTable" | "unknownTools">): CheckTool[] {
  const out: CheckTool[] = [];
  const seen = new Set<number>();
  const assumed = new Set((i.toollenTable ?? []).map(r => Number(r[1])));
  const unknown = new Set(i.unknownTools ?? []);
  for (const ev of i.tloEvents ?? []) {
    const n = ev.tool;
    if (n == null || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    const row = (i.parseTlos ?? []).find(r => r[0] === n);
    const len = row && finite(row[3]) && row[3] !== 0 ? Math.abs(row[3]) : null;
    const diam = row && finite(row[4]) && row[4] > 0 ? row[4] : null;
    out.push({ num: n, len, diam, assumed: assumed.has(n), unknown: unknown.has(n) });
  }
  return out;
}

/** The context of a check, taken when it is requested. */
export function captureCheckContext(i: ContextInputs): CheckContext {
  const run = i.basis.kind === "run";
  let rotary: CheckContext["rotary"] = null;
  if (run) {
    const j = i.basis.startJoints;
    if (j) {
      rotary = [];
      i.axes.forEach((l, k) => { if (ROTARY.has(l) && finite(j[k])) rotary!.push({ letter: l, deg: j[k]! }); });
    }
  } else if (i.rotaryAbc) {
    rotary = [];
    for (const l of i.axes) {
      const v = ROTARY.has(l) ? i.rotaryAbc["ABC".indexOf(l)] : undefined;
      if (finite(v)) rotary.push({ letter: l, deg: v });
    }
  }
  return {
    basis: i.basis,
    axes: [...i.axes],
    kins: i.kins,
    kinsSwitches: i.kinsSwitches,
    rotary,
    fixture: finite(i.fixture) && i.fixture >= 1 ? Math.round(i.fixture) : null,
    programTools: programToolsOf(i),
    fromLine: i.fromLine ?? null,
  };
}

export interface CardRow {
  /** Empty on a row that continues the one above (the next pair, the next tool). */
  label: string;
  value: string;
  warn?: boolean;
}

export interface CardView {
  rows: CardRow[];
  /** What the card cannot say, named once each. */
  notes: string[];
}

const KINS_WORDS = ["Machine frame", "TCP", "Plane"];

function axisValues(letters: readonly string[], v: readonly number[], onlyNonZero: boolean): string {
  return letters.map(l => {
    const x = v[CANON.indexOf(l)];
    if (!finite(x) || (onlyNonZero && Math.abs(x) < 1e-9)) return null;
    return `${l} ${fmtCoord(x, l)}`;
  }).filter(Boolean).join(" ");
}

const pairName = (a: string, b: string) => `${partLabel(a)} ↔ ${partLabel(b)}`;

/** Rows, then continuation rows under one label. */
function list(rows: CardRow[], label: string, values: string[], warn = false) {
  values.forEach((value, k) => rows.push({ label: k ? "" : label, value, ...(warn ? { warn } : {}) }));
}

/**
 * The card's rows for the check whose context is `ctx` and whose result (or
 * partial) `r` is on screen. `stale`: an idle check's basis is no longer the
 * machine's state (`!sameCheckInputs(ctx.basis, live)`). `entry`: the entry
 * move's own check is merged into what is shown. `unit`: the linear unit.
 */
export function checkCard(ctx: CheckContext | null, r: CollisionResult | null,
                          o: { stale: boolean; entry: boolean; unit: string; lineAt?: LineAt | null }): CardView {
  if (!ctx) return { rows: [], notes: ["No check has run on this program yet."] };
  const b = ctx.basis;
  const rows: CardRow[] = [];
  const notes: string[] = [];
  const run = b.kind === "run";
  // the basis: whose state the check read
  rows.push(run
    ? { label: "Basis", value: `The run's start${b.runId != null ? ` (run ${b.runId})` : ""}` }
    : o.stale
      ? { label: "Basis", value: "The machine when the check started — changed since", warn: true }
      : { label: "Basis", value: "The machine when the check started" });
  // the kinematics the program is posed in; the rotary axes at the start
  const mode = ctx.kins == null ? "Unknown" : KINS_WORDS[ctx.kins] ?? "Unknown";
  rows.push({ label: "Program kinematics", value: `${mode}${ctx.kinsSwitches ? " · switches in the program" : ""}`,
              ...(ctx.kins == null ? { warn: true } : {}) });
  if (ctx.axes.some(l => ROTARY.has(l))) {
    rows.push(ctx.rotary == null ? { label: "Rotary axes", value: "Not read", warn: true }
      : { label: "Rotary axes", value: ctx.rotary.map(x => `${x.letter} ${fmtCoord(x.deg, x.letter)}`).join(" ") });
    if (run) notes.push("In a run, the rotary axes are the run's start joints.");
  }
  // the work offset, G92 and the XY rotation
  const fx = ctx.fixture == null ? "Fixture not read" : g5xLabel(ctx.fixture);
  const offs = b.g5x.length ? axisValues(ctx.axes, b.g5x, false) : "";
  rows.push({ label: "Work offset", value: [fx, offs || "values not read"].join(" ") });
  const g92 = axisValues(ctx.axes, b.g92, true);
  if (g92) rows.push({ label: "G92", value: g92 });
  if (finite(b.rotationXy) && Math.abs(b.rotationXy) > 1e-9) rows.push({ label: "XY rotation", value: `${b.rotationXy.toFixed(2)}°` });
  // the tools: the start tool, the program's tools — table values
  const n = b.toolNum;
  const len = (l: number | null) => (l != null && l > 0 ? `L ${l.toFixed(3)}` : null);
  const dia = (d: number | null) => (d != null && d > 0 ? `Ø ${d.toFixed(3)}` : null);
  rows.push({ label: "Start tool", value: n != null && n > 0
    ? [`T${n}`, len(b.toolLen), dia(b.toolDiam)].filter(Boolean).join(" · ") + ` ${o.unit} · tool table`
    : "None — the check uses a stub body" });
  // the body the check poses for a tool is not its table length (Codex R136, answer 8)
  notes.push("The check's tool body: the table length + 20 mm, at least 40 mm, and the table's diameter (none: a 6 mm stub).");
  list(rows, "Program tools", ctx.programTools.map(t => {
    if (t.unknown) return `T${t.num} · no length in the table — its own pairs not checked`;
    const dims = [len(t.len), dia(t.diam)].filter(Boolean).join(" · ");
    return `T${t.num}${dims ? ` · ${dims} ${o.unit}` : ""}${t.assumed ? " · table length, assumed at its measurement" : ""}`;
  }));
  // where the check begins
  rows.push({ label: "Start", value: run
    ? ctx.fromLine != null ? `From L${ctx.fromLine}, provisional` : "The whole program"
    : o.entry ? "The machine's position — the entry move included" : "The program's first point" });
  // what the result left out: pairs at rest, out of reach, bodies; the
  // contacts a provisional check began in
  if (r) {
    const seen = new Set<string>();
    const statics = r.staticContacts.filter(s => {
      const k = [s.a, s.b].sort().join("\u0000");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map(s => pairName(s.a, s.b));
    list(rows, "In contact at rest — excluded", statics);
    if (r.pairsPrescreened > 0) rows.push({ label: "Out of reach — excluded", value: `${r.pairsPrescreened} pair${r.pairsPrescreened === 1 ? "" : "s"}` });
    const bodies = r.bodies;
    if (bodies?.unusable.length) rows.push({ label: "Not checked", value: bodies.unusable.map(partLabel).join(", "), warn: true });
    if (bodies?.damaged.length) rows.push({ label: "Partly checked", value: bodies.damaged.map(partLabel).join(", "), warn: true });
    if (bodies?.open.length) rows.push({ label: "No inside check (open surface)", value: bodies.open.map(partLabel).join(", ") });
    const bc = r.boundaryContacts ?? [];
    // each at its DISPLAY line (plan 1.3, C3)
    list(rows, "In contact at the check's start", bc.map(c => `${pairName(c.a, c.b)} (${lineWordAt(o.lineAt, c.cum)})`), true);
  }
  return { rows, notes };
}
