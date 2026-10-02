// New macro files and "Convert to file" for the earlier macros (package 5,
// stage C). Pure: the Macros tab writes what these return through the
// gateway, which parses it (the ONE parser) — nothing here validates a
// header beyond what it writes itself.

import type { MacroDef } from "./defaults";
import type { MacroUnit } from "./lcncApi";

export const UNIT_KINDS: MacroUnit[] = ["none", "length", "feed", "angle", "rpm", "time", "count"];

/** A title from a file name: "face_top" → "Face top". */
export function titleFromName(name: string): string {
  const t = name.replace(/_+/g, " ").trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : name;
}

/** A new macro file: the header, the entry lines (M73, then the modes the
 *  values usually need), an empty body — a start the operator fills in. */
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

/** A file name from an earlier macro's button label: lower case, digits and
 *  _ only, at most 63 — the operator can change it. */
export function nameFromLabel(label: string): string {
  const n = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 63);
  return n || "macro";
}

/** A header key from a placeholder name (`{Depth}` → `depth`, `{2x}` → `p2x`). */
function keyOf(name: string, taken: Set<string>): string {
  let k = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!/^[a-z]/.test(k)) k = `p${k}`;
  k = k.slice(0, 32);
  let out = k, i = 2;
  while (taken.has(out)) out = `${k.slice(0, 30)}${i++}`;
  taken.add(out);
  return out;
}

/** What the operator chose for one placeholder in the convert dialog. */
export interface ConvertParam {
  name: string;          // the placeholder in the earlier command
  label: string;
  unit: MacroUnit;
  defaultText: string;   // as entered — must be a finite number to convert
}

/** The placeholders whose default is not a finite number: named in the
 *  dialog, never converted silently (Codex R69). */
export function nonNumericDefaults(params: ConvertParam[]): string[] {
  return params.filter(p => !Number.isFinite(Number(p.defaultText)) || p.defaultText.trim() === "").map(p => p.name);
}

/** The earlier macro as a macro file, or {error}. The command becomes the
 *  body with each `{name}` replaced by its position `#n`; the entry rule
 *  (M73, then G21/G20, G94, G97 as the parameter kinds need) is written. */
export function convertToFile(macro: MacroDef, name: string, units: "mm" | "inch", params: ConvertParam[]): { text: string } | { error: string } {
  const bad = nonNumericDefaults(params);
  if (bad.length) return { error: `Enter a number for ${bad.join(", ")}` };
  const taken = new Set<string>();
  const keyed = params.map((p, i) => ({ ...p, n: i + 1, key: keyOf(p.name, taken) }));
  const kinds = new Set(keyed.map(p => p.unit));
  let body = macro.command;
  for (const p of keyed) body = body.split(`{${p.name}}`).join(`#${p.n}`);
  const modes = ["G90"];
  if (kinds.has("length") || kinds.has("feed")) modes.unshift(units === "mm" ? "G21" : "G20");
  if (kinds.has("feed")) modes.push("G94");
  if (kinds.has("rpm")) modes.push("G97");
  const header = [`(MACRO ${macro.name.slice(0, 40)})`];
  if (kinds.has("length") || kinds.has("feed")) header.push(`(UNITS ${units})`);
  for (const p of keyed) {
    const label = (p.label || p.name).replace(/"/g, "'").slice(0, 40);
    header.push(`(PARAM ${p.n} ${p.key} "${label}" ${p.unit} ${Number(p.defaultText)})`);
  }
  header.push(`(Converted from the earlier macro "${macro.name.replace(/[()]/g, "")}".)`);
  return { text: `${header.join("\n")}
o<${name}> sub
  M73
  ${modes.join(" ")}
  ${body}
o<${name}> endsub
` };
}
