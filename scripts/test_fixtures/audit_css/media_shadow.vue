<template>
  <div class="a"></div>
</template>

<style scoped>
@media (orientation: portrait) {
  .a { padding-left: 0; top: 0; }
  .b, .c { width: 100%; }
  .d { padding-left: 0; }
  .e { padding: 0; }
  .f { gap: 0 !important; }
  /* audit-ok: fixture — suppressed on purpose */
  .g { left: 0; }
}
@keyframes pulse { from { opacity: 1; } to { opacity: 0.5; } }
.a { padding-left: var(--gap-controls); }
.c { width: 280px; }
.d { padding: var(--gap-tight); }
.e { padding-left: var(--gap-tight); }
.f { gap: var(--gap-tight); }
.g { left: 4px; }
.h { top: 0; }
@media (orientation: portrait) {
  .h { top: auto; }
}
</style>
