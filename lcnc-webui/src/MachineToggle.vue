<script setup lang="ts">
import { computed } from 'vue';
import { usePermissions } from './permissions';
import { INPUT_GATES, type InputType } from './machineControls';

const props = defineProps<{
  gate: InputType;
  disabled?: boolean;
  label?: string;
}>();

const model = defineModel<boolean>();
const can = usePermissions();
const isDisabled = computed(() => !can.value[INPUT_GATES[props.gate]] || props.disabled);
</script>

<template>
  <label class="toggleRow">
    <input type="checkbox" class="toggle" v-model="model" :disabled="isDisabled">
    {{ label }}
  </label>
</template>
