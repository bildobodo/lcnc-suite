/**
 * Run-from-line toolchange scan (RFL × M600 guard).
 *
 * LinuxCNC's run-from-line skim re-enters M600/M601 remap bodies in lines
 * 1..N-1: probes execute for REAL while plain moves are discarded and G43
 * doesn't survive into the synthesized state (no TLO at cycle start). The UI
 * therefore scans the program text before confirming a run-from-line start:
 *   - 0 toolchanges before N  → normal RFL.
 *   - 1 toolchange, known T   → redirect: gateway measures via MDI first
 *                               (pre_tool), the #3116 flag skips the skim's
 *                               re-entry (see tool_touch_off.ngc o<450>).
 *   - anything else           → refuse with guidance (unsupported).
 *
 * Pure module (string in, result out) so it's unit-testable.
 */

export interface RflToolchangeScan {
  /** toolchange statements (M6 / M600 / M601) strictly before startLine */
  count: number;
  /** T number in effect at the LAST toolchange before startLine (null = none/unknown) */
  lastTool: number | null;
  /** 1-based source line of that last toolchange */
  lastLine: number | null;
}

// Word matchers on comment-stripped text. M0*6 must not match M60/M66/M600 —
// (?!\d) guards the tail; M600/M601 are matched explicitly first.
const RE_M600 = /(?<![A-Z0-9.])M0*60([01])(?!\d)/gi;
const RE_M6 = /(?<![A-Z0-9.])M0*6(?!\d)/gi;
const RE_T = /(?<![A-Z0-9.])T0*(\d+)(?!\d)/gi;

function stripComments(line: string): string {
  // `;` to end of line, and any `(...)` blocks (LinuxCNC inline comments).
  const semi = line.indexOf(";");
  let s = semi === -1 ? line : line.slice(0, semi);
  s = s.replace(/\([^)]*\)/g, " ");
  return s;
}

export function scanToolchangesBefore(text: string, startLine: number): RflToolchangeScan {
  const out: RflToolchangeScan = { count: 0, lastTool: null, lastLine: null };
  if (!text || startLine <= 1) return out;

  let lineNum = 0;
  let pos = 0;
  let pendingTool: number | null = null;  // last T word seen so far (modal prepare)

  while (pos <= text.length) {
    lineNum++;
    if (lineNum >= startLine) break;  // strictly before the start line
    const nl = text.indexOf("\n", pos);
    const rawLine = nl === -1 ? text.slice(pos) : text.slice(pos, nl);
    pos = nl === -1 ? text.length + 1 : nl + 1;

    // Cheap pre-filter: the heavy regexes only run on lines that can match.
    if (!/[TtMm]/.test(rawLine)) continue;
    const line = stripComments(rawLine);
    if (!line) continue;

    RE_T.lastIndex = 0;
    let tMatch: RegExpExecArray | null = null;
    for (let m = RE_T.exec(line); m; m = RE_T.exec(line)) tMatch = m;
    if (tMatch) pendingTool = parseInt(tMatch[1]!, 10);

    RE_M600.lastIndex = 0;
    RE_M6.lastIndex = 0;
    // Remove M600/M601 occurrences before testing plain M6 so "M600" doesn't
    // need negative-lookahead gymnastics in RE_M6.
    const m600Hits = line.match(RE_M600)?.length ?? 0;
    const m6Hits = line.replace(RE_M600, " ").match(RE_M6)?.length ?? 0;
    const hits = m600Hits + m6Hits;
    if (hits > 0) {
      out.count += hits;
      out.lastTool = pendingTool;
      out.lastLine = lineNum;
    }
    if (nl === -1) break;
  }
  return out;
}

// ── Entry-position scan (RFL position preamble) ─────────────────────────────
//
// RFL entry obeys MODAL axis words: an axis not mentioned on a line doesn't
// move from its CURRENT physical position, so starting mid-contour executes
// Y/Z moves at the wrong X until some line carries an X word. The preamble
// derives the XY position the program expects at line N (last plain X/Y words
// before it) so the gateway can G0 there at safe Z before AUTO_RUN.
//
// A *textual* modal scan is only trustworthy in plain G90 absolute programs.
// Anything that changes the coordinate mapping or moves axes invisibly makes
// the derived XY wrong — those become `blockers` and the preamble is SKIPPED
// (with a visible warning; the run itself proceeds with stock entry behavior).

export interface RflEntryScan {
  x: number | null;          // last plain X word value before startLine
  y: number | null;
  wcs: string | null;        // single G54..G59.3 seen (issued before the preamble move)
  units: string | null;      // last G20/G21 seen (issued before the preamble move)
  blockers: string[];        // non-empty → preamble unavailable, reasons listed
}

const RE_G91 = /(?<![A-Z0-9.])G0*91(?![.\d])/i;          // plain G91 only (G91.1 is arc-mode, fine)
const RE_WCS = /(?<![A-Z0-9.])G0*5([4-9])(\.[123])?(?![\d])/gi;
const RE_UNITS = /(?<![A-Z0-9.])G0*2([01])(?![.\d])/gi;
const RE_G10 = /(?<![A-Z0-9.])G10(?![.\d])/i;            // offset/table writes
const RE_G92 = /(?<![A-Z0-9.])G0*92(\.\d)?(?![\d])/i;    // G92 set/clear family
const RE_G28_30 = /(?<![A-Z0-9.])G0*(28|30)(\.1)?(?![\d])/i;  // via-point home moves
const RE_OCALL = /(?<![A-Z0-9])o\s*(<[^>]+>|\d+)\s*(call|repeat|while|do)/i;
const RE_XNUM = /(?<![A-Z0-9.])X\s*([-+]?(?:\d+\.?\d*|\.\d+))(?![\d.])/gi;
const RE_YNUM = /(?<![A-Z0-9.])Y\s*([-+]?(?:\d+\.?\d*|\.\d+))(?![\d.])/gi;
const RE_XEXPR = /(?<![A-Z0-9.])X\s*[[#]/i;             // X[expr] / X#<var> — unevaluable
const RE_YEXPR = /(?<![A-Z0-9.])Y\s*[[#]/i;
// Rotary / secondary axes are modal too, and with a tilted rotary even an "XY at
// safe Z" preamble isn't inherently safe — XY-only preamble must stand down.
const RE_ROTARY = /(?<![A-Z0-9.])[ABCUVW]\s*[-+[#]?\s*[\d.#[]/i;
const RE_TCP = /(?<![A-Z0-9.])G0*43\.4(?![\d])/i;        // TCP kinematics

export function scanEntryPositionBefore(text: string, startLine: number): RflEntryScan {
  const out: RflEntryScan = { x: null, y: null, wcs: null, units: null, blockers: [] };
  if (!text || startLine <= 1) return out;
  const block = (reason: string) => {
    if (!out.blockers.includes(reason)) out.blockers.push(reason);
  };

  let lineNum = 0;
  let pos = 0;
  const wcsSeen = new Set<string>();

  while (pos <= text.length) {
    lineNum++;
    if (lineNum >= startLine) break;
    const nl = text.indexOf("\n", pos);
    const rawLine = nl === -1 ? text.slice(pos) : text.slice(pos, nl);
    pos = nl === -1 ? text.length + 1 : nl + 1;

    if (!/[GgXxYyOo]/.test(rawLine)) continue;
    const line = stripComments(rawLine);
    if (!line) continue;

    if (RE_G91.test(line)) block("G91 incremental mode");
    if (RE_G10.test(line)) block("G10 offset/table write");
    if (RE_G92.test(line)) block("G92 offset");
    if (RE_G28_30.test(line)) block("G28/G30 home move");
    if (RE_OCALL.test(line)) block("O-word subroutine flow");
    if (RE_XEXPR.test(line)) block("non-numeric X coordinate");
    if (RE_YEXPR.test(line)) block("non-numeric Y coordinate");
    if (RE_ROTARY.test(line)) block("rotary/secondary axis words (preamble is XY-only)");
    if (RE_TCP.test(line)) block("G43.4 TCP mode");

    RE_WCS.lastIndex = 0;
    for (let m = RE_WCS.exec(line); m; m = RE_WCS.exec(line)) {
      const code = `G5${m[1]}${m[2] ?? ""}`.toUpperCase();
      wcsSeen.add(code);
      out.wcs = code;
    }
    RE_UNITS.lastIndex = 0;
    for (let m = RE_UNITS.exec(line); m; m = RE_UNITS.exec(line)) {
      out.units = `G2${m[1]}`;
    }

    RE_XNUM.lastIndex = 0;
    for (let m = RE_XNUM.exec(line); m; m = RE_XNUM.exec(line)) out.x = parseFloat(m[1]!);
    RE_YNUM.lastIndex = 0;
    for (let m = RE_YNUM.exec(line); m; m = RE_YNUM.exec(line)) out.y = parseFloat(m[1]!);

    if (nl === -1) break;
  }

  if (wcsSeen.size > 1) block(`multiple work offsets (${[...wcsSeen].join(", ")})`);
  return out;
}

/** Payload for the runFromLine emit/command (object — the arg list outgrew positions). */
export interface RflRunOptions {
  line: number;
  spindleDir: "off" | "forward" | "reverse";
  spindleSpeed: number;
  preTool: number;                 // 0 = no pre-measurement
  safeZ: boolean;
  entry: RflEntryScan | null;      // null = preamble unavailable/not needed
  /** The program the dialog showed: its path, the published preview
   *  version of the displayed text and that text's fingerprint (GET /gcode's
   *  X-Program-Source). The gateway refuses an auto_run whose program is no
   *  longer the loaded one at that version, or whose text changed on disk
   *  (Codex R16/R17 XZ-07). */
  program: { file: string; version: number; source: string };
}

/** bulkData's revision "<file>#<version>" → its parts; null for none. */
export function revisionParts(rev: string): { file: string; version: number } | null {
  const i = rev.lastIndexOf("#");
  if (i <= 0) return null;
  const tail = rev.slice(i + 1);
  const version = Number(tail);
  return /^\d+$/.test(tail) && Number.isSafeInteger(version) ? { file: rev.slice(0, i), version } : null;
}
