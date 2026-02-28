<script setup lang="ts">
import { computed } from "vue";
import { usePermissions } from "./permissions";

const props = defineProps<{
  homed: boolean;
  touchoff: [number, number, number];
}>();

const emit = defineEmits<{
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "setAxis", axis: number, value: number): void;
  (e: "setAll", values: [number, number, number]): void;
  (e: "update:touchoff", values: [number, number, number]): void;
}>();

const can = usePermissions();

const homeDisabled = computed(() => !can.value.idle || props.homed);
const unhomeDisabled = computed(() => !can.value.idle || !props.homed);
const zeroDisabled = computed(() => !can.value.zero);

function updateTouchoff(axis: number, val: number) {
  const copy: [number, number, number] = [...props.touchoff];
  copy[axis] = val;
  emit("update:touchoff", copy);
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
    <div class="axisRow" v-for="(axis, i) in (['X', 'Y', 'Z'] as const)" :key="axis">
      <input type="number" step="0.001" :value="touchoff[i]" @input="updateTouchoff(i, +($event.target as HTMLInputElement).value)" :disabled="zeroDisabled" @keydown.enter="emit('setAxis', i, touchoff[i] ?? 0)" />
      <button class="btn" :disabled="zeroDisabled" @click="emit('setAxis', i, touchoff[i] ?? 0)">Set {{ axis }}</button>
    </div>

    <!-- Set all -->
    <div class="row">
      <button class="btn wide" :disabled="zeroDisabled" @click="emit('setAll', [...touchoff])">Set All</button>
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
