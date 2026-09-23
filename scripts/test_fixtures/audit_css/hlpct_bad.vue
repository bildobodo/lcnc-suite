<script setup lang="ts">
</script>

<template>
  <div class="kbKeyCell">x</div>
</template>

<style scoped>
/* The two real KeyboardTab.vue rules (before WP1): --hl-* is a COLOUR token
   used here in the percent slot — the browser dropped both declarations. */
.kbKeyCell:hover {
  background: color-mix(in oklab, var(--fg) var(--hl-hover), var(--bg));
}

.kbKeyCell.listening {
  background: color-mix(in oklab, var(--info) var(--hl-selected), var(--bg));
  outline: 1px solid var(--info);
}
</style>
