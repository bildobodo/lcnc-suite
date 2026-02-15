<script setup lang="ts">
import { ref, watch } from "vue";
import { usePermissions } from "./permissions";

const props = defineProps<{
  feedOverride: number | null;
  spindleOverride: number | null;
  rapidOverride: number | null;
}>();

const can = usePermissions();

const emit = defineEmits<{
  (e: "setFeedOverride", scale: number): void;
  (e: "setSpindleOverride", scale: number): void;
  (e: "setRapidOverride", scale: number): void;
}>();

// Local slider values (0-100 range for display)
const feedSlider = ref(100);
const spindleSlider = ref(100);
const rapidSlider = ref(100);

// Sync slider values when props change (with NaN protection)
watch(() => props.feedOverride, (val) => {
  if (val != null && Number.isFinite(val)) feedSlider.value = Math.round(val * 100);
});

watch(() => props.spindleOverride, (val) => {
  if (val != null && Number.isFinite(val)) spindleSlider.value = Math.round(val * 100);
});

watch(() => props.rapidOverride, (val) => {
  if (val != null && Number.isFinite(val)) rapidSlider.value = Math.round(val * 100);
});

// Emit changes when slider is released (avoid spamming during drag)
function onFeedChange() {
  emit("setFeedOverride", feedSlider.value / 100);
}

function onSpindleChange() {
  emit("setSpindleOverride", spindleSlider.value / 100);
}

function onRapidChange() {
  emit("setRapidOverride", rapidSlider.value / 100);
}

// Quick preset buttons
function setPreset(type: "feed" | "spindle" | "rapid", percent: number) {
  if (type === "feed") {
    feedSlider.value = percent;
    onFeedChange();
  } else if (type === "spindle") {
    spindleSlider.value = percent;
    onSpindleChange();
  } else if (type === "rapid") {
    rapidSlider.value = percent;
    onRapidChange();
  }
}

// Reset all overrides to 100%
function resetAll() {
  feedSlider.value = 100;
  onFeedChange();
  spindleSlider.value = 100;
  onSpindleChange();
  rapidSlider.value = 100;
  onRapidChange();
}
</script>

<template>
  <div class="container">
    <div class="resetAllRow">
      <button class="resetAllBtn" @click="resetAll" :disabled="!can.override">Reset All Overrides</button>
    </div>

    <div class="separator"></div>

    <div class="overrideGroup">
      <div class="overrideRow">
        <div class="overrideLabel">
          <span>Feed Override</span>
          <span class="overrideValue" :class="{ warn: feedSlider !== 100 }">{{ feedSlider }}%</span>
        </div>
        <input
          type="range"
          class="slider"
          v-model.number="feedSlider"
          @change="onFeedChange"
          min="0"
          max="200"
          step="5"
          :disabled="!can.override"
        />
        <div class="presets">
          <button class="presetBtn" @click="setPreset('feed', 50)" :disabled="!can.override">50%</button>
          <button class="presetBtn" @click="setPreset('feed', 100)" :disabled="!can.override">100%</button>
          <button class="presetBtn" @click="setPreset('feed', 150)" :disabled="!can.override">150%</button>
          <button class="presetBtn" @click="setPreset('feed', 200)" :disabled="!can.override">200%</button>
        </div>
      </div>
    </div>

    <div class="separator"></div>

    <div class="overrideGroup">
      <div class="overrideRow">
        <div class="overrideLabel">
          <span>Spindle Override</span>
          <span class="overrideValue" :class="{ warn: spindleSlider !== 100 }">{{ spindleSlider }}%</span>
        </div>
        <input
          type="range"
          class="slider"
          v-model.number="spindleSlider"
          @change="onSpindleChange"
          min="50"
          max="200"
          step="5"
          :disabled="!can.override"
        />
        <div class="presets">
          <button class="presetBtn" @click="setPreset('spindle', 50)" :disabled="!can.override">50%</button>
          <button class="presetBtn" @click="setPreset('spindle', 100)" :disabled="!can.override">100%</button>
          <button class="presetBtn" @click="setPreset('spindle', 150)" :disabled="!can.override">150%</button>
          <button class="presetBtn" @click="setPreset('spindle', 200)" :disabled="!can.override">200%</button>
        </div>
      </div>
    </div>

    <div class="separator"></div>

    <div class="overrideGroup">
      <div class="overrideRow">
        <div class="overrideLabel">
          <span>Rapid Override</span>
          <span class="overrideValue" :class="{ warn: rapidSlider !== 100 }">{{ rapidSlider }}%</span>
        </div>
        <input
          type="range"
          class="slider"
          v-model.number="rapidSlider"
          @change="onRapidChange"
          min="25"
          max="100"
          step="25"
          :disabled="!can.override"
        />
        <div class="presets">
          <button class="presetBtn" @click="setPreset('rapid', 25)" :disabled="!can.override">25%</button>
          <button class="presetBtn" @click="setPreset('rapid', 50)" :disabled="!can.override">50%</button>
          <button class="presetBtn" @click="setPreset('rapid', 75)" :disabled="!can.override">75%</button>
          <button class="presetBtn" @click="setPreset('rapid', 100)" :disabled="!can.override">100%</button>
        </div>
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

.overrideGroup {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.overrideRow {
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
  height: 6px;
  border-radius: 3px;
  background: color-mix(in oklab, var(--panel) 90%, var(--fg));
  outline: none;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}

.slider:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--fg);
  cursor: pointer;
  transition: all 0.15s ease;
}

.slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--fg);
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.slider::-moz-range-thumb:hover {
  transform: scale(1.2);
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
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.presetBtn:hover:not(:disabled) {
  background: color-mix(in oklab, var(--button-bg) 85%, var(--fg));
}

.presetBtn:active:not(:disabled) {
  transform: scale(0.95);
}

.presetBtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.separator {
  height: 1px;
  background: var(--border);
  opacity: 0.3;
}

.resetAllRow {
  display: flex;
  justify-content: center;
}

.resetAllBtn {
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.resetAllBtn:hover:not(:disabled) {
  background: color-mix(in oklab, var(--button-bg) 85%, var(--fg));
}

.resetAllBtn:active:not(:disabled) {
  transform: scale(0.95);
}

.resetAllBtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
