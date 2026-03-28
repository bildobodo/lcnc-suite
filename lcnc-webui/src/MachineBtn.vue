<script setup lang="ts">
import { computed } from 'vue';
import Btn from './Btn.vue';
import { usePermissions } from './permissions';
import { BUTTON_TYPES, type ButtonType } from './machineControls';

defineOptions({ inheritAttrs: true });

const props = defineProps<{
  type: ButtonType;
  disabled?: boolean;
  active?: boolean;
  selected?: boolean;
  muted?: boolean;
  mono?: boolean;
  block?: boolean;
  flashing?: boolean;
  warning?: boolean;
}>();

const can = usePermissions();
const def = computed(() => BUTTON_TYPES[props.type]);
const isDisabled = computed(() => !can.value[def.value.gate] || props.disabled);
</script>

<template>
  <Btn
    :variant="def.variant"
    :size="def.size"
    :disabled="isDisabled"
    :active="active"
    :selected="selected"
    :muted="muted"
    :mono="mono"
    :block="block"
    :flashing="flashing"
    :warning="warning"
  >
    <slot />
  </Btn>
</template>
