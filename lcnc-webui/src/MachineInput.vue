<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import { usePermissions } from './permissions';
import { INPUT_DEFS, INPUT_SIZE_STYLES, type InputType, type InputDef } from './machineControls';
import { openKeypad, keypadMode } from './useNumberKeypad';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  gate: InputType;
  disabled?: boolean;
  /** Explicitly opt this input into keypad mode regardless of the global setting. */
  keypad?: boolean;
  /** Label shown in the keypad dialog header. */
  label?: string;
}>();

const attrs = useAttrs();
const model = defineModel<string | number | null>();
const can = usePermissions();
const def = computed((): InputDef => INPUT_DEFS[props.gate]);
const isDisabled = computed(() => !can.value[def.value.gate] || props.disabled);
// Show keypad if explicitly requested, or if global keypad mode is on and this is a number input.
const showKeypad = computed(() => props.keypad || (keypadMode.value && attrs.type === 'number'));

const catalogStyle = computed(() => {
  const d = def.value;
  const s: Record<string, string> = {};
  if (d.align) s.textAlign = d.align;
  if (d.width) s.width = d.width;
  if (d.mono) s.fontFamily = 'var(--font-mono)';
  if (d.size && INPUT_SIZE_STYLES[d.size]) Object.assign(s, INPUT_SIZE_STYLES[d.size]);
  return Object.keys(s).length ? s : undefined;
});

// Merge both binding patterns: v-model parents supply model.value, :value+@input parents
// supply attrs.value. Avoids overriding attrs.value with undefined for the latter.
const keypadDisplayValue = computed(() =>
  model.value != null ? model.value : (attrs.value as string | number | undefined)
);

function openKeypadFromInput() {
  if (isDisabled.value) return;
  openKeypad({
    value: keypadDisplayValue.value ?? null,
    label: props.label,
    onConfirm: (v) => {
      model.value = v; // v-model parents
      // Also trigger @input for :value+@input parents (SetupStrip, SpindleStrip, DroPanel).
      const onInput = attrs.onInput as ((e: { target: { value: string } }) => void) | undefined;
      if (typeof onInput === 'function') onInput({ target: { value: String(v) } } as unknown as { target: { value: string } });
    },
  });
}
</script>

<template>
  <!-- Keypad mode: read-only display that opens the keypad on click/Enter/Space. -->
  <input
    v-if="showKeypad"
    v-bind="attrs"
    :style="catalogStyle"
    :value="keypadDisplayValue"
    :disabled="isDisabled"
    readonly
    inputmode="none"
    lang="en"
    class="keypad-input"
    @click="openKeypadFromInput"
    @keydown.enter.prevent="openKeypadFromInput"
    @keydown.space.prevent="openKeypadFromInput"
  >
  <!-- Normal mode: standard editable input. -->
  <input
    v-else
    v-bind="attrs"
    :style="catalogStyle"
    v-model="model"
    :disabled="isDisabled"
    lang="en"
  >
</template>

<style scoped>
.keypad-input {
  cursor: pointer;
}
</style>
