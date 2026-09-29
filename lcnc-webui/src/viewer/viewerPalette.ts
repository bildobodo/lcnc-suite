// The viewer palette (design wave D8c, UI-K08): ONE resolver for every
// colour the 3D viewer draws in a role — the toolpath streams, the driven
// path, both bounds boxes, the outside-limits overlay, the collision tint,
// the tool.
//
// Automatic (the default): each role is the theme's `--viewer-*` token, so
// the palette follows the theme (light / dark / HC) and re-resolves on a
// switch. Custom: the operator's colours for the seven user roles (Settings ›
// 3D Viewer › Colors); a role the custom set lacks — and the finding roles,
// which are never user colours — stay the theme's.
//
// Pure: the token reader is injected (ThreeViewer passes the document root's
// computed style), so the resolution is unit-tested without a DOM.
import type { ColorDefaults, PaletteMode } from "../defaults";

/** The seven colours the operator can set (Settings › 3D Viewer › Colors). */
export const USER_ROLES = ["feed", "rapid", "backplot", "bounds", "toolpathBounds", "tool", "cutter"] as const;
export type UserRole = typeof USER_ROLES[number];
/** Every role the viewer draws. */
export type ViewerRole = UserRole | "limit" | "collision" | "reach"
  | "planeActive" | "planeDefined" | "planeStale";
export type ViewerPalette = Record<ViewerRole, string>;

export const ROLE_TOKEN: Record<ViewerRole, string> = {
  feed: "--viewer-feed",
  rapid: "--viewer-rapid",
  backplot: "--viewer-backplot",
  bounds: "--viewer-bounds",
  toolpathBounds: "--viewer-toolpath-bounds",
  tool: "--viewer-tool",
  cutter: "--viewer-cutter",
  limit: "--viewer-limit",
  collision: "--viewer-collision",
  reach: "--viewer-reach",
  planeActive: "--viewer-plane-active",
  planeDefined: "--viewer-plane-defined",
  planeStale: "--viewer-plane-stale",
};

const HEX = /^#[0-9a-f]{6}$/i;

/** The palette as drawn: the theme's tokens, the custom colours over them in
 *  Custom mode. A token that does not resolve to #rrggbb is a missing theme
 *  role — loud, never a silent black line. */
export function resolveViewerPalette(
  readToken: (name: string) => string,
  settings: { paletteMode: PaletteMode; colors: Partial<ColorDefaults> },
): ViewerPalette {
  const out = {} as ViewerPalette;
  for (const role of Object.keys(ROLE_TOKEN) as ViewerRole[]) {
    const token = readToken(ROLE_TOKEN[role]).trim();
    if (!HEX.test(token)) console.error(`[viewerPalette] ${ROLE_TOKEN[role]} is not a #rrggbb colour: "${token}"`);
    out[role] = token;
  }
  if (settings.paletteMode === "custom") {
    for (const role of USER_ROLES) {
      const c = settings.colors[role];
      if (c && HEX.test(c)) out[role] = c;
      else if (c) console.warn(`[viewerPalette] custom ${role} "${c}" is not a #rrggbb colour — the theme's is drawn`);
    }
  }
  return out;
}

/** The seven user roles of a palette — the seed of a first switch to Custom
 *  (it starts from what is drawn, never from a retired default). */
export function userColorsOf(p: ViewerPalette): ColorDefaults {
  return Object.fromEntries(USER_ROLES.map(r => [r, p[r]])) as unknown as ColorDefaults;
}
