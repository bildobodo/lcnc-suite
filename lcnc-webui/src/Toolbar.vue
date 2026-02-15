<template>
  <div class="viewerContainer">
    <div class="viewerSlot">
      <slot />
    </div>

    <!-- Floating toolbar overlay (bottom-left) -->
    <div class="floatingBar">

      <!-- Views pill -->
      <div class="toolPill">
        <span class="pillLabel">Views</span>
        <div class="pillPopover">
          <div class="viewGrid">
            <button class="viewBtn" @click="$emit('setView', 'top')">Top</button>
            <button class="viewBtn" @click="$emit('setView', 'bottom')">Bottom</button>
            <button class="viewBtn" @click="$emit('setView', 'front')">Front</button>
            <button class="viewBtn" @click="$emit('setView', 'back')">Back</button>
            <button class="viewBtn" @click="$emit('setView', 'left')">Left</button>
            <button class="viewBtn" @click="$emit('setView', 'right')">Right</button>
            <button class="viewBtn wide" @click="$emit('setView', 'dimetric')">Dimetric</button>
            <button class="viewBtn wide" @click="$emit('setView', 'reset')">Reset</button>
          </div>
        </div>
      </div>

      <!-- Layers pill -->
      <div class="toolPill">
        <span class="pillLabel">Layers</span>
        <div class="pillPopover">
          <label><input type="checkbox" v-model="local.backplot" @change="emitToggle('backplot')" /> Backplot</label>
          <label><input type="checkbox" v-model="local.toolpath" @change="emitToggle('toolpath')" /> Toolpath</label>
          <label><input type="checkbox" v-model="local.machine"  @change="emitToggle('machine')"  /> Machine</label>
          <label><input type="checkbox" v-model="local.workpiece" @change="emitToggle('workpiece')" /> Workpiece</label>
          <label><input type="checkbox" v-model="local.bounds" @change="emitToggle('bounds')" /> Bounds</label>
          <label><input type="checkbox" v-model="local.workzero" @change="emitToggle('workzero')" /> Work Zero</label>
          <label><input type="checkbox" v-model="local.hud" @change="emitToggle('hud')" /> HUD</label>
        </div>
      </div>

      <!-- Toolpath pill -->
      <div class="toolPill">
        <span class="pillLabel">Toolpath</span>
        <div class="pillPopover">
          <button class="viewBtn" @click="$emit('resetBackplot')">Clear Backplot</button>
          <div class="popSep"></div>
          <label><input type="checkbox" v-model="pathOnTop" @change="$emit('setPathOnTop', pathOnTop)" /> Always on top</label>
        </div>
      </div>

      <!-- Tracking pill -->
      <div class="toolPill">
        <span class="pillLabel">Tracking</span>
        <div class="pillPopover">
          <button class="viewBtn" :class="{ active: trackMode === 'none' }" @click="setTrack('none')">None</button>
          <button class="viewBtn" :class="{ active: trackMode === 'tool' }" @click="setTrack('tool')">Tool</button>
          <button class="viewBtn" :class="{ active: trackMode === 'workpiece' }" @click="setTrack('workpiece')">Workpiece</button>
        </div>
      </div>

      <!-- Workpiece pill -->
      <div class="toolPill">
        <span class="pillLabel">Workpiece</span>
        <div class="pillPopover wpPopover">
          <div class="inputRow">
            <label class="inputLabel">Size X</label>
            <input type="number" class="numInput" :value="workpieceSize[0]"
              @input="updateSize(0, parseFloat(($event.target as HTMLInputElement).value))"
              step="1" min="0" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Size Y</label>
            <input type="number" class="numInput" :value="workpieceSize[1]"
              @input="updateSize(1, parseFloat(($event.target as HTMLInputElement).value))"
              step="1" min="0" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Size Z</label>
            <input type="number" class="numInput" :value="workpieceSize[2]"
              @input="updateSize(2, parseFloat(($event.target as HTMLInputElement).value))"
              step="1" min="0" max="9999" />
          </div>
          <div class="popSep"></div>
          <div class="inputRow">
            <label class="inputLabel">Offset X</label>
            <input type="number" class="numInput" :value="workpieceOffset[0]"
              @input="updateOffset(0, parseFloat(($event.target as HTMLInputElement).value))"
              step="1" min="-9999" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Offset Y</label>
            <input type="number" class="numInput" :value="workpieceOffset[1]"
              @input="updateOffset(1, parseFloat(($event.target as HTMLInputElement).value))"
              step="1" min="-9999" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Offset Z</label>
            <input type="number" class="numInput" :value="workpieceOffset[2]"
              @input="updateOffset(2, parseFloat(($event.target as HTMLInputElement).value))"
              step="1" min="-9999" max="9999" />
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";

type ViewPreset = "top" | "bottom" | "left" | "right" | "front" | "back" | "iso" | "dimetric" | "reset";
type Layer = "backplot" | "toolpath" | "machine" | "workpiece" | "bounds" | "workzero" | "hud";
type Vec3 = [number, number, number];

const props = defineProps<{
  workpieceSize: Vec3;
  workpieceOffset: Vec3;
  layerDefaults?: Record<Layer, boolean>;
  trackingDefault?: "none" | "tool" | "workpiece";
  pathOnTopDefault?: boolean;
}>();

const emit = defineEmits<{
  (e: "resetBackplot"): void;
  (e: "setView", preset: ViewPreset): void;
  (e: "toggleLayer", layer: Layer, on: boolean): void;
  (e: "update:workpieceSize", value: Vec3): void;
  (e: "update:workpieceOffset", value: Vec3): void;
  (e: "setPathOnTop", on: boolean): void;
  (e: "setTrackMode", mode: string): void;
}>();

const pathOnTop = ref(props.pathOnTopDefault ?? true);

type TrackMode = "none" | "tool" | "workpiece";
const trackMode = ref<TrackMode>(props.trackingDefault ?? "none");

function setTrack(mode: TrackMode) {
  trackMode.value = mode;
  emit("setTrackMode", mode);
}

const local = reactive<Record<Layer, boolean>>({
  backplot: props.layerDefaults?.backplot ?? true,
  toolpath: props.layerDefaults?.toolpath ?? true,
  machine: props.layerDefaults?.machine ?? true,
  workpiece: props.layerDefaults?.workpiece ?? true,
  bounds: props.layerDefaults?.bounds ?? true,
  workzero: props.layerDefaults?.workzero ?? true,
  hud: props.layerDefaults?.hud ?? true,
});

function emitToggle(layer: Layer) {
  emit("toggleLayer", layer, local[layer]);
}

function updateSize(axis: number, value: number) {
  if (isNaN(value) || value < 0) return; // Skip invalid/incomplete/negative input
  const newSize: Vec3 = [...props.workpieceSize] as Vec3;
  newSize[axis] = value;
  emit("update:workpieceSize", newSize);

  // Auto-adjust Z offset to keep zero at top of stock
  if (axis === 2) { // Z axis
    const newOffset: Vec3 = [...props.workpieceOffset] as Vec3;
    newOffset[2] = -value;
    emit("update:workpieceOffset", newOffset);
  }
}

function updateOffset(axis: number, value: number) {
  if (isNaN(value)) return; // Skip invalid/incomplete input
  const newOffset: Vec3 = [...props.workpieceOffset] as Vec3;
  newOffset[axis] = value;
  emit("update:workpieceOffset", newOffset);
}
</script>

<style scoped>
.viewerContainer {
  position: relative;
  width: 100%;
  height: 100%;
}

.viewerSlot {
  width: 100%;
  height: 100%;
}

/* ---- Floating toolbar ---- */
.floatingBar {
  position: absolute;
  bottom: 12px;
  left: 12px;
  display: flex;
  gap: 6px;
  z-index: 20;
}

.toolPill {
  position: relative;
  cursor: default;
}

.pillLabel {
  display: block;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-radius: 6px;
  background: var(--button-bg);
  color: var(--fg);
  border: 1px solid var(--border);
  user-select: none;
  opacity: 0.75;
}

.toolPill:hover > .pillLabel {
  opacity: 1;
  background: var(--panel);
}

/* ---- Popovers ---- */
.pillPopover {
  display: none;
  position: absolute;
  bottom: 100%;
  left: 0;
  padding: 8px 8px 14px 8px;
  border-radius: 8px;
  background: var(--panel);
  border: 1px solid var(--border);
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  z-index: 30;
  min-width: 140px;
}

.toolPill:hover > .pillPopover {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ---- View buttons grid ---- */
.viewGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.viewBtn {
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 4px;
  white-space: nowrap;
}

.viewBtn.active {
  background: color-mix(in oklab, var(--fg) 15%, var(--button-bg));
  font-weight: 600;
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

.viewBtn.wide {
  grid-column: 1 / -1;
}

/* ---- Layer checkboxes ---- */
.pillPopover label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--fg);
  cursor: pointer;
  user-select: none;
  padding: 3px 4px;
  border-radius: 4px;
}

.pillPopover label:hover {
  background: color-mix(in oklab, var(--fg) 10%, var(--button-bg));
}

.pillPopover input[type="checkbox"] {
  cursor: pointer;
}

/* ---- Workpiece inputs ---- */
.wpPopover {
  min-width: 180px;
}

.inputRow {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
}

.inputLabel {
  font-size: 11px;
  color: var(--fg);
  opacity: 0.6;
  min-width: 52px;
}

.numInput {
  flex: 1;
  padding: 4px 6px;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  max-width: 72px;
}

.numInput:focus {
  outline: none;
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
  background: color-mix(in oklab, var(--fg) 10%, var(--button-bg));
}

.popSep {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
</style>
