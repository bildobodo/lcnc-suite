<script setup lang="ts">
import { computed, onUnmounted, ref, useAttrs, watch, type InputHTMLAttributes } from 'vue';
import { usePermissions, usePermissionReasons, CLIENT_REASONS } from './permissions';
import { INPUT_DEFS, INPUT_SIZE_STYLES, type InputType, type InputDef } from './machineControls';
import { openKeypad, keypadState, closeKeypadIf, newKeypadOwnerId } from './useNumberKeypad';
import { openTextSession, closeTextSessionIf, inputSession, dropDraft, showInputGlyph, hideInputGlyph, placeInputGlyph, type TextTarget } from './inputSession';
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
const reasons = usePermissionReasons();
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
  // Already this field's session (a second tap on the same field): keep
  // the expression the operator is typing — re-opening would reset it.
  if (isKeypadActive.value && !keypadState.locked) return;
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
// Touch: the OS keyboard is suppressed wherever the strip keyboard serves
// the field; otherwise the caller's inputmode (if any) passes through.
const textInputMode = computed<InputHTMLAttributes['inputmode']>(() =>
  isTouchDevice.value && !props.noSession ? 'none' : (attrs.inputmode as InputHTMLAttributes['inputmode']));

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
    // Hidden-but-mounted (tab switch) → the session locks (inputSession poll).
    isVisible: () => !!textEl.value && textEl.value.offsetParent !== null,
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

// Keyboard glyph (non-touch): shown while the field is focused, rendered
// once by FloatingOverlays.vue at the field's right edge (inputSession
// inputGlyph); it belongs to this field's focus area.
function placeGlyph() { if (textEl.value) placeInputGlyph(ownerId, textEl.value); }
function onTextFocus() {
  if (isTouchDevice.value || isDisabled.value || props.noSession) return;
  if (!props.sessionOpen && !sessionEnabled.value) return;
  if (!textEl.value) return;
  showInputGlyph(ownerId, textEl.value, openText);
  document.addEventListener('scroll', placeGlyph, true);
  window.addEventListener('resize', placeGlyph);
}
function hideGlyph() {
  hideInputGlyph(ownerId);
  document.removeEventListener('scroll', placeGlyph, true);
  window.removeEventListener('resize', placeGlyph);
}
// The session's own leave rule (focus out of the area) lives in
// inputSession.ts for field, glyph and keys alike; the glyph just follows
// the field's focus.
function onTextFocusOut(e: FocusEvent) {
  const rel = e.relatedTarget as Element | null;
  if (!rel || !rel.closest?.(`[data-input-area="${CSS.escape(ownerId)}"]`)) hideGlyph();
}

// The gate closing mid-entry (disarm, machine state change) ends the
// field's context through the same owner path as unmount: the open session
// — the value can no longer be delivered to this field, so the helper must
// not stay up promising it — AND the field's filed draft. NOT an end: the
// busy latch after any fire() ("settling", DEFAULT_COOLDOWN_MS) closes every
// busy gate for 200 ms and re-opens it — the draft parked on this field
// while a sibling's value was confirmed survives that (review round 2,
// UI-I05 B, and the draft rule of UI-15 would be void otherwise).
const settling = computed(() => reasons.value[def.value.gate] === CLIENT_REASONS.settling);
const ownerEnded = computed(() => !!props.disabled || (!can.value[def.value.gate] && !settling.value));
watch(ownerEnded, (ended) => {
  if (!ended) return;
  closeKeypadIf(ownerId, 'field disabled while the keypad was open');
  closeTextSessionIf(ownerId, 'field disabled while the keyboard was open');
});
watch(connected, (c) => { if (!c) { closeKeypadIf(ownerId, 'connection lost'); closeTextSessionIf(ownerId, 'connection lost'); dropDraft(ownerId); } });
onUnmounted(() => {
  closeKeypadIf(ownerId);
  closeTextSessionIf(ownerId);
  dropDraft(ownerId);
  hideGlyph();
});

// Both branches render a single <input> root (a parent's `$el` and its
// scoped CSS reach it); the accessor is the explicit API for parents that
// drive a session on the field (App's MDI line).
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
  <input
    v-else
    ref="textEl"
    v-bind="attrs"
    :style="catalogStyle"
    v-model="model"
    :disabled="isDisabled"
    :inputmode="textInputMode"
    lang="en"
    class="inputField"
    :class="{ 'keypad-active': isTextActive }"
    :data-input-area="ownerId"
    @click="onTextClick"
    @focus="onTextFocus"
    @focusout="onTextFocusOut"
  >
</template>
