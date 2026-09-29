// The Custom palette's contrast hint (operator P3; plan K3, Codex R21–R25
// OP-I05): the rules themeTokens.test.ts holds every AUTOMATIC palette to,
// applied to the colours the operator chose — told in Settings, never
// corrected (a deliberate Custom choice is not recoloured).
//  - a line: its ratio on the scene background (3 : 1, 4.5 : 1 in the
//    high-contrast themes) and on the machine: the grey-ladder models'
//    path-carrying surfaces as the viewer renders them (MODEL_SURFACES,
//    MODEL_MIN — operator 2026-09-29: the paths stand in front of the
//    machine by their lightness);
//  - a box: two-tone (its colour and the light dashes, boxLines.ts) — it
//    reads where either tone does;
//  - two path LINES apart from each other (the pair rule,
//    viewer/palettePairs.ts): the custom feed, rapid and backplot against
//    each other and the theme's limit overlay.
// Tool shaft and cutter are solids, not lines: no rule.
import { ROLE_TOKEN, type ViewerPalette, type ViewerRole } from "./viewerPalette";
import { contrastRgb, okDistance, parseHex } from "./colourMath";
import { lineMinFor, PALETTE_PAIRS } from "./palettePairs";

export { parseHex };
/** The grey-ladder models' path-carrying surfaces as rendered under the
 *  viewer's lights (XYZAC renders, 2026-09-29): the stock's top face and the
 *  faceplate's. A path line lies on them. */
export const MODEL_SURFACES = ["#5d6165", "#53585b"] as const;
/** A path line against those surfaces — the operator-chosen palette's own
 *  floor (its weakest role, the rapid, holds 1.88 : 1), a regression value. */
export const MODEL_MIN = 1.8;
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
  /** The weakest ratio against the model's surfaces. */
  onModel: number | null;
  bgLow: boolean;
  modelLow: boolean;
}

export function customContrastRows(p: ViewerPalette, bg: string, highContrast: boolean): ContrastRow[] {
  const floor = highContrast ? 4.5 : 3;
  const low = (v: number | null, min: number) => v == null || v < min;
  const best = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));
  const worst = (vs: (number | null)[]) => (vs.some(v => v == null) ? null : Math.min(...(vs as number[])));
  return CUSTOM_LINE_ROLES.map(role => {
    const box = role === "bounds" || role === "toolpathBounds";
    // a box reads where either of its two tones does
    const on = (surface: string) => {
      const r = contrastRatio(p[role], surface);
      return box ? best(r, contrastRatio(p.boundsAlt, surface)) : r;
    };
    const onBg = on(bg), onModel = worst(MODEL_SURFACES.map(on));
    return { role, onBg, onModel, bgLow: low(onBg, floor), modelLow: low(onModel, MODEL_MIN) };
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
