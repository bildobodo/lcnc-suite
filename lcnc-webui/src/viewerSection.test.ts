// The viewer palette's migration and resolution (design wave D8c, UI-D05):
// the acceptance cases Codex named for the plan — no stored section, the
// complete old default palette, one changed role, a colour deliberately set
// back to the old default, a theme switch, Automatic → Custom → Automatic,
// save / reload (and a second client, which receives the same stored
// section). No case claims to reconstruct what an operator meant: a stored
// palette stays as it is, as Custom.
import { describe, it, expect } from "vitest";
import { mergeViewerSection } from "./viewerSection";
import { resolveViewerPalette, userColorsOf, ROLE_TOKEN, USER_ROLES } from "./viewer/viewerPalette";
import type { ViewerDefaults } from "./defaults";

const FB: ViewerDefaults = {
  layers: { backplot: true, toolpath: true, rapids: true, machine: true, bounds: true, toolpathBounds: false, reachRoom: false, reachPart: false,
    workzero: true, hud: true, surface: true, tool: true, toolsetter: true, workplane: true, groundGrid: true },
  paletteMode: "auto",
  colors: {},
  machineColors: {},
  machineEdges: true,
  trackingMode: "none",
  pathOnTop: false,
  projection: "parallel",
  previewMode: "part",
  hud: { scale: "md", showMachine: true, showTool: true, showFeedSpindle: true, showLoadBar: true },
};
/** The fallback palette every viewer save wrote before D8c. */
const OLD_DEFAULTS = { feed: "#22b8cf", rapid: "#f5a623", backplot: "#ff00ff", bounds: "#ffffff", toolpathBounds: "#f5a623", tool: "#c0c0c0", cutter: "#ffdd00" };

// Two themes' tokens, as the document root would report them.
const LIGHT: Record<string, string> = {
  "--viewer-feed": "#0072b2", "--viewer-rapid": "#047857", "--viewer-backplot": "#a21caf", "--viewer-bounds": "#475569",
  "--viewer-toolpath-bounds": "#047857", "--viewer-tool": "#9aa0a6", "--viewer-cutter": "#d4a800",
  "--viewer-limit": "#a16207", "--viewer-collision": "#c81e1e",
  "--viewer-plane-active": "#2d81dc", "--viewer-plane-defined": "#a97515", "--viewer-plane-stale": "#cc3333",
  "--viewer-reach": "#6b7280", "--viewer-bounds-alt": "#f0f2f4",
};
const DARK: Record<string, string> = {
  "--viewer-feed": "#56b4e9", "--viewer-rapid": "#34d399", "--viewer-backplot": "#e879f9", "--viewer-bounds": "#cbd5e1",
  "--viewer-toolpath-bounds": "#34d399", "--viewer-tool": "#c0c0c0", "--viewer-cutter": "#ffdd00",
  "--viewer-limit": "#ffcc00", "--viewer-collision": "#ff6b6b",
  "--viewer-plane-active": "#2d81dc", "--viewer-plane-defined": "#a97515", "--viewer-plane-stale": "#cc3333",
  "--viewer-reach": "#6b7280", "--viewer-bounds-alt": "#f0f2f4",
};
const reader = (t: Record<string, string>) => (name: string) => ` ${t[name] ?? ""} `;   // computed style pads

describe("viewer palette migration (UI-D05)", () => {
  it("no stored viewer section: Automatic, no custom colours", () => {
    const v = mergeViewerSection(undefined, FB);
    expect(v.paletteMode).toBe("auto");
    expect(v.colors).toEqual({});
  });

  it("a stored section without colours (older than the colour pickers): Automatic", () => {
    const v = mergeViewerSection({ layers: { hud: false } }, FB);
    expect(v.paletteMode).toBe("auto");
    expect(v.layers.hud).toBe(false);
  });

  it("the complete old default palette: kept exactly, as Custom — every save wrote it, intent is unknowable", () => {
    const v = mergeViewerSection({ colors: { ...OLD_DEFAULTS } }, FB);
    expect(v.paletteMode).toBe("custom");
    expect(v.colors).toEqual(OLD_DEFAULTS);
  });

  it("one changed role: Custom, the changed and the untouched colours kept", () => {
    const v = mergeViewerSection({ colors: { ...OLD_DEFAULTS, feed: "#00ff00" } }, FB);
    expect(v.paletteMode).toBe("custom");
    expect(v.colors).toEqual({ ...OLD_DEFAULTS, feed: "#00ff00" });
  });

  it("a colour deliberately set back to the old default is indistinguishable — Custom like any stored palette, no heuristic", () => {
    const touched = mergeViewerSection({ colors: { ...OLD_DEFAULTS, bounds: "#ffffff" } }, FB);
    const untouched = mergeViewerSection({ colors: { ...OLD_DEFAULTS } }, FB);
    expect(touched).toEqual(untouched);
    expect(touched.paletteMode).toBe("custom");
  });

  it("Automatic → Custom → Automatic: the custom colours survive every step, the stored mode decides", () => {
    const custom = { ...OLD_DEFAULTS, rapid: "#123456" };
    const asAuto = mergeViewerSection({ paletteMode: "auto", colors: custom }, FB);
    expect(asAuto.paletteMode).toBe("auto");
    expect(asAuto.colors).toEqual(custom);
    const back = mergeViewerSection({ ...asAuto, paletteMode: "custom" }, FB);
    expect(back.paletteMode).toBe("custom");
    expect(back.colors).toEqual(custom);
  });

  it("save / reload (a second client receives the same stored section): the merge is a fixed point", () => {
    for (const saved of [undefined, { colors: OLD_DEFAULTS }, { paletteMode: "auto", colors: {} }, { paletteMode: "custom", colors: { feed: "#010203" } }]) {
      const once = mergeViewerSection(saved, FB);
      const stored = JSON.parse(JSON.stringify(once));
      expect(mergeViewerSection(stored, FB)).toEqual(once);
    }
  });
});

// Viewer contrast plan, V6 (Codex VK-04): where a Custom palette came from.
// Certain only for a palette stored WITHOUT a mode ("legacy" — it keeps that
// through every later save, a layer toggle too, until the operator chooses);
// a mode without an origin — a palette saved after the D8c migration — stays
// unknown and claims nothing; an explicit choice is "operator". Every case
// through save and reload (the stored JSON merged again).
describe("palette origin (viewer contrast plan, V6)", () => {
  const roundTrip = (v: ReturnType<typeof mergeViewerSection>, change: Partial<typeof v> = {}) =>
    mergeViewerSection(JSON.parse(JSON.stringify({ ...v, ...change })), FB);

  it("stored without a mode: Custom from an earlier version — kept through a later save and reload", () => {
    const once = mergeViewerSection({ colors: { ...OLD_DEFAULTS } }, FB);
    expect([once.paletteMode, once.paletteOrigin]).toEqual(["custom", "legacy"]);
    const again = roundTrip(once, { layers: { ...once.layers, backplot: false } });
    expect([again.paletteMode, again.paletteOrigin, again.colors]).toEqual(["custom", "legacy", OLD_DEFAULTS]);
  });

  it("a mode without an origin (the old colours saved under D8c): unknown — no origin claimed, the colours kept", () => {
    const once = mergeViewerSection({ paletteMode: "custom", colors: { ...OLD_DEFAULTS } }, FB);
    expect(once.paletteOrigin).toBeUndefined();
    expect(once.colors).toEqual(OLD_DEFAULTS);
    const again = roundTrip(once);
    expect([again.paletteMode, again.paletteOrigin]).toEqual(["custom", undefined]);
    expect("paletteOrigin" in JSON.parse(JSON.stringify(again)), "nothing stored for an unknown origin").toBe(false);
  });

  it("chosen by the operator — even the very same colours: operator, kept through save and reload", () => {
    const once = mergeViewerSection({ paletteMode: "custom", paletteOrigin: "operator", colors: { ...OLD_DEFAULTS } }, FB);
    expect(once.paletteOrigin).toBe("operator");
    expect(roundTrip(once).paletteOrigin).toBe("operator");
  });

  it("an unknown stored origin is dropped, never trusted", () => {
    expect(mergeViewerSection({ paletteMode: "custom", paletteOrigin: "guess", colors: { feed: "#010203" } }, FB).paletteOrigin).toBeUndefined();
  });
});

describe("viewer palette resolution", () => {
  it("Automatic follows the theme: every role is the theme's token", () => {
    const light = resolveViewerPalette(reader(LIGHT), { paletteMode: "auto", colors: { ...OLD_DEFAULTS } });
    const dark = resolveViewerPalette(reader(DARK), { paletteMode: "auto", colors: { ...OLD_DEFAULTS } });
    for (const [role, token] of Object.entries(ROLE_TOKEN)) {
      expect(light[role as keyof typeof light], role).toBe(LIGHT[token]);
      expect(dark[role as keyof typeof dark], role).toBe(DARK[token]);
    }
  });

  it("Custom keeps its colours through a theme switch; the finding roles (limit, collision) stay the theme's", () => {
    const settings = { paletteMode: "custom" as const, colors: { ...OLD_DEFAULTS } };
    for (const theme of [LIGHT, DARK]) {
      const p = resolveViewerPalette(reader(theme), settings);
      for (const r of USER_ROLES) expect(p[r], r).toBe(OLD_DEFAULTS[r]);
      expect(p.limit).toBe(theme["--viewer-limit"]);
      expect(p.collision).toBe(theme["--viewer-collision"]);
    }
  });

  it("a Custom palette missing a role (or holding no #rrggbb) draws the theme's colour for it", () => {
    const p = resolveViewerPalette(reader(DARK), { paletteMode: "custom", colors: { feed: "#010203", rapid: "red" } });
    expect(p.feed).toBe("#010203");
    expect(p.rapid).toBe(DARK["--viewer-rapid"]);
    expect(p.bounds).toBe(DARK["--viewer-bounds"]);
  });

  it("the first switch to Custom seeds from what is drawn — the seven user roles", () => {
    const seed = userColorsOf(resolveViewerPalette(reader(LIGHT), { paletteMode: "auto", colors: {} }));
    expect(Object.keys(seed).sort()).toEqual([...USER_ROLES].sort());
    expect(seed.bounds).toBe(LIGHT["--viewer-bounds"]);
  });
});
