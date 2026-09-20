<script setup lang="ts">
// On-screen text / code keyboard for the bottom strip (WP8, UI-15) — the
// one helper for every text-like target: the MDI line, the G-code editor,
// search and description fields. It reads the input session; the OWNER
// decides what Enter means (Send / newline / OK) and which navigation keys
// it offers. Pages (Code · ABC · 123 · #+=) come from textKeyboardPages.ts;
// every page has the same cell count so switching never changes the
// strip's height. Landscape: 5 rows × 6 columns + three rails inside the
// 260.5 px budget; portrait: title → pages → actions → navigation → 6 rows.
import { computed } from "vue";
import { X, ArrowBigUp, Delete, CornerDownLeft, ArrowLeft, ArrowRight, Undo2, Redo2 } from "lucide-vue-next";
import MachineBtn from "./MachineBtn.vue";
import { inputSession, closeTextSession } from "./inputSession";
import { pageKeys, PAGE_ORDER, PAGE_LABELS, type KeyPage } from "./textKeyboardPages";

const props = defineProps<{
  /** Axis letters from viewer_init (useAxes upstream) — never hardcoded. */
  axes: string[];
}>();

const keys = computed(() => pageKeys(inputSession.page, props.axes, inputSession.shift));
const target = computed(() => inputSession.target);
const enterTitle = computed(() =>
  inputSession.enterLabel === "Send" ? "Send the MDI command"
  : inputSession.enterLabel === "newline" ? "New line" : "Done");
const tabOrClear = computed<"tab" | "clear" | null>(() =>
  target.value?.tab ? "tab" : target.value?.clear ? "clear" : null);

// Keys act on pointerdown with preventDefault: the press must never take
// focus from the owner field (a focus change would be a "leave").
function press(e: PointerEvent, fn: () => void) {
  if (e.button !== 0) return;
  fn();
}
function insert(k: string) { target.value?.insert(k); }
function setPage(p: KeyPage) { inputSession.page = p; }
function keyLabel(k: string): string {
  if (k === " ") return "Space";
  if (k === "\"") return "Double quote";
  if (k === "'") return "Apostrophe";
  if (k === "`") return "Backtick";
  return k;
}
</script>

<template>
  <div class="stripSection tkStrip" :class="`tkPage-${inputSession.page}`" :data-input-area="inputSession.ownerId">
    <div class="sub">{{ inputSession.context || 'Keyboard' }}</div>
    <div class="tkRows">
      <!-- Content: 30 cells, empty ones keep the grid full. -->
      <div class="tkContent" :data-page="inputSession.page">
        <template v-for="(k, i) in keys" :key="`${inputSession.page}-${i}`">
          <MachineBtn v-if="k !== null" type="numKey" class="tkKey" :aria-label="keyLabel(k)" :title="keyLabel(k)"
                      @pointerdown.prevent="press($event, () => insert(k))" @contextmenu.prevent>{{ k }}</MachineBtn>
          <span v-else class="tkEmpty" aria-hidden="true"></span>
        </template>
      </div>

      <!-- Action rail / row: shift, backspace, enter, space. -->
      <div class="tkActions">
        <MachineBtn type="numOp" class="tkKey tkShift" :selected="inputSession.shift" :aria-pressed="inputSession.shift"
                    aria-label="Shift" title="Shift (upper case)"
                    @pointerdown.prevent="press($event, () => { inputSession.shift = !inputSession.shift; })" @contextmenu.prevent>
          <ArrowBigUp :size="16" />
        </MachineBtn>
        <MachineBtn type="numOp" class="tkKey tkBksp" aria-label="Backspace" title="Backspace"
                    @pointerdown.prevent="press($event, () => target?.backspace())" @contextmenu.prevent>
          <Delete :size="16" />
        </MachineBtn>
        <MachineBtn type="numKey" variant="primary" class="tkKey tkEnter" :aria-label="enterTitle" :title="enterTitle"
                    @pointerdown.prevent="press($event, () => target?.enter())" @contextmenu.prevent>
          <CornerDownLeft v-if="inputSession.enterLabel === 'newline'" :size="16" />
          <template v-else>{{ inputSession.enterLabel }}</template>
        </MachineBtn>
        <MachineBtn type="numOp" class="tkKey tkSpace" aria-label="Space" title="Space"
                    @pointerdown.prevent="press($event, () => insert(' '))" @contextmenu.prevent>Space</MachineBtn>
      </div>

      <!-- Navigation rail / row: cursor, undo/redo, Tab or Clr. Cells stay
           (disabled) when the owner does not offer the action. -->
      <div class="tkNav">
        <MachineBtn type="numOp" class="tkKey" :disabled="!target?.moveCursor" aria-label="Cursor left" title="Cursor left"
                    @pointerdown.prevent="press($event, () => target?.moveCursor?.(-1))" @contextmenu.prevent><ArrowLeft :size="16" /></MachineBtn>
        <MachineBtn type="numOp" class="tkKey" :disabled="!target?.moveCursor" aria-label="Cursor right" title="Cursor right"
                    @pointerdown.prevent="press($event, () => target?.moveCursor?.(1))" @contextmenu.prevent><ArrowRight :size="16" /></MachineBtn>
        <MachineBtn type="numOp" class="tkKey" :disabled="!target?.undo" aria-label="Undo" title="Undo"
                    @pointerdown.prevent="press($event, () => target?.undo?.())" @contextmenu.prevent><Undo2 :size="16" /></MachineBtn>
        <MachineBtn type="numOp" class="tkKey" :disabled="!target?.redo" aria-label="Redo" title="Redo"
                    @pointerdown.prevent="press($event, () => target?.redo?.())" @contextmenu.prevent><Redo2 :size="16" /></MachineBtn>
        <MachineBtn v-if="tabOrClear === 'tab'" type="numOp" class="tkKey" aria-label="Tab" title="Insert a tab"
                    @pointerdown.prevent="press($event, () => target?.tab?.())" @contextmenu.prevent>Tab</MachineBtn>
        <MachineBtn v-else type="numOp" class="tkKey" :disabled="tabOrClear !== 'clear'" aria-label="Clear line" title="Clear the line"
                    @pointerdown.prevent="press($event, () => target?.clear?.())" @contextmenu.prevent>Clr</MachineBtn>
      </div>

      <!-- Page rail / row: Code · ABC · 123 · #+= · close. -->
      <div class="tkPages">
        <MachineBtn v-for="p in PAGE_ORDER" :key="p" type="numOp" class="tkKey" :selected="inputSession.page === p"
                    :aria-pressed="inputSession.page === p" :aria-label="`${PAGE_LABELS[p]} keys`" :title="`${PAGE_LABELS[p]} keys`"
                    @pointerdown.prevent="press($event, () => setPage(p))" @contextmenu.prevent>{{ PAGE_LABELS[p] }}</MachineBtn>
        <MachineBtn type="numOp" class="tkKey tkClose" aria-label="Close keyboard" title="Close keyboard"
                    @pointerdown.prevent="press($event, () => closeTextSession('closed by the operator', true))" @contextmenu.prevent>
          <X :size="16" />
        </MachineBtn>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Landscape: content block + three rails side by side, all within the
   5-row budget (5 × --key-size + 4 × --gap-tight = 236 px under the title). */
.tkRows {
  display: grid;
  grid-template-columns: auto auto auto auto;
  grid-template-areas: "content actions nav pages";
  gap: var(--gap-controls);
  flex: 1;
  min-height: 0;
}
.tkContent {
  grid-area: content;
  display: grid;
  grid-template-rows: repeat(5, var(--key-size));
  grid-auto-flow: column;
  grid-auto-columns: var(--key-size);
  gap: var(--gap-tight);
}
.tkActions {
  grid-area: actions;
  display: grid;
  grid-template-rows: repeat(5, var(--key-size));
  grid-template-columns: var(--key-action-w);
  gap: var(--gap-tight);
}
.tkShift { grid-row: 1; }
.tkBksp  { grid-row: 2; }
.tkEnter { grid-row: 3 / 5; }
.tkSpace { grid-row: 5; }
.tkNav, .tkPages {
  display: grid;
  grid-template-rows: repeat(5, var(--key-size));
  grid-template-columns: var(--key-size);
  gap: var(--gap-tight);
}
.tkNav { grid-area: nav; }
.tkPages { grid-area: pages; }
.tkKey {
  min-height: 0; /* grid rows own the height — override the touch layer's button floor */
  padding-left: 0;
  padding-right: 0;
}
.tkEmpty { display: block; }

@media (orientation: portrait) {
  /* Width-limited (280 px column → 5 cells of 44 px): pages, actions and
     navigation become full-width rows ABOVE six content rows, so page
     switch and Enter sit in the first three rows, never below the keys. */
  .tkRows {
    grid-template-columns: repeat(5, var(--key-size));
    grid-template-areas: "pages pages pages pages pages" "actions actions actions actions actions" "nav nav nav nav nav" "content content content content content";
    gap: var(--gap-tight);
  }
  .tkContent {
    grid-template-rows: repeat(6, var(--key-size));
    grid-auto-flow: row;
    grid-template-columns: repeat(5, var(--key-size));
    grid-auto-columns: auto;
  }
  .tkActions {
    grid-template-rows: var(--key-size);
    grid-template-columns: repeat(5, var(--key-size));
  }
  .tkShift { grid-row: 1; grid-column: 1; }
  .tkSpace { grid-row: 1; grid-column: 2 / 4; }
  .tkBksp  { grid-row: 1; grid-column: 4; }
  .tkEnter { grid-row: 1; grid-column: 5; }
  .tkNav, .tkPages {
    grid-template-rows: var(--key-size);
    grid-template-columns: repeat(5, var(--key-size));
    grid-auto-flow: column;
  }
}
</style>
