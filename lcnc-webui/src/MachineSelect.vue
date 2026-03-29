<script setup lang="ts">
import { computed } from 'vue';
import { usePermissions } from './permissions';
import { INPUT_DEFS, INPUT_SIZE_STYLES, type InputType, type InputDef } from './machineControls';

const props = defineProps<{
  gate: InputType;
  disabled?: boolean;
}>();

const model = defineModel<string | number>();
const can = usePermissions();
const def = computed((): InputDef => INPUT_DEFS[props.gate]);
const isDisabled = computed(() => !can.value[def.value.gate] || props.disabled);

const catalogStyle = computed(() => {
  const d = def.value;
  const s: Record<string, string> = {};
  if (d.size && INPUT_SIZE_STYLES[d.size]) Object.assign(s, INPUT_SIZE_STYLES[d.size]);
  return Object.keys(s).length ? s : undefined;
});
</script>

<template>
  <select v-model="model" :style="catalogStyle" :disabled="isDisabled">
    <slot />
  </select>
</template>
