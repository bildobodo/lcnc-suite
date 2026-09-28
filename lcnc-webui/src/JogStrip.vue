<script setup lang="ts">
import { usePermissionReasons } from "./permissions";
import { computed, inject, ref, watch, nextTick, onMounted, onUnmounted, type Ref, type Component } from "vue";
import { send } from "./lcncWs";
import { usePermissions } from "./permissions";
import { INPUT_DEFS } from "./machineControls";
import { registerJog, unregisterJog, activeJogKeys, forceStopAllJogs, forceStopJog, jogKeyFor } from "./useJogPointers";
import { useAxes } from "./useAxes";
import MachineBtn from "./MachineBtn.vue";
import MachineSelect from "./MachineSelect.vue";
import MachineSlider from "./MachineSlider.vue";
import ChoiceGroup from "./ChoiceGroup.vue";
import type { ChoiceOption } from "./choiceGroup";
import HelpIcon from "./HelpIcon.vue";
import { TASK_MODE_MANUAL, TASK_MODE_AUTO, TASK_MODE_MDI } from "./lcnc";
import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight,
  Square,
} from "lucide-vue-next";


const props = defineProps<{
  axes: string[];
  jogVel: number;
  angularJogVel: number;
  /** The speeds a Reset returns to (units / s) — shown on the button (N90). */
  defaultJogVel: number;
  defaultAngularJogVel: number;
  linearUnit: string;
  maxJogVel: number;
  maxAngularJogVel: number;
  minAngularJogVel: number;
  jogIncrement: number;
  minJogVel: number;
  iniIncrements: number[] | null;
  jogDisabled: boolean;
  taskMode: number;
  // Jog-frame selector (switchable-kins machines only; industry convention
  // — Heidenhain 3D-ROT manual setting, Siemens WCS/MCS softkey — is an
  // EXPLICIT operator choice of jog frame, prominently indicated).
  // null kinsType = machine can't switch: selector hidden entirely.
  // kinsType is the RAW switchkins pin; kinsMode is the FRAME it means on
  // this kins family (App.kinsMode) — the radios show and emit frames,
  // because the raw numbers differ per family (R-01).
  kinsType?: number | null;
  kinsMode?: number | null;
  // The TWP remap stack exists on this machine (App twpCapable, twin of the
  // gateway's _twp_capable): only then is Plane a frame at all. A TCP
  // trunnion is switchable (Machine/TCP) without any plane (TWP-08b).
  twpCapable?: boolean;
  twpDefined?: boolean | null;
  // Head solve stale (table moved since the last orient): the Plane frame's
  // Z is then NOT the face normal — say so where the operator picks it.
  twpStale?: boolean;
  // A head solve exists this session (G53.x / Orient ran): the Plane frame
  // is only OFFERED then — a bare M430 before any orient jogs on whatever
  // frame the kins pins last held (the stale-pin trap).
  twpOriented?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:jogVel", v: number): void;
  (e: "update:angularJogVel", v: number): void;
  (e: "update:jogIncrement", v: number): void;
  (e: "resetJogVel"): void;
  (e: "resetAngularJogVel"): void;
  (e: "modeChange", mode: number): void;
  (e: "setKinsMode", type: number): void;
}>();

const can = usePermissions();
// Plane radio title (U-06): the gate's own reason while it is closed —
// the same sentence the gateway would deny set_kins_mode with — else the
// frame's description; a tap on the disabled radio's label puts the reason
// in the message center (touch has no hover).
const reasons = usePermissionReasons();
const planeTitle = computed(() => {
  if (!can.value.planeFrame && reasons.value.planeFrame) return reasons.value.planeFrame;
  if (!props.twpOriented) {
    return props.twpDefined
      ? "Head not aligned with the plane — press Orient"
      : "No plane defined — Capture one or run G68.2";
  }
  // Enabled: a short hover name — the frames are explained ONCE, in the
  // Kinematics Frame help (design wave D1, UI-N33); the stale case keeps
  // its one-line warning.
  return props.twpStale
    ? "Plane is stale — the table moved since the last orient: press Orient"
    : "TOOL kinematics — jog in the tilted work plane";
});
// ─── Choice groups (operator point P7, Codex R21–R24) ──────────
// Mode, frame and step used to be vertical radio lists — 18 px rows on the
// desktop (below WCAG 2.5.8's 24 px) in two columns. Now connected rows:
// task mode and kinematics frame send machine commands — radios in a
// toolbar, MANUAL activation, the checked option the confirmed state; the
// step increment is local — a plain radio group (the arrows choose).
const modeOptions: ChoiceOption<number>[] = [
  { value: TASK_MODE_MANUAL, label: "Manual", gate: "modeSelect" },
  { value: TASK_MODE_MDI, label: "MDI", gate: "modeSelect" },
  { value: TASK_MODE_AUTO, label: "Auto", gate: "modeSelect" },
];
const frameOptions = computed<ChoiceOption<number>[]>(() => [
  { value: 0, label: "Machine", gate: "jogFrame", title: "Identity kinematics — jog along machine axes" },
  { value: 1, label: "TCP", gate: "jogFrame", title: "TCP kinematics — jog in the work frame" },
  ...(props.twpCapable ? [{ value: 2, label: "Plane", gate: "planeFrame" as const, title: planeTitle.value }] : []),
]);
// The plane's state has a RESERVED line under the frame (never a longer
// option label that moves the row): stale, not aligned, none defined.
const planeNote = computed(() => {
  if (!props.twpCapable) return "";
  if (props.twpStale) return "Plane stale — press Orient";
  if (!props.twpOriented) return props.twpDefined ? "Plane: head not aligned — Orient" : "Plane: none defined";
  return "";
});

const isDisabled = computed(() => !can.value[INPUT_DEFS.jogWheel.gate] || props.jogDisabled);

const isPortrait = inject<Ref<boolean>>("isPortrait", ref(false));

// ─── Axis groups from the shared source (WS-D) ─────────────
// X/Y/Z indices are resolved BY LETTER: the old code hardcoded X=0/Y=1 in
// the pad and Z=2 in the Z column, which jogs the wrong joint on any
// machine whose axes aren't XYZ-first (e.g. lathe ["X","Z"]).
const { abc: abcAxes, uvw: uvwAxes, find: findAxis } = useAxes(computed(() => props.axes));
// A reset names the value it returns to (design wave D6, N90).
const linearResetName = computed(() =>
  `Reset ${abcAxes.value.length > 0 ? "linear " : ""}jog speed to ${Math.round(props.defaultJogVel * 60)} ${props.linearUnit}/min`);
const rotaryResetName = computed(() => `Reset rotary jog speed to ${Math.round(props.defaultAngularJogVel * 60)} °/min`);
const xAxis = computed(() => findAxis("X"));
const yAxis = computed(() => findAxis("Y"));
const zAxis = computed(() => findAxis("Z"));
const hasXyPad = computed(() => xAxis.value != null && yAxis.value != null);

const incrementOptions = computed<{ label: string; value: number }[]>(() => {
  if (props.iniIncrements && props.iniIncrements.length > 0) {
    return [
      { label: "Cont", value: 0 },
      ...props.iniIncrements.map(v => ({ label: String(v), value: v })),
    ];
  }
  if (props.linearUnit === "in") {
    return [
      { label: "Cont", value: 0 },
      { label: ".0001", value: 0.0001 },
      { label: ".001", value: 0.001 },
      { label: ".01", value: 0.01 },
      { label: ".1", value: 0.1 },
    ];
  }
  return [
    { label: "Cont", value: 0 },
    { label: ".001", value: 0.001 },
    { label: ".01", value: 0.01 },
    { label: ".1", value: 0.1 },
    { label: "1", value: 1.0 },
  ];
});

// The step increment is a connected row only with at most STEP_ROW_MAX
// options AND a natural width that fits what the column's other groups
// (mode, frame) take — in portrait, the column's width; else a labelled
// select (Codex R22 OP22-04: six long values are 404 px). The measure is an
// invisible, inert sizer that is always there — the choice cannot flip-flop
// with its own width; it re-measures on its labels, the loaded font and the
// column's size.
const STEP_ROW_MAX = 6;
const stepOptions = computed<ChoiceOption<number>[]>(() =>
  incrementOptions.value.map(o => ({ value: o.value, label: o.label, gate: "jogIncrement" as const })));
const stepSizer = ref<HTMLElement | null>(null);
const choiceCol = ref<HTMLElement | null>(null);
const stepFits = ref(false);
function measureStep() {
  const sizer = stepSizer.value, col = choiceCol.value;
  if (!sizer || !col) return;
  const others = [...col.querySelectorAll<HTMLElement>(".choiceBlock:not(.stepBlock) .choiceRow")].map(r => r.offsetWidth);
  const budget = isPortrait.value ? col.clientWidth : Math.max(0, ...others);
  stepFits.value = sizer.offsetWidth <= budget;
}
const stepAsRow = computed(() => stepOptions.value.length <= STEP_ROW_MAX && stepFits.value);
let stepRo: ResizeObserver | null = null;
onMounted(() => {
  measureStep();
  void document.fonts?.ready.then(measureStep);
  stepRo = new ResizeObserver(measureStep);
  if (choiceCol.value) stepRo.observe(choiceCol.value);
  if (stepSizer.value) stepRo.observe(stepSizer.value);
});
onUnmounted(() => stepRo?.disconnect());
watch([stepOptions, isPortrait, () => props.kinsType, () => props.twpCapable], () => nextTick(measureStep));

// ─── XY grid square sizing (aspect-ratio unreliable in flex) ──
// Measures the PARENT row (.jogBtns) and applies the same value to both
// wrap dimensions. Observing the parent keeps the loop sound: the wrap's
// inline size can never feed back into the measurement, and a stale or
// dropped RO tick (Firefox defers notifications under same-frame layout
// shifts) still yields a square pad — a size error stays a size error
// instead of becoming uneven gaps / Z-column misalignment.
const jogBtnsRef = ref<HTMLElement>();
const xySize = ref(0);

const ro = new ResizeObserver(entries => {
  if (isPortrait.value) return; // CSS aspect-ratio handles square sizing in portrait
  for (const e of entries) xySize.value = e.contentRect.height;
});
onMounted(() => { if (jogBtnsRef.value) ro.observe(jogBtnsRef.value); });
onUnmounted(() => ro.disconnect());

// Reset inline size when switching to portrait so CSS aspect-ratio takes over
watch(isPortrait, (p) => { if (p) xySize.value = 0; });

// ─── Jog logic (press-and-hold) ─────────────────────────────
interface JogDef {
  label: string;
  shortLabel: string;
  dir_class: string;
  icon: Component;
  axis: number;
  dir: 1 | -1;
  axis2?: number;
  dir2?: 1 | -1;
}

const xyBtns = computed<JogDef[]>(() => {
  const xi = xAxis.value?.index ?? -1;
  const yi = yAxis.value?.index ?? -1;
  return [
    { label: "X-Y+", shortLabel: "",     icon: ArrowUpLeft,    axis: xi, dir: -1, axis2: yi, dir2: 1, dir_class: "" },
    { label: "Y+",   shortLabel: "Y+",   icon: ArrowUp,        axis: yi, dir: 1, dir_class: "jogV" },
    { label: "X+Y+", shortLabel: "",     icon: ArrowUpRight,   axis: xi, dir: 1, axis2: yi, dir2: 1, dir_class: "" },
    { label: "X-",   shortLabel: "X-",   icon: ArrowLeft,      axis: xi, dir: -1, dir_class: "jogH" },
    { label: "Jog Stop", shortLabel: "Stop", icon: Square,      axis: -1, dir: 1, dir_class: "" },
    { label: "X+",   shortLabel: "X+",   icon: ArrowRight,     axis: xi, dir: 1, dir_class: "jogH" },
    { label: "X-Y-", shortLabel: "",     icon: ArrowDownLeft,  axis: xi, dir: -1, axis2: yi, dir2: -1, dir_class: "" },
    { label: "Y-",   shortLabel: "Y-",   icon: ArrowDown,      axis: yi, dir: -1, dir_class: "jogV" },
    { label: "X+Y-", shortLabel: "",     icon: ArrowDownRight, axis: xi, dir: 1, axis2: yi, dir2: -1, dir_class: "" },
  ];
});

function stopAllJog() {
  forceStopAllJogs();
  // Belt-and-suspenders: stop all axes at backend level
  for (let i = 0; i < props.axes.length; i++) {
    send({ cmd: "jog_stop", axis: i });
  }
}

function makeBtnStopFn(btn: JogDef): () => void {
  const isDiag = btn.axis2 != null;
  if (props.jogIncrement > 0) return () => {};
  if (isDiag) return () => send({ cmd: "jog_stop_multi", axes: [btn.axis, btn.axis2!] });
  return () => send({ cmd: "jog_stop", axis: btn.axis });
}

function startJog(btn: JogDef, e: PointerEvent) {
  if (isDisabled.value) return;
  if (btn.axis < 0) { stopAllJog(); return; }
  if (activeJogKeys.has(btn.label)) return;

  const el = e.currentTarget as Element;
  // safe-silent: pointer capture is a best-effort UX aid; throws if the pointer is already gone
  try { el?.setPointerCapture?.(e.pointerId); } catch {}

  const isDiag = btn.axis2 != null && btn.dir2 != null;
  const v = isDiag ? props.jogVel * 0.7071 : props.jogVel;

  if (props.jogIncrement > 0) {
    const dist = isDiag ? props.jogIncrement * 0.7071 : props.jogIncrement;
    if (isDiag) {
      send({ cmd: "jog_incr_multi", axes: [
        { axis: btn.axis, vel: v * btn.dir, distance: dist * btn.dir },
        { axis: btn.axis2!, vel: v * btn.dir2!, distance: dist * btn.dir2! },
      ]});
    } else {
      send({ cmd: "jog_incr", axis: btn.axis, vel: v * btn.dir, distance: props.jogIncrement * btn.dir });
    }
  } else {
    if (isDiag) {
      send({ cmd: "jog_cont_multi", axes: [
        { axis: btn.axis, vel: v * btn.dir },
        { axis: btn.axis2!, vel: v * btn.dir2! },
      ]});
    } else {
      send({ cmd: "jog_cont", axis: btn.axis, vel: v * btn.dir });
    }
  }

  registerJog(e.pointerId, btn.label, makeBtnStopFn(btn), el);
}

function stopJog(btn: JogDef, e: PointerEvent) {
  // Ownership guard, not a key-set guard: only the pointer that started
  // this jog may stop it — a second finger tapping the held button must
  // not send jog_stop for a jog it doesn't own (registry desync).
  if (jogKeyFor(e.pointerId) !== btn.label) return;

  if (props.jogIncrement <= 0) {
    const isDiag = btn.axis2 != null;
    if (isDiag) {
      send({ cmd: "jog_stop_multi", axes: [btn.axis, btn.axis2!] });
    } else {
      send({ cmd: "jog_stop", axis: btn.axis });
    }
  }

  unregisterJog(e.pointerId);
  // safe-silent: releasing an already-released pointer throws harmlessly
  try { (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId); } catch {}
}

/**
 * Slide-off deadman: stop the jog when the pressing finger/cursor leaves
 * the button. @pointerleave cannot do this — pointer capture retargets
 * events to the captured button, so leave never fires mid-hold — hence
 * an explicit bounds test on the captured pointermove stream. A small
 * slack margin keeps edge jitter from dropping the jog.
 */
const SLIDE_OFF_SLACK = 8; // px
function slideOffCheck(e: PointerEvent) {
  if (jogKeyFor(e.pointerId) === undefined) return;
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  if (
    e.clientX < r.left - SLIDE_OFF_SLACK || e.clientX > r.right + SLIDE_OFF_SLACK ||
    e.clientY < r.top - SLIDE_OFF_SLACK || e.clientY > r.bottom + SLIDE_OFF_SLACK
  ) {
    forceStopJog(e.pointerId);
  }
}

// ─── Generic single-axis jog (Z, A, B, C, U, V, W) ─────────
function startAxisJog(axisIndex: number, dir: 1 | -1, vel: number, e: PointerEvent) {
  const letter = props.axes[axisIndex]!;
  const key = `${letter}${dir > 0 ? "+" : "-"}`;
  if (isDisabled.value || activeJogKeys.has(key)) return;

  const el = e.currentTarget as Element;
  // safe-silent: pointer capture is a best-effort UX aid; throws if the pointer is already gone
  try { el?.setPointerCapture?.(e.pointerId); } catch {}

  if (props.jogIncrement > 0) {
    send({ cmd: "jog_incr", axis: axisIndex, vel: vel * dir, distance: props.jogIncrement * dir });
  } else {
    send({ cmd: "jog_cont", axis: axisIndex, vel: vel * dir });
  }

  const stopFn = props.jogIncrement > 0 ? () => {} : () => send({ cmd: "jog_stop", axis: axisIndex });
  registerJog(e.pointerId, key, stopFn, el);
}

function stopAxisJog(axisIndex: number, dir: 1 | -1, e: PointerEvent) {
  const letter = props.axes[axisIndex]!;
  const key = `${letter}${dir > 0 ? "+" : "-"}`;
  // Ownership guard — see stopJog.
  if (jogKeyFor(e.pointerId) !== key) return;

  if (props.jogIncrement <= 0) {
    send({ cmd: "jog_stop", axis: axisIndex });
  }

  unregisterJog(e.pointerId);
  // safe-silent: releasing an already-released pointer throws harmlessly
  try { (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId); } catch {}
}
</script>

<template>
  <div class="stripSection">
    <div class="sub">Jog</div>
    <div class="jogContent row-sections">
      <div ref="jogBtnsRef" class="jogBtns row-sections">
        <div v-if="hasXyPad" class="xyWrap" :style="xySize ? { width: xySize + 'px', height: xySize + 'px' } : undefined">
          <div class="xyGrid">
            <MachineBtn
              v-for="btn in xyBtns"
              :key="btn.label"
              type="jog"
              class="jogBtn"
              :variant="btn.axis < 0 ? 'danger' : undefined"
              :active="activeJogKeys.has(btn.label)"
              @pointerdown.prevent="startJog(btn, $event)"
              @pointerup.prevent="stopJog(btn, $event)"
              @pointercancel.prevent="stopJog(btn, $event)"
              @pointerleave.prevent="stopJog(btn, $event)"
              @pointermove="slideOffCheck"
              @contextmenu.prevent
            ><div :class="['jogInner', btn.dir_class]"><component :is="btn.icon" class="jogIcon" /><span v-if="btn.shortLabel" class="jogLabel">{{ btn.shortLabel }}</span></div></MachineBtn>
          </div>
        </div>

        <div v-if="zAxis" class="axisCol zCol" :class="{ zTall: abcAxes.length > 0 && uvwAxes.length > 0, zOnly: abcAxes.length === 0 && uvwAxes.length === 0 }">
          <MachineBtn
            type="jog"
            class="jogBtn"
            :active="activeJogKeys.has('Z+')"
            @pointerdown.prevent="startAxisJog(zAxis.index, 1, jogVel, $event)"
            @pointerup.prevent="stopAxisJog(zAxis.index, 1, $event)"
            @pointercancel.prevent="stopAxisJog(zAxis.index, 1, $event)"
            @pointerleave.prevent="stopAxisJog(zAxis.index, 1, $event)"
            @pointermove="slideOffCheck"
            @contextmenu.prevent
          ><div class="jogInner jogZUp"><ArrowUp class="jogIcon" /><span class="jogLabel">Z+</span></div></MachineBtn>
          <MachineBtn
            type="jog"
            class="jogBtn"
            :active="activeJogKeys.has('Z-')"
            @pointerdown.prevent="startAxisJog(zAxis.index, -1, jogVel, $event)"
            @pointerup.prevent="stopAxisJog(zAxis.index, -1, $event)"
            @pointercancel.prevent="stopAxisJog(zAxis.index, -1, $event)"
            @pointerleave.prevent="stopAxisJog(zAxis.index, -1, $event)"
            @pointermove="slideOffCheck"
            @contextmenu.prevent
          ><div class="jogInner jogZDown"><ArrowDown class="jogIcon" /><span class="jogLabel">Z-</span></div></MachineBtn>
        </div>

        <!-- ABC axes (rotary — use angularJogVel), tight cluster -->
        <div v-if="abcAxes.length > 0" class="axisCluster">
          <div v-for="ra in abcAxes" :key="ra.letter" class="axisCol">
            <MachineBtn
              type="jog"
              class="jogBtn"
              :active="activeJogKeys.has(ra.letter + '+')"
              @pointerdown.prevent="startAxisJog(ra.index, 1, angularJogVel, $event)"
              @pointerup.prevent="stopAxisJog(ra.index, 1, $event)"
              @pointercancel.prevent="stopAxisJog(ra.index, 1, $event)"
              @pointerleave.prevent="stopAxisJog(ra.index, 1, $event)"
              @pointermove="slideOffCheck"
              @contextmenu.prevent
            ><div class="jogInner jogZUp"><ArrowUp class="jogIcon" /><span class="jogLabel">{{ ra.letter }}+</span></div></MachineBtn>
            <MachineBtn
              type="jog"
              class="jogBtn"
              :active="activeJogKeys.has(ra.letter + '-')"
              @pointerdown.prevent="startAxisJog(ra.index, -1, angularJogVel, $event)"
              @pointerup.prevent="stopAxisJog(ra.index, -1, $event)"
              @pointercancel.prevent="stopAxisJog(ra.index, -1, $event)"
              @pointerleave.prevent="stopAxisJog(ra.index, -1, $event)"
              @pointermove="slideOffCheck"
              @contextmenu.prevent
            ><div class="jogInner jogZDown"><ArrowDown class="jogIcon" /><span class="jogLabel">{{ ra.letter }}-</span></div></MachineBtn>
          </div>
        </div>

        <!-- UVW axes (secondary linear — use jogVel), tight cluster -->
        <div v-if="uvwAxes.length > 0" class="axisCluster">
          <div v-for="ra in uvwAxes" :key="ra.letter" class="axisCol">
            <MachineBtn
              type="jog"
              class="jogBtn"
              :active="activeJogKeys.has(ra.letter + '+')"
              @pointerdown.prevent="startAxisJog(ra.index, 1, jogVel, $event)"
              @pointerup.prevent="stopAxisJog(ra.index, 1, $event)"
              @pointercancel.prevent="stopAxisJog(ra.index, 1, $event)"
              @pointerleave.prevent="stopAxisJog(ra.index, 1, $event)"
              @pointermove="slideOffCheck"
              @contextmenu.prevent
            ><div class="jogInner jogZUp"><ArrowUp class="jogIcon" /><span class="jogLabel">{{ ra.letter }}+</span></div></MachineBtn>
            <MachineBtn
              type="jog"
              class="jogBtn"
              :active="activeJogKeys.has(ra.letter + '-')"
              @pointerdown.prevent="startAxisJog(ra.index, -1, jogVel, $event)"
              @pointerup.prevent="stopAxisJog(ra.index, -1, $event)"
              @pointercancel.prevent="stopAxisJog(ra.index, -1, $event)"
              @pointerleave.prevent="stopAxisJog(ra.index, -1, $event)"
              @pointermove="slideOffCheck"
              @contextmenu.prevent
            ><div class="jogInner jogZDown"><ArrowDown class="jogIcon" /><span class="jogLabel">{{ ra.letter }}-</span></div></MachineBtn>
          </div>
        </div>
      </div>

      <div class="speedGroup row-sections strip-slider-group">
        <div class="speedCol stack-controls">
          <span class="label-muted">{{ abcAxes.length > 0 ? 'Linear' : 'Speed' }}</span>
          <!-- value + unit in ONE cell (a portrait grid row keeps its four
               cells); the unit follows its source (design wave D0, UI-N02) -->
          <span class="jogSpeedVal stack-micro"><span class="val-mono val-slot">{{ Math.round(jogVel * 60) }}</span><span class="label-muted">{{ linearUnit }}/min</span></span>
          <MachineSlider gate="jogSpeed" :aria-label="abcAxes.length > 0 ? 'Linear jog speed' : 'Jog speed'" :aria-valuetext="`${Math.round(jogVel * 60)} ${linearUnit}/min`" :disabled="isDisabled" :min="minJogVel" :max="maxJogVel" :step="0.1" :modelValue="jogVel" @update:modelValue="(v: number | undefined) => { if (v != null) emit('update:jogVel', v) }" class="vSlider" />
          <!-- A reset shows the value it returns to and names it (N90) -->
          <MachineBtn type="jogSpeedReset" :disabled="isDisabled" @click="emit('resetJogVel')"
                      :aria-label="linearResetName" :title="linearResetName">{{ Math.round(defaultJogVel * 60) }}</MachineBtn>
        </div>
        <div v-if="abcAxes.length > 0" class="speedCol stack-controls">
          <span class="label-muted">Rotary</span>
          <span class="jogSpeedVal stack-micro"><span class="val-mono val-slot">{{ Math.round(angularJogVel * 60) }}</span><span class="label-muted">°/min</span></span>
          <MachineSlider gate="jogSpeed" aria-label="Rotary jog speed" :aria-valuetext="`${Math.round(angularJogVel * 60)} °/min`" :disabled="isDisabled" :min="minAngularJogVel" :max="maxAngularJogVel" :step="0.1" :modelValue="angularJogVel" @update:modelValue="(v: number | undefined) => { if (v != null) emit('update:angularJogVel', v) }" class="vSlider" />
          <MachineBtn type="jogSpeedReset" :disabled="isDisabled" @click="emit('resetAngularJogVel')"
                      :aria-label="rotaryResetName" :title="rotaryResetName">{{ Math.round(defaultAngularJogVel * 60) }}</MachineBtn>
        </div>
      </div>

      <!-- Step, mode and frame: connected rows in ONE column (operator
           point P7, Codex R21–R24). Mode and frame send machine commands —
           radios in a toolbar, manual activation (the arrows move focus,
           click / Enter / Space choose), the checked option the confirmed
           state. The step increment is local — the arrows choose. -->
      <div ref="choiceCol" class="choiceCol stack-controls">
        <div class="choiceBlock stepBlock stack-tight">
          <!-- one increment for every axis: mm (in) on linear, ° on rotary -->
          <span class="label-muted">Step ({{ abcAxes.length > 0 ? `${linearUnit} / °` : linearUnit }})</span>
          <ChoiceGroup v-if="stepAsRow" label="Jog step" activation="auto" :options="stepOptions" :modelValue="jogIncrement"
                       @choose="v => emit('update:jogIncrement', Number(v))" />
          <MachineSelect v-else gate="jogIncrement" aria-label="Jog step" :modelValue="jogIncrement"
                         @update:modelValue="(v: string | number | undefined) => { if (v != null) emit('update:jogIncrement', Number(v)) }">
            <option v-for="o in incrementOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </MachineSelect>
          <!-- the row's measure: never focusable, never read -->
          <div ref="stepSizer" class="choiceRow stepSizer" aria-hidden="true" inert>
            <span v-for="o in incrementOptions" :key="o.value" class="choice">{{ o.label }}</span>
          </div>
        </div>
        <div class="choiceBlock stack-tight">
          <span class="label-muted">Mode</span>
          <ChoiceGroup label="Task mode" :options="modeOptions" :modelValue="taskMode" @choose="v => emit('modeChange', v)" />
        </div>
        <!-- Jog frame: switchable-kins machines only (Heidenhain 3D-ROT /
             Siemens WCS-MCS convention — an explicit, indicated choice). The
             checked option is the ACTUAL kins type (an earlier version folded
             TCP into Machine: one click silently dropped TCP). Machine =
             identity (M428); TCP = M429, world XYZ rides the table; Plane =
             TOOL kins (M430), X/Y/Z in the tilted plane as of the last orient
             — always shown on a TWP machine, enabled once a head solve
             exists; its state has a reserved line below. -->
        <div v-if="kinsType != null" class="choiceBlock stack-tight">
          <!-- The explanation is a tap-friendly help, not a hover title (UX-11). -->
          <span class="label-muted sectionHelp">Kinematics Frame <HelpIcon label="Kinematics Frame"><strong>Machine</strong> — machine axes<br><strong>TCP</strong> — the tip stays on the part as A turns<br><strong>Plane</strong> — tilted plane (G59); re-orient after A moves</HelpIcon></span>
          <ChoiceGroup label="Kinematics frame" :options="frameOptions" :modelValue="kinsMode" @choose="v => emit('setKinsMode', v)" />
          <span v-if="twpCapable" class="choiceNote" :class="{ 'text-warn': twpStale, 'text-muted': !twpStale }">{{ planeNote || '\u00a0' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.jogContent > * { flex-shrink: 0; }

/* ── Left: XY grid + Z + extra axes ── */
.jogBtns {
  flex-shrink: 0;
  align-self: stretch;
}

.xyWrap {
  height: 100%;
  /* Square by construction even before (or without) the JS measurement:
     the height chain is definite now (--strip-section-h), so aspect-ratio
     resolves the width from it. The JS inline size (both dimensions, same
     value) overrides this for engines that mis-handle aspect-ratio in
     flex — either path yields a square, so RO timing can't skew the pad. */
  aspect-ratio: 1;
  flex-shrink: 0;
}
.xyGrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  /* --gap-controls: every neighbor pair here jogs a different direction */
  gap: var(--gap-controls);
  width: 100%;
  height: 100%;
}

.axisCol {
  display: grid;
  grid-template-rows: 1fr 1fr;
  /* --gap-controls: the two buttons drive the axis in OPPOSITE directions */
  gap: var(--gap-controls);
  height: 100%;
  min-width: 50px;
}
/* Axis columns inside one cluster (ABC / UVW) sit tight — matching the
   vertical gap between their +/- buttons; the wider row-sections gap of
   .jogBtns separates pad | Z | ABC | UVW. Not row-tight: that utility
   centers items, these must stretch. */
.axisCluster {
  display: flex;
  gap: var(--gap-controls);
}
/* No aspect-ratio on the buttons: they fill their grid cells. The cells
   are square because the WRAP is square (aspect-ratio / JS above) — a
   button-level ratio would underfill any transiently non-square cell
   (Firefox keeps ratio'd grid items square instead of stretching),
   spreading the slack into visibly uneven gaps and breaking row
   alignment with the free-stretching Z column. */
.jogBtn {
  touch-action: none;
  user-select: none;
}
/* Not a stack-* reimpl: direction VARIES per modifier below (jogV row,
   jogH/jogZDown column-reverse); default column for the Stop button. */
/* audit-ok: direction varies per modifier — not a stack utility */
.jogInner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-micro);
  pointer-events: none;
}
/* Vertical arrows (Y+/Y-/Z): icon left, label right */
.jogInner.jogV {
  flex-direction: row;
}
/* Horizontal arrows (X-/X+): label top, icon bottom */
.jogInner.jogH {
  flex-direction: column-reverse;
}
/* Up arrow: icon on top, label below */
.jogInner.jogZUp {
  flex-direction: column;
}
/* Down arrow: label on top, icon below */
.jogInner.jogZDown {
  flex-direction: column-reverse;
}
.jogIcon { flex-shrink: 0; }
.jogLabel {
  font-size: var(--fs-xl);
  font-weight: var(--fw-bold);
  line-height: 1;
}

/* ── Speed + step columns ── */
.speedCol {
  align-items: center;
  justify-content: center;
}
/* Jog speed ticks while dragging the slider — a fixed slot ("10000" =
   5ch) keeps the neighbours still per digit change. Value and unit are
   CENTRED over the slider (operator, D1 live look: the right-aligned
   number and the left-aligned unit sat off its axis). */
.speedCol .val-slot { --slot-w: 5.5ch; text-align: center; }
.jogSpeedVal { align-items: center; }
.vSlider {
  flex: 1;
  min-height: 0;
}

/* ── Choice column: the step row's measure takes no space ── */
.stepSizer {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
}
.choiceBlock { position: relative; }
/* The frame label is as wide as its words: its "?" (anchored at the
   label's right edge, out of the flow) sits beside "Frame" — the column is
   as wide as its widest choice row, and a block label put the "?" at the
   column's edge, away from what it explains. */
.choiceBlock > .sectionHelp { width: fit-content; }

/* ── Portrait layout ── */
@media (orientation: portrait) {
  .jogContent { flex-direction: column; }

  /* XY grid: full width, square via aspect-ratio */
  .jogBtns  { flex-wrap: wrap; align-self: auto; gap: var(--gap-controls); }
  /* No !important: the JS inline size is cleared in portrait (xySize → 0,
     see the isPortrait watcher), so this rule is the only width source. */
  .xyWrap   { flex: 0 0 100%; width: 100%; aspect-ratio: 1; height: auto; }

  /* Axis area below the pad: 4 equal columns — Z leftmost at the same
     width as the others, ABC / UVW pairs fill columns 2-4 (one band row
     per cluster; clusters dissolve via display:contents). Full width
     used, no ragged leftover. */
  .jogBtns  { display: grid; grid-template-columns: repeat(4, 1fr); }
  .xyWrap   { grid-column: 1 / -1; }
  .axisCluster { display: contents; }
  /* Arrow + label + button padding need more than the former fixed 48px.
     Let content set the row floor so both enabled and explained/disabled
     buttons fit without clipping the arrow or the axis letter. */
  .axisCol  { height: auto; grid-template-rows: repeat(2, minmax(48px, auto)); min-width: 0; }
  /* Both ABC and UVW present → Z spans both band rows (Z+ / Z- each get
     a full band, single-column width) */
  .zCol.zTall { grid-column: 1; grid-row: 2 / span 2; grid-template-rows: 1fr 1fr; }
  /* No extra axes at all → Z pair spans the full width */
  .zCol.zOnly { grid-column: 1 / -1; }

  /* Speed sliders: dissolve into speedGroup's shared grid */
  .speedCol { display: contents; }
}
</style>
