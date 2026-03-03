<script setup lang="ts">
import { computed } from "vue";
import { usePermissions } from "./permissions";

const ROTARY = new Set(["A", "B", "C"]);

const props = defineProps<{
  axes: string[];
  workPos: number[];
  machinePos: number[];
  dtg: number[];
  g5xLabel: string;
  linearUnit: string;
  homed: boolean;
  homedJoints: boolean[];
  touchoff: number[];
}>();

const can = usePermissions();

const emit = defineEmits<{
  (e: "setAxis", axis: number, value: number): void;
  (e: "setAll", values: number[]): void;
  (e: "update:touchoff", values: number[]): void;
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "homeAxis", joint: number): void;
  (e: "unhomeAxis", joint: number): void;
  (e: "setG5x", gcode: string): void;
}>();

const g5xOptions = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"];

// Dynamic grid-row span for the "Set All" / "Home All" button
const spanRows = computed(() => `1 / ${props.axes.length + 1}`);

function updateTouchoff(axis: number, val: number) {
  const copy = [...props.touchoff];
  copy[axis] = val;
  emit("update:touchoff", copy);
}

function setAxis(axis: number) {
  emit("setAxis", axis, props.touchoff[axis] ?? 0);
}

function setAll() {
  emit("setAll", [...props.touchoff]);
}

function fmt(n: any, letter?: string) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "-";
  if (letter && ROTARY.has(letter)) return x.toFixed(2) + "°";
  return x.toFixed(3);
}

function touchoffStep(letter: string) {
  return ROTARY.has(letter) ? "0.01" : "0.001";
}
</script>

<template>
  <div class="container">
    <div class="g5xRow">
      <button
        v-for="g in g5xOptions"
        :key="g"
        class="g5xBtn"
        :class="{ active: g === g5xLabel }"
        :disabled="!can.idle"
        @click="emit('setG5x', g)"
      >{{ g }}</button>
    </div>

    <div class="section">
      <div class="sub">Work Position ({{ g5xLabel }})</div>
      <div class="grid">
        <template v-for="(letter, i) in axes" :key="'w' + letter">
          <div class="axis"><span>{{ letter }}</span><b>{{ fmt(workPos[i], letter) }}</b></div>
          <input type="number" :step="touchoffStep(letter)" :value="touchoff[i]" @input="updateTouchoff(i, +($event.target as HTMLInputElement).value)" :disabled="!can.zero" @keydown.enter="setAxis(i)" />
          <button class="zeroBtn" @click="setAxis(i)" :disabled="!can.zero">Set {{ letter }}</button>
        </template>
        <button class="homeBtn spanBtn" :style="{ gridColumn: 4, gridRow: spanRows }" @click="setAll()" :disabled="!can.zero">Set All</button>
      </div>
    </div>

    <div class="sep"></div>

    <div class="section">
      <div class="sub">Machine Position</div>
      <div class="grid">
        <template v-for="(letter, i) in axes" :key="'m' + letter">
          <div class="axis"><span>{{ letter }}</span><b>{{ fmt(machinePos[i], letter) }}</b></div>
          <div></div>
          <button class="zeroBtn" :disabled="!can.idle" @click="homedJoints[i] ? emit('unhomeAxis', i) : emit('homeAxis', i)">{{ homedJoints[i] ? `Unhome ${letter}` : `Home ${letter}` }}</button>
        </template>
        <button class="homeBtn spanBtn" :style="{ gridColumn: 4, gridRow: spanRows }" :disabled="!can.idle" @click="homed ? emit('unhomeAll') : emit('homeAll')">{{ homed ? 'Unhome' : 'Home All' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.grid {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) auto minmax(70px, 110px) minmax(70px, 110px);
  column-gap: 12px;
  row-gap: 12px;
  align-items: center;
}

.spanBtn {
  align-self: stretch;
}

.axis {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 24px;
}

.axis span {
  font-size: var(--fs-base);
  opacity: 0.7;
  width: 14px;
}

.zeroBtn {
  padding: 6px 10px;
  font-size: var(--fs-base);
  border-radius: var(--radius-lg);
  white-space: nowrap;
}

.homeBtn {
  padding: 10px 14px;
  font-size: var(--fs-md);
  font-weight: 600;
  border-radius: var(--radius-xl);
  display: flex;
  align-items: center;
  justify-content: center;
}

.g5xRow {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}
</style>
