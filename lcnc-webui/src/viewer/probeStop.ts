// M600 in the preview (docs/reviews/m600-preview.plan.md, Codex R102–R104):
// the bundled tool_touch_off.ngc runs in the preview and moves to the point
// the tool's TABLE length would trip the setter at — only where the machine's
// probe would trip there too. Elsewhere it stops at the probe's start, and
// the payload names the measurement and why (`probe_unpredicted` rows
// [seq, tool, reason], gateway_util.PROBE_UNPREDICTED_REASONS): from there
// every position is unknown to the program's end — no path, no time, no
// collision or limit check. Pure: the sweep's note, the Simulation tab and
// the stats dialog read the same words.

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
    default: return stop.reason ? `not predicted: ${stop.reason}` : "not predicted";
  }
}

/** One line: what stopped and why ("Tool measurement not predicted (T2 has
 *  no length in the table)"). */
export function probeStopTitle(stop: { tool: number; reason: string }): string {
  return `Tool measurement not predicted (${probeStopWhy(stop)})`;
}
