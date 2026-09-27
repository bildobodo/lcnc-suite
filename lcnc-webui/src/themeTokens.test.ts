// Every theme defines every text role (design wave D8): the colour a muted,
// state or syntax TEXT takes and the focus ring. A theme block without a role
// inherits the LIGHT value from :root — #525e6a muted text on a #0b0f14
// background — and the dark palette lives twice (the explicit
// data-theme="dark" block and the auto block under prefers-color-scheme:
// dark), which must never drift. contrast.spec measures the rendered pairs;
// this pins the blocks the measurement relies on.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PALETTE_PAIRS, PATH_ROLES, PAIR_MIN_DISTANCE } from "./viewer/palettePairs";

// node:fs, not an import: vitest empties every CSS import, `?raw` included.
const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

const VIEWER_LINES = ["--viewer-feed", "--viewer-rapid", "--viewer-backplot", "--viewer-limit", "--viewer-selection",
  "--viewer-collision", "--viewer-bounds", "--viewer-toolpath-bounds"];
/** The roles drawn ON the path (or tinting what the path hits): they must
 *  tell apart from each other by hue/lightness, not only from the scene. */
const VIEWER_PATH = ["--viewer-feed", "--viewer-rapid", "--viewer-backplot", "--viewer-limit", "--viewer-selection", "--viewer-collision"];
const ROLES = [
  "--fg-muted", "--ok-text", "--warn-text", "--danger-text", "--info-text", "--accent-text", "--focus-ring",
  "--syntax-gcode", "--syntax-mcode", "--syntax-coord", "--syntax-param", "--syntax-comment",
  ...VIEWER_LINES, "--viewer-tool", "--viewer-cutter",
];

/** The declarations of the first rule whose selector is exactly `selector`. */
function block(selector: string): Map<string, string> {
  const i = css.indexOf(`${selector} {`);
  expect(i, `style.css has a "${selector}" block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]));
}

type RGB = [number, number, number];
function hex(h: string): RGB {
  const m = /^#([0-9a-f]{6})$/i.exec(h.trim());
  expect(m, `a literal #rrggbb (cssColor reads no color-mix): ${h}`).toBeTruthy();
  const n = parseInt(m![1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
function contrast(a: RGB, b: RGB): number {
  const l = (c: RGB) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const [hi, lo] = [l(a), l(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
function oklab(c: RGB): RGB {
  const [r, g, b] = c.map(lin) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const okDistance = (a: RGB, b: RGB) => Math.hypot(...oklab(a).map((v, i) => v - oklab(b)[i]!));

const THEMES = {
  root: ":root",
  light: ':root[data-theme="light"]',
  dark: ':root[data-theme="dark"]',
  "auto-dark": "  :root:not([data-theme])",
  "hc-light": ':root[data-theme="hc-light"]',
  "hc-dark": ':root[data-theme="hc-dark"]',
};

describe("theme text roles", () => {
  for (const [name, selector] of Object.entries(THEMES)) {
    it(`${name} defines every role`, () => {
      const b = block(selector);
      expect(ROLES.filter(r => !b.has(r)), `${name} lacks`).toEqual([]);
    });
  }

  it("the auto dark block is the explicit dark block", () => {
    const auto = block(THEMES["auto-dark"]);
    const dark = block(THEMES.dark);
    expect(Object.fromEntries(auto)).toEqual(Object.fromEntries(dark));
  });

  it("the light block repeats :root's roles", () => {
    const root = block(THEMES.root);
    const light = block(THEMES.light);
    for (const r of ROLES) expect(light.get(r), r).toBe(root.get(r));
  });

  // The viewer palette checked directly (design wave D8c): WebGL lines are
  // informative graphics — ≥ 3 : 1 on the scene background (the theme's
  // --bg; ≥ 4.5 in the HC themes) AND on the lit machine: a program lies on
  // the table / stock, whose top face renders ≈ #e0e0e0 under the scene
  // lights in every theme (measured, frame metal) — the dark themes' pastel
  // lines vanished there. The path roles differ from each other by ≥ 0.12
  // in OKLab (limit vs collision, rapid vs selection are the close ones).
  // Shadowed faces (mid grey) are no reference: no line colour reaches
  // 3 : 1 on both mid grey and the background; hue, the rapid's dash and
  // the legend carry it there.
  const LIT_METAL: RGB = [224, 224, 224];
  for (const name of ["root", "dark", "hc-light", "hc-dark"] as const) {
    it(`${name}: every viewer line reads on the scene background and on the lit machine, and the path roles tell apart`, () => {
      const b = block(THEMES[name]);
      const bg = hex(b.get("--bg")!);
      const floor = name.startsWith("hc") ? 4.5 : 3;
      for (const r of VIEWER_LINES) {
        expect(contrast(hex(b.get(r)!), bg), `${name} ${r} on --bg`).toBeGreaterThanOrEqual(floor);
        expect(contrast(hex(b.get(r)!), LIT_METAL), `${name} ${r} on the lit machine`).toBeGreaterThanOrEqual(3);
      }
      for (let i = 0; i < VIEWER_PATH.length; i++) {
        for (let j = i + 1; j < VIEWER_PATH.length; j++) {
          const [a, c] = [VIEWER_PATH[i]!, VIEWER_PATH[j]!];
          expect(okDistance(hex(b.get(a)!), hex(b.get(c)!)), `${name} ${a} vs ${c}`).toBeGreaterThanOrEqual(0.12);
        }
      }
    });
  }

  // The pair table (viewer contrast plan, R1): a colour-separated pair keeps
  // PAIR_MIN_DISTANCE under normal vision AND under simulated protan-,
  // deutan- and tritanopia; every pair keeps it under normal vision; a pair
  // without colour separation names the form cue that carries it. The
  // simulation: linearise sRGB, apply Machado 2009 (severity 1), clip to
  // [0, 1], then OKLab — a heuristic regression guard, not a proof of
  // accessibility (the form cues are what WCAG 1.4.1 asks for).
  const MACHADO: Record<string, number[][]> = {
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
  };
  const unlin = (v: number) => { v = Math.min(1, Math.max(0, v)); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055); };
  const simulate = (c: RGB, kind: string): RGB => {
    if (kind === "normal") return c;
    const l = c.map(lin);
    return MACHADO[kind]!.map(row => unlin(row[0]! * l[0]! + row[1]! * l[1]! + row[2]! * l[2]!)) as RGB;
  };
  const VIEWS = ["normal", "protan", "deutan", "tritan"];
  it("the pair table names every pair of the six path roles once", () => {
    const named = PALETTE_PAIRS.map(p => [p.a, p.b].sort().join(" / "));
    expect(new Set(named).size, "no pair twice").toBe(named.length);
    for (let i = 0; i < PATH_ROLES.length; i++) {
      for (let j = i + 1; j < PATH_ROLES.length; j++) {
        expect(named, "every path pair").toContain([PATH_ROLES[i], PATH_ROLES[j]].sort().join(" / "));
      }
    }
    expect(PALETTE_PAIRS.filter(p => !p.colour && p.cues.length === 0), "a pair without colour separation names its cue").toEqual([]);
  });
  for (const name of ["root", "dark", "auto-dark", "hc-light", "hc-dark"] as const) {
    it(`${name}: every pair of the table tells apart — the colour-separated ones for colour-blind eyes too`, () => {
      const b = block(THEMES[name]);
      const bad: string[] = [];
      for (const p of PALETTE_PAIRS) {
        for (const view of p.colour ? VIEWS : ["normal"]) {
          const d = okDistance(simulate(hex(b.get(p.a)!), view), simulate(hex(b.get(p.b)!), view));
          if (d < PAIR_MIN_DISTANCE) bad.push(`${p.a} / ${p.b} ${view} ${d.toFixed(3)}`);
        }
      }
      expect(bad, `${name}: pairs under ${PAIR_MIN_DISTANCE}`).toEqual([]);
    });
  }

  it("no rule mutes text through the retired --mix-muted", () => {
    expect(css).not.toMatch(/--mix-muted/);
  });
});
