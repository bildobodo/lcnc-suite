// The sticky head's height (plan 3.6): never read when the table mounts — a
// read there forced the layout of every new row in the task that made them —
// but from the ResizeObserver, after the layout and before the paint.
import { afterEach, describe, expect, it, vi } from "vitest";
import { vStickyHead } from "./stickyHead";

afterEach(() => { vi.unstubAllGlobals(); });

describe("v-sticky-head (plan 3.6)", () => {
  it("mounting reads no layout; the observer's first notification sets the height", () => {
    const seen: Array<() => void> = [];
    vi.stubGlobal("ResizeObserver", class { constructor(f: () => void) { seen.push(f); } observe() {} disconnect() {} });
    let reads = 0;
    const head = { get offsetHeight() { reads++; return 31; } };
    const props: Record<string, string> = {};
    const el = { querySelector: () => head, style: { setProperty: (k: string, v: string) => { props[k] = v; } } };
    const d = vStickyHead as unknown as { mounted(el: unknown): void; unmounted(el: unknown): void };
    d.mounted(el);
    expect([reads, props["--sticky-head-h"]], "nothing read at mount").toEqual([0, undefined]);
    seen[0]!();
    expect([reads, props["--sticky-head-h"]], "after the layout: the head's height").toEqual([1, "31px"]);
    d.unmounted(el);
  });
});
