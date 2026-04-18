<script setup lang="ts">
import { computed } from 'vue';
import { usePermissions } from './permissions';
import { INPUT_DEFS, type InputType } from './machineControls';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  gate: InputType;
  disabled?: boolean;
  label?: string;
  modelValue?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [boolean] }>();

const can = usePermissions();
const def = computed(() => INPUT_DEFS[props.gate]);
const isDisabled = computed(() => !can.value[def.value.gate] || props.disabled);

function onChange(e: Event) {
  const el = e.target as HTMLInputElement;
  const newVal = el.checked;
  // Reset DOM immediately — the parent is authoritative.
  // If the parent doesn't update the prop (e.g. shows a confirmation dialog),
  // Vue won't re-render this component (prop didn't change), so we must
  // reset the checkbox ourselves before emitting.
  el.checked = props.modelValue ?? false;
  emit('update:modelValue', newVal);
}
</script>

<template>
  <label class="toggleRow">
    <input v-bind="$attrs" type="checkbox" class="toggle"
      :checked="modelValue ?? false"
      @change="onChange"
      :disabled="isDisabled">
    {{ label }}
  </label>
</template>
