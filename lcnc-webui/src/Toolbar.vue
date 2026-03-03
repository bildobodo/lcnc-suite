<template>
  <div class="viewerContainer">
    <div class="viewerSlot">
      <slot />
    </div>

    <!-- Floating toolbar overlay (bottom-left) -->
    <div class="floatingBar">

      <!-- Views pill -->
      <div class="toolPill">
        <button class="pillLabel">Views</button>
        <div class="popover pillPopover">
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
          <div class="sep"></div>
          <div class="projRow">
            <button class="viewBtn" :class="{ active: !isOrtho }" @click="isOrtho && toggleProjection()">Perspective</button>
            <button class="viewBtn" :class="{ active: isOrtho }" @click="!isOrtho && toggleProjection()">Parallel</button>
          </div>
        </div>
      </div>

      <!-- Layers pill -->
      <div class="toolPill">
        <button class="pillLabel">Layers</button>
        <div class="popover pillPopover">
          <label><input type="checkbox" v-model="local.backplot" @change="emitToggle('backplot')" /> Backplot</label>
          <label><input type="checkbox" v-model="local.toolpath" @change="emitToggle('toolpath')" /> Toolpath</label>
          <label><input type="checkbox" v-model="local.machine"  @change="emitToggle('machine')"  /> Machine</label>
          <label><input type="checkbox" v-model="local.workpiece" @change="emitToggle('workpiece')" /> Workpiece</label>
          <label><input type="checkbox" v-model="local.bounds" @change="emitToggle('bounds')" /> Bounds</label>
          <label><input type="checkbox" v-model="local.workzero" @change="emitToggle('workzero')" /> Work Zero</label>
          <label><input type="checkbox" v-model="local.hud" @change="emitToggle('hud')" /> HUD</label>
          <label><input type="checkbox" v-model="local.surface" @change="emitToggle('surface')" /> Surface</label>
        </div>
      </div>

      <!-- Toolpath pill -->
      <div class="toolPill">
        <button class="pillLabel">Toolpath</button>
        <div class="popover pillPopover">
          <button class="viewBtn" @click="$emit('resetBackplot')">Clear Backplot</button>
          <div class="sep"></div>
          <label><input type="checkbox" v-model="pathOnTop" @change="$emit('setPathOnTop', pathOnTop)" /> Always on top</label>
        </div>
      </div>

      <!-- Tracking pill -->
      <div class="toolPill">
        <button class="pillLabel">Tracking</button>
        <div class="popover pillPopover">
          <button class="viewBtn" :class="{ active: trackMode === 'none' }" @click="setTrack('none')">None</button>
          <button class="viewBtn" :class="{ active: trackMode === 'tool' }" @click="setTrack('tool')">Tool</button>
          <button class="viewBtn" :class="{ active: trackMode === 'workpiece' }" @click="setTrack('workpiece')">Workpiece</button>
        </div>
      </div>

      <!-- Workpiece pill -->
      <div class="toolPill">
        <button class="pillLabel">Workpiece</button>
        <div class="popover pillPopover wpPopover">
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
          <div class="sep"></div>
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
import { loadViewerDefaults, type Vec3, type Layer, type TrackMode } from "./defaults";

type ViewPreset = "top" | "bottom" | "left" | "right" | "front" | "back" | "iso" | "dimetric" | "reset";

const vd = loadViewerDefaults();

const props = defineProps<{
  workpieceSize: Vec3;
  workpieceOffset: Vec3;
}>();

const emit = defineEmits<{
  (e: "resetBackplot"): void;
  (e: "setView", preset: ViewPreset): void;
  (e: "toggleLayer", layer: Layer, on: boolean): void;
  (e: "update:workpieceSize", value: Vec3): void;
  (e: "update:workpieceOffset", value: Vec3): void;
  (e: "setPathOnTop", on: boolean): void;
  (e: "setTrackMode", mode: string): void;
  (e: "toggleProjection"): void;
}>();

const pathOnTop = ref(vd.pathOnTop);
const isOrtho = ref(vd.projection === "parallel");

function toggleProjection() {
  isOrtho.value = !isOrtho.value;
  emit("toggleProjection");
}

const trackMode = ref<TrackMode>(vd.trackingMode);

function setTrack(mode: TrackMode) {
  trackMode.value = mode;
  emit("setTrackMode", mode);
}

const local = reactive<Record<Layer, boolean>>({ ...vd.layers });

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
  font-size: var(--fs-sm);
  font-weight: 600;
  user-select: none;
  opacity: 0.75;
}

.toolPill:hover > .pillLabel {
  opacity: 1;
  background: var(--panel);
}

/* ---- Popovers ---- */
.pillPopover {
  bottom: 100%;
  left: 0;
  padding: 8px 8px 14px 8px;
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
  font-size: var(--fs-base);
  border-radius: var(--radius-md);
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

.projRow {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

/* ---- Layer checkboxes ---- */
.pillPopover label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-base);
  color: var(--fg);
  cursor: pointer;
  user-select: none;
  padding: 3px 4px;
  border-radius: var(--radius-md);
}

.pillPopover label:hover {
  background: color-mix(in oklab, var(--fg) 12%, var(--button-bg));
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
  font-size: var(--fs-sm);
  color: var(--fg);
  opacity: 0.6;
  min-width: 52px;
}

.numInput {
  flex: 1;
  padding: 4px 6px;
  font-size: var(--fs-sm);
  border-radius: var(--radius-md);
  max-width: 72px;
}

.sep {
  margin: 4px 0;
}
</style>
