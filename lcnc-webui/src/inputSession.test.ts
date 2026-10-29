import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ref } from "vue";
import { heldThroughPress, press, PRESS_NO_CLICK_MS, PRESS_LOST_MS } from "./inputSession";

// The strip's layout holds through a press (operator 2026-10-28/29): a
// helper closing at the pointerdown keeps the strip as it is until the press
// has ended — after its click — so the click lands on the control it began
// on. Only a close waits; an opening or a switch applies at once. The real
// pointers are in safety-during-edit.spec; here the press's end rules.
describe("heldThroughPress", () => {
  const open = ref<string | null>("text");
  let held: Readonly<{ value: string | null }>;
  beforeEach(() => {
    vi.useFakeTimers();
    press.cancel();
    open.value = "text";
    held = heldThroughPress(() => open.value, (v) => v === null);
  });
  afterEach(() => { press.cancel(); vi.useRealTimers(); });

  it("follows the source at once while no press is in progress", () => {
    open.value = null;
    expect(held.value).toBeNull();
    open.value = "number";
    expect(held.value).toBe("number");
  });

  it("a close during a press waits for the click and lands right after it", () => {
    press.down();
    open.value = null;           // the pointerdown outside the area closed it
    press.up();
    expect(held.value).toBe("text");
    press.click();
    expect(held.value, "the click's own handlers still see the strip as it was").toBe("text");
    vi.advanceTimersByTime(0);
    expect(held.value).toBeNull();
  });

  it("a release no click follows ends the press after PRESS_NO_CLICK_MS (a dimmed control, a slide off)", () => {
    press.down();
    open.value = null;
    press.up();
    vi.advanceTimersByTime(PRESS_NO_CLICK_MS - 1);
    expect(held.value).toBe("text");
    vi.advanceTimersByTime(1);
    expect(held.value).toBeNull();
  });

  it("a press whose release never arrives ends after PRESS_LOST_MS; a hold before it keeps the strip", () => {
    press.down();
    open.value = null;
    vi.advanceTimersByTime(PRESS_LOST_MS - 1);
    expect(held.value).toBe("text");
    vi.advanceTimersByTime(1);
    expect(held.value).toBeNull();
  });

  it("pointercancel (a pan took the press) ends it at once", () => {
    press.down();
    open.value = null;
    press.cancel();
    expect(held.value).toBeNull();
  });

  it("an opening or a switch during a press applies at once — its click has landed", () => {
    open.value = null;
    press.down();
    open.value = "number";
    expect(held.value).toBe("number");
    open.value = "text";
    expect(held.value).toBe("text");
  });

  it("the value the press ends on is the source's latest, not the first close", () => {
    press.down();
    open.value = null;
    open.value = "number";       // reopened within the same press
    expect(held.value).toBe("number");
    open.value = null;
    press.click();
    vi.advanceTimersByTime(0);
    expect(held.value).toBeNull();
  });
});
