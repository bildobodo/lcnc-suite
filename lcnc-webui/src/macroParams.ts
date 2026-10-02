import type { MacroParam } from "./defaults";

// Pure macro-param helpers. Kept in their own side-effect-free module (only a
// type-only import) so they're unit-testable in a plain node environment —
// importing defaults.ts directly pulls in its page-lifecycle listeners which
// need `document`. Re-exported from defaults.ts for back-compat.

/** Extract unique {placeholder} names from a macro command string, in order. */
export function extractParams(command: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of command.matchAll(/\{(\w+)\}/g)) {
    const name = match[1]!;
    if (!seen.has(name)) { seen.add(name); result.push(name); }
  }
  return result;
}

/** Reconcile a macro's params with the {placeholders} in its command — in
 *  command order: keep (preserving edits to) params still referenced, add new
 *  ones, drop removed ones. Existing param objects are reused by reference, so
 *  in-progress edits to a kept param survive a command change. */
export function syncMacroParams(command: string, existing: MacroParam[]): MacroParam[] {
  const byName = new Map(existing.map(p => [p.name, p]));
  return extractParams(command).map(
    name => byName.get(name) ?? { name, label: name, default: "" },
  );
}

/** A macro file's name as the gateway accepts it (macro_files.NAME_RE). */
export const MACRO_NAME_RE = /^[a-z0-9_]{1,63}$/;
export const MACRO_BAR_MAX = 50;

/** The `macros` settings section as stored → as used. The earlier macros
 *  are kept as before (valid entries, at most 20); the `bar` key (package 5:
 *  macro files on the bar, in order) passes through where valid — a section
 *  saved before package 5 has none, and the first save from this client
 *  ADDS it next to the unchanged `macros`. */
export function mergeMacrosSection(saved: any, fb: { macros: any[]; bar?: string[] }): { macros: any[]; bar?: string[] } {
  const bar = macroBarOf(saved?.bar);
  if (!saved || !Array.isArray(saved.macros)) return bar ? { ...fb, bar } : { ...fb };
  const macros = saved.macros
    .filter((m: any) => m && typeof m.id === "string" && typeof m.name === "string" && typeof m.command === "string")
    .map((m: any) => ({
      id: m.id,
      name: m.name,
      command: m.command,
      params: Array.isArray(m.params) ? m.params : [],
    }))
    .slice(0, 20);
  return bar ? { macros, bar } : { macros };
}

/** A stored bar list kept as stored where it is valid: names only, each
 *  once, at most MACRO_BAR_MAX — undefined when there is none. */
function macroBarOf(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const n of raw) if (typeof n === "string" && MACRO_NAME_RE.test(n) && !out.includes(n)) out.push(n);
  return out.slice(0, MACRO_BAR_MAX);
}
