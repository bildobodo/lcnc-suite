<script setup lang="ts">
import { ref, reactive } from "vue";
import TabPanel from "./TabPanel.vue";
import {
  loadViewerDefaults, saveViewerDefaults,
  type Vec3, type Layer, type ColorDefaults, type OpacityDefaults,
  type TrackMode, type Projection,
} from "./defaults";

const props = defineProps<{
  lastReply?: unknown;
  status?: unknown;
  linearUnit?: string;
}>();

function save() {
  saveViewerDefaults({
    workpieceSize: [...wpSize] as Vec3,
    workpieceOffset: [...wpOffset] as Vec3,
    layers: { ...layers },
    colors: { ...colors },
    opacities: { ...opacities },
    trackingMode: trackingMode.value,
    pathOnTop: pathOnTop.value,
    projection: projection.value,
  });
}

const saved = loadViewerDefaults();
const wpSize = reactive<Vec3>([...saved.workpieceSize] as Vec3);
const wpOffset = reactive<Vec3>([...saved.workpieceOffset] as Vec3);
const layers = reactive<Record<Layer, boolean>>({ ...saved.layers });
const colors = reactive<ColorDefaults>({ ...saved.colors });
const opacities = reactive<OpacityDefaults>({ ...saved.opacities });
const trackingMode = ref<TrackMode>(saved.trackingMode);
const pathOnTop = ref(saved.pathOnTop);
const projection = ref<Projection>(saved.projection);

const subTabs = [
  { id: "viewer", label: "3D Viewer" },
  { id: "dro", label: "DRO" },
  { id: "jog", label: "Jogging" },
  { id: "debug", label: "Debug" },
];
const activeTab = ref("viewer");

function updateSize(axis: number, value: number) {
  if (isNaN(value) || value < 0) return;
  wpSize[axis] = value;
  if (axis === 2) wpOffset[2] = -value;
  save();
}

function updateOffset(axis: number, value: number) {
  if (isNaN(value)) return;
  wpOffset[axis] = value;
  save();
}

function onLayerChange() {
  save();
}

function onColorChange(key: keyof ColorDefaults, value: string) {
  colors[key] = value;
  save();
}

const colorFields: { key: keyof ColorDefaults; label: string }[] = [
  { key: "feed", label: "Toolpath" },
  { key: "rapid", label: "Fast Feed" },
  { key: "backplot", label: "Backplot" },
  { key: "bounds", label: "Machine Bounds" },
  { key: "workpiece", label: "Workpiece" },
  { key: "tool", label: "Tool" },
];

function onOpacityChange(key: keyof OpacityDefaults, value: number) {
  opacities[key] = value;
  save();
}

const opacityFields: { key: keyof OpacityDefaults; label: string }[] = [
  { key: "toolpath", label: "Toolpath" },
  { key: "backplot", label: "Backplot" },
  { key: "machine", label: "Machine" },
  { key: "bounds", label: "Machine Bounds" },
  { key: "workpiece", label: "Workpiece" },
  { key: "hud", label: "HUD" },
];
</script>

<template>
  <div class="settings">
    <div class="hint">Changes here set startup defaults. They take effect on next page load.</div>
    <TabPanel :tabs="subTabs" v-model="activeTab" class="subTabs">
      <template #viewer>
        <div class="scrollContent scroll-thin">
        <div class="section">
          <div class="sectionTitle">Workpiece Defaults</div>
          <div class="wpColumns">
            <div class="fieldGroup">
              <div class="inputRow" v-for="(label, i) in ['Size X', 'Size Y', 'Size Z']" :key="'s'+i">
                <label class="inputLabel">{{ label }}</label>
                <input
                  type="number"
                  class="numInput"
                  :value="wpSize[i]"
                  @input="updateSize(i, parseFloat(($event.target as HTMLInputElement).value))"
                  step="1" min="0" max="9999"
                />
              </div>
            </div>
            <div class="fieldGroup">
              <div class="inputRow" v-for="(label, i) in ['Offset X', 'Offset Y', 'Offset Z']" :key="'o'+i">
                <label class="inputLabel">{{ label }}</label>
                <input
                  type="number"
                  class="numInput"
                  :value="wpOffset[i]"
                  @input="updateOffset(i, parseFloat(($event.target as HTMLInputElement).value))"
                  step="1" min="-9999" max="9999"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="sectionTitle">Layer Defaults</div>
          <div class="layerGrid">
            <label v-for="layer in (['backplot', 'toolpath', 'machine', 'workpiece', 'bounds', 'workzero', 'hud'] as Layer[])" :key="layer">
              <input type="checkbox" v-model="layers[layer]" @change="onLayerChange" />
              {{ layer === 'hud' ? 'HUD' : layer === 'workzero' ? 'Work Zero' : layer.charAt(0).toUpperCase() + layer.slice(1) }}
            </label>
          </div>
        </div>

        <div class="section">
          <div class="sectionTitle">Color Defaults</div>
          <div class="colorGrid">
            <div class="colorRow" v-for="cf in colorFields" :key="cf.key">
              <input
                type="color"
                class="colorInput"
                :value="colors[cf.key]"
                @input="onColorChange(cf.key, ($event.target as HTMLInputElement).value)"
              />
              <span class="colorLabel">{{ cf.label }}</span>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="sectionTitle">Opacity Defaults</div>
          <div class="opacityList">
            <div class="opacityRow" v-for="of_ in opacityFields" :key="of_.key">
              <span class="opacityLabel">{{ of_.label }}</span>
              <input
                type="range"
                class="opacitySlider"
                min="0" max="1" step="0.05"
                :value="opacities[of_.key]"
                @input="onOpacityChange(of_.key, parseFloat(($event.target as HTMLInputElement).value))"
              />
              <span class="opacityValue">{{ Math.round(opacities[of_.key] * 100) }}%</span>
            </div>
          </div>
        </div>
        <div class="section">
          <div class="sectionTitle">Viewer Behavior</div>
          <div class="fieldGroup">
            <div class="inputRow">
              <label class="inputLabel">Tracking</label>
              <div class="btnGroup">
                <button
                  v-for="m in (['none', 'tool', 'workpiece'] as TrackMode[])"
                  :key="m"
                  class="optBtn"
                  :class="{ active: trackingMode === m }"
                  @click="trackingMode = m; save()"
                >{{ m.charAt(0).toUpperCase() + m.slice(1) }}</button>
              </div>
            </div>
            <label class="checkRow">
              <input type="checkbox" v-model="pathOnTop" @change="save()" />
              Toolpath always on top
            </label>
            <div class="inputRow">
              <label class="inputLabel">Projection</label>
              <div class="btnGroup">
                <button
                  v-for="p in (['perspective', 'parallel'] as Projection[])"
                  :key="p"
                  class="optBtn"
                  :class="{ active: projection === p }"
                  @click="projection = p; save()"
                >{{ p.charAt(0).toUpperCase() + p.slice(1) }}</button>
              </div>
            </div>
          </div>
        </div>

        </div>
      </template>

      <template #dro>
        <div class="placeholder">
          <div class="placeholderText">DRO settings coming soon</div>
        </div>
      </template>

      <template #jog>
        <div class="placeholder">
          <div class="placeholderText">Jogging settings coming soon</div>
        </div>
      </template>

      <template #debug>
        <div class="scrollContent scroll-thin">
          <div class="section">
            <div class="sectionTitle">Last reply</div>
            <pre class="debugPre">{{ props.lastReply }}</pre>
          </div>
          <div class="section">
            <div class="sectionTitle">Raw status</div>
            <pre class="debugPre">{{ props.status }}</pre>
          </div>
        </div>
      </template>
    </TabPanel>
  </div>
</template>

<style scoped>
.settings {
  padding: 4px 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.hint {
  font-size: 11px;
  opacity: 0.45;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.scrollContent {
  overflow-y: auto;
  height: 100%;
}

.subTabs :deep(.tab-btn) {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 8px 8px 3px 3px;
}

.section {
  margin-bottom: 24px;
}

.sectionTitle {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
}

.wpColumns {
  display: flex;
  gap: 24px;
}

.wpColumns .fieldGroup {
  flex: 1;
  margin-bottom: 0;
}

.fieldGroup {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.inputRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inputLabel {
  font-size: 12px;
  opacity: 0.8;
  min-width: 60px;
}

.numInput {
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
  width: 80px;
}

.layerGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.layerGrid label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.colorGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.colorRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.colorInput {
  width: 32px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: none;
  cursor: pointer;
  padding: 0;
}

.colorInput::-webkit-color-swatch-wrapper {
  padding: 2px;
}

.colorInput::-webkit-color-swatch {
  border: none;
  border-radius: 2px;
}

.colorLabel {
  font-size: 12px;
  opacity: 0.8;
}

.opacityList {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.opacityRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.opacityLabel {
  font-size: 12px;
  opacity: 0.8;
  min-width: 100px;
}

.opacitySlider {
  flex: 1;
}

.opacityValue {
  font-size: 11px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  opacity: 0.6;
  min-width: 32px;
  text-align: right;
}

.btnGroup {
  display: flex;
  gap: 4px;
}

.optBtn {
  padding: 5px 10px;
  font-size: 12px;
  border-radius: 4px;
}

.optBtn.active {
  background: color-mix(in oklab, var(--fg) 15%, var(--button-bg));
  font-weight: 600;
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

.checkRow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.placeholder {
  padding: 40px 0;
  text-align: center;
}

.placeholderText {
  font-size: 13px;
  opacity: 0.4;
}

.debugPre {
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow: auto;
  margin: 0;
  padding: 6px;
  background: color-mix(in oklab, var(--fg) 5%, var(--bg));
  border-radius: 4px;
}
</style>
