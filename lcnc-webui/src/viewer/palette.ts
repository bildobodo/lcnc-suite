// Machine-model palette — the ONE source for the default colors of machine
// parts (frame, linear-axis slides, rotary assemblies, stock).
//
// Why muted: the model is background. The operator reads the toolpath
// (feed cyan / rapid amber), the TWP plane (info blue / warn amber / stale
// red) and the axis gizmo AGAINST it, so the model must stay quieter than
// all of those. The previous defaults were vivid, and the sim machine.json
// files carried raw vismach colors (pure green, magenta, yellow) that
// out-shouted every overlay.
//
// Hue rule: the three linear axes keep the gizmo's hue family (X red,
// Y green, Z blue — axisColors.ts) at low saturation and metallic value,
// so a slide still says which axis it is. Rotary assemblies get their own
// muted metals so a trunnion / nutating head / platter read as distinct
// bodies. Stock is a warm tan (workpiece, cuttable) — the only non-metal.
//
// Two forms like axisColors.ts: numeric hex for Three.js, CSS strings for
// settings pickers. machine.json parts that carry an explicit `color`
// must use these exact values (palette.test.ts pins both sim models).

export const MACHINE_PALETTE = {
  frame:   0x9c9c9c,  // static frame / column / housings
  base:    0x7c7c7c,  // bed / base plates (darker so the frame reads as a body on it)
  x:       0x8f6262,  // X slide — dusty red
  y:       0x6a8a72,  // Y slide — sage green
  z:       0x62789a,  // Z slide — steel blue
  rotaryA: 0x8c7a63,  // A trunnion / tilt table — bronze
  rotaryB: 0x6c8686,  // B nutating / tilt head — teal grey
  rotaryC: 0x7a7690,  // C platter / swivel — slate
  stock:   0xb3a487,  // workpiece — warm tan
  marks:   0xc9c9c9,  // platter engraving / reference marks
} as const;

export type PaletteKey = keyof typeof MACHINE_PALETTE;

/** CSS `#rrggbb` form of a palette entry. */
export function paletteCss(key: PaletteKey): string {
  return "#" + MACHINE_PALETTE[key].toString(16).padStart(6, "0");
}

/** machine.json `color` form ([r,g,b] 0–1, three decimals) of a palette entry. */
export function paletteRgb(key: PaletteKey): [number, number, number] {
  const h = MACHINE_PALETTE[key];
  const f = (v: number) => Math.round((v / 255) * 1000) / 1000;
  return [f((h >> 16) & 0xff), f((h >> 8) & 0xff), f(h & 0xff)];
}

/** Default for a LINEAR-axis group (x/y/z) or the frame. Single rule shared
 *  by the scene build, the live per-part recolor, and the settings picker
 *  defaults — three copies of this table used to drift. */
export function defaultPartHex(direction: "x" | "y" | "z" | string | null | undefined): number {
  if (direction === "x") return MACHINE_PALETTE.x;
  if (direction === "y") return MACHINE_PALETTE.y;
  if (direction === "z") return MACHINE_PALETTE.z;
  return MACHINE_PALETTE.frame;
}
