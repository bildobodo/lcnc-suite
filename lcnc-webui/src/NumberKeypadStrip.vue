<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { keypadState, closeKeypad } from './useNumberKeypad';
import { evaluate, fmtEval, validateEntry } from './mathEval';
import { saveDraft, takeDraft, dropDraft, returnFocusTo } from './inputSession';
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
// Drafts (UI-15): retargeting from number A to number B files A's edited,
// unconfirmed expression; re-opening A offers it back, marked "draft".
let _owner = '';
let _dirty = false;
const isDraft = ref(false);
function loadFromState() {
  if (_owner && _owner !== keypadState.ownerId && _dirty) saveDraft(_owner, expr.value);
  _owner = keypadState.ownerId;
  const draft = _owner ? takeDraft(_owner) : null;
  if (draft !== null) {
    expr.value = draft;
    isDraft.value = true;
    replacing.value = false;
    _dirty = true;
  } else {
    expr.value = keypadState.initial;
    isDraft.value = false;
    replacing.value = !!keypadState.initial; // only replace when pre-populated
    _dirty = false;
  }
  nextTick(() => rootEl.value?.focus());
}
onMounted(loadFromState);
watch(() => keypadState.seq, loadFromState);
// The session ended without a verdict (pointer/focus left the area, a text
// helper took over — closeKeypad(keepDraft)): the expression stays with its
// owner as a draft. Confirm/Cancel clear `_dirty` first, so they never file.
onBeforeUnmount(() => { if (keypadState.keepDraft && _dirty && _owner) saveDraft(_owner, expr.value); });

// Live result from the expression — null means invalid/incomplete.
const result = computed(() => evaluate(expr.value));

// Show result preview line only when expression contains operators (not a plain number).
const isSimpleNumber = computed(() => /^-?[0-9]*\.?[0-9]*$/.test(expr.value.trim()));

// Expression ending with an operator is incomplete (waiting for right operand), not invalid.
const isIncomplete = computed(() => /[+\-*/]\s*$/.test(expr.value.trim()));

// ONE admissibility check (UI-11) feeds the readout, the OK button and
// confirm() itself: expression validity, the owner's min/max/integer
// contract and the owner's veto (target disabled or gone).
// DOM visibility is not reactive: the session poll (inputSession.ts) bumps
// probeTick so a hidden or unmounted owner shows in the readout too.
const targetValid = computed(() => {
  void keypadState.probeTick; void keypadState.locked;
  return keypadState.canConfirm ? keypadState.canConfirm() : true;
});
const verdict = computed(() => validateEntry(expr.value, keypadState.constraints, targetValid.value));

const previewText = computed(() => {
  const v = result.value;
  // Empty = 0 (the value after "C") — visible, not implied.
  if (!expr.value.trim()) return verdict.value.value === null ? `= 0 · ${verdict.value.reason}` : '= 0';
  if (v === null) return isIncomplete.value ? '' : 'invalid';
  if (verdict.value.value === null) return `${isSimpleNumber.value ? '' : '= ' + fmtEval(v) + ' · '}${verdict.value.reason}`;
  if (isSimpleNumber.value) return '';
  return '= ' + fmtEval(v);
});

const previewInvalid = computed(() =>
  (result.value === null && !isIncomplete.value && !!expr.value.trim())
  || (verdict.value.value === null && !isIncomplete.value)
);

const heading = computed(() => keypadState.context || keypadState.label || 'Enter value');

// Display expression with human-friendly operator symbols.
const displayExpr = computed(() =>
  (expr.value || '0').replace(/\//g, '÷').replace(/\*/g, '×')
);

// ── Keypad actions ──────────────────────────────────────────────────────────

function append(s: string) {
  _dirty = true;
  if (replacing.value) { expr.value = s; replacing.value = false; return; }
  expr.value += s;
}

function del() { _dirty = true; replacing.value = false; expr.value = expr.value.slice(0, -1); }

function clear() { _dirty = true; replacing.value = false; expr.value = ''; }

function negate() {
  _dirty = true;
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

// Focus goes back to the field that opened the keypad (returnFocusTo in
// inputSession.ts: a guarded transition — the field's own confirm disables
// it for the busy latch, and until focus has landed again the shortcut map
// stays closed). The trigger is captured BEFORE closeKeypad() clears it.
function confirm() {
  // Re-validated HERE, not only on the button: physical Enter and a touch on
  // OK both land in this function, so a disabled OK is never the only
  // barrier. An inadmissible value keeps the entry and closes nothing. The
  // owner's veto is asked FRESH (not the cached readout computed): a target
  // hidden since the last poll must not receive the value.
  const ownerOk = keypadState.canConfirm ? keypadState.canConfirm() : true;
  const v = validateEntry(expr.value, keypadState.constraints, ownerOk);
  if (v.value === null) {
    if (!ownerOk) { cancel(); return; }  // owner vetoed — cancel path
    console.warn(`[keypad] not confirmed: ${v.reason}`);
    return;
  }
  const onConfirm = keypadState.onConfirm;
  const trigger = keypadState.trigger;
  dropDraft(_owner); _dirty = false; isDraft.value = false;
  closeKeypad();
  onConfirm?.(v.value);
  returnFocusTo(trigger);
}

function cancel() {
  const onCancel = keypadState.onCancel;
  const trigger = keypadState.trigger;
  dropDraft(_owner); _dirty = false; isDraft.value = false;
  closeKeypad();
  onCancel?.();
  returnFocusTo(trigger);
}

// Same press pattern as TextKeypadStrip: keys act on pointerdown with
// preventDefault — snappier on touch, and focus stays on the keypad root
// so physical-keyboard input keeps working between taps.
function press(e: PointerEvent, fn: () => void) {
  if (e.button !== 0) return;
  fn();
}

// Physical keyboard support — keydown bubbles from any child key to the root.
function onKeydown(e: KeyboardEvent) {
  // Escape is E-Stop everywhere (operator decision 2026-09-19) — it must
  // reach the window's capture listener untouched; the keypad only closes
  // via Cancel/OK. Space never leaves this root: with the keypad focused it
  // used to reach the shortcut map, where Space is Cycle Start (WP0, P0).
  if (e.key === 'Escape') return;
  if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); e.stopPropagation(); return; }
  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirm(); return; }
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
    :data-input-area="keypadState.ownerId"
    @keydown="onKeydown"
  >
    <div class="sub">{{ heading }}</div>
    <!-- Expression display — .inputField look, so the entry target is
         unmistakable (it's the same visual as the field being edited).
         Single line: result preview left, expression pinned right — the
         expression never moves when the preview appears, and an
         overflowing expression clips at its left (oldest) end. -->
    <div class="inputField nkDisplay row-tight">
      <span v-if="isDraft" class="nkPreview label-muted" data-draft>draft</span>
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
        <MachineBtn type="numKey" variant="primary" class="nkKey nkOk" :disabled="verdict.value === null" @pointerdown.prevent="press($event, confirm)" @contextmenu.prevent>OK</MachineBtn>
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
/* Fixed --key-size square keys (shared with TextKeypadStrip) — identical
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
