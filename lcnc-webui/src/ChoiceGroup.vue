<script setup lang="ts" generic="V extends string | number">
// A connected group of options (operator point P7, Codex R21–R24) — the
// strip's step increments, task mode, kinematics frame and work offset used
// to be vertical radio lists (18 px rows on the desktop, below WCAG 2.5.8's
// 24 px, no spacing).
//
// Two activations:
//  - "auto": a plain radio group — the arrows move AND choose (the step
//    increment: a local setting, no machine command).
//  - "manual": radios IN A TOOLBAR (APG) — the arrows only move focus;
//    click, Enter or Space choose (task mode, frame, WCS: machine commands).
//    The CHECKED option is always the CONFIRMED machine state (modelValue);
//    a requested one shows "pending" until the status confirms it, or for
//    at most PENDING_MS ("Not confirmed" at the option, never "failed"; no
//    retry), or until the connection drops.
//
// ONE Tab stop (roving tabindex), kept where the operator left it — a status
// change never pulls focus to the checked option. All navigation keys are
// default-prevented, WITH a modifier too (the shortcut map listens on window
// and returns on defaultPrevented; with the default mapping the arrows jog —
// a button is no INPUT, the map's tag guard does not cover it); only the
// bare key (or Shift) moves focus. A grid: `columns` flows by row (Up/Down
// a row), `rows` flows by column (the work offsets, 2 × 5: G54–G58 in the
// first column — Up/Down within a column, Left/Right the other column).
// Escape stays E-Stop (the capture listener).
import { ref, watch, onUnmounted } from "vue";
import MachineChoice from "./MachineChoice.vue";
import { showBtnHint } from "./btnHint";
import { connected } from "./lcncWs";
import { PENDING_MS, type ChoiceOption } from "./choiceGroup";

const props = withDefaults(defineProps<{
  options: ReadonlyArray<ChoiceOption<V>>;
  /** The confirmed value (manual) or the current setting (auto). */
  modelValue: V | null | undefined;
  /** The group's accessible name ("Task mode", "Work offset"). */
  label: string;
  activation?: "auto" | "manual";
  /** A grid flowing by row, this many columns. */
  columns?: number;
  /** A grid flowing by column, this many rows. */
  rows?: number;
}>(), { activation: "manual" });
const emit = defineEmits<{ (e: "choose", value: V): void }>();

const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

const root = ref<HTMLElement | null>(null);
const pending = ref<V | null>(null);
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
/** The roving stop: the checked option until the operator moves focus. */
const stop = ref<number>(-1);

const stopIndex = () => {
  if (stop.value >= 0 && stop.value < props.options.length) return stop.value;
  const at = props.options.findIndex(o => o.value === props.modelValue);
  return at >= 0 ? at : 0;
};

function clearPending() {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  pending.value = null;
}

function choose(o: ChoiceOption<V>, el: HTMLElement) {
  if (props.activation === "manual") {
    if (o.value === props.modelValue) return;
    clearPending();
    pending.value = o.value;
    pendingTimer = setTimeout(() => {
      const shown = props.options.find(x => x.value === props.modelValue)?.label;
      clearPending();
      showBtnHint(el, shown ? `Not confirmed — the machine shows ${shown}` : "Not confirmed yet");
    }, PENDING_MS);
  }
  emit("choose", o.value);
}

watch(() => props.modelValue, v => { if (pending.value !== null && v === pending.value) clearPending(); });
watch(connected, c => { if (!c) clearPending(); });
onUnmounted(clearPending);

function items(): HTMLElement[] {
  return [...(root.value?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
}

function onFocusin(e: FocusEvent) {
  const at = items().indexOf(e.target as HTMLElement);
  if (at >= 0) stop.value = at;
}

function onKeydown(e: KeyboardEvent) {
  if (!NAV_KEYS.has(e.key)) return;
  e.preventDefault();
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const list = items();
  const at = list.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  const n = list.length, cols = props.columns ?? 0, rows = props.rows ?? 0;
  // The step across the flow: a row down (row-flow grid), a column over
  // (column-flow grid); the step along it is the next / previous option.
  const across = cols || rows;
  const alongNext = rows ? "ArrowDown" : "ArrowRight", alongPrev = rows ? "ArrowUp" : "ArrowLeft";
  const acrossNext = rows ? "ArrowRight" : "ArrowDown", acrossPrev = rows ? "ArrowLeft" : "ArrowUp";
  let next = at;
  if (e.key === alongNext || (!across && e.key === acrossNext)) next = (at + 1) % n;
  else if (e.key === alongPrev || (!across && e.key === acrossPrev)) next = (at - 1 + n) % n;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = n - 1;
  else if (across && e.key === acrossNext && at + across < n) next = at + across;
  else if (across && e.key === acrossPrev && at - across >= 0) next = at - across;
  list[next]?.focus();
  // A plain radio group chooses with the arrow (a local setting only).
  if (props.activation === "auto") list[next]?.click();
}
</script>

<template>
  <div ref="root" class="choiceGroup"
       :role="activation === 'manual' ? 'toolbar' : undefined"
       :aria-label="activation === 'manual' ? label : undefined"
       @keydown="onKeydown" @focusin="onFocusin">
    <div role="radiogroup" :aria-label="label" class="choiceRow" :class="{ grid: !!(columns || rows), colFlow: !!rows }"
         :style="columns ? { '--choice-columns': columns } : rows ? { '--choice-rows': rows } : undefined">
      <MachineChoice v-for="(o, i) in options" :key="String(o.value)" :gate="o.gate"
                     :disabled="o.disabled" :reason="o.reason" :title="o.title"
                     :checked="o.value === modelValue" :pending="o.value === pending"
                     :tabindex="i === stopIndex() ? 0 : -1"
                     @choose="el => choose(o, el)">{{ o.label }}</MachineChoice>
    </div>
  </div>
</template>
