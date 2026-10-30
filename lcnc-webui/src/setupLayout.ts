// The Setup section's arrangement by axis count (operator 2026-10-29/30,
// Codex R233/R234 — docs/reviews/setup-layout.review.md). Landscape has a
// fixed height of six rows and pays for WIDTH (the strip scrolls sideways),
// so the axes fill a column of up to six rows (A/B/C under X/Y/Z, U/V/W
// start the next column) and the actions fill the rows left free:
//
//   rows    the axes in groups of three side by side, the actions in rows
//           under all of them — portrait (one axis list), and a TWP machine
//           up to six axes (its eight actions need the width);
//   under   the actions in the free rows of the LAST axis column — 1–4 and
//           7–9 axes, TWP 7–9;
//   column  the actions in a column of their own beside the axes — where
//           too few rows are free under them (5–6 axes).
//
// The actions come in groups that never share a row and keep their order:
// Zero All | Home All, the three Go to, the plane trio (TWP). Each group
// takes whole rows, as few to a row as the free rows allow; the narrowest
// packing wins, then the one that fills more rows, then the earlier group
// pairs first. The plane trio is always ONE row (operator 2026-09-01: three
// equal buttons side by side, like the Go to row) — a hard constraint, not a
// cost. The width classes are fixed design parameters, never measured at
// run time: a layout must not change with a label, a state or the room left.

export type SetupForm = "rows" | "column" | "under";
export type SetupAction = "zero" | "home" | "g30" | "mcs" | "wcs" | "capture" | "orient" | "clear";

export interface SetupLayout {
  form: SetupForm;
  /** Axis entries per column, in reading order (portrait: one list). */
  columns: number[];
  /** Each shown action's span in the action block's six-track grid: 6 = alone
   *  in its row, 3 = two to a row, 2 = three to a row. The plane trio is
   *  present only on a TWP machine. */
  span: Partial<Record<SetupAction, 2 | 3 | 6>>;
}

/** The landscape row budget of the strip (`--strip-section-h`). */
export const SETUP_ROWS = 6;

interface Group { actions: SetupAction[]; perRow: number[] }
const BASE: Group = { actions: ["zero", "home"], perRow: [2, 1] };
const GOTO: Group = { actions: ["g30", "mcs", "wcs"], perRow: [3, 2, 1] };
const PLANE: Group = { actions: ["capture", "orient", "clear"], perRow: [3] };

/** Width class of a row holding `perRow` buttons of a group: one button needs
 *  no more than an axis row, two a pair, the Go to trio more, the plane trio
 *  ("Capture plane") the most. */
function widthClass(g: Group, perRow: number): number {
  if (perRow === 1) return 1;
  if (perRow === 2) return 2;
  return g === PLANE ? 4 : 3;
}

/** The narrowest packing of the groups into `free` rows; null = none fits. */
function pack(groups: Group[], free: number): number[] | null {
  let best: { w: number; rows: number; per: number[] } | null = null;
  const walk = (i: number, per: number[]): void => {
    if (i === groups.length) {
      let rows = 0, w = 0;
      per.forEach((p, j) => { rows += Math.ceil(groups[j]!.actions.length / p); w = Math.max(w, widthClass(groups[j]!, p)); });
      if (rows > free) return;
      // Descending enumeration: on a tie the first found keeps its place,
      // and that is the one whose earlier group pairs first.
      if (!best || w < best.w || (w === best.w && rows > best.rows)) best = { w, rows, per: [...per] };
      return;
    }
    for (const p of groups[i]!.perRow) walk(i + 1, [...per, p]);
  };
  walk(0, []);
  return (best as { per: number[] } | null)?.per ?? null;
}

function spans(groups: Group[], per: number[]): SetupLayout["span"] {
  const out: SetupLayout["span"] = {};
  groups.forEach((g, j) => {
    const p = per[j]!;
    g.actions.forEach((a, idx) => {
      const inRow = Math.min(p, g.actions.length - Math.floor(idx / p) * p);
      out[a] = (6 / inRow) as 2 | 3 | 6;
    });
  });
  return out;
}

function chunk(n: number, size: number): number[] {
  const out: number[] = [];
  for (let left = Math.max(0, n); left > 0; left -= size) out.push(Math.min(size, left));
  return out;
}

export function setupLayout(n: number, twp: boolean, portrait: boolean): SetupLayout {
  const groups = twp ? [BASE, GOTO, PLANE] : [BASE, GOTO];
  // The rows form: each group ONE row under the axes (today's rows).
  const rows = (columns: number[]): SetupLayout => ({ form: "rows", columns, span: spans(groups, pack(groups, groups.length)!) });
  if (portrait) return rows(n > 0 ? [n] : []);
  if (twp && n <= SETUP_ROWS) return rows(chunk(n, 3));
  const columns = chunk(n, SETUP_ROWS);
  const free = SETUP_ROWS - (columns.length ? columns[columns.length - 1]! : SETUP_ROWS);
  const under = free > 0 ? pack(groups, free) : null;
  if (under) return { form: "under", columns, span: spans(groups, under) };
  return { form: "column", columns, span: spans(groups, pack(groups, SETUP_ROWS)!) };
}
