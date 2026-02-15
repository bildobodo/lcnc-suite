<script setup lang="ts">
import { computed } from "vue";
import { send } from "./lcncWs";
import { usePermissions } from "./permissions";

const props = defineProps<{
  jogVel: number;
  linearUnit: string;
  maxJogVel: number;
  jogIncrement: number;
}>();

const emit = defineEmits<{
  (e: "update:jogVel", vel: number): void;
  (e: "update:jogIncrement", val: number): void;
}>();

const can = usePermissions();

const incrementOptions = computed(() => {
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

// ---- Jog axis definitions ----
type Axis = { id: string; axis: number; dir: 1 | -1; label: string };

const xyAxes: Axis[] = [
  { id: "yp", axis: 1, dir: 1, label: "Y+" },
  { id: "xn", axis: 0, dir: -1, label: "X-" },
  { id: "xp", axis: 0, dir: 1, label: "X+" },
  { id: "yn", axis: 1, dir: -1, label: "Y-" },
];

const zAxes: Axis[] = [
  { id: "zp", axis: 2, dir: 1, label: "Z+" },
  { id: "zn", axis: 2, dir: -1, label: "Z-" },
];

// ---- Active tracking ----
const active = new Set<string>();

function startJog(a: Axis, e: PointerEvent) {
  if (disabled.value || !Number.isFinite(props.jogVel) || props.jogVel <= 0) return;
  try { (e.currentTarget as Element)?.setPointerCapture?.(e.pointerId); } catch {}
  if (active.has(a.id)) return;
  active.add(a.id);

  const v = props.jogVel;
  if (props.jogIncrement > 0) {
    send({ cmd: "jog_incr", axis: a.axis, vel: v * a.dir, distance: props.jogIncrement * a.dir });
  } else {
    send({ cmd: "jog_cont", axis: a.axis, vel: v * a.dir });
  }
}

function stopJog(a: Axis, e?: PointerEvent) {
  if (!active.has(a.id)) return;
  active.delete(a.id);
  if (props.jogIncrement <= 0) {
    send({ cmd: "jog_stop", axis: a.axis });
  }
  if (e) {
    try { (e.currentTarget as Element)?.releasePointerCapture?.(e.pointerId); } catch {}
  }
}

function onVelInput(ev: Event) {
  const val = parseFloat((ev.target as HTMLInputElement).value);
  if (Number.isFinite(val)) emit("update:jogVel", val);
}
</script>

<template>
  <div class="jogHud">
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

    <!-- Speed slider -->
    <div class="velRow">
      <input
        type="range"
        class="velSlider"
        :min="0.1"
        :max="maxJogVel"
        :step="0.1"
        :value="jogVel"
        :disabled="disabled"
        @input="onVelInput"
      />
      <span class="velLabel">{{ jogVel.toFixed(1) }}</span>
    </div>

    <!-- Direction pad -->
    <div class="padRow">
      <div class="xyPad">
        <button
          v-for="a in xyAxes"
          :key="a.id"
          class="jogBtn"
          :class="a.id"
          :disabled="disabled"
          @pointerdown.prevent="startJog(a, $event)"
          @pointerup.prevent="stopJog(a, $event)"
          @pointercancel.prevent="stopJog(a, $event)"
          @pointerleave.prevent="stopJog(a, $event)"
        >{{ a.label }}</button>
      </div>

      <div class="zCol">
        <button
          v-for="a in zAxes"
          :key="a.id"
          class="jogBtn zBtn"
          :disabled="disabled"
          @pointerdown.prevent="startJog(a, $event)"
          @pointerup.prevent="stopJog(a, $event)"
          @pointercancel.prevent="stopJog(a, $event)"
          @pointerleave.prevent="stopJog(a, $event)"
        >{{ a.label }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.jogHud {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: color-mix(in oklab, var(--panel) 85%, transparent);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

/* Increment row */
.incRow {
  display: flex;
  gap: 3px;
}

.incBtn {
  flex: 1;
  padding: 3px 0;
  font-size: 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
  transition: background 0.1s;
}

.incBtn:hover:not(:disabled) {
  background: color-mix(in oklab, var(--fg) 10%, var(--button-bg));
}

.incBtn.active {
  background: color-mix(in oklab, var(--fg) 15%, var(--button-bg));
  font-weight: 600;
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

.incBtn:disabled {
  opacity: 0.35;
  cursor: default;
}

/* Velocity slider */
.velRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.velSlider {
  flex: 1;
  height: 14px;
  cursor: pointer;
}

.velLabel {
  font-size: 10px;
  color: var(--fg);
  opacity: 0.7;
  min-width: 32px;
  text-align: right;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
}

/* Direction pad row */
.padRow {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* XY pad — 3x3 grid, center empty */
.xyPad {
  display: grid;
  grid-template-columns: 36px 36px 36px;
  grid-template-rows: 36px 36px 36px;
  gap: 3px;
}

.jogBtn {
  padding: 0;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
  touch-action: none;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s;
}

.jogBtn:hover:not(:disabled) {
  background: color-mix(in oklab, var(--fg) 10%, var(--button-bg));
}

.jogBtn:active:not(:disabled) {
  background: color-mix(in oklab, var(--fg) 20%, var(--button-bg));
}

.jogBtn:disabled {
  opacity: 0.35;
  cursor: default;
}

/* Place XY buttons in the cross pattern */
.yp { grid-column: 2; grid-row: 1; }
.xn { grid-column: 1; grid-row: 2; }
.xp { grid-column: 3; grid-row: 2; }
.yn { grid-column: 2; grid-row: 3; }

/* Z column */
.zCol {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.zBtn {
  width: 36px;
  height: 36px;
}
</style>
