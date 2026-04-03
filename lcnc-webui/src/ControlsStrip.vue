<script setup lang="ts">
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineSlider from "./MachineSlider.vue";
import MachineInput from "./MachineInput.vue";
import MachineToggle from "./MachineToggle.vue";
import { RotateCw, RotateCcw, Square } from "lucide-vue-next";
import { STEP_RPM, STEP_OVERRIDE, STEP_RAPID_OVERRIDE, type MacroDef } from "./defaults";

const props = defineProps<{
  feedSlider: number;
  spindleSlider: number;
  rapidSlider: number;
  feedOvrEnabled: boolean;
  spindleOvrEnabled: boolean;
  maxFeedOverride: number;
  minSpindleOverride: number;
  maxSpindleOverride: number;
  isForward: boolean;
  isReverse: boolean;
  isSpinning: boolean;
  rpmInput: number;
  spindleActual: number | null;
  spindleSpeed: number | null;
  spindleLoad: number | null;
  minSpindleSpeed: number;
  maxSpindleSpeed: number;
  floodOn: boolean;
  mistOn: boolean;
  toolNumber: number;
  currentTool: number;
  toolDiameter: number | null;
  toolLength: number | null;
  probing: boolean;
  userMacros: MacroDef[];
}>();

const emit = defineEmits<{
  (e: "update:feedSlider", v: number): void;
  (e: "update:spindleSlider", v: number): void;
  (e: "update:rapidSlider", v: number): void;
  (e: "feedChange"): void;
  (e: "spindleSliderChange"): void;
  (e: "rapidChange"): void;
  (e: "overridePreset", type: "feed" | "spindle" | "rapid", percent: number): void;
  (e: "resetAllOverrides"): void;
  (e: "spindleFwd", speed: number): void;
  (e: "spindleRev", speed: number): void;
  (e: "spindleStop"): void;
  (e: "update:rpmInput", v: number): void;
  (e: "toggleFlood"): void;
  (e: "toggleMist"): void;
  (e: "update:toolNumber", v: number): void;
  (e: "saveToolNumber"): void;
  (e: "measureAuto"): void;
  (e: "loadTool"): void;
  (e: "unloadTool"): void;
  (e: "openToolTable"): void;
  (e: "executeMacro", m: MacroDef): void;
}>();

function formatRpm(val: number | null): string {
  if (val == null) return "---";
  return Math.round(val).toLocaleString();
}

function onFeedSlider(v: number) { emit('update:feedSlider', v); }
function onSpindleSlider(v: number) { emit('update:spindleSlider', v); }
function onRapidSlider(v: number) { emit('update:rapidSlider', v); }
</script>

<template>
  <div class="controlsStrip">
    <!-- LEFT: Overrides -->
    <Gate gate="override" class="ovrSection">
      <div class="ovrCol">
        <span class="val-mono" :class="{ warn: feedSlider !== 100 }">{{ feedSlider }}%</span>
        <MachineSlider gate="feedOverride" :modelValue="feedSlider" @update:model-value="onFeedSlider(Number($event))" @change="emit('feedChange')" :min="0" :max="maxFeedOverride" :step="STEP_OVERRIDE" :disabled="!feedOvrEnabled" class="vSlider" />
        <span class="label-muted">Feed</span>
        <MachineBtn type="overrideReset" @click="emit('overridePreset', 'feed', 100)">Reset</MachineBtn>
      </div>
      <div class="ovrCol">
        <span class="val-mono" :class="{ warn: spindleSlider !== 100 }">{{ spindleSlider }}%</span>
        <MachineSlider gate="spindleOverride" :modelValue="spindleSlider" @update:model-value="onSpindleSlider(Number($event))" @change="emit('spindleSliderChange')" :min="minSpindleOverride" :max="maxSpindleOverride" :step="STEP_OVERRIDE" :disabled="!spindleOvrEnabled" class="vSlider" />
        <span class="label-muted">Spindle</span>
        <MachineBtn type="overrideReset" @click="emit('overridePreset', 'spindle', 100)">Reset</MachineBtn>
      </div>
      <div class="ovrCol">
        <span class="val-mono" :class="{ warn: rapidSlider !== 100 }">{{ rapidSlider }}%</span>
        <MachineSlider gate="rapidOverride" :modelValue="rapidSlider" @update:model-value="onRapidSlider(Number($event))" @change="emit('rapidChange')" :min="25" :max="100" :step="STEP_RAPID_OVERRIDE" class="vSlider" />
        <span class="label-muted">Rapid</span>
        <MachineBtn type="overrideReset" @click="emit('overridePreset', 'rapid', 100)">Reset</MachineBtn>
      </div>
    </Gate>

    <!-- RIGHT: Tool + Spindle + Coolant -->
    <div class="rightSection">
      <!-- Spindle -->
      <Gate gate="ready" class="spnBlock">
        <div class="spDirRow">
          <MachineBtn type="spindleRev" :active="isReverse" @click="emit('spindleRev', rpmInput)">
            <span class="btn-label"><RotateCcw :size="14" /> Rev</span>
          </MachineBtn>
          <MachineBtn type="spindleStop" :active="isSpinning" :disabled="!isSpinning" @click="emit('spindleStop')">
            <span class="btn-label"><Square :size="14" /> Stop</span>
          </MachineBtn>
          <MachineBtn type="spindleFwd" :active="isForward" @click="emit('spindleFwd', rpmInput)">
            <span class="btn-label"><RotateCw :size="14" /> Fwd</span>
          </MachineBtn>
        </div>

        <div class="spRpmRow">
          <span class="label-muted md">Speed</span>
          <MachineInput gate="rpmInput" type="number" class="spRpmInput" :value="rpmInput" @input="emit('update:rpmInput', +($event.target as HTMLInputElement).value)" :min="minSpindleSpeed" :max="maxSpindleSpeed" :step="STEP_RPM" />
        </div>

        <div class="spActualGroup">
          <div class="spActualRow">
            <span class="label-muted md">Actual</span>
            <span class="val-status md mono">{{ formatRpm(spindleActual) }}</span>
          </div>
          <div class="spActualRow">
            <span class="label-muted md">Cmd</span>
            <span class="val-status md mono muted">{{ formatRpm(spindleSpeed) }}</span>
          </div>
          <div class="spActualRow">
            <span class="label-muted md">Dir</span>
            <span class="val-status md" :class="{ ok: isSpinning }"><span class="stable-width"><span :class="{ alt: !isForward }">FWD</span><span :class="{ alt: !isReverse }">REV</span><span :class="{ alt: isForward || isReverse }">OFF</span></span></span>
          </div>
          <div v-if="spindleLoad != null" class="spActualRow">
            <span class="label-muted md">Load</span>
            <span class="val-status md mono">{{ Math.round(spindleLoad) }}%</span>
          </div>
        </div>
      </Gate>

      <!-- Coolant -->
      <div class="coolBlock">
        <MachineToggle gate="coolant" :modelValue="floodOn" @update:modelValue="emit('toggleFlood')" label="Flood" />
        <MachineToggle gate="coolant" :modelValue="mistOn" @update:modelValue="emit('toggleMist')" label="Mist" />
      </div>
    </div>

    <!-- RIGHT-MOST: Tool -->
    <div class="toolBlock">
      <div class="toolInputRow">
        <span class="label-muted md">Tool #</span>
        <MachineInput gate="rpmInput" type="number" class="toolNumInput"
          :value="toolNumber"
          @input="emit('update:toolNumber', +($event.target as HTMLInputElement).value)"
          @change="emit('saveToolNumber')"
          :min="1" />
        <MachineBtn type="mdi" :disabled="probing" @click="emit('loadTool')">Load</MachineBtn>
        <MachineBtn type="toolUnload" :disabled="probing" @click="emit('unloadTool')">Unload</MachineBtn>
      </div>

      <div class="toolActionRow">
        <MachineBtn type="mdi" :disabled="probing" @click="emit('measureAuto')">Measure</MachineBtn>
        <MachineBtn type="manage" @click="emit('openToolTable')">Table</MachineBtn>
      </div>

      <div class="toolStats">
        <div class="spActualRow">
          <span class="label-muted md">Current Tool</span>
          <span class="val-status md mono">T{{ currentTool }}</span>
        </div>
        <div class="spActualRow">
          <span class="label-muted md">Diameter</span>
          <span class="val-status md mono">{{ toolDiameter != null ? toolDiameter.toFixed(3) : '---' }}</span>
        </div>
        <div class="spActualRow">
          <span class="label-muted md">Z Offset</span>
          <span class="val-status md mono">{{ toolLength != null ? toolLength.toFixed(3) : '---' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.controlsStrip {
  display: flex;
  gap: var(--gap-controls);
  height: 100%;
  flex-shrink: 0;
  overflow: hidden;
}

/* ── Overrides ── */
.ovrSection {
  display: flex;
  gap: var(--gap-section);
}
.ovrCol {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-tight);
  height: 100%;
  justify-content: center;
}
.vSlider {
  flex: 1;
  min-height: 0;
}

/* ── Right column: Tool + Spindle + Coolant stacked ── */
.rightSection {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  border-left: 1px solid var(--border-subtle);
  padding-left: var(--gap-controls);
}

/* Spindle */
.spnBlock {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--gap-controls);
}
.spDirRow {
  display: flex;
  gap: var(--gap-tight);
}
.spRpmRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
}
.spRpmInput { flex: 1; }
.spActualGroup {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
}
.spActualRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
/* Coolant */
.coolBlock {
  display: flex;
  gap: var(--gap-section);
  flex-shrink: 0;
}

/* ── Tool ── */
.toolBlock {
  display: flex;
  flex-direction: column;
  gap: var(--gap-controls);
  border-left: 1px solid var(--border-subtle);
  padding-left: var(--gap-controls);
}

.toolInputRow {
  display: flex;
  align-items: stretch;
  gap: var(--gap-tight);
}

.toolNumInput {
  width: 60px;
}

.toolActionRow {
  display: flex;
  gap: var(--gap-tight);
}

.toolActionRow :deep(.b) {
  flex: 1;
}

.toolStats {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
}
</style>
