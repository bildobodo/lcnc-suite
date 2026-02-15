<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { usePermissions } from "./permissions";

const props = defineProps<{
  spindleSpeed: number | null;
  spindleActual: number | null;
  spindleDirection: number | null;
  spindleOverride: number | null;
}>();

const emit = defineEmits<{
  (e: "spindleForward", speed: number): void;
  (e: "spindleReverse", speed: number): void;
  (e: "spindleStop"): void;
  (e: "setSpindleOverride", scale: number): void;
}>();

const can = usePermissions();

const rpmInput = ref(1000);

const isForward = computed(() => props.spindleDirection === 1);
const isReverse = computed(() => props.spindleDirection === -1);

const overrideSlider = ref(100);

watch(() => props.spindleOverride, (val) => {
  if (val != null && Number.isFinite(val)) overrideSlider.value = Math.round(val * 100);
});

function onOverrideChange() {
  emit("setSpindleOverride", overrideSlider.value / 100);
}

function formatRpm(val: number | null): string {
  if (val == null || !Number.isFinite(val)) return "---";
  return Math.round(val).toLocaleString();
}
</script>

<template>
  <div class="spindleHud">
    <!-- Direction buttons -->
    <div class="dirRow">
      <button
        class="dirBtn"
        :class="{ active: isReverse }"
        :disabled="!can.idle"
        @click="emit('spindleReverse', rpmInput)"
        title="Reverse (CCW)"
      >&#x21BA; REV</button>
      <button
        class="dirBtn stop"
        :class="{ active: isForward || isReverse }"
        :disabled="!can.idle"
        @click="emit('spindleStop')"
        title="Stop"
      >&#x25A0; STOP</button>
      <button
        class="dirBtn"
        :class="{ active: isForward }"
        :disabled="!can.idle"
        @click="emit('spindleForward', rpmInput)"
        title="Forward (CW)"
      >&#x21BB; FWD</button>
    </div>

    <!-- RPM input -->
    <div class="rpmRow">
      <span class="label">RPM</span>
      <input
        type="number"
        class="rpmInput"
        v-model.number="rpmInput"
        min="0"
        max="99999"
        step="100"
        :disabled="!can.idle"
      />
    </div>

    <!-- Actual speed -->
    <div class="infoRow">
      <span class="label">Actual</span>
      <span class="infoValue">{{ formatRpm(spindleActual) }} RPM</span>
    </div>

    <!-- Override slider -->
    <div class="overrideRow">
      <span class="label">Override</span>
      <input
        type="range"
        class="overrideSlider"
        v-model.number="overrideSlider"
        @change="onOverrideChange"
        min="50"
        max="200"
        step="5"
        :disabled="!can.override"
      />
      <span class="overrideLabel" :class="{ warn: overrideSlider !== 100 }">{{ overrideSlider }}%</span>
    </div>
  </div>
</template>

<style scoped>
.spindleHud {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: color-mix(in oklab, var(--panel) 85%, transparent);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  min-width: 200px;
}

/* Direction buttons */
.dirRow {
  display: flex;
  gap: 3px;
}

.dirBtn {
  flex: 1;
  padding: 5px 0;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
  transition: background 0.1s;
}

.dirBtn:hover:not(:disabled) {
  background: color-mix(in oklab, var(--fg) 10%, var(--button-bg));
}

.dirBtn:active:not(:disabled) {
  background: color-mix(in oklab, var(--fg) 20%, var(--button-bg));
}

.dirBtn:disabled {
  opacity: 0.35;
  cursor: default;
}

.dirBtn.active {
  background: color-mix(in oklab, #4caf50 25%, var(--button-bg));
  border-color: color-mix(in oklab, #4caf50 40%, var(--border));
}

.dirBtn.stop.active {
  background: color-mix(in oklab, #f44336 25%, var(--button-bg));
  border-color: color-mix(in oklab, #f44336 40%, var(--border));
}

/* RPM input */
.rpmRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.label {
  font-size: 10px;
  opacity: 0.6;
  min-width: 42px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.rpmInput {
  flex: 1;
  padding: 3px 6px;
  font-size: 11px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-weight: 600;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  max-width: 90px;
}

.rpmInput:disabled {
  opacity: 0.35;
}

/* Info row */
.infoRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.infoValue {
  font-size: 11px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-weight: 600;
  color: var(--fg);
}

/* Override */
.overrideRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.overrideSlider {
  flex: 1;
  height: 14px;
  cursor: pointer;
}

.overrideLabel {
  font-size: 10px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  color: var(--fg);
  opacity: 0.7;
  min-width: 32px;
  text-align: right;
}

.overrideLabel.warn {
  color: #f5a623;
  opacity: 1;
}
</style>
