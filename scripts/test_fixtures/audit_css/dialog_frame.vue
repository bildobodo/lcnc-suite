<template>
  <div>
    <div v-if="open" class="dialogOverlay" @click.self="open = false"><div class="dialog">Hand-built</div></div>
    <div class="panel" role="dialog" aria-label="Also hand-built"></div>
    <DialogFrame v-if="open" kind="confirm" title="The frame">Body</DialogFrame>
    <!-- audit-ok: fixture — suppressed on purpose -->
    <div class="dialogOverlay"></div>
    <div class="dialogOverlayNote">not an overlay</div>
  </div>
</template>
