<script setup lang="ts">
const saving = true;
</script>

<template>
  <div>
    <span>{{ saving ? 'Saving...' : 'Save' }}</span>
    <span>{{ saving ? 'Saving…' : 'Save' }}</span>
    <Child v-bind="{ ...props, ...attrs }" @go="(...args) => go(...args)" />
    <!-- audit-ok: fixture — literal three dots allowed here -->
    <span>Loading...</span>
  </div>
</template>
