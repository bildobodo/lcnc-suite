<script setup lang="ts">
const a = true;
</script>

<template>
  <div>
    <MachineBtn type="scrub">&#9664;</MachineBtn>
    <MachineBtn type="scrub" aria-label="Previous">&#9664;</MachineBtn>
    <MachineBtn type="scrub">{{ a ? '□' : '−' }}</MachineBtn>
    <MachineBtn type="scrub">Save</MachineBtn>
  </div>
</template>
