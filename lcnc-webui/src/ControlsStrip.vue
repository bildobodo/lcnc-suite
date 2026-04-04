<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from "vue";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineSlider from "./MachineSlider.vue";
import MachineInput from "./MachineInput.vue";
import MachineToggle from "./MachineToggle.vue";
import ToolPreview from "./ToolPreview.vue";
import { RotateCw, RotateCcw, Square } from "lucide-vue-next";
import { STEP_RPM, STEP_OVERRIDE, STEP_RAPID_OVERRIDE, type MacroDef } from "./defaults";
import { send, lastReply, connected } from "./lcncWs";
import { toolTypeLabel } from "./toolTypes";
import { fmtRpm } from "./format";

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

// formatRpm → fmtRpm imported from format.ts

function onFeedSlider(v: number) { emit('update:feedSlider', v); }
function onSpindleSlider(v: number) { emit('update:spindleSlider', v); }
function onRapidSlider(v: number) { emit('update:rapidSlider', v); }

// ─── Tool table for preview ──────────────────────────────────
const tools = ref<Record<string, any>[]>([]);

function fetchTools() { send({ cmd: "get_tool_table" }); }

watch(lastReply, (reply) => {
  if (reply?.ok && Array.isArray(reply.tools)) {
    tools.value = reply.tools;
  }
}, { flush: "sync" });

onMounted(fetchTools);
watch(connected, (val) => { if (val) setTimeout(fetchTools, 300); });
watch(() => props.currentTool, fetchTools);

const currentToolData = computed(() =>
  tools.value.find(t => t.T === props.currentTool) ?? null
);

const toolTypeLbl = computed(() => toolTypeLabel(currentToolData.value?.type));

// ─── Preview frame sizing ────────────────────────────────────
const previewFrameRef = ref<HTMLElement | null>(null);
const previewSize = reactive({ w: 0, h: 0 });
let _previewRo: ResizeObserver | null = null;

onMounted(() => {
  _previewRo = new ResizeObserver(entries => {
    for (const e of entries) {
      previewSize.h = Math.floor(e.contentRect.height);
      previewSize.w = Math.floor(e.contentRect.width);
    }
  });
  if (previewFrameRef.value) _previewRo.observe(previewFrameRef.value);
});

watch(previewFrameRef, (el, old) => {
  if (old) _previewRo?.unobserve(old);
  if (el) _previewRo?.observe(el);
});

onBeforeUnmount(() => _previewRo?.disconnect());
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
    <div class="rightSection stack-tight">
      <!-- Spindle -->
      <Gate gate="ready" class="spnBlock stack-controls">
        <div class="spDirRow row-tight">
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

        <div class="spActualGroup inset-panel stack-tight">
          <div class="spActualRow">
            <span class="label-muted md">Actual</span>
            <span class="val-status md mono">{{ fmtRpm(spindleActual) }}</span>
          </div>
          <div class="spActualRow">
            <span class="label-muted md">Cmd</span>
            <span class="val-status md mono muted">{{ fmtRpm(spindleSpeed) }}</span>
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
      <div class="toolControls stack-controls">
        <div class="toolInputRow row-tight">
          <span class="label-muted md toolLabel">Tool #</span>
          <MachineInput gate="rpmInput" type="number" class="toolNumInput"
            :value="toolNumber"
            @input="emit('update:toolNumber', +($event.target as HTMLInputElement).value)"
            @change="emit('saveToolNumber')"
            :min="1" />
          <MachineBtn type="mdi" :disabled="probing" @click="emit('loadTool')">Load</MachineBtn>
          <MachineBtn type="toolUnload" :disabled="probing" @click="emit('unloadTool')">Unload</MachineBtn>
        </div>

        <div class="toolActionRow row-tight">
          <MachineBtn type="mdi" :disabled="probing" @click="emit('measureAuto')">Measure</MachineBtn>
          <MachineBtn type="manage" @click="emit('openToolTable')">Table</MachineBtn>
        </div>

        <div class="toolStats inset-panel">
          <div class="spActualRow">
            <span class="label-muted md">Current Tool</span>
            <span class="val-status md mono">T{{ currentTool }}</span>
          </div>
          <div class="spActualRow">
            <span class="label-muted md">Pocket</span>
            <span class="val-status md mono">{{ currentToolData?.P ?? '---' }}</span>
          </div>
          <div class="spActualRow">
            <span class="label-muted md">Diameter</span>
            <span class="val-status md mono">{{ toolDiameter != null ? toolDiameter.toFixed(3) : '---' }}</span>
          </div>
          <div class="spActualRow">
            <span class="label-muted md">Z Offset</span>
            <span class="val-status md mono">{{ toolLength != null ? toolLength.toFixed(3) : '---' }}</span>
          </div>
          <div class="spActualRow">
            <span class="label-muted md">Type</span>
            <span class="val-status md">{{ toolTypeLbl }}</span>
          </div>
          <div class="spActualRow">
            <span class="label-muted md">Description</span>
            <span class="val-status md toolDesc">{{ currentToolData?.description || '---' }}</span>
          </div>
        </div>
      </div>

      <div v-if="currentToolData && currentTool > 0" ref="previewFrameRef" class="toolPreviewFrame inset-panel">
        <ToolPreview v-if="previewSize.w > 0"
          :diameter="currentToolData.D || 0"
          :length="Math.abs(currentToolData.Z) || 0"
          :fluteLength="currentToolData.flute_length || Math.abs(currentToolData.Z || 0) * 0.6"
          :shaftDiameter="currentToolData.shoulder_diameter || undefined"
          :toolType="currentToolData.type || undefined"
          :cornerRadius="currentToolData.corner_radius || undefined"
          :taperAngle="currentToolData.taper_angle || undefined"
          :pointAngle="currentToolData.point_angle || undefined"
          :tipDiameter="currentToolData.tip_diameter || undefined"
          :bodyLength="currentToolData.body_length || undefined"
          :width="previewSize.w" :height="previewSize.h"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.controlsStrip {
  display: flex;
  gap: var(--gap-controls);
  height: 100%;
  flex: 1;
  min-width: 0;
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
  border-left: 1px solid var(--border-subtle);
  padding-left: var(--gap-controls);
}

/* Spindle */
.spnBlock {
  flex: 1;
}
.spRpmRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
}
.spRpmInput { flex: 1; }
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
  flex: 1;
  min-width: 0;
  gap: var(--gap-controls);
  border-left: 1px solid var(--border-subtle);
  padding-left: var(--gap-controls);
  align-items: stretch;
}

.toolPreviewFrame {
  align-self: stretch;
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: var(--gap-controls);
}

.toolInputRow {
  align-items: stretch;
}

.toolLabel {
  align-self: center;
}

.toolNumInput {
  width: 60px;
}

.toolActionRow {
}

.toolActionRow :deep(.b) {
  flex: 1;
}

.toolStats {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  flex: 1;
}

.toolDesc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
</style>
