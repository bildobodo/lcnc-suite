<script setup lang="ts">
import { computed, inject, ref, watch, onMounted, onUnmounted, type Ref, type Component } from "vue";
import { send } from "./lcncWs";
import { usePermissions } from "./permissions";
import { INPUT_DEFS } from "./machineControls";
import { registerJog, unregisterJog, activeJogKeys, forceStopAllJogs, forceStopJog, jogKeyFor } from "./useJogPointers";
import { useAxes } from "./useAxes";
import MachineBtn from "./MachineBtn.vue";
import MachineRadio from "./MachineRadio.vue";
import MachineSlider from "./MachineSlider.vue";
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

// ─── Axis groups from the shared source (WS-D) ─────────────
// X/Y/Z indices are resolved BY LETTER: the old code hardcoded X=0/Y=1 in
// the pad and Z=2 in the Z column, which jogs the wrong joint on any
// machine whose axes aren't XYZ-first (e.g. lathe ["X","Z"]).
const { abc: abcAxes, uvw: uvwAxes, find: findAxis } = useAxes(computed(() => props.axes));
const xAxis = computed(() => findAxis("X"));
const yAxis = computed(() => findAxis("Y"));
const zAxis = computed(() => findAxis("Z"));
const hasXyPad = computed(() => xAxis.value != null && yAxis.value != null);

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
      <div class="jogBtns row-sections">
        <div v-if="hasXyPad" ref="xyWrapRef" class="xyWrap" :style="xySize ? { width: xySize + 'px' } : undefined">
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
          <span class="val-mono val-slot">{{ (jogVel * 60).toFixed(0) }}</span>
          <MachineSlider gate="jogSpeed" :disabled="isDisabled" :min="minJogVel" :max="maxJogVel" :step="0.1" :modelValue="jogVel" @update:modelValue="(v: number | undefined) => { if (v != null) emit('update:jogVel', v) }" class="vSlider" />
          <MachineBtn type="jogSpeedReset" :disabled="isDisabled" @click="emit('resetJogVel')">Reset</MachineBtn>
        </div>
        <div v-if="abcAxes.length > 0" class="speedCol stack-controls">
          <span class="label-muted">Rotary</span>
          <span class="val-mono val-slot">{{ (angularJogVel * 60).toFixed(0) }}°</span>
          <MachineSlider gate="jogSpeed" :disabled="isDisabled" :min="minAngularJogVel" :max="maxAngularJogVel" :step="0.1" :modelValue="angularJogVel" @update:modelValue="(v: number | undefined) => { if (v != null) emit('update:angularJogVel', v) }" class="vSlider" />
          <MachineBtn type="jogSpeedReset" :disabled="isDisabled" @click="emit('resetAngularJogVel')">Reset</MachineBtn>
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
.jogBtn {
  touch-action: none;
  user-select: none;
  aspect-ratio: 1;
}
.axisCol .jogBtn {
  aspect-ratio: auto;
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
/* Jog speed ticks while dragging the slider — fixed slot ("10000" = 5ch,
   rotary adds °) keeps the readout from re-centering per digit change. */
.speedCol .val-slot { --slot-w: 5.5ch; }
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

  /* Axis area below the pad: 4 equal columns — Z leftmost at the same
     width as the others, ABC / UVW pairs fill columns 2-4 (one band row
     per cluster; clusters dissolve via display:contents). Full width
     used, no ragged leftover. */
  .jogBtns  { display: grid; grid-template-columns: repeat(4, 1fr); }
  .xyWrap   { grid-column: 1 / -1; }
  .axisCluster { display: contents; }
  .axisCol  { height: auto; grid-template-rows: 48px 48px; min-width: 0; }
  /* Both ABC and UVW present → Z spans both band rows (Z+ / Z- each get
     a full band, single-column width) */
  .zCol.zTall { grid-column: 1; grid-row: 2 / span 2; grid-template-rows: 1fr 1fr; }
  /* No extra axes at all → Z pair spans the full width */
  .zCol.zOnly { grid-column: 1 / -1; }

  /* Speed sliders: dissolve into speedGroup's shared grid */
  .speedCol { display: contents; }

  /* Hide the vertical divider between step/mode (modeColSep is inside strip-radio-grid) */
  .modeColSep { display: none; }
}
</style>
