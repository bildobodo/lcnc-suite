<script setup lang="ts">
// The macro bar: one row of user macro buttons, scrolling sideways when they
// do not fit. App mounts it in ONE of two places by orientation (package 5,
// stage A, operator 2026-10-02): landscape under the content, over the strip;
// portrait inside the viewer column, between the 3D viewer and the side pane
// — the vertical middle column it used to take cost ~155 px of width there.
// An orientation change re-mounts it: a hold in progress ends with the
// unmounted button (MachineBtn clears its timer), and App puts the focus
// back on the same macro by its id (data-macro-id).
//
// Items (stage C): the macro FILES named in the `bar` setting, in its order
// (the earlier settings macros were dropped, operator 2026-10-02). A file
// that may not run now is dimmed with its reason
// at the button (macroRunBlock: the open editor, the gateway's verdict); a
// `FRAME machine` file also needs the machineFrame gate, like the gateway.
//
// Operator 2026-10-02 (live look): the bar is a DENSE area — its buttons
// take the compact control height (28 / 36 px, like the strip and tables) —
// and Abort sits at its right end, OUTSIDE the scrolling row: the macros
// scroll under the fade, Abort never leaves the bar.
import { computed } from "vue";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import { useFire, usePermissions, usePermissionReasons } from "./permissions";
import { macroEditorBasis } from "./macroFiles";
import { fileHoldKey, macroRunBlock, type MacroBarItem } from "./macroBar";

const props = defineProps<{
  items: MacroBarItem[];
}>();
const emit = defineEmits<{ run: [item: MacroBarItem] }>();
const can = usePermissions();
const fire = useFire();
const reasons = usePermissionReasons();

const shown = computed(() => props.items.map(item => {
  const f = item.file;
  let block = macroRunBlock(f, macroEditorBasis.value);
  if (!block && f.frame === "machine" && !can.value.machineFrame) block = reasons.value.machineFrame ?? "Machine frame only";
  return { item, id: `file:${f.name}`, hold: f.params.length === 0, holdKey: fileHoldKey(f), block };
}));
</script>

<template>
  <Gate gate="armed" class="macroBar bordered-panel row-controls">
    <div class="macroScroll row-controls scroll-thin">
      <!-- Scroll-edge affordances (see .stripFade): both edges fade when
           content is hidden. -->
      <div class="stripFadeStart" aria-hidden="true"></div>
      <!-- A macro without parameters runs on a hold bound to its file's
           revision; one with parameters opens its dialog on a tap (no motion yet) -->
      <MachineBtn v-for="b in shown" :key="b.item.key" type="macro" class="macroBtn" :data-macro-id="b.id" :hold="b.hold"
                  :hold-key="b.holdKey" :disabled="!!b.block" :reason="b.block ?? undefined"
                  @click="emit('run', b.item)">{{ b.item.label }}</MachineBtn>
      <div class="stripFade" aria-hidden="true"></div>
    </div>
    <MachineBtn type="abort" class="macroAbort" @click="fire({ cmd: 'abort' }, 'abort')" />
  </Gate>
</template>

<style scoped>
.macroBar {
  flex-shrink: 0;
  padding: var(--gap-tight) var(--gap-controls);
  border-radius: var(--radius-container);
}
/* The macros scroll; Abort beside them does not. */
.macroScroll {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
}
.macroAbort {
  flex: none;
}

/* A button keeps its whole name: the row scrolls, a button never squeezes
   (nine macros in a 600 px portrait column cut every name off). */
.macroBtn {
  flex: none;
}

/* Scroll-edge fades — zero-width sticky children; the gradient hangs
   inward over the content (the strip's own fade lives in App.vue). The
   scrolling row fades both edges. */
.macroScroll > .stripFade,
.macroScroll > .stripFadeStart {
  position: sticky;
  flex: 0 0 0px;
  align-self: stretch;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
  z-index: var(--z-raised);
}
.macroScroll > .stripFade { right: 0; }
.macroScroll > .stripFadeStart { left: 0; }
.macroScroll > .stripFade::before,
.macroScroll > .stripFadeStart::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: calc(2 * var(--gap-panel) + var(--gap-controls));
  /* Solid paint + alpha mask with the same eased curve as .fade-scroll
     (style.css) — NOT a color gradient (macOS Firefox color management
     renders gradient ramps unevenly). */
  background: var(--panel);
}
/* The scroller has no padding of its own (the bar pads it): the fades sit
   at its edges. */
.macroScroll > .stripFade::before {
  right: 0;
  -webkit-mask-image: linear-gradient(to right,
    transparent 0%, rgba(0, 0, 0, 0.15) 40%, rgba(0, 0, 0, 0.45) 70%,
    rgba(0, 0, 0, 0.8) 88%, black 100%);
  mask-image: linear-gradient(to right,
    transparent 0%, rgba(0, 0, 0, 0.15) 40%, rgba(0, 0, 0, 0.45) 70%,
    rgba(0, 0, 0, 0.8) 88%, black 100%);
}
.macroScroll > .stripFadeStart::before {
  left: 0;
  -webkit-mask-image: linear-gradient(to right,
    black 0%, rgba(0, 0, 0, 0.8) 12%, rgba(0, 0, 0, 0.45) 30%,
    rgba(0, 0, 0, 0.15) 60%, transparent 100%);
  mask-image: linear-gradient(to right,
    black 0%, rgba(0, 0, 0, 0.8) 12%, rgba(0, 0, 0, 0.45) 30%,
    rgba(0, 0, 0, 0.15) 60%, transparent 100%);
}
.macroScroll.strip-more > .stripFade,
.macroScroll.strip-scrolled > .stripFadeStart {
  opacity: 1;
}
</style>
