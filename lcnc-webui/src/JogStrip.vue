<script setup lang="ts">
import { computed, inject, ref, watch, onMounted, onUnmounted, type Ref, type Component } from "vue";
import { send } from "./lcncWs";
import { usePermissions } from "./permissions";
import { INPUT_DEFS } from "./machineControls";
import { registerJog, unregisterJog, activeJogKeys, forceStopAllJogs } from "./useJogPointers";
import MachineBtn from "./MachineBtn.vue";
import MachineRadio from "./MachineRadio.vue";
import MachineSlider from "./MachineSlider.vue";
import { TASK_MODE_MANUAL, TASK_MODE_AUTO, TASK_MODE_MDI } from "./lcnc";
import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight,
  Square,
} from "lucide-vue-next";

const ABC = new Set(["A", "B", "C"]);
const UVW = new Set(["U", "V", "W"]);
const EXTRA = new Set([...ABC, ...UVW]);

const props = defineProps<{
  axes: string[];
  jogVel: number;
  angularJogVel: number;
  linearUnit: string;
  maxJogVel: number;
  maxAngularJogVel: number;
  minAngularJogVel: number;
  jogIncrement: number;
  minJogVel: number;
  iniIncrements: number[] | null;
  jogDisabled: boolean;
  taskMode: number;
}>();

const emit = defineEmits<{
  (e: "update:jogVel", v: number): void;
  (e: "update:angularJogVel", v: number): void;
  (e: "update:jogIncrement", v: number): void;
  (e: "resetJogVel"): void;
  (e: "resetAngularJogVel"): void;
  (e: "modeChange", mode: number): void;
}>();

const can = usePermissions();
const isDisabled = computed(() => !can.value[INPUT_DEFS.jogWheel.gate] || props.jogDisabled);

const isPortrait = inject<Ref<boolean>>("isPortrait", ref(false));

// ─── Extra axes (beyond XYZ) ────────────────────────────────
const extraAxes = computed(() =>
  props.axes.map((letter, i) => ({ letter, index: i })).filter(a => EXTRA.has(a.letter))
);
const abcAxes = computed(() => extraAxes.value.filter(a => ABC.has(a.letter)));
const uvwAxes = computed(() => extraAxes.value.filter(a => UVW.has(a.letter)));

const incrementOptions = computed(() => {
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

// ─── XY grid square sizing (aspect-ratio unreliable in flex) ──
const xyWrapRef = ref<HTMLElement>();
const xySize = ref(0);

const ro = new ResizeObserver(entries => {
  if (isPortrait.value) return; // CSS aspect-ratio handles square sizing in portrait
  for (const e of entries) xySize.value = e.contentRect.height;
});
onMounted(() => { if (xyWrapRef.value) ro.observe(xyWrapRef.value); });
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

const xyBtns: JogDef[] = [
  { label: "X-Y+", shortLabel: "",     icon: ArrowUpLeft,    axis: 0, dir: -1, axis2: 1, dir2: 1, dir_class: "" },
  { label: "Y+",   shortLabel: "Y+",   icon: ArrowUp,        axis: 1, dir: 1, dir_class: "jogV" },
  { label: "X+Y+", shortLabel: "",     icon: ArrowUpRight,   axis: 0, dir: 1, axis2: 1, dir2: 1, dir_class: "" },
  { label: "X-",   shortLabel: "X-",   icon: ArrowLeft,      axis: 0, dir: -1, dir_class: "jogH" },
  { label: "Jog Stop", shortLabel: "Stop", icon: Square,      axis: -1, dir: 1, dir_class: "" },
  { label: "X+",   shortLabel: "X+",   icon: ArrowRight,     axis: 0, dir: 1, dir_class: "jogH" },
  { label: "X-Y-", shortLabel: "",     icon: ArrowDownLeft,  axis: 0, dir: -1, axis2: 1, dir2: -1, dir_class: "" },
  { label: "Y-",   shortLabel: "Y-",   icon: ArrowDown,      axis: 1, dir: -1, dir_class: "jogV" },
  { label: "X+Y-", shortLabel: "",     icon: ArrowDownRight, axis: 0, dir: 1, axis2: 1, dir2: -1, dir_class: "" },
];

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
  if (!activeJogKeys.has(btn.label)) return;

  if (props.jogIncrement <= 0) {
    const isDiag = btn.axis2 != null;
    if (isDiag) {
      send({ cmd: "jog_stop_multi", axes: [btn.axis, btn.axis2!] });
    } else {
      send({ cmd: "jog_stop", axis: btn.axis });
    }
  }

  unregisterJog(e.pointerId);
  try { (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId); } catch {}
}

// ─── Generic single-axis jog (Z, A, B, C, U, V, W) ─────────
function startAxisJog(axisIndex: number, dir: 1 | -1, vel: number, e: PointerEvent) {
  const letter = props.axes[axisIndex]!;
  const key = `${letter}${dir > 0 ? "+" : "-"}`;
  if (isDisabled.value || activeJogKeys.has(key)) return;

  const el = e.currentTarget as Element;
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
  if (!activeJogKeys.has(key)) return;

  if (props.jogIncrement <= 0) {
    send({ cmd: "jog_stop", axis: axisIndex });
  }

  unregisterJog(e.pointerId);
  try { (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId); } catch {}
}
</script>

<template>
  <div class="stripSection">
    <div class="sub">Jog</div>
    <div class="jogContent row-sections">
      <div class="jogBtns row-sections">
        <div ref="xyWrapRef" class="xyWrap" :style="xySize ? { width: xySize + 'px' } : undefined">
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
              @contextmenu.prevent
            ><div :class="['jogInner', btn.dir_class]"><component :is="btn.icon" class="jogIcon" /><span v-if="btn.shortLabel" class="jogLabel">{{ btn.shortLabel }}</span></div></MachineBtn>
          </div>
        </div>

        <div class="axisCol">
          <MachineBtn
            type="jog"
            class="jogBtn"
            :active="activeJogKeys.has('Z+')"
            @pointerdown.prevent="startAxisJog(2, 1, jogVel, $event)"
            @pointerup.prevent="stopAxisJog(2, 1, $event)"
            @pointercancel.prevent="stopAxisJog(2, 1, $event)"
            @pointerleave.prevent="stopAxisJog(2, 1, $event)"
            @contextmenu.prevent
          ><div class="jogInner jogZUp"><ArrowUp class="jogIcon" /><span class="jogLabel">Z+</span></div></MachineBtn>
          <MachineBtn
            type="jog"
            class="jogBtn"
            :active="activeJogKeys.has('Z-')"
            @pointerdown.prevent="startAxisJog(2, -1, jogVel, $event)"
            @pointerup.prevent="stopAxisJog(2, -1, $event)"
            @pointercancel.prevent="stopAxisJog(2, -1, $event)"
            @pointerleave.prevent="stopAxisJog(2, -1, $event)"
            @contextmenu.prevent
          ><div class="jogInner jogZDown"><ArrowDown class="jogIcon" /><span class="jogLabel">Z-</span></div></MachineBtn>
        </div>

        <!-- ABC axes (rotary — use angularJogVel) -->
        <template v-if="abcAxes.length > 0">
          <div v-for="ra in abcAxes" :key="ra.letter" class="axisCol">
            <MachineBtn
              type="jog"
              class="jogBtn"
              :active="activeJogKeys.has(ra.letter + '+')"
              @pointerdown.prevent="startAxisJog(ra.index, 1, angularJogVel, $event)"
              @pointerup.prevent="stopAxisJog(ra.index, 1, $event)"
              @pointercancel.prevent="stopAxisJog(ra.index, 1, $event)"
              @pointerleave.prevent="stopAxisJog(ra.index, 1, $event)"
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
              @contextmenu.prevent
            ><div class="jogInner jogZDown"><ArrowDown class="jogIcon" /><span class="jogLabel">{{ ra.letter }}-</span></div></MachineBtn>
          </div>
        </template>

        <!-- UVW axes (secondary linear — use jogVel) -->
        <template v-if="uvwAxes.length > 0">
          <div v-for="ra in uvwAxes" :key="ra.letter" class="axisCol">
            <MachineBtn
              type="jog"
              class="jogBtn"
              :active="activeJogKeys.has(ra.letter + '+')"
              @pointerdown.prevent="startAxisJog(ra.index, 1, jogVel, $event)"
              @pointerup.prevent="stopAxisJog(ra.index, 1, $event)"
              @pointercancel.prevent="stopAxisJog(ra.index, 1, $event)"
              @pointerleave.prevent="stopAxisJog(ra.index, 1, $event)"
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
              @contextmenu.prevent
            ><div class="jogInner jogZDown"><ArrowDown class="jogIcon" /><span class="jogLabel">{{ ra.letter }}-</span></div></MachineBtn>
          </div>
        </template>
      </div>

      <div class="speedGroup row-sections strip-slider-group">
        <div class="speedCol stack-tight">
          <span class="label-muted">{{ abcAxes.length > 0 ? 'Linear' : 'Speed' }}</span>
          <span class="val-mono">{{ (jogVel * 60).toFixed(0) }}</span>
          <MachineSlider gate="jogSpeed" :disabled="isDisabled" :min="minJogVel" :max="maxJogVel" :step="0.1" :modelValue="jogVel" @update:modelValue="(v: number | undefined) => { if (v != null) emit('update:jogVel', v) }" class="vSlider" />
          <MachineBtn type="overrideReset" @click="emit('resetJogVel')">Reset</MachineBtn>
        </div>
        <div v-if="abcAxes.length > 0" class="speedCol stack-tight">
          <span class="label-muted">Rotary</span>
          <span class="val-mono">{{ (angularJogVel * 60).toFixed(0) }}°</span>
          <MachineSlider gate="jogSpeed" :disabled="isDisabled" :min="minAngularJogVel" :max="maxAngularJogVel" :step="0.1" :modelValue="angularJogVel" @update:modelValue="(v: number | undefined) => { if (v != null) emit('update:angularJogVel', v) }" class="vSlider" />
          <MachineBtn type="overrideReset" @click="emit('resetAngularJogVel')">Reset</MachineBtn>
        </div>
      </div>

      <div class="radioGrid row-sections strip-radio-grid">
        <div class="stepCol stack-tight strip-radio-group">
          <span class="label-muted">Step</span>
          <div class="strip-radio-options">
            <label v-for="opt in incrementOptions" :key="opt.value" class="radio-label">
              <MachineRadio gate="jogIncrement" name="jogStep" :value="opt.value" :modelValue="jogIncrement" @update:modelValue="(v: string | number | undefined) => { if (v != null) emit('update:jogIncrement', Number(v)) }" />
              <span>{{ opt.label }}</span>
            </label>
          </div>
        </div>

        <div class="sep modeColSep"></div>

        <div class="modeCol stack-tight strip-radio-group">
          <span class="label-muted">Mode</span>
          <div class="strip-radio-options">
            <label class="radio-label"><MachineRadio gate="modeSelect" name="taskMode" :modelValue="taskMode" :value="TASK_MODE_MANUAL" @update:modelValue="emit('modeChange', TASK_MODE_MANUAL)" /> Manual</label>
            <label class="radio-label"><MachineRadio gate="modeSelect" name="taskMode" :modelValue="taskMode" :value="TASK_MODE_MDI" @update:modelValue="emit('modeChange', TASK_MODE_MDI)" /> MDI</label>
            <label class="radio-label"><MachineRadio gate="modeSelect" name="taskMode" :modelValue="taskMode" :value="TASK_MODE_AUTO" @update:modelValue="emit('modeChange', TASK_MODE_AUTO)" /> Auto</label>
          </div>
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
  flex-shrink: 0;
}
.xyGrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: var(--gap-tight);
  width: 100%;
  height: 100%;
}

.axisCol {
  display: grid;
  grid-template-rows: 1fr 1fr;
  gap: var(--gap-tight);
  height: 100%;
  min-width: 50px;
}
.jogBtn {
  touch-action: none;
  user-select: none;
  aspect-ratio: 1;
}
.axisCol .jogBtn {
  aspect-ratio: auto;
}
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
  font-family: var(--font-mono);
  line-height: 1;
}

/* ── Speed + step columns ── */
.speedCol {
  align-items: center;
  justify-content: center;
}
.vSlider {
  flex: 1;
  min-height: 0;
}

/* ── Mode column separator ── */
.modeColSep {
  align-self: stretch;
  width: 0;
  border-left: 1px solid var(--border-subtle);
}

/* ── Portrait layout ── */
@media (orientation: portrait) {
  .jogContent { flex-direction: column; }

  /* XY grid: full width, square via aspect-ratio */
  .jogBtns  { flex-wrap: wrap; align-self: auto; gap: var(--gap-controls); }
  .xyWrap   { flex: 0 0 100%; width: 100% !important; aspect-ratio: 1; height: auto; }

  /* Z/extra axis cols appear in a row below the XY grid */
  .axisCol  { height: auto; grid-template-rows: 48px 48px; }

  /* Speed sliders: dissolve into speedGroup's shared grid */
  .speedCol { display: contents; }

  /* Hide the vertical divider between step/mode (modeColSep is inside strip-radio-grid) */
  .modeColSep { display: none; }
}
</style>
