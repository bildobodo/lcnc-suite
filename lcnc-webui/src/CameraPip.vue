<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { loadCameraDefaults, saveCameraDefaults, settingsVersion } from "./defaults";
import MachineBtn from "./MachineBtn.vue";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

// ─── Settings ────────────────────────────────────────────────
const cd = loadCameraDefaults();
const showCrosshair = ref(cd.showCrosshair);
const showCircle = ref(cd.showCircle);
const showGrid = ref(cd.showGrid);
const circleRadius = ref(cd.circleRadius);
const gridSpacing = ref(cd.gridSpacing);
const overlayOpacity = ref(cd.overlayOpacity);
const overlayColor = ref(cd.overlayColor);

// Re-read when another client changes camera settings
watch(settingsVersion, () => {
  const u = loadCameraDefaults();
  showCrosshair.value = u.showCrosshair;
  showCircle.value = u.showCircle;
  showGrid.value = u.showGrid;
  circleRadius.value = u.circleRadius;
  gridSpacing.value = u.gridSpacing;
  overlayOpacity.value = u.overlayOpacity;
  overlayColor.value = u.overlayColor;
  // Sync position/size from server
  pipW.value = u.pipWidth;
  pipH.value = u.pipHeight;
  if (u.pipX >= 0) pipX.value = u.pipX;
  if (u.pipY >= 0) pipY.value = u.pipY;
});

// ─── PIP position & size ─────────────────────────────────────
const MIN_W = 160;
const MIN_H = 120;

const pipW = ref(cd.pipWidth);
const pipH = ref(cd.pipHeight);
const pipX = ref(cd.pipX);  // -1 = auto (bottom-right)
const pipY = ref(cd.pipY);
const minimized = ref(false);

const containerRef = ref<HTMLDivElement | null>(null);

function getContainerRect(): DOMRect | null {
  const el = containerRef.value?.parentElement;
  return el ? el.getBoundingClientRect() : null;
}

// Compute default bottom-right position
function initPosition() {
  if (pipX.value >= 0 && pipY.value >= 0) return;
  const rect = getContainerRect();
  if (!rect) return;
  pipX.value = rect.width - pipW.value - 12;
  pipY.value = rect.height - pipH.value - 52; // above floatingBar
}

// ─── Stream control ──────────────────────────────────────────
const streamActive = ref(false);
const streamError = ref(false);
const streamUrl = computed(() => streamActive.value ? "/camera/stream" : "");

watch(() => props.visible, (vis) => {
  if (vis) {
    streamError.value = false;
    streamActive.value = true;
    initPosition();
  } else {
    streamActive.value = false;
  }
}, { immediate: true });

// ─── SVG overlay computed ────────────────────────────────────
const svgW = computed(() => pipW.value);
const svgH = computed(() => minimized.value ? 0 : pipH.value);
const cx = computed(() => svgW.value / 2);
const cy = computed(() => svgH.value / 2);
const gridLines = computed(() => {
  const max = Math.max(svgW.value, svgH.value);
  return Math.ceil(max / gridSpacing.value);
});

// ─── Drag logic ──────────────────────────────────────────────
let dragStartX = 0;
let dragStartY = 0;
let dragOriginX = 0;
let dragOriginY = 0;

function onDragStart(e: PointerEvent) {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  target.setPointerCapture(e.pointerId);
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragOriginX = pipX.value;
  dragOriginY = pipY.value;
  target.addEventListener("pointermove", onDragMove);
  target.addEventListener("pointerup", onDragEnd);
}

function onDragMove(e: PointerEvent) {
  const rect = getContainerRect();
  if (!rect) return;
  let nx = dragOriginX + (e.clientX - dragStartX);
  let ny = dragOriginY + (e.clientY - dragStartY);
  // Clamp to container
  nx = Math.max(0, Math.min(nx, rect.width - pipW.value));
  ny = Math.max(0, Math.min(ny, rect.height - pipH.value));
  pipX.value = nx;
  pipY.value = ny;
}

function onDragEnd(e: PointerEvent) {
  const target = e.target as HTMLElement;
  target.releasePointerCapture(e.pointerId);
  target.removeEventListener("pointermove", onDragMove);
  target.removeEventListener("pointerup", onDragEnd);
  savePipLayout();
}

// ─── Resize logic ────────────────────────────────────────────
let resizeStartX = 0;
let resizeStartY = 0;
let resizeOriginW = 0;
let resizeOriginH = 0;

function onResizeStart(e: PointerEvent) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const target = e.target as HTMLElement;
  target.setPointerCapture(e.pointerId);
  resizeStartX = e.clientX;
  resizeStartY = e.clientY;
  resizeOriginW = pipW.value;
  resizeOriginH = pipH.value;
  target.addEventListener("pointermove", onResizeMove);
  target.addEventListener("pointerup", onResizeEnd);
}

function onResizeMove(e: PointerEvent) {
  const rect = getContainerRect();
  if (!rect) return;
  let nw = resizeOriginW + (e.clientX - resizeStartX);
  let nh = resizeOriginH + (e.clientY - resizeStartY);
  // Clamp min
  nw = Math.max(MIN_W, nw);
  nh = Math.max(MIN_H, nh);
  // Clamp to container
  nw = Math.min(nw, rect.width - pipX.value);
  nh = Math.min(nh, rect.height - pipY.value);
  pipW.value = nw;
  pipH.value = nh;
}

function onResizeEnd(e: PointerEvent) {
  const target = e.target as HTMLElement;
  target.releasePointerCapture(e.pointerId);
  target.removeEventListener("pointermove", onResizeMove);
  target.removeEventListener("pointerup", onResizeEnd);
  savePipLayout();
}

// ─── Persist layout ──────────────────────────────────────────
function savePipLayout() {
  const cur = loadCameraDefaults();
  saveCameraDefaults({
    ...cur,
    pipX: pipX.value,
    pipY: pipY.value,
    pipWidth: pipW.value,
    pipHeight: pipH.value,
  });
}

function close() {
  streamActive.value = false;
  emit("close");
}

function toggleMinimize() {
  minimized.value = !minimized.value;
}

onMounted(() => {
  if (props.visible) initPosition();
});
</script>

<template>
  <div
    v-show="visible"
    ref="containerRef"
    class="cameraPip"
    :style="{
      left: pipX + 'px',
      top: pipY + 'px',
      width: pipW + 'px',
    }"
  >
    <!-- Title bar (drag handle) -->
    <div class="dialogHeader pipDragHandle" @pointerdown="onDragStart">
      <span class="dialogTitle">Camera</span>
      <div class="row-tight">
        <MachineBtn type="close" @click.stop="toggleMinimize" :title="minimized ? 'Expand' : 'Minimize'">
          {{ minimized ? '□' : '−' }}
        </MachineBtn>
        <MachineBtn type="close" @click.stop="close" title="Close">&times;</MachineBtn>
      </div>
    </div>

    <!-- Content area -->
    <div v-show="!minimized" class="pipContent" :style="{ height: pipH + 'px' }">
      <img v-if="streamUrl && !streamError" :src="streamUrl" class="pipFeed" @error="streamError = true" @load="streamError = false" />
      <div v-else class="pipPlaceholder">No stream</div>

      <!-- SVG Overlay -->
      <svg class="pipOverlay" :viewBox="`0 0 ${svgW} ${svgH}`" xmlns="http://www.w3.org/2000/svg">
        <g v-if="showCrosshair" :opacity="overlayOpacity">
          <line :x1="cx" y1="0" :x2="cx" :y2="svgH" :stroke="overlayColor" stroke-width="1" />
          <line x1="0" :y1="cy" :x2="svgW" :y2="cy" :stroke="overlayColor" stroke-width="1" />
        </g>
        <circle v-if="showCircle" :cx="cx" :cy="cy" :r="circleRadius"
                fill="none" :stroke="overlayColor" stroke-width="1" :opacity="overlayOpacity" />
        <g v-if="showGrid" :opacity="overlayOpacity * 0.4">
          <template v-for="i in gridLines" :key="'g'+i">
            <line :x1="cx + i * gridSpacing" y1="0" :x2="cx + i * gridSpacing" :y2="svgH"
                  :stroke="overlayColor" stroke-width="0.5" />
            <line :x1="cx - i * gridSpacing" y1="0" :x2="cx - i * gridSpacing" :y2="svgH"
                  :stroke="overlayColor" stroke-width="0.5" />
            <line x1="0" :y1="cy + i * gridSpacing" :x2="svgW" :y2="cy + i * gridSpacing"
                  :stroke="overlayColor" stroke-width="0.5" />
            <line x1="0" :y1="cy - i * gridSpacing" :x2="svgW" :y2="cy - i * gridSpacing"
                  :stroke="overlayColor" stroke-width="0.5" />
          </template>
        </g>
      </svg>

      <!-- Resize handle -->
      <div class="pipResize" @pointerdown="onResizeStart"></div>
    </div>
  </div>
</template>

<style scoped>
.cameraPip {
  position: absolute;
  z-index: 10;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.pipDragHandle {
  padding: var(--gap-tight) var(--gap-controls);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.pipDragHandle:active {
  cursor: grabbing;
}


.pipContent {
  position: relative;
  overflow: hidden;
}

.pipFeed {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  border: none;
}

.pipPlaceholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: var(--opacity-disabled);
  font-size: var(--fs-sm);
}

.pipOverlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  border: none;
  outline: none;
}

.pipResize {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  touch-action: none;
}

.pipResize::after {
  content: "";
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-right: 1px solid var(--fg);
  border-bottom: 1px solid var(--fg);
  opacity: var(--opacity-muted);
}
</style>
