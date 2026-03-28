<script setup lang="ts">
import { computed, reactive } from "vue";
import { send } from "./lcncWs";
import { usePermissions } from "./permissions";
import { INPUT_GATES } from "./machineControls";
import JogButton from "./JogButton.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineSlider from "./MachineSlider.vue";

const ABC = new Set(["A", "B", "C"]);
const UVW = new Set(["U", "V", "W"]);
const EXTRA = new Set([...ABC, ...UVW]);

const props = defineProps<{
  axes?: string[];
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
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:jogVel", vel: number): void;
  (e: "update:angularJogVel", vel: number): void;
  (e: "update:jogIncrement", val: number): void;
  (e: "toggleTeleop"): void;
}>();

const extraAxes = computed(() => {
  if (!props.axes) return [];
  return props.axes
    .map((letter, i) => ({ letter, index: i }))
    .filter(a => EXTRA.has(a.letter));
});

const abcAxes = computed(() => extraAxes.value.filter(a => ABC.has(a.letter)));
const uvwAxes = computed(() => extraAxes.value.filter(a => UVW.has(a.letter)));

const can = usePermissions();

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

const jogDisabled = computed(() => !can.value[INPUT_GATES.jogWheel]);

// ---- Wheel geometry (same as JogPanel) ----
const CX = 100, CY = 100, R = 94, r = 34;
const HALF_SPAN = 21; // degrees — 42° sector with 3° gaps

interface Sector {
  id: string;
  axis: number;
  dir: 1 | -1;
  axis2?: number;
  dir2?: 1 | -1;
  label: string;
  path: string;
  labelX: number;
  labelY: number;
}

function arcPath(centerDeg: number): string {
  const a1 = (centerDeg - HALF_SPAN) * Math.PI / 180;
  const a2 = (centerDeg + HALF_SPAN) * Math.PI / 180;
  const ox1 = CX + R * Math.cos(a1), oy1 = CY + R * Math.sin(a1);
  const ox2 = CX + R * Math.cos(a2), oy2 = CY + R * Math.sin(a2);
  const ix2 = CX + r * Math.cos(a2), iy2 = CY + r * Math.sin(a2);
  const ix1 = CX + r * Math.cos(a1), iy1 = CY + r * Math.sin(a1);
  return `M${ox1.toFixed(1)},${oy1.toFixed(1)} A${R},${R} 0 0,1 ${ox2.toFixed(1)},${oy2.toFixed(1)} L${ix2.toFixed(1)},${iy2.toFixed(1)} A${r},${r} 0 0,0 ${ix1.toFixed(1)},${iy1.toFixed(1)} Z`;
}

function labelPos(centerDeg: number): { x: number; y: number } {
  const mid = (R + r) / 2;
  const a = centerDeg * Math.PI / 180;
  return { x: Math.round(CX + mid * Math.cos(a)), y: Math.round(CY + mid * Math.sin(a)) };
}

function spread(deg: number) {
  const lp = labelPos(deg);
  return { path: arcPath(deg), labelX: lp.x, labelY: lp.y };
}

// SVG 0° = right (3 o'clock), clockwise. Screen up = SVG 270°.
const sectors: Sector[] = [
  { id: "xp",   axis: 0, dir:  1,                           label: "X+",   ...spread(0) },
  { id: "xpyn", axis: 0, dir:  1, axis2: 1, dir2: -1,      label: "X+Y-", ...spread(45) },
  { id: "yn",   axis: 1, dir: -1,                           label: "Y-",   ...spread(90) },
  { id: "xnyn", axis: 0, dir: -1, axis2: 1, dir2: -1,      label: "X-Y-", ...spread(135) },
  { id: "xn",   axis: 0, dir: -1,                           label: "X-",   ...spread(180) },
  { id: "xnyp", axis: 0, dir: -1, axis2: 1, dir2:  1,      label: "X-Y+", ...spread(225) },
  { id: "yp",   axis: 1, dir:  1,                           label: "Y+",   ...spread(270) },
  { id: "xpyp", axis: 0, dir:  1, axis2: 1, dir2:  1,      label: "X+Y+", ...spread(315) },
];

// ---- Jog logic (mirrors JogPanel) ----
const activeSectors = reactive(new Set<string>());

function startJog(s: Sector, e: PointerEvent) {
  if (jogDisabled.value || props.disabled || !Number.isFinite(props.jogVel) || props.jogVel <= 0) return;

  try { (e.currentTarget as Element)?.setPointerCapture?.(e.pointerId); } catch {}

  if (activeSectors.has(s.id)) return;
  activeSectors.add(s.id);

  const isDiag = s.axis2 != null && s.dir2 != null;
  const v = isDiag ? props.jogVel * 0.7071 : props.jogVel;

  if (props.jogIncrement > 0) {
    const dist = isDiag ? props.jogIncrement * 0.7071 : props.jogIncrement;
    if (isDiag) {
      send({
        cmd: "jog_incr_multi",
        axes: [
          { axis: s.axis, vel: v * s.dir, distance: dist * s.dir },
          { axis: s.axis2!, vel: v * s.dir2!, distance: dist * s.dir2! },
        ],
      });
    } else {
      send({ cmd: "jog_incr", axis: s.axis, vel: v * s.dir, distance: props.jogIncrement * s.dir });
    }
  } else {
    if (isDiag) {
      send({
        cmd: "jog_cont_multi",
        axes: [
          { axis: s.axis, vel: v * s.dir },
          { axis: s.axis2!, vel: v * s.dir2! },
        ],
      });
    } else {
      send({ cmd: "jog_cont", axis: s.axis, vel: v * s.dir });
    }
  }
}

function stopJog(s: Sector, e?: PointerEvent) {
  if (!activeSectors.has(s.id)) return;
  activeSectors.delete(s.id);

  if (props.jogIncrement <= 0) {
    const isDiag = s.axis2 != null && s.dir2 != null;
    if (isDiag) {
      send({ cmd: "jog_stop_multi", axes: [s.axis, s.axis2!] });
    } else {
      send({ cmd: "jog_stop", axis: s.axis });
    }
  }

  if (e) {
    try { (e.currentTarget as Element)?.releasePointerCapture?.(e.pointerId); } catch {}
  }
}


</script>

<template>
  <div class="jogHud">
    <div class="controlGrid">
      <!-- Mode row -->
      <div class="k">Mode</div>
      <MachineBtn
        type="manage"
        size="xs"
        :disabled="disabled"
        :active="isTeleop"
        @click="emit('toggleTeleop')"
        :title="isTeleop ? 'Switch to Joint mode' : (isHomed ? 'Switch to World mode' : 'Home all axes first')"
      >
        {{ isTeleop ? "World" : "Joint" }}
      </MachineBtn>
      <span v-if="!isHomed" class="modeHint">Home first</span>
      <span v-else></span>

      <!-- Linear speed row -->
      <div class="k">{{ abcAxes.length > 0 ? 'Linear' : 'Speed' }}</div>
      <MachineSlider
        gate="jogSpeed"
        class="inp"
        :disabled="disabled"
        :min="minJogVel"
        :max="maxJogVel"
        :step="0.1"
        :modelValue="jogVel"
        @update:modelValue="(v: number | undefined) => { if (v != null) emit('update:jogVel', v) }"
      />
      <span class="sliderVal">{{ (jogVel * 60).toFixed(0) }} {{ linearUnit }}/min</span>

      <!-- Rotary speed row -->
      <template v-if="abcAxes.length > 0">
        <div class="k">Rotary</div>
        <MachineSlider
          gate="jogSpeed"
          class="inp"
          :disabled="disabled"
          :min="minAngularJogVel"
          :max="maxAngularJogVel"
          :step="0.1"
          :modelValue="angularJogVel"
          @update:modelValue="(v: number | undefined) => { if (v != null) emit('update:angularJogVel', v) }"
        />
        <span class="sliderVal">{{ (angularJogVel * 60).toFixed(0) }} °/min</span>
      </template>

      <!-- Step row -->
      <div class="k">Step</div>
      <div class="row-tight incrGroup">
        <MachineBtn
          v-for="opt in incrementOptions"
          :key="opt.value"
          type="manage"
          size="xs"
          :disabled="disabled"
          mono
          :selected="jogIncrement === opt.value"
          @click="emit('update:jogIncrement', opt.value)"
        >{{ opt.label }}</MachineBtn>
      </div>
      <span class="sliderVal" v-if="jogIncrement > 0">{{ jogIncrement }} {{ linearUnit }} /click</span>
      <span class="sliderVal" v-else>Hold to jog</span>
    </div>

    <!-- Wheel + Z column + extra axes -->
    <div class="jogArea">
      <div class="jogMain">
        <svg class="jogwheel" :class="{ disabled: jogDisabled }" viewBox="0 0 200 200">
          <path
            v-for="s in sectors"
            :key="s.id"
            class="sector"
            :class="{ active: activeSectors.has(s.id), disabled: jogDisabled }"
            :d="s.path"
            @pointerdown.prevent="startJog(s, $event)"
            @pointerup.prevent="stopJog(s, $event)"
            @pointercancel.prevent="stopJog(s, $event)"
            @pointerleave.prevent="stopJog(s, $event)"
            @contextmenu.prevent
          />
          <!-- Center hub -->
          <circle cx="100" cy="100" r="30" class="hub" />
          <text x="100" y="100" class="hubLabel">XY</text>
          <!-- Sector labels -->
          <text
            v-for="s in sectors"
            :key="s.id + '-lbl'"
            :x="s.labelX"
            :y="s.labelY"
            class="sectorLabel"
            :class="{ small: s.axis2 != null, disabled: jogDisabled }"
          >{{ s.label }}</text>
        </svg>

        <div class="zCol">
          <JogButton :axis="2" :dir="1" label="Z+" :vel="jogVel" :disabled="disabled" direction="up" :jogIncrement="jogIncrement" />
          <JogButton :axis="2" :dir="-1" label="Z-" :vel="jogVel" :disabled="disabled" direction="down" :jogIncrement="jogIncrement" />
        </div>
      </div>

      <!-- Rotary columns: ABC | UVW -->
      <div v-if="extraAxes.length > 0" class="extraAxesRow">
        <div v-if="abcAxes.length > 0" class="rotaryCol">
          <div v-for="ra in abcAxes" :key="ra.letter" class="rotaryPair">
            <JogButton :axis="ra.index" :dir="-1" :label="ra.letter + '-'" :vel="angularJogVel" :disabled="disabled" direction="left" :jogIncrement="jogIncrement" />
            <JogButton :axis="ra.index" :dir="1" :label="ra.letter + '+'" :vel="angularJogVel" :disabled="disabled" direction="right" :jogIncrement="jogIncrement" />
          </div>
        </div>
        <div v-if="uvwAxes.length > 0" class="rotaryCol">
          <div v-for="ra in uvwAxes" :key="ra.letter" class="rotaryPair">
            <JogButton :axis="ra.index" :dir="-1" :label="ra.letter + '-'" :vel="jogVel" :disabled="disabled" direction="left" :jogIncrement="jogIncrement" />
            <JogButton :axis="ra.index" :dir="1" :label="ra.letter + '+'" :vel="jogVel" :disabled="disabled" direction="right" :jogIncrement="jogIncrement" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.jogHud {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
}

/* ---- Control grid (label | slider/buttons | readout) ---- */
.controlGrid {
  display: grid;
  grid-template-columns: auto 1fr 80px;
  gap: var(--gap-tight) var(--gap-controls);
  align-items: center;
}

.k {
  font-size: var(--fs-xs);
  opacity: var(--opacity-muted);
  white-space: nowrap;
}

.inp {
  width: 100%;
  min-width: 0;
}

.modeHint {
  font-size: var(--fs-2xs);
  opacity: var(--opacity-muted);
}

/* ---- Increment buttons ---- */
.incrGroup {
}

.incrGroup :deep(.b) {
  flex: 1;
}

/* ---- Wheel + Z layout ---- */
.jogArea {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--gap-controls);
}

.jogMain {
  display: flex;
  align-items: center;
  gap: var(--gap-section);
}

.extraAxesRow {
  display: flex;
  gap: var(--gap-tight);
  justify-content: center;
}

/* Landscape: stack extra axes below wheel+Z */
@media (orientation: landscape) {
  .jogArea { flex-direction: column; }
}

/* Portrait: flat row */
@media (orientation: portrait) {
  .jogArea { flex-direction: row; }
}

.jogwheel {
  width: 170px;
  height: 170px;
  flex-shrink: 0;
  touch-action: none;
}

.sector {
  fill: var(--button-bg);
  stroke: var(--border);
  stroke-width: 1.5;
  stroke-linejoin: round;
  cursor: pointer;
  transition: fill 0.12s, opacity 0.15s;
}

.sector:hover:not(.disabled) {
  fill: var(--hl-hover);
}

.sector.active:not(.disabled) {
  fill: var(--hl-active);
}

.sector.disabled {
  cursor: not-allowed;
}

.jogwheel.disabled {
  opacity: var(--opacity-disabled);
}

.hub {
  fill: var(--panel);
  stroke: var(--border);
  stroke-width: 1.5;
  pointer-events: none;
}

.hubLabel {
  text-anchor: middle;
  dominant-baseline: central;
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  fill: var(--fg);
  opacity: var(--opacity-muted);
  user-select: none;
  pointer-events: none;
}

.sectorLabel {
  text-anchor: middle;
  dominant-baseline: central;
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  fill: var(--fg);
  pointer-events: none;
  user-select: none;
}

.sectorLabel.small {
  font-size: var(--fs-2xs);
}

.sectorLabel.disabled {
  opacity: var(--opacity-disabled);
}

/* Z column */
.zCol {
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  align-items: center;
}

.zCol :deep(button) {
  width: 68px;
  height: 68px;
}

/* Rotary axis columns (beside Z) */
.rotaryCol {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  justify-content: center;
}

.rotaryPair {
  display: flex;
  gap: 0;
}

.rotaryPair :deep(button) {
  width: 42px;
  height: 42px;
}
</style>
