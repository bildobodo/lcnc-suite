// The hints a gesture shows, recorded on the page — ONE recorder for the
// stall guards (hold after a stall, Codex R401). A hint counts only after the
// recorder's own next press: that press closes the hint still on screen first
// (FloatingOverlays' window capture listener, registered at mount — before
// this one), so an old hint is never the new gesture's. The reset empties the
// list and disarms in ONE step: no window in which a previous press still
// arms it (an old "Page delayed" re-read at a DOM change excused a silent
// whole press, R401). Guarded by hold-stall-mouse.spec's stale-hint case.
import type { Page } from "./test";

type W = { __hints: string[]; __hintArmed: boolean; __hintRec?: boolean };

/** From now on: the hints shown after the next press (installs the recorder
 *  once per page). */
export const resetHints = (page: Page) => page.evaluate(() => {
  const w = window as unknown as W;
  w.__hints = [];
  w.__hintArmed = false;
  if (w.__hintRec) return;
  w.__hintRec = true;
  window.addEventListener("pointerdown", () => { w.__hintArmed = true; }, { capture: true });
  new MutationObserver(() => {
    if (!w.__hintArmed) return;
    const h = document.querySelector("[data-btn-hint]")?.textContent?.trim();
    if (h && w.__hints[w.__hints.length - 1] !== h) w.__hints.push(h);
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
});

/** The hints recorded since the last reset. */
export const readHints = (page: Page) => page.evaluate(() => (window as unknown as W).__hints);
