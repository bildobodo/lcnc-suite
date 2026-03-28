<script setup lang="ts">
import { computed } from 'vue';
import { usePermissions } from './permissions';
import { INPUT_GATES, type InputType } from './machineControls';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  gate: InputType;
  disabled?: boolean;
}>();

const can = usePermissions();
const isDisabled = computed(() => !can.value[INPUT_GATES[props.gate]] || props.disabled);
</script>

<template>
  <input v-bind="$attrs" :disabled="isDisabled">
</template>
