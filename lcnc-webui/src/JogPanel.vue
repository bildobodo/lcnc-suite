<script setup lang="ts">
import { computed, reactive } from "vue";
import { send } from "./lcncWs";
import JogButton from "./JogButton.vue";

import { usePermissions } from "./permissions";

const ABC = new Set(["A", "B", "C"]);
const UVW = new Set(["U", "V", "W"]);
const EXTRA = new Set([...ABC, ...UVW]);
const AXIS_LETTERS = "XYZABCUVW";

const props = defineProps<{
  axes?: string[];
  jogVel: number;
  angularJogVel: number;
  isTeleop: boolean;
  isHomed: boolean;
  linearUnit: string;
  maxJogVel: number;
  maxAngularJogVel: number;
  minAngularJogVel: number;
  activeJogKeys?: Set<string>;
  jogIncrement: number;
  minJogVel: number;
  iniIncrements: number[] | null;
}>();

const extraAxes = computed(() => {
  if (!props.axes) return [];
  return props.axes
    .map((letter, i) => ({ letter, index: i }))
    .filter(a => EXTRA.has(a.letter));
});

const abcAxes = computed(() => extraAxes.value.filter(a => ABC.has(a.letter)));
const uvwAxes = computed(() => extraAxes.value.filter(a => UVW.has(a.letter)));

// Keyboard key pairs for rotary axes: [ ] for first, ; ' for second
const ROTARY_KEY_PAIRS: [string, string][] = [["[", "]"], [";", "'"]];
const rotaryKeyMap = computed(() => {
  const map: Record<number, { neg: string; pos: string }> = {};
  const ra = extraAxes.value;
  for (let r = 0; r < Math.min(ra.length, ROTARY_KEY_PAIRS.length); r++) {
    map[ra[r].index] = { neg: ROTARY_KEY_PAIRS[r][0], pos: ROTARY_KEY_PAIRS[r][1] };
  }
  return map;
});

const can = usePermissions();

const emit = defineEmits<{
  (e: "update:jogVel", vel: number): void;
  (e: "update:angularJogVel", vel: number): void;
  (e: "update:jogIncrement", val: number): void;
  (e: "toggleTeleop"): void;
}>();

function onAngularInput(ev: Event) {
  const val = parseFloat((ev.target as HTMLInputElement).value);
  if (Number.isFinite(val)) emit("update:angularJogVel", val);
}

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
      { label: "0.0001", value: 0.0001 },
      { label: "0.001", value: 0.001 },
      { label: "0.01", value: 0.01 },
      { label: "0.1", value: 0.1 },
    ];
  }
  return [
    { label: "Cont", value: 0 },
    { label: "0.001", value: 0.001 },
    { label: "0.01", value: 0.01 },
    { label: "0.1", value: 0.1 },
    { label: "1.0", value: 1.0 },
  ];
});

function onInput(ev: Event) {
  const val = parseFloat((ev.target as HTMLInputElement).value);
  if (Number.isFinite(val)) emit("update:jogVel", val);
}

// ---- Wheel geometry ----
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

function spread(deg: number) {
  const lp = labelPos(deg);
  return { path: arcPath(deg), labelX: lp.x, labelY: lp.y };
}

// ---- Jog logic (mirrors JogButton.vue) ----
const activeSectors = reactive(new Set<string>());

// Map keyboard keys to wheel sector IDs
const KEY_SECTOR_MAP: Record<string, string> = {
  ArrowRight: "xp",
  ArrowLeft:  "xn",
  ArrowUp:    "yp",
  ArrowDown:  "yn",
};

function isSectorActive(id: string): boolean {
  if (activeSectors.has(id)) return true;
  if (!props.activeJogKeys) return false;
  for (const [key, sectorId] of Object.entries(KEY_SECTOR_MAP)) {
    if (sectorId === id && props.activeJogKeys.has(key)) return true;
  }
  return false;
}

function startJog(s: Sector, e: PointerEvent) {
  if (!can.value.jog || !Number.isFinite(props.jogVel) || props.jogVel <= 0) return;

  try { (e.currentTarget as Element)?.setPointerCapture?.(e.pointerId); } catch {}

  if (activeSectors.has(s.id)) return;
  activeSectors.add(s.id);

  const isDiag = s.axis2 != null && s.dir2 != null;
  const v = isDiag ? props.jogVel * 0.7071 : props.jogVel;

  if (props.jogIncrement > 0) {
    // Incremental jog
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
    // Continuous jog
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
    // Only send stop for continuous mode
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
  <div>
    <div class="sub">Jogging</div>

    <div class="modeRow">
      <button
        class="modeBtn"
        :class="isTeleop ? 'teleop' : ''"
        :disabled="!can.jog"
        @click="emit('toggleTeleop')"
        :title="isTeleop ? 'Switch to Joint mode' : (isHomed ? 'Switch to World mode' : 'Home all axes first')"
      >
        {{ isTeleop ? "World" : "Joint" }}
      </button>
      <span class="modeHint" v-if="!isHomed">Home to enable World mode</span>
    </div>

    <div class="btnrow" style="margin-bottom: 10px">
      <div class="k" style="min-width: 90px">{{ abcAxes.length > 0 ? 'Linear' : 'Speed' }}</div>

      <input
        class="inp"
        type="range"
        :min="minJogVel"
        :max="maxJogVel"
        step="0.1"
        :value="jogVel"
        @input="onInput"
        :disabled="!can.jog"
      />
      <div class="pill">{{ (jogVel * 60).toFixed(0) }} {{ linearUnit }}/min</div>
    </div>

    <div v-if="abcAxes.length > 0" class="btnrow" style="margin-bottom: 10px">
      <div class="k" style="min-width: 90px">Rotary</div>
      <input
        class="inp"
        type="range"
        :min="minAngularJogVel"
        :max="maxAngularJogVel"
        step="0.1"
        :value="angularJogVel"
        @input="onAngularInput"
        :disabled="!can.jog"
      />
      <div class="pill">{{ (angularJogVel * 60).toFixed(0) }} °/min</div>
    </div>

    <div class="btnrow" style="margin-bottom: 10px; justify-content: center">
      <div class="k" style="min-width: 90px">Step</div>
      <div class="incrGroup">
        <button
          v-for="opt in incrementOptions"
          :key="opt.value"
          class="incrBtn"
          :class="{ active: jogIncrement === opt.value }"
          @click="emit('update:jogIncrement', opt.value)"
          :disabled="!can.jog"
        >{{ opt.label }}</button>
      </div>
      <div class="pill" v-if="jogIncrement > 0">{{ jogIncrement }} {{ linearUnit }}{{ abcAxes.length > 0 ? ' · °' : '' }} /click</div>
      <div class="pill" v-else>Hold to jog</div>
    </div>

    <div class="jogArea">
      <!-- XY wheel -->
      <svg class="jogwheel" viewBox="0 0 200 200">
        <path
          v-for="s in sectors"
          :key="s.id"
          class="sector"
          :class="{ active: isSectorActive(s.id), disabled: !can.jog }"
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

      <!-- Z column -->
      <div class="zcol">
        <JogButton :axis="2" :dir="1" label="Z+" :vel="jogVel" :disabled="!can.jog" direction="up" :active="activeJogKeys?.has('PageUp')" :jogIncrement="jogIncrement" />
        <JogButton :axis="2" :dir="-1" label="Z-" :vel="jogVel" :disabled="!can.jog" direction="down" :active="activeJogKeys?.has('PageDown')" :jogIncrement="jogIncrement" />
      </div>

      <!-- Rotary columns: ABC | UVW -->
      <div v-if="abcAxes.length > 0" class="rotaryCol">
        <div v-for="ra in abcAxes" :key="ra.letter" class="rotaryPair">
          <JogButton :axis="ra.index" :dir="-1" :label="ra.letter + '-'" :vel="angularJogVel" :disabled="!can.jog" direction="left" :jogIncrement="jogIncrement" :active="activeJogKeys?.has(rotaryKeyMap[ra.index]?.neg)" />
          <JogButton :axis="ra.index" :dir="1" :label="ra.letter + '+'" :vel="angularJogVel" :disabled="!can.jog" direction="right" :jogIncrement="jogIncrement" :active="activeJogKeys?.has(rotaryKeyMap[ra.index]?.pos)" />
        </div>
      </div>
      <div v-if="uvwAxes.length > 0" class="rotaryCol">
        <div v-for="ra in uvwAxes" :key="ra.letter" class="rotaryPair">
          <JogButton :axis="ra.index" :dir="-1" :label="ra.letter + '-'" :vel="jogVel" :disabled="!can.jog" direction="left" :jogIncrement="jogIncrement" :active="activeJogKeys?.has(rotaryKeyMap[ra.index]?.neg)" />
          <JogButton :axis="ra.index" :dir="1" :label="ra.letter + '+'" :vel="jogVel" :disabled="!can.jog" direction="right" :jogIncrement="jogIncrement" :active="activeJogKeys?.has(rotaryKeyMap[ra.index]?.pos)" />
        </div>
      </div>
    </div>

    <div class="hint">
      {{ jogIncrement > 0 ? 'Click to jog one step.' : 'Press and hold to jog.' }} {{ isTeleop ? 'World mode: coordinated Cartesian movement.' : 'Joint mode: individual axis control.' }}
      <template v-if="extraAxes.length > 0"><br/>Keys: Arrows XY, PgUp/Dn Z<template v-for="(ra, r) in extraAxes" :key="ra.letter"><template v-if="r < ROTARY_KEY_PAIRS.length">, {{ ROTARY_KEY_PAIRS[r][0] }}/{{ ROTARY_KEY_PAIRS[r][1] }} {{ ra.letter }}</template></template></template>
    </div>
  </div>
</template>

<style scoped>
.btnrow {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.k {
  font-size: var(--fs-base);
  opacity: 0.7;
}

.pill {
  padding: 6px 10px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-base);
  border: 1px solid var(--border);
  user-select: none;
  background: color-mix(in oklab, var(--panel) 80%, transparent);
  color: var(--fg);
}

.inp {
  flex: 1;
  min-width: 0;
}

.hint {
  margin-top: 10px;
  font-size: var(--fs-base);
  opacity: 0.65;
  text-align: center;
}

/* ---- Wheel layout ---- */
.jogArea {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.jogwheel {
  width: 200px;
  height: 200px;
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
  fill: color-mix(in oklab, var(--fg) 12%, var(--button-bg));
}

.sector.active:not(.disabled) {
  fill: color-mix(in oklab, var(--fg) 20%, var(--button-bg));
}

.sector.disabled {
  opacity: 0.4;
  cursor: not-allowed;
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
  font-size: var(--fs-md);
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

/* ---- Z column ---- */
.zcol {
  display: flex;
  flex-direction: column;
  gap: 20px;
  align-items: center;
}

.zcol :deep(button) {
  width: 80px;
  height: 80px;
}

/* ---- Rotary axis columns (beside Z) ---- */
.rotaryCol {
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: center;
}

.rotaryPair {
  display: flex;
  gap: 4px;
}

.rotaryPair :deep(button) {
  width: 50px;
  height: 50px;
}

/* ---- Mode row ---- */
.modeRow {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 10px;
}

.modeBtn {
  font-size: var(--fs-base);
  font-weight: 600;
}

.modeBtn.teleop:not(:disabled) {
  background: color-mix(in oklab, var(--ok) 15%, var(--button-bg));
  border-color: color-mix(in srgb, var(--ok) 25%, transparent);
}

.modeHint {
  font-size: var(--fs-sm);
  opacity: 0.5;
}

/* ---- Increment buttons ---- */
.incrGroup {
  display: flex;
  gap: 4px;
}

.incrBtn {
  padding: 6px 10px;
  border-radius: var(--radius-xl);
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
  user-select: none;
}

.incrBtn.active {
  background: color-mix(in oklab, var(--fg) 15%, var(--button-bg));
  font-weight: 700;
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

</style>
