<script setup lang="ts">
import { computed } from 'vue';
import Btn from './Btn.vue';
import { usePermissions } from './permissions';
import { BUTTON_TYPES, type ButtonType, type ButtonDef } from './machineControls';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  type: ButtonType;
  variant?: 'default' | 'primary' | 'ok' | 'danger' | 'estop';
  disabled?: boolean;
  active?: boolean;
  selected?: boolean;
  muted?: boolean;
  mono?: boolean | undefined;
  block?: boolean;
  flashing?: boolean;
  warning?: boolean;
  icon?: boolean;
  inline?: boolean;
}>(), {
  // Catalog-aware props: undefined means "use catalog default"
  // Vue coerces absent booleans to false — we need undefined to detect "not passed"
  icon: undefined,
  muted: undefined,
  inline: undefined,
  mono: undefined,
  variant: undefined,
});

const can = usePermissions();
const def = computed(() => BUTTON_TYPES[props.type] as ButtonDef);
const isDisabled = computed(() => !can.value[def.value.gate] || props.disabled);
const resolvedVariant = computed(() => props.variant ?? def.value.variant);
const resolvedIcon = computed(() => props.icon ?? def.value.icon);
const resolvedMuted = computed(() => props.muted ?? def.value.muted);
const resolvedInline = computed(() => props.inline ?? def.value.inline);
const resolvedMono = computed(() => props.mono ?? def.value.mono);
</script>

<template>
  <Btn
    v-bind="$attrs"
    :variant="resolvedVariant"
    :size="def.size"
    :icon="resolvedIcon"
    :muted="resolvedMuted"
    :inline="resolvedInline"
    :disabled="isDisabled"
    :active="active"
    :selected="selected"
    :mono="resolvedMono"
    :block="block"
    :flashing="flashing"
    :warning="warning"
  >
    <slot />
  </Btn>
</template>
