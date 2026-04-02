<script setup lang="ts">
import { computed, reactive } from "vue";
import { send } from "./lcncWs";
import { usePermissions } from "./permissions";
import { INPUT_DEFS } from "./machineControls";
import MachineBtn from "./MachineBtn.vue";
import MachineSlider from "./MachineSlider.vue";

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
  isTeleop: boolean;
  isHomed: boolean;
  jogDisabled: boolean;
}>();

const emit = defineEmits<{
  (e: "update:jogVel", v: number): void;
  (e: "update:angularJogVel", v: number): void;
  (e: "update:jogIncrement", v: number): void;
  (e: "toggleTeleop"): void;
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
}>();

const can = usePermissions();
const isDisabled = computed(() => !can.value[INPUT_DEFS.jogWheel.gate] || props.jogDisabled);

const ABC = new Set(["A", "B", "C"]);
const hasAbc = computed(() => props.axes.some(a => ABC.has(a)));

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

// ─── Jog logic (press-and-hold) ─────────────────────────────
interface JogDef {
  label: string;
  axis: number;
  dir: 1 | -1;
  axis2?: number;
  dir2?: 1 | -1;
}

const xyBtns: JogDef[] = [
  { label: "X-Y+", axis: 0, dir: -1, axis2: 1, dir2: 1 },
  { label: "Y+",   axis: 1, dir: 1 },
  { label: "X+Y+", axis: 0, dir: 1, axis2: 1, dir2: 1 },
  { label: "X-",   axis: 0, dir: -1 },
  { label: "XY",   axis: -1, dir: 1 },  // center, no-op
  { label: "X+",   axis: 0, dir: 1 },
  { label: "X-Y-", axis: 0, dir: -1, axis2: 1, dir2: -1 },
  { label: "Y-",   axis: 1, dir: -1 },
  { label: "X+Y-", axis: 0, dir: 1, axis2: 1, dir2: -1 },
];

const active = reactive(new Set<string>());

function startJog(btn: JogDef, e: PointerEvent) {
  if (isDisabled.value || btn.axis < 0) return;
  try { (e.currentTarget as Element)?.setPointerCapture?.(e.pointerId); } catch {}
  if (active.has(btn.label)) return;
  active.add(btn.label);

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
}

function stopJog(btn: JogDef, e: PointerEvent) {
  if (!active.has(btn.label)) return;
  active.delete(btn.label);
  try { (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId); } catch {}

  if (props.jogIncrement > 0) return; // incremental jog stops itself

  const isDiag = btn.axis2 != null;
  if (isDiag) {
    send({ cmd: "jog_stop_multi", axes: [btn.axis, btn.axis2!] });
  } else {
    send({ cmd: "jog_stop", axis: btn.axis });
  }
}

function startZJog(dir: 1 | -1, e: PointerEvent) {
  const key = dir > 0 ? "Z+" : "Z-";
  if (isDisabled.value || active.has(key)) return;
  try { (e.currentTarget as Element)?.setPointerCapture?.(e.pointerId); } catch {}
  active.add(key);
  if (props.jogIncrement > 0) {
    send({ cmd: "jog_incr", axis: 2, vel: props.jogVel * dir, distance: props.jogIncrement * dir });
  } else {
    send({ cmd: "jog_cont", axis: 2, vel: props.jogVel * dir });
  }
}

function stopZJog(dir: 1 | -1, e: PointerEvent) {
  const key = dir > 0 ? "Z+" : "Z-";
  if (!active.has(key)) return;
  active.delete(key);
  try { (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId); } catch {}
  if (props.jogIncrement > 0) return;
  send({ cmd: "jog_stop", axis: 2 });
}
</script>

<template>
  <div class="modeStrip">
    <div class="jogContent">
      <!-- LEFT: XY grid + Z column -->
      <div class="jogBtns">
        <div class="xyGrid">
          <MachineBtn
            v-for="btn in xyBtns"
            :key="btn.label"
            type="jog"
            class="jogBtn"
            :disabled="btn.axis < 0 || undefined"
            :active="active.has(btn.label)"
            @pointerdown.prevent="startJog(btn, $event)"
            @pointerup.prevent="stopJog(btn, $event)"
            @pointercancel.prevent="stopJog(btn, $event)"
            @pointerleave.prevent="stopJog(btn, $event)"
            @contextmenu.prevent
          >{{ btn.label }}</MachineBtn>
        </div>

        <div class="zGrid">
          <MachineBtn
            type="jog"
            class="jogBtn"
            :active="active.has('Z+')"
            @pointerdown.prevent="startZJog(1, $event)"
            @pointerup.prevent="stopZJog(1, $event)"
            @pointercancel.prevent="stopZJog(1, $event)"
            @pointerleave.prevent="stopZJog(1, $event)"
            @contextmenu.prevent
          >Z+</MachineBtn>
          <MachineBtn
            type="jog"
            class="jogBtn"
            :active="active.has('Z-')"
            @pointerdown.prevent="startZJog(-1, $event)"
            @pointerup.prevent="stopZJog(-1, $event)"
            @pointercancel.prevent="stopZJog(-1, $event)"
            @pointerleave.prevent="stopZJog(-1, $event)"
            @contextmenu.prevent
          >Z-</MachineBtn>
        </div>
      </div>

      <!-- RIGHT: Speed, step, mode controls -->
      <div class="jogControls">
        <div class="ctrlRow">
          <span class="ctrlLabel">Mode</span>
          <MachineBtn type="manage" size="xs" :disabled="isDisabled" :active="isTeleop" @click="emit('toggleTeleop')">
            {{ isTeleop ? "World" : "Joint" }}
          </MachineBtn>
        </div>

        <div class="ctrlRow">
          <span class="ctrlLabel">{{ hasAbc ? 'Linear' : 'Speed' }}</span>
          <MachineSlider gate="jogSpeed" :disabled="isDisabled" :min="minJogVel" :max="maxJogVel" :step="0.1" :modelValue="jogVel" @update:modelValue="(v: number | undefined) => { if (v != null) emit('update:jogVel', v) }" class="ctrlSlider" />
          <span class="ctrlVal">{{ (jogVel * 60).toFixed(0) }} {{ linearUnit }}/min</span>
        </div>

        <div class="ctrlRow">
          <span class="ctrlLabel">Step</span>
          <div class="row-tight incrGroup">
            <MachineBtn v-for="opt in incrementOptions" :key="opt.value" type="manage" size="xs" :disabled="isDisabled" mono :selected="jogIncrement === opt.value" @click="emit('update:jogIncrement', opt.value)">{{ opt.label }}</MachineBtn>
          </div>
        </div>
        <span class="stepHint">{{ jogIncrement > 0 ? jogIncrement + ' ' + linearUnit + ' /click' : 'Hold to jog' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modeStrip {
  height: 100%;
  overflow: hidden;
}
.jogContent {
  display: flex;
  gap: var(--gap-section);
  height: 100%;
}

/* ── Left: XY grid + Z ── */
.jogBtns {
  display: flex;
  gap: var(--gap-section);
  flex-shrink: 0;
  align-self: stretch;
}

.xyGrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: var(--gap-tight);
  aspect-ratio: 1;
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
.zGrid .jogBtn {
  aspect-ratio: auto;
}

/* ── Right: controls ── */
.jogControls {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--gap-controls);
  justify-content: center;
  min-width: 0;
}
.ctrlRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
}
.ctrlLabel {
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
  white-space: nowrap;
  min-width: 45px;
}
.ctrlSlider {
  flex: 1;
  min-width: 0;
}
.ctrlVal {
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
  white-space: nowrap;
}
.incrGroup {
  flex-wrap: wrap;
}
.incrGroup :deep(.b) {
  flex: 1;
}
.stepHint {
  font-size: var(--fs-2xs);
  opacity: var(--opacity-muted);
  text-align: right;
}
</style>
