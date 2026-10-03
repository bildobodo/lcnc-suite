// What the G-code reference shows (pure): the rows for a search / group /
// sort, the "Active now" filter, and which entries a code word opens AT —
// the Safety strip's active codes and a code tapped in the program
// (operator 2026-10-03, variant B: the codes block opens the reference on
// the active codes; a code jumps to its entry instead of searching for it).
import type { GcodeEntry } from "./gcodeReference";

/** The group filter's value for "Active now" (never a group name). */
export const ACTIVE_FILTER = "__active";

/** LinuxCNC's active G-codes (STAT.gcodes: [sequence, code × 10 …], −1 =
 *  none) as words in the controller's order: 911 → "G91.1", 800 → "G80". */
export function gCodeWords(codes: readonly number[] | null | undefined): string[] {
  if (!Array.isArray(codes)) return [];
  return codes.slice(1).filter(c => c !== -1).map(c => `G${(c / 10).toFixed(c % 10 ? 1 : 0)}`);
}

/** LinuxCNC's active M-codes (STAT.mcodes: [sequence, code …], −1 = none). */
export function mCodeWords(codes: readonly number[] | null | undefined): string[] {
  if (!Array.isArray(codes)) return [];
  return codes.slice(1).filter(c => c !== -1).map(c => `M${c}`);
}

/** A code word as the reference spells it: upper case, no leading zeros
 *  ("g01" → "G1", "M03" → "M3", "G00" → "G0"). */
export function normaliseCode(word: string): string {
  return word.trim().toUpperCase().replace(/^([GM])0+(?=\d)/, "$1");
}

/** The entries a code word opens AT: its own entry, else every form it
 *  heads ("G10" → G10 L1, L2, L10, L11, L20; "G38" → G38.2 … G38.5);
 *  empty when the reference has none. */
export function refTargets(entries: readonly GcodeEntry[], word: string): string[] {
  const code = normaliseCode(word);
  if (!code) return [];
  if (entries.some(e => e.code === code)) return [code];
  return entries.filter(e => e.code.startsWith(code + " ") || e.code.startsWith(code + ".")).map(e => e.code);
}

/** Natural order: G2 before G10, G10 L2 before G10 L10. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

export interface RefQuery {
  search: string;
  /** "" = all groups, ACTIVE_FILTER = the active codes, else a group name. */
  group: string;
  /** The active code words. */
  active: readonly string[];
  sortKey: "code" | "name";
  asc: boolean;
}

/** The rows the reference shows, sorted naturally. "Active now" lists the
 *  active codes the reference knows (a search narrows it further). */
export function referenceRows(entries: readonly GcodeEntry[], q: RefQuery): GcodeEntry[] {
  let rows = [...entries];
  if (q.group === ACTIVE_FILTER) {
    const active = new Set(q.active);
    rows = rows.filter(e => active.has(e.code));
  } else if (q.group) {
    rows = rows.filter(e => e.group === q.group);
  }
  const s = q.search.trim().toLowerCase();
  if (s) {
    rows = rows.filter(e => e.code.toLowerCase().includes(s) || e.name.toLowerCase().includes(s)
      || e.desc.toLowerCase().includes(s));
  }
  const dir = q.asc ? 1 : -1;
  return rows.sort((a, b) => naturalCompare(a[q.sortKey], b[q.sortKey]) * dir);
}

/** Active codes the reference has no entry for ("G8" — said, never hidden). */
export function unknownActive(entries: readonly GcodeEntry[], active: readonly string[]): string[] {
  const known = new Set(entries.map(e => e.code));
  return active.filter(c => !known.has(c));
}
