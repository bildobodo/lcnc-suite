// The Custom palette's contrast hint (operator P3; plan K3, Codex R21–R25
// OP-I05): the rules themeTokens.test.ts holds every AUTOMATIC palette to,
// applied to the colours the operator chose — told in Settings, never
// corrected (a deliberate Custom choice is not recoloured).
//  - a line or a box: its ratio on the scene background (3 : 1, 4.5 : 1 in
//    the high-contrast themes) and on the lit table (#e0e0e0: the table /
//    stock's top face under the scene lights, in every theme);
//  - two path LINES apart from each other (the pair rule,
//    viewer/palettePairs.ts): the custom feed, rapid and backplot against
//    each other and the theme's limit overlay.
// Tool shaft and cutter are solids, not lines: no rule.
import { ROLE_TOKEN, type ViewerPalette, type ViewerRole } from "./viewerPalette";
import { contrastRgb, okDistance, parseHex } from "./colourMath";
import { lineMinFor, PALETTE_PAIRS } from "./palettePairs";

export { parseHex };
export const LIT_TABLE = "#e0e0e0";
/** The custom roles drawn as lines. */
export const CUSTOM_LINE_ROLES = ["feed", "rapid", "backplot", "bounds", "toolpathBounds"] as const;

/** WCAG contrast ratio of two colours; null when either is unreadable. */
export function contrastRatio(a: string, b: string): number | null {
  const x = parseHex(a), y = parseHex(b);
  return x && y ? contrastRgb(x, y) : null;
}

export interface ContrastRow {
  role: string;
  /** Ratio on the scene background; null = the colour does not parse. */
  onBg: number | null;
  onTable: number | null;
  bgLow: boolean;
  tableLow: boolean;
}

export function customContrastRows(p: ViewerPalette, bg: string, highContrast: boolean): ContrastRow[] {
  const floor = highContrast ? 4.5 : 3;
  const low = (v: number | null, min: number) => v == null || v < min;
  return CUSTOM_LINE_ROLES.map(role => {
    const onBg = contrastRatio(p[role], bg), onTable = contrastRatio(p[role], LIT_TABLE);
    return { role, onBg, onTable, bgLow: low(onBg, floor), tableLow: low(onTable, 3) };
  });
}

export interface PairRow {
  a: ViewerRole;
  b: ViewerRole;
  /** OKLab distance; null = a colour does not parse. */
  normal: number | null;
  normalLow: boolean;
}

const ROLE_OF_TOKEN = Object.fromEntries(Object.entries(ROLE_TOKEN).map(([r, t]) => [t, r])) as Record<string, ViewerRole>;

/** Every pair of path LINES in the palette as drawn, held to the theme's
 *  line floor (palettePairs.lineMinFor). */
export function customPairRows(p: ViewerPalette, theme: string): PairRow[] {
  const min = lineMinFor(theme);
  return PALETTE_PAIRS.filter(q => q.kind === "line").map(q => {
    const a = ROLE_OF_TOKEN[q.a]!, b = ROLE_OF_TOKEN[q.b]!;
    const x = parseHex(p[a]), y = parseHex(p[b]);
    const normal = x && y ? okDistance(x, y) : null;
    return { a, b, normal, normalLow: normal == null || normal < min };
  });
}
