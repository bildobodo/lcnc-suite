<script setup lang="ts">
// The two fixed-position floating elements, rendered ONCE for the whole
// app: the transient control hint (btnHint.ts) and the keyboard glyph of
// the focused text field (inputSession.ts). Rendering them here keeps
// MachineBtn and MachineInput single-root components, so a parent's scoped
// CSS still reaches the button / input (implementation review UI-I07).
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Keyboard } from "lucide-vue-next";
import { btnHint, hintAnchor, hideBtnHint } from "./btnHint";
import { inputGlyph } from "./inputSession";
import { placePopover, cssZoomOf } from "./helpPlacement";

const MARGIN = 6;
const hintEl = ref<HTMLElement>();

// Placed from its RENDERED size (the help popover's rule, UI-D08): reset
// the inline geometry, cap the width by the viewport, measure, place above
// the control when it fits, else below, clamped to every edge. Viewport px
// ÷ CSS zoom = the hint's own left/top. No anchor (it left the document) →
// no hint: a reason floating over nothing explains nothing.
function placeHint() {
  const el = hintEl.value;
  if (!el || !btnHint.text) return;
  const anchor = hintAnchor();
  if (!anchor) { hideBtnHint(); return; }
  el.style.left = "0px";
  el.style.top = "0px";
  el.style.maxWidth = "";
  const z = cssZoomOf(el);
  const vw = window.innerWidth, vh = window.innerHeight;
  let size = el.getBoundingClientRect();
  if (size.width > vw - 2 * MARGIN) {
    el.style.maxWidth = `${(vw - 2 * MARGIN) / z}px`;
    size = el.getBoundingClientRect();
  }
  const r = anchor.getBoundingClientRect();
  const at = placePopover({ left: r.left, top: r.top, width: r.width, height: r.height },
    { width: size.width, height: size.height }, { width: vw, height: vh }, MARGIN, "above");
  el.style.left = `${at.left / z}px`;
  el.style.top = `${at.top / z}px`;
}

watch(() => btnHint.seq, async () => {
  await nextTick();
  requestAnimationFrame(placeHint);
});

// The hint belongs to a place on the screen and to the touch that asked for
// it: it closes when the page scrolls under it (capture — any scroll
// container) and on the NEXT pointer or key anywhere (operator, D1 live
// look: "must vanish when I click anywhere else — never linger over
// buttons"). Capture phase: the window sees the press before its target, so
// a press that asks again (a dimmed input explains on pointerdown, a dimmed
// button on click, a key on its wrapper) closes the old hint first and
// shows its own.
function hideOnInteraction() { if (btnHint.text) hideBtnHint(); }
onMounted(() => {
  window.addEventListener("scroll", hideOnInteraction, true);
  window.addEventListener("pointerdown", hideOnInteraction, true);
  window.addEventListener("keydown", hideOnInteraction, true);
  window.addEventListener("resize", placeHint);
});
onBeforeUnmount(() => {
  window.removeEventListener("scroll", hideOnInteraction, true);
  window.removeEventListener("pointerdown", hideOnInteraction, true);
  window.removeEventListener("keydown", hideOnInteraction, true);
  window.removeEventListener("resize", placeHint);
});
</script>

<template>
  <span v-if="btnHint.text" ref="hintEl" class="btnHint" role="status" data-btn-hint>{{ btnHint.text }}</span>
  <button v-if="inputGlyph.ownerId" type="button" class="inputAction" :data-input-area="inputGlyph.ownerId"
          aria-label="Open keyboard" title="Open keyboard"
          :style="{ left: inputGlyph.left + 'px', top: inputGlyph.top + 'px' }"
          @pointerdown.prevent @click="inputGlyph.open?.()">
    <Keyboard :size="14" />
  </button>
</template>
