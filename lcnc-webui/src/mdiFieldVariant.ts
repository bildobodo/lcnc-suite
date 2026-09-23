// UX-13 diagnosis (TEMPORARY — removed once the operator's browser named the
// trigger): the Apple Passwords extension in Firefox/macOS pops up on the
// MDI line and on no other field, although every field carries the same
// field contract (MachineInput.vue). Which feature it keys on cannot be
// tested here, so `?mdiField=<variant>[,<variant>…]` changes exactly ONE
// feature of the MDI line per variant and the operator reports which one
// stays quiet. Only attributes change: sending, history, focus return and
// the on-screen keyboard are untouched. Pure — the caller passes the query.

export interface MdiFieldVariant {
  /** The variants applied, in the order given. */
  names: string[];
  /** Names the switch does not know — reported, never silently ignored. */
  unknown: string[];
  /** Attribute overrides for the MDI MachineInput (undefined removes). */
  attrs: Record<string, string | undefined>;
}

export const MDI_FIELD_VARIANTS: Record<string, { attrs: Record<string, string | undefined>; what: string }> = {
  base: { attrs: {}, what: "the field as shipped" },
  noname: { attrs: { name: undefined }, what: "no name attribute" },
  noplaceholder: { attrs: { placeholder: undefined }, what: "no placeholder" },
  nolabel: { attrs: { "aria-label": undefined }, what: "no aria-label" },
  withid: { attrs: { id: "mdi-command" }, what: 'id="mdi-command"' },
  search: { attrs: { type: "search" }, what: 'type="search"' },
  combobox: { attrs: { role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false" }, what: 'role="combobox"' },
  acnope: { attrs: { autocomplete: "nope" }, what: 'autocomplete="nope" (an unknown token)' },
};

/** The variant(s) the query asks for; null without `mdiField`. */
export function parseMdiFieldVariant(search: string): MdiFieldVariant | null {
  const raw = new URLSearchParams(search).get("mdiField");
  if (raw === null) return null;
  const names: string[] = [];
  const unknown: string[] = [];
  const attrs: Record<string, string | undefined> = {};
  for (const part of raw.split(",").map(p => p.trim().toLowerCase()).filter(Boolean)) {
    const v = MDI_FIELD_VARIANTS[part];
    if (!v) { unknown.push(part); continue; }
    if (!names.includes(part)) names.push(part);
    Object.assign(attrs, v.attrs);
  }
  return { names, unknown, attrs };
}

/** The message-center line that says what is active (and what was not understood). */
export function mdiFieldVariantMessage(v: MdiFieldVariant): string {
  const active = v.names.length
    ? v.names.map(n => `${n} (${MDI_FIELD_VARIANTS[n]!.what})`).join(", ")
    : "none";
  const bad = v.unknown.length
    ? ` — unknown: ${v.unknown.join(", ")}; known: ${Object.keys(MDI_FIELD_VARIANTS).join(", ")}`
    : "";
  return `MDI field diagnostic (UX-13): ${active}${bad}`;
}
