<script setup lang="ts">
import { computed } from 'vue';
import { usePermissions } from './permissions';
import { INPUT_DEFS, type InputType, type InputDef } from './machineControls';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  gate: InputType;
  disabled?: boolean;
}>();

const model = defineModel<string | number | null>();
const can = usePermissions();
const def = computed((): InputDef => INPUT_DEFS[props.gate]);
const isDisabled = computed(() => !can.value[def.value.gate] || props.disabled);

const SIZE_STYLES: Record<string, Record<string, string>> = {
  sm: { padding: '3px 6px', fontSize: 'var(--fs-sm)' },
  lg: { padding: '6px 10px', fontSize: 'var(--fs-md)' },
};

const catalogStyle = computed(() => {
  const d = def.value;
  const s: Record<string, string> = {};
  if (d.align) s.textAlign = d.align;
  if (d.width) s.width = d.width;
  if (d.mono) s.fontFamily = 'var(--font-mono)';
  if (d.size && SIZE_STYLES[d.size]) Object.assign(s, SIZE_STYLES[d.size]);
  return Object.keys(s).length ? s : undefined;
});
</script>

<template>
  <input v-bind="$attrs" :style="catalogStyle" v-model="model" :disabled="isDisabled">
</template>
