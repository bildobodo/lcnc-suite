// Machine-model palette — the ONE source for the default colors of machine
// parts, and the table every shipped machine.json takes its colors from.
//
// A GREY LADDER (operator 2026-09-29: "gemutete metallische Farben, die
// guten Kontrast liefern", no rainbow, grey steps between the parts). The
// model is background: the program's lines (green path, magenta backplot,
// blue rapid, orange limit, the two-tone boxes) must stand in FRONT of it by
// their lightness, so no part carries a hue, and the parts a program lies on
// (the table / faceplate and the stock) sit in the middle of the ladder —
// the lines are lighter on the dark scene and stand off them by
// themeTokens.test's MODEL_MIN on the light one. The ViewCube says which
// slide is which axis; the slides are grey steps, not axis hues.
//
// Values are MATERIAL colors: the scene lights make a top face roughly
// 3.7× brighter in linear light (the table #2e3235 renders ≈ #53585b, the
// stock #363a3d ≈ #5d6165 — customContrast.MODEL_SURFACES).
//
// Two vocabularies, one ladder: the generator classes of the FreeCAD
// examples (scripts/freecad_*.py `COL`) and the legacy role names
// (scripts/vismach_to_stl.py). machine.json parts that carry an explicit
// `color` must use these exact values (palette.test.ts pins every shipped
// model).

export const MACHINE_PALETTE = {
  // the ladder, light → dark
  paint:   0x575a5e,  // columns, saddles, heads, pedestals
  steel:   0x44484c,  // guides, blocks, spindle nose, rings, shafts
  stock:   0x363a3d,  // workpiece — a hair lighter than the table it sits on
  table:   0x2e3235,  // tables, faceplates, fixture plates — where the program lies
  cast:    0x262a2d,  // beds, bases, rail seats
  accent:  0x1d2023,  // covers, end caps, yokes, drive housings
  dark:    0x121417,  // feet, chip pans, cartridges
  marks:   0x8a8f94,  // platter engraving / reference marks
  // legacy role names on the same ladder
  frame:   0x575a5e,  // static frame / column / housings = paint
  base:    0x262a2d,  // bed / base plates = cast
  x:       0x4d5155,  // X slide
  y:       0x3b3f43,  // Y slide
  z:       0x44484c,  // Z slide = steel
  rotaryA: 0x1d2023,  // A trunnion / tilt table = accent
  rotaryB: 0x3f4347,  // B nutating / tilt head
  rotaryC: 0x2e3235,  // C platter / swivel = table
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
