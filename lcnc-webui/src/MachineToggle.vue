<script setup lang="ts">
import { computed } from 'vue';
import { usePermissions } from './permissions';
import { INPUT_DEFS, type InputType } from './machineControls';
import HelpIcon from './HelpIcon.vue';
import { useGateExplain } from './gateExplain';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  gate: InputType;
  disabled?: boolean;
  label?: string;
  modelValue?: boolean;
  /** Explanatory text rendered as a tap-friendly HelpIcon popover.
      Use this instead of title= — title tooltips are hover-only and
      unreachable on touch. */
  help?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [boolean] }>();

const can = usePermissions();
const def = computed(() => INPUT_DEFS[props.gate]);
const isDisabled = computed(() => !can.value[def.value.gate] || props.disabled);
// Why it is dimmed (UX-09): the label root carries the tap/keyboard
// explanation while disabled with a reason, like MachineBtn's wrapper.
const { active: explainActive, reason: explainReason, label: explainLabel, explain, onKeydown: explainKey } =
  useGateExplain({ gate: () => def.value.gate, disabled: () => isDisabled.value });

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
  <label class="toggleRow" :title="explainActive ? explainReason : undefined"
         :tabindex="explainActive ? 0 : undefined" :role="explainActive ? 'button' : undefined"
         :aria-label="explainActive ? explainLabel : undefined" @click="explain" @keydown="explainKey">
    <input v-bind="$attrs" type="checkbox" class="toggle"
      :checked="modelValue ?? false"
      @change="onChange"
      :disabled="isDisabled">
    {{ label }}<HelpIcon v-if="help" :label="label">{{ help }}</HelpIcon>
  </label>
</template>
