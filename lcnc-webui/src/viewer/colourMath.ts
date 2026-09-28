// Colour arithmetic for the viewer palette — ONE implementation for the
// theme-token tests (themeTokens.test.ts) and the Custom palette's hint in
// Settings (viewer/customContrast.ts): WCAG 2.x contrast, OKLab distance and
// the Machado 2009 (severity 1) dichromat simulation — linearise sRGB, apply
// the matrix, clip to [0, 1] — a heuristic regression guard, not a proof of
// accessibility. Pure.

export type RGB = [number, number, number];

/** #rgb / #rrggbb; null otherwise. */
export function parseHex(c: string | null | undefined): RGB | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((c ?? "").trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.split("").map(x => x + x).join("") : m[1]!;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const unlin = (v: number) => {
  v = Math.min(1, Math.max(0, v));
  return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
};
const luminance = (c: RGB) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);

/** WCAG 2.x contrast ratio of two colours. */
export function contrastRgb(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

export function oklab(c: RGB): RGB {
  const [r, g, b] = c.map(lin) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** Euclidean distance in OKLab. */
export function okDistance(a: RGB, b: RGB): number {
  const x = oklab(a), y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

export const DICHROMATS = ["protan", "deutan", "tritan"] as const;
export type Dichromat = typeof DICHROMATS[number];
const MACHADO: Record<Dichromat, number[][]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};

/** The colour as a dichromat of `kind` sees it (Machado 2009, severity 1). */
export function simulateDichromat(c: RGB, kind: Dichromat): RGB {
  const l = c.map(lin);
  return MACHADO[kind].map(row => unlin(row[0]! * l[0]! + row[1]! * l[1]! + row[2]! * l[2]!)) as RGB;
}

/** The smallest OKLab distance of two colours under the three simulations. */
export function worstDichromatDistance(a: RGB, b: RGB): number {
  return Math.min(...DICHROMATS.map(k => okDistance(simulateDichromat(a, k), simulateDichromat(b, k))));
}

/** OKLCH hue in degrees [0, 360) and chroma. */
export function hueChroma(c: RGB): { hue: number; chroma: number } {
  const [, a, b] = oklab(c);
  return { hue: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360, chroma: Math.hypot(a, b) };
}
