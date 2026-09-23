<script setup lang="ts">
const v = 1.2345;
const on = true;
</script>

<template>
  <div class="root">
    <template v-if="on">
      <span>nested</span>
    </template>
    <!-- Still inside the ROOT template after the nested close: the old
         first-close range ended above and never saw this line. -->
    <span>{{ v.toFixed(2) }}</span>
  </div>
</template>

<style scoped>
.root { position: relative; }
</style>
