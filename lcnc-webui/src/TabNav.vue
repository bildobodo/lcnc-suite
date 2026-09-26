<script setup lang="ts" generic="T extends string">
// The ONE tab navigation (design wave D3, UI-K17, K12).
//
// A `tablist` of `tab` buttons (MachineBtn, catalog `tabMain` / `tabSub`)
// with ONE Tab stop — the selected tab (roving tabindex) — and MANUAL
// activation: the arrow keys move focus, Enter / Space select (the native
// click; the shortcut map leaves activation keys on a focused element
// alone). The navigation keys are the list's own:
//
//   ArrowLeft / ArrowRight — the previous / next tab in reading order,
//                            wrapping at the ends
//   Home / End             — the first / last tab
//   ArrowUp / ArrowDown    — the row above / below in a grid (`columns`,
//                            Probing's 4 × 2); nothing in a single row
//
// ALL six are default-prevented here: the global shortcut map listens on
// window (bubble) and returns on `defaultPrevented` — with the default
// mapping the arrows jog X/Y, and a focused tab must never move the
// machine. A tab switch is never a machine action.
//
// `variant`: main = the side pane's five areas (equal columns, top-rounded,
// the selected tab open to the content below); sub = a section's views
// (underlined). The look lives in Btn.vue (`tab` prop), the layout in
// style.css (`.tabNav`). The panels are the caller's: `tabIds(base, id)`
// names the tab and its panel, and the caller renders the panel with
// `role="tabpanel"` + `aria-labelledby` (hidden panels via v-show or v-if
// are never focusable).
import { ref } from "vue";
import MachineBtn from "./MachineBtn.vue";
import { tabIds } from "./tabIds";

const props = withDefaults(defineProps<{
  tabs: ReadonlyArray<{ id: T; label: string }>;
  modelValue: T;
  /** The tablist's accessible name ("Side panel", "Probing procedure"). */
  label: string;
  /** Unique base of the tab and panel ids (tabIds). */
  idBase: string;
  variant?: "main" | "sub";
  /** A grid of this many columns (Probing 4 × 2); absent = one row. */
  columns?: number;
}>(), { variant: "sub" });

const emit = defineEmits<{ (e: "update:modelValue", id: T): void }>();

const root = ref<HTMLElement | null>(null);
const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

const stop = (id: T) =>
  props.modelValue === id || (!props.tabs.some(t => t.id === props.modelValue) && props.tabs[0]?.id === id);

function onKeydown(e: KeyboardEvent) {
  if (!NAV_KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  const list = [...(root.value?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
  const at = list.findIndex(el => el === document.activeElement);
  if (at < 0) return;
  const n = list.length;
  const cols = props.columns ?? 0;
  let next = at;
  if (e.key === "ArrowRight") next = (at + 1) % n;
  else if (e.key === "ArrowLeft") next = (at - 1 + n) % n;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = n - 1;
  else if (cols && e.key === "ArrowDown" && at + cols < n) next = at + cols;
  else if (cols && e.key === "ArrowUp" && at - cols >= 0) next = at - cols;
  list[next]?.focus();
}
</script>

<template>
  <div ref="root" class="tabNav" :class="[variant, { grid: !!columns }]" role="tablist" :aria-label="label"
       :style="{ '--tab-count': tabs.length, '--tab-columns': columns }" @keydown="onKeydown">
    <MachineBtn v-for="t in tabs" :key="t.id" :type="variant === 'main' ? 'tabMain' : 'tabSub'"
                role="tab" :id="tabIds(idBase, t.id).tab" :aria-selected="modelValue === t.id ? 'true' : 'false'"
                :aria-controls="modelValue === t.id ? tabIds(idBase, t.id).panel : undefined"
                :tabindex="stop(t.id) ? 0 : -1" :selected="modelValue === t.id"
                @click="emit('update:modelValue', t.id)">{{ t.label }}</MachineBtn>
  </div>
</template>
