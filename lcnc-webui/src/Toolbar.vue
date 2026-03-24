<template>
  <div class="viewerContainer">
    <div class="viewerSlot">
      <slot />
    </div>

    <!-- Floating toolbar overlay (bottom-left) -->
    <Gate :allow="can.idle" class="floatingBar">

      <!-- Views pill -->
      <div class="toolPill">
        <Btn size="sm" muted :selected="openPill === 'views'" @click.stop="togglePill('views')">Views</Btn>
        <div class="popover pillPopover" :class="{ open: openPill === 'views' }" @click.stop>
          <div class="popHeader"><span class="popTitle">Views</span><Btn icon @click="openPill = null">&times;</Btn></div>
          <div class="viewGrid">
            <Btn size="sm" @click="$emit('setView', 'top')">Top</Btn>
            <Btn size="sm" @click="$emit('setView', 'bottom')">Bottom</Btn>
            <Btn size="sm" @click="$emit('setView', 'front')">Front</Btn>
            <Btn size="sm" @click="$emit('setView', 'back')">Back</Btn>
            <Btn size="sm" @click="$emit('setView', 'left')">Left</Btn>
            <Btn size="sm" @click="$emit('setView', 'right')">Right</Btn>
            <Btn size="sm" class="wide" @click="$emit('setView', 'dimetric')">Dimetric</Btn>
            <Btn size="sm" class="wide" @click="$emit('setView', 'reset')">Reset</Btn>
          </div>
          <div class="sep"></div>
          <div class="radioGroup inline">
            <label><input type="radio" :checked="!isOrtho" @change="isOrtho && toggleProjection()" /> Perspective</label>
            <label><input type="radio" :checked="isOrtho" @change="!isOrtho && toggleProjection()" /> Parallel</label>
          </div>
        </div>
      </div>

      <!-- Layers pill -->
      <div class="toolPill">
        <Btn size="sm" muted :selected="openPill === 'layers'" @click.stop="togglePill('layers')">Layers</Btn>
        <div class="popover pillPopover" :class="{ open: openPill === 'layers' }" @click.stop>
          <div class="popHeader"><span class="popTitle">Layers</span><Btn icon @click="openPill = null">&times;</Btn></div>
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
        <Btn size="sm" muted :selected="openPill === 'toolpath'" @click.stop="togglePill('toolpath')">Toolpath</Btn>
        <div class="popover pillPopover" :class="{ open: openPill === 'toolpath' }" @click.stop>
          <div class="popHeader"><span class="popTitle">Toolpath</span><Btn icon @click="openPill = null">&times;</Btn></div>
          <Btn size="sm" @click="$emit('resetBackplot')">Clear Backplot</Btn>
          <div class="sep"></div>
          <label class="toggleRow"><input type="checkbox" class="toggle" v-model="pathOnTop" @change="$emit('setPathOnTop', pathOnTop)" /> Always on top</label>
        </div>
      </div>

      <!-- Tracking pill -->
      <div class="toolPill">
        <Btn size="sm" muted :selected="openPill === 'tracking'" @click.stop="togglePill('tracking')">Tracking</Btn>
        <div class="popover pillPopover" :class="{ open: openPill === 'tracking' }" @click.stop>
          <div class="popHeader"><span class="popTitle">Tracking</span><Btn icon @click="openPill = null">&times;</Btn></div>
          <label><input type="radio" :checked="trackMode === 'none'" @change="setTrack('none')" /> None</label>
          <label><input type="radio" :checked="trackMode === 'tool'" @change="setTrack('tool')" /> Tool</label>
          <label><input type="radio" :checked="trackMode === 'workpiece'" @change="setTrack('workpiece')" /> Workpiece</label>
        </div>
      </div>

      <!-- Workpiece pill -->
      <div class="toolPill">
        <Btn size="sm" muted :selected="openPill === 'workpiece'" @click.stop="togglePill('workpiece')">Workpiece</Btn>
        <div class="popover pillPopover wpPopover" :class="{ open: openPill === 'workpiece' }" @click.stop>
          <div class="popHeader"><span class="popTitle">Workpiece</span><Btn icon @click="openPill = null">&times;</Btn></div>
          <div class="inputRow">
            <label class="inputLabel">Size X</label>
            <input type="number" class="numInput" v-model.number="localSize[0]"
              @change="commitSize(0)" :step="STEP_DEFAULT" min="0" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Size Y</label>
            <input type="number" class="numInput" v-model.number="localSize[1]"
              @change="commitSize(1)" :step="STEP_DEFAULT" min="0" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Size Z</label>
            <input type="number" class="numInput" v-model.number="localSize[2]"
              @change="commitSize(2)" :step="STEP_DEFAULT" min="0" max="9999" />
          </div>
          <div class="sep"></div>
          <div class="inputRow">
            <label class="inputLabel">Offset X</label>
            <input type="number" class="numInput" v-model.number="localOffset[0]"
              @change="commitOffset(0)" :step="STEP_DEFAULT" min="-9999" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Offset Y</label>
            <input type="number" class="numInput" v-model.number="localOffset[1]"
              @change="commitOffset(1)" :step="STEP_DEFAULT" min="-9999" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Offset Z</label>
            <input type="number" class="numInput" v-model.number="localOffset[2]"
              @change="commitOffset(2)" :step="STEP_DEFAULT" min="-9999" max="9999" />
          </div>
        </div>
      </div>

    </Gate>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import Btn from "./Btn.vue";
import Gate from "./Gate.vue";
import { usePermissions } from "./permissions";
import { loadViewerDefaults, settingsVersion, STEP_DEFAULT, type Vec3, type Layer, type TrackMode } from "./defaults";

const can = usePermissions();

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

// Re-sync local state when server settings change (multi-client or page refresh)
watch(settingsVersion, () => {
  const fresh = loadViewerDefaults();
  Object.assign(local, fresh.layers);
  pathOnTop.value = fresh.pathOnTop;
  isOrtho.value = fresh.projection === "parallel";
  trackMode.value = fresh.trackingMode;
});

// Local copies so inputs aren't overwritten mid-typing by prop updates
const localSize = reactive([...props.workpieceSize]) as [number, number, number];
const localOffset = reactive([...props.workpieceOffset]) as [number, number, number];
watch(() => props.workpieceSize, s => { for (let i = 0; i < 3; i++) localSize[i] = s[i]!; });
watch(() => props.workpieceOffset, o => { for (let i = 0; i < 3; i++) localOffset[i] = o[i]!; });

function commitSize(axis: number) {
  const value = localSize[axis]!;
  if (isNaN(value) || value < 0) return;
  emit("update:workpieceSize", [...localSize] as Vec3);

  if (axis === 2) {
    localOffset[2] = -value;
    emit("update:workpieceOffset", [...localOffset] as Vec3);
  }
}

function commitOffset(axis: number) {
  if (isNaN(localOffset[axis]!)) return;
  emit("update:workpieceOffset", [...localOffset] as Vec3);
}

// Click-to-toggle popovers (matching sidebar pattern)
const openPill = ref<string | null>(null);

function togglePill(name: string) {
  openPill.value = openPill.value === name ? null : name;
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
  flex-direction: row;
  gap: var(--gap-tight);
  z-index: 20;
}

.toolPill {
  position: relative;
  cursor: default;
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

.wide {
  grid-column: 1 / -1;
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
