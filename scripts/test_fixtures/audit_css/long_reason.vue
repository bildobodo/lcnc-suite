<script setup lang="ts">
const SIM_REASON = "Machine on — power off to simulate";
const RESERVED_TITLE = "Reserved for the tilted-work-plane remap — rewritten by every orient. Touch off into G54–G58.";
</script>

<template>
  <div>
    <MachineBtn type="goTo" reason="Machine frame only — select Machine">Go</MachineBtn>
    <MachineBtn type="goTo" :reason="busy ? 'Go to WCS 0 under TCP: neither the machine top nor the tool axis is a world axis' : undefined">Go</MachineBtn>
    <MachineBtn type="goTo" :reason="why">Why</MachineBtn>
  </div>
</template>
