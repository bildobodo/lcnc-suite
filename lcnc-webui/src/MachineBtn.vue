<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, useAttrs, useSlots, type ComputedRef, type StyleValue } from 'vue';
import Btn from './Btn.vue';
import { Square } from 'lucide-vue-next';
import { usePermissions, usePermissionReasons, explainKeydown } from './permissions';
import { BUTTON_TYPES, HOLD_FIRE_MS, type ButtonType, type ButtonDef } from './machineControls';
import { armed, pushMessage } from './lcncWs';
import { OPERATOR_DISPLAY } from './lcnc';

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
  /** Why THIS instance is disabled when its own `disabled` prop closes it
   *  (U-06) — the catalog gate's reason is looked up automatically. */
  reason?: string;
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
const reasons = usePermissionReasons();
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
// Why this control is dimmed (U-06, review 2026-09-14): a disabled <button>
// swallows pointer events, so hover titles never showed and a tap did
// nothing — the reason lived only in a denial the button could not send.
// While disabled WITH a reason the button is wrapped in a .btnTip span
// carrying the title (hover) and a tap handler (touch) that puts the reason
// in the message center. Not while disarmed: the whole UI is dimmed then and
// Arm is the one obvious next step — wrapping every control for that would
// be noise, not help.
const disabledReason = computed<string | undefined>(() =>
  props.disabled ? (props.reason ?? reasons.value[def.value.gate]) : reasons.value[def.value.gate]);
const wrapped = computed(() => isDisabled.value && !!disabledReason.value && armed.value);
function explain() {
  if (wrapped.value && disabledReason.value) pushMessage(OPERATOR_DISPLAY, disabledReason.value);
}
// R-05 (implementation review 2026-09-15): the wrapper carried the reason on
// hover and on tap, which leaves a keyboard user tabbing straight past a
// disabled control AND its explanation. While wrapped it is a focusable help
// affordance — Enter and Space say why, exactly as the tap does. The inner
// control stays `disabled`, so the default-deny path is untouched and the
// machine action remains unreachable; the wrapper appears only while the
// control is disabled WITH a reason, so an enabled strip's tab order is
// unchanged.
const explainLabel = computed(() =>
  disabledReason.value ? `Why is this unavailable? ${disabledReason.value}` : undefined);
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
  let a: Record<string, unknown> = attrs;
  if (holdEnabled.value) { const { onClick: _onClick, ...rest } = a; a = rest; }
  // Wrapped: class/style belong to the wrapper (it is the layout item now —
  // a grid placement like .spanAll must land on it).
  if (wrapped.value) { const { class: _c, style: _s, ...rest } = a; a = rest; }
  return a;
});
const wrapperAttrs = computed(() => ({
  class: attrs.class as string | string[] | Record<string, boolean> | undefined,
  style: attrs.style as StyleValue | undefined,
}));

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
  <span v-if="wrapped" class="btnTip" :class="[wrapperAttrs.class, { 'btnTip--block': block }]" :style="wrapperAttrs.style"
        role="button" tabindex="0" :aria-label="explainLabel" :title="disabledReason"
        @click="explain" @keydown="(e: KeyboardEvent) => explainKeydown(e, explain)">
    <Btn
      v-bind="passAttrs"
      :variant="resolvedVariant"
      :size="def.size"
      :icon="resolvedIcon"
      :muted="resolvedMuted"
      :inline="resolvedInline"
      :disabled="true"
      :active="active"
      :selected="selected"
      :mono="resolvedMono"
      :block="block"
      :flashing="flashing"
      :warning="warning"
    >
      <template v-if="useAbortDefault"><Square :size="14" /> Abort</template>
      <slot v-else />
    </Btn>
  </span>
  <Btn
    v-else
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
