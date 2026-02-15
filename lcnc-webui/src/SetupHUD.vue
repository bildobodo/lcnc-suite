<script setup lang="ts">
import { computed } from "vue";
import { usePermissions } from "./permissions";

const props = defineProps<{
  homed: boolean;
}>();

const emit = defineEmits<{
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "zeroAxis", axis: number): void;
  (e: "zeroAll"): void;
}>();

const can = usePermissions();

const homeDisabled = computed(() => !can.value.idle || props.homed);
const unhomeDisabled = computed(() => !can.value.idle || !props.homed);
const zeroDisabled = computed(() => !can.value.idle);
</script>

<template>
  <div class="setupHud">
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

    <!-- Zero individual axes -->
    <div class="row">
      <button class="btn" :disabled="zeroDisabled" @click="emit('zeroAxis', 0)">Zero X</button>
      <button class="btn" :disabled="zeroDisabled" @click="emit('zeroAxis', 1)">Zero Y</button>
      <button class="btn" :disabled="zeroDisabled" @click="emit('zeroAxis', 2)">Zero Z</button>
    </div>

    <!-- Zero all -->
    <div class="row">
      <button class="btn wide" :disabled="zeroDisabled" @click="emit('zeroAll')">Zero All</button>
    </div>
  </div>
</template>

<style scoped>
.setupHud {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: color-mix(in oklab, var(--panel) 85%, transparent);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
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
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
  transition: background 0.1s;
}

.btn:hover:not(:disabled) {
  background: color-mix(in oklab, var(--fg) 10%, var(--button-bg));
}

.btn:active:not(:disabled) {
  background: color-mix(in oklab, var(--fg) 20%, var(--button-bg));
}

.btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.btn.primary {
  background: color-mix(in oklab, #4caf50 20%, var(--button-bg));
}

.btn.primary:hover:not(:disabled) {
  background: color-mix(in oklab, #4caf50 35%, var(--button-bg));
}

.btn.wide {
  width: 100%;
}
</style>
