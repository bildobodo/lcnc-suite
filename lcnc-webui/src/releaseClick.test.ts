import { describe, expect, it } from "vitest";
import { ReleaseTracker, RELEASE_CLICK_DEFAULTS } from "./releaseClick";

// The release click (machine day 2026-11-21, F12, plan P1a; Codex R420): a
// touch press acts on its release however long it was — once, never twice,
// each press its own gesture per pointer.
const A = { name: "Abort" };
const B = { name: "Pause" };
const P = 1;  // a pointer click (detail 1)
const K = 0;  // a keyboard activation (detail 0)

function tracker() { return new ReleaseTracker<object>(RELEASE_CLICK_DEFAULTS); }

describe("release click", () => {
  it("the panel's long press — contextmenu, release, no click — is clicked at the release", () => {
    const t = tracker();
    t.down(7, A, 0, 100, 100);
    t.contextmenu(7, A);
    expect(t.up(7, A, 900, 101, 99)).toBe("now");
    // a late browser click of THAT pointer is swallowed — the press acts once
    expect(t.click(A, true, 950, 7, P)).toBe("swallow");
    expect(t.click(A, true, 960, 7, P)).toBe("pass");   // only one late duplicate
  });

  it("a contextmenu without a pointer id marks the press on its target", () => {
    const t = tracker();
    t.down(3, A, 0, 10, 10);
    t.contextmenu(undefined, A);
    expect(t.up(3, A, 700, 10, 10)).toBe("now");
  });

  it("a short tap waits for the browser's click: it passes, nothing more is given", () => {
    const t = tracker();
    t.down(1, A, 0, 50, 50);
    expect(t.up(1, A, 120, 50, 50)).toBe("wait");
    expect(t.click(A, true, 125, 1, P)).toBe("pass");
    expect(t.expire(1, 240)).toBeNull();
  });

  it("a tap the browser never clicks (a second finger while another touch is down) gets its click", () => {
    const t = tracker();
    t.down(1, null, 0, 10, 10);                         // the first finger holds a jog: no click control
    t.down(2, A, 100, 50, 50);                          // the second finger taps the pad's Stop
    expect(t.up(2, A, 180, 50, 50)).toBe("wait");
    expect(t.expire(2, 300)).toBe(A);
  });

  it("with a minimum press time, a shorter press relies on the browser alone", () => {
    const t = new ReleaseTracker<object>({ ...RELEASE_CLICK_DEFAULTS, minPressMs: 400 });
    t.down(1, A, 0, 50, 50);
    expect(t.up(1, A, 120, 50, 50)).toBe("none");
  });

  it("a long press without contextmenu waits for the browser's click — and gives one only if none came", () => {
    const t = tracker();
    t.down(1, A, 0, 50, 50);
    expect(t.up(1, A, 900, 50, 50)).toBe("wait");
    expect(t.click(A, true, 903, 1, P)).toBe("pass");   // the browser delivered it (headless Chromium does)
    expect(t.expire(1, 1020)).toBeNull();               // nothing more to give

    t.down(2, B, 2000, 50, 50);
    expect(t.up(2, B, 2900, 50, 50)).toBe("wait");
    expect(t.expire(2, 3020)).toBe(B);                  // no click came: the release gives it
    expect(t.click(B, true, 3100, 2, P)).toBe("swallow"); // a click of that pointer after all is the duplicate
  });

  it("a keyboard activation is never taken for a pointer's duplicate (Codex R420 MT-I03)", () => {
    const t = tracker();
    t.down(7, A, 0, 10, 10);
    t.contextmenu(7, A);
    expect(t.up(7, A, 900, 10, 10)).toBe("now");
    expect(t.click(A, true, 950, -1, K)).toBe("pass");  // Enter on the same control: its own action
    expect(t.click(A, true, 960, 7, P)).toBe("swallow"); // the pointer's late duplicate still is one
  });

  it("another pointer's click is never taken for a duplicate", () => {
    const t = tracker();
    t.down(7, A, 0, 10, 10);
    t.contextmenu(7, A);
    t.up(7, A, 900, 10, 10);
    expect(t.click(A, true, 950, 8, P)).toBe("pass");   // a second finger's own tap on the same control
  });

  it("a wait is ended only by its own pointer's click", () => {
    const t = tracker();
    t.down(1, A, 0, 50, 50);
    expect(t.up(1, A, 900, 50, 50)).toBe("wait");
    expect(t.click(A, true, 905, 2, P)).toBe("pass");   // another finger: not the browser's click of pointer 1
    expect(t.expire(1, 1020)).toBe(A);                  // pointer 1 still gets its click
  });

  it("a click that names no pointer never swallows, and ends a wait on its target", () => {
    const t = tracker();
    t.down(1, A, 0, 50, 50);
    expect(t.up(1, A, 900, 50, 50)).toBe("wait");
    expect(t.click(A, true, 903, undefined, P)).toBe("pass");
    expect(t.expire(1, 1020)).toBeNull();
  });

  it("a press the scroll owner took over acts nowhere, and its browser click is swallowed (Codex R420 MT-I02)", () => {
    const t = tracker();
    t.down(4, A, 0, 50, 50);
    t.move(4, 56, 50);                                  // 6 px: below the slop, past the drag threshold
    t.scroll(4);
    t.contextmenu(4, A);
    expect(t.up(4, A, 900, 50, 50)).toBe("none");       // back at the start: still a scroll
    expect(t.click(A, true, 905, 4, P)).toBe("swallow"); // Chromium's own click after the drag
    expect(t.click(A, true, 910, 5, P)).toBe("pass");    // another pointer's is its own
  });

  it("a short scroll is a scroll too", () => {
    const t = tracker();
    t.down(4, A, 0, 50, 50);
    t.scroll(4);
    expect(t.up(4, A, 120, 50, 50)).toBe("none");
    expect(t.click(A, true, 125, 4, P)).toBe("swallow");
  });

  it("a scroll's click window ends with the pointer's next press", () => {
    const t = tracker();
    t.down(4, A, 0, 50, 50);
    t.scroll(4);
    t.up(4, A, 120, 50, 50);
    t.down(4, A, 300, 50, 50);                          // a new press of that pointer: its tap is real
    expect(t.up(4, A, 380, 50, 50)).toBe("wait");
    expect(t.click(A, true, 382, 4, P)).toBe("pass");
  });

  it("a swipe or a slide-off never acts", () => {
    const t = tracker();
    t.down(1, A, 0, 50, 50);
    t.move(1, 50, 75);                                  // beyond the slop: a swipe
    t.contextmenu(1, A);
    expect(t.up(1, A, 900, 50, 50)).toBe("none");       // even back on the button

    t.down(2, A, 0, 50, 50);
    t.contextmenu(2, A);
    expect(t.up(2, B, 900, 52, 52)).toBe("none");       // released on another control

    t.down(3, A, 0, 50, 50);
    t.contextmenu(3, A);
    expect(t.up(3, A, 900, 70, 50)).toBe("none");       // the release itself is beyond the slop
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

  it("a new press of the same pointer ends the window for its late duplicate", () => {
    const t = tracker();
    t.down(1, A, 0, 10, 10);
    t.contextmenu(1, A);
    expect(t.up(1, A, 900, 10, 10)).toBe("now");
    t.down(1, A, 950, 10, 10);                          // a new tap with the same pointer id
    expect(t.up(1, A, 1000, 10, 10)).toBe("wait");
    expect(t.click(A, true, 1002, 1, P)).toBe("pass");  // its own click, never the old one's duplicate
  });

  it("our own (untrusted) click always passes", () => {
    const t = tracker();
    t.down(1, A, 0, 10, 10);
    t.contextmenu(1, A);
    t.up(1, A, 900, 10, 10);
    expect(t.click(A, false, 901, 1, P)).toBe("pass");
    expect(t.click(A, true, 950, 1, P)).toBe("swallow");
  });

  it("the window for a late duplicate ends", () => {
    const t = tracker();
    t.down(1, A, 0, 10, 10);
    t.contextmenu(1, A);
    t.up(1, A, 900, 10, 10);
    expect(t.click(A, true, 900 + RELEASE_CLICK_DEFAULTS.lateClickMs + 1, 1, P)).toBe("pass");
  });
});
