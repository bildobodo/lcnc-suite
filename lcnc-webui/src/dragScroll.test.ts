// The scroll owner's lifetime (Codex R422 MT-I07, R423): one release watcher on
// the window, a scroller referenced only while a press of it is in flight, and a
// stop that ends those presses — never an old owner left moving the container.
// The real module over a minimal EventTarget seam (adopted from Codex's R423 probe).
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./releaseClick", () => ({ noteScrollGesture: vi.fn() }));

class Scroller extends EventTarget {
  style = { cursor: "", userSelect: "" };
  scrollLeft = 0;
  scrollTop = 0;
  closest() { return null; }
  querySelectorAll() { return []; }
  setPointerCapture() {}
}
let el: Scroller;
let win: EventTarget;
let stop: (() => void) | undefined;
function pointer(target: EventTarget, type: string, id: number, x: number) {
  target.dispatchEvent(Object.assign(new Event(type), { button: 0, pointerId: id, clientX: x, clientY: 0 }));
}
beforeEach(() => {
  vi.resetModules();
  el = new Scroller();
  win = new EventTarget();
  vi.stubGlobal("window", win);
  vi.stubGlobal("HTMLElement", Scroller);
  vi.stubGlobal("document", { body: el, querySelectorAll: () => [el], getSelection: () => null });
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); });

it("a release outside the scroller frees it for another pointer", async () => {
  const mod = await import("./dragScroll"); stop = mod.stopDragScroll;
  mod.initDragScroll();
  pointer(el, "pointerdown", 31, 100); pointer(el, "pointermove", 31, 110);
  pointer(win, "pointerup", 31, 110);
  expect(el.style.cursor).toBe("");
  pointer(el, "pointerdown", 32, 100); pointer(el, "pointermove", 32, 120);
  expect(el.scrollLeft).toBe(-30);
});

it("a stop during a drag ends it: no old owner after a re-init (Codex R423)", async () => {
  const mod = await import("./dragScroll"); stop = mod.stopDragScroll;
  mod.initDragScroll();
  pointer(el, "pointerdown", 31, 100); pointer(el, "pointermove", 31, 110);
  expect(el.scrollLeft).toBe(-10);
  mod.stopDragScroll();
  expect(el.style.cursor).toBe("");
  expect(el.style.userSelect).toBe("");
  pointer(win, "pointerup", 31, 110);             // the release while stopped reaches nobody
  mod.initDragScroll();
  pointer(el, "pointerdown", 32, 100); pointer(el, "pointermove", 32, 120);
  expect(el.scrollLeft).toBe(-30);
});

it("a stopped service books no press: none stays in flight without its watcher", async () => {
  const mod = await import("./dragScroll"); stop = mod.stopDragScroll;
  mod.initDragScroll();
  mod.stopDragScroll();
  pointer(el, "pointerdown", 41, 100); pointer(el, "pointermove", 41, 140);
  expect(el.scrollLeft).toBe(0);                  // nothing moved while stopped
  mod.initDragScroll();
  pointer(el, "pointerdown", 42, 100); pointer(el, "pointermove", 42, 110);
  expect(el.scrollLeft).toBe(-10);                // the new press owns the scroller
});

it("two pointers: each keeps its own decision, the first past the threshold moves the container", async () => {
  const mod = await import("./dragScroll"); stop = mod.stopDragScroll;
  mod.initDragScroll();
  pointer(el, "pointerdown", 1, 100);
  pointer(el, "pointerdown", 2, 300);
  pointer(el, "pointermove", 1, 108);             // finger 1 past the threshold: it scrolls
  pointer(el, "pointermove", 2, 320);             // finger 2 past it too: noted, never moves
  expect(el.scrollLeft).toBe(-8);
  pointer(win, "pointerup", 2, 320);
  pointer(el, "pointermove", 1, 112);
  expect(el.scrollLeft).toBe(-12);
});
