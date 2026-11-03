// The code view follows the running line in STEPS that snap into place
// (operator 2026-09-30: "das Highlighten der aktuellen Zeile zuckt … wie
// beim einarmigen Banditen, dass die Zeile stehen bleibt, aber das Programm
// scrollt"; 2026-10-31: the highlight stands still; 2026-11-01: "versuchen
// wirs" — the Einrasten, after comparing AXIS, gmoccapy and Probe Basic,
// whose highlight is the line's own and so always on it). The line comes
// with every status packet (up to 30 per second); the text goes to it in a
// step of GLIDE.stepMs, slowing into the line (ease-out, like GTK's scroll
// in gmoccapy), and a line that comes sooner than GLIDE.intervalMs after
// the last step began WAITS — the latest waiting one is taken —, so the text
// rests ON a line between steps and the highlight that stands still covers
// that line, not two halves; at speed the text goes on in steps of several
// lines. While the text moves, and while a line waits, the callers draw the
// highlight as a band where the text goes to (the same step in content px):
// never ahead of the running line, on a line whenever the text rests, and
// the line it covers is at most intervalMs + stepMs behind the newest
// status the page has (a planned display lag — not an age against the
// machine, and no bound while the page itself stalls; Codex R244). The line
// number and the row's `active` are the running line at once. A far jump
// (program start, a timeline drag, a sub expansion), a view under three
// lines, reduced motion and a follow with no highlight in view to start
// from (the first after a stop, a scroll away — Codex R244 FH-05) SNAP. The
// highlight never leaves the view (Codex R52 VP-I21: at 20 lines a packet
// the highlight — then the running row itself — moved at once while the
// text followed over the packet interval, outside the view in 81 % of the
// frames): it is the band, which stands at its place on screen while the
// scroll is free; the running row, its own look off meanwhile, may be past
// the view's edge for the wait (≤ intervalMs) and the step that brings it.
// Pure.

/** A step from one scroll position to another. */
export interface Glide {
  from: number;
  to: number;
  /** Start time (ms, the caller's clock). */
  t0: number;
  /** Duration (ms). */
  dur: number;
}

export const GLIDE = {
  /** A step's duration: the text goes to the line, slowing into it. */
  stepMs: 60,
  /** The shortest time from one step's start to the next: a line that
   *  comes sooner waits, so the text rests on a line between steps. */
  intervalMs: 100,
  /** Further than this many viewport heights: a jump, not a step. */
  snapViews: 2,
} as const;

/** How long a new target waits before its step (ms; 0 = now): until
 *  GLIDE.intervalMs after the last step began; with reduced motion never
 *  (every target snaps at once). */
export function stepDelay(lastStepAt: number, now: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return Math.max(0, lastStepAt + GLIDE.intervalMs - now);
}

/** How to reach `to` from `from`: null = snap (set it at once), else the
 *  step. `viewH` = the viewport's height and `lineH` a line's, in the same
 *  units as the positions: further than GLIDE.snapViews views, or a view
 *  under three lines, snaps. */
export function planGlide(from: number, to: number, now: number, viewH: number, lineH: number,
                          reducedMotion: boolean): Glide | null {
  if (reducedMotion || !(viewH > 0) || !(viewH >= 3 * lineH)) return null;
  if (Math.abs(to - from) > GLIDE.snapViews * viewH) return null;
  if (to === from) return null;
  return { from, to, t0: now, dur: GLIDE.stepMs };
}

/** The step's position at `now` and whether it has arrived: ease-out
 *  (cubic) — fast from where it stands, slowing into the line, exactly on
 *  it at the end. */
export function glideAt(g: Glide, now: number): { pos: number; done: boolean } {
  const k = g.dur > 0 ? Math.min(1, Math.max(0, (now - g.t0) / g.dur)) : 1;
  if (k >= 1) return { pos: g.to, done: true };
  const e = 1 - (1 - k) ** 3;
  return { pos: g.from + (g.to - g.from) * e, done: false };
}
