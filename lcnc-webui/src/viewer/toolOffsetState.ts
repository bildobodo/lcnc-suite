// Is the spindle tool's OWN length offset the one in effect? (operator
// 2026-10-01: zeroing with T13 in the spindle under G49 set G54 at the
// spindle nose. LinuxCNC's startup code and every abort run G49 while the
// tool stays in the spindle, and the viewer draws the PHYSICAL tool (Codex
// R44 ST-I03), so nothing showed that the control point — what the DRO,
// zeroing and touch-off refer to — was the nose.) ONE decision for the Tool
// strip's Offset row and the viewer's control-point pin. Pure.

export type ToolOffsetState =
  | { kind: "none" }                     // no tool in the spindle
  | { kind: "unknown" }                  // a field is missing: no claim
  | { kind: "applied" }                  // the spindle tool's table length is in effect
  | { kind: "off"; g49: boolean }        // no length offset: the control point is the spindle nose
  | { kind: "other"; z: number };        // another offset in effect (G43 H<other>, G43.1, G43.2)

/** Machine units: the applied offset is the table's value, copied — a
 *  real difference is a different offset, never rounding. */
export const TLO_EPS = 1e-6;

export interface ToolOffsetInputs {
  tool_number?: number | null;
  tool_table_z?: number | null;
  tool_offset?: readonly number[] | null;
  gcodes?: readonly number[] | null;
}

export function toolOffsetState(s: ToolOffsetInputs): ToolOffsetState {
  const tool = s.tool_number;
  if (tool == null || !Number.isFinite(tool)) return { kind: "unknown" };
  if (tool <= 0) return { kind: "none" };
  const table = s.tool_table_z, z = s.tool_offset?.[2];
  if (table == null || z == null || !Number.isFinite(table) || !Number.isFinite(z)) return { kind: "unknown" };
  if (Math.abs(z - table) <= TLO_EPS) return { kind: "applied" };
  if (Math.abs(z) <= TLO_EPS) return { kind: "off", g49: (s.gcodes ?? []).includes(490) };
  return { kind: "other", z };
}

/** The pin's word and the strip's value for a state that needs one. */
export function toolOffsetWord(st: ToolOffsetState): string | null {
  switch (st.kind) {
    case "off": return st.g49 ? "Off (G49)" : "Off";
    case "other": return "Other offset";
    default: return null;
  }
}
