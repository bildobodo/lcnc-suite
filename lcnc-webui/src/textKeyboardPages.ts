// Character pages of the on-screen text keyboard (WP8, UI-15b) — pure data
// so the coverage contract is a unit test: the union of every page (with
// Shift) covers all 95 printable ASCII characters plus ä ö ü ß Ä Ö Ü.
//
// Every page is exactly CELLS keys (empty cells pad) so a page switch never
// changes the strip's height: landscape flows 5 rows × 6 columns, portrait
// 6 rows × 5 columns (5 × 44 px + 4 × 4 px = 236 px inside the 280 px
// column, see App.vue's portrait strip).

export const CELLS = 30;
export type KeyPage = "code" | "abc" | "123" | "sym";
export const PAGE_ORDER: readonly KeyPage[] = ["code", "abc", "123", "sym"];
/** Page-switch labels: ≤ 4 characters fit a 44 px cell at --fs-sm. */
export const PAGE_LABELS: Record<KeyPage, string> = { code: "Code", abc: "ABC", "123": "123", sym: "#+=" };

/** Digits in numpad order, then the two most common code characters. */
const CODE_DIGITS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ".", "-"];
/** Command letters first; the axes come next (machine order); the fill
 *  keeps the letter block at 14 on any axis count (≤ 9 axes). */
const CODE_COMMANDS = ["G", "M", "T", "F", "S"];
const CODE_FILL = ["I", "J", "K", "P", "R", "Q", "H", "D", "L", "N", "O", "E"];
const CODE_PUNCT = [";", "(", ")", "#"];
const LETTER_SLOTS = CELLS - CODE_DIGITS.length - CODE_COMMANDS.length - CODE_PUNCT.length; // 9

const ABC_LOWER = [..."abcdefghijklmnopqrstuvwxyz", "ä", "ö", "ü", "ß"];
const ABC_UPPER = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "Ä", "Ö", "Ü", "ß"];
const NUM_PAGE = [..."0123456789", ".", "-", "+", "*", "/", "=", "(", ")", "[", "]", "<", ">", "#"];
const SYM_PAGE = ["!", "\"", "$", "%", "&", "'", ",", ":", ";", "?", "@", "\\", "^", "_", "`", "{", "|", "}", "~"];

function pad(keys: string[]): (string | null)[] {
  const out: (string | null)[] = keys.slice(0, CELLS);
  while (out.length < CELLS) out.push(null);
  return out;
}

/** The Code page for a machine's axis letters: G1 X20 Y10 F1000 without a
 *  page switch on any machine. Letters beyond the axes come from CODE_FILL
 *  in order until the block is full. */
export function codePage(axes: readonly string[]): (string | null)[] {
  const letters: string[] = [];
  for (const a of axes) {
    const l = a.toUpperCase();
    if (l.length === 1 && !letters.includes(l) && !CODE_COMMANDS.includes(l)) letters.push(l);
  }
  for (const f of CODE_FILL) {
    if (letters.length >= LETTER_SLOTS) break;
    if (!letters.includes(f)) letters.push(f);
  }
  return pad([...CODE_DIGITS, ...CODE_COMMANDS, ...letters.slice(0, LETTER_SLOTS), ...CODE_PUNCT]);
}

export function abcPage(shift: boolean): (string | null)[] {
  return pad(shift ? ABC_UPPER : ABC_LOWER);
}

export function numPage(): (string | null)[] { return pad(NUM_PAGE); }
export function symPage(): (string | null)[] { return pad(SYM_PAGE); }

export function pageKeys(page: KeyPage, axes: readonly string[], shift: boolean): (string | null)[] {
  switch (page) {
    case "code": return codePage(axes);
    case "abc": return abcPage(shift);
    case "123": return numPage();
    case "sym": return symPage();
  }
}

/** Every character reachable through the pages (both shift states), plus
 *  the Space key every layout has. */
export function reachableChars(axes: readonly string[]): Set<string> {
  const out = new Set<string>([" "]);
  for (const page of PAGE_ORDER) for (const shift of [false, true]) {
    for (const k of pageKeys(page, axes, shift)) if (k) out.add(k);
  }
  return out;
}

/** The 95 printable ASCII characters (0x20–0x7E). */
export function printableAscii(): string[] {
  const out: string[] = [];
  for (let c = 0x20; c <= 0x7e; c++) out.push(String.fromCharCode(c));
  return out;
}
export const UMLAUTS = ["ä", "ö", "ü", "ß", "Ä", "Ö", "Ü"];
