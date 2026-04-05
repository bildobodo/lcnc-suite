<script setup lang="ts">
defineProps<{
  variant?: "default" | "primary" | "ok" | "danger" | "estop";
  size?: "xs" | "sm" | "md" | "lg";
  icon?: boolean;
  inline?: boolean;
  block?: boolean;
  active?: boolean;
  selected?: boolean;
  flashing?: boolean;
  warning?: boolean;
  muted?: boolean;
  mono?: boolean;
}>();
</script>

<template>
  <button
    :class="[
      icon ? 'b-icon' : inline ? 'b-inline' : 'b',
      !icon && !inline && (size ?? 'md'),
      !icon && !inline && (variant ?? 'default'),
      { active, selected, flashing, warning, block, muted, mono },
    ]"
  >
    <slot />
  </button>
</template>

<style scoped>
/* ---- Base ---- */
.b {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--gap-tight);
  border-radius: var(--radius-xl);
  border: 1px solid var(--border);
  font-weight: var(--fw-medium);
  font-family: inherit;
  background-color: var(--button-bg);
  color: var(--fg);
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, opacity 0.15s;
  overflow: hidden;
}
.b:hover:not(:disabled) { background: var(--hl-hover); }
.b:active:not(:disabled) { background: var(--hl-active); }
.b:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }

/* ---- Sizes ---- */
.xs { padding: 2px 8px; font-size: var(--fs-xs); }
.sm { padding: 5px 10px; font-size: var(--fs-sm); }
.md { padding: 8px 12px; font-size: var(--fs-base); }
.lg { padding: 10px 14px; font-size: var(--fs-md); }

/* ---- Variants ---- */
.primary {
  border-color: color-mix(in srgb, var(--ok) 50%, transparent);
  background: color-mix(in oklab, var(--ok) 25%, var(--button-bg));
  font-weight: var(--fw-semibold);
}

.ok {
  border-color: color-mix(in srgb, var(--ok) 50%, transparent);
  background: color-mix(in oklab, var(--ok) 25%, var(--button-bg));
}

.danger {
  border-color: color-mix(in srgb, var(--danger) 50%, transparent);
  background: color-mix(in oklab, var(--danger) 25%, var(--button-bg));
}

.estop {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 50%, transparent);
}

/* ---- Active state (variant-aware) ---- */
.active.default,
.active.ok,
.active.primary {
  border-color: color-mix(in srgb, var(--ok) 50%, transparent);
  background: color-mix(in oklab, var(--ok) 20%, var(--button-bg));
}

.active.danger,
.active.estop {
  border-color: color-mix(in srgb, var(--danger) 50%, transparent);
  background: color-mix(in oklab, var(--danger) 20%, var(--button-bg));
}

/* ---- Selected state (neutral, non-green) ---- */
.b.selected {
  background: var(--hl-selected);
  font-weight: var(--fw-semibold);
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

/* ---- Flashing (E-Stop) ---- */
.flashing {
  animation: flash-estop 0.6s step-start infinite;
}

@keyframes flash-estop {
  0%, 100% { background: color-mix(in oklab, var(--danger) 40%, var(--button-bg)); }
  50% { background: var(--button-bg); }
}

/* ---- Warning (yellow/amber pulse) ---- */
.b.warning {
  border-color: color-mix(in srgb, var(--warn) 50%, transparent);
  background: color-mix(in oklab, var(--warn) 20%, var(--button-bg));
  animation: pulse-warn 1s ease-in-out infinite;
}
@keyframes pulse-warn {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* ---- Muted (dimmed until active/selected/hover) ---- */
.b.muted { opacity: var(--opacity-muted); }
.b.muted:hover:not(:disabled) { opacity: 1; }
.b.muted.active,
.b.muted.selected { opacity: 1; }

/* ---- Mono (monospace font) ---- */
.b.mono { font-family: var(--font-mono); }

/* ---- Block ---- */
.block { width: 100%; }

/* ---- Icon button ---- */
.b-icon {
  background: none;
  border: none;
  padding: 2px 6px;
  font-size: inherit;
  color: inherit;
  opacity: var(--opacity-muted);
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: opacity 0.15s, background 0.15s;
}
.b-icon:hover:not(:disabled) { opacity: var(--opacity-secondary); background: color-mix(in oklab, var(--fg) 10%, transparent); }
.b-icon:active:not(:disabled) { opacity: 1; }
.b-icon:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }

/* ---- Inline button ---- */
.b-inline {
  padding: 4px 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  font-family: inherit;
  background-color: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, opacity 0.15s;
}
.b-inline:hover:not(:disabled) { background: var(--hl-hover); }
.b-inline:active:not(:disabled) { background: var(--hl-active); }
.b-inline:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }
</style>
