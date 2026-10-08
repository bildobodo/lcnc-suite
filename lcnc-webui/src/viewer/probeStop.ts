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

export interface ProbeStop { seq: number; tool: number; reason: string }

/** Wire `probe_unpredicted` → stops in execution order; malformed rows are
 *  dropped (a row without a seq claims nothing). */
export function parseProbeStops(v: unknown): ProbeStop[] {
  if (!Array.isArray(v)) return [];
  const out: ProbeStop[] = [];
  for (const row of v) {
    if (!Array.isArray(row)) continue;
    const [seq, tool, reason] = row;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) continue;
    out.push({ seq, tool: typeof tool === "number" && Number.isInteger(tool) ? tool : -1,
               reason: typeof reason === "string" ? reason : "" });
  }
  return out.sort((a, b) => a.seq - b.seq);
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
    default: return stop.reason ? `not predicted: ${stop.reason}` : "not predicted";
  }
}

/** One line: what stopped and why ("Tool measurement not predicted (T2 has
 *  no length in the table)"). */
export function probeStopTitle(stop: { tool: number; reason: string }): string {
  return `Tool measurement not predicted (${probeStopWhy(stop)})`;
}

/** The Simulation tab's note per tool on its tool-change rows: a measurement
 *  not predicted says why; a predicted one says its length is the TABLE's —
 *  an assumption, never "measured" (plan section 5; payload `toollen_table`
 *  rows [seq, tool, length]). A stop without a tool (the routine's values
 *  unknown) annotates no row: the summary says it. */
export function m600ToolNotes(stops: readonly ProbeStop[], toollen: unknown, unit: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const st of stops) {
    if (st.tool > 0 && !out.has(st.tool)) out.set(st.tool, `measurement not predicted: ${probeStopWhy(st)}`);
  }
  if (Array.isArray(toollen)) {
    for (const row of toollen) {
      if (!Array.isArray(row)) continue;
      const [seq, tool, len] = row;
      if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) continue;   // malformed: claims nothing
      if (typeof tool !== "number" || tool <= 0 || typeof len !== "number" || !Number.isFinite(len)) continue;
      if (!out.has(tool)) out.set(tool, `${fmtQty(len, unit, 3)} from the table (assumed)`);
    }
  }
  return out;
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
