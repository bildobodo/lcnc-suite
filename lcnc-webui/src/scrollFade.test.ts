// The scroll fades (plan 3.6): a DOM change never reads a scroller's layout in
// the task that changed it — the re-check runs in the next animation frame,
// before it paints, once for any number of changes.
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("the scroll fades (plan 3.6)", () => {
  it("attaching and a DOM change read no layout until the next frame; one frame re-checks once", async () => {
    let reads = 0;
    class FakeEl {
      classList = { on: new Set<string>(), toggle(c: string, on: boolean) { if (on) this.on.add(c); else this.on.delete(c); } };
      children: unknown[] = [];
      isConnected = true;
      addEventListener() {}
      get scrollTop() { reads++; return 0; }
      get clientHeight() { reads++; return 100; }
      get scrollHeight() { reads++; return 300; }
    }
    const el = new FakeEl();
    const frames: Array<() => void> = [];
    let changed: ((m: unknown[]) => void) | null = null;
    vi.stubGlobal("HTMLElement", FakeEl);
    vi.stubGlobal("document", { querySelectorAll: () => [el], body: {} });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("MutationObserver", class { constructor(f: (m: unknown[]) => void) { changed = f; } observe() {} disconnect() {} });
    vi.stubGlobal("requestAnimationFrame", (f: () => void) => { frames.push(f); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const { initScrollFade, stopScrollFade } = await import("./scrollFade");
    initScrollFade();
    expect(reads, "attached: nothing read").toBe(0);
    changed!([{ addedNodes: [] }]);
    changed!([{ addedNodes: [] }]);
    expect([reads, frames.length], "two DOM changes: nothing read, one frame asked for").toEqual([0, 1]);
    frames.shift()!();
    expect(reads, "the frame reads them (scrollTop for each fade, the two heights)").toBe(4);
    expect([...el.classList.on], "more below: the lower fade").toEqual(["sf-down"]);
    stopScrollFade();
  });
});
