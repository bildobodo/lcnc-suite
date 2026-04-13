<script setup lang="ts">
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineSlider from "./MachineSlider.vue";
import { STEP_OVERRIDE, STEP_RAPID_OVERRIDE } from "./defaults";

const props = defineProps<{
  feedSlider: number;
  spindleSlider: number;
  rapidSlider: number;
  feedOvrEnabled: boolean;
  spindleOvrEnabled: boolean;
  maxFeedOverride: number;
  minSpindleOverride: number;
  maxSpindleOverride: number;
}>();

const emit = defineEmits<{
  (e: "update:feedSlider", v: number): void;
  (e: "update:spindleSlider", v: number): void;
  (e: "update:rapidSlider", v: number): void;
  (e: "feedChange"): void;
  (e: "spindleSliderChange"): void;
  (e: "rapidChange"): void;
  (e: "overridePreset", type: "feed" | "spindle" | "rapid", percent: number): void;
}>();

function onFeedSlider(v: number) { emit('update:feedSlider', v); }
function onSpindleSlider(v: number) { emit('update:spindleSlider', v); }
function onRapidSlider(v: number) { emit('update:rapidSlider', v); }
</script>

<template>
  <Gate gate="override" class="stripSection">
    <div class="sub">Overrides</div>
    <div class="ovrSection row-sections strip-slider-group">
      <div class="ovrCol stack-tight strip-slider-row">
        <span class="label-muted">Feed</span>
        <span class="val-mono" :class="{ warn: feedSlider !== 100 }">{{ feedSlider }}%</span>
        <MachineSlider gate="feedOverride" :modelValue="feedSlider" @update:model-value="onFeedSlider(Number($event))" @change="emit('feedChange')" :min="0" :max="maxFeedOverride" :step="STEP_OVERRIDE" :disabled="!feedOvrEnabled" class="vSlider" />
        <MachineBtn type="overrideReset" @click="emit('overridePreset', 'feed', 100)">Reset</MachineBtn>
      </div>
      <div class="ovrCol stack-tight strip-slider-row">
        <span class="label-muted">Spindle</span>
        <span class="val-mono" :class="{ warn: spindleSlider !== 100 }">{{ spindleSlider }}%</span>
        <MachineSlider gate="spindleOverride" :modelValue="spindleSlider" @update:model-value="onSpindleSlider(Number($event))" @change="emit('spindleSliderChange')" :min="minSpindleOverride" :max="maxSpindleOverride" :step="STEP_OVERRIDE" :disabled="!spindleOvrEnabled" class="vSlider" />
        <MachineBtn type="overrideReset" @click="emit('overridePreset', 'spindle', 100)">Reset</MachineBtn>
      </div>
      <div class="ovrCol stack-tight strip-slider-row">
        <span class="label-muted">Rapid</span>
        <span class="val-mono" :class="{ warn: rapidSlider !== 100 }">{{ rapidSlider }}%</span>
        <MachineSlider gate="rapidOverride" :modelValue="rapidSlider" @update:model-value="onRapidSlider(Number($event))" @change="emit('rapidChange')" :min="25" :max="100" :step="STEP_RAPID_OVERRIDE" class="vSlider" />
        <MachineBtn type="overrideReset" @click="emit('overridePreset', 'rapid', 100)">Reset</MachineBtn>
      </div>
    </div>
  </Gate>
</template>

<style scoped>
.ovrSection > * { flex-shrink: 0; }
.ovrCol {
  align-items: center;
  height: 100%;
  justify-content: center;
}
.vSlider {
  flex: 1;
  min-height: 0;
}

@media (orientation: portrait) {
  /* dissolve into ovrSection's shared 4-column grid
     (global strip-slider-group activates display:grid in portrait) */
  .ovrCol { display: contents; }
}
</style>
