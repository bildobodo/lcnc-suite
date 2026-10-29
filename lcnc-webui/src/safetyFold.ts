// Portrait with an input helper open: the Safety section keeps its machine
// info (the status rows and the active codes) wherever the strip column holds
// the helper with it, and folds it only where it would not (operator
// 2026-10-29: "the machine info should stay, as in landscape"). Measured, not
// an orientation rule: 900 × 1200 keeps it (the keyboard ends at 880 px, the
// number keypad at 893), 600 × 800 CSS px (that screen at 150 %) folds it —
// the keyboard would end 76 px, the keypad 89 px below the viewport. The
// helper stays whole in view either way (UI-I08), the safety buttons sit above
// the info and never move.

export interface StripColumn {
  /** The column's visible height (clientHeight, CSS px). */
  room: number;
  /** The height its content takes as laid out now (CSS px). */
  need: number;
  /** What the shown machine info adds (its height + the section's gap), or
   *  null while it is folded. */
  infoAdds: number | null;
}

/** Fold the machine info? `infoAdds` is the last measured addition while it
 *  was shown — needed to judge an unfold; unknown keeps a fold. */
export function safetyFoldNeeded(column: StripColumn, infoAdds: number | null): boolean {
  if (column.infoAdds != null) return column.need > column.room + 0.5;
  if (infoAdds == null) return true;
  return column.need + infoAdds > column.room + 0.5;
}

/** Measure the portrait strip column. Rects are in the zoomed space under a
 *  CSS zoom, client/offset sizes are not: every rect is divided by the
 *  strip's own rect/offset ratio before it meets a CSS px value. */
export function measureStripColumn(strip: HTMLElement): StripColumn {
  const sr = strip.getBoundingClientRect();
  const z = strip.offsetHeight > 0 ? sr.height / strip.offsetHeight : 1;
  let bottom = sr.top;
  for (const child of strip.children) {
    const el = child as HTMLElement;
    if (el.classList.contains("stripFade") || el.offsetParent === null) continue;   // the sticky fade; v-show hidden
    bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
  }
  const cs = getComputedStyle(strip);
  const need = (bottom - sr.top) / z - strip.clientTop + strip.scrollTop + parseFloat(cs.paddingBottom);
  const safety = strip.querySelector<HTMLElement>(".safetyStrip");
  const info = safety?.querySelector<HTMLElement>(".statusDetail") ?? null;
  const infoAdds = info && safety
    ? info.getBoundingClientRect().height / z + (parseFloat(getComputedStyle(safety).rowGap) || 0)
    : null;
  return { room: strip.clientHeight, need, infoAdds };
}
