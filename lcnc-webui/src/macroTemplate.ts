// The text a NEW macro file starts with (the Macros tab's New): a valid
// header and the entry rule (Codex VP69-04 — M73 on its own line, then the
// units and modes), so a fresh file is runnable as it stands. Pure.

/** "face_top" → "Face top": a readable title from a file name. */
export function titleFromName(name: string): string {
  const t = name.replace(/_+/g, " ").trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : name;
}

export function newMacroText(name: string): string {
  return `(MACRO ${titleFromName(name)})
(Describe what the macro does: this line is free text.)
o<${name}> sub
  M73
  G21 G90 G94
  ; your code here - a retract should only ever lift Z
o<${name}> endsub
`;
}
