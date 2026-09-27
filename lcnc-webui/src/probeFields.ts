// The Probing and Toolsetter parameter fields as DATA (design wave D4):
// one table per group, rendered through FormField — the common probe
// parameters used to be written out twice (surface view and the shared
// block), and no field carried a unit or an accessible name. Labels follow
// docs/ui-glossary.md (the three probing feeds are named alike in both
// forms); a unit follows its SOURCE: machine lengths and feeds in the
// machine's linear unit, a share in %, counts and tool numbers without one.
import type { ProbeDefaults, ToolsetterDefaults } from "./defaults";

export type UnitKind = "len" | "feed" | "pct" | null;

export interface ParamField<K extends string> {
  key: K;
  label: string;
  /** The "?" text: what the value is and the one rule — at most 120 chars. */
  help: string;
  unit: UnitKind;
  min?: number;
  max?: number;
  integer?: boolean;
}

/** The unit text for a field, from the machine's linear unit. */
export function unitText(kind: UnitKind, linearUnit: string): string | undefined {
  switch (kind) {
    case "len": return linearUnit;
    case "feed": return `${linearUnit}/min`;
    case "pct": return "%";
    default: return undefined;
  }
}

type ProbeNumKey = { [K in keyof ProbeDefaults]: ProbeDefaults[K] extends number ? K : never }[keyof ProbeDefaults];
type ProbeField = ParamField<ProbeNumKey>;

/** The parameters every probing procedure uses (surface map included). */
export const PROBE_COMMON_FIELDS: ProbeField[] = [
  { key: "probeTool", label: "Probe Tool #", unit: null, min: 1, integer: true,
    help: "Tool number of the probe — load it before probing." },
  { key: "slowFr", label: "Slow Feed", unit: "feed", min: 0,
    help: "Feed of the precise second touch. 0 skips it: faster, less accurate." },
  { key: "traverseFr", label: "Traverse Feed", unit: "feed", min: 1,
    help: "Feed of the moves between touches — no effect on accuracy." },
  { key: "fastFr", label: "Fast Feed", unit: "feed", min: 1,
    help: "Feed of the first touch — faster costs repeatability." },
  { key: "maxXYDistance", label: "Max X/Y Travel", unit: "len", min: 0,
    help: "Sideways search limit — the probe stops with an error beyond it." },
  { key: "xyClearance", label: "X/Y Clearance", unit: "len", min: 0,
    help: "Back-off after touching an edge, before the next move." },
  { key: "maxZDistance", label: "Max Z Travel", unit: "len", min: 0,
    help: "Downward search limit — the probe stops with an error beyond it." },
  { key: "zClearance", label: "Z Clearance", unit: "len", min: 0,
    help: "Lift above the surface between Z touches; the slow pass searches 2× this." },
  { key: "extraProbeDepth", label: "Extra Probe Depth", unit: "len", min: 0,
    help: "Extra depth for the slow Z pass — raise it on rough surfaces." },
  { key: "stepOffWidth", label: "Step Off Width", unit: "len", min: 0.1,
    help: "Distance from the edge before probing straight in." },
];

/** The rough feature sizes under a procedure's grid. */
export const PROBE_HINT_FIELDS: Partial<Record<"boss" | "angle" | "ridge", ProbeField[]>> = {
  boss: [
    { key: "diameterHint", label: "Diameter", unit: "len", min: 0,
      help: "Rough feature diameter, used to pre-position the probe. 0 = probe blind." },
    { key: "xHintBP", label: "X Hint", unit: "len", min: 0,
      help: "Rough X size of the boss or pocket. 0 = probe blind." },
    { key: "yHintBP", label: "Y Hint", unit: "len", min: 0,
      help: "Rough Y size of the boss or pocket. 0 = probe blind." },
  ],
  angle: [
    { key: "edgeWidth", label: "Edge Width", unit: "len", min: 0.1,
      help: "Measured width of the feature — the probe goes to both sides of it." },
  ],
  ridge: [
    { key: "xHintRV", label: "X Hint", unit: "len", min: 0,
      help: "Rough X width of the ridge or valley." },
    { key: "yHintRV", label: "Y Hint", unit: "len", min: 0,
      help: "Rough Y width of the ridge or valley." },
  ],
};

export const CAL_ROUND_FIELD: ProbeField = { key: "calDiameter", label: "Diameter", unit: "len", min: 0,
  help: "Exact diameter of the calibration ring — use a gauge ring." };
export const CAL_RECT_FIELDS: ProbeField[] = [
  { key: "xCalWidth", label: "X Width", unit: "len", min: 0, help: "Exact X width of the calibration block." },
  { key: "yCalWidth", label: "Y Width", unit: "len", min: 0, help: "Exact Y width of the calibration block." },
];

/** The surface-map scan area (work coordinates). */
export const SCAN_FIELDS: ProbeField[] = [
  { key: "scanX0", label: "X Min", unit: "len", help: "Left edge of the scan area, work coordinates." },
  { key: "scanX1", label: "X Max", unit: "len", help: "Right edge of the scan area, work coordinates." },
  { key: "scanY0", label: "Y Min", unit: "len", help: "Front edge of the scan area, work coordinates." },
  { key: "scanY1", label: "Y Max", unit: "len", help: "Back edge of the scan area, work coordinates." },
  { key: "scanXProbes", label: "X Probes", unit: null, min: 2, integer: true, help: "Points along X, at least 2." },
  { key: "scanYProbes", label: "Y Probes", unit: null, min: 2, integer: true, help: "Points along Y, at least 2." },
  { key: "scanSafeZ", label: "Safe Z", unit: "len",
    help: "Retract height between points — above the part and its clamps (work coordinates)." },
  { key: "scanDepthZ", label: "Probe Depth", unit: "len", min: 0.1,
    help: "How far each point searches down — deeper than the lowest spot." },
];

type TsNumKey = keyof ToolsetterDefaults;
type TsField = ParamField<TsNumKey>;

export const TS_POSITION_FIELDS: TsField[] = [
  { key: "touchX", label: "Touch X", unit: "len", help: "Toolsetter centre X, machine coordinates (G53)." },
  { key: "touchY", label: "Touch Y", unit: "len", help: "Toolsetter centre Y, machine coordinates (G53)." },
  { key: "touchZ", label: "Touch Z", unit: "len", help: "Toolsetter surface height, machine Z (G53) — usually negative." },
];
export const TS_PROBE_FIELDS: TsField[] = [
  { key: "fastFeed", label: "Fast Feed", unit: "feed", min: 1,
    help: "Feed of the first touch on the setter — faster costs repeatability." },
  { key: "slowFeed", label: "Slow Feed", unit: "feed", min: 0,
    help: "Feed of the precise second touch. 0 skips it: faster, less accurate." },
  { key: "traverseFeed", label: "Traverse Feed", unit: "feed", min: 1,
    help: "Feed of the moves to and from the setter — no effect on accuracy." },
  { key: "maxZTravel", label: "Max Z Travel", unit: "len", min: 1,
    help: "Downward search limit — stops with an error if the setter is not hit." },
  { key: "retractDist", label: "Retract Distance", unit: "len", min: 0.1,
    help: "Lift after the first touch; the slow pass searches 2× this." },
  { key: "spindleZeroHeight", label: "Spindle Zero Height", unit: "len", min: 0.1,
    help: "Spindle nose to setter surface with no tool (G53 Z) — the zero-length reference." },
];
export const TS_OPTION_FIELDS: TsField[] = [
  { key: "toolMinDis", label: "Tool Min Distance", unit: "len", min: 0,
    help: "Clearance above the expected tool tip when starting from the tool table." },
  { key: "addReps", label: "Extra Retries", unit: null, min: 0, integer: true,
    help: "Retries after a missed touch, each after a pause. 0 for a tool changer." },
];
export const TS_OFFSET_FIELDS: TsField[] = [
  { key: "offsetDiameter", label: "Min Diameter", unit: "len", min: 0,
    help: "Tools from this diameter touch off-centre (Offset). 0 = never." },
  { key: "offsetValue", label: "Offset", unit: "pct", min: 0, max: 100,
    help: "Off-centre distance as a share of the tool diameter." },
];
export const TS_FINDER_FIELDS: TsField[] = [
  { key: "finderTouchX", label: "Finder X", unit: "len", help: "Reference X (G53) used instead when the probe tool is measured." },
  { key: "finderTouchY", label: "Finder Y", unit: "len", help: "Reference Y (G53) used instead when the probe tool is measured." },
  { key: "finderDiffZ", label: "Finder Z Difference", unit: "len",
    help: "Finder reference height relative to the setter surface; may be negative." },
];
