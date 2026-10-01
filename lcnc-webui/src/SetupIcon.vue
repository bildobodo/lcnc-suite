<script setup lang="ts">
// The Setup strip's axis actions as symbols (operator 2026-10-01: "bei home
// ein Haussymbol gefolgt von dem Achslabel, bei unhome ein durchgestrichenes
// Haussymbol, bei zero ein Ursprungssymbol"): a house, the same house struck
// through, and the datum mark other machine UIs use — a circle with two
// opposite quadrants filled under a crosshair. Drawn here (24 × 24, stroke
// currentColor like the lucide set) so home and unhome are the same house.
// Decoration only: the button names the action (aria-label).
withDefaults(defineProps<{ kind: "zero" | "home" | "unhome"; size?: number }>(), { size: 16 });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <template v-if="kind === 'zero'">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 12V5a7 7 0 0 0-7 7z M12 12v7a7 7 0 0 0 7-7z" fill="currentColor" stroke="none" />
      <path d="M12 2v20M2 12h20" />
    </template>
    <template v-else>
      <path d="M4 10.5 12 4l8 6.5V20H4z" />
      <path d="M10 20v-5h4v5" />
      <path v-if="kind === 'unhome'" d="M3 3l18 18" />
    </template>
  </svg>
</template>
