// Every theme defines every text role (design wave D8): the colour a muted,
// state or syntax TEXT takes and the focus ring. A theme block without a role
// inherits the LIGHT value from :root — #525e6a muted text on a #0b0f14
// background — and the dark palette lives twice (the explicit
// data-theme="dark" block and the auto block under prefers-color-scheme:
// dark), which must never drift. contrast.spec measures the rendered pairs;
// this pins the blocks the measurement relies on.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// node:fs, not an import: vitest empties every CSS import, `?raw` included.
const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

const ROLES = [
  "--fg-muted", "--ok-text", "--warn-text", "--danger-text", "--info-text", "--accent-text", "--focus-ring",
  "--syntax-gcode", "--syntax-mcode", "--syntax-coord", "--syntax-param", "--syntax-comment",
];

/** The declarations of the first rule whose selector is exactly `selector`. */
function block(selector: string): Map<string, string> {
  const i = css.indexOf(`${selector} {`);
  expect(i, `style.css has a "${selector}" block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]));
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

  it("no rule mutes text through the retired --mix-muted", () => {
    expect(css).not.toMatch(/--mix-muted/);
  });
});
