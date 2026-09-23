<script setup lang="ts">
// The two fixed-position floating elements, rendered ONCE for the whole
// app: the transient control hint (btnHint.ts) and the keyboard glyph of
// the focused text field (inputSession.ts). Rendering them here keeps
// MachineBtn and MachineInput single-root components, so a parent's scoped
// CSS still reaches the button / input (implementation review UI-I07).
import { Keyboard } from "lucide-vue-next";
import { btnHint } from "./btnHint";
import { inputGlyph } from "./inputSession";
</script>

<template>
  <span v-if="btnHint.text" class="btnHint overlay-card" role="status" data-btn-hint
        :style="{ left: btnHint.left + 'px', top: btnHint.top + 'px' }">{{ btnHint.text }}</span>
  <button v-if="inputGlyph.ownerId" type="button" class="inputAction" :data-input-area="inputGlyph.ownerId"
          aria-label="Open keyboard" title="Open keyboard"
          :style="{ left: inputGlyph.left + 'px', top: inputGlyph.top + 'px' }"
          @pointerdown.prevent @click="inputGlyph.open?.()">
    <Keyboard :size="14" />
  </button>
</template>
