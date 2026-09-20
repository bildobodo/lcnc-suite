<script setup lang="ts">
import { computed, onUnmounted, ref, useAttrs, watch } from 'vue';
import { Keyboard } from 'lucide-vue-next';
import { usePermissions } from './permissions';
import { INPUT_DEFS, INPUT_SIZE_STYLES, type InputType, type InputDef } from './machineControls';
import { openKeypad, keypadState, closeKeypadIf, newKeypadOwnerId } from './useNumberKeypad';
import { openTextSession, closeTextSessionIf, lockTextSessionIf, onOwnerFocusOut, inputSession, dropDraft, type TextTarget } from './inputSession';
import { isTouchDevice } from './touchDetect';
import { connected } from './lcncWs';
import type { EntryConstraints } from './mathEval';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  gate: InputType;
  disabled?: boolean;
  /** Field name shown in the keypad header (e.g. "Diameter"). */
  label?: string;
  /** Full target context for the keypad readout ("T12 · Diameter · mm"). */
  context?: string;
  /** Whole numbers only — tool number, pocket, flutes (UI-11). `step` is
   *  NOT read as a precision hint; this is the one explicit integer flag. */
  integer?: boolean;
  /** Text fields: the owner id and opener when the PARENT runs the session
   *  (the MDI line is a code target with Send semantics); absent → this
   *  component opens a plain text session for the field. */
  sessionOwner?: string;
  sessionOpen?: () => void;
  /** Text fields: no on-screen keyboard at all. */
  noSession?: boolean;
}>();

const attrs = useAttrs();
const model = defineModel<string | number | null>();
const can = usePermissions();
const def = computed((): InputDef => INPUT_DEFS[props.gate]);
const isDisabled = computed(() => !can.value[def.value.gate] || props.disabled);
const isNumber = computed(() => attrs.type === 'number');

const catalogStyle = computed(() => {
  const d = def.value;
  const s: Record<string, string> = {};
  if (d.align) s.textAlign = d.align;
  if (d.width) s.width = d.width;
  if (d.mono) s.fontVariantNumeric = 'tabular-nums';
  if (d.size && INPUT_SIZE_STYLES[d.size]) Object.assign(s, INPUT_SIZE_STYLES[d.size]);
  return Object.keys(s).length ? s : undefined;
});

const keypadDisplayValue = computed(() =>
  attrs.value !== undefined ? (attrs.value as string | number | undefined) : model.value
);

// Field contract handed to the keypad: min/max from the attrs (never
// clamped there — an out-of-range value is refused), integer from the prop.
function numAttr(name: string): number | undefined {
  const raw = attrs[name];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
const constraints = computed<EntryConstraints | null>(() => {
  const c: EntryConstraints = {};
  const min = numAttr('min'), max = numAttr('max');
  if (min !== undefined) c.min = min;
  if (max !== undefined) c.max = max;
  if (props.integer) c.integer = true;
  return Object.keys(c).length ? c : null;
});

const inputEl = ref<HTMLInputElement | null>(null);
// Owner identity for the helper session (UI-13/UI-15): closing is scoped to
// THIS field — a helper opened for another field is never touched from here.
const ownerId = props.sessionOwner ?? newKeypadOwnerId(isNumber.value ? 'input' : 'text');
const isKeypadActive = computed(() => keypadState.open && keypadState.ownerId === ownerId);

function openKeypadFromInput(e: Event) {
  if (isDisabled.value) return;
  openKeypad({
    value: keypadDisplayValue.value ?? null,
    label: props.label,
    context: props.context,
    ownerId,
    constraints: constraints.value,
    canConfirm: () => !isDisabled.value && !!inputEl.value?.isConnected && inputEl.value.offsetParent !== null,
    trigger: e.currentTarget as HTMLElement,
    onConfirm: (v) => {
      model.value = v;
      // Native input/change events don't fire for keypad confirms — synthesize them
      // so both :value+@input parents and v-model+@change parents react.
      const evt = { target: { value: String(v) } } as unknown as Event;
      const onInput = attrs.onInput as ((e: Event) => void) | undefined;
      if (typeof onInput === 'function') onInput(evt);
      const onChange = attrs.onChange as ((e: Event) => void) | undefined;
      if (typeof onChange === 'function') onChange(evt);
    },
  });
}

// ── Text fields: the on-screen keyboard session (WP8) ──
const textEl = ref<HTMLInputElement | null>(null);
const sessionEnabled = computed(() => !isNumber.value && !props.noSession);
const isTextActive = computed(() => sessionEnabled.value && inputSession.kind !== null && inputSession.ownerId === ownerId);

function fireInput() {
  const el = textEl.value;
  if (!el) return;
  model.value = el.value;
  const evt = { target: el } as unknown as Event;
  const onInput = attrs.onInput as ((e: Event) => void) | undefined;
  if (typeof onInput === 'function') onInput(evt);
}
function textTarget(): TextTarget {
  const el = () => textEl.value;
  return {
    insert(text) { const e = el(); if (!e) return; e.setRangeText(text, e.selectionStart ?? e.value.length, e.selectionEnd ?? e.value.length, 'end'); fireInput(); },
    backspace() { const e = el(); if (!e) return; let s = e.selectionStart ?? e.value.length; const n = e.selectionEnd ?? s; if (s === n && s > 0) s -= 1; if (s === n) return; e.setRangeText('', s, n, 'end'); fireInput(); },
    // Plain text: Enter is "done" — the value is already in the field, the
    // helper closes; never a machine action (search fields, descriptions).
    enter() { closeTextSessionIf(ownerId, 'done'); textEl.value?.focus(); },
    clear() { const e = el(); if (!e) return; e.value = ''; fireInput(); },
    moveCursor(d) { const e = el(); if (!e) return; const p = Math.max(0, Math.min(e.value.length, (e.selectionStart ?? 0) + d)); e.setSelectionRange(p, p); },
    canConfirm: () => !isDisabled.value && !!textEl.value?.isConnected && textEl.value.offsetParent !== null,
  };
}
function openText() {
  if (isDisabled.value) return;
  if (props.sessionOpen) { props.sessionOpen(); return; }
  if (!sessionEnabled.value) return;
  const context = props.context ?? props.label ?? (typeof attrs.placeholder === 'string' ? attrs.placeholder : 'Text');
  openTextSession({ ownerId, kind: 'text', context, target: textTarget(), enterLabel: 'OK' });
}
// Opening is a deliberate act: a click/tap on the field (touch or mouse) or
// the keyboard glyph — never focus (UI-15a).
function onTextClick() { if (!isTextActive.value) openText(); }

// Keyboard glyph (non-touch): appears while the field is focused, anchored
// at its right edge through a body Teleport; it belongs to the focus area.
const glyphVisible = ref(false);
const glyphPos = ref({ left: 0, top: 0 });
function placeGlyph() {
  const el = textEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  glyphPos.value = { left: r.right - 2, top: r.top + r.height / 2 };
}
function onTextFocus() {
  if (isTouchDevice.value || isDisabled.value || props.noSession) return;
  if (!props.sessionOpen && !sessionEnabled.value) return;
  glyphVisible.value = true;
  placeGlyph();
  document.addEventListener('scroll', placeGlyph, true);
  window.addEventListener('resize', placeGlyph);
}
function hideGlyph() {
  glyphVisible.value = false;
  document.removeEventListener('scroll', placeGlyph, true);
  window.removeEventListener('resize', placeGlyph);
}
function onTextFocusOut(e: FocusEvent) {
  const rel = e.relatedTarget as Element | null;
  if (!rel || !rel.closest?.(`[data-input-area="${CSS.escape(ownerId)}"]`)) hideGlyph();
  onOwnerFocusOut(ownerId, e);
}

// Hidden-but-mounted owner (tab switch): lock the session, keep it.
let visTimer = 0;
watch(isTextActive, (active) => {
  clearInterval(visTimer);
  if (!active) return;
  visTimer = window.setInterval(() => {
    const el = textEl.value;
    lockTextSessionIf(ownerId, !el || el.offsetParent === null);
  }, 300);
});

// The gate closing mid-entry (disarm, machine state change) ends the session
// through the same owner path as unmount — the value can no longer be
// delivered to this field, so the helper must not stay up promising it.
watch(isDisabled, (off) => {
  if (!off) return;
  closeKeypadIf(ownerId, 'field disabled while the keypad was open');
  closeTextSessionIf(ownerId, 'field disabled while the keyboard was open');
});
watch(connected, (c) => { if (!c) { closeKeypadIf(ownerId, 'connection lost'); closeTextSessionIf(ownerId, 'connection lost'); dropDraft(ownerId); } });
onUnmounted(() => {
  closeKeypadIf(ownerId);
  closeTextSessionIf(ownerId);
  dropDraft(ownerId);
  clearInterval(visTimer);
  hideGlyph();
});

// The text branch renders a fragment (input + teleported glyph), so a
// parent's `$el` would be a fragment anchor: expose the element itself.
defineExpose({ inputElement: () => textEl.value ?? inputEl.value });
</script>

<template>
  <!-- Number inputs: read-only display field that opens the keypad on click/Enter/Space. -->
  <input
    v-if="isNumber"
    ref="inputEl"
    v-bind="attrs"
    type="text"
    :style="catalogStyle"
    :value="keypadDisplayValue"
    :disabled="isDisabled"
    readonly
    inputmode="none"
    lang="en"
    class="inputField"
    :class="{ 'keypad-active': isKeypadActive }"
    :data-input-area="ownerId"
    @click="openKeypadFromInput"
    @keydown.enter.prevent="openKeypadFromInput"
    @keydown.space.prevent="openKeypadFromInput"
  >
  <!-- Text-like inputs: standard editable field + the on-screen keyboard
       session (tap / glyph opens it; the physical keyboard keeps working). -->
  <template v-else>
    <input
      ref="textEl"
      v-bind="attrs"
      :style="catalogStyle"
      v-model="model"
      :disabled="isDisabled"
      :inputmode="isTouchDevice && !noSession ? 'none' : (attrs.inputmode as string | undefined)"
      lang="en"
      class="inputField"
      :class="{ 'keypad-active': isTextActive }"
      :data-input-area="ownerId"
      @click="onTextClick"
      @focus="onTextFocus"
      @focusout="onTextFocusOut"
    >
    <Teleport to="body">
      <button v-if="glyphVisible" type="button" class="inputAction" :data-input-area="ownerId"
              aria-label="Open keyboard" title="Open keyboard"
              :style="{ left: glyphPos.left + 'px', top: glyphPos.top + 'px' }"
              @pointerdown.prevent @click="openText">
        <Keyboard :size="14" />
      </button>
    </Teleport>
  </template>
</template>
