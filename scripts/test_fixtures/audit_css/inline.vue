<script setup lang="ts">
const w = 10;
</script>

<template>
  <div>
    <input style="width: 100%" />
    <div :style="{ width: w + 'px' }"></div>
    <div v-bind:style="{ width: w + 'px' }"></div>
    <!-- audit-ok: fixture — a static style that is allowed here -->
    <span style="width: 100%"></span>
  </div>
</template>
