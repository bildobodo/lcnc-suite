<script setup lang="ts">
import { computed } from "vue";
import { usePermissions } from "./permissions";

const ROTARY = new Set(["A", "B", "C"]);
const AXIS_LETTERS = "XYZABCUVW";

const props = defineProps<{
  homed: boolean;
  touchoff: number[];
  axes?: string[];
}>();

const emit = defineEmits<{
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "setAxis", axis: number, value: number): void;
  (e: "setAll", values: number[]): void;
  (e: "update:touchoff", values: number[]): void;
  (e: "goToG30"): void;
  (e: "goToHome"): void;
  (e: "goToZero"): void;
}>();

const can = usePermissions();

const axesList = computed(() => props.axes ?? ["X", "Y", "Z"]);

const homeDisabled = computed(() => !can.value.idle || props.homed);
const unhomeDisabled = computed(() => !can.value.idle || !props.homed);
const zeroDisabled = computed(() => !can.value.zero);

function updateTouchoff(axis: number, val: number) {
  const copy = [...props.touchoff];
  copy[axis] = val;
  emit("update:touchoff", copy);
}

function touchoffStep(letter: string) {
  return ROTARY.has(letter) ? "0.01" : "0.001";
}
</script>

<template>
  <div class="setupHud hud-panel">
    <!-- Homing -->
    <div class="row">
      <button
        v-if="!homed"
        class="btn primary wide"
        :disabled="homeDisabled"
        @click="emit('homeAll')"
      >Home All</button>
      <button
        v-else
        class="btn wide"
        :disabled="unhomeDisabled"
        @click="emit('unhomeAll')"
      >Unhome</button>
    </div>

    <!-- Set individual axes -->
    <div class="axisRow" v-for="(letter, i) in axesList" :key="letter">
      <input type="number" :step="touchoffStep(letter)" :value="touchoff[i]" @input="updateTouchoff(i, +($event.target as HTMLInputElement).value)" :disabled="zeroDisabled" @keydown.enter="emit('setAxis', i, touchoff[i] ?? 0)" />
      <button class="btn" :disabled="zeroDisabled" @click="emit('setAxis', i, touchoff[i] ?? 0)">Set {{ letter }}</button>
    </div>

    <!-- Set all -->
    <div class="row">
      <button class="btn wide" :disabled="zeroDisabled" @click="emit('setAll', [...touchoff])">Set All</button>
    </div>

    <!-- Go-to navigation -->
    <div class="row">
      <button class="btn" :disabled="!can.ready" @click="emit('goToG30')">Go to G30</button>
      <button class="btn" :disabled="!can.ready" @click="emit('goToHome')">Go to Home</button>
      <button class="btn" :disabled="!can.ready" @click="emit('goToZero')">Go to Zero</button>
    </div>
  </div>
</template>

<style scoped>
.setupHud {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.row {
  display: flex;
  gap: 4px;
}

.btn {
  flex: 1;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
}

.btn.primary {
  background: color-mix(in oklab, var(--ok) 20%, var(--button-bg));
}

.btn.primary:hover:not(:disabled) {
  background: color-mix(in oklab, var(--ok) 35%, var(--button-bg));
}

.btn.wide {
  width: 100%;
}

.axisRow {
  display: flex;
  gap: 4px;
}

.axisRow input {
  width: 60px;
  text-align: right;
  font-size: 11px;
  padding: 3px 6px;
}
</style>
