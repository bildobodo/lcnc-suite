<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, useAttrs, useSlots, type ComputedRef } from 'vue';
import Btn from './Btn.vue';
import { Square } from 'lucide-vue-next';
import { usePermissions } from './permissions';
import { BUTTON_TYPES, HOLD_FIRE_MS, type ButtonType, type ButtonDef } from './machineControls';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  type: ButtonType;
  variant?: 'default' | 'primary' | 'ok' | 'warn' | 'danger' | 'estop';
  disabled?: boolean;
  active?: boolean;
  selected?: boolean;
  muted?: boolean;
  mono?: boolean | undefined;
  block?: boolean;
  flashing?: boolean;
  warning?: boolean;
  icon?: boolean;
  inline?: boolean;
  /** Override the catalog's hold-to-fire flag for this instance. */
  hold?: boolean;
}>(), {
  // Catalog-aware props: undefined means "use catalog default"
  // Vue coerces absent booleans to false — we need undefined to detect "not passed"
  icon: undefined,
  muted: undefined,
  inline: undefined,
  mono: undefined,
  variant: undefined,
  hold: undefined,
});

const slots = useSlots();
const can = usePermissions();
// Provided by App.vue. Tests/standalone use of MachineBtn falls back to a
// dummy ref so the inject doesn't throw — `whileProbing` simply has no
// effect when no provider exists.
const probing = inject<ComputedRef<boolean>>('probing', computed(() => false));
const def = computed(() => BUTTON_TYPES[props.type] as ButtonDef);
const isDisabled = computed(() =>
  !can.value[def.value.gate]
  || props.disabled
  || (def.value.whileProbing === true && probing.value)
);
const useAbortDefault = computed(() => (props.type === 'abort' || props.type === 'bannerAbort') && !slots.default);
const resolvedVariant = computed(() => props.variant ?? def.value.variant);
const resolvedIcon = computed(() => props.icon ?? def.value.icon);
const resolvedMuted = computed(() => props.muted ?? def.value.muted);
const resolvedInline = computed(() => props.inline ?? def.value.inline);
const resolvedMono = computed(() => props.mono ?? def.value.mono);

// ── Hold-to-fire (ButtonDef.hold) ──
// The @click handler is withheld from the button and invoked by a timer
// after HOLD_FIRE_MS of uninterrupted press instead. Release, slide-off
// (10px slop) and pointercancel cancel — each says so on the console. Hold
// buttons carry `no-drag-scroll` so the strip's drag-scroll (5 px capture,
// dragScroll.ts) can no longer steal the pointer mid-hold (2026-09-04).
const attrs = useAttrs();
const holdEnabled = computed(() => props.hold ?? def.value.hold ?? false);
const holding = ref(false);
let holdTimer = 0;
let holdStartX = 0;
let holdStartY = 0;
const HOLD_MOVE_SLOP = 10; // px

const passAttrs = computed(() => {
  if (!holdEnabled.value) return attrs;
  const { onClick: _onClick, ...rest } = attrs;
  return rest;
});

function callClickHandler(e: Event) {
  const h = attrs.onClick as ((e: Event) => void) | Array<(e: Event) => void> | undefined;
  if (Array.isArray(h)) h.forEach((f) => f(e));
  else h?.(e);
}

let holdStartTs = 0;

// Every cancelled hold says so (console, like fire()'s drops): a swallowed
// press used to be indistinguishable from a working one — "sometimes it
// doesn't" (2026-09-04). A release before HOLD_FIRE_MS is the operator's
// tap; a leave/cancel is a pointer steal or slide-off.
function cancelHold(reason: string) {
  if (!holding.value) return;
  clearTimeout(holdTimer);
  holding.value = false;
  console.warn(`[hold] ${props.type} cancelled after ${Math.round(performance.now() - holdStartTs)} ms: ${reason} (hold ${HOLD_FIRE_MS} ms to fire)`);
}
const cancelHoldUp = () => cancelHold("released before the hold time");
const cancelHoldLeave = () => cancelHold("pointer left the button");
const cancelHoldCancel = () => cancelHold("pointer cancelled (drag-scroll / gesture took it)");

function onHoldPointerDown(e: PointerEvent) {
  if (!holdEnabled.value || e.button !== 0) return;
  if (isDisabled.value) {
    console.warn(`[hold] ${props.type} ignored: gate '${def.value.gate}' is closed`);
    return;
  }
  holdStartX = e.clientX;
  holdStartY = e.clientY;
  holdStartTs = performance.now();
  holding.value = true;
  clearTimeout(holdTimer);
  holdTimer = window.setTimeout(() => {
    holding.value = false;
    // Gate may have closed mid-hold (disarm, probe started) — re-check.
    if (isDisabled.value) {
      console.warn(`[hold] ${props.type} not fired: gate '${def.value.gate}' closed during the hold`);
      return;
    }
    callClickHandler(e);
  }, HOLD_FIRE_MS);
}

function onHoldPointerMove(e: PointerEvent) {
  if (!holding.value) return;
  if (Math.abs(e.clientX - holdStartX) > HOLD_MOVE_SLOP || Math.abs(e.clientY - holdStartY) > HOLD_MOVE_SLOP) {
    cancelHold("moved more than the slop");
  }
}

function onHoldContextMenu(e: Event) {
  // Long-press context menu would fire mid-hold on touch.
  if (holdEnabled.value) e.preventDefault();
}

onBeforeUnmount(() => clearTimeout(holdTimer));
</script>

<template>
  <Btn
    v-bind="passAttrs"
    :variant="resolvedVariant"
    :size="def.size"
    :icon="resolvedIcon"
    :muted="resolvedMuted"
    :inline="resolvedInline"
    :disabled="isDisabled"
    :active="active"
    :selected="selected"
    :mono="resolvedMono"
    :block="block"
    :flashing="flashing"
    :warning="warning"
    :holding="holding"
    :class="holdEnabled ? 'no-drag-scroll' : undefined"
    :style="holdEnabled ? { '--hold-duration': HOLD_FIRE_MS + 'ms' } : undefined"
    @pointerdown="onHoldPointerDown"
    @pointermove="onHoldPointerMove"
    @pointerup="cancelHoldUp"
    @pointercancel="cancelHoldCancel"
    @pointerleave="cancelHoldLeave"
    @contextmenu="onHoldContextMenu"
  >
    <template v-if="useAbortDefault"><Square :size="14" /> Abort</template>
    <slot v-else />
  </Btn>
</template>
