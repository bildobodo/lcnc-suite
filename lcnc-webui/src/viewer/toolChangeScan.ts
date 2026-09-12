// Tool-change lines from the program TEXT (2026-09-12). The wire's
// `tool_change_lines` carries canon-executed M6 only: an M600 / M601 remap
// (the suite's own measure-and-change macros) is preview-skipped and
// contributes no canon event, so the timeline showed no mark and no
// countdown for "T13 M600" (operator-caught on perfmatrix). The text says
// where they are: a line with M6 / M06 / M600 / M601 outside comments, its
// tool number from the T word on that line or the last T word before it
// (0 = none seen). The caller unions this with the wire's list by line
// (the wire's tool number wins where both exist). Pure.
export function toolChangeLinesFromText(text: string | null | undefined): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!text) return out;
  let lastT = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const src = lines[i]!.replace(/\([^)]*\)/g, "").replace(/;.*$/, "");
    const tm = /(?:^|[^a-z_<])t\s*(\d+)(?![0-9.])/i.exec(src);
    if (tm) lastT = parseInt(tm[1]!, 10);
    if (/(?:^|[^a-z0-9.])m\s*0*(?:6|600|601)(?![0-9.])/i.test(src)) out.push([i + 1, lastT]);
  }
  return out;
}
