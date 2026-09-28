// Every theme defines every text role (design wave D8): the colour a muted,
// state or syntax TEXT takes and the focus ring. A theme block without a role
// inherits the LIGHT value from :root — #525e6a muted text on a #0b0f14
// background — and the dark palette lives twice (the explicit
// data-theme="dark" block and the auto block under prefers-color-scheme:
// dark), which must never drift. contrast.spec measures the rendered pairs;
// this pins the blocks the measurement relies on.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PALETTE_PAIRS, PATH_ROLES, LINE_MIN_NORMAL, LINE_MIN_NORMAL_HC, CVD_MIN, OBJECT_MIN_NORMAL } from "./viewer/palettePairs";
import { contrastRgb as contrast, okDistance, simulateDichromat, DICHROMATS, hueChroma, type RGB } from "./viewer/colourMath";

// node:fs, not an import: vitest empties every CSS import, `?raw` included.
const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

const VIEWER_LINES = ["--viewer-feed", "--viewer-rapid", "--viewer-backplot", "--viewer-limit",
  "--viewer-collision", "--viewer-reach",
  // The tilted work plane's opaque edge (viewer contrast plan, V4).
  "--viewer-plane-active", "--viewer-plane-defined", "--viewer-plane-stale"];
/** The roles drawn ON the path (or tinting what the path hits): they must
 *  tell apart from each other by hue/lightness, not only from the scene. */
const VIEWER_PATH = ["--viewer-feed", "--viewer-rapid", "--viewer-backplot", "--viewer-limit", "--viewer-collision"];
const ROLES = [
  "--fg-muted", "--ok-text", "--warn-text", "--danger-text", "--info-text", "--accent-text", "--focus-ring",
  "--syntax-gcode", "--syntax-mcode", "--syntax-coord", "--syntax-param", "--syntax-comment",
  ...VIEWER_LINES, "--viewer-bounds", "--viewer-toolpath-bounds", "--viewer-bounds-casing", "--viewer-tool", "--viewer-cutter",
];

/** The declarations of the first rule whose selector is exactly `selector`. */
function block(selector: string): Map<string, string> {
  const i = css.indexOf(`${selector} {`);
  expect(i, `style.css has a "${selector}" block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]));
}

function hex(h: string): RGB {
  const m = /^#([0-9a-f]{6})$/i.exec(h.trim());
  expect(m, `a literal #rrggbb (cssColor reads no color-mix): ${h}`).toBeTruthy();
  const n = parseInt(m![1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

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
  // in OKLab (limit vs collision is the close one); the LINE pairs by far
  // more (the pair table below).
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

  // The pair table (viewer/palettePairs.ts — fixed palette, operator
  // 2026-09-28, Codex R29/R30): two LINES keep LINE_MIN_NORMAL under normal
  // vision (the HC themes LINE_MIN_NORMAL_HC) and CVD_MIN under each
  // simulated dichromacy unless a named cue carries them there; a line
  // against a body and two objects keep OBJECT_MIN_NORMAL.
  it("the pair table names every pair of the path roles once, and every exception its cue", () => {
    const named = PALETTE_PAIRS.map(p => [p.a, p.b].sort().join(" / "));
    expect(new Set(named).size, "no pair twice").toBe(named.length);
    for (let i = 0; i < PATH_ROLES.length; i++) {
      for (let j = i + 1; j < PATH_ROLES.length; j++) {
        expect(named, "every path pair").toContain([PATH_ROLES[i], PATH_ROLES[j]].sort().join(" / "));
      }
    }
    expect(PALETTE_PAIRS.filter(p => !p.cvd && p.cues.length === 0), "a pair spared the simulation names its cue").toEqual([]);
    expect(PALETTE_PAIRS.filter(p => p.kind === "line" && !p.cvd && !p.cueLimit), "and where that cue fails").toEqual([]);
    expect(PALETTE_PAIRS.filter(p => p.kind === "form" && p.cues.length < 2), "a pair told apart by form alone names two cues").toEqual([]);
  });
  for (const name of ["root", "dark", "auto-dark", "hc-light", "hc-dark"] as const) {
    it(`${name}: the lines tell apart from each other — for colour-blind eyes too — and from the bodies and objects`, () => {
      const b = block(THEMES[name]);
      const bad: string[] = [];
      const lineMin = name.startsWith("hc") ? LINE_MIN_NORMAL_HC : LINE_MIN_NORMAL;
      for (const p of PALETTE_PAIRS) {
        const [x, y] = [hex(b.get(p.a)!), hex(b.get(p.b)!)];
        if (p.kind === "form") continue;   // told apart by form alone, by design
        const min = p.kind === "line" ? lineMin : OBJECT_MIN_NORMAL;
        const d = okDistance(x, y);
        if (d < min) bad.push(`${p.a} / ${p.b} normal ${d.toFixed(3)} < ${min}`);
        if (!p.cvd) continue;
        for (const k of DICHROMATS) {
          const dk = okDistance(simulateDichromat(x, k), simulateDichromat(y, k));
          if (dk < CVD_MIN) bad.push(`${p.a} / ${p.b} ${k} ${dk.toFixed(3)} < ${CVD_MIN}`);
        }
      }
      expect(bad, name).toEqual([]);
    });
  }

  // ONE colour per role whatever the theme (operator 2026-09-28: "wenn beim
  // Theme-Wechsel plötzlich andere Farben vorhanden sind" confuses): light,
  // dark and auto-dark carry the same value for every viewer role.
  const FIXED_ROLES = [...PATH_ROLES, "--viewer-tool", "--viewer-cutter",
    "--viewer-plane-active", "--viewer-plane-defined", "--viewer-plane-stale",
    "--viewer-bounds", "--viewer-toolpath-bounds", "--viewer-bounds-casing", "--viewer-reach"];
  it("light, dark and auto-dark draw every viewer role in the same colour", () => {
    const root = block(THEMES.root);
    for (const name of ["light", "dark", "auto-dark"] as const) {
      const b = block(THEMES[name]);
      for (const r of FIXED_ROLES) expect(b.get(r), `${name} ${r}`).toBe(root.get(r));
    }
  });
  // The two boxes (fixed palette P2): a light core on a dark casing — the
  // core OR the casing reads on the background and on the lit table, and
  // the core on its casing; one pair for every theme. Their contrast rule
  // is the pair's, not a lone line's (a light core alone is 1.9 : 1 on white).
  for (const name of ["root", "dark", "auto-dark", "hc-light", "hc-dark"] as const) {
    it(`${name}: the boxes' core or casing reads on the background and the lit table, the core on its casing`, () => {
      const b = block(THEMES[name]);
      const bg = hex(b.get("--bg")!), casing = hex(b.get("--viewer-bounds-casing")!);
      const floor = name.startsWith("hc") ? 4.5 : 3;
      for (const r of ["--viewer-bounds", "--viewer-toolpath-bounds"]) {
        const core = hex(b.get(r)!);
        expect(Math.max(contrast(core, bg), contrast(casing, bg)), `${name} ${r} or its casing on --bg`).toBeGreaterThanOrEqual(floor);
        expect(Math.max(contrast(core, LIT_METAL), contrast(casing, LIT_METAL)), `${name} ${r} or its casing on the lit table`).toBeGreaterThanOrEqual(3);
        expect(contrast(core, casing), `${name} ${r} on its casing`).toBeGreaterThanOrEqual(floor);
      }
    });
  }

  // The high-contrast themes keep the colour FAMILY at their own lightness
  // (operator 2026-09-28; Codex R29 on F7): 4.5 : 1 on their background
  // needs another lightness, never another hue.
  for (const name of ["hc-light", "hc-dark"] as const) {
    it(`${name}: every path role keeps its colour family`, () => {
      const root = block(THEMES.root), b = block(THEMES[name]);
      for (const r of PATH_ROLES) {
        const base = hueChroma(hex(root.get(r)!)), hc = hueChroma(hex(b.get(r)!));
        const dh = Math.abs(((hc.hue - base.hue + 540) % 360) - 180);
        expect(dh, `${name} ${r}: hue within 15° of ${root.get(r)}`).toBeLessThanOrEqual(15);
        expect(hc.chroma, `${name} ${r}: a colour, not a grey`).toBeGreaterThanOrEqual(0.08);
      }
    });
  }

  it("no theme draws the current line in 3D (operator 2026-09-28): no selection role", () => {
    expect(css).not.toMatch(/--viewer-selection/);
  });

  it("no rule mutes text through the retired --mix-muted", () => {
    expect(css).not.toMatch(/--mix-muted/);
  });
});
