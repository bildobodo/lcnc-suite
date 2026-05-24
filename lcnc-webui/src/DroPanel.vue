<script setup lang="ts">
import { computed } from "vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import { STEP_DEFAULT } from "./defaults";
import { fmtCoord } from "./format";

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

// fmt → fmtCoord imported from format.ts

</script>

<template>
  <div class="stack-sections container">
    <div class="stack-controls">
      <div class="sub">Work Position ({{ g5xLabel }})</div>
      <div class="grid">
        <template v-for="(letter, i) in axes" :key="'w' + letter">
          <div class="axis"><span>{{ letter }}</span><b>{{ fmtCoord(workPos[i], letter) }}</b></div>
          <MachineInput gate="touchoff" type="number" :step="STEP_DEFAULT" :value="touchoff[i]" @input="updateTouchoff(i, +($event.target as HTMLInputElement).value)" @keydown.enter="setAxis(i)" style="width: 100%" />
          <MachineBtn type="zero" class="zeroBtn" @click="setAxis(i)">Set {{ letter }}</MachineBtn>
        </template>
        <MachineBtn type="zero" class="homeBtn spanBtn" @click="setAll()" :style="{ gridColumn: 4, gridRow: spanRows }">Set All</MachineBtn>
      </div>
    </div>

    <div class="sep"></div>

    <div class="stack-controls">
      <div class="sub">Machine Position</div>
      <div class="grid">
        <template v-for="(letter, i) in axes" :key="'m' + letter">
          <div class="axis"><span>{{ letter }}</span><b>{{ fmtCoord(machinePos[i], letter) }}</b></div>
          <div></div>
          <MachineBtn :type="homedJoints[i] ? 'unhome' : 'home'" class="zeroBtn" @click="homedJoints[i] ? emit('unhomeAxis', i) : emit('homeAxis', i)"><span class="stable-width"><span :class="{ alt: homedJoints[i] }">Home {{ letter }}</span><span :class="{ alt: !homedJoints[i] }">Unhome {{ letter }}</span></span></MachineBtn>
        </template>
        <MachineBtn :type="homed ? 'unhome' : 'home'" class="homeBtn spanBtn" :style="{ gridColumn: 4, gridRow: spanRows }" @click="homed ? emit('unhomeAll') : emit('homeAll')"><span class="stable-width"><span :class="{ alt: homed }">Home All</span><span :class="{ alt: !homed }">Unhome</span></span></MachineBtn>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
}

.grid {
  display: grid;
  grid-template-columns: 1fr 90px minmax(70px, 110px) minmax(70px, 110px);
  column-gap: var(--gap-controls);
  row-gap: var(--gap-controls);
  align-items: stretch;
}

.axis {
  display: flex;
  align-items: baseline;
  gap: var(--gap-controls);
  font-size: var(--fs-3xl);
  font-variant-numeric: tabular-nums;
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
