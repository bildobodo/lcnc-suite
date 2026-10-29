import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ref } from "vue";
import { heldThroughPress, press, pressHolds, PRESS_NO_CLICK_MS } from "./inputSession";

// The strip's layout holds through a press (operator 2026-10-28/29): a
// helper closing at the pointerdown keeps the strip as it is until the press
// has ended — after its click — so the click lands on the control it began
// on. Only a close waits; an opening or a switch applies at once. Each
// pointer ends its OWN press, never by its age (Codex R224 SDE-01/02). The
// real pointers are in safety-during-edit.spec; here the press's end rules.
describe("heldThroughPress", () => {
  const open = ref<string | null>("text");
  let held: Readonly<{ value: string | null }>;
  beforeEach(() => {
    vi.useFakeTimers();
    press.lost();
    open.value = "text";
    held = heldThroughPress(() => open.value, (v) => v === null);
  });
  afterEach(() => { press.lost(); vi.useRealTimers(); });

  it("follows the source at once while no press is in progress", () => {
    open.value = null;
    expect(held.value).toBeNull();
    open.value = "number";
    expect(held.value).toBe("number");
  });

  it("a close during a press waits for the click and lands right after it", () => {
    press.down(1);
    open.value = null;           // the pointerdown outside the area closed it
    press.up(1);
    expect(held.value).toBe("text");
    press.click(1);
    expect(held.value, "the click's own handlers still see the strip as it was").toBe("text");
    vi.advanceTimersByTime(0);
    expect(held.value).toBeNull();
  });

  it("a release no click follows ends the press after PRESS_NO_CLICK_MS (the right button, a dimmed control)", () => {
    press.down(1);
    open.value = null;
    press.up(1);
    vi.advanceTimersByTime(PRESS_NO_CLICK_MS - 1);
    expect(held.value).toBe("text");
    vi.advanceTimersByTime(1);
    expect(held.value).toBeNull();
  });

  it("a press is never ended by its age: a pointer still down holds the strip (SDE-01)", () => {
    press.down(1);
    open.value = null;
    vi.advanceTimersByTime(60_000);
    expect(held.value).toBe("text");
    press.up(1);
    press.click(1);
    vi.advanceTimersByTime(0);
    expect(held.value).toBeNull();
  });

  it("pointercancel (a pan took the press) ends it at once", () => {
    press.down(1);
    open.value = null;
    press.cancel(1);
    expect(held.value).toBeNull();
  });

  it("a lost release ends the press when the browser shows it: a move with no button, a lost focus, a hidden page", () => {
    press.down(1);
    open.value = null;
    press.moved(1, 1);
    expect(held.value, "a move with the button down is the press itself").toBe("text");
    press.moved(1, 0);
    expect(held.value).toBeNull();
    open.value = "text";
    press.down(1);
    press.down(2);
    open.value = null;
    press.lost();               // the window's blur, the page's visibilitychange to hidden
    expect(held.value, "a lost focus or a hidden page ends every press").toBeNull();
  });

  it("another pointer's release or click never ends a press still down (SDE-02)", () => {
    press.down(4);
    open.value = null;
    press.down(5);
    press.up(5);
    press.click(5);
    vi.advanceTimersByTime(PRESS_NO_CLICK_MS + 10);
    expect(held.value, "finger 4 is still down").toBe("text");
    press.moved(5, 0);
    press.cancel(5);
    expect(held.value, "finger 5's move and cancel are its own").toBe("text");
    press.up(4);
    press.click(4);
    vi.advanceTimersByTime(0);
    expect(held.value).toBeNull();
  });

  it("the first pointer's end waits for the second one still down; a cancel ends only its pointer", () => {
    press.down(1);
    open.value = null;
    press.down(2);
    press.up(1);
    press.click(1);
    vi.advanceTimersByTime(0);
    expect(held.value, "pointer 2 still down").toBe("text");
    press.down(3);
    press.cancel(2);
    expect(held.value, "pointer 3 still down").toBe("text");
    press.cancel(3);
    expect(held.value).toBeNull();
  });

  it("a new PRIMARY pointer ends the earlier ones of its type (none is in contact then); other types keep theirs", () => {
    press.down(4, "touch", true);
    open.value = null;
    press.down(1, "mouse", true);
    press.down(9, "touch", true);   // a new first finger: touch 4's release was lost
    press.up(9);
    press.click(9);
    vi.advanceTimersByTime(0);
    expect(held.value, "the mouse is still down").toBe("text");
    press.up(1);
    press.click(1);
    vi.advanceTimersByTime(0);
    expect(held.value, "touch 4 no longer holds").toBeNull();
  });

  it("a click that names no just-released pointer (a keyboard click, -1) ends nothing; an unnamed one ends the last release", () => {
    press.down(1);
    open.value = null;
    press.up(1);
    press.click(-1);
    vi.advanceTimersByTime(0);
    expect(held.value, "the keyboard's click is not the pointer's").toBe("text");
    press.click(null);          // a MouseEvent click from the pointer (no pointerId)
    vi.advanceTimersByTime(0);
    expect(held.value).toBeNull();
  });

  it("an opening or a switch during a press applies at once — its click has landed", () => {
    open.value = null;
    press.down(1);
    open.value = "number";
    expect(held.value).toBe("number");
    open.value = "text";
    expect(held.value).toBe("text");
  });

  it("the value the press ends on is the source's latest, not the first close", () => {
    press.down(1);
    open.value = null;
    open.value = "number";       // reopened within the same press
    expect(held.value).toBe("number");
    open.value = null;
    press.up(1);
    press.click(1);
    vi.advanceTimersByTime(0);
    expect(held.value).toBeNull();
  });

  it("pressHolds reports the press to what holds a place (App's helperPlace)", () => {
    expect(pressHolds.value).toBe(false);
    press.down(7);
    expect(pressHolds.value).toBe(true);
    press.cancel(7);
    expect(pressHolds.value).toBe(false);
  });
});
