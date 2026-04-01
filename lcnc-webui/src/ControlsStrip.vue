<script setup lang="ts">
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineSlider from "./MachineSlider.vue";
import MachineInput from "./MachineInput.vue";
import { RotateCw, RotateCcw, Square } from "lucide-vue-next";
import { STEP_RPM, STEP_OVERRIDE, STEP_RAPID_OVERRIDE, STEP_DEFAULT, type MacroDef } from "./defaults";

const props = defineProps<{
  // Overrides
  feedSlider: number;
  spindleSlider: number;
  rapidSlider: number;
  feedOvrEnabled: boolean;
  spindleOvrEnabled: boolean;
  maxFeedOverride: number;
  minSpindleOverride: number;
  maxSpindleOverride: number;
  // Spindle
  isForward: boolean;
  isReverse: boolean;
  isSpinning: boolean;
  rpmInput: number;
  spindleActual: number | null;
  spindleSpeed: number | null;
  spindleLoad: number | null;
  minSpindleSpeed: number;
  maxSpindleSpeed: number;
  // Coolant
  floodOn: boolean;
  mistOn: boolean;
  // Tool
  toolNumber: number;
  currentTool: number;
  probing: boolean;
  // Macros
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
    <!-- Row 1: Overrides header + Spindle header + Coolant header + Tool header -->
    <!-- Row 2-4: Content rows aligned across all groups -->

    <!-- ── OVERRIDES COLUMN ── -->
    <Gate gate="override" class="ovrCol">
      <div class="colLabel">Overrides</div>
      <div class="ovrGrid">
        <span class="ovrName">F</span>
        <MachineSlider gate="feedOverride" :modelValue="feedSlider" @update:model-value="onFeedSlider(Number($event))" @change="emit('feedChange')" :min="0" :max="maxFeedOverride" :step="STEP_OVERRIDE" :disabled="!feedOvrEnabled" />
        <span class="ovrVal" :class="{ warn: feedSlider !== 100 }">{{ feedSlider }}%</span>

        <span class="ovrName">S</span>
        <MachineSlider gate="spindleOverride" :modelValue="spindleSlider" @update:model-value="onSpindleSlider(Number($event))" @change="emit('spindleSliderChange')" :min="minSpindleOverride" :max="maxSpindleOverride" :step="STEP_OVERRIDE" :disabled="!spindleOvrEnabled" />
        <span class="ovrVal" :class="{ warn: spindleSlider !== 100 }">{{ spindleSlider }}%</span>

        <span class="ovrName">R</span>
        <MachineSlider gate="rapidOverride" :modelValue="rapidSlider" @update:model-value="onRapidSlider(Number($event))" @change="emit('rapidChange')" :min="25" :max="100" :step="STEP_RAPID_OVERRIDE" />
        <span class="ovrVal" :class="{ warn: rapidSlider !== 100 }">{{ rapidSlider }}%</span>
      </div>
      <MachineBtn type="overrideReset" @click="emit('resetAllOverrides')" block>Reset All</MachineBtn>
    </Gate>

    <!-- ── SPINDLE COLUMN ── -->
    <Gate gate="ready" class="spnCol">
      <div class="colLabel">Spindle</div>
      <div class="spnDir">
        <MachineBtn type="spindleRev" :active="isReverse" @click="emit('spindleRev', rpmInput)" title="Reverse (CCW)">
          <RotateCcw :size="16" />
        </MachineBtn>
        <MachineBtn type="spindleStop" :active="isSpinning" :disabled="!isSpinning" @click="emit('spindleStop')" title="Stop">
          <Square :size="16" />
        </MachineBtn>
        <MachineBtn type="spindleFwd" :active="isForward" @click="emit('spindleFwd', rpmInput)" title="Forward (CW)">
          <RotateCw :size="16" />
        </MachineBtn>
      </div>
      <div class="spnRpm">
        <MachineInput gate="rpmInput" type="number" :modelValue="rpmInput" @update:modelValue="emit('update:rpmInput', Number($event))" :min="minSpindleSpeed" :max="maxSpindleSpeed" :step="STEP_RPM" class="rpmInput" />
        <span class="spnUnit">RPM</span>
      </div>
      <div class="spnActual">{{ formatRpm(spindleActual) }} <span class="spnUnit">act</span></div>
    </Gate>

    <!-- ── COOLANT COLUMN ── -->
    <Gate gate="ready" class="clCol">
      <div class="colLabel">Coolant</div>
      <MachineBtn type="flood" :active="floodOn" @click="emit('toggleFlood')" block>
        Flood {{ floodOn ? 'ON' : 'OFF' }}
      </MachineBtn>
      <MachineBtn type="mist" :active="mistOn" @click="emit('toggleMist')" block>
        Mist {{ mistOn ? 'ON' : 'OFF' }}
      </MachineBtn>
    </Gate>

    <!-- ── TOOL COLUMN ── -->
    <Gate gate="ready" class="toolCol">
      <div class="colLabel">Tool</div>
      <div class="toolCurrent">T{{ currentTool }}</div>
      <MachineInput gate="toolEdit" type="number" :modelValue="toolNumber" @update:modelValue="emit('update:toolNumber', Number($event))" @change="emit('saveToolNumber')" :min="1" :step="STEP_DEFAULT" :disabled="probing" class="toolInput" />
      <div class="toolBtns">
        <MachineBtn type="toolMeasure" :disabled="probing" @click="emit('measureAuto')">Meas</MachineBtn>
        <MachineBtn type="toolLoad" :disabled="probing" @click="emit('loadTool')">Load</MachineBtn>
      </div>
    </Gate>

    <!-- ── MACROS (if any) ── -->
    <Gate gate="ready" class="macroCol" v-if="userMacros.length > 0">
      <div class="colLabel">Macros</div>
      <div class="macroBtns">
        <MachineBtn v-for="m in userMacros" :key="m.id" type="macro" @click="emit('executeMacro', m)">{{ m.name }}</MachineBtn>
      </div>
    </Gate>
  </div>
</template>

<style scoped>
.controlsStrip {
  display: flex;
  gap: var(--gap-section);
  align-items: flex-start;
  flex-shrink: 0;
}

/* Shared column style */
.ovrCol, .spnCol, .clCol, .toolCol, .macroCol {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
}

.colLabel {
  font-size: var(--fs-2xs);
  opacity: var(--opacity-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  padding-bottom: var(--gap-micro);
  border-bottom: 1px solid var(--border);
}

/* ── Overrides ── */
.ovrCol {
  min-width: 180px;
}
.ovrGrid {
  display: grid;
  grid-template-columns: 14px 1fr 44px;
  gap: var(--gap-tight) var(--gap-tight);
  align-items: center;
}
.ovrName {
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-align: center;
}
.ovrVal {
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
  text-align: right;
}
.ovrVal.warn {
  color: var(--warn);
}

/* ── Spindle ── */
.spnCol {
  min-width: 110px;
}
.spnDir {
  display: flex;
  gap: var(--gap-tight);
}
.spnRpm {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}
.rpmInput {
  width: 70px;
}
.spnUnit {
  font-size: var(--fs-2xs);
  opacity: var(--opacity-muted);
}
.spnActual {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
}

/* ── Coolant ── */
.clCol {
  min-width: 90px;
}

/* ── Tool ── */
.toolCol {
  min-width: 80px;
}
.toolCurrent {
  font-family: var(--font-mono);
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  color: var(--active-tool);
}
.toolInput {
  width: 60px;
}
.toolBtns {
  display: flex;
  gap: var(--gap-tight);
}

/* ── Macros ── */
.macroBtns {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  max-height: 120px;
  overflow-y: auto;
}
</style>
