import { describe, expect, it } from "vitest";
import { ReleaseTracker, RELEASE_CLICK_DEFAULTS } from "./releaseClick";

// The release click (machine day 2026-11-21, F12, plan P1a): a touch press
// acts on its release however long it was — once, never twice.
const A = { name: "Abort" };
const B = { name: "Pause" };

function tracker() { return new ReleaseTracker<object>(RELEASE_CLICK_DEFAULTS); }

describe("release click", () => {
  it("the panel's long press — contextmenu, release, no click — is clicked at the release", () => {
    const t = tracker();
    t.down(7, A, 0, 100, 100);
    t.contextmenu(7, A);
    expect(t.up(7, A, 900, 101, 99)).toBe("now");
    // a late browser click of that press is swallowed — the press acts once
    expect(t.click(A, true, 950)).toBe("swallow");
    expect(t.click(A, true, 960)).toBe("pass");     // only one late duplicate is swallowed
  });

  it("a contextmenu without a pointer id marks the press on its target", () => {
    const t = tracker();
    t.down(3, A, 0, 10, 10);
    t.contextmenu(undefined, A);
    expect(t.up(3, A, 700, 10, 10)).toBe("now");
  });

  it("a short tap is the browser's: nothing is given, its click passes", () => {
    const t = tracker();
    t.down(1, A, 0, 50, 50);
    expect(t.up(1, A, 120, 50, 50)).toBe("none");
    expect(t.click(A, true, 125)).toBe("pass");
  });

  it("a long press without contextmenu waits for the browser's click — and gives one only if none came", () => {
    const t = tracker();
    t.down(1, A, 0, 50, 50);
    expect(t.up(1, A, 900, 50, 50)).toBe("wait");
    expect(t.click(A, true, 903)).toBe("pass");     // the browser delivered it (headless Chromium does)
    expect(t.expire(1, 1020)).toBeNull();           // nothing more to give

    t.down(2, B, 2000, 50, 50);
    expect(t.up(2, B, 2900, 50, 50)).toBe("wait");
    expect(t.expire(2, 3020)).toBe(B);              // no click came: the release gives it
    expect(t.click(B, true, 3100)).toBe("swallow"); // a click after all is the duplicate
  });

  it("a swipe or a slide-off never acts", () => {
    const t = tracker();
    t.down(1, A, 0, 50, 50);
    t.move(1, 50, 75);                              // beyond the slop: a swipe
    t.contextmenu(1, A);
    expect(t.up(1, A, 900, 50, 50)).toBe("none");   // even back on the button

    t.down(2, A, 0, 50, 50);
    t.contextmenu(2, A);
    expect(t.up(2, B, 900, 52, 52)).toBe("none");   // released on another control

    t.down(3, A, 0, 50, 50);
    t.contextmenu(3, A);
    expect(t.up(3, A, 900, 70, 50)).toBe("none");   // the release itself is beyond the slop
  });

  it("a cancelled press (a browser pan) never acts", () => {
    const t = tracker();
    t.down(1, A, 0, 50, 50);
    t.contextmenu(1, A);
    t.cancel(1);
    expect(t.up(1, A, 900, 50, 50)).toBe("none");
  });

  it("a press that began on no control gives nothing", () => {
    const t = tracker();
    t.down(1, null, 0, 50, 50);
    expect(t.up(1, A, 900, 50, 50)).toBe("none");
  });

  it("two fingers are two presses: each gives its own click", () => {
    const t = tracker();
    t.down(1, A, 0, 10, 10);
    t.down(2, B, 100, 200, 200);
    t.contextmenu(2, B);
    expect(t.up(2, B, 800, 200, 200)).toBe("now");
    t.contextmenu(1, A);
    expect(t.up(1, A, 900, 10, 10)).toBe("now");
  });

  it("a new press ends the window for a late duplicate: its own click is never swallowed", () => {
    const t = tracker();
    t.down(1, A, 0, 10, 10);
    t.contextmenu(1, A);
    expect(t.up(1, A, 900, 10, 10)).toBe("now");
    t.down(2, A, 950, 10, 10);                      // a new tap on the same control
    expect(t.up(2, A, 1000, 10, 10)).toBe("none");
    expect(t.click(A, true, 1002)).toBe("pass");
  });

  it("our own (untrusted) click always passes", () => {
    const t = tracker();
    t.down(1, A, 0, 10, 10);
    t.contextmenu(1, A);
    t.up(1, A, 900, 10, 10);
    expect(t.click(A, false, 901)).toBe("pass");
    expect(t.click(A, true, 950)).toBe("swallow");
  });

  it("the window for a late duplicate ends", () => {
    const t = tracker();
    t.down(1, A, 0, 10, 10);
    t.contextmenu(1, A);
    t.up(1, A, 900, 10, 10);
    expect(t.click(A, true, 900 + RELEASE_CLICK_DEFAULTS.lateClickMs + 1)).toBe("pass");
  });
});
