<script setup lang="ts">
import { ref, watch } from "vue";
import { usePermissions } from "./permissions";
import { STEP_OVERRIDE, STEP_RAPID_OVERRIDE } from "./defaults";

const props = defineProps<{
  feedOverride: number | null;
  spindleOverride: number | null;
  rapidOverride: number | null;
  maxFeedOverride: number;
  minSpindleOverride: number;
  maxSpindleOverride: number;
}>();

const emit = defineEmits<{
  (e: "setFeedOverride", scale: number): void;
  (e: "setSpindleOverride", scale: number): void;
  (e: "setRapidOverride", scale: number): void;
}>();

const can = usePermissions();

const feedSlider = ref(100);
const spindleSlider = ref(100);
const rapidSlider = ref(100);

watch(() => props.feedOverride, (val) => {
  if (val != null && Number.isFinite(val)) feedSlider.value = Math.round(val * 100);
});

watch(() => props.spindleOverride, (val) => {
  if (val != null && Number.isFinite(val)) spindleSlider.value = Math.round(val * 100);
});

watch(() => props.rapidOverride, (val) => {
  if (val != null && Number.isFinite(val)) rapidSlider.value = Math.round(val * 100);
});

function onFeedChange() { emit("setFeedOverride", feedSlider.value / 100); }
function onSpindleChange() { emit("setSpindleOverride", spindleSlider.value / 100); }
function onRapidChange() { emit("setRapidOverride", rapidSlider.value / 100); }

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
  <div class="overrideHud hud-panel">
    <!-- Feed -->
    <div class="ovRow">
      <span class="label">Feed</span>
      <input
        type="range" class="ovSlider"
        v-model.number="feedSlider" @change="onFeedChange"
        min="0" :max="maxFeedOverride" :step="STEP_OVERRIDE"
        :disabled="!can.override"
      />
      <span class="sliderVal" :class="{ warn: feedSlider !== 100 }">{{ feedSlider }}%</span>
    </div>

    <!-- Spindle -->
    <div class="ovRow">
      <span class="label">Spindle</span>
      <input
        type="range" class="ovSlider"
        v-model.number="spindleSlider" @change="onSpindleChange"
        :min="minSpindleOverride" :max="maxSpindleOverride" :step="STEP_OVERRIDE"
        :disabled="!can.override"
      />
      <span class="sliderVal" :class="{ warn: spindleSlider !== 100 }">{{ spindleSlider }}%</span>
    </div>

    <!-- Rapid -->
    <div class="ovRow">
      <span class="label">Rapid</span>
      <input
        type="range" class="ovSlider"
        v-model.number="rapidSlider" @change="onRapidChange"
        min="25" max="100" :step="STEP_RAPID_OVERRIDE"
        :disabled="!can.override"
      />
      <span class="sliderVal" :class="{ warn: rapidSlider !== 100 }">{{ rapidSlider }}%</span>
    </div>

    <!-- Reset -->
    <button class="resetBtn" :disabled="!can.override" @click="resetAll">Reset All</button>
  </div>
</template>

<style scoped>
.overrideHud {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  min-width: 200px;
}

.ovRow {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}

.label {
  min-width: 42px;
}

.ovSlider {
  flex: 1;
}


.resetBtn {
  padding: 4px 0;
  font-size: var(--fs-xs);
  font-weight: 600;
  border-radius: var(--radius-md);
}
</style>
