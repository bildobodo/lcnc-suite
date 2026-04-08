<template>
  <div class="viewerContainer">
    <div class="viewerSlot">
      <slot />
    </div>

    <!-- Floating toolbar overlay (bottom-left) -->
    <div class="floatingBar">

      <!-- Views pill -->
      <div class="toolPill">
        <MachineBtn type="tab" :selected="openPill === 'views'" @click.stop="togglePill('views')">Views</MachineBtn>
        <div class="popover pillPopover" :class="{ open: openPill === 'views' }" @click.stop>
          <div class="popTitle">Views</div>
          <div class="viewGrid">
            <MachineBtn type="viewPreset" @click="$emit('setView', 'top')">Top</MachineBtn>
            <MachineBtn type="viewPreset" @click="$emit('setView', 'bottom')">Bottom</MachineBtn>
            <MachineBtn type="viewPreset" @click="$emit('setView', 'front')">Front</MachineBtn>
            <MachineBtn type="viewPreset" @click="$emit('setView', 'back')">Back</MachineBtn>
            <MachineBtn type="viewPreset" @click="$emit('setView', 'left')">Left</MachineBtn>
            <MachineBtn type="viewPreset" @click="$emit('setView', 'right')">Right</MachineBtn>
            <MachineBtn type="viewPreset" class="wide" @click="$emit('setView', 'dimetric')">Dimetric</MachineBtn>
            <MachineBtn type="viewPreset" class="wide" @click="$emit('setView', 'reset')">Reset</MachineBtn>
          </div>
          <div class="sep"></div>
          <div class="radioGroup inline">
            <label><MachineRadio gate="viewerSetting" name="projection" value="perspective" v-model="projectionModel" /> Perspective</label>
            <label><MachineRadio gate="viewerSetting" name="projection" value="parallel" v-model="projectionModel" /> Parallel</label>
          </div>
        </div>
      </div>

      <!-- Layers pill -->
      <div class="toolPill">
        <MachineBtn type="tab" :selected="openPill === 'layers'" @click.stop="togglePill('layers')">Layers</MachineBtn>
        <div class="popover pillPopover" :class="{ open: openPill === 'layers' }" @click.stop>
          <div class="popTitle">Layers</div>
          <MachineToggle gate="viewerSetting" v-model="local.backplot" label="Backplot" />
          <MachineToggle gate="viewerSetting" v-model="local.toolpath" label="Toolpath" />
          <MachineToggle gate="viewerSetting" v-model="local.machine" label="Machine" />
          <MachineToggle gate="viewerSetting" v-model="local.workpiece" label="Workpiece" />
          <MachineToggle gate="viewerSetting" v-model="local.bounds" label="Bounds" />
          <MachineToggle gate="viewerSetting" v-model="local.workzero" label="Work Zero" />
          <MachineToggle gate="viewerSetting" v-model="local.hud" label="HUD" />
          <MachineToggle gate="viewerSetting" v-model="local.surface" label="Surface" />
        </div>
      </div>

      <!-- Toolpath pill -->
      <div class="toolPill">
        <MachineBtn type="tab" :selected="openPill === 'toolpath'" @click.stop="togglePill('toolpath')">Toolpath</MachineBtn>
        <div class="popover pillPopover" :class="{ open: openPill === 'toolpath' }" @click.stop>
          <div class="popTitle">Toolpath</div>
          <MachineBtn type="viewPreset" @click="$emit('resetBackplot')">Clear Backplot</MachineBtn>
          <div class="sep"></div>
          <MachineToggle gate="viewerSetting" v-model="pathOnTop" label="Always on top" />
        </div>
      </div>

      <!-- Tracking pill -->
      <div class="toolPill">
        <MachineBtn type="tab" :selected="openPill === 'tracking'" @click.stop="togglePill('tracking')">Tracking</MachineBtn>
        <div class="popover pillPopover" :class="{ open: openPill === 'tracking' }" @click.stop>
          <div class="popTitle">Tracking</div>
          <div class="radioGroup">
            <label><MachineRadio gate="viewerSetting" name="tracking" value="none" v-model="trackMode" /> None</label>
            <label><MachineRadio gate="viewerSetting" name="tracking" value="tool" v-model="trackMode" /> Tool</label>
            <label><MachineRadio gate="viewerSetting" name="tracking" value="workpiece" v-model="trackMode" /> Workpiece</label>
          </div>
        </div>
      </div>

      <!-- Workpiece pill -->
      <div class="toolPill">
        <MachineBtn type="tab" :selected="openPill === 'workpiece'" @click.stop="togglePill('workpiece')">Workpiece</MachineBtn>
        <div class="popover pillPopover wpPopover" :class="{ open: openPill === 'workpiece' }" @click.stop>
          <div class="popTitle">Workpiece</div>
          <div class="inputRow">
            <label class="inputLabel">Size X</label>
            <MachineInput gate="viewerSettingNum" type="number" class="numInput" v-model.number="localSize[0]"
              @change="commitSize(0)" :step="STEP_DEFAULT" min="0" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Size Y</label>
            <MachineInput gate="viewerSettingNum" type="number" class="numInput" v-model.number="localSize[1]"
              @change="commitSize(1)" :step="STEP_DEFAULT" min="0" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Size Z</label>
            <MachineInput gate="viewerSettingNum" type="number" class="numInput" v-model.number="localSize[2]"
              @change="commitSize(2)" :step="STEP_DEFAULT" min="0" max="9999" />
          </div>
          <div class="sep"></div>
          <div class="inputRow">
            <label class="inputLabel">Offset X</label>
            <MachineInput gate="viewerSettingNum" type="number" class="numInput" v-model.number="localOffset[0]"
              @change="commitOffset(0)" :step="STEP_DEFAULT" min="-9999" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Offset Y</label>
            <MachineInput gate="viewerSettingNum" type="number" class="numInput" v-model.number="localOffset[1]"
              @change="commitOffset(1)" :step="STEP_DEFAULT" min="-9999" max="9999" />
          </div>
          <div class="inputRow">
            <label class="inputLabel">Offset Z</label>
            <MachineInput gate="viewerSettingNum" type="number" class="numInput" v-model.number="localOffset[2]"
              @change="commitOffset(2)" :step="STEP_DEFAULT" min="-9999" max="9999" />
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineRadio from "./MachineRadio.vue";
import MachineToggle from "./MachineToggle.vue";
import { loadViewerDefaults, settingsVersion, STEP_DEFAULT, type Vec3, type Layer, type TrackMode } from "./defaults";

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
const projectionModel = ref<string>(vd.projection === "parallel" ? "parallel" : "perspective");

// Emit pathOnTop changes (MachineToggle uses v-model, no @change)
watch(pathOnTop, (val) => emit("setPathOnTop", val));

// Sync projection when radio model changes (from user click)
watch(projectionModel, (val) => {
  const wantOrtho = val === "parallel";
  if (wantOrtho !== isOrtho.value) {
    isOrtho.value = wantOrtho;
    emit("toggleProjection");
  }
});

const trackMode = ref<TrackMode>(vd.trackingMode);

// Emit trackMode changes (MachineRadio uses v-model, no @change)
watch(trackMode, (val) => emit("setTrackMode", val));

const local = reactive<Record<Layer, boolean>>({ ...vd.layers });
const _prevLocal = { ...vd.layers };

function emitToggle(layer: Layer) {
  emit("toggleLayer", layer, local[layer]);
}

// Watch for layer toggle changes (MachineToggle uses v-model, no @change)
watch(local, () => {
  for (const key of Object.keys(local) as Layer[]) {
    if (local[key] !== _prevLocal[key]) {
      _prevLocal[key] = local[key];
      emitToggle(key);
    }
  }
});

// Re-sync local state when server settings change (multi-client or page refresh)
watch(settingsVersion, () => {
  const fresh = loadViewerDefaults();
  Object.assign(local, fresh.layers);
  pathOnTop.value = fresh.pathOnTop;
  isOrtho.value = fresh.projection === "parallel";
  projectionModel.value = fresh.projection === "parallel" ? "parallel" : "perspective";
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

// Click-to-toggle popovers
const openPill = ref<string | null>(null);

function togglePill(name: string) {
  openPill.value = openPill.value === name ? null : name;
}

// Close popover on click outside
function onDocClick() { openPill.value = null; }
onMounted(() => document.addEventListener("click", onDocClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocClick));


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
  padding: var(--gap-tight);
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
  max-width: 72px;
}

.sep {
  margin: var(--gap-tight) 0;
}
</style>
