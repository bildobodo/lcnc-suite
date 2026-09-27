<script setup lang="ts">
const x = "a";
const cls = "scriptUsed";
</script>

<template>
  <div class="used">
    <span :class="`row-${x}`">row</span>
    <Transition name="fade"><span v-if="x">fade</span></Transition>
  </div>
</template>

<style scoped>
.used { display: block; }
.unused { display: block; }
.scriptUsed { display: block; }
.row-a { display: block; }
.fade-enter-active { transition: none; }
.ctx .used { display: block; }
/* audit-ok: fixture — a class set from outside this file */
.kept { display: block; }
</style>
