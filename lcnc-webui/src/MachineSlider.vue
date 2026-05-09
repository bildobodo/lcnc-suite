<script setup lang="ts">
import { computed } from 'vue';
import { usePermissions } from './permissions';
import { INPUT_DEFS, type InputType } from './machineControls';

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
</script>

<template>
  <input v-bind="$attrs" type="range" v-model.number="model" :disabled="isDisabled" :min="min" :max="max" :step="step">
</template>
