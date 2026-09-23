<script setup lang="ts">
const open = true;
</script>

<template>
  <div>
    <MachineBtn type="close" @click="open = false">&times;</MachineBtn>
    <MachineBtn type="close" aria-label="Close settings" @click="open = false"><X /></MachineBtn>
    <MachineBtn type="close" :aria-label="`Close ${name}`" @click="open = false"><X /></MachineBtn>
    <MachineBtn type="close"
                aria-label="Close on the next line" @click="open = false"><X /></MachineBtn>
    <!-- audit-ok: fixture — a nameless close that is allowed here -->
    <MachineBtn type="close" @click="open = false">&times;</MachineBtn>
  </div>
</template>
