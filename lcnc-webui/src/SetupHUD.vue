<script setup lang="ts">
import { computed } from "vue";
import { usePermissions } from "./permissions";
import { STEP_DEFAULT } from "./defaults";
import Btn from "./Btn.vue";


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

</script>

<template>
  <div class="setupHud hud-panel">
    <!-- Homing -->
    <div class="row">
      <Btn
        v-if="!homed"
        variant="primary" block
        :disabled="homeDisabled"
        @click="emit('homeAll')"
      >Home All</Btn>
      <Btn
        v-else
        block
        :disabled="unhomeDisabled"
        @click="emit('unhomeAll')"
      >Unhome</Btn>
    </div>

    <!-- Set individual axes -->
    <div class="axisRow" v-for="(letter, i) in axesList" :key="letter">
      <input type="number" :step="STEP_DEFAULT" :value="touchoff[i]" @input="updateTouchoff(i, +($event.target as HTMLInputElement).value)" :disabled="zeroDisabled" @keydown.enter="emit('setAxis', i, touchoff[i] ?? 0)" />
      <Btn :disabled="zeroDisabled" @click="emit('setAxis', i, touchoff[i] ?? 0)">Set {{ letter }}</Btn>
    </div>

    <!-- Set all -->
    <div class="row">
      <Btn block :disabled="zeroDisabled" @click="emit('setAll', [...touchoff])">Set All</Btn>
    </div>

    <!-- Go-to navigation -->
    <div class="row">
      <Btn :disabled="!can.ready" @click="emit('goToG30')">Go to G30</Btn>
      <Btn :disabled="!can.ready" @click="emit('goToHome')">Go to Home</Btn>
      <Btn :disabled="!can.ready" @click="emit('goToZero')">Go to Zero</Btn>
    </div>
  </div>
</template>

<style scoped>
.setupHud {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
}

.row {
  display: flex;
  gap: var(--gap-tight);
}

.row :deep(.b) {
  flex: 1;
}

.axisRow {
  display: flex;
  gap: var(--gap-tight);
}

.axisRow :deep(.b) {
  flex: 1;
}

.axisRow input {
  width: 60px;
  text-align: right;
  font-size: var(--fs-sm);
  padding: 3px 6px;
}
</style>
