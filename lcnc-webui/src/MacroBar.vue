<script setup lang="ts">
// The macro bar: one row of user macro buttons, scrolling sideways when they
// do not fit. App mounts it in ONE of two places by orientation (package 5,
// stage A, operator 2026-10-02): landscape under the content, over the strip;
// portrait inside the viewer column, between the 3D viewer and the side pane
// — the vertical middle column it used to take cost ~155 px of width there.
// An orientation change re-mounts it: a hold in progress ends with the
// unmounted button (MachineBtn clears its timer), and App puts the focus
// back on the same macro by its id (data-macro-id).
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import type { MacroDef } from "./defaults";

defineProps<{
  macros: MacroDef[];
  holdKey: (m: MacroDef) => string;
}>();
const emit = defineEmits<{ run: [m: MacroDef] }>();
</script>

<template>
  <Gate gate="armed" class="macroBar bordered-panel row-controls scroll-thin">
    <!-- Scroll-edge affordances (see .stripFade) — the macro bar has no
         pinned section, so both edges fade when content is hidden. -->
    <div class="stripFadeStart" aria-hidden="true"></div>
    <!-- A macro without parameters runs on a hold bound to its command; one
         with parameters opens its dialog on a tap (no motion yet) -->
    <MachineBtn v-for="m in macros" :key="m.id" type="macro" class="macroBtn" :data-macro-id="m.id" :hold="m.params.length === 0"
                :hold-key="holdKey(m)" @click="emit('run', m)">{{ m.name }}</MachineBtn>
    <div class="stripFade" aria-hidden="true"></div>
  </Gate>
</template>

<style scoped>
.macroBar {
  flex-shrink: 0;
  padding: var(--gap-tight) var(--gap-controls);
  overflow-x: auto;
  overflow-y: hidden;
  border-radius: var(--radius-container);
}

/* A button keeps its whole name: the row scrolls, a button never squeezes
   (nine macros in a 600 px portrait column cut every name off). */
.macroBtn {
  flex: none;
}

/* Scroll-edge fades — zero-width sticky children; the gradient hangs
   inward over the content (the strip's own fade lives in App.vue). The bar
   has no pinned section and fades both edges. */
.macroBar > .stripFade,
.macroBar > .stripFadeStart {
  position: sticky;
  flex: 0 0 0px;
  align-self: stretch;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
  z-index: var(--z-raised);
}
.macroBar > .stripFade { right: 0; }
.macroBar > .stripFadeStart { left: 0; }
.macroBar > .stripFade::before,
.macroBar > .stripFadeStart::before {
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
/* Hang past the sticky element by the scroller's edge padding: sticky is
   confined to the CONTENT box, but scrolled content stays visible through
   the padding and radius region. */
.macroBar > .stripFade::before {
  right: calc(-1 * var(--gap-controls));
  -webkit-mask-image: linear-gradient(to right,
    transparent 0%, rgba(0, 0, 0, 0.15) 40%, rgba(0, 0, 0, 0.45) 70%,
    rgba(0, 0, 0, 0.8) 88%, black 100%);
  mask-image: linear-gradient(to right,
    transparent 0%, rgba(0, 0, 0, 0.15) 40%, rgba(0, 0, 0, 0.45) 70%,
    rgba(0, 0, 0, 0.8) 88%, black 100%);
}
.macroBar > .stripFadeStart::before {
  left: calc(-1 * var(--gap-controls));
  -webkit-mask-image: linear-gradient(to right,
    black 0%, rgba(0, 0, 0, 0.8) 12%, rgba(0, 0, 0, 0.45) 30%,
    rgba(0, 0, 0, 0.15) 60%, transparent 100%);
  mask-image: linear-gradient(to right,
    black 0%, rgba(0, 0, 0, 0.8) 12%, rgba(0, 0, 0, 0.45) 30%,
    rgba(0, 0, 0, 0.15) 60%, transparent 100%);
}
.macroBar.strip-more > .stripFade,
.macroBar.strip-scrolled > .stripFadeStart {
  opacity: 1;
}
</style>
