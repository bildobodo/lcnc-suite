<script setup lang="ts">
import { computed, reactive } from "vue";
import { send } from "./lcncWs";
import JogButton from "./JogButton.vue";

import { usePermissions } from "./permissions";

const props = defineProps<{
  jogVel: number;
  isTeleop: boolean;
  isHomed: boolean;
  linearUnit: string;
  maxJogVel: number;
  activeJogKeys?: Set<string>;
  jogIncrement: number;
}>();

const can = usePermissions();

const emit = defineEmits<{
  (e: "update:jogVel", vel: number): void;
  (e: "update:jogIncrement", val: number): void;
  (e: "toggleTeleop"): void;
}>();

const incrementOptions = computed(() => {
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
        class="modePill"
        :class="isTeleop ? 'teleop' : 'joint'"
        :disabled="!can.jog"
        @click="emit('toggleTeleop')"
        :title="isTeleop ? 'Switch to Joint mode' : (isHomed ? 'Switch to World mode' : 'Home all axes first')"
      >
        {{ isTeleop ? "World" : "Joint" }}
      </button>
      <span class="modeHint" v-if="!isHomed">Home to enable World mode</span>
    </div>

    <div class="btnrow" style="margin-bottom: 10px">
      <div class="k" style="min-width: 90px">Speed</div>

      <input
        class="inp"
        type="range"
        min="0.1"
        :max="maxJogVel"
        step="0.1"
        :value="jogVel"
        @input="onInput"
        :disabled="!can.jog"
      />
      <div class="pill">{{ (jogVel * 60).toFixed(0) }} {{ linearUnit }}/min</div>
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
      <div class="pill" v-if="jogIncrement > 0">{{ jogIncrement }} {{ linearUnit }}/click</div>
      <div class="pill" v-else>Hold to jog</div>
    </div>

    <div class="jogArea">
      <!-- XY wheel -->
      <svg class="jogwheel" viewBox="0 0 200 200">
        <path
          v-for="s in sectors"
          :key="s.id"
          class="sector"
          :class="{ active: isSectorActive(s.id), disabled: !canJog }"
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
    </div>

    <div class="hint">
      {{ jogIncrement > 0 ? 'Click to jog one step.' : 'Press and hold to jog.' }} {{ isTeleop ? 'World mode: coordinated Cartesian movement.' : 'Joint mode: individual axis control.' }}
    </div>
  </div>
</template>

<style scoped>
.sub {
  font-size: 12px;
  opacity: 0.65;
  margin-bottom: 8px;
}

.btnrow {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.k {
  font-size: 12px;
  opacity: 0.7;
}

.pill {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid var(--border);
  user-select: none;
  background: color-mix(in oklab, var(--panel) 80%, transparent);
  color: var(--fg);
}

.inp {
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #0002;
}

.hint {
  margin-top: 10px;
  font-size: 12px;
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
  fill: color-mix(in oklab, var(--fg) 10%, var(--button-bg));
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
  font-size: 13px;
  font-weight: 600;
  fill: var(--fg);
  opacity: 0.6;
  user-select: none;
  pointer-events: none;
}

.sectorLabel {
  text-anchor: middle;
  dominant-baseline: central;
  font-size: 12px;
  font-weight: 650;
  fill: var(--fg);
  pointer-events: none;
  user-select: none;
}

.sectorLabel.small {
  font-size: 9px;
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

/* ---- Mode row ---- */
.modeRow {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 10px;
}

.modePill {
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--fg);
}

.modePill.teleop {
  background: color-mix(in oklab, #0a7a0a 15%, var(--panel));
  border-color: #0a7a0a40;
}

.modePill.joint {
  background: color-mix(in oklab, var(--panel) 80%, transparent);
}

.modePill:hover:not(:disabled) {
  opacity: 0.8;
}

.modePill:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.modeHint {
  font-size: 11px;
  opacity: 0.5;
}

/* ---- Increment buttons ---- */
.incrGroup {
  display: flex;
  gap: 4px;
}

.incrBtn {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  font-size: 11px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  cursor: pointer;
  transition: all 0.12s;
  user-select: none;
}

.incrBtn.active {
  background: color-mix(in oklab, var(--fg) 15%, var(--button-bg));
  font-weight: 700;
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

.incrBtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
