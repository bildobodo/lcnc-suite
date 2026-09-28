// The Custom palette's contrast hint (operator P3; plan K3, Codex R21–R25
// OP-I05): the rules themeTokens.test.ts holds every AUTOMATIC palette to,
// applied to the colours the operator chose — told in Settings, never
// corrected (a deliberate Custom choice is not recoloured).
//  - a line role: ≥ 3 : 1 on the scene background (4.5 : 1 in the high-
//    contrast themes) AND ≥ 3 : 1 on the lit table (#e0e0e0: the table /
//    stock's top face under the scene lights, in every theme);
//  - a box (machine / toolpath bounds, fixed palette P2): its core OR the
//    theme's dark casing on the background and on the table, and the core
//    on the casing (the same floor) — three comparisons, each told with its
//    own value (Codex R31 VP-I04: a core lost on its casing used to mark the
//    passing background and table values "low");
//  - two path LINES apart from each other (the fixed palette's pair rule,
//    viewer/palettePairs.ts, operator 2026-09-28): the custom feed, rapid
//    and backplot against each other and the theme's limit overlay —
//    normal vision and the dichromat simulations told apart, a pair a
//    named cue carries (the dashed rapid) named with it.
// Tool shaft and cutter are solids, not lines: no rule.
import { ROLE_TOKEN, type ViewerPalette, type ViewerRole } from "./viewerPalette";
import { contrastRgb, okDistance, parseHex, worstDichromatDistance } from "./colourMath";
import { CVD_MIN, LINE_MIN_NORMAL, LINE_MIN_NORMAL_HC, PALETTE_PAIRS, type PairCue } from "./palettePairs";

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
  /** A box's core on its casing (Codex R31 VP-I04: its own comparison, told
   *  with its own value); null for a line, which has no casing. */
  onCasing: number | null;
  bgLow: boolean;
  tableLow: boolean;
  casingLow: boolean;
}

export function customContrastRows(p: ViewerPalette, bg: string, highContrast: boolean): ContrastRow[] {
  const floor = highContrast ? 4.5 : 3;
  const low = (v: number | null, min: number) => v == null || v < min;
  const best = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));
  return CUSTOM_LINE_ROLES.map(role => {
    let onBg = contrastRatio(p[role], bg), onTable = contrastRatio(p[role], LIT_TABLE);
    if (role === "bounds" || role === "toolpathBounds") {
      const onCasing = contrastRatio(p[role], p.boundsCasing);
      onBg = best(onBg, contrastRatio(p.boundsCasing, bg));
      onTable = best(onTable, contrastRatio(p.boundsCasing, LIT_TABLE));
      return { role, onBg, onTable, onCasing, bgLow: low(onBg, floor), tableLow: low(onTable, 3), casingLow: low(onCasing, floor) };
    }
    return { role, onBg, onTable, onCasing: null, bgLow: low(onBg, floor), tableLow: low(onTable, 3), casingLow: false };
  });
}

export interface PairRow {
  a: ViewerRole;
  b: ViewerRole;
  /** OKLab distance under normal vision; null = a colour does not parse. */
  normal: number | null;
  /** The smallest under the three dichromat simulations. */
  cvd: number | null;
  normalLow: boolean;
  /** Under CVD_MIN where no cue carries the pair. */
  cvdLow: boolean;
  /** The cue that carries the pair for colour-blind eyes, when the rule
   *  spares it the simulation (the dashed rapid). */
  cue: PairCue | null;
}

const ROLE_OF_TOKEN = Object.fromEntries(Object.entries(ROLE_TOKEN).map(([r, t]) => [t, r])) as Record<string, ViewerRole>;

/** Every pair of path LINES in the palette as drawn. */
export function customPairRows(p: ViewerPalette, highContrast: boolean): PairRow[] {
  const min = highContrast ? LINE_MIN_NORMAL_HC : LINE_MIN_NORMAL;
  return PALETTE_PAIRS.filter(q => q.kind === "line").map(q => {
    const a = ROLE_OF_TOKEN[q.a]!, b = ROLE_OF_TOKEN[q.b]!;
    const x = parseHex(p[a]), y = parseHex(p[b]);
    const normal = x && y ? okDistance(x, y) : null;
    const cvd = x && y ? worstDichromatDistance(x, y) : null;
    return { a, b, normal, cvd, normalLow: normal == null || normal < min,
      cvdLow: q.cvd && (cvd == null || cvd < CVD_MIN), cue: q.cvd ? null : q.cues[0] ?? null };
  });
}
