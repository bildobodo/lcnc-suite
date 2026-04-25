<template>
  <div class="viewerContainer">
    <div class="viewerSlot">
      <slot />
    </div>

    <!-- Floating toolbar overlay (bottom-left) -->
    <div class="floatingBar">

      <!-- Projection pill -->
      <div class="toolPill">
        <MachineBtn type="tab" :selected="openPill === 'projection'" @click.stop="togglePill('projection')">Projection</MachineBtn>
        <div class="popover pillPopover" :class="{ open: openPill === 'projection' }" @click.stop>
          <div class="popTitle">Projection</div>
          <div class="radioGroup inline">
            <label><MachineRadio gate="viewerSetting" name="projection" value="perspective" v-model="projectionModel" /> Perspective</label>
            <label><MachineRadio gate="viewerSetting" name="projection" value="parallel" v-model="projectionModel" /> Parallel</label>
          </div>
        </div>
      </div>

      <!-- Layers pill -->
      <div class="toolPill">
        <MachineBtn type="tab" :selected="openPill === 'layers'" @click.stop="togglePill('layers')">Layers</MachineBtn>
        <div class="popover pillPopover layersPopover" :class="{ open: openPill === 'layers' }" @click.stop>
          <div class="popTitle">Layers</div>
          <MachineToggle gate="viewerSetting" v-model="local.backplot" label="Backplot" />
          <MachineToggle gate="viewerSetting" v-model="local.toolpath" label="Toolpath" />
          <MachineToggle gate="viewerSetting" v-model="local.workzero" label="Work Zero" />
          <MachineToggle gate="viewerSetting" v-model="local.surface" label="Surface" />
          <div class="sep"></div>
          <MachineToggle gate="viewerSetting" v-model="local.toolpathBounds" label="Toolpath Bounds" />
          <MachineToggle gate="viewerSetting" v-model="local.workpiece" label="Stock Bounds" />
          <MachineToggle gate="viewerSetting" v-model="local.bounds" label="Machine Bounds" />
          <div class="sep"></div>
          <MachineToggle gate="viewerSetting" v-model="local.machine" label="Machine" />
          <MachineToggle gate="viewerSetting" v-model="local.hud" label="HUD" />
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

      <!-- Camera pill -->
      <div class="toolPill">
        <MachineBtn type="tab" :selected="showCamera || openPill === 'camera'" @click.stop="togglePill('camera')">Camera</MachineBtn>
        <div class="popover pillPopover camPopover" :class="{ open: openPill === 'camera' }" @click.stop>
          <div class="popTitle">Camera</div>
          <MachineToggle gate="cameraSetting" v-model="showCamera" @update:modelValue="onToggleCamera" label="Show PIP" />
          <div class="sep"></div>
          <div class="popTitle">Overlays</div>
          <MachineToggle gate="cameraSetting" v-model="camShowCrosshair" @update:modelValue="saveCamTracked" label="Crosshair" />
          <MachineToggle gate="cameraSetting" v-model="camShowCircle" @update:modelValue="saveCamTracked" label="Circle" />
          <MachineToggle gate="cameraSetting" v-model="camShowGrid" @update:modelValue="saveCamTracked" label="Grid" />
          <div class="sep"></div>
          <div class="inputRow">
            <span class="inputLabel">Radius</span>
            <MachineInput gate="cameraSetting" type="number" class="numInput" v-model.number="camCircleRadius" min="10" max="300" :step="1" @change="saveCamTracked" />
          </div>
          <div class="inputRow">
            <span class="inputLabel">Grid</span>
            <MachineInput gate="cameraSetting" type="number" class="numInput" v-model.number="camGridSpacing" min="10" max="200" :step="1" @change="saveCamTracked" />
          </div>
          <div class="sep"></div>
          <div class="inputRow">
            <span class="inputLabel">Opacity</span>
            <MachineSlider gate="cameraSetting" class="camSlider" :min="0" :max="1" :step="0.05" v-model="camOverlayOpacity" @update:modelValue="saveCamTracked" />
          </div>
          <div class="inputRow">
            <span class="inputLabel">Color</span>
            <MachineColor gate="cameraSetting" v-model="camOverlayColor" @update:modelValue="saveCamTracked" class="camColor" />
          </div>
        </div>
      </div>

    </div>

    <!-- Camera PIP window -->
    <CameraPip :visible="showCamera" @close="closeCamera" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineRadio from "./MachineRadio.vue";
import MachineToggle from "./MachineToggle.vue";
import MachineSlider from "./MachineSlider.vue";
import MachineColor from "./MachineColor.vue";
import CameraPip from "./CameraPip.vue";
import { loadViewerDefaults, loadCameraDefaults, saveCameraDefaults, settingsVersion, STEP_DEFAULT, type Vec3, type Layer, type TrackMode } from "./defaults";

const vd = loadViewerDefaults();

const props = defineProps<{
  workpieceSize: Vec3;
  workpieceOffset: Vec3;
}>();

const emit = defineEmits<{
  (e: "resetBackplot"): void;
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

// ─── Camera PIP ──────────────────────────────────────────────
const cameraAvailable = ref(false);
const showCamera = ref(loadCameraDefaults().pipVisible);

// Camera overlay settings (managed in Camera pill popover)
const camDefs = loadCameraDefaults();
const camShowCrosshair = ref(camDefs.showCrosshair);
const camShowCircle = ref(camDefs.showCircle);
const camShowGrid = ref(camDefs.showGrid);
const camCircleRadius = ref(camDefs.circleRadius);
const camGridSpacing = ref(camDefs.gridSpacing);
const camOverlayOpacity = ref(camDefs.overlayOpacity);
const camOverlayColor = ref(camDefs.overlayColor);

function saveCam() {
  const cur = loadCameraDefaults();
  saveCameraDefaults({
    ...cur,
    showCrosshair: camShowCrosshair.value,
    showCircle: camShowCircle.value,
    showGrid: camShowGrid.value,
    circleRadius: camCircleRadius.value,
    gridSpacing: camGridSpacing.value,
    overlayOpacity: camOverlayOpacity.value,
    overlayColor: camOverlayColor.value,
  });
}

// Re-sync camera overlay settings from server (multi-client only).
// Skip settingsVersion bumps caused by our own saves to avoid reset loops.
let _camSkipNext = 0;

function saveCamTracked() {
  _camSkipNext++;
  saveCam();
}

watch(settingsVersion, () => {
  if (_camSkipNext > 0) { _camSkipNext--; return; }
  const u = loadCameraDefaults();
  camShowCrosshair.value = u.showCrosshair;
  camShowCircle.value = u.showCircle;
  camShowGrid.value = u.showGrid;
  camCircleRadius.value = u.circleRadius;
  camGridSpacing.value = u.gridSpacing;
  camOverlayOpacity.value = u.overlayOpacity;
  camOverlayColor.value = u.overlayColor;
  showCamera.value = u.pipVisible;
});

function onToggleCamera() {
  _camSkipNext++;
  const cur = loadCameraDefaults();
  saveCameraDefaults({ ...cur, pipVisible: showCamera.value });
}

function closeCamera() {
  showCamera.value = false;
  _camSkipNext++;
  const cur = loadCameraDefaults();
  saveCameraDefaults({ ...cur, pipVisible: false });
}

onMounted(async () => {
  try {
    const res = await fetch("/camera/status");
    const data = await res.json();
    cameraAvailable.value = data.available === true;
  } catch {
    cameraAvailable.value = false;
  }
});
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

/* ---- Layers popover: 2-column grid ---- */
.layersPopover.open {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: var(--gap-controls);
  row-gap: var(--gap-tight);
}
.layersPopover .popTitle,
.layersPopover .sep {
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

/* ---- Camera pill ---- */
.camPopover {
  min-width: 180px;
}

.camSlider {
  flex: 1;
  max-width: 80px;
}

.camColor {
  width: 28px;
  height: 28px;
}
</style>
