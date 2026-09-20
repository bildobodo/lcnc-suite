<script setup lang="ts">
import { computed, onUnmounted, ref, useAttrs, watch } from 'vue';
import { usePermissions } from './permissions';
import { INPUT_DEFS, INPUT_SIZE_STYLES, type InputType, type InputDef } from './machineControls';
import { openKeypad, keypadState, closeKeypadIf, newKeypadOwnerId } from './useNumberKeypad';
import type { EntryConstraints } from './mathEval';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  gate: InputType;
  disabled?: boolean;
  /** Field name shown in the keypad header (e.g. "Diameter"). */
  label?: string;
  /** Full target context for the keypad readout ("T12 · Diameter · mm"). */
  context?: string;
  /** Whole numbers only — tool number, pocket, flutes (UI-11). `step` is
   *  NOT read as a precision hint; this is the one explicit integer flag. */
  integer?: boolean;
}>();

const attrs = useAttrs();
const model = defineModel<string | number | null>();
const can = usePermissions();
const def = computed((): InputDef => INPUT_DEFS[props.gate]);
const isDisabled = computed(() => !can.value[def.value.gate] || props.disabled);
const isNumber = computed(() => attrs.type === 'number');

const catalogStyle = computed(() => {
  const d = def.value;
  const s: Record<string, string> = {};
  if (d.align) s.textAlign = d.align;
  if (d.width) s.width = d.width;
  if (d.mono) s.fontVariantNumeric = 'tabular-nums';
  if (d.size && INPUT_SIZE_STYLES[d.size]) Object.assign(s, INPUT_SIZE_STYLES[d.size]);
  return Object.keys(s).length ? s : undefined;
});

const keypadDisplayValue = computed(() =>
  attrs.value !== undefined ? (attrs.value as string | number | undefined) : model.value
);

// Field contract handed to the keypad: min/max from the attrs (never
// clamped there — an out-of-range value is refused), integer from the prop.
function numAttr(name: string): number | undefined {
  const raw = attrs[name];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
const constraints = computed<EntryConstraints | null>(() => {
  const c: EntryConstraints = {};
  const min = numAttr('min'), max = numAttr('max');
  if (min !== undefined) c.min = min;
  if (max !== undefined) c.max = max;
  if (props.integer) c.integer = true;
  return Object.keys(c).length ? c : null;
});

const inputEl = ref<HTMLInputElement | null>(null);
// Owner identity for the keypad session (UI-13): closing is scoped to THIS
// field — a keypad opened for another field is never touched from here.
const ownerId = newKeypadOwnerId('input');
const isKeypadActive = computed(() => keypadState.open && keypadState.ownerId === ownerId);

function openKeypadFromInput(e: Event) {
  if (isDisabled.value) return;
  openKeypad({
    value: keypadDisplayValue.value ?? null,
    label: props.label,
    context: props.context,
    ownerId,
    constraints: constraints.value,
    canConfirm: () => !isDisabled.value && !!inputEl.value?.isConnected,
    trigger: e.currentTarget as HTMLElement,
    onConfirm: (v) => {
      model.value = v;
      // Native input/change events don't fire for keypad confirms — synthesize them
      // so both :value+@input parents and v-model+@change parents react.
      const evt = { target: { value: String(v) } } as unknown as Event;
      const onInput = attrs.onInput as ((e: Event) => void) | undefined;
      if (typeof onInput === 'function') onInput(evt);
      const onChange = attrs.onChange as ((e: Event) => void) | undefined;
      if (typeof onChange === 'function') onChange(evt);
    },
  });
}

// The gate closing mid-entry (disarm, machine state change) ends the session
// through the same owner path as unmount — the value can no longer be
// delivered to this field, so the keypad must not stay up promising it.
watch(isDisabled, (off) => { if (off) closeKeypadIf(ownerId, 'field disabled while the keypad was open'); });
onUnmounted(() => closeKeypadIf(ownerId));
</script>

<template>
  <!-- Number inputs: read-only display field that opens the keypad on click/Enter/Space. -->
  <input
    v-if="isNumber"
    ref="inputEl"
    v-bind="attrs"
    type="text"
    :style="catalogStyle"
    :value="keypadDisplayValue"
    :disabled="isDisabled"
    readonly
    inputmode="none"
    lang="en"
    class="inputField"
    :class="{ 'keypad-active': isKeypadActive }"
    @click="openKeypadFromInput"
    @keydown.enter.prevent="openKeypadFromInput"
    @keydown.space.prevent="openKeypadFromInput"
  >
  <!-- Text-like inputs: standard editable field. -->
  <input
    v-else
    v-bind="attrs"
    :style="catalogStyle"
    v-model="model"
    :disabled="isDisabled"
    lang="en"
    class="inputField"
  >
</template>
