// The Custom palette's contrast hint (operator P3; plan K3, Codex R21–R25
// OP-I05): the rules themeTokens.test.ts holds every AUTOMATIC palette to,
// applied to the colours the operator chose — told in Settings, never
// corrected (a deliberate Custom choice is not recoloured).
//  - a line role: ≥ 3 : 1 on the scene background (4.5 : 1 in the high-
//    contrast themes) AND ≥ 3 : 1 on the lit table (#e0e0e0: the table /
//    stock's top face under the scene lights, in every theme).
// Tool shaft and cutter are solids, not lines: no rule.
import type { ViewerPalette } from "./viewerPalette";

type RGB = [number, number, number];
export const LIT_TABLE = "#e0e0e0";
/** The custom roles drawn as lines. */
export const CUSTOM_LINE_ROLES = ["feed", "rapid", "backplot", "bounds", "toolpathBounds"] as const;

/** #rgb / #rrggbb (the pickers and the theme tokens); null otherwise. */
export function parseHex(c: string | null | undefined): RGB | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((c ?? "").trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.split("").map(x => x + x).join("") : m[1]!;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (c: RGB) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
/** WCAG contrast ratio of two colours; null when either is unreadable. */
export function contrastRatio(a: string, b: string): number | null {
  const x = parseHex(a), y = parseHex(b);
  if (!x || !y) return null;
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (hi! + 0.05) / (lo! + 0.05);
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
