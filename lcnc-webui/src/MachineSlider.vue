<script setup lang="ts">
import { computed } from 'vue';
import { usePermissions } from './permissions';
import { INPUT_GATES, type InputType } from './machineControls';

const props = defineProps<{
  gate: InputType;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
}>();

const model = defineModel<number>();
const can = usePermissions();
const isDisabled = computed(() => !can.value[INPUT_GATES[props.gate]] || props.disabled);
</script>

<template>
  <input type="range" v-model="model" :disabled="isDisabled" :min="min" :max="max" :step="step">
</template>
