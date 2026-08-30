// Per-segment tool-length offset + tool number (schema 8 — the sixth
// run-time state input).
//
// Pre-8 the client applied ONE live `wcs.tool` to the whole track, so a
// program applying its own G43 before motion posed every joint a tool
// length high on a fresh boot (the corpus gate's 22.000 catch; the class
// that hid the 12.58 mm bug). The wire now ships `tlo_events` rows
// [seq, xo, yo, zo, tool] — the offset + tool the PROGRAM put in effect —
// resolved to a per-point index (`ScrubTrack.tlo`, 0xff = before the first
// row) by the same seq rule as TWP frames and WCS epochs.
//
// "Before the first row" is the machine's LIVE modal G43 state: the run
// inherits it and no parse can know it, so those points resolve to the live
// applied offset — exactly the pre-8 behavior, now confined to where it is
// true. Absent channel (program never changes tool or offset, or a legacy
// payload) ⇒ live everywhere. ONE resolver for every consumer (scrub pose,
// entry inverse, part-frame lift + peel, collision tool shift, applyState
// phase 3 under scrub) — the W3 P0 rule made per-segment.

/** Fill value for "no event governs this point yet" (live state). */
export const TLO_NONE = 0xff;

export interface TloEvent {
  seq: number;
  /** Applied tool offset XYZ, machine units. */
  xyz: [number, number, number];
  /** Tool number the program had executed M6 for, or null = inherit the
   *  loaded tool (wire -1: no M6 executed yet at this row). */
  tool: number | null;
}

const ZERO3: readonly number[] = [0, 0, 0];

/** Wire rows → events. Absent/empty = no channel (never guess). */
export function parseTloEvents(rows: readonly number[][] | undefined): TloEvent[] | undefined {
  if (!rows?.length) return undefined;
  return rows.map(r => ({
    seq: r[0] ?? 0,
    xyz: [Number(r[1] ?? 0), Number(r[2] ?? 0), Number(r[3] ?? 0)],
    tool: (r[4] ?? -1) >= 0 ? Number(r[4]) : null,
  }));
}

/** The tool offset governing a point: the event's when one governs, else
 *  the LIVE applied offset, else zero (nothing known — a fresh page before
 *  the first status tick; the transform re-runs when it arrives). */
export function tloForIndex(
  idx: number | null | undefined,
  events: readonly TloEvent[] | undefined,
  live: readonly number[] | undefined,
): readonly number[] {
  if (idx != null && idx !== TLO_NONE && events) {
    const ev = events[idx];
    if (ev) return ev.xyz;
  }
  return live && live.length >= 3 ? live : ZERO3;
}

/** The tool number governing a point: the event's when one governs and it
 *  names a tool, else the loaded tool (null when nothing is known). */
export function toolForIndex(
  idx: number | null | undefined,
  events: readonly TloEvent[] | undefined,
  liveTool: number | null | undefined,
): number | null {
  if (idx != null && idx !== TLO_NONE && events) {
    const ev = events[idx];
    if (ev && ev.tool != null) return ev.tool;
  }
  return liveTool != null && liveTool > 0 ? liveTool : null;
}

/** Tool dimensions for the collision cylinder / marker: the parse-time
 *  table row (`parse_tlos` [id, xo, yo, zo, diameter], machine units) for
 *  a program tool, else the live loaded-tool dims, else the historical
 *  stubs (6 mm × 60 mm). `known` = a real row/table value was used, so the
 *  UI can say "stub" honestly. len = |zoffset| (status_runtime's rule). */
export function toolDimsFor(
  tool: number | null,
  parseTlos: readonly (readonly number[])[] | undefined,
  unitScale: number,
  live: { diam: number | null | undefined; len: number | null | undefined },
): { diam: number; len: number; known: boolean } {
  if (tool != null && tool > 0 && parseTlos) {
    const row = parseTlos.find(r => r[0] === tool);
    if (row && row.length >= 5) {
      const diam = Number(row[4] ?? 0), len = Math.abs(Number(row[3] ?? 0));
      if (diam > 0 || len > 0) {
        return { diam: diam || 6 * unitScale, len: len || 60 * unitScale, known: true };
      }
    }
  }
  const ld = live.diam ?? 0, ll = live.len ?? 0;
  if (ld > 0 || ll > 0) return { diam: ld || 6 * unitScale, len: ll || 60 * unitScale, known: true };
  return { diam: 6 * unitScale, len: 60 * unitScale, known: false };
}
