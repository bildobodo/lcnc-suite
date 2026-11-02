// Tool-change lines from the program TEXT (2026-09-12). The wire's
// `tool_change_lines` carries canon-executed M6 only: an M600 / M601 remap
// (the suite's own measure-and-change macros) is preview-skipped and
// contributes no canon event, so the timeline showed no mark and no
// countdown for "T13 M600" (operator-caught on perfmatrix). The text says
// where they are: a line with M6 / M06 / M600 / M601 outside comments and
// names, its tool number from the T word on that line or the last T word
// before it (0 = none seen, or a T whose value the scan does not fully read).
// The line is read as LinuxCNC reads it: comments out, then every space
// ("T1 3" is T13), then the names — a name in angle brackets (a named
// parameter, an O-word's name) is an identifier, never a word (#<m6>,
// o<m600_x> — Codex R247 FH-06); a word may follow a number without a space
// (T13M600, N20M6). A T word is recognized apart from its value (Codex R249
// FH-07): every new one drops the T before it, and only a plain number (a
// plus sign, a decimal point with zeros) names the tool — a sign, a function
// or an expression (T-3, TABS[-7], T+#<n>, T[7]) is unknown. The caller
// unions this with the wire's list by line (the wire's tool number wins
// where both exist). Pure.
export function toolChangeLinesFromText(text: string | null | undefined): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!text) return out;
  let lastT = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const src = lines[i]!.replace(/\([^)]*\)/g, "").replace(/;.*$/, "")
      .replace(/\s+/g, "").replace(/<[^>]*>/g, "").toLowerCase();
    const t = T_WORD.exec(src);
    if (t) lastT = toolNumber(src.slice(t.index + 1));
    if (M_WORD.test(src)) out.push([i + 1, lastT]);
  }
  return out;
}

/** A T word: a T that ends no name (ATAN, SQRT, EXISTS, GT, LT) and begins
 *  no TAN function. */
const T_WORD = /(?<![a-z_])t(?!an\[)/;
/** M6 / M06 / M600 / M601, a word of its own. */
const M_WORD = /(?<![a-z_])m0*(?:6|600|601)(?![0-9.])/;

/** The tool a T word's value names: a plain number, read whole up to the
 *  next word; anything else is unknown (0). */
function toolNumber(value: string): number {
  const m = /^\+?(\d+)(?:\.0*)?(?=[a-z]|$)/.exec(value);
  return m ? parseInt(m[1]!, 10) : 0;
}
