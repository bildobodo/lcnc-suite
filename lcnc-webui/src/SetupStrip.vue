<script setup lang="ts">
import { STEP_DEFAULT } from "./defaults";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineRadio from "./MachineRadio.vue";

const props = defineProps<{
  axes: string[];
  touchoff: number[];
  homedJoints: boolean[];
  isHomed: boolean;
  g5xLabel: string;
}>();

const emit = defineEmits<{
  (e: "update:touchoff", values: number[]): void;
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "homeAxis", joint: number): void;
  (e: "unhomeAxis", joint: number): void;
  (e: "setAxis", axis: number, value: number): void;
  (e: "setAll", values: number[]): void;
  (e: "setG5x", gcode: string): void;
  (e: "goToG30"): void;
  (e: "goToHome"): void;
  (e: "goToZero"): void;
}>();

const g5xOptions = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"];

function updateTouchoff(axis: number, val: number) {
  const copy = [...props.touchoff];
  copy[axis] = val;
  emit("update:touchoff", copy);
}
</script>

<template>
  <div class="stripSection">
    <div class="sub">Setup</div>
    <div class="setupContent">
      <div class="setupGrid">
        <template v-for="(letter, i) in axes" :key="letter">
          <MachineInput gate="touchoff" type="number" :step="STEP_DEFAULT" :value="touchoff[i]" @input="updateTouchoff(i, +($event.target as HTMLInputElement).value)" @keydown.enter="emit('setAxis', i, touchoff[i] ?? 0)" class="setupInput" />
          <MachineBtn type="zero" size="xs" @click="emit('setAxis', i, touchoff[i] ?? 0)">Set {{ letter }}</MachineBtn>
          <MachineBtn :type="homedJoints[i] ? 'unhome' : 'home'" size="xs" @click="homedJoints[i] ? emit('unhomeAxis', i) : emit('homeAxis', i)"><span class="stable-width"><span :class="{ alt: homedJoints[i] }">Home {{ letter }}</span><span :class="{ alt: !homedJoints[i] }">Unhome {{ letter }}</span></span></MachineBtn>
        </template>
        <MachineBtn type="zero" size="xs" class="spanAll" @click="emit('setAll', [...touchoff])">Set All</MachineBtn>
        <MachineBtn :type="isHomed ? 'unhome' : 'home'" size="xs" class="spanAll" @click="isHomed ? emit('unhomeAll') : emit('homeAll')"><span class="stable-width"><span :class="{ alt: isHomed }">Home All</span><span :class="{ alt: !isHomed }">Unhome</span></span></MachineBtn>
        <MachineBtn type="goTo" size="xs" @click="emit('goToG30')">G30</MachineBtn>
        <MachineBtn type="goTo" size="xs" @click="emit('goToHome')">Home Pos</MachineBtn>
        <MachineBtn type="goTo" size="xs" @click="emit('goToZero')">Zero</MachineBtn>
      </div>
      <div class="wcsCol">
        <span class="label-muted">WCS</span>
        <label v-for="g in g5xOptions" :key="g" class="radio-label">
          <MachineRadio gate="touchoff" name="wcs" :value="g" :modelValue="g5xLabel" @update:modelValue="(v: string | number | undefined) => { if (v != null) emit('setG5x', String(v)) }" />
          <span>{{ g }}</span>
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setupContent {
  display: flex;
  gap: var(--gap-section);
}
.setupContent > * {
  flex-shrink: 0;
}
.setupGrid {
  display: grid;
  grid-template-columns: 80px 1fr 1fr;
  gap: var(--gap-tight);
  align-content: start;
}
.setupInput { width: 100%; }
.spanAll { grid-column: 1 / -1; }
.wcsCol {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  justify-content: flex-start;
}
</style>
