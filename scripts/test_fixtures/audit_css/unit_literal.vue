<script setup lang="ts">
const v = 3;
</script>

<template>
  <div>
    <span>{{ v }}mm</span>
    <span>{{ `${v}%` }}</span>
    <span>{{ fmtQty(v, unit) }}</span>
    <div :style="{ width: v + '%' }">{{ v }} items</div>
    <div :style="{ left: `${v * 40}%` }"></div>
    <!-- audit-ok: fixture — a literal unit allowed here -->
    <span>{{ v }} ms</span>
  </div>
</template>
