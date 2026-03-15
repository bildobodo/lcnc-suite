<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { usePermissions } from "./permissions";
import { SPINDLE_FORWARD, SPINDLE_REVERSE } from "./lcnc";
import { STEP_RPM, STEP_OVERRIDE } from "./defaults";
import { RotateCcw, RotateCw, Square } from "lucide-vue-next";

const props = defineProps<{
  spindleSpeed: number | null;
  spindleActual: number | null;
  spindleDirection: number | null;
  spindleOverride: number | null;
  minSpindleSpeed: number;
  maxSpindleSpeed: number;
  minSpindleOverride: number;
  maxSpindleOverride: number;
}>();

const emit = defineEmits<{
  (e: "spindleForward", speed: number): void;
  (e: "spindleReverse", speed: number): void;
  (e: "spindleStop"): void;
  (e: "setSpindleOverride", scale: number): void;
}>();

const can = usePermissions();

const rpmInput = ref(1000);

const isForward = computed(() => props.spindleDirection === SPINDLE_FORWARD);
const isReverse = computed(() => props.spindleDirection === SPINDLE_REVERSE);

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
  <div class="spindleHud hud-panel">
    <!-- Direction buttons -->
    <div class="dirRow">
      <button
        class="dirBtn"
        :class="{ active: isReverse }"
        :disabled="!can.ready"
        @click="emit('spindleReverse', rpmInput)"
        title="Reverse (CCW)"
      ><RotateCcw :size="12" /> REV</button>
      <button
        class="dirBtn stop"
        :class="{ active: isForward || isReverse }"
        :disabled="!can.ready"
        @click="emit('spindleStop')"
        title="Stop"
      ><Square :size="12" /> STOP</button>
      <button
        class="dirBtn"
        :class="{ active: isForward }"
        :disabled="!can.ready"
        @click="emit('spindleForward', rpmInput)"
        title="Forward (CW)"
      ><RotateCw :size="12" /> FWD</button>
    </div>

    <!-- RPM input -->
    <div class="rpmRow">
      <span class="label">RPM</span>
      <input
        type="number"
        class="rpmInput"
        v-model.number="rpmInput"
        :min="minSpindleSpeed"
        :max="maxSpindleSpeed"
        :step="STEP_RPM"
        :disabled="!can.ready"
      />
    </div>

    <!-- Actual speed -->
    <div class="infoRow">
      <span class="label">Actual</span>
      <span class="sliderVal">{{ formatRpm(spindleActual) }} RPM</span>
    </div>

    <!-- Override slider -->
    <div class="overrideRow">
      <span class="label">Override</span>
      <input
        type="range"
        class="overrideSlider"
        v-model.number="overrideSlider"
        @change="onOverrideChange"
        :min="minSpindleOverride"
        :max="maxSpindleOverride"
        :step="STEP_OVERRIDE"
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
  gap: var(--gap-tight);
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
  font-size: var(--fs-xs);
  font-weight: 600;
  border-radius: var(--radius-md);
}

.dirBtn.active {
  background: color-mix(in oklab, var(--ok) 25%, var(--button-bg));
  border-color: color-mix(in oklab, var(--ok) 40%, var(--border));
}

.dirBtn.stop.active {
  background: color-mix(in oklab, var(--danger) 25%, var(--button-bg));
  border-color: color-mix(in oklab, var(--danger) 40%, var(--border));
}

/* RPM input */
.rpmRow {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}

.label {
  min-width: 42px;
}

.rpmInput {
  flex: 1;
  padding: 3px 6px;
  font-size: var(--fs-sm);
  font-weight: 600;
  border-radius: var(--radius-md);
  max-width: 90px;
}

/* Info row */
.infoRow {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}


/* Override */
.overrideRow {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}

.overrideSlider {
  flex: 1;
}

.overrideLabel {
  font-size: var(--fs-xs);
  font-family: var(--font-mono);
  color: var(--fg);
  opacity: 0.7;
  min-width: 32px;
  text-align: right;
}

.overrideLabel.warn {
  color: var(--warn);
  opacity: 1;
}
</style>
