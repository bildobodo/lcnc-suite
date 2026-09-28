<script setup lang="ts">
// One option of a ChoiceGroup (operator point P7, Codex R21–R24): a BUTTON
// with role="radio". A dimmed option stays focusable (aria-disabled, never
// the disabled attribute — APG: a roving toolbar keeps its stop on it) and
// explains itself where it is pressed (useGateExplain). Catalog-aware like
// MachineRadio (INPUT_DEFS gate). Single root: the parent's scoped CSS and
// the group's roving tabindex reach the button itself.
import { computed } from "vue";
import { usePermissions } from "./permissions";
import { INPUT_DEFS, type InputType } from "./machineControls";
import { useGateExplain } from "./gateExplain";

const props = defineProps<{
  gate: InputType;
  checked: boolean;
  /** The caller's own "unavailable" on top of the gate (a reserved fixture). */
  disabled?: boolean;
  /** Why the caller disables it. */
  reason?: string;
  /** Requested, not yet confirmed by the machine. */
  pending?: boolean;
}>();
const emit = defineEmits<{ (e: "choose", el: HTMLElement): void }>();

const can = usePermissions();
const def = computed(() => INPUT_DEFS[props.gate]);
const isDisabled = computed(() => !can.value[def.value.gate] || !!props.disabled);
const gateExplain = useGateExplain({
  gate: () => def.value.gate, disabled: () => isDisabled.value,
  reason: () => (props.disabled ? props.reason : undefined),
});

function activate(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement;
  if (isDisabled.value) {
    gateExplain.explain(el);
    return;
  }
  emit("choose", el);
}
</script>

<template>
  <button type="button" class="choice" role="radio"
          :aria-checked="checked ? 'true' : 'false'"
          :aria-disabled="isDisabled ? 'true' : undefined"
          :aria-busy="pending ? 'true' : undefined"
          :class="{ checked, pending, dimmed: isDisabled }"
          :title="gateExplain.active.value ? gateExplain.reason.value : ($attrs.title as string | undefined)"
          @click="activate"><slot /></button>
</template>
