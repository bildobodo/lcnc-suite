<script setup lang="ts">
defineProps<{
  variant?: "default" | "primary" | "warn" | "danger" | "estop";
  size?: "xs" | "sm" | "md" | "lg" | "cell";
  icon?: boolean;
  inline?: boolean;
  block?: boolean;
  active?: boolean;
  selected?: boolean;
  flashing?: boolean;
  warning?: boolean;
  muted?: boolean;
  mono?: boolean;
  /** Hold-to-fire press in progress (MachineBtn) — animates the fill. */
  holding?: boolean;
  /** A tab of a TabNav (design wave D3): main = top-rounded, open to the
   *  content when selected; sub = underlined when selected. */
  tab?: "main" | "sub";
}>();
</script>

<template>
  <button
    :class="[
      icon ? 'b-icon' : inline ? 'b-inline' : 'b',
      !inline && (size ?? 'md'),
      !icon && !inline && (variant ?? 'default'),
      { active, selected, flashing, warning, block, muted, mono, holding },
      tab && `tab-${tab}`,
    ]"
  >
    <slot />
  </button>
</template>

<style scoped>
/* ---- Base ---- */
.b {
  position: relative; /* anchor for the .holding fill overlay */
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
html:not(.touch-device) .b:hover:not(:disabled) { background: var(--hl-hover); }
/* :active is NOT hover-gated: unlike hover it cannot stick after a tap,
   and it is the only "tap registered" feedback a touch operator gets. */
.b:active:not(:disabled) { background: var(--hl-active); }
.b:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }

/* ---- Sizes ---- */
.xs { padding: 2px 8px; font-size: var(--fs-xs); }
.sm { padding: 5px 10px; font-size: var(--fs-sm); }
.md { padding: 8px 12px; font-size: var(--fs-base); }
/* A square glyph cell (the probe grids): the glyph fills the button. Its
   interior lives HERE, not in the caller's class — a class on a MachineBtn
   places it (slot), because a dimmed button's class lands on its .btnTip
   wrapper (design wave D1 live look: the probe cells shrank under TCP). */
.cell { padding: 4px; font-size: var(--fs-base); }
.lg { padding: 10px 14px; font-size: var(--fs-md); }
/* Control height (design wave D4, UI-K03): in the side pane and in dialogs
   an md TEXT button is exactly as tall as the field beside it
   (--control-h, 32 / 44 px). Not the icon buttons (.b-icon): a dialog's X
   keeps the header's line box (32 px grew every dialog header by 4 px and
   left Settings 67 px of content at 1280 × 720). The strip keeps its own
   button sizes (its density: D6). */
:where(.sidePane, .dialog) .b.md { padding-block: 0; min-height: var(--control-h); }

/* Touch: min-heights come from the global button rule in style.css
   (touch sizing layer); narrow variants additionally need a width floor
   so xs/sm text buttons and icon glyphs aren't sub-fingertip wide. */
html.touch-device .b.xs,
html.touch-device .b.sm { min-width: var(--touch-target); }
html.touch-device .b-icon { min-width: 40px; }

/* ---- Variants ---- */
.primary {
  border-color: color-mix(in srgb, var(--ok) var(--tint-edge), transparent);
  background: color-mix(in oklab, var(--ok) var(--tint-fill), var(--button-bg));
  font-weight: var(--fw-semibold);
}

/* Static warn tint (findings, cautions) — same formula as .danger.
   Distinct from the pulsing `warning` STATE prop, which signals an active
   alarm rather than a persistent finding. */
.warn {
  border-color: color-mix(in srgb, var(--warn) var(--tint-edge), transparent);
  background: color-mix(in oklab, var(--warn) var(--tint-fill), var(--button-bg));
}

.danger {
  border-color: color-mix(in srgb, var(--danger) var(--tint-edge), transparent);
  background: color-mix(in oklab, var(--danger) var(--tint-fill), var(--button-bg));
}

.estop {
  color: var(--danger-text);
  border-color: color-mix(in srgb, var(--danger) var(--tint-edge), transparent);
}

/* ---- Active state (variant-aware) ---- */
/* Two axes (design wave D10, UI-K14): the VARIANT says what an action is
   (primary = the group's main action, warn, danger, estop), the ACTIVE
   state what the machine is (armed, powered, a toggled mode) — green is the
   machine's "on", never a variant of its own. */
.active.default,
.active.primary {
  border-color: color-mix(in srgb, var(--ok) var(--tint-edge), transparent);
  background: color-mix(in oklab, var(--ok) var(--tint-active), var(--button-bg));
}

.active.danger,
.active.estop {
  border-color: color-mix(in srgb, var(--danger) var(--tint-edge), transparent);
  background: color-mix(in oklab, var(--danger) var(--tint-active), var(--button-bg));
}

/* ---- Selected state (neutral, non-green) ---- */
.b.selected {
  background: var(--hl-selected);
  font-weight: var(--fw-semibold);
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

/* ---- Flashing (E-Stop) ---- */
.flashing {
  animation: flash-estop var(--flash-duration) step-start infinite;
}

@keyframes flash-estop {
  0%, 100% { background: color-mix(in oklab, var(--danger) var(--tint-heavy), var(--button-bg)); }
  50% { background: var(--button-bg); }
}

/* ---- Warning (yellow/amber pulse) ----
   The pulse moves the background between its warn fill and none — never
   the label (design wave D8: it faded the whole button to 50 %). */
.b.warning {
  border-color: color-mix(in srgb, var(--warn) var(--tint-edge), transparent);
  --pulse-on: color-mix(in oklab, var(--warn) var(--tint-active), var(--button-bg));
  --pulse-off: var(--button-bg);
  background: var(--pulse-on);
  animation: pulse-warn 1s ease-in-out infinite;
}
.b-icon.warning {
  color: var(--warn-text);
  --pulse-on: color-mix(in oklab, var(--warn) var(--tint-active), transparent);
  --pulse-off: transparent;
  background: var(--pulse-on);
  border-radius: var(--radius-md);
  animation: pulse-warn 1s ease-in-out infinite;
}
@keyframes pulse-warn {
  0%, 100% { background: var(--pulse-on); }
  50% { background: var(--pulse-off); }
}

/* ---- Muted (the unselected tabs) ----
   A muted LABEL, not a faded button (design wave D8, UI-D07): the text
   takes --fg-muted (≥ 4.5 : 1, contrast.spec), the box keeps its border and
   fill — an opacity faded the words to 3.6 : 1. Hover, a press and the
   selection bring the full colour. */
.b.muted { color: var(--fg-muted); }
html:not(.touch-device) .b.muted:hover:not(:disabled),
.b.muted:active:not(:disabled),
.b.muted.active,
.b.muted.selected { color: var(--fg); }

/* ---- Tabs (TabNav, design wave D3, UI-K12/K17) ----
   Selection is a SHAPE, not a colour alone: the selected main tab opens
   into the content below it (it covers the list's baseline), the selected
   sub tab carries a 2 px bar. Focus is the global :focus-visible ring —
   selection and focus never share a signal. Height: --control-h. */
.b.tab-main,
.b.tab-sub { min-height: var(--control-h); }
.b.tab-main {
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  border-bottom-color: transparent;
}
/* The selected tab paints over the list's 1 px baseline below it (a
   shadow is not clipped by the button's overflow, and moves nothing). */
.b.tab-main.selected {
  background: var(--panel);
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
  border-bottom-color: transparent;
  box-shadow: 0 1px 0 var(--panel);
}
.b.tab-sub {
  border-color: transparent;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  background: transparent;
}
.b.tab-sub.selected {
  background: transparent;
  box-shadow: inset 0 -2px 0 var(--fg);
}

/* ---- Mono — tabular-nums (digit column alignment, sans font) ---- */
.b.mono { font-variant-numeric: tabular-nums; }

/* ---- Hold-to-fire fill (MachineBtn hold behavior) ----
   Left-to-right fill over --hold-duration; the action fires when the
   JS timer (source of truth) completes — the animation is visual only. */
.b.holding::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--hl-active);
  transform-origin: left;
  transform: scaleX(0);
  animation: hold-fill var(--hold-duration, 500ms) linear forwards;
  pointer-events: none;
}
@keyframes hold-fill {
  to { transform: scaleX(1); }
}
/* No resting mark on a hold button (operator decision 2026-09-26): the 2 px
   track along the bottom edge (UX-12) took the corner radius and read as a
   stray shadow on every enabled hold button. The contract shows as the
   fill above while held, the "Hold to activate" title and the hint a tap
   gets. */

/* ---- Block ---- */
.block { width: 100%; }

/* ---- Icon button ---- */
.b-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* An icon with a caption (Shutdown) keeps them apart, like .b does. */
  gap: var(--gap-tight);
  background: none;
  border: none;
  padding: 6px 8px;
  font-size: inherit;
  /* Muted by COLOUR (D8): the glyph and a caption ("Shut Down") at
     --fg-muted; hover and a press bring the full colour. */
  color: var(--fg-muted);
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: color 0.15s, background 0.15s;
}
.b-icon.xs { padding: 2px 4px; font-size: var(--fs-xs); }
.b-icon.sm { padding: 3px 6px; font-size: var(--fs-sm); }
html:not(.touch-device) .b-icon:hover:not(:disabled) { color: var(--fg); background: var(--hl-surface); }
.b-icon:active:not(:disabled) { color: var(--fg); background: var(--hl-surface); }
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
html:not(.touch-device) .b-inline:hover:not(:disabled) { background: var(--hl-hover); }
.b-inline:active:not(:disabled) { background: var(--hl-active); }
.b-inline:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }

/* Motion is optional (design wave D8): the E-Stop flash and the warning
   pulse stop; the state stays the static fill. */
@media (prefers-reduced-motion: reduce) {
  .flashing,
  .b.warning,
  .b-icon.warning { animation: none; }
  .flashing { background: color-mix(in oklab, var(--danger) var(--tint-heavy), var(--button-bg)); }
}
/* Forced colours drop backgrounds and shadows — a selection (a tab's
   shape, a pressed page key) takes the system's selected-item colours. */
@media (forced-colors: active) {
  .b.selected {
    forced-color-adjust: none;
    background: SelectedItem;
    color: SelectedItemText;
    border-color: SelectedItemText;
  }
}
</style>
