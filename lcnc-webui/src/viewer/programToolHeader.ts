// The program header's tool diameters beside the table's (P6-e, machine-day
// F6; plan maschinentag.r461 Rule E, Codex R461 MT461-01/-02). A CAM post
// writes its tool list as comments at the program's start — Fusion's form
// `(T13 D=1.875 CR=1. TAPER=3.7DEG - ZMIN=-25.777 - TAPERED MILL)` — and the
// preview checks the program with the TABLE's diameter. The Check basis card
// names a difference at the tool's row: a hint only. It never changes the
// table, a length, the drawing or the check, and it claims nothing about the
// comment's own correctness — only that it differs. Pure.
//
// The scan is a deliberately SMALL, straight-line header grammar (MT461-02):
// the unit is proven only by a literal, unconditional G20 / G21 in plain code
// before the first motion. Whatever the grammar does not read as plain code —
// an O-word (a sub definition, a call, a conditional), a block-delete line, a
// parameter or an expression (`#<g20>` is no G-word), a comment left open —
// makes the unit NOT PROVEN, and nothing is compared. No interpreter is
// rebuilt here. "A letter and a number" proves no neutral effect (Codex R463
// MT-I34: `M70 / G20 / M72` restores the start's units, `M98` calls a sub
// that sets them): only a bounded ALLOW-list of words passes; any other word —
// a call, a modal save / restore, a code a config may remap (M600 too) —
// leaves the unit NOT PROVEN. A comment is no word, but LinuxCNC EXECUTES its
// Python forms (Codex R466): `py,` / `pyrun,` / `pyreload` in a comment of
// either form, anywhere in the scanned lines, leave it NOT PROVEN too —
// their content is never read.
import { fmtUnit } from "../format";

/** The scan reads at most this many lines from the program's start. */
export const HEADER_MAX_LINES = 500;
/** The tolerance of the comparison: 0.001 mm PHYSICAL, converted into the
 *  comparison's units (an inch machine: 0.001 / 25.4) — Codex R461 decided. */
export const HEADER_D_TOLERANCE_MM = 0.001;
const MM_PER_IN = 25.4;

export type LengthUnit = "mm" | "in";

export interface HeaderEntry {
  tool: number;
  /** The diameter as written in the comment ("1.875", "6."). */
  raw: string;
  value: number;
}

export interface ToolHeaderScan {
  /** The unit the header's plain code proves; null = none proven (`unitWhy`). */
  unit: LengthUnit | null;
  /** Why no unit: none stated, both kinds, or code the grammar does not read
   *  as plain (control flow, block delete, parameters, a bound reached). */
  unitWhy: "none" | "both" | "unproven" | null;
  /** The tool entries of the scanned lines, in their order. */
  entries: HeaderEntry[];
}

// G-codes that move (LinuxCNC 2.9): the scan ends with the line that holds
// the first one. G28.1 / G30.1 only store a position.
const MOTION_G = new Set([0, 10, 20, 30, 50, 51, 52, 53, 280, 300, 330, 331, 382, 383, 384, 385,
                          730, 740, 760, 810, 820, 830, 840, 850, 860, 870, 880, 890]);
// G-codes that take axis words without moving (an axis word elsewhere is a
// move in the modal motion mode).
const AXIS_NO_MOTION_G = new Set([100, 431, 520, 920]);
const AXIS_LETTERS = new Set(["X", "Y", "Z", "A", "B", "C", "U", "V", "W"]);
// ── The allow-list (Codex R463 MT-I34) ──
// G: LinuxCNC 2.9's built-in codes that do not move — a built-in G-code
// cannot be remapped (2.9.4 manual §9.6.14.2); none of them calls code or
// saves / restores modal state. ×10: G4 = 40, G59.3 = 593.
const NEUTRAL_G = new Set([40, 70, 80, 100, 170, 171, 180, 181, 190, 191, 200, 210, 281, 301, 400, 410, 411, 420, 421,
                           430, 431, 432, 490, 520, 530, 540, 550, 560, 570, 580, 590, 591, 592, 593, 610, 611, 640,
                           800, 900, 901, 910, 911, 920, 921, 922, 923, 930, 940, 950, 960, 970, 980, 990]);
// M: spindle and coolant only — built in, not in the remappable set (Tx, M6,
// M61, M0, M1, M60, S, F and the unallocated codes, §9.6.14.1). Not M70–M73
// (modal save / restore), M98 / M99 (calls), M2 / M30, M100–M199, M6, M600.
const NEUTRAL_M = new Set([3, 4, 5, 7, 8, 9]);
// The arguments of those codes and the block number. T, S and F are not
// here: each can be remapped to a routine.
const ARG_LETTERS = new Set(["N", "P", "Q", "R", "L", "H", "D", "I", "J", "K", "E"]);
// One entry: a comment at the line's start, `(T<n> D=<d>` then a space or `)`.
const ENTRY = /^\(T(\d+)\s+D=(\d+(?:\.\d*)?|\.\d+)(?=[\s)])/;
const WORD = /([A-Z])([+-]?(?:\d+(?:\.\d*)?|\.\d+))/y;

type LineRead =
  | { kind: "plain"; units: number[]; motion: boolean }
  | { kind: "unproven" };

/** One line's code, comments removed: plain words, or not plain. */
function readLine(line: string): LineRead {
  const s = line.trimStart();
  // a block-delete line runs or not with the switch: anything but a comment
  // on it leaves the unit unproven
  const del = s.startsWith("/");
  const cut = stripComments(del ? s.slice(1) : s);
  if (cut == null || cut.exec) return { kind: "unproven" };
  const c = cut.code.replace(/\s+/g, "").toUpperCase();
  if (!c) return { kind: "plain", units: [], motion: false };
  if (del) return { kind: "unproven" };
  const units: number[] = [];
  const gs: number[] = [];
  let axis = false;
  WORD.lastIndex = 0;
  while (WORD.lastIndex < c.length) {
    const at = WORD.lastIndex;
    const m = WORD.exec(c);
    if (!m || m.index !== at) return { kind: "unproven" };
    const letter = m[1]!;
    if (letter === "G") {
      const g = Math.round(Number(m[2]) * 10);
      if (!MOTION_G.has(g) && !NEUTRAL_G.has(g)) return { kind: "unproven" };
      gs.push(g);
      if (g === 200 || g === 210) units.push(g);
    } else if (letter === "M") {
      const v = Number(m[2]);
      if (!Number.isInteger(v) || !NEUTRAL_M.has(v)) return { kind: "unproven" };
    } else if (AXIS_LETTERS.has(letter)) axis = true;
    // O (a sub, a call, a conditional), T, S, F: not on the list
    else if (!ARG_LETTERS.has(letter)) return { kind: "unproven" };
  }
  const motion = gs.some(g => MOTION_G.has(g)) || (axis && !gs.some(g => AXIS_NO_MOTION_G.has(g)));
  return { kind: "plain", units, motion };
}

// A comment LinuxCNC executes (2.9.4 Interp::convert_comment, interp_convert.cc
// 1499-1603: leading whitespace stripped, compared lower-case; `py,` and
// `pyrun,` run Python, `pyreload` — a prefix — reloads it).
const EXEC_COMMENT = /^\s*(?:py,|pyrun,|pyreload)/i;

/** The line's code with its comments removed, and whether a comment is one
 *  LinuxCNC executes; null = a comment left open. */
function stripComments(s: string): { code: string; exec: boolean } | null {
  let out = "";
  let exec = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === ";") { if (EXEC_COMMENT.test(s.slice(i + 1))) exec = true; break; }
    if (ch === "(") {
      const close = s.indexOf(")", i + 1);
      if (close < 0) return null;
      if (EXEC_COMMENT.test(s.slice(i + 1, close))) exec = true;
      i = close + 1;
      out += " ";
      continue;
    }
    out += ch;
    i++;
  }
  return { code: out, exec };
}

/** Scans the program's start: the tool entries and the unit, from line 1 to
 *  the line of the first motion (included), at most HEADER_MAX_LINES lines.
 *  Reads the text line by line; a multi-MB program is never split. */
export function scanToolHeader(text: string): ToolHeaderScan {
  const entries: HeaderEntry[] = [];
  let g20 = false, g21 = false, unproven = false, ended = false;
  let pos = 0;
  for (let n = 0; n < HEADER_MAX_LINES; n++) {
    const nl = text.indexOf("\n", pos);
    const end = nl < 0 ? text.length : nl;
    let line = text.slice(pos, end);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    pos = end + 1;
    const e = ENTRY.exec(line.trimStart());
    if (e) {
      const value = Number(e[2]);
      if (Number.isFinite(value) && value > 0) entries.push({ tool: Number(e[1]), raw: e[2]!, value });
    }
    const t = line.trim();
    if (t !== "%") {
      const r = readLine(line);
      if (r.kind === "unproven") { unproven = true; ended = true; break; }
      for (const u of r.units) { if (u === 200) g20 = true; else g21 = true; }
      if (r.motion) { ended = true; break; }
    }
    if (nl < 0) { ended = true; break; }
  }
  // the bound reached before the first motion: a unit word may follow
  if (!ended) unproven = true;
  const unit: LengthUnit | null = unproven || g20 === g21 ? null : g20 ? "in" : "mm";
  const unitWhy = unit ? null : unproven ? "unproven" : g20 && g21 ? "both" : "none";
  return { unit, unitWhy, entries };
}

/** What the card says of one tool's header diameter (null: the header names
 *  no diameter for it). */
export type HeaderCompare =
  | { kind: "match" }
  /** Differs from the table by more than the tolerance. */
  | { kind: "mismatch"; raw: string; headerUnit: LengthUnit; inMachine: number }
  /** The header names the tool twice with diameters beyond the tolerance. */
  | { kind: "conflict"; lo: string; hi: string }
  /** Not compared: the unit not stated / not proven, no machine unit, no table diameter. */
  | { kind: "notCompared"; raw: string; why: "unitsNotStated" | "unitsNotProven" | "machineUnit" | "noTableD" };

const toMm = (v: number, u: LengthUnit) => (u === "in" ? v * MM_PER_IN : v);

/** The header's diameter of `tool` against the table's `tableD` (machine
 *  units; null or not positive = unknown, never a substitute), in the machine
 *  unit `machineUnit` (null = not read). Duplicates are judged by the spread
 *  of ALL their values: within the tolerance one value, beyond it a conflict
 *  — never a chain of pairwise near values. */
export function compareHeaderD(scan: ToolHeaderScan | null | undefined, tool: number,
                               tableD: number | null | undefined, machineUnit: string | null | undefined): HeaderCompare | null {
  const mine = scan?.entries.filter(e => e.tool === tool) ?? [];
  if (!mine.length) return null;
  const lo = mine.reduce((a, b) => (b.value < a.value ? b : a));
  const hi = mine.reduce((a, b) => (b.value > a.value ? b : a));
  const u = scan!.unit;
  if (!u) return { kind: "notCompared", raw: lo.raw, why: scan!.unitWhy === "none" ? "unitsNotStated" : "unitsNotProven" };
  if (toMm(hi.value - lo.value, u) > HEADER_D_TOLERANCE_MM) return { kind: "conflict", lo: lo.raw, hi: hi.raw };
  const mu: LengthUnit | null = machineUnit === "mm" || machineUnit === "in" ? machineUnit : null;
  if (!mu) return { kind: "notCompared", raw: lo.raw, why: "machineUnit" };
  if (tableD == null || !Number.isFinite(tableD) || tableD <= 0) return { kind: "notCompared", raw: lo.raw, why: "noTableD" };
  // in the comparison's (machine) units, the tolerance converted
  const tol = mu === "in" ? HEADER_D_TOLERANCE_MM / MM_PER_IN : HEADER_D_TOLERANCE_MM;
  const conv = (v: number) => (u === mu ? v : u === "in" ? v * MM_PER_IN : v / MM_PER_IN);
  let far = mine[0]!, farDiff = -1;
  for (const e of mine) {
    const d = Math.abs(conv(e.value) - tableD);
    if (d > farDiff) { far = e; farDiff = d; }
  }
  return farDiff > tol ? { kind: "mismatch", raw: far.raw, headerUnit: u, inMachine: conv(far.value) } : { kind: "match" };
}

/** The words the card's tool row adds (one function — the card and its
 *  guards read the same), and whether the row warns. Null: nothing to add. */
export function headerNote(c: HeaderCompare | null, machineUnit: string | null | undefined): { text: string; warn: boolean } | null {
  if (!c || c.kind === "match") return null;
  switch (c.kind) {
    case "mismatch":
      // a header in the other unit: its value as written, and in the row's unit
      return { text: c.headerUnit === machineUnit || (machineUnit !== "mm" && machineUnit !== "in")
        ? `program header Ø ${c.raw}`
        : `program header Ø ${fmtUnit(c.raw, c.headerUnit)} (${fmtUnit(c.inMachine.toFixed(machineUnit === "in" ? 4 : 3), machineUnit)})`,
               warn: true };
    case "conflict":
      return { text: `program header Ø ${c.lo} and Ø ${c.hi} — not compared`, warn: true };
    case "notCompared": {
      const why = { unitsNotStated: "units not stated", unitsNotProven: "units not proven",
                    machineUnit: "machine units not read", noTableD: "no diameter in the table" }[c.why];
      return { text: `program header Ø ${c.raw}, ${why} — not compared`, warn: false };
    }
  }
}
