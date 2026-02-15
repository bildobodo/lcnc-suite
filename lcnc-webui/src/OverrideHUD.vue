<script setup lang="ts">
import { ref, watch } from "vue";
import { usePermissions } from "./permissions";

const props = defineProps<{
  feedOverride: number | null;
  spindleOverride: number | null;
  rapidOverride: number | null;
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
  <div class="overrideHud">
    <!-- Feed -->
    <div class="ovRow">
      <span class="ovLabel">Feed</span>
      <input
        type="range" class="ovSlider"
        v-model.number="feedSlider" @change="onFeedChange"
        min="0" max="200" step="5"
        :disabled="!can.override"
      />
      <span class="ovValue" :class="{ warn: feedSlider !== 100 }">{{ feedSlider }}%</span>
    </div>

    <!-- Spindle -->
    <div class="ovRow">
      <span class="ovLabel">Spindle</span>
      <input
        type="range" class="ovSlider"
        v-model.number="spindleSlider" @change="onSpindleChange"
        min="50" max="200" step="5"
        :disabled="!can.override"
      />
      <span class="ovValue" :class="{ warn: spindleSlider !== 100 }">{{ spindleSlider }}%</span>
    </div>

    <!-- Rapid -->
    <div class="ovRow">
      <span class="ovLabel">Rapid</span>
      <input
        type="range" class="ovSlider"
        v-model.number="rapidSlider" @change="onRapidChange"
        min="25" max="100" step="25"
        :disabled="!can.override"
      />
      <span class="ovValue" :class="{ warn: rapidSlider !== 100 }">{{ rapidSlider }}%</span>
    </div>

    <!-- Reset -->
    <button class="resetBtn" :disabled="!can.override" @click="resetAll">Reset All</button>
  </div>
</template>

<style scoped>
.overrideHud {
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

.ovRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ovLabel {
  font-size: 10px;
  opacity: 0.6;
  min-width: 42px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.ovSlider {
  flex: 1;
}

.ovValue {
  font-size: 10px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-weight: 600;
  color: var(--fg);
  opacity: 0.7;
  min-width: 32px;
  text-align: right;
}

.ovValue.warn {
  color: #f5a623;
  opacity: 1;
}

.resetBtn {
  padding: 4px 0;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
}
</style>
