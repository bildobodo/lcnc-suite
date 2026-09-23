<script setup lang="ts">
</script>

<template>
  <div class="row">x</div>
</template>

<style scoped>
/* Valid uses: the token AS the colour, alone or as a color-mix colour. */
.row:hover {
  background: var(--hl-hover);
}
.row.selected {
  background: color-mix(in oklab, var(--hl-selected) 50%, transparent);
}
.row:active {
  background: color-mix(in oklab, var(--hl-active), var(--bg));
}
</style>
