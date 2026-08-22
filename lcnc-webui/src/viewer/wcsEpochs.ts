// Per-segment WCS epochs (review P2 — the metre-off TWP preview).
//
// The wire ships every polyline section peeled against ITS OWN epoch's
// basis (wcs_frames rows: the fixture + offsets each section was cut in),
// instead of one program-start basis. This module is the client-side
// authority on what to RE-ADD per epoch:
//
//   non-rewritten epoch → the LIVE table row of the epoch's own fixture
//     (g5x + rotation from st.wcs_table, live g92, live tool) — a touch-off
//     on that fixture re-poses its sections without a re-parse, exactly
//     generalizing the old active-fixture behavior;
//   rewritten epoch → the PARSE SNAPSHOT: the program writes these offsets
//     itself (G10 L2 — the normal TWP path writes the plane origin into
//     G59), so the live table row is not authoritative — following it would
//     render a position the machine will never visit. Live tool terms stay
//     live in both cases (TLO is not fixture state).
//
// Mirrors the kinsForSegment routing-point pattern: one place resolves
// "which terms govern this vertex", consumed by the part-frame transform,
// the scrub pose, the entry move, the collision sweep, and the drawn-stream
// rebase below.
import {
  machineToProgram, programToMachine, wcsTerms,
  type PartFrameWcs, type WcsTerms,
} from "./partFrame";

export interface WcsEpoch {
  /** Marker seq — an epoch at seq N governs segments with seq > N. */
  seq: number;
  /** g5x index 1..9 (G54 … G59.3); 0 = unknown. */
  idx: number;
  rotationDeg: number;
  /** The PROGRAM wrote these offsets (G10 L2 / mid-program G92): re-add
   *  the snapshot below, never the live table row. */
  rewritten: boolean;
  /** Parse snapshot, machine units, axis order [x,y,z,a,b,c]. */
  g5x: number[];
  g92: number[];
}

/** One row of the live status wcs_table (OffsetPanel's shape): lowercase
 *  axis letters + "r" (rotation, degrees). Index 0 = G54 = g5x index 1. */
export type WcsTableRow = { name?: string; [k: string]: string | number | undefined };

/** Wire wcs_frames rows → structured epochs. Absent/empty = legacy payload
 *  (single-basis semantics — callers keep today's behavior, honestly). */
export function parseWcsFrames(rows: readonly number[][] | undefined): WcsEpoch[] | undefined {
  if (!rows?.length) return undefined;
  return rows.map(r => ({
    seq: r[0] ?? 0,
    idx: r[1] ?? 0,
    rotationDeg: r[2] ?? 0,
    rewritten: (r[3] ?? 0) !== 0,
    g5x: r.slice(4, 10),
    g92: r.slice(10, 16),
  }));
}

const AXIS_KEYS = ["x", "y", "z", "a", "b", "c"] as const;

/** The PartFrameWcs each epoch's segments must re-add (see module header).
 *  A non-rewritten epoch whose table row is unavailable (pre-first-status
 *  race, older gateway) falls back to the parse snapshot — the only honest
 *  stand-in; it re-resolves on the next status frame. */
export function epochWcsList(
  events: readonly WcsEpoch[],
  live: PartFrameWcs,
  table: readonly WcsTableRow[] | undefined,
): PartFrameWcs[] {
  return events.map(ev => {
    const row = !ev.rewritten && ev.idx >= 1 ? table?.[ev.idx - 1] : undefined;
    if (row) {
      return {
        g5x: AXIS_KEYS.map(k => Number(row[k] ?? 0)),
        g92: live.g92,
        rotationDeg: Number(row.r ?? 0),
        tool: live.tool,
      };
    }
    return { g5x: ev.g5x, g92: ev.g92, rotationDeg: ev.rotationDeg, tool: live.tool };
  });
}

export function epochTermsFor(
  events: readonly WcsEpoch[],
  live: PartFrameWcs,
  table: readonly WcsTableRow[] | undefined,
): WcsTerms[] {
  return epochWcsList(events, live, table).map(wcsTerms);
}

const _KEY_AXES = ["x", "y", "z", "a", "b", "c", "r"] as const;

/** Change key over ONLY the fixture rows an epoch-aware payload actually
 *  re-adds: rows of USED, NON-REWRITTEN epochs (a rewritten epoch pins the
 *  parse snapshot, so live edits to its row are display-inert). Empty
 *  string when nothing is consumed. (W2 P5 gate fix: both change-watch
 *  sites previously stringified the WHOLE ~90-number table on every idle
 *  table publish — and since wcs_frames ships ≥1 row on every modern
 *  payload, that "epoch-aware only" guard was always open.) Pure. */
export function usedWcsRowsKey(
  events: readonly WcsEpoch[] | undefined,
  table: readonly WcsTableRow[] | undefined,
): string {
  if (!events?.length) return "";
  let idxs: number[] = [];
  for (const e of events) {
    if (!e.rewritten && e.idx >= 1 && !idxs.includes(e.idx)) idxs.push(e.idx);
  }
  if (!idxs.length) return "";
  idxs = idxs.sort((a, b) => a - b);
  let out = "";
  for (const i of idxs) {
    const r = table?.[i - 1];
    out += `${i}:`;
    if (r) for (const k of _KEY_AXES) out += `${r[k] ?? 0},`;
    else out += "∅";
    out += "|";
  }
  return out;
}

function termsClose(a: WcsTerms, b: WcsTerms): boolean {
  return Math.abs(a.ox - b.ox) < 1e-9 && Math.abs(a.oy - b.oy) < 1e-9
    && Math.abs(a.oz - b.oz) < 1e-9 && Math.abs(a.oa - b.oa) < 1e-9
    && Math.abs(a.ob - b.ob) < 1e-9 && Math.abs(a.oc - b.oc) < 1e-9
    && Math.abs(a.cth - b.cth) < 1e-12 && Math.abs(a.sth - b.sth) < 1e-12;
}

const _m: number[] = [0, 0, 0, 0, 0, 0];
const _p: number[] = [0, 0, 0, 0, 0, 0];

/** Re-express drawn per-epoch program coords in the ACTIVE display frame.
 *
 *  The rendered polyline hangs under ONE scene group (workOrigin = the live
 *  ACTIVE fixture's terms), so a vertex peeled against epoch e must be
 *  re-based:  v_display = active⁻¹( epoch_e(v) ).  TLO terms cancel (same
 *  live tool on both sides). Fast path: no epoch data, or every epoch's
 *  terms already equal the active terms (the overwhelmingly common
 *  single-fixture case) → the INPUT array is returned untouched, zero
 *  copies. Pure. */
export function rebasePositions(
  pos: Float32Array,
  epochOf: Uint8Array | undefined,
  terms: readonly WcsTerms[],
  active: WcsTerms,
): Float32Array {
  if (!epochOf || !terms.length) return pos;
  if (terms.every(t => termsClose(t, active))) return pos;
  const n = (pos.length / 3) | 0;
  const out = new Float32Array(pos.length);
  for (let i = 0; i < n; i++) {
    const e = terms[epochOf[i] ?? 0] ?? active;
    const j = i * 3;
    // abc components don't participate in the XYZ mapping — zeros suffice.
    programToMachine(pos[j]!, pos[j + 1]!, pos[j + 2]!, 0, 0, 0, e, _m);
    machineToProgram(_m[0]!, _m[1]!, _m[2]!, 0, 0, 0, active, _p);
    out[j] = _p[0]!;
    out[j + 1] = _p[1]!;
    out[j + 2] = _p[2]!;
  }
  return out;
}

/** XYZ bounds of a flat position array — the worker-shipped bounds boxes
 *  are frame-mixed on multi-epoch programs, so the client recomputes them
 *  from the rebased vertices. null on an empty array (no motion ≠ a box at
 *  the origin). */
export function boundsOf(pos: Float32Array): { min: number[]; max: number[] } | null {
  const n = (pos.length / 3) | 0;
  if (n === 0) return null;
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i * 3 + k]!;
      if (v < mn[k]!) mn[k] = v;
      if (v > mx[k]!) mx[k] = v;
    }
  }
  return { min: mn, max: mx };
}
