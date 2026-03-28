<script setup lang="ts">
import { computed } from "vue";
import { STEP_DEFAULT } from "./defaults";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";


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

const axesList = computed(() => props.axes ?? ["X", "Y", "Z"]);

function updateTouchoff(axis: number, val: number) {
  const copy = [...props.touchoff];
  copy[axis] = val;
  emit("update:touchoff", copy);
}

</script>

<template>
  <div class="setupHud">
    <!-- Homing -->
    <div class="row">
      <MachineBtn
        v-if="!homed"
        type="home"
        block
        @click="emit('homeAll')"
      >Home All</MachineBtn>
      <MachineBtn
        v-else
        type="unhome"
        block
        @click="emit('unhomeAll')"
      >Unhome</MachineBtn>
    </div>

    <!-- Set individual axes -->
    <div class="axisRow" v-for="(letter, i) in axesList" :key="letter">
      <MachineInput gate="touchoff" type="number" :step="STEP_DEFAULT" :value="touchoff[i]" @input="updateTouchoff(i, +($event.target as HTMLInputElement).value)" @keydown.enter="emit('setAxis', i, touchoff[i] ?? 0)" />
      <MachineBtn type="zero" @click="emit('setAxis', i, touchoff[i] ?? 0)">Set {{ letter }}</MachineBtn>
    </div>

    <!-- Set all -->
    <div class="row">
      <MachineBtn type="zero" block @click="emit('setAll', [...touchoff])">Set All</MachineBtn>
    </div>

    <!-- Go-to navigation -->
    <div class="row">
      <MachineBtn type="goTo" @click="emit('goToG30')">Go to G30</MachineBtn>
      <MachineBtn type="goTo" @click="emit('goToHome')">Go to Home</MachineBtn>
      <MachineBtn type="goTo" @click="emit('goToZero')">Go to Zero</MachineBtn>
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
