<script setup lang="ts">
import { computed, reactive } from "vue";
import { send } from "./lcncWs";
import { usePermissions } from "./permissions";
import JogButton from "./JogButton.vue";

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
}>();

const emit = defineEmits<{
  (e: "update:jogVel", vel: number): void;
  (e: "update:angularJogVel", vel: number): void;
  (e: "update:jogIncrement", val: number): void;
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

const disabled = computed(() => !can.value.jog);

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
  if (disabled.value || !Number.isFinite(props.jogVel) || props.jogVel <= 0) return;

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

function onVelInput(ev: Event) {
  const val = parseFloat((ev.target as HTMLInputElement).value);
  if (Number.isFinite(val)) emit("update:jogVel", val);
}

function onAngularVelInput(ev: Event) {
  const val = parseFloat((ev.target as HTMLInputElement).value);
  if (Number.isFinite(val)) emit("update:angularJogVel", val);
}
</script>

<template>
  <div class="jogHud hud-panel">
    <!-- Increment row -->
    <div class="incRow">
      <button
        v-for="opt in incrementOptions"
        :key="opt.value"
        class="incBtn"
        :class="{ active: jogIncrement === opt.value }"
        :disabled="disabled"
        @click="emit('update:jogIncrement', opt.value)"
      >{{ opt.label }}</button>
    </div>

    <!-- Speed slider(s) -->
    <div class="velRow">
      <input
        type="range"
        class="velSlider"
        :min="minJogVel"
        :max="maxJogVel"
        :step="0.1"
        :value="jogVel"
        :disabled="disabled"
        @input="onVelInput"
      />
      <span class="velLabel">{{ (jogVel * 60).toFixed(0) }} {{ linearUnit }}/min</span>
    </div>
    <div v-if="abcAxes.length > 0" class="velRow">
      <input
        type="range"
        class="velSlider"
        :min="minAngularJogVel"
        :max="maxAngularJogVel"
        :step="0.1"
        :value="angularJogVel"
        :disabled="disabled"
        @input="onAngularVelInput"
      />
      <span class="velLabel">{{ (angularJogVel * 60).toFixed(0) }} °/min</span>
    </div>

    <!-- Wheel + Z column -->
    <div class="padRow">
      <svg class="jogwheel" :class="{ disabled }" viewBox="0 0 200 200">
        <path
          v-for="s in sectors"
          :key="s.id"
          class="sector"
          :class="{ active: activeSectors.has(s.id), disabled }"
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
          :class="{ small: s.axis2 != null }"
        >{{ s.label }}</text>
      </svg>

      <div class="zCol">
        <JogButton :axis="2" :dir="1" label="Z+" :vel="jogVel" :disabled="disabled" direction="up" :jogIncrement="jogIncrement" />
        <JogButton :axis="2" :dir="-1" label="Z-" :vel="jogVel" :disabled="disabled" direction="down" :jogIncrement="jogIncrement" />
      </div>

      <!-- Rotary columns: ABC | UVW -->
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
</template>

<style scoped>
.jogHud {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Increment row */
.incRow {
  display: flex;
  gap: 3px;
}

.incBtn {
  flex: 1;
  padding: 3px 0;
  font-size: var(--fs-xs);
  border-radius: var(--radius-md);
}

.incBtn.active {
  background: color-mix(in oklab, var(--fg) 15%, var(--button-bg));
  font-weight: 600;
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

/* Velocity slider */
.velRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.velSlider {
  flex: 1;
}

.velLabel {
  font-size: var(--fs-xs);
  color: var(--fg);
  opacity: 0.7;
  white-space: nowrap;
  text-align: right;
  font-family: var(--font-mono);
}

/* Wheel + Z layout */
.padRow {
  display: flex;
  gap: 8px;
  align-items: center;
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
  fill: color-mix(in oklab, var(--fg) 10%, var(--button-bg));
}

.sector.active:not(.disabled) {
  fill: color-mix(in oklab, var(--fg) 20%, var(--button-bg));
}

.sector.disabled {
  cursor: not-allowed;
}

.jogwheel.disabled {
  opacity: 0.35;
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
  font-weight: 600;
  fill: var(--fg);
  opacity: 0.6;
  user-select: none;
  pointer-events: none;
}

.sectorLabel {
  text-anchor: middle;
  dominant-baseline: central;
  font-size: var(--fs-base);
  font-weight: 600;
  fill: var(--fg);
  pointer-events: none;
  user-select: none;
}

.sectorLabel.small {
  font-size: var(--fs-2xs);
}

/* Z column */
.zCol {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}

.zCol :deep(button) {
  width: 42px;
  height: 68px;
}

/* Rotary axis columns (beside Z) */
.rotaryCol {
  display: flex;
  flex-direction: column;
  gap: 4px;
  justify-content: center;
}

.rotaryPair {
  display: flex;
  gap: 2px;
}

.rotaryPair :deep(button) {
  width: 36px;
  height: 36px;
}
</style>
