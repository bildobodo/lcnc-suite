<template>
  <div class="viewerContainer">
    <!-- Left side: All controls (vertical) -->
    <div class="leftSidebar">
      <div class="group">
        <div class="groupLabel">Camera View</div>
        <button class="viewBtn" @click="$emit('setView', 'top')">Top</button>
        <button class="viewBtn" @click="$emit('setView', 'front')">Front</button>
        <button class="viewBtn" @click="$emit('setView', 'back')">Back</button>
        <button class="viewBtn" @click="$emit('setView', 'left')">Left</button>
        <button class="viewBtn" @click="$emit('setView', 'right')">Right</button>
        <button class="viewBtn" @click="$emit('setView', 'dimetric')">Dimetric</button>
        <button class="viewBtn" @click="$emit('setView', 'reset')">Reset View</button>
      </div>

      <div class="group">
        <div class="groupLabel">Backplot</div>
        <button class="viewBtn" @click="$emit('resetBackplot')">Reset Backplot</button>
      </div>

      <div class="group">
        <div class="groupLabel">Workpiece</div>
        <div class="inputRow">
          <label class="inputLabel">Size X</label>
          <input
            type="number"
            class="numInput"
            :value="workpieceSize[0]"
            @input="updateSize(0, parseFloat(($event.target as HTMLInputElement).value))"
            step="1"
          />
        </div>
        <div class="inputRow">
          <label class="inputLabel">Size Y</label>
          <input
            type="number"
            class="numInput"
            :value="workpieceSize[1]"
            @input="updateSize(1, parseFloat(($event.target as HTMLInputElement).value))"
            step="1"
          />
        </div>
        <div class="inputRow">
          <label class="inputLabel">Size Z</label>
          <input
            type="number"
            class="numInput"
            :value="workpieceSize[2]"
            @input="updateSize(2, parseFloat(($event.target as HTMLInputElement).value))"
            step="1"
          />
        </div>

        <div class="separator"></div>

        <div class="inputRow">
          <label class="inputLabel">Offset X</label>
          <input
            type="number"
            class="numInput"
            :value="workpieceOffset[0]"
            @input="updateOffset(0, parseFloat(($event.target as HTMLInputElement).value))"
            step="1"
          />
        </div>
        <div class="inputRow">
          <label class="inputLabel">Offset Y</label>
          <input
            type="number"
            class="numInput"
            :value="workpieceOffset[1]"
            @input="updateOffset(1, parseFloat(($event.target as HTMLInputElement).value))"
            step="1"
          />
        </div>
        <div class="inputRow">
          <label class="inputLabel">Offset Z</label>
          <input
            type="number"
            class="numInput"
            :value="workpieceOffset[2]"
            @input="updateOffset(2, parseFloat(($event.target as HTMLInputElement).value))"
            step="1"
          />
        </div>
      </div>

      <div class="group">
        <div class="groupLabel">Layers</div>
        <label><input type="checkbox" v-model="local.backplot" @change="emitToggle('backplot')" /> Backplot</label>
        <label><input type="checkbox" v-model="local.toolpath" @change="emitToggle('toolpath')" /> Toolpath</label>
        <label><input type="checkbox" v-model="local.machine"  @change="emitToggle('machine')"  /> Machine</label>
        <label><input type="checkbox" v-model="local.workpiece" @change="emitToggle('workpiece')" /> Workpiece</label>
        <label><input type="checkbox" v-model="local.bounds" @change="emitToggle('bounds')" /> Bounds</label>
        <label><input type="checkbox" v-model="local.hud" @change="emitToggle('hud')" /> HUD</label>
      </div>
    </div>

    <!-- Right side: 3D Viewer slot -->
    <div class="viewerSlot">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from "vue";

type ViewPreset = "top" | "left" | "right" | "front" | "back" | "iso" | "dimetric" | "reset";
type Layer = "backplot" | "toolpath" | "machine" | "workpiece" | "bounds" | "hud";
type Vec3 = [number, number, number];

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
}>();

const local = reactive<Record<Layer, boolean>>({
  backplot: true,
  toolpath: true,
  machine: true,
  workpiece: true,
  bounds: true,
  hud: true,
});

function emitToggle(layer: Layer) {
  emit("toggleLayer", layer, local[layer]);
}

function updateSize(axis: number, value: number) {
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
  const newOffset: Vec3 = [...props.workpieceOffset] as Vec3;
  newOffset[axis] = value;
  emit("update:workpieceOffset", newOffset);
}
</script>

<style scoped>
.viewerContainer {
  display: flex;
  gap: 12px;
  align-items: stretch;
  width: 100%;
}

.leftSidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 120px;
}

.viewerSlot {
  flex: 1;
  min-width: 0;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.groupLabel {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 2px;
}

.viewBtn {
  padding: 8px 12px;
  font-size: 13px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
  white-space: nowrap;
}

.viewBtn:hover {
  background: color-mix(in oklab, var(--button-bg) 85%, var(--fg));
}

.viewBtn:active {
  transform: scale(0.98);
}

.leftSidebar label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
}

.leftSidebar input[type="checkbox"] {
  cursor: pointer;
}

.inputRow {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
}

.inputLabel {
  font-size: 12px;
  opacity: 0.8;
  min-width: 60px;
}

.numInput {
  flex: 1;
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  max-width: 80px;
}

.numInput:focus {
  outline: none;
  border-color: color-mix(in oklab, var(--fg) 40%, var(--border));
}

.separator {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
  opacity: 0.3;
}
</style>
