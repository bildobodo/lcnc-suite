<script setup lang="ts">
import { computed } from "vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import { STEP_DEFAULT } from "./defaults";

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

const emit = defineEmits<{
  (e: "setAxis", axis: number, value: number): void;
  (e: "setAll", values: number[]): void;
  (e: "update:touchoff", values: number[]): void;
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "homeAxis", joint: number): void;
  (e: "unhomeAxis", joint: number): void;
}>();

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

</script>

<template>
  <div class="stack-sections container">
    <div class="section">
      <div class="sub">Work Position ({{ g5xLabel }})</div>
      <div class="grid">
        <template v-for="(letter, i) in axes" :key="'w' + letter">
          <div class="axis"><span>{{ letter }}</span><b>{{ fmt(workPos[i], letter) }}</b></div>
          <MachineInput gate="touchoff" type="number" :step="STEP_DEFAULT" :value="touchoff[i]" @input="updateTouchoff(i, +($event.target as HTMLInputElement).value)" @keydown.enter="setAxis(i)" />
          <MachineBtn type="zero" class="zeroBtn" @click="setAxis(i)">Set {{ letter }}</MachineBtn>
        </template>
        <MachineBtn type="zero" class="homeBtn spanBtn" @click="setAll()" :style="{ gridColumn: 4, gridRow: spanRows }">Set All</MachineBtn>
      </div>
    </div>

    <div class="sep"></div>

    <div class="section">
      <div class="sub">Machine Position</div>
      <div class="grid">
        <template v-for="(letter, i) in axes" :key="'m' + letter">
          <div class="axis"><span>{{ letter }}</span><b>{{ fmt(machinePos[i], letter) }}</b></div>
          <div></div>
          <MachineBtn :type="homedJoints[i] ? 'unhome' : 'home'" class="zeroBtn" @click="homedJoints[i] ? emit('unhomeAxis', i) : emit('homeAxis', i)">{{ homedJoints[i] ? `Unhome ${letter}` : `Home ${letter}` }}</MachineBtn>
        </template>
        <MachineBtn :type="homed ? 'unhome' : 'home'" class="homeBtn spanBtn" :style="{ gridColumn: 4, gridRow: spanRows }" @click="homed ? emit('unhomeAll') : emit('homeAll')">{{ homed ? 'Unhome' : 'Home All' }}</MachineBtn>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
}

.section {
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 90px minmax(70px, 110px) minmax(70px, 110px);
  column-gap: var(--gap-section);
  row-gap: var(--gap-section);
  align-items: stretch;
}

.axis {
  display: flex;
  align-items: baseline;
  gap: var(--gap-controls);
  font-size: var(--fs-3xl);
}

.axis span {
  font-size: var(--fs-3xl);
  opacity: var(--opacity-muted);
}

.zeroBtn {
  padding: 6px 10px;
  border-radius: var(--radius-lg);
  white-space: nowrap;
}

.homeBtn {
  padding: 10px 14px;
  font-weight: var(--fw-semibold);
  border-radius: var(--radius-xl);
  display: flex;
  align-items: center;
  justify-content: center;
}

</style>
