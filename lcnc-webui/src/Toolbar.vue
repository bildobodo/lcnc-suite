<template>
  <div class="toolbar">
    <button @click="$emit('resetBackplot')">Reset backplot</button>

    <div class="views">
      <button @click="$emit('setView', 'top')">Top</button>
      <button @click="$emit('setView', 'front')">Front</button>
      <button @click="$emit('setView', 'back')">Back</button>
      <button @click="$emit('setView', 'left')">Left</button>
      <button @click="$emit('setView', 'right')">Right</button>
      <button @click="$emit('setView', 'dimetric')">Dimetric</button>
      <button @click="$emit('setView', 'reset')">Reset</button>
    </div>

    <div class="toggles">
      <label><input type="checkbox" v-model="local.backplot" @change="emitToggle('backplot')" /> Backplot</label>
      <label><input type="checkbox" v-model="local.toolpath" @change="emitToggle('toolpath')" /> Toolpath</label>
      <label><input type="checkbox" v-model="local.machine"  @change="emitToggle('machine')"  /> Machine</label>
      <label><input type="checkbox" v-model="local.workpiece" @change="emitToggle('workpiece')" /> Workpiece</label>
      <label><input type="checkbox" v-model="local.bounds" @change="emitToggle('bounds')" /> Bounds</label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from "vue";

type ViewPreset = "top" | "left" | "right" | "front" | "back" | "iso" | "dimetric" | "reset";
type Layer = "backplot" | "toolpath" | "machine" | "workpiece" | "bounds";

const emit = defineEmits<{
  (e: "resetBackplot"): void;
  (e: "setView", preset: ViewPreset): void;
  (e: "toggleLayer", layer: Layer, on: boolean): void;
}>();

const local = reactive<Record<Layer, boolean>>({
  backplot: true,
  toolpath: true,
  machine: true,
  workpiece: true,
  bounds: true,
});

function emitToggle(layer: Layer) {
  emit("toggleLayer", layer, local[layer]);
}
</script>

<style scoped>
.toolbar { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:8px; }
.views, .toggles { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
</style>
