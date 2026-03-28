<script setup lang="ts">
import { computed } from 'vue';
import Btn from './Btn.vue';
import { usePermissions } from './permissions';
import { BUTTON_TYPES, type ButtonType, type ButtonDef } from './machineControls';

defineOptions({ inheritAttrs: true });

const props = defineProps<{
  type: ButtonType;
  variant?: 'default' | 'primary' | 'ok' | 'danger' | 'estop';
  disabled?: boolean;
  active?: boolean;
  selected?: boolean;
  muted?: boolean;
  mono?: boolean;
  block?: boolean;
  flashing?: boolean;
  warning?: boolean;
  icon?: boolean;
  inline?: boolean;
}>();

const can = usePermissions();
const def = computed(() => BUTTON_TYPES[props.type] as ButtonDef);
const isDisabled = computed(() => !can.value[def.value.gate] || props.disabled);
const resolvedVariant = computed(() => props.variant ?? def.value.variant);
const resolvedIcon = computed(() => props.icon ?? def.value.icon);
const resolvedMuted = computed(() => props.muted ?? def.value.muted);
const resolvedInline = computed(() => props.inline ?? def.value.inline);
</script>

<template>
  <Btn
    :variant="resolvedVariant"
    :size="def.size"
    :icon="resolvedIcon"
    :muted="resolvedMuted"
    :inline="resolvedInline"
    :disabled="isDisabled"
    :active="active"
    :selected="selected"
    :mono="mono"
    :block="block"
    :flashing="flashing"
    :warning="warning"
  >
    <slot />
  </Btn>
</template>
