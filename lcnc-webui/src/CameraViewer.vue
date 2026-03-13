<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { loadCameraDefaults, saveCameraDefaults } from "./defaults";

const props = defineProps<{ active?: boolean }>();

const containerRef = ref<HTMLDivElement | null>(null);
const available = ref(false);
const checking = ref(true);
const width = ref(1280);
const height = ref(720);

// Overlay settings (persisted)
const cd = loadCameraDefaults();
const showCrosshair = ref(cd.showCrosshair);
const showCircle = ref(cd.showCircle);
const showGrid = ref(cd.showGrid);
const circleRadius = ref(cd.circleRadius);
const gridSpacing = ref(cd.gridSpacing);
const overlayOpacity = ref(cd.overlayOpacity);
const overlayColor = ref(cd.overlayColor);

const cx = computed(() => width.value / 2);
const cy = computed(() => height.value / 2);
const gridLines = computed(() => {
  const max = Math.max(width.value, height.value);
  return Math.ceil(max / gridSpacing.value);
});

function saveOverlay() {
  saveCameraDefaults({
    showCrosshair: showCrosshair.value,
    showCircle: showCircle.value,
    showGrid: showGrid.value,
    circleRadius: circleRadius.value,
    gridSpacing: gridSpacing.value,
    overlayOpacity: overlayOpacity.value,
    overlayColor: overlayColor.value,
  });
}

// Auto-save overlay changes
watch([showCrosshair, showCircle, showGrid, circleRadius, gridSpacing, overlayOpacity, overlayColor], saveOverlay);

// Stream URL management — pause when tab hidden to save bandwidth
const streamActive = ref(false);
const streamUrl = computed(() => streamActive.value ? "/camera/stream" : "");

function startStream() {
  if (available.value) streamActive.value = true;
}

function stopStream() {
  streamActive.value = false;
}

watch(() => props.active, (isActive) => {
  if (isActive) startStream();
  else stopStream();
});

// Check camera availability on mount
let resizeObs: ResizeObserver | null = null;

onMounted(async () => {
  try {
    const res = await fetch("/camera/status");
    const data = await res.json();
    available.value = data.available === true;
  } catch {
    available.value = false;
  }
  checking.value = false;

  if (props.active) startStream();

  // ResizeObserver for container dimensions
  if (containerRef.value) {
    resizeObs = new ResizeObserver(() => {
      const w = containerRef.value?.clientWidth ?? 0;
      const h = containerRef.value?.clientHeight ?? 0;
      if (w === 0 || h === 0) return;
      width.value = w;
      height.value = h;
    });
    resizeObs.observe(containerRef.value);
  }
});

onUnmounted(() => {
  stopStream();
  resizeObs?.disconnect();
});
</script>

<template>
  <div ref="containerRef" class="cameraContainer">
    <!-- Loading state -->
    <div v-if="checking" class="cameraOffline">Checking camera...</div>

    <!-- No camera -->
    <div v-else-if="!available" class="cameraOffline">
      <div class="cameraOfflineMsg">
        <p>No camera configured</p>
        <p class="cameraOfflineHint">Set <code>CAMERA_SOURCE</code> in your INI <code>[DISPLAY]</code> section:</p>
        <pre class="cameraOfflineExample">CAMERA_SOURCE = 0                        # USB camera
CAMERA_SOURCE = rtsp://&lt;host&gt;/live      # IP camera</pre>
      </div>
    </div>

    <!-- Video feed -->
    <template v-else>
      <img v-if="streamUrl" :src="streamUrl" class="cameraFeed" />

      <!-- SVG Overlay -->
      <svg class="cameraOverlay" :viewBox="`0 0 ${width} ${height}`" xmlns="http://www.w3.org/2000/svg">
        <!-- Crosshair -->
        <g v-if="showCrosshair" :opacity="overlayOpacity">
          <line :x1="cx" y1="0" :x2="cx" :y2="height" :stroke="overlayColor" stroke-width="1" />
          <line x1="0" :y1="cy" :x2="width" :y2="cy" :stroke="overlayColor" stroke-width="1" />
        </g>

        <!-- Circle -->
        <circle v-if="showCircle" :cx="cx" :cy="cy" :r="circleRadius"
                fill="none" :stroke="overlayColor" stroke-width="1" :opacity="overlayOpacity" />

        <!-- Grid -->
        <g v-if="showGrid" :opacity="overlayOpacity * 0.4">
          <template v-for="i in gridLines" :key="'g'+i">
            <line :x1="cx + i * gridSpacing" y1="0" :x2="cx + i * gridSpacing" :y2="height"
                  :stroke="overlayColor" stroke-width="0.5" />
            <line :x1="cx - i * gridSpacing" y1="0" :x2="cx - i * gridSpacing" :y2="height"
                  :stroke="overlayColor" stroke-width="0.5" />
            <line x1="0" :y1="cy + i * gridSpacing" :x2="width" :y2="cy + i * gridSpacing"
                  :stroke="overlayColor" stroke-width="0.5" />
            <line x1="0" :y1="cy - i * gridSpacing" :x2="width" :y2="cy - i * gridSpacing"
                  :stroke="overlayColor" stroke-width="0.5" />
          </template>
        </g>
      </svg>

      <!-- Floating toolbar -->
      <div class="cameraToolbar">
        <button class="btn camToolBtn" :class="{ active: showCrosshair }"
                @click="showCrosshair = !showCrosshair" title="Crosshair">+</button>
        <button class="btn camToolBtn" :class="{ active: showCircle }"
                @click="showCircle = !showCircle" title="Circle">&#x25CB;</button>
        <button class="btn camToolBtn" :class="{ active: showGrid }"
                @click="showGrid = !showGrid" title="Grid">#</button>
        <div class="camSliderGroup">
          <span class="camSliderLabel">&#x25CB;</span>
          <input type="range" min="10" max="300" v-model.number="circleRadius" class="camSlider" />
        </div>
        <div class="camSliderGroup">
          <span class="camSliderLabel">#</span>
          <input type="range" min="10" max="200" v-model.number="gridSpacing" class="camSlider" />
        </div>
        <div class="camSliderGroup">
          <input type="color" v-model="overlayColor" class="camColorPicker" title="Overlay color" />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cameraContainer {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--panel);
  overflow: hidden;
}

.cameraFeed {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.cameraOverlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.cameraOffline {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.cameraOfflineMsg {
  text-align: center;
  opacity: var(--opacity-disabled);
}

.cameraOfflineMsg p {
  margin: 0;
  font-size: var(--fs-lg);
}

.cameraOfflineHint {
  margin-top: var(--gap-tight) !important;
  font-size: var(--fs-sm) !important;
}

.cameraOfflineHint code {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
}

.cameraOfflineExample {
  margin: var(--gap-controls) 0 0;
  padding: var(--gap-controls);
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  text-align: left;
  background: color-mix(in srgb, var(--surface) 50%, transparent);
  border-radius: var(--radius-lg);
  line-height: 1.8;
}

.cameraToolbar {
  position: absolute;
  bottom: 12px;
  left: 12px;
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  padding: var(--gap-tight);
  background: color-mix(in srgb, var(--panel) 85%, transparent);
  border-radius: var(--radius-xl);
  backdrop-filter: blur(4px);
}

.camToolBtn {
  min-width: 32px;
  padding: 4px 8px;
  font-size: var(--fs-lg);
  font-weight: 600;
}

.camToolBtn.active {
  border-color: color-mix(in srgb, var(--ok) 50%, transparent);
  background: color-mix(in oklab, var(--ok) 20%, var(--button-bg));
}

.camSliderGroup {
  display: flex;
  align-items: center;
  gap: 4px;
}

.camSliderLabel {
  font-size: var(--fs-sm);
  opacity: 0.6;
}

.camSlider {
  width: 80px;
}

.camColorPicker {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  background: none;
}
</style>
