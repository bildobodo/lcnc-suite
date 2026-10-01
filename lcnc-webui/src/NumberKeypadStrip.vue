<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { keypadState, closeKeypad } from './useNumberKeypad';
import { evaluate, fmtEval, validateEntry } from './mathEval';
import { saveDraft, takeDraft, dropDraft, returnFocusTo } from './inputSession';
import { armed } from './lcncWs';
import MachineBtn from './MachineBtn.vue';
import { X, Delete } from 'lucide-vue-next';

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
watch(() => keypadState.focusTick, () => nextTick(() => rootEl.value?.focus()));
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

// Discard: throw the entry away and close (the owner keeps its value).
function cancel() {
  const onCancel = keypadState.onCancel;
  const trigger = keypadState.trigger;
  dropDraft(_owner); _dirty = false; isDraft.value = false;
  closeKeypad();
  onCancel?.();
  returnFocusTo(trigger);
}

// The X (UX-01, operator decision 2026-09-21): hide the helper and KEEP the
// entry as the owner's draft — the contract the text keyboard's X and the
// outside/Tab leave already have (closeKeypad(keepDraft): the strip files
// the draft on unmount, it comes back marked "draft"). Discard is the
// explicit throw-away; both hand focus back through the guarded return.
function hide() {
  const trigger = keypadState.trigger;
  closeKeypad(true);
  returnFocusTo(trigger);
}

// Same activation pattern as TextKeypadStrip: keys act on CLICK — the one
// event a pointer (tap/click) and the keyboard (Enter/Space on a focused
// key) both produce, exactly once — with pointerdown default-prevented so
// a press never takes focus from the keypad root (physical-keyboard input
// keeps working between taps). Acting on pointerdown left a Tab-focused
// key dead to Enter/Space (implementation review UI-I10).

// Physical keyboard support — keydown bubbles from any child key to the root.
function onKeydown(e: KeyboardEvent) {
  // Escape is E-Stop everywhere (operator decision 2026-09-19) — it must
  // reach the window's capture listener untouched; the keypad only closes
  // via Cancel/OK.
  if (e.key === 'Escape') return;
  const activation = e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';
  // A FOCUSED key (Tab-navigated) activates its OWN action with Enter/Space
  // — the native click; the root's confirm is for the entry itself (root
  // focused). Enter on a focused Cancel confirmed the value (UI-I10, P1).
  // The key stays on the focused button: the shortcut map hands activation
  // keys to whatever has focus, and the helper keeps the modal guard up.
  if (activation && (e.target as HTMLElement | null)?.closest?.('button')) return;
  // Space never leaves this root otherwise: with the root focused it used
  // to reach the shortcut map, where Space is Cycle Start (WP0, P0).
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
    <!-- One grid holds the readout, the keys AND the actions (design wave
         D7): the readout heads it with the X at its right — the helper's
         top-right key in both orientations, as in the text keyboard; the
         other actions take a 6th column in landscape and the bottom row in
         portrait (Discard | ═ | Apply). -->
    <div class="nkGrid">
        <!-- Expression display — .inputField look, so the entry target is
             unmistakable (it's the same visual as the field being edited).
             TWO lines, both right-aligned (live look 2026-10-01: a preview
             LEFT of the entry read as part of the number): the entry on top,
             the result preview / draft mark under it. The lower line is
             always there, so the entry never moves when a preview appears;
             an overflowing entry clips at its left (oldest) end. -->
        <div class="inputField nkDisplay">
          <span class="nkExpr">{{ displayExpr }}</span>
          <span class="nkSub row-tight">
            <span v-if="isDraft" class="nkPreview label-muted" data-draft>draft</span>
            <span class="nkPreview" :class="{ invalid: previewInvalid }">{{ previewText || '\u00a0' }}</span>
          </span>
        </div>
        <!-- Row 1 -->
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent @click="append('7')" @contextmenu.prevent>7</MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent @click="append('8')" @contextmenu.prevent>8</MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent @click="append('9')" @contextmenu.prevent>9</MachineBtn>
        <MachineBtn type="numOp"  class="nkKey" @pointerdown.prevent aria-label="Divide" title="Divide" @click="append('/')" @contextmenu.prevent>÷</MachineBtn>
        <MachineBtn type="numDel" class="nkKey" aria-label="Backspace" title="Backspace" @pointerdown.prevent @click="del" @contextmenu.prevent><Delete :size="16" /></MachineBtn>
        <!-- Row 2 -->
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent @click="append('4')" @contextmenu.prevent>4</MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent @click="append('5')" @contextmenu.prevent>5</MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent @click="append('6')" @contextmenu.prevent>6</MachineBtn>
        <MachineBtn type="numOp"  class="nkKey" @pointerdown.prevent aria-label="Multiply" title="Multiply" @click="append('*')" @contextmenu.prevent>×</MachineBtn>
        <MachineBtn type="numClr" class="nkKey" aria-label="Clear entry" title="Clear the entry (= 0)" @pointerdown.prevent @click="clear" @contextmenu.prevent>Clr</MachineBtn>
        <!-- Row 3 -->
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent @click="append('1')" @contextmenu.prevent>1</MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent @click="append('2')" @contextmenu.prevent>2</MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent @click="append('3')" @contextmenu.prevent>3</MachineBtn>
        <MachineBtn type="numOp"  class="nkKey" @pointerdown.prevent aria-label="Minus" title="Minus" @click="append('-')" @contextmenu.prevent>−</MachineBtn>
        <MachineBtn type="numOp"  class="nkKey" @pointerdown.prevent aria-label="Negate" title="Negate the value" @click="negate" @contextmenu.prevent>±</MachineBtn>
        <!-- Row 4 -->
        <MachineBtn type="numOp"  class="nkKey" @pointerdown.prevent aria-label="Open parenthesis" title="Open parenthesis" @click="append('(')" @contextmenu.prevent><span class="mono">(</span></MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent @click="append('0')" @contextmenu.prevent>0</MachineBtn>
        <MachineBtn type="numKey" class="nkKey" @pointerdown.prevent @click="append('.')" @contextmenu.prevent>.</MachineBtn>
        <MachineBtn type="numOp"  class="nkKey" @pointerdown.prevent aria-label="Plus" title="Plus" @click="append('+')" @contextmenu.prevent>+</MachineBtn>
        <MachineBtn type="numOp"  class="nkKey" @pointerdown.prevent aria-label="Close parenthesis" title="Close parenthesis" @click="append(')')" @contextmenu.prevent><span class="mono">)</span></MachineBtn>
        <!-- Actions (UX-01/UX-04): X hides and keeps the entry as a draft,
             Discard throws it away, ═ evaluates, Apply confirms — same key
             types as the text keyboard's rails, so both strips look alike.
             Explicitly grid-placed; the digit/operator keys auto-place
             around them. -->
        <MachineBtn type="numClose" class="nkKey nkClose" aria-label="Close keyboard" title="Close keyboard — keeps the entry as a draft" @pointerdown.prevent @click="hide" @contextmenu.prevent><X :size="20" /></MachineBtn>
        <MachineBtn type="numDiscard" class="nkKey nkDiscard" aria-label="Discard" title="Discard the entry" @pointerdown.prevent @click="cancel" @contextmenu.prevent>Discard</MachineBtn>
        <MachineBtn type="numEq" class="nkKey nkEq" aria-label="Evaluate" title="Evaluate the expression" :disabled="result === null" @pointerdown.prevent @click="evalExpr" @contextmenu.prevent>═</MachineBtn>
        <MachineBtn type="numKey" variant="primary" class="nkKey nkOk" aria-label="Apply" title="Apply the value" :disabled="verdict.value === null" @pointerdown.prevent @click="confirm" @contextmenu.prevent>Apply</MachineBtn>
    </div>
  </div>
</template>

<style scoped>
.nkStrip { outline: none; }
/* Display box: .inputField provides the visual (bg, border, radius,
   tabular-nums) — only layout is added here. Overflow clips at the left
   because content is end-justified. */
.nkDisplay {
  /* two right-aligned lines in the one --key-size row (no stack utility:
     the lines sit flush, the readout's own padding spaces them) */
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  padding-block: 0;
  overflow: hidden;
}
/* no max-width: a line wider than the readout overflows at its START
   (cross-axis end alignment) and clips there — the oldest end of the entry */
.nkExpr,
.nkSub {
  line-height: 1.15;
  white-space: nowrap;
}
.nkSub { justify-content: flex-end; }
.nkExpr {
  font-size: var(--fs-lg);
  white-space: nowrap;
}
.nkPreview {
  font-size: var(--fs-sm);
  color: var(--fg-muted);
  white-space: nowrap;
}
.nkPreview.invalid {
  color: var(--danger-text);
}
/* Fixed --key-size square keys (shared with TextKeypadStrip) — identical
   in both orientations. The readout and the actions are explicitly placed;
   the keys auto-place around them (rows 2–5). Landscape: the readout over
   the five key columns, the X 44 × 44 at the right end of the action
   column, Discard · ═ · Apply (two rows, like the text keyboard's Enter)
   under it — five rows, the text keyboard's height. */
.nkGrid {
  display: grid;
  grid-template-columns: repeat(5, var(--key-size)) minmax(var(--key-action-w), auto);
  grid-auto-rows: var(--key-size);
  gap: var(--gap-tight);
}
.nkDisplay { grid-column: 1 / 6; grid-row: 1; min-height: 0; }
.nkClose   { grid-column: 6; grid-row: 1; width: var(--key-size); justify-self: end; }
.nkDiscard { grid-column: 6; grid-row: 2; }
.nkEq      { grid-column: 6; grid-row: 3; }
.nkOk      { grid-column: 6; grid-row: 4 / 6; }
.nkKey {
  min-height: 0; /* grid rows own the height — override the touch layer's button floor */
  /* Word keys (Discard, Apply, Clr) in a --key-size cell: the cell owns the
     width, like .tkKey — the size's horizontal padding would leave 16 px. */
  padding-left: 0;
  padding-right: 0;
}

@media (orientation: portrait) {
  /* Five key columns (the narrow strip): the readout over four, the X in
     the fifth — still the top-right key — and the other actions a
     full-width bottom row (Discard | ═ | Apply). */
  .nkGrid { grid-template-columns: repeat(5, var(--key-size)); }
  .nkDisplay { grid-column: 1 / 5; }
  .nkClose   { grid-column: 5;     grid-row: 1; }
  .nkDiscard { grid-column: 1 / 3; grid-row: 6; }
  .nkEq      { grid-column: 3;     grid-row: 6; }
  .nkOk      { grid-column: 4 / 6; grid-row: 6; }
}
</style>
