<script setup lang="ts">
import { computed } from 'vue';
import { usePermissions } from './permissions';
import { INPUT_DEFS, type InputType, type InputDef } from './machineControls';
import { useGateExplain } from './gateExplain';

// Match the other Machine* wrappers: bind $attrs explicitly on <select> rather
// than letting Vue also fall them through to the root (which would double-bind).
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  gate: InputType;
  disabled?: boolean;
}>();

const model = defineModel<string | number>();
const can = usePermissions();
const def = computed((): InputDef => INPUT_DEFS[props.gate]);
const isDisabled = computed(() => !can.value[def.value.gate] || props.disabled);
// Input-rooted: the reason on hover and on pointerdown (UX-09, gateExplain.ts).
const { active: explainActive, reason: explainReason, explain } =
  useGateExplain({ gate: () => def.value.gate, disabled: () => isDisabled.value });

</script>

<template>
  <select v-bind="$attrs" v-model="model" :disabled="isDisabled" class="inputField" :class="{ compact: def.density === 'compact' }"
          :title="explainActive ? explainReason : ($attrs.title as string | undefined)" @pointerdown="explain">
    <slot />
  </select>
</template>
