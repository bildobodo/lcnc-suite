<script setup lang="ts">
import { usePermissions } from "./permissions";

const props = defineProps<{
  workPos: number[];
  machinePos: number[];
  dtg: number[];
  g5xLabel: string;
  homed: boolean;
  homedJoints: boolean[];
}>();

const can = usePermissions();

const emit = defineEmits<{
  (e: "zeroAxis", axis: number): void;
  (e: "zeroAll"): void;
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "homeAxis", joint: number): void;
  (e: "unhomeAxis", joint: number): void;
  (e: "setG5x", gcode: string): void;
}>();

const g5xOptions = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"];

function fmt(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(3) : "-";
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
        <div class="axis"><span>X</span><b>{{ fmt(workPos[0]) }}</b></div>
        <div></div>
        <button class="zeroBtn" @click="emit('zeroAxis', 0)" :disabled="!can.idle">Zero X</button>
        <button class="homeBtn spanBtn" style="grid-column: 4" @click="emit('zeroAll')" :disabled="!can.idle">Zero All</button>
        <div class="axis"><span>Y</span><b>{{ fmt(workPos[1]) }}</b></div>
        <div></div>
        <button class="zeroBtn" @click="emit('zeroAxis', 1)" :disabled="!can.idle">Zero Y</button>
        <div class="axis"><span>Z</span><b>{{ fmt(workPos[2]) }}</b></div>
        <div></div>
        <button class="zeroBtn" @click="emit('zeroAxis', 2)" :disabled="!can.idle">Zero Z</button>
      </div>
    </div>

    <div class="sep"></div>

    <div class="section">
      <div class="sub">Machine Position</div>
      <div class="grid">
        <div class="axis"><span>X</span><b>{{ fmt(machinePos[0]) }}</b></div>
        <div></div>
        <button class="zeroBtn" :disabled="!can.idle" @click="homedJoints[0] ? emit('unhomeAxis', 0) : emit('homeAxis', 0)">{{ homedJoints[0] ? 'Unhome X' : 'Home X' }}</button>
        <button class="homeBtn spanBtn" style="grid-column: 4" :disabled="!can.idle" @click="homed ? emit('unhomeAll') : emit('homeAll')">{{ homed ? 'Unhome' : 'Home All' }}</button>
        <div class="axis"><span>Y</span><b>{{ fmt(machinePos[1]) }}</b></div>
        <div></div>
        <button class="zeroBtn" :disabled="!can.idle" @click="homedJoints[1] ? emit('unhomeAxis', 1) : emit('homeAxis', 1)">{{ homedJoints[1] ? 'Unhome Y' : 'Home Y' }}</button>
        <div class="axis"><span>Z</span><b>{{ fmt(machinePos[2]) }}</b></div>
        <div></div>
        <button class="zeroBtn" :disabled="!can.idle" @click="homedJoints[2] ? emit('unhomeAxis', 2) : emit('homeAxis', 2)">{{ homedJoints[2] ? 'Unhome Z' : 'Home Z' }}</button>
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
  grid-row: 1 / 4;
  align-self: stretch;
}



.axis {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 24px;
}

.axis span {
  font-size: 12px;
  opacity: 0.7;
  width: 14px;
}

.zeroBtn {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 6px;
  white-space: nowrap;
}

.homeBtn {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
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

.g5xBtn {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 6px;
  opacity: 0.6;
}

.g5xBtn.active {
  opacity: 1;
  font-weight: 700;
  border-color: var(--fg);
}

</style>
