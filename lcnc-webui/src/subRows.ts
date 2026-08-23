// Pure row model for the inline subroutine indent view (W5).
//
// While a marked o-call span executes, GcodePanel inserts the called
// file's lines directly below the call line — the operator's design:
// execution reads top-to-bottom in place, loops inside the sub jump
// backward honestly, and the main file never leaves the screen. The
// virtual-scroll math indexes ROWS; these helpers are the single mapping
// between row indices and (file, line) so the scroll/highlight/click
// logic stays exact. All 1-based lineNum, 0-based row indices.

export interface SubExpansion {
  /** 1-based main-file line carrying the `o<name> call`. */
  callLine: number;
  name: string;
  /** The sub file's lines, verbatim (no trailing empty line). */
  lines: string[];
}

export interface RowRef {
  kind: "main" | "sub";
  /** 1-based line number within its own file. */
  lineNum: number;
}

/** Expansions beyond this are not shown — the indent view is for the
 *  operator-scale subs our markers target, not arbitrary files. */
export const SUB_EXPANSION_MAX_LINES = 500;

/** Sub source → verbatim lines, dropping only the trailing empty split. */
export function splitSubLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The expansion gate (W5): the call line's comment-stripped text must BE
 *  an `o<name> call` of exactly this span's name — which makes remap
 *  wrappers (trigger is `g53.3 …`) and nested spans (the executing call
 *  lives in the OUTER sub's file) never expand, by construction. */
export function expansionAllowed(
  callLineText: string, name: string, subLineCount: number,
): boolean {
  if (subLineCount === 0 || subLineCount > SUB_EXPANSION_MAX_LINES) return false;
  const src = callLineText.replace(/\([^)]*\)/g, "").replace(/;.*$/, "");
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*o<${esc}>\\s*call\\b`, "i").test(src);
}

export function totalRows(mainCount: number, exp: SubExpansion | null): number {
  return mainCount + (exp ? exp.lines.length : 0);
}

/** Row index → which file/line it renders. */
export function rowAt(row: number, exp: SubExpansion | null): RowRef {
  if (!exp || row < exp.callLine) return { kind: "main", lineNum: row + 1 };
  const sub = row - exp.callLine;
  if (sub < exp.lines.length) return { kind: "sub", lineNum: sub + 1 };
  return { kind: "main", lineNum: row - exp.lines.length + 1 };
}

/** 0-based row of a main-file line. */
export function rowForMain(lineNum: number, exp: SubExpansion | null): number {
  return lineNum - 1 + (exp && lineNum > exp.callLine ? exp.lines.length : 0);
}

/** 0-based row of a sub-file line (call only with an active expansion). */
export function rowForSub(lineNum: number, exp: SubExpansion): number {
  return exp.callLine - 1 + lineNum;
}
