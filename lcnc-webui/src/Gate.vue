<script setup lang="ts">
import { computed, inject, provide } from "vue";
import { usePermissions, type Permissions } from "./permissions";
import { GATE_SCOPE_KEY } from "./gateExplain";

const props = defineProps<{ gate: keyof Permissions }>();
const permissions = usePermissions();
const allow = computed(() => permissions.value[props.gate]);
// The fieldset disables its controls without telling them why: a control
// inside asks for the nearest closed Gate — the outer one first — and
// explains with its reason (button gates BG-16, gateExplain.ts).
const parentScope = inject(GATE_SCOPE_KEY, null);
provide(GATE_SCOPE_KEY, computed(() => parentScope?.value ?? (allow.value ? null : props.gate)));
</script>

<template>
  <fieldset :disabled="!allow" :data-gate="gate" class="fs-reset">
    <slot />
  </fieldset>
</template>
