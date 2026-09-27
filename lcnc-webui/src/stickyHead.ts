import type { Directive } from "vue";

/**
 * `v-sticky-head` on a `.dataTable` scroller whose `thead` is sticky: keeps
 * `--sticky-head-h` at the head's height, which `.dataTable` uses as its
 * `scroll-padding-top` — a row focused by keyboard (Tab to its Edit button)
 * or scrolled into view lands BELOW the head instead of under it (WCAG 2.4.11
 * Focus Not Obscured; operator 2026-09-27: the tool table's header lost parts
 * of itself to the scrolled rows). The height follows the head (touch
 * padding, zoom, a wrapping heading) through a ResizeObserver.
 */
const observers = new WeakMap<HTMLElement, ResizeObserver>();

export const vStickyHead: Directive<HTMLElement> = {
  mounted(el) {
    const head = el.querySelector("thead");
    if (!head) return;
    // offsetHeight: layout px, what a CSS length means under CSS zoom too
    // (getBoundingClientRect() would return the zoomed viewport px).
    const apply = () => el.style.setProperty("--sticky-head-h", `${head.offsetHeight}px`);
    const ro = new ResizeObserver(apply);
    ro.observe(head);
    observers.set(el, ro);
    apply();
  },
  unmounted(el) {
    observers.get(el)?.disconnect();
    observers.delete(el);
  },
};
