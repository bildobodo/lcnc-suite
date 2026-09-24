import { describe, expect, it } from "vitest";
import { placePopover } from "./helpPlacement";

// UI-I13: the popover is placed from its REAL size, inside the viewport.
const M = 6;
const size = { width: 336, height: 337 };

describe("help popover placement", () => {
  it("goes below the trigger when it fits there", () => {
    const at = placePopover({ left: 400, top: 100, width: 20, height: 20 }, size, { width: 1280, height: 900 }, M);
    expect(at).toEqual({ side: "below", top: 126, left: 400 + 10 - 168, maxHeight: null });
  });

  it("goes above when there is no room below (the Setup title at the bottom of a 1280 × 900 landscape)", () => {
    const at = placePopover({ left: 630, top: 609, width: 20, height: 20 }, size, { width: 1280, height: 900 }, M);
    expect(at.side).toBe("above");
    expect(at.top).toBe(609 - M - 337);
    expect(at.top + size.height).toBeLessThanOrEqual(609 - M);
    expect(at.maxHeight).toBeNull();
  });

  it("caps the height on the roomier side when it fits on neither, so the content scrolls inside the viewport", () => {
    const tall = { width: 336, height: 815 };
    const low = placePopover({ left: 250, top: 700, width: 20, height: 20 }, tall, { width: 900, height: 1200 }, M);
    expect(low.side).toBe("above");            // 688 above vs 474 below
    expect(low.top).toBe(M);
    expect(low.maxHeight).toBe(700 - 2 * M);
    const fits = placePopover({ left: 250, top: 100, width: 20, height: 20 }, tall, { width: 900, height: 1200 }, M);
    expect(fits).toMatchObject({ side: "below", top: 126, maxHeight: null });   // 1068 below: it fits
    const taller = { width: 336, height: 1100 };
    const high = placePopover({ left: 250, top: 100, width: 20, height: 20 }, taller, { width: 900, height: 1200 }, M);
    expect(high.side).toBe("below");
    expect(high.top).toBe(126);
    expect(high.maxHeight).toBe(1200 - M - 126);
    expect(high.top + high.maxHeight!).toBe(1200 - M);
  });

  it("is centred on the trigger and clamped to both viewport edges", () => {
    const right = placePopover({ left: 1250, top: 100, width: 20, height: 20 }, size, { width: 1280, height: 900 }, M);
    expect(right.left).toBe(1280 - 336 - M);
    const left = placePopover({ left: 4, top: 100, width: 20, height: 20 }, size, { width: 1280, height: 900 }, M);
    expect(left.left).toBe(M);
    const mid = placePopover({ left: 640, top: 100, width: 20, height: 20 }, size, { width: 1280, height: 900 }, M);
    expect(mid.left).toBe(650 - 168);
  });

  it("never returns a negative height cap", () => {
    const at = placePopover({ left: 0, top: 2, width: 20, height: 20 }, { width: 336, height: 2000 }, { width: 400, height: 30 }, M);
    expect(at.maxHeight).toBeGreaterThanOrEqual(0);
  });

  it("prefers above for a control hint and falls back below at the top edge (UI-D08)", () => {
    const hint = { width: 240, height: 40 };
    const mid = placePopover({ left: 400, top: 500, width: 80, height: 36 }, hint, { width: 1280, height: 900 }, M, "above");
    expect(mid).toMatchObject({ side: "above", top: 500 - M - 40, maxHeight: null });
    const top = placePopover({ left: 400, top: 20, width: 80, height: 36 }, hint, { width: 1280, height: 900 }, M, "above");
    expect(top).toMatchObject({ side: "below", top: 20 + 36 + M, maxHeight: null });
    const edge = placePopover({ left: 1260, top: 500, width: 20, height: 20 }, hint, { width: 1280, height: 900 }, M, "above");
    expect(edge.left + hint.width).toBeLessThanOrEqual(1280 - M);
  });
});
