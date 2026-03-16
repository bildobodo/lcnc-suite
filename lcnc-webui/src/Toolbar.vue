<template>
  <div class="viewerContainer">
    <div class="viewerSlot">
      <slot />
    </div>

    <!-- Floating toolbar overlay (bottom-left) -->
    <div class="floatingBar">

      <!-- Views pill -->
      <div class="toolPill">
        <button class="pillLabel" :class="{ active: openPill === 'views' }" @click.stop="togglePill('views')">Views</button>
        <div class="popover pillPopover" :class="{ open: openPill === 'views' }" @click.stop>
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
        <button class="pillLabel" :class="{ active: openPill === 'layers' }" @click.stop="togglePill('layers')">Layers</button>
        <div class="popover pillPopover" :class="{ open: openPill === 'layers' }" @click.stop>
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
        <button class="pillLabel" :class="{ active: openPill === 'toolpath' }" @click.stop="togglePill('toolpath')">Toolpath</button>
        <div class="popover pillPopover" :class="{ open: openPill === 'toolpath' }" @click.stop>
          <button class="viewBtn" @click="$emit('resetBackplot')">Clear Backplot</button>
          <div class="sep"></div>
          <label><input type="checkbox" v-model="pathOnTop" @change="$emit('setPathOnTop', pathOnTop)" /> Always on top</label>
        </div>
      </div>

      <!-- Tracking pill -->
      <div class="toolPill">
        <button class="pillLabel" :class="{ active: openPill === 'tracking' }" @click.stop="togglePill('tracking')">Tracking</button>
        <div class="popover pillPopover" :class="{ open: openPill === 'tracking' }" @click.stop>
          <button class="viewBtn" :class="{ active: trackMode === 'none' }" @click="setTrack('none')">None</button>
          <button class="viewBtn" :class="{ active: trackMode === 'tool' }" @click="setTrack('tool')">Tool</button>
          <button class="viewBtn" :class="{ active: trackMode === 'workpiece' }" @click="setTrack('workpiece')">Workpiece</button>
        </div>
      </div>

      <!-- Workpiece pill -->
      <div class="toolPill">
        <button class="pillLabel" :class="{ active: openPill === 'workpiece' }" @click.stop="togglePill('workpiece')">Workpiece</button>
        <div class="popover pillPopover wpPopover" :class="{ open: openPill === 'workpiece' }" @click.stop>
          <div class="inputRow">
            <label class="inputLabel">Size X</label>
            <input type="number" class="numInput" :value="workpieceSize[0]"
              @input="updateSize(0, parseFloat(($event.target as HTMLInputElement).value))"
              :step="STEP_DEFAULT" min="0" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Size Y</label>
            <input type="number" class="numInput" :value="workpieceSize[1]"
              @input="updateSize(1, parseFloat(($event.target as HTMLInputElement).value))"
              :step="STEP_DEFAULT" min="0" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Size Z</label>
            <input type="number" class="numInput" :value="workpieceSize[2]"
              @input="updateSize(2, parseFloat(($event.target as HTMLInputElement).value))"
              :step="STEP_DEFAULT" min="0" max="9999" />
          </div>
          <div class="sep"></div>
          <div class="inputRow">
            <label class="inputLabel">Offset X</label>
            <input type="number" class="numInput" :value="workpieceOffset[0]"
              @input="updateOffset(0, parseFloat(($event.target as HTMLInputElement).value))"
              :step="STEP_DEFAULT" min="-9999" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Offset Y</label>
            <input type="number" class="numInput" :value="workpieceOffset[1]"
              @input="updateOffset(1, parseFloat(($event.target as HTMLInputElement).value))"
              :step="STEP_DEFAULT" min="-9999" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Offset Z</label>
            <input type="number" class="numInput" :value="workpieceOffset[2]"
              @input="updateOffset(2, parseFloat(($event.target as HTMLInputElement).value))"
              :step="STEP_DEFAULT" min="-9999" max="9999" />
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from "vue";
import { loadViewerDefaults, STEP_DEFAULT, type Vec3, type Layer, type TrackMode } from "./defaults";

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

// Click-to-toggle popovers (matching sidebar pattern)
const openPill = ref<string | null>(null);

function togglePill(name: string) {
  openPill.value = openPill.value === name ? null : name;
}

function onClickOutside(e: MouseEvent) {
  const bar = document.querySelector(".floatingBar");
  if (bar && !bar.contains(e.target as Node)) openPill.value = null;
}

onMounted(() => document.addEventListener("click", onClickOutside));
onUnmounted(() => document.removeEventListener("click", onClickOutside));
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
  gap: var(--gap-tight);
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
  font-weight: var(--fw-semibold);
  user-select: none;
  opacity: var(--opacity-muted);
}

.pillLabel.active {
  opacity: 1;
  background: var(--panel);
}

/* ---- Popovers ---- */
.pillPopover {
  bottom: 100%;
  left: 0;
  margin-bottom: var(--gap-tight);
  padding: 8px 8px 14px 8px;
}

.pillPopover.open {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
}

/* ---- View buttons grid ---- */
.viewGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap-tight);
}

.viewBtn {
  padding: 6px 10px;
  font-size: var(--fs-base);
  border-radius: var(--radius-md);
  white-space: nowrap;
}

.viewBtn.active {
  background: var(--hl-selected);
  font-weight: var(--fw-semibold);
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

.viewBtn.wide {
  grid-column: 1 / -1;
}

.projRow {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap-tight);
}

/* ---- Layer checkboxes ---- */
.pillPopover label {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  font-size: var(--fs-base);
  color: var(--fg);
  cursor: pointer;
  user-select: none;
  padding: 3px 4px;
  border-radius: var(--radius-md);
}

.pillPopover label:hover {
  background: var(--hl-hover);
}

/* ---- Workpiece inputs ---- */
.wpPopover {
  min-width: 180px;
}

.inputRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  justify-content: space-between;
}

.inputLabel {
  font-size: var(--fs-sm);
  color: var(--fg);
  opacity: var(--opacity-muted);
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
  margin: var(--gap-tight) 0;
}
</style>
