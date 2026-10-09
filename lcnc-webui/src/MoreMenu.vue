<script setup lang="ts">
// The ONE "More" disclosure (operator 2026-10-02, live look): a tab's
// management — files, upload, edit, delete … — and its options sit behind
// one button at the RIGHT end of the tab's action row, so Program, Tools and
// Macros keep ONE row: the machine actions with Abort beside them on the
// left, More on the right.
//
// A disclosure (aria-expanded / aria-controls), not an ARIA menu: its items
// are the catalog's own buttons and toggles, with their gates and reasons.
// The panel is a native popover — the top layer, but in the DOM still inside
// the Gate's fieldset, so a closed gate disables its items like any other —
// placed from its laid-out size like HelpIcon's, its end edge on the
// trigger's.
//
// Keys: Enter / Space on the trigger toggle it (a native invoker, exempt
// from light dismiss); opened by keyboard, the focus goes to the first item.
// Inside, Up / Down / Home / End move among the items and EVERY arrow is
// default-prevented, with modifiers too — an arrow that reached the shortcut
// map would jog (the TabNav rule). Tab out of it or a press outside closes
// it; Escape stays E-Stop (the capture listener) and closes it natively.
// A press on an item that is a BUTTON closes the panel and puts the focus on
// the trigger first (capture phase) — before a dialog the item opens takes
// its opener — so the dialog's guarded return lands on More, never on a
// hidden item.
//
// The trigger keeps ONE width (operator 2026-10-03: "the button length
// changes"): it reserves its widest label — every option on, in the open
// state's semibold — so opening it (selected = semibold) or switching an
// option moves nothing in the row.
import { onBeforeUnmount, onMounted, ref, useId } from "vue";
import { ChevronDown, ChevronUp } from "lucide-vue-next";
import MachineBtn from "./MachineBtn.vue";
import { placePopover, cssZoomOf } from "./helpPlacement";

const props = defineProps<{
  /** The accessible name ("More program actions"). */
  label: string;
  /** Options that are ON while the panel is closed ("M01 /BD"): named on the
   *  trigger — they change how something runs. */
  folded?: string;
  /** Every option `folded` can name at once ("M01 /BD"): its width is
   *  reserved, so switching one on or off moves nothing. */
  reserve?: string;
}>();

const id = `more-${useId()}`;
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const pop = ref<HTMLDivElement | null>(null);
const MARGIN = 6;
const NAV_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];

function trigger(): HTMLButtonElement | null {
  return root.value?.querySelector<HTMLButtonElement>(":scope > .moreTrigger, :scope > .btnTip > .moreTrigger") ?? null;
}
function items(): HTMLElement[] {
  const p = pop.value;
  if (!p) return [];
  return [...p.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']")]
    .filter(e => e.offsetParent !== null || e.getClientRects().length > 0);
}

function position() {
  const t = trigger();
  const p = pop.value;
  if (!p || !p.matches(":popover-open")) return;
  if (!t) { p.style.visibility = ""; return; }
  p.style.left = "0px";
  p.style.top = "0px";
  p.style.maxHeight = "";
  const z = cssZoomOf(p);
  const size = p.getBoundingClientRect();
  const r = t.getBoundingClientRect();
  const at = placePopover({ left: r.left, top: r.top, width: r.width, height: r.height },
    { width: size.width, height: size.height }, { width: window.innerWidth, height: window.innerHeight },
    MARGIN, "below", "end");
  p.style.top = `${at.top / z}px`;
  p.style.left = `${at.left / z}px`;
  p.style.maxHeight = at.maxHeight === null ? "" : `${at.maxHeight / z}px`;
  p.style.visibility = "";   // placed: shown
}

function onBeforeToggle(e: Event) {
  open.value = (e as ToggleEvent).newState === "open";
  if (open.value) {
    // Laid out but not shown until it is placed: reopened after a resize or a
    // zoom it showed for a frame at its last place (the macros.spec gate
    // read it there, 2026-10-09).
    if (pop.value) pop.value.style.visibility = "hidden";
    const byKeyboard = !!trigger()?.matches(":focus-visible");
    requestAnimationFrame(() => {
      position();
      if (byKeyboard) items()[0]?.focus();
    });
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
  } else {
    window.removeEventListener("resize", position);
    window.removeEventListener("scroll", position, true);
  }
}

function close(focusTrigger: boolean) {
  const p = pop.value;
  if (p?.matches(":popover-open")) p.hidePopover();
  if (focusTrigger) trigger()?.focus();
}

function onKeydown(e: KeyboardEvent) {
  if (!NAV_KEYS.includes(e.key)) return;
  e.preventDefault();          // never the shortcut map's: an arrow there jogs
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const list = items();
  if (!list.length) return;
  const i = list.indexOf(document.activeElement as HTMLElement);
  const n = list.length;
  const next = e.key === "ArrowDown" ? list[(i + 1 + n) % n]
    : e.key === "ArrowUp" ? list[(i - 1 + n) % n]
    : e.key === "Home" ? list[0]
    : e.key === "End" ? list[n - 1] : null;
  next?.focus();
}

/** BEFORE an item's own click handler (capture phase): a BUTTON item closes
 *  the panel and hands the focus to the trigger (see the header). In the
 *  bubble phase it came too late — the item's handler had opened a dialog,
 *  Vue rendered it in the microtasks between the two listeners and the
 *  dialog had focused its field, which this then took away (measured). A
 *  toggle keeps the panel open — its new state shows where it was set. */
function onClick(e: MouseEvent) {
  const b = (e.target as Element | null)?.closest("button");
  if (b && pop.value?.contains(b)) close(true);
}

function onFocusOut(e: FocusEvent) {
  const to = e.relatedTarget as Node | null;
  if (to && root.value && !root.value.contains(to)) close(false);
}

onMounted(() => { pop.value?.addEventListener("beforetoggle", onBeforeToggle); });
onBeforeUnmount(() => {
  pop.value?.removeEventListener("beforetoggle", onBeforeToggle);
  window.removeEventListener("resize", position);
  window.removeEventListener("scroll", position, true);
});
defineExpose({ close: () => close(false) });
</script>

<template>
  <span ref="root" class="moreMenu">
    <MachineBtn type="more" class="moreTrigger" :popovertarget="id" :aria-controls="id" :aria-expanded="open"
                :aria-label="props.folded ? `${props.label} — ${props.folded} on` : props.label" :selected="open">
      <span class="moreLabel">
        <span>More<template v-if="props.folded"> · {{ props.folded }}</template></span>
        <span class="moreReserve" aria-hidden="true">More<template v-if="props.reserve"> · {{ props.reserve }}</template></span>
      </span>
      <component :is="open ? ChevronUp : ChevronDown" :size="14" />
    </MachineBtn>
    <!-- No display utility on the popover itself: an author `display` beats
         the UA rule that hides a closed popover (the items showed inline) -->
    <div :id="id" ref="pop" popover="auto" class="moreMenuPanel" @keydown="onKeydown" @click.capture="onClick" @focusout="onFocusOut">
      <div class="stack-tight moreMenuItems">
        <slot />
      </div>
    </div>
  </span>
</template>

<style scoped>
.moreMenu {
  display: inline-flex;
}
/* The label and its reserve share one grid cell: the cell is as wide as
   the reserve (the widest label, semibold), the shown label centred in it */
.moreLabel {
  display: inline-grid;
  justify-items: center;
}
.moreLabel > * {
  grid-area: 1 / 1;
}
.moreReserve {
  visibility: hidden;
  font-weight: var(--fw-semibold);
}
</style>
