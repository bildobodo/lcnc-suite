<script setup lang="ts">
import { computed } from "vue";
import { STEP_DEFAULT } from "./defaults";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineRadio from "./MachineRadio.vue";

const UVW = new Set(["U", "V", "W"]);

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

const primaryAxes = computed(() =>
  props.axes.map((l, i) => ({ letter: l, index: i })).filter(a => !UVW.has(a.letter))
);
const uvwAxes = computed(() =>
  props.axes.map((l, i) => ({ letter: l, index: i })).filter(a => UVW.has(a.letter))
);
const hasSecondCol = computed(() => uvwAxes.value.length > 0);

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
    <div class="setupContent row-sections">
      <!-- Column 1: primary axes (XYZABC) + actions when no second column -->
      <div class="setupGrid">
        <template v-for="a in primaryAxes" :key="a.letter">
          <MachineInput gate="touchoff" type="number" :step="STEP_DEFAULT" :value="touchoff[a.index]" @input="updateTouchoff(a.index, +($event.target as HTMLInputElement).value)" @keydown.enter="emit('setAxis', a.index, touchoff[a.index] ?? 0)" class="setupInput" />
          <MachineBtn type="zero" @click="emit('setAxis', a.index, touchoff[a.index] ?? 0)">Set {{ a.letter }}</MachineBtn>
          <MachineBtn :type="homedJoints[a.index] ? 'unhome' : 'home'" @click="homedJoints[a.index] ? emit('unhomeAxis', a.index) : emit('homeAxis', a.index)"><span class="stable-width"><span :class="{ alt: homedJoints[a.index] }">Home {{ a.letter }}</span><span :class="{ alt: !homedJoints[a.index] }">Unhome {{ a.letter }}</span></span></MachineBtn>
        </template>
        <template v-if="!hasSecondCol">
          <MachineBtn type="zero" class="spanAll" @click="emit('setAll', [...touchoff])">Set All</MachineBtn>
          <MachineBtn :type="isHomed ? 'unhome' : 'home'" class="spanAll" @click="isHomed ? emit('unhomeAll') : emit('homeAll')"><span class="stable-width"><span :class="{ alt: isHomed }">Home All</span><span :class="{ alt: !isHomed }">Unhome</span></span></MachineBtn>
          <MachineBtn type="goTo" @click="emit('goToG30')">G30</MachineBtn>
          <MachineBtn type="goTo" @click="emit('goToHome')">Home Pos</MachineBtn>
          <MachineBtn type="goTo" @click="emit('goToZero')">Zero</MachineBtn>
        </template>
      </div>

      <!-- Column 2: UVW axes + actions (only when UVW axes exist) -->
      <div v-if="hasSecondCol" class="setupGrid">
        <template v-for="a in uvwAxes" :key="a.letter">
          <MachineInput gate="touchoff" type="number" :step="STEP_DEFAULT" :value="touchoff[a.index]" @input="updateTouchoff(a.index, +($event.target as HTMLInputElement).value)" @keydown.enter="emit('setAxis', a.index, touchoff[a.index] ?? 0)" class="setupInput" />
          <MachineBtn type="zero" @click="emit('setAxis', a.index, touchoff[a.index] ?? 0)">Set {{ a.letter }}</MachineBtn>
          <MachineBtn :type="homedJoints[a.index] ? 'unhome' : 'home'" @click="homedJoints[a.index] ? emit('unhomeAxis', a.index) : emit('homeAxis', a.index)"><span class="stable-width"><span :class="{ alt: homedJoints[a.index] }">Home {{ a.letter }}</span><span :class="{ alt: !homedJoints[a.index] }">Unhome {{ a.letter }}</span></span></MachineBtn>
        </template>
        <MachineBtn type="zero" class="spanAll" @click="emit('setAll', [...touchoff])">Set All</MachineBtn>
        <MachineBtn :type="isHomed ? 'unhome' : 'home'" class="spanAll" @click="isHomed ? emit('unhomeAll') : emit('homeAll')"><span class="stable-width"><span :class="{ alt: isHomed }">Home All</span><span :class="{ alt: !isHomed }">Unhome</span></span></MachineBtn>
        <MachineBtn type="goTo" @click="emit('goToG30')">G30</MachineBtn>
        <MachineBtn type="goTo" @click="emit('goToHome')">Home Pos</MachineBtn>
        <MachineBtn type="goTo" @click="emit('goToZero')">Zero</MachineBtn>
      </div>

      <div class="wcsCol stack-tight strip-radio-group">
        <span class="label-muted">WCS</span>
        <div class="strip-radio-options">
          <label v-for="g in g5xOptions" :key="g" class="radio-label">
            <MachineRadio gate="touchoff" name="wcs" :value="g" :modelValue="g5xLabel" @update:modelValue="(v: string | number | undefined) => { if (v != null) emit('setG5x', String(v)) }" />
            <span>{{ g }}</span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setupContent > * { flex-shrink: 0; }
.setupGrid {
  display: grid;
  grid-template-columns: 80px 1fr 1fr;
  gap: var(--gap-tight);
  align-content: start;
}
.setupInput { width: 100%; }
.spanAll { grid-column: 1 / -1; }
.wcsCol { justify-content: flex-start; }

@media (orientation: portrait) {
  .setupContent { flex-direction: column; }
  /* Narrow input column to fit 280px strip width */
  .setupGrid { grid-template-columns: 70px 1fr 1fr; }
}
</style>
