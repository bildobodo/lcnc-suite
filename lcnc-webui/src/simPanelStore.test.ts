// The Sim tab's link to the scrub bar survives a re-mount (operator
// 2026-10-06, live): a hot reload swapped the bar, Vue built the new bar
// BEFORE the old bar's onUnmounted ran, and the old bar's clear disconnected
// the new one — ‹ › and the rows did nothing until a page reload. Vue's own
// order, through a minimal custom renderer (no DOM in this suite).
import { describe, expect, it } from "vitest";
import { createRenderer, defineComponent, h, nextTick, onUnmounted, ref } from "vue";
import { claimSimActions, simRows, simStep, simView } from "./simPanelStore";

interface N { tag: string; children: N[]; parent: N | null; text?: string }
const node = (tag: string, text?: string): N => ({ tag, children: [], parent: null, text });
const detach = (c: N) => {
  const p = c.parent;
  if (p) { p.children.splice(p.children.indexOf(c), 1); c.parent = null; }
};
const { createApp } = createRenderer<N, N>({
  createElement: tag => node(tag),
  createText: text => node("#text", text),
  createComment: text => node("#comment", text),
  setText: (n, text) => { n.text = text; },
  setElementText: (n, text) => { n.children = []; n.text = text; },
  insert: (child, parent, anchor) => {
    detach(child);
    const i = anchor ? parent.children.indexOf(anchor) : -1;
    if (i < 0) parent.children.push(child); else parent.children.splice(i, 0, child);
    child.parent = parent;
  },
  remove: detach,
  parentNode: n => n.parent,
  nextSibling: n => (n.parent ? n.parent.children[n.parent.children.indexOf(n) + 1] ?? null : null),
  patchProp: () => {},
});

describe("the scrub bar's claim on the Sim tab", () => {
  it("a re-mounted bar keeps the tab: the old bar's release leaves the new claim", async () => {
    const calls: string[] = [];
    // The bar's shape: claim in setup, publish, release on unmount.
    const Bar = defineComponent({
      props: { id: { type: String, required: true } },
      setup(p) {
        const release = claimSimActions({ jump: () => calls.push(`${p.id} jump`), step: () => calls.push(`${p.id} step`) });
        simView.available = true;
        simRows.value = [{ key: `${p.id}-row` } as never];
        onUnmounted(release);
        return () => h("bar");
      },
    });
    const which = ref("old");
    const app = createApp({ render: () => h(Bar, { key: which.value, id: which.value }) });
    app.mount(node("root"));
    // A keyed swap — a hot reload's order: the new bar mounts, then the old
    // bar's onUnmounted runs (post flush).
    which.value = "new";
    await nextTick();
    simStep(["clash"], 1);
    expect(calls, "the steps reach the new bar").toEqual(["new step"]);
    expect(simView.available, "the tab still shows the new bar's list").toBe(true);
    expect(simRows.value.map(r => r.key)).toEqual(["new-row"]);
    // Its own unmount releases it.
    app.unmount();
    simStep(["clash"], 1);
    expect(calls, "no bar, no step").toEqual(["new step"]);
    expect(simView.available).toBe(false);
    expect(simRows.value).toEqual([]);
  });
});
