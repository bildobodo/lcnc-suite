<script setup lang="ts">
import { computed } from 'vue';
import { usePermissions } from './permissions';
import { INPUT_DEFS, type InputType } from './machineControls';
import { useGateExplain } from './gateExplain';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  gate: InputType;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
}>();

const model = defineModel<number>();
const can = usePermissions();
const def = computed(() => INPUT_DEFS[props.gate]);
const isDisabled = computed(() => !can.value[def.value.gate] || props.disabled);
// Input-rooted: the reason on hover and on pointerdown (UX-09, gateExplain.ts).
const { active: explainActive, reason: explainReason, explain } =
  useGateExplain({ gate: () => def.value.gate, disabled: () => isDisabled.value });
// The value is a BOUND prop, never v-model: v-model writes the element's
// value before the render patches min/max/step, and a range input clamps it
// to the OLD range — a value past the old max that arrives with a longer
// range (the scrub bar's first finding jump builds the entry move) showed
// its thumb at the old end. Vue patches `value` after every other prop.
function onInput(e: Event) {
  model.value = Number((e.target as HTMLInputElement).value);
}
</script>

<template>
  <input @input="onInput" v-bind="$attrs" type="range" :disabled="isDisabled" :min="min" :max="max" :step="step" :value="model" @contextmenu.prevent
         :title="explainActive ? explainReason : ($attrs.title as string | undefined)" @pointerdown="explain">
</template>
