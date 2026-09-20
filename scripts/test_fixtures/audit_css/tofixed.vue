<script setup lang="ts">
// Outside the template — script formatting is not the template's concern.
const s = (1.5).toFixed(1);
</script>

<template>
  <div>
    <span>{{ (2.5).toFixed(3) }}</span>
    <!-- audit-ok: fixture — tooltip precision -->
    <span :title="(3.5).toFixed(1)"></span>
    <span>{{ s }}</span>
  </div>
</template>
