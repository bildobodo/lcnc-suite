// The `macros` settings section's pure helpers (package 5): kept in their
// own side-effect-free module so they're unit-testable in a plain node
// environment — importing defaults.ts pulls in page-lifecycle listeners.

/** A macro file's name as the gateway accepts it (macro_files.NAME_RE). */
export const MACRO_NAME_RE = /^[a-z0-9_]{1,63}$/;
export const MACRO_BAR_MAX = 50;

/** The machine's `macros` settings section as stored → as used: the
 *  earlier macros' `macros` list exactly as stored — no longer used (dropped
 *  2026-10-02) and never rewritten. The macro bar is a device's own section
 *  since the settings split (`macroBar`, operator OP3). */
export function mergeMacrosSection(saved: any, fb: { macros: unknown[] }): { macros: unknown[] } {
  return { macros: saved && Array.isArray(saved.macros) ? saved.macros : fb.macros };
}

/** A stored bar list kept as stored where it is valid: names only, each
 *  once, at most MACRO_BAR_MAX — undefined when there is none. */
export function macroBarOf(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const n of raw) if (typeof n === "string" && MACRO_NAME_RE.test(n) && !out.includes(n)) out.push(n);
  return out.slice(0, MACRO_BAR_MAX);
}
