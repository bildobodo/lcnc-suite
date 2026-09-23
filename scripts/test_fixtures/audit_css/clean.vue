<script setup lang="ts">
</script>

<template>
  <div class="ok">
    <template #slot>
      <span>slot</span>
    </template>
  </div>
</template>

<style scoped>
.ok { position: relative; z-index: var(--z-raised); }
</style>
