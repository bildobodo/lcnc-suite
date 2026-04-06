<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, type Component } from "vue";
import { send } from "./lcncWs";
import { usePermissions } from "./permissions";
import { INPUT_DEFS } from "./machineControls";
import { registerJog, unregisterJog, activeJogKeys, forceStopAllJogs } from "./useJogPointers";
import MachineBtn from "./MachineBtn.vue";
import MachineRadio from "./MachineRadio.vue";
import MachineSlider from "./MachineSlider.vue";
import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight,
  Square,
} from "lucide-vue-next";

const props = defineProps<{
  axes: string[];
  jogVel: number;
  linearUnit: string;
  maxJogVel: number;
  jogIncrement: number;
  minJogVel: number;
  iniIncrements: number[] | null;
  jogDisabled: boolean;
}>();

const emit = defineEmits<{
  (e: "update:jogVel", v: number): void;
  (e: "update:jogIncrement", v: number): void;
  (e: "resetJogVel"): void;
}>();

const can = usePermissions();
const isDisabled = computed(() => !can.value[INPUT_DEFS.jogWheel.gate] || props.jogDisabled);

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
  for (const e of entries) xySize.value = e.contentRect.height;
});
onMounted(() => { if (xyWrapRef.value) ro.observe(xyWrapRef.value); });
onUnmounted(() => ro.disconnect());

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

function startZJog(dir: 1 | -1, e: PointerEvent) {
  const key = dir > 0 ? "Z+" : "Z-";
  if (isDisabled.value || activeJogKeys.has(key)) return;

  const el = e.currentTarget as Element;
  try { el?.setPointerCapture?.(e.pointerId); } catch {}

  if (props.jogIncrement > 0) {
    send({ cmd: "jog_incr", axis: 2, vel: props.jogVel * dir, distance: props.jogIncrement * dir });
  } else {
    send({ cmd: "jog_cont", axis: 2, vel: props.jogVel * dir });
  }

  const stopFn = props.jogIncrement > 0 ? () => {} : () => send({ cmd: "jog_stop", axis: 2 });
  registerJog(e.pointerId, key, stopFn, el);
}

function stopZJog(dir: 1 | -1, e: PointerEvent) {
  const key = dir > 0 ? "Z+" : "Z-";
  if (!activeJogKeys.has(key)) return;

  if (props.jogIncrement <= 0) {
    send({ cmd: "jog_stop", axis: 2 });
  }

  unregisterJog(e.pointerId);
  try { (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId); } catch {}
}
</script>

<template>
  <div class="stripSection">
    <div class="sub">Jog</div>
    <div class="jogContent">
      <div class="jogBtns">
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

        <div class="zGrid">
          <MachineBtn
            type="jog"
            class="jogBtn"
            :active="activeJogKeys.has('Z+')"
            @pointerdown.prevent="startZJog(1, $event)"
            @pointerup.prevent="stopZJog(1, $event)"
            @pointercancel.prevent="stopZJog(1, $event)"
            @pointerleave.prevent="stopZJog(1, $event)"
            @contextmenu.prevent
          ><div class="jogInner jogZUp"><ArrowUp class="jogIcon" /><span class="jogLabel">Z+</span></div></MachineBtn>
          <MachineBtn
            type="jog"
            class="jogBtn"
            :active="activeJogKeys.has('Z-')"
            @pointerdown.prevent="startZJog(-1, $event)"
            @pointerup.prevent="stopZJog(-1, $event)"
            @pointercancel.prevent="stopZJog(-1, $event)"
            @pointerleave.prevent="stopZJog(-1, $event)"
            @contextmenu.prevent
          ><div class="jogInner jogZDown"><ArrowDown class="jogIcon" /><span class="jogLabel">Z-</span></div></MachineBtn>
        </div>
      </div>

      <div class="speedCol">
        <span class="val-mono">{{ (jogVel * 60).toFixed(0) }}</span>
        <MachineSlider gate="jogSpeed" :disabled="isDisabled" :min="minJogVel" :max="maxJogVel" :step="0.1" :modelValue="jogVel" @update:modelValue="(v: number | undefined) => { if (v != null) emit('update:jogVel', v) }" class="vSlider" />
        <span class="label-muted">Speed</span>
        <MachineBtn type="overrideReset" @click="emit('resetJogVel')">Reset</MachineBtn>
      </div>

      <div class="stepCol">
        <label v-for="opt in incrementOptions" :key="opt.value" class="radio-label">
          <MachineRadio gate="jogIncrement" name="jogStep" :value="opt.value" :modelValue="jogIncrement" @update:modelValue="(v: string | number | undefined) => { if (v != null) emit('update:jogIncrement', Number(v)) }" />
          <span>{{ opt.label }}</span>
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.jogContent {
  display: flex;
  gap: var(--gap-section);
}
.jogContent > * {
  flex-shrink: 0;
}

/* ── Left: XY grid + Z ── */
.jogBtns {
  display: flex;
  gap: var(--gap-section);
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

.zGrid {
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
/* Z+ arrow: icon on top, label below */
.jogInner.jogZUp {
  flex-direction: column;
}
/* Z- arrow: label on top, icon below */
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
.zGrid .jogBtn {
  aspect-ratio: auto;
}

/* ── Vertical columns ��─ */
.speedCol, .stepCol {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
}
.speedCol {
  align-items: center;
  justify-content: center;
}
.vSlider {
  flex: 1;
  min-height: 0;
}
.stepCol {
  justify-content: flex-start;
}
</style>
