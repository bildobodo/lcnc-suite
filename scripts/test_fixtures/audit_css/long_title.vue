<script setup lang="ts">
const why = "a computed reason may be as long as it needs — it is the explain path's text";
</script>

<template>
  <div>
    <button title="MOVES to the G30 position: Z up to machine top first (never lowered), then X/Y, then Z. Machine frame only.">G30</button>
    <button :title="busy ? 'Busy' : 'Every other move is refused while a joint sits beyond its soft limit — jog it back inside first'">Go</button>
    <button title="Hold to move to the G30 position">G30</button>
    <button :title="why">Why</button>
    <button :title="`Previous collision (${n})`">◀</button>
    <!-- audit-ok: fixture — a long hover title allowed here -->
    <button title="This title is deliberately longer than ninety characters so the audit would flag it without the marker.">X</button>
  </div>
</template>
