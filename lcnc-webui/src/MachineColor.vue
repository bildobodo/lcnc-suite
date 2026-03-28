<script setup lang="ts">
import { computed } from 'vue';
import { usePermissions } from './permissions';
import { INPUT_GATES, type InputType } from './machineControls';

const props = defineProps<{
  gate: InputType;
  disabled?: boolean;
}>();

const model = defineModel<string>();
const can = usePermissions();
const isDisabled = computed(() => !can.value[INPUT_GATES[props.gate]] || props.disabled);
</script>

<template>
  <input type="color" v-model="model" :disabled="isDisabled">
</template>
