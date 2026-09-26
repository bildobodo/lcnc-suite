<script setup lang="ts">
// FormField (design wave D4, UI-K04/K10): the ONE labelled field — the
// label ABOVE the control, wired `for`/`id` (a label tap focuses the field;
// on a number field that is a deliberate tap, so it opens the keypad like a
// tap on the field). Its head row holds, in this order: the label, the "?"
// (a SIBLING of the label, never inside it — a role=button inside a
// `<label for>` joins the field's name: "Slow Feed Help: Slow Feed"), and
// the unit, right-aligned above the right-aligned value. Unit and error
// are the field's description (`aria-describedby`). The control is the
// caller's catalog component, bound through the slot props — this wrapper
// is outside the single-root controls and never touches their scoped CSS.
//
//   <FormField label="Slow Feed" :unit="`${linearUnit}/min`" v-slot="{ input }">
//     <MachineInput v-bind="input" gate="probeParam" type="number" … />
//   </FormField>
//
// Slot props: `field` (id + description, for any labelable control:
// select, output), `input` (field + `label`/`context`, MachineInput's
// accessible name and keypad readout), `group` (a radio group: role +
// aria-labelledby; the label is then a plain span — `for` cannot name a
// group).
import { computed, useId, useSlots } from "vue";
import HelpIcon from "./HelpIcon.vue";

const props = defineProps<{
  label: string;
  /** Unit of the value, from its source (docs/ui-glossary.md). */
  unit?: string;
  error?: string | null;
  /** Spans both columns of a .formGrid. */
  wide?: boolean;
  /** The control is a radio group, not one labelable element. */
  group?: boolean;
  /** Label, "?", field and unit in ONE row (a fixed section with room for
   *  one row: the rough sizes under a probe grid). */
  inline?: boolean;
}>();

const slots = useSlots();
const id = `ff${useId()}`;
const labelId = `${id}-label`;
const unitId = `${id}-unit`;
const errorId = `${id}-error`;

const describedBy = computed(() =>
  [props.unit ? unitId : "", props.error ? errorId : ""].filter(Boolean).join(" ") || undefined);
const field = computed(() => ({
  id,
  "aria-describedby": describedBy.value,
  "aria-invalid": props.error ? ("true" as const) : undefined,
}));
const input = computed(() => ({
  ...field.value,
  label: props.label,
  context: props.unit ? `${props.label} · ${props.unit}` : props.label,
}));
const groupAttrs = computed(() => ({
  role: "radiogroup",
  "aria-labelledby": labelId,
  "aria-describedby": describedBy.value,
}));
</script>

<template>
  <div class="formField" :class="{ wide, inline }">
    <div class="formFieldHead">
      <span v-if="group" :id="labelId" class="formLabel">{{ label }}</span>
      <label v-else :id="labelId" :for="id" class="formLabel">{{ label }}</label>
      <HelpIcon v-if="slots.help" :label="label"><slot name="help" /></HelpIcon>
      <span v-if="unit" :id="unitId" class="formUnit">{{ unit }}</span>
    </div>
    <slot :field="field" :input="input" :group="groupAttrs" />
    <div v-if="error" :id="errorId" class="formError" role="alert">{{ error }}</div>
  </div>
</template>
