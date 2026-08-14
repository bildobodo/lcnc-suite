<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { keypadState, closeKeypad } from './useNumberKeypad';
import { evaluate, fmtEval } from './mathEval';
import { armed } from './lcncWs';
import MachineBtn from './MachineBtn.vue';

const expr = ref('');
const rootEl = ref<HTMLElement | null>(null);
// When true, the next digit/decimal replaces the expression instead of appending.
// Set on open so the pre-populated value acts as a starting point, not a base to edit.
// Cleared on any keypad action. Operators do NOT replace — they keep the existing value
// as the left operand, letting the user continue a calculation from the current value.
const replacing = ref(false);

// Auto-close if the machine becomes disarmed while the keypad is open.
watch(armed, (isArmed) => { if (!isArmed) cancel(); });

// Re-init on mount AND on every subsequent openKeypad() call. Watching
// keypadState.seq (a monotonic counter) lets the strip refresh its expression
// and take keyboard focus even when it's already open and the new field has
// the same value as the old one (retargeting between fields in the owner
// section, e.g. zero-to-zero).
function loadFromState() {
  expr.value = keypadState.initial;
  replacing.value = !!keypadState.initial; // only replace when pre-populated
  nextTick(() => rootEl.value?.focus());
}
onMounted(loadFromState);
watch(() => keypadState.seq, loadFromState);

// Live result from the expression — null means invalid/incomplete.
const result = computed(() => evaluate(expr.value));

// Show result preview line only when expression contains operators (not a plain number).
const isSimpleNumber = computed(() => /^-?[0-9]*\.?[0-9]*$/.test(expr.value.trim()));

// Expression ending with an operator is incomplete (waiting for right operand), not invalid.
const isIncomplete = computed(() => /[+\-*/]\s*$/.test(expr.value.trim()));

const previewText = computed(() => {
  if (!expr.value.trim()) return '';
  const v = result.value;
  if (v === null) return isIncomplete.value ? '' : 'invalid';
  if (isSimpleNumber.value) return '';
  return '= ' + fmtEval(v);
});

const previewInvalid = computed(() =>
  result.value === null && !isIncomplete.value && !!expr.value.trim()
);

// Display expression with human-friendly operator symbols.
const displayExpr = computed(() =>
  (expr.value || '0').replace(/\//g, '÷').replace(/\*/g, '×')
);

// ── Keypad actions ──────────────────────────────────────────────────────────

function append(s: string) {
  if (replacing.value) { expr.value = s; replacing.value = false; return; }
  expr.value += s;
}

function del() { replacing.value = false; expr.value = expr.value.slice(0, -1); }

function clear() { replacing.value = false; expr.value = ''; }

function negate() {
  replacing.value = false;
  if (!expr.value) { expr.value = '-'; return; }
  if (expr.value.startsWith('-')) {
    expr.value = expr.value.slice(1);
  } else {
    expr.value = '-' + expr.value;
  }
}

// Replace expression with its evaluated result. Next digit will start a fresh entry.
function evalExpr() {
  const v = result.value;
  if (v !== null) { expr.value = fmtEval(v); replacing.value = true; }
}

function confirm() {
  // Empty expression (after C) confirms as 0.
  const v = expr.value.trim() ? result.value : 0;
  if (v !== null) {
    keypadState.onConfirm?.(v);
    closeKeypad();
  }
}

function cancel() {
  keypadState.onCancel?.();
  closeKeypad();
}

// Same press pattern as GcodeKeypadStrip: keys act on pointerdown with
// preventDefault — snappier on touch, and focus stays on the keypad root
// so physical-keyboard input keeps working between taps.
function press(e: PointerEvent, fn: () => void) {
  if (e.button !== 0) return;
  fn();
}

// Physical keyboard support — keydown bubbles from any child key to the root.
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
  if (e.key === 'Enter') { e.preventDefault(); confirm(); return; }
  if (e.key === 'Backspace') { e.preventDefault(); del(); return; }
  if (e.key === 'Delete') { e.preventDefault(); clear(); return; }
  if (/^[0-9.]$/.test(e.key)) { e.preventDefault(); append(e.key); return; }
  if (e.key === '+' || e.key === '-' || e.key === '*' || e.key === '/') {
    e.preventDefault(); append(e.key); return;
  }
  if (e.key === '(' || e.key === ')') { e.preventDefault(); append(e.key); return; }
  if (e.key === '=') { e.preventDefault(); evalExpr(); return; }
}
</script>

<template>
  <div
    ref="rootEl"
    class="stripSection nkStrip"
    tabindex="-1"
    @keydown="onKeydown"
  >
    <div class="sub">{{ keypadState.label || 'Enter value' }}</div>
    <!-- Expression display — .inputField look, so the entry target is
         unmistakable (it's the same visual as the field being edited).
         Single line: result preview left, expression pinned right — the
         expression never moves when the preview appears, and an
         overflowing expression clips at its left (oldest) end. -->
    <div class="inputField nkDisplay row-tight">
      <span class="nkPreview" :class="{ invalid: previewInvalid }">{{ previewText }}</span>
      <span class="nkExpr">{{ displayExpr }}</span>
    </div>
    <!-- One grid holds keys AND actions so orientation can reorder them:
         landscape puts the actions in a 6th column, portrait moves them to
         a full-width bottom row (Cancel | ═ | OK). -->
    <div class="nkGrid">
        <!-- Row 1 -->
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent="press($event, () => append('7'))" @contextmenu.prevent>7</MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent="press($event, () => append('8'))" @contextmenu.prevent>8</MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent="press($event, () => append('9'))" @contextmenu.prevent>9</MachineBtn>
        <MachineBtn type="numOp"  class="nkKey" @pointerdown.prevent="press($event, () => append('/'))" @contextmenu.prevent>÷</MachineBtn>
        <MachineBtn type="numDel" class="nkKey" @pointerdown.prevent="press($event, del)" @contextmenu.prevent>⌫</MachineBtn>
        <!-- Row 2 -->
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent="press($event, () => append('4'))" @contextmenu.prevent>4</MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent="press($event, () => append('5'))" @contextmenu.prevent>5</MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent="press($event, () => append('6'))" @contextmenu.prevent>6</MachineBtn>
        <MachineBtn type="numOp"  class="nkKey" @pointerdown.prevent="press($event, () => append('*'))" @contextmenu.prevent>×</MachineBtn>
        <MachineBtn type="numClr" class="nkKey" @pointerdown.prevent="press($event, clear)" @contextmenu.prevent>C</MachineBtn>
        <!-- Row 3 -->
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent="press($event, () => append('1'))" @contextmenu.prevent>1</MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent="press($event, () => append('2'))" @contextmenu.prevent>2</MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent="press($event, () => append('3'))" @contextmenu.prevent>3</MachineBtn>
        <MachineBtn type="numOp"  class="nkKey" @pointerdown.prevent="press($event, () => append('-'))" @contextmenu.prevent>−</MachineBtn>
        <MachineBtn type="numOp"  class="nkKey" @pointerdown.prevent="press($event, negate)" @contextmenu.prevent>±</MachineBtn>
        <!-- Row 4 -->
        <MachineBtn type="numOp"  class="nkKey" @pointerdown.prevent="press($event, () => append('('))" @contextmenu.prevent><span class="mono">(</span></MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent="press($event, () => append('0'))" @contextmenu.prevent>0</MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent="press($event, () => append('.'))" @contextmenu.prevent>.</MachineBtn>
        <MachineBtn type="numOp"  class="nkKey" @pointerdown.prevent="press($event, () => append('+'))" @contextmenu.prevent>+</MachineBtn>
        <MachineBtn type="numOp"  class="nkKey" @pointerdown.prevent="press($event, () => append(')'))" @contextmenu.prevent><span class="mono">)</span></MachineBtn>
        <!-- Actions — same key types as the G-code keyboard's ops column
             (numOp + primary numKey), so both strips look alike. Explicitly
             grid-placed; the digit/operator keys auto-place around them. -->
        <MachineBtn type="numOp" class="nkKey nkCancel" @pointerdown.prevent="press($event, cancel)" @contextmenu.prevent>Cancel</MachineBtn>
        <MachineBtn type="numEq" class="nkKey nkEq" :disabled="result === null" @pointerdown.prevent="press($event, evalExpr)" @contextmenu.prevent>═</MachineBtn>
        <MachineBtn type="numKey" variant="primary" class="nkKey nkOk" :disabled="result === null && !!expr.trim()" @pointerdown.prevent="press($event, confirm)" @contextmenu.prevent>OK</MachineBtn>
    </div>
  </div>
</template>

<style scoped>
.nkStrip { outline: none; }
/* Display box: .inputField provides the visual (bg, border, radius,
   tabular-nums) — only layout is added here. Overflow clips at the left
   because content is end-justified. */
.nkDisplay {
  justify-content: flex-end;
  overflow: hidden;
}
.nkExpr {
  font-size: var(--fs-lg);
  white-space: nowrap;
}
.nkPreview {
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
  white-space: nowrap;
}
.nkPreview.invalid {
  color: var(--danger);
  opacity: var(--opacity-secondary);
}
/* Fixed --key-size square keys (shared with GcodeKeypadStrip) — identical
   in both orientations. Actions live in the same grid, explicitly placed
   in a 6th column; keys auto-place around them. */
.nkGrid {
  display: grid;
  grid-template-columns: repeat(5, var(--key-size)) minmax(var(--key-action-w), auto);
  grid-auto-rows: var(--key-size);
  gap: var(--gap-tight);
}
.nkCancel { grid-column: 6; grid-row: 1; }
.nkEq     { grid-column: 6; grid-row: 2; }
.nkOk     { grid-column: 6; grid-row: 3 / 5; }
.nkKey {
  min-height: 0; /* grid rows own the height — override the touch layer's button floor */
}

@media (orientation: portrait) {
  /* Reorder: the actions column becomes a full-width bottom row
     (Cancel | ═ | OK) so the grid is 5 key columns wide instead of 6 —
     it must fit the narrow strip without horizontal overflow. */
  .nkGrid { grid-template-columns: repeat(5, var(--key-size)); }
  .nkCancel { grid-column: 1 / 3; grid-row: 5; }
  .nkEq     { grid-column: 3;     grid-row: 5; }
  .nkOk     { grid-column: 4 / 6; grid-row: 5; }
  /* The display tracks the grid width so both edges align. */
  .nkDisplay { max-width: calc(5 * var(--key-size) + 4 * var(--gap-tight)); }
}
</style>
