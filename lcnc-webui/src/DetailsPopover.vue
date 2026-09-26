<script setup lang="ts">
// A labelled detail card behind one header button (design wave D5, UI-K06):
// technical readings that are not operating states (clients, latencies)
// leave the header's row and stay one tap away. A native `popover="auto"`
// (top layer, light dismiss, Escape still E-Stop — the capture listener
// runs first), placed from its laid-out size like HelpIcon (the same
// placePopover / cssZoomOf path, the same `.helpPopover` card, no dialog
// role — DialogFrame is the one dialog). NOT a HelpIcon: this is
// information, not help.
import { onBeforeUnmount, ref, useId } from "vue";
import MachineBtn from "./MachineBtn.vue";
import { placePopover, cssZoomOf } from "./helpPlacement";

const props = defineProps<{
  /** The trigger's accessible name and title ("Connection details"). */
  label: string;
}>();

const id = `details${useId()}`;
const btnWrap = ref<HTMLElement | null>(null);
const pop = ref<HTMLDivElement | null>(null);
const MARGIN = 6;

function trigger(): HTMLElement | null {
  return btnWrap.value?.querySelector("button") ?? null;
}

function position() {
  const b = trigger();
  const p = pop.value;
  if (!b || !p || !p.matches(":popover-open")) return;
  p.style.left = "0px";
  p.style.top = "0px";
  p.style.maxHeight = "";
  p.style.maxWidth = "";
  const z = cssZoomOf(p);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let size = p.getBoundingClientRect();
  if (size.width > vw - 2 * MARGIN) {
    p.style.maxWidth = `${(vw - 2 * MARGIN) / z}px`;
    size = p.getBoundingClientRect();
  }
  const r = b.getBoundingClientRect();
  const at = placePopover({ left: r.left, top: r.top, width: r.width, height: r.height },
    { width: size.width, height: size.height }, { width: vw, height: vh }, MARGIN);
  p.style.top = `${at.top / z}px`;
  p.style.left = `${at.left / z}px`;
  p.style.maxHeight = at.maxHeight === null ? "" : `${at.maxHeight / z}px`;
}

const open = ref(false);
function onBeforeToggle(e: Event) {
  open.value = (e as ToggleEvent).newState === "open";
  if (open.value) {
    requestAnimationFrame(position);
    window.addEventListener("resize", position);
  } else {
    window.removeEventListener("resize", position);
  }
}

// Light dismiss closes an open card on the trigger's pointerdown, before
// its click: the state at pointerdown decides (HelpIcon's rule).
let openAtPress = false;
function onPointerDown() { openAtPress = !!pop.value?.matches(":popover-open"); }
function toggle() {
  const p = pop.value;
  if (!p) return;
  const wasOpen = openAtPress || p.matches(":popover-open");
  openAtPress = false;
  if (wasOpen) { if (p.matches(":popover-open")) p.hidePopover(); }
  else p.showPopover();
}

onBeforeUnmount(() => window.removeEventListener("resize", position));
</script>

<template>
  <span ref="btnWrap" class="detailsTrigger">
    <MachineBtn type="headerIcon" :aria-label="props.label" :title="props.label" aria-haspopup="true"
                :aria-expanded="open" :aria-controls="id" @pointerdown="onPointerDown" @click="toggle">
      <slot name="icon" />
    </MachineBtn>
  </span>
  <!-- The card is the shared .helpPopover (fixed, placed, one look) -->
  <div :id="id" ref="pop" popover="auto" class="helpPopover" :aria-label="props.label"
       @beforetoggle="onBeforeToggle">
    <slot />
  </div>
</template>
