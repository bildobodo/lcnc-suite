// The Sim tab's rows rendered in portions (Codex R164 VP-I120). The list's
// window of up to 400 rows is published at once — one data version — but its
// DOM is filled a bounded portion per frame: the first around the row the
// focus and the eye are on, then STEP_ROWS a frame until every row is there.
// The whole first list in one frame cost 21 ms of script and 30 ms of style
// and layout, and under key input both fell into one 60–64 ms task.
//
// What is rendered is ONE contiguous range [lo, hi) of the rows; the rest
// are two spacers of the rows' height (SimPanel), so the table keeps its
// height and the rows on screen their place while the portions arrive. Pure:
// SimPanel owns the frames, the spacers and the focus.

/** A contiguous range of the rows, by index: [lo, hi). */
export interface ListRange { lo: number; hi: number }

/** The first portion, and every one after it: 40 rows a frame (80 left the
 *  first arrival's key delay at 41–46 ms under key input, 40 at 38–41). */
export const FIRST_ROWS = 40;
export const STEP_ROWS = 40;

/** Every row rendered. */
export const isComplete = (r: ListRange, n: number) => r.lo <= 0 && r.hi >= n;

/** FIRST_ROWS around row i (at the list's ends: from the end). */
function around(n: number, i: number): ListRange {
  const lo = Math.max(0, Math.min(i - (FIRST_ROWS >> 1), n - FIRST_ROWS));
  return { lo, hi: Math.min(n, lo + FIRST_ROWS) };
}

/** Row i rendered: the range itself when it holds the row; extended to it
 *  when it lies within a portion of the range; else a first portion around
 *  it — never every row between (End on a 400-row list would be the one long
 *  frame again). */
export function admit(r: ListRange, n: number, i: number): ListRange {
  if (i < 0 || i >= n || (i >= r.lo && i < r.hi)) return r;
  if (r.hi > r.lo && i >= r.lo - STEP_ROWS && i < r.hi + STEP_ROWS) return { lo: Math.min(r.lo, i), hi: Math.max(r.hi, i + 1) };
  return around(n, i);
}

/** One portion more: STEP_ROWS rows, half on each side, the rest to the side
 *  that still has rows. */
export function grow(r: ListRange, n: number): ListRange {
  if (isComplete(r, n)) return { lo: 0, hi: n };
  let up = Math.min(r.lo, STEP_ROWS >> 1), down = Math.min(n - r.hi, STEP_ROWS >> 1);
  const spare = STEP_ROWS - up - down;
  if (spare > 0) {
    const more = Math.min(n - r.hi - down, spare);
    down += more;
    up += Math.min(r.lo - up, spare - more);
  }
  return { lo: r.lo - up, hi: r.hi + down };
}

/** The range for a new list (`keys`, in order), from the rows rendered for
 *  the last one and the rows that must be there at once (`anchors`, by index
 *  in the new list, the first the one that matters most — the row holding
 *  the focus, then the tab stop):
 *  - a short list, or one that brings at most STEP_ROWS rows not rendered
 *    before (a window that moved by a few rows while playing): every row;
 *  - else the rows rendered before keep their place (from the first to the
 *    last of them in the new list) when at most a portion of new rows lies
 *    between them; else a first portion around the first anchor;
 *  - the anchors admitted, the first one last of all (it decides where a far
 *    range goes). */
export function nextRange(rendered: ReadonlySet<string>, keys: readonly string[], anchors: readonly number[]): ListRange {
  const n = keys.length;
  if (n <= FIRST_ROWS) return { lo: 0, hi: n };
  let lo = -1, hi = -1, kept = 0;
  for (let i = 0; i < n; i++) if (rendered.has(keys[i]!)) { if (lo < 0) lo = i; hi = i + 1; kept++; }
  if (n - kept <= STEP_ROWS) return { lo: 0, hi: n };
  const valid = anchors.filter(a => a >= 0 && a < n);
  let r: ListRange = lo >= 0 && (hi - lo) - kept <= STEP_ROWS ? { lo, hi } : around(n, valid[0] ?? 0);
  for (let k = valid.length - 1; k >= 0; k--) r = admit(r, n, valid[k]!);
  return r;
}

/** The widest value of each column that takes its width from its rows (one
 *  line each): the sizer row renders them, so the columns have the width of
 *  the whole window from the first portion on. By length — the line and the
 *  time are monospace, the move one of two words. */
export function widestOf(rows: ReadonlyArray<{ lineLabel: string; at: string; rapid: boolean | null }>): { line: string; at: string; move: string } {
  let line = "", at = "", move = "";
  for (const r of rows) {
    if (r.lineLabel.length > line.length) line = r.lineLabel;
    if (r.at.length > at.length) at = r.at;
    if (r.rapid === true) move = "Rapid";
    else if (r.rapid === false && !move) move = "Feed";
  }
  return { line, at, move };
}
