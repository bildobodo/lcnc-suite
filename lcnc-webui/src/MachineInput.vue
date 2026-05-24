<script setup lang="ts">
import { computed, ref, useAttrs } from 'vue';
import { usePermissions } from './permissions';
import { INPUT_DEFS, INPUT_SIZE_STYLES, type InputType, type InputDef } from './machineControls';
import { openKeypad, keypadState } from './useNumberKeypad';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  gate: InputType;
  disabled?: boolean;
  /** Label shown in the keypad dialog header. */
  label?: string;
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

const inputEl = ref<HTMLInputElement | null>(null);
const isKeypadActive = computed(() => keypadState.trigger === inputEl.value);

function openKeypadFromInput(e: Event) {
  if (isDisabled.value) return;
  openKeypad({
    value: keypadDisplayValue.value ?? null,
    label: props.label,
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
