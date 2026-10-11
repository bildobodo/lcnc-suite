// M600 in the preview (docs/reviews/m600-preview.plan.md, Codex R102–R104):
// the bundled tool_touch_off.ngc runs in the preview and moves to the point
// the tool's TABLE length would trip the setter at — only where the machine's
// probe would trip there too. Elsewhere it stops at the probe's start, and
// the payload names the measurement and why (`probe_unpredicted` rows
// [seq, tool, reason], gateway_util.PROBE_UNPREDICTED_REASONS): from there
// every position is unknown to the program's end — no path, no time, no
// collision or limit check. Pure: the sweep's note, the Simulation tab and
// the stats dialog read the same words.
import { fmtClock, fmtQty } from "../format";

/** `line`: the verified MAIN-file call the event belongs to (the rows' 4th
 *  element), 0 when it is not verified (gateway_util.main_file_event_lines). */
export interface ProbeStop { seq: number; tool: number; reason: string; line: number }

const callLine = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0);

/** Wire `probe_unpredicted` → stops in execution order; malformed rows are
 *  dropped (a row without a seq claims nothing). */
export function parseProbeStops(v: unknown): ProbeStop[] {
  if (!Array.isArray(v)) return [];
  const out: ProbeStop[] = [];
  for (const row of v) {
    if (!Array.isArray(row)) continue;
    const [seq, tool, reason, line] = row;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) continue;
    out.push({ seq, tool: typeof tool === "number" && Number.isInteger(tool) ? tool : -1,
               reason: typeof reason === "string" ? reason : "", line: callLine(line) });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

/** A predicted measurement's braking range (payload `probe_bands`, docs/
 *  reviews/parity-ef.plan.md F2): the segments seqStart < seq <= seqEnd run
 *  through a MODELED hull; every point after seqStart depends on it. */
export interface ProbeBand { seqStart: number; seqEnd: number; tool: number; line: number }

/** Wire `probe_bands` → ranges in execution order; malformed rows dropped. */
export function parseProbeBands(v: unknown): ProbeBand[] {
  if (!Array.isArray(v)) return [];
  const out: ProbeBand[] = [];
  for (const row of v) {
    if (!Array.isArray(row)) continue;
    const [a, b, tool, line] = row;
    if (typeof a !== "number" || !Number.isInteger(a) || a < 0) continue;
    if (typeof b !== "number" || !Number.isInteger(b) || b < a) continue;
    out.push({ seqStart: a, seqEnd: b, tool: typeof tool === "number" && Number.isInteger(tool) ? tool : -1,
               line: callLine(line) });
  }
  return out.sort((x, y) => x.seqStart - y.seqStart);
}

/** Where the modeled probe sequence may not hold (payload `probe_notes`). */
export interface ProbeNote { seq: number; tool: number; reason: string; line: number }

export function parseProbeNotes(v: unknown): ProbeNote[] {
  if (!Array.isArray(v)) return [];
  const out: ProbeNote[] = [];
  for (const row of v) {
    if (!Array.isArray(row)) continue;
    const [seq, tool, reason, line] = row;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) continue;
    out.push({ seq, tool: typeof tool === "number" && Number.isInteger(tool) ? tool : -1,
               reason: typeof reason === "string" ? reason : "", line: callLine(line) });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

/** A note in words (no full stop). */
export function probeNoteWhy(note: { reason: string }): string {
  switch (note.reason) {
    case "retract": return "the retract may not clear the probe after braking — the slow probe may start tripped and LinuxCNC stops";
    case "slow_limit": return "the slow probe may end below the Z limit — LinuxCNC may refuse it";
    case "brake_unknown": return "the braking range is not modeled (the configuration lacks the Z limits) — not checked below the trip point";
    default: return note.reason ? `note: ${note.reason}` : "note";
  }
}

/** The help a row after a predicted measurement carries (Codex R124: the
 *  assumption, no number — a program may compute or branch on the value). */
export function conditionalHelp(lines: readonly number[]): string {
  const ls = lines.filter(l => l > 0);
  const at = !ls.length ? "the measurement"
    : `the measurement${ls.length === 1 ? "" : "s"} at ${ls.map(l => "L" + l).join(", ")}`;
  return `After ${at}, this path assumes the table length and the modeled successful probe sequence. `
    + "Probe timing and the resulting tool offset are not verified.";
}

/** The seq of the first stop, or undefined. */
export function firstProbeStopSeq(v: unknown): number | undefined {
  return parseProbeStops(v)[0]?.seq;
}

/** Why the measurement is not predicted, in words (no full stop). */
export function probeStopWhy(stop: { tool: number; reason: string }): string {
  const t = stop.tool > 0 ? `T${stop.tool}` : "the tool";
  switch (stop.reason) {
    case "length": return `${t} has no length in the table`;
    case "setter_z": return "the tool setter lies above machine Z0";
    case "travel": return `${t}'s table length does not trip within the probe's travel`;
    case "feed": return "the probe feed is not positive";
    case "retract": return "the probe retract is not positive";
    case "slow_limit": return "the slow probe would end past the Z limit";
    case "toolsetter_unknown": return "the toolsetter values are not confirmed";
    case "toolsetter_not_set_up": return "the toolsetter is not set up";
    case "foreign_remap": return "the tool change remap is not the suite's routine";
    // docs/reviews/parity-ef.plan.md E4: a value read from the position
    // where the preview does not know it — in the routine, or anywhere
    case "position": return "the routine reads a position the preview does not know";
    case "position_read": return "the program reads a position the preview does not know";
    default: return stop.reason ? `not predicted: ${stop.reason}` : "not predicted";
  }
}

/** One line: what stopped and why ("Tool measurement not predicted (T2 has
 *  no length in the table)"). */
export function probeStopTitle(stop: { tool: number; reason: string; line?: number }): string {
  // A position read is no measurement (plan E4): said as what it is.
  if (stop.reason === "position_read")
    return `Position read not predicted${stop.line ? ` at L${stop.line}` : ""} (${probeStopWhy(stop)})`;
  return `Tool measurement not predicted (${probeStopWhy(stop)})`;
}

/** One measurement of the routine, in execution order: a predicted one with
 *  its length from the TABLE (`toollen_table` rows [seq, tool, length,
 *  line]) — an assumption, never "measured" (plan section 5) — or one the
 *  preview does not predict, with why. A stop without a tool (the routine's
 *  values unknown) is none: the summary says it. */
export interface M600Event {
  seq: number; tool: number; line: number; note: string; length: number | null;
  /** Where the modeled probe sequence may not hold (payload `probe_notes`,
   *  parity-ef plan F3), in words — for every place that lists the
   *  measurement, bound or not (Codex R126 VP-I75). */
  warnings?: string[];
}

export function m600Events(stops: readonly ProbeStop[], toollen: unknown, unit: string,
                           notes: readonly ProbeNote[] = []): M600Event[] {
  const out: M600Event[] = [];
  for (const st of stops) {
    // a position read is no measurement of the tool (plan E4)
    if (st.tool > 0 && st.reason !== "position_read") out.push({ seq: st.seq, tool: st.tool, line: st.line, length: null,
                                note: `measurement not predicted: ${probeStopWhy(st)}` });
  }
  if (Array.isArray(toollen)) {
    for (const row of toollen) {
      if (!Array.isArray(row)) continue;
      const [seq, tool, len, line] = row;
      if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) continue;   // malformed: claims nothing
      if (typeof tool !== "number" || tool <= 0 || typeof len !== "number" || !Number.isFinite(len)) continue;
      out.push({ seq, tool, line: callLine(line), length: len,
                 note: `${fmtQty(len, unit, 3)} from the table (assumed)` });
    }
  }
  out.sort((a, b) => a.seq - b.seq);
  // A note belongs to the measurement it precedes (the routine says it
  // before its probe): the next predicted one of its tool after it.
  for (const n of notes) {
    const e = out.find(x => x.seq > n.seq && x.length != null && x.tool === n.tool);
    if (e) {
      e.note += `; ${probeNoteWhy(n)}`;
      (e.warnings ??= []).push(probeNoteWhy(n));
    }
  }
  return out;
}

/** The Simulation tab's notes, bound to the CALL each measurement belongs
 *  to (Codex R105 VP-I63): by its verified line → the tool and the note,
 *  for the tool-change row of that line and that tool only. A measurement
 *  without a verified line, or a line whose runs say different things (a
 *  loop), is `unbound` — named in general, never put on every row of the
 *  tool (an earlier success, a later stop and an ordinary M6 of the same
 *  number are other calls). */
export function m600ToolNotes(events: readonly M600Event[]): {
  byLine: Map<number, { tool: number; note: string }>; unbound: M600Event[];
} {
  const byLine = new Map<number, { tool: number; note: string }>();
  const torn = new Set<number>();
  for (const e of events) {
    if (!e.line) continue;
    const had = byLine.get(e.line);
    if (had && (had.tool !== e.tool || had.note !== e.note)) torn.add(e.line);
    else byLine.set(e.line, { tool: e.tool, note: e.note });
  }
  for (const l of torn) byLine.delete(l);
  return { byLine, unbound: events.filter(e => !e.line || torn.has(e.line)) };
}

/** Program Stats' list: every measurement in order, its line where known
 *  ("T2 80.000 mm (L3), T2 not predicted (L6)"). */
export function m600StatsText(events: readonly M600Event[], unit: string): string {
  // in execution order: two runs of one call line stay two entries, each
  // with its own warnings (Codex R126 VP-I75)
  return events.map(e => `T${e.tool} ${e.length == null ? "not predicted" : fmtQty(e.length, unit, 3)}`
                         + (e.line ? ` (L${e.line})` : " (line not known)")
                         + (e.warnings?.length ? ` — ${e.warnings.join("; ")}` : "")).join(", ");
}

/** The toolsetter basis the routine was predicted with (payload
 *  `toolsetter_basis`, plan section 2): where its values are known from, in
 *  words, and whether the Settings section holds others (`settings`: var
 *  number → value, the confirmed section's toolsetterVarMap) — the next
 *  measurement the WebUI starts takes those over. Null when the program does
 *  not run the routine or the payload says nothing; unknown / never stored
 *  is the stop's to say. */
export function toolsetterBasisLine(basis: unknown, settings?: Readonly<Record<string, number>> | null): string | null {
  if (!basis || typeof basis !== "object") return null;
  const b = basis as { state?: string; origin?: string; t?: number; routine?: boolean; values?: Record<string, number | null> };
  if (!b.routine) return null;
  let line: string | null = null;
  if (b.state === "confirmed") {
    const at = typeof b.t === "number" ? ` ${fmtClock(b.t * 1000)}` : "";
    line = `Toolsetter values ${b.origin === "read" ? "read" : "taken over"}${at}`;
  } else if (b.state === "assumed") {
    line = "Toolsetter values assumed from the parameter file — not verified";
  }
  if (line && settings && b.values) {
    const newer = Object.entries(settings).some(([k, v]) => {
      const u = b.values![k];
      return typeof v === "number" && Number.isFinite(v) && (typeof u !== "number" || Math.abs(u - v) > 1e-6);
    });
    if (newer) line += ". Settings has newer values — the next measurement the WebUI starts takes them over";
  }
  return line;
}
