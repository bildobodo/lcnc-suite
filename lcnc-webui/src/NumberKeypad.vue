<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { keypadState, closeKeypad } from './useNumberKeypad';
import { evaluate, fmtEval } from './mathEval';
import { armed } from './lcncWs';
import MachineBtn from './MachineBtn.vue';

const expr = ref('');
const dialogEl = ref<HTMLElement | null>(null);
// When true, the next digit/decimal replaces the expression instead of appending.
// Set on open so the pre-populated value acts as a starting point, not a base to edit.
// Cleared on any keypad action. Operators do NOT replace — they keep the existing value
// as the left operand, letting the user continue a calculation from the current value.
const replacing = ref(false);

// Auto-close if the machine becomes disarmed while the keypad is open.
watch(armed, (isArmed) => { if (!isArmed) cancel(); });

// Re-init on mount AND on every subsequent openKeypad() call. Watching
// keypadState.seq (a monotonic counter) lets the dialog refresh its expression
// and steal focus even when it's already open and the new field has the same
// value as the old one (e.g. zero-to-zero re-targeting).
function loadFromState() {
  expr.value = keypadState.initial;
  replacing.value = !!keypadState.initial; // only replace when pre-populated
  nextTick(() => dialogEl.value?.focus());
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

// Physical keyboard support while the dialog is focused.
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
  <div class="dialogOverlay" @click.self="cancel">
    <div
      class="dialog md keypad-dialog"
      ref="dialogEl"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <!-- Header -->
      <div class="dialogHeader compact">
        <span class="dialogTitle">{{ keypadState.label || 'Enter value' }}</span>
        <MachineBtn type="close" @click="cancel">&times;</MachineBtn>
      </div>

      <!-- Expression display -->
      <div class="keypad-display">
        <div class="keypad-expr">{{ displayExpr }}</div>
        <div class="keypad-preview" :class="{ invalid: previewInvalid }">
          {{ previewText }}&nbsp;
        </div>
      </div>
      <div class="sep"></div>

      <!-- Button grid: 5 columns × 4 rows -->
      <div class="keypad-grid">
        <!-- Row 1 -->
        <MachineBtn type="numKey" @click="append('7')">7</MachineBtn>
        <MachineBtn type="numKey" @click="append('8')">8</MachineBtn>
        <MachineBtn type="numKey" @click="append('9')">9</MachineBtn>
        <MachineBtn type="numOp"  @click="append('/')">÷</MachineBtn>
        <MachineBtn type="numDel" @click="del">⌫</MachineBtn>
        <!-- Row 2 -->
        <MachineBtn type="numKey" @click="append('4')">4</MachineBtn>
        <MachineBtn type="numKey" @click="append('5')">5</MachineBtn>
        <MachineBtn type="numKey" @click="append('6')">6</MachineBtn>
        <MachineBtn type="numOp"  @click="append('*')">×</MachineBtn>
        <MachineBtn type="numClr" @click="clear">C</MachineBtn>
        <!-- Row 3 -->
        <MachineBtn type="numKey" @click="append('1')">1</MachineBtn>
        <MachineBtn type="numKey" @click="append('2')">2</MachineBtn>
        <MachineBtn type="numKey" @click="append('3')">3</MachineBtn>
        <MachineBtn type="numOp"  @click="append('-')">−</MachineBtn>
        <MachineBtn type="numOp"  @click="negate">±</MachineBtn>
        <!-- Row 4 -->
        <MachineBtn type="numOp"  @click="append('(')"><span class="mono">(</span></MachineBtn>
        <MachineBtn type="numKey" @click="append('0')">0</MachineBtn>
        <MachineBtn type="numKey" @click="append('.')">.</MachineBtn>
        <MachineBtn type="numOp"  @click="append('+')">+</MachineBtn>
        <MachineBtn type="numOp"  @click="append(')')"><span class="mono">)</span></MachineBtn>
      </div>

      <!-- Actions -->
      <div class="dialogActions">
        <MachineBtn type="dialogCancel" @click="cancel">Cancel</MachineBtn>
        <MachineBtn type="numEq" @click="evalExpr" :disabled="result === null">═</MachineBtn>
        <MachineBtn type="dialogConfirm" @click="confirm" :disabled="result === null && !!expr.trim()">OK</MachineBtn>
      </div>
    </div>
  </div>
</template>

<style scoped>
.keypad-dialog {
  width: min(320px, calc(100vw - 2 * var(--gap-panel)));
  outline: none;
}

.keypad-display {
  padding: var(--gap-controls) var(--gap-section);
  text-align: right;
}

.keypad-expr {
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-xl);
  word-break: break-all;
  min-height: 1.4em;
}

.keypad-preview {
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
  min-height: 1.4em;
}

.keypad-preview.invalid {
  color: var(--danger);
  opacity: var(--opacity-secondary);
}

.keypad-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--gap-tight);
  padding: var(--gap-controls);
}

/* Fill grid cells — layout-only :deep() is permitted. */
.keypad-grid :deep(.b) {
  width: 100%;
  min-height: 44px;
}
</style>
