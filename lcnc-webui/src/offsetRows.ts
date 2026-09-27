// The Offsets panel's auxiliary rows and their summary (operator points
// P5/P6, Codex R21/R22): what IS in effect, told apart from what is unknown.
//
// The offset vectors (g92_offset, tool_offset) are CANONICAL 9-wide — X..W at
// fixed slots (useAxes.ts). The panel used to read them by its visible column
// index: on XYZAC the C column showed B's value (Codex R22 OP22-03). A
// missing, short or non-finite vector is UNKNOWN, never zero; the comp
// enable is `boolean | null` all the way (null = the reader has no value).
import { canonicalIndex } from "./useAxes";

export type AuxState = "none" | "active" | "unknown";

export interface AuxRow {
  state: AuxState;
  /** Per visible column (the axis letters, lower case): the value, or null. */
  values: Record<string, number | null>;
}

export interface OffsetAux {
  g92: AuxRow;
  tool: AuxRow;
  /** Comp (external offsets on Z): in effect only with a known amount (on Z). */
  comp: AuxState;
  compZ: number | null;
  /** ONE line under the table: all known and nothing in effect, or which sources are unknown. */
  summary: { kind: "none" } | { kind: "unknown"; sources: string[] } | null;
}

function vectorRow(vec: readonly number[] | null | undefined, letters: readonly string[]): AuxRow {
  const values: Record<string, number | null> = {};
  let known = Array.isArray(vec);
  let any = false;
  for (const l of letters) {
    const i = canonicalIndex(l);
    const v = known && i >= 0 && i < vec!.length ? vec![i] : undefined;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      known = false;
      values[l.toLowerCase()] = null;
      continue;
    }
    values[l.toLowerCase()] = v;
    if (v !== 0) any = true;
  }
  return { state: !known ? "unknown" : any ? "active" : "none", values };
}

export function offsetAux(input: {
  letters: readonly string[];
  g92: readonly number[] | null | undefined;
  tool: readonly number[] | null | undefined;
  compZ: number | null | undefined;
  compEnabled: boolean | null | undefined;
}): OffsetAux {
  const g92 = vectorRow(input.g92, input.letters);
  const tool = vectorRow(input.tool, input.letters);
  const compZ = typeof input.compZ === "number" && Number.isFinite(input.compZ) ? input.compZ : null;
  // Enabled with no (finite) amount is UNKNOWN, not in effect (Codex R23):
  // the row would show a dash where the operator needs the amount.
  const comp: AuxState = input.compEnabled === false ? "none"
    : input.compEnabled === true && compZ !== null ? "active" : "unknown";
  const unknown = [
    g92.state === "unknown" ? "G52/G92" : null,
    tool.state === "unknown" ? "tool" : null,
    comp === "unknown" ? "comp" : null,
  ].filter((s): s is string => s !== null);
  const summary = unknown.length ? { kind: "unknown" as const, sources: unknown }
    : g92.state === "none" && tool.state === "none" && comp === "none" ? { kind: "none" as const } : null;
  return { g92, tool, comp, compZ, summary };
}
