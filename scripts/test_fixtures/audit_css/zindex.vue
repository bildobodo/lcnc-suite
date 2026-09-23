<script setup lang="ts">
</script>

<template>
  <div class="a"><div class="b"></div><div class="c"></div></div>
</template>

<style scoped>
.a { position: relative; z-index: 5; }
.b { position: absolute; z-index: var(--z-float); }
.c {
  position: absolute;
  z-index: 3; /* audit-ok: fixture — deliberate literal */
}
</style>
