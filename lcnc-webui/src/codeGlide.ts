// The code view follows the running line by GLIDING (operator 2026-09-30:
// "das Highlighten der aktuellen Zeile zuckt … wie beim einarmigen Banditen,
// dass die Zeile stehen bleibt, aber das Programm scrollt"). The line comes
// with every status packet (up to 30 per second) and a program advances a
// different number of lines between two of them — 0, 3, 5 — so a hard
// scroll per packet jerked the text. Each new target is reached over the
// time the last packet took to come: at a steady pace the text scrolls
// evenly under a centred highlight, which stays on the line that actually
// runs (at most one packet interval from the centre — never a band that
// lags the machine). After a pause in the packets (a dwell, a long move)
// the next step glides over the longest duration — a jump from rest was a
// jerk of its own. A far jump (program start, a timeline drag, a sub
// expansion) and reduced motion SNAP. Pure.

/** A glide from one scroll position to another. */
export interface Glide {
  from: number;
  to: number;
  /** Start time (ms, the caller's clock). */
  t0: number;
  /** Duration (ms). */
  dur: number;
}

export const GLIDE = {
  /** The glide's duration: the last packet gap, held to these bounds (a
   *  pause, or no previous packet, glides over the longest). */
  minMs: 30,
  maxMs: 150,
  /** Further than this many viewport heights: a jump, not a step. */
  snapViews: 2,
} as const;

/** How to reach `to` from `from`: null = snap (set it at once), else the
 *  glide. `gapMs` = time since the previous target came, `viewH` = the
 *  viewport's height in the same units as the positions. */
export function planGlide(from: number, to: number, now: number, gapMs: number, viewH: number,
                          reducedMotion: boolean): Glide | null {
  if (reducedMotion || !(viewH > 0)) return null;
  if (Math.abs(to - from) > GLIDE.snapViews * viewH) return null;
  if (to === from) return null;
  const gap = Number.isFinite(gapMs) ? gapMs : GLIDE.maxMs;
  return { from, to, t0: now, dur: Math.min(GLIDE.maxMs, Math.max(GLIDE.minMs, gap)) };
}

/** The glide's position at `now` and whether it has arrived (linear: an even
 *  pace from packet to packet, no easing that would stop and start). */
export function glideAt(g: Glide, now: number): { pos: number; done: boolean } {
  const k = g.dur > 0 ? Math.min(1, Math.max(0, (now - g.t0) / g.dur)) : 1;
  return { pos: g.from + (g.to - g.from) * k, done: k >= 1 };
}
