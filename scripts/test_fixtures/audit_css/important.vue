<script setup lang="ts">
</script>

<template>
  <div class="a"><div class="b"></div></div>
</template>

<style scoped>
.a { width: 100% !important; }
.b {
  /* audit-ok: fixture — overrides a third-party inline style */
  width: 100% !important;
}
</style>
