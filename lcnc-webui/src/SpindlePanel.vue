<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { usePermissions } from "./permissions";

const props = defineProps<{
  spindleSpeed: number | null;
  spindleActual: number | null;
  spindleDirection: number | null;
  spindleOverride: number | null;
}>();

const can = usePermissions();

const emit = defineEmits<{
  (e: "spindleForward", speed: number): void;
  (e: "spindleReverse", speed: number): void;
  (e: "spindleStop"): void;
  (e: "setSpindleOverride", scale: number): void;
}>();

const rpmInput = ref(1000);

// Direction state from props
const isForward = computed(() => props.spindleDirection === 1);
const isReverse = computed(() => props.spindleDirection === -1);
const isStopped = computed(() => !isForward.value && !isReverse.value);
const isSpinning = computed(() => isForward.value || isReverse.value);

// Override slider (synced with OverridePanel)
const overrideSlider = ref(100);

watch(() => props.spindleOverride, (val) => {
  if (val != null && Number.isFinite(val)) overrideSlider.value = Math.round(val * 100);
});

function onOverrideChange() {
  emit("setSpindleOverride", overrideSlider.value / 100);
}

function setPreset(percent: number) {
  overrideSlider.value = percent;
  onOverrideChange();
}

function formatRpm(val: number | null): string {
  if (val == null || !Number.isFinite(val)) return "—";
  return Math.round(val).toLocaleString();
}

</script>

<template>
  <div class="container">
    <!-- Direction controls -->
    <div class="dirRow">
      <button
        class="dirBtn rev"
        :class="{ active: isReverse }"
        :disabled="!can.ready"
        @click="emit('spindleReverse', rpmInput)"
        title="Spindle Reverse (CCW)"
      >
        <span class="dirIcon">&#x21BA;</span>
        <span class="dirLabel">REV</span>
      </button>

      <button
        class="dirBtn stop"
        :class="{ active: isSpinning }"
        :disabled="!can.ready"
        @click="emit('spindleStop')"
        title="Spindle Stop"
      >
        <span class="stopIcon">&#x25A0;</span>
        <span class="dirLabel">STOP</span>
      </button>

      <button
        class="dirBtn fwd"
        :class="{ active: isForward }"
        :disabled="!can.ready"
        @click="emit('spindleForward', rpmInput)"
        title="Spindle Forward (CW)"
      >
        <span class="dirIcon">&#x21BB;</span>
        <span class="dirLabel">FWD</span>
      </button>
    </div>

    <div class="separator"></div>

    <!-- RPM input -->
    <div class="rpmRow">
      <label class="fieldLabel">Speed (RPM)</label>
      <input
        type="number"
        class="rpmInput"
        v-model.number="rpmInput"
        min="0"
        max="99999"
        step="100"
        :disabled="!can.ready"
      />
    </div>

    <div class="separator"></div>

    <!-- Actual speed display -->
    <div class="actualGroup">
      <div class="actualRow">
        <span class="fieldLabel">Actual</span>
        <span class="actualValue">{{ formatRpm(spindleActual) }} <span class="unit">RPM</span></span>
      </div>
      <div class="actualRow">
        <span class="fieldLabel">Commanded</span>
        <span class="commandedValue">{{ formatRpm(spindleSpeed) }} <span class="unit">RPM</span></span>
      </div>
      <div class="actualRow">
        <span class="fieldLabel">Direction</span>
        <span class="dirValue" :class="{ fwdText: isForward, revText: isReverse }">
          {{ isForward ? "FWD (CW)" : isReverse ? "REV (CCW)" : "STOPPED" }}
        </span>
      </div>
    </div>

    <div class="separator"></div>

    <!-- Speed override slider -->
    <div class="overrideGroup">
      <div class="overrideLabel">
        <span>Speed Override</span>
        <span class="overrideValue" :class="{ warn: overrideSlider !== 100 }">{{ overrideSlider }}%</span>
      </div>
      <input
        type="range"
        class="slider"
        v-model.number="overrideSlider"
        @change="onOverrideChange"
        min="50"
        max="200"
        step="5"
        :disabled="!can.override"
      />
      <div class="presets">
        <button class="presetBtn" @click="setPreset(50)" :disabled="!can.override">50%</button>
        <button class="presetBtn" @click="setPreset(100)" :disabled="!can.override">100%</button>
        <button class="presetBtn" @click="setPreset(150)" :disabled="!can.override">150%</button>
        <button class="presetBtn" @click="setPreset(200)" :disabled="!can.override">200%</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dirRow {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.dirBtn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 20px;
  border-radius: 10px;
  min-width: 80px;
}

.dirBtn.fwd.active {
  background: color-mix(in oklab, #1a9a1a 30%, var(--panel));
  border-color: #1a9a1a80;
}

.dirBtn.rev.active {
  background: color-mix(in oklab, #1a9a1a 30%, var(--panel));
  border-color: #1a9a1a80;
}

.dirBtn.stop.active {
  background: color-mix(in oklab, #cc3333 30%, var(--panel));
  border-color: #cc333380;
}

.dirIcon {
  font-size: 28px;
  line-height: 1;
}

.stopIcon {
  font-size: 20px;
  line-height: 1.4;
}

.dirLabel {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.separator {
  height: 1px;
  background: var(--border);
  opacity: 0.3;
}

.rpmRow {
  display: flex;
  align-items: center;
  gap: 12px;
}

.fieldLabel {
  font-size: 13px;
  font-weight: 500;
  opacity: 0.8;
  min-width: 90px;
}

.rpmInput {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  font-size: 14px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-weight: 600;
  max-width: 160px;
}

.rpmInput:disabled {
  opacity: 0.4;
}

.actualGroup {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.actualRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.actualValue {
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-size: 18px;
  font-weight: 700;
  color: var(--fg);
}

.commandedValue {
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
  opacity: 0.7;
}

.unit {
  font-size: 11px;
  font-weight: 400;
  opacity: 0.6;
}

.dirValue {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.7;
}

.fwdText {
  color: #0a7a0a;
  opacity: 1;
}

.revText {
  color: #0a7a0a;
  opacity: 1;
}

.overrideGroup {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.overrideLabel {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.overrideLabel span:first-child {
  font-weight: 500;
  opacity: 0.8;
}

.overrideValue {
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}

.overrideValue.warn {
  color: #f5a623;
  animation: flash-warn 1.2s ease-in-out infinite;
}

@keyframes flash-warn {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.slider {
  width: 100%;
}

.presets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.presetBtn {
  padding: 4px 10px;
  font-size: 11px;
  border-radius: 4px;
  white-space: nowrap;
}
</style>
