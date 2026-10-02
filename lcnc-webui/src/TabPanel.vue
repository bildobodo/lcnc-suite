<script setup lang="ts">
// A TabNav over v-show panes (design wave D3): the side pane's six areas
// (`variant="main"`) and Settings' sections (`sub`). Each pane is a
// `tabpanel` named by its tab; a hidden pane is display:none, never
// focusable. NARROW (the side pane below NARROW_PANE_PX of content width —
// DR decision 2026-09-24, measured; sidePaneNarrow.ts): the tab list becomes
// ONE labelled select, with the `bar` slot beside it on the same row
// (Probing's procedure select). A switch of the form while the focus is in
// the navigation hands the focus to the new control (the select, or the
// selected tab) — the focused tab unmounted and left it on body, where an
// arrow jogs (package 5, Codex R69 answer 4).
import { nextTick, ref, useId, watch } from "vue";
import TabNav from "./TabNav.vue";
import MachineSelect from "./MachineSelect.vue";
import { tabIds } from "./tabIds";

const props = withDefaults(defineProps<{
  tabs: ReadonlyArray<{ id: string; label: string }>;
  modelValue: string;
  /** The navigation's accessible name ("Side panel", "Settings sections"). */
  label: string;
  variant?: "main" | "sub";
  narrow?: boolean;
}>(), { variant: "sub" });

const emit = defineEmits<{ (e: "update:modelValue", id: string): void }>();
const base = `tp${useId()}`;
const navArea = ref<HTMLElement | null>(null);
/** The narrow select: a switch the caller refused (a tab's draft guard)
 *  leaves the bound value unchanged, so Vue would not touch the element —
 *  it showed the refused area. Put it back to the value that holds. */
function onSelect(v: unknown) {
  emit("update:modelValue", String(v));
  void nextTick(() => {
    const el = navArea.value?.querySelector<HTMLSelectElement>(".narrowBar > select");
    if (el && el.value !== props.modelValue) el.value = props.modelValue;
  });
}
watch(() => props.narrow, () => {
  if (!navArea.value?.contains(document.activeElement)) return;
  void nextTick(() => {
    const el = props.narrow
      ? navArea.value?.querySelector<HTMLElement>("select")
      : navArea.value?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    el?.focus();
  });
}, { flush: "pre" });
</script>

<template>
  <div class="tab-panel stack-tight">
    <div ref="navArea" class="navArea">
    <div v-if="narrow" class="narrowBar">
      <MachineSelect gate="tabSelect" :name="`${base}-area`" :aria-label="props.label"
                     :model-value="modelValue" @update:model-value="onSelect">
        <option v-for="t in tabs" :key="t.id" :value="t.id">{{ t.label }}</option>
      </MachineSelect>
      <slot name="bar" />
    </div>
    <TabNav v-else :tabs="tabs" :model-value="modelValue" :label="label" :id-base="base" :variant="variant"
            @update:model-value="emit('update:modelValue', $event)" />
    </div>

    <div class="tab-content">
      <div v-for="t in tabs" v-show="modelValue === t.id" :id="tabIds(base, t.id).panel" :key="t.id" class="tab-pane"
           role="tabpanel" :aria-labelledby="narrow ? undefined : tabIds(base, t.id).tab" :aria-label="narrow ? t.label : undefined">
        <slot :name="t.id" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-panel {
  min-width: 0;
  flex: 1;
  min-height: 0;
}

/* Narrow: the selects share the row in equal tracks (a grid: the slot's
   select carries the caller's scope, a child rule would not reach it). */
.narrowBar {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: var(--gap-tight);
}

/* ---- Content ---- */
.tab-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.tab-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>
