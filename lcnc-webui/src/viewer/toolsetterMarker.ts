// The tool setter and the tool-change position in the 3D view (operator
// 2026-09-29: "ist die Position bekannt, wo er auslöst? … eine Anzeige der
// Kontaktposition"; 2026-09-30: a marker with a label, not a model, and the
// tool-change position too). Both are POINTS in the MACHINE frame
// (machineFrameGrp, like the machine box), drawn as viewer/pointMarker.ts
// pins; this module only decides WHERE, or that there is nothing to show.
//
// The tool setter: at the WebUI's set-up position — where the next
// measurement the WebUI starts probes — touchX / touchY (#3100 / #3101, G53),
// touchZ (#3102): the machine Z of the control point when a zero-length tool
// touches (the tool routine: length = contact Z − #3102). Only for a SET-UP
// tool setter (confirmedToolsetter().ok): TOOLSETTER_FALLBACK's zeros are no
// position.
//
// The tool-change position: the stored G30 (#5181–#5183, GET /g30 — the
// parameter file as of the interpreter's last synch, a display read).
import type { ToolsetterSetup } from "../toolsetterSetup";
import type { G30Response } from "../lcncApi";

export interface ToolsetterPlacement { x: number; y: number; topZ: number }

/** The contact point (machine units), or null when the tool setter is not
 *  set up. Pure. */
export function toolsetterPlacement(setup: ToolsetterSetup): ToolsetterPlacement | null {
  if (!setup.ok) return null;
  const { touchX, touchY, touchZ } = setup.values;
  if (![touchX, touchY, touchZ].every(Number.isFinite)) return null;
  return { x: touchX, y: touchY, topZ: touchZ };
}

/** The stored tool-change position's X, Y, Z (machine units), or null when
 *  the read failed or any of the three is missing (a missing row is no
 *  position — never 0). Pure. */
export function toolChangePlacement(read: G30Response | null): { x: number; y: number; z: number } | null {
  if (!read?.ok || !read.values) return null;
  const { X: x, Y: y, Z: z } = read.values;
  if (![x, y, z].every(v => typeof v === "number" && Number.isFinite(v))) return null;
  return { x: x!, y: y!, z: z! };
}
