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
</script>

<template>
  <input v-bind="$attrs" type="range" v-model.number="model" :disabled="isDisabled" :min="min" :max="max" :step="step" @contextmenu.prevent
         :title="explainActive ? explainReason : ($attrs.title as string | undefined)" @pointerdown="explain">
</template>
