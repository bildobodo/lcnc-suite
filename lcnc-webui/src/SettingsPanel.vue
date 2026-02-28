<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import TabPanel from "./TabPanel.vue";
import {
  loadViewerDefaults, saveViewerDefaults,
  loadMachineDefaults, saveMachineDefaults,
  type Vec3, type Layer, type ColorDefaults, type OpacityDefaults,
  type TrackMode, type Projection, type ToolChangeMode, type SpindleDir,
} from "./defaults";

const TS_STORAGE_KEY = "lcnc-toolsetter-params";

const props = defineProps<{
  lastReply?: unknown;
  status?: unknown;
}>();

const emit = defineEmits<{
  (e: "setProbeVars", vars: Record<string, number>): void;
}>();

// ─── Viewer defaults ───────────────────────
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

// ─── Machine defaults ──────────────────────
const machSaved = loadMachineDefaults();
const toolChangeMode = ref<ToolChangeMode>(machSaved.toolChangeMode);
const runFromLine = ref(machSaved.runFromLine);
const rflSpindleDir = ref<SpindleDir>(machSaved.rflSpindleDir);
const rflSpindleRpm = ref(machSaved.rflSpindleRpm);

function saveMachine() {
  saveMachineDefaults({
    toolChangeMode: toolChangeMode.value,
    runFromLine: runFromLine.value,
    rflSpindleDir: rflSpindleDir.value,
    rflSpindleRpm: rflSpindleRpm.value,
  });
}

// ─── Toolsetter params ─────────────────────
const tsParams = ref({
  fastFeed: 500,
  slowFeed: 50,
  traverseFeed: 6000,
  maxZTravel: 150,
  retractDist: 2,
  spindleZeroHeight: 180,
  offsetDirection: 0,
  touchX: 0,
  touchY: 0,
  touchZ: -180,
  useToolTable: 0,
  toolMinDis: 10,
  brakeAfter: 0,
  goBackToStart: 0,
  spindleStopM: 5,
  disablePrePos: 1,
  addReps: 0,
  lastTry: 0,
  offsetDiameter: 0,
  offsetValue: 50,
  finderTouchX: 0,
  finderTouchY: 0,
  finderDiffZ: 0,
});

const OFFSET_DIR_LABELS: Record<number, string> = { 0: "X-", 1: "X+", 2: "Y-", 3: "Y+" };
const BRAKE_LABELS: Record<number, string> = { 0: "None", 1: "M00", 2: "M01" };

const probeTool = computed(() => {
  try {
    const raw = localStorage.getItem("lcnc-probe-params");
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.probeTool != null) return saved.probeTool;
    }
  } catch { /* ignore */ }
  return 99;
});

function buildVarMap(): Record<string, number> {
  const p = tsParams.value;
  return {
    "3004": p.fastFeed, "3005": p.slowFeed, "3006": p.traverseFeed,
    "3007": p.maxZTravel, "3009": p.retractDist, "3010": p.spindleZeroHeight,
    "3013": p.offsetDirection,
    "3100": p.touchX, "3101": p.touchY, "3102": p.touchZ,
    "3103": p.useToolTable, "3104": p.toolMinDis, "3105": p.brakeAfter,
    "3106": p.goBackToStart, "3107": p.spindleStopM, "3108": p.disablePrePos,
    "3109": p.addReps, "3110": p.lastTry, "3111": p.offsetDiameter,
    "3112": p.offsetValue, "3113": p.finderTouchX, "3114": p.finderTouchY,
    "3115": p.finderDiffZ,
  };
}

function loadTsParams() {
  try {
    const raw = localStorage.getItem(TS_STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      delete saved.toolNumber; // toolNumber now lives in App.vue sidebar
      Object.assign(tsParams.value, saved);
    }
  } catch { /* ignore */ }
}

function saveTsParams() {
  localStorage.setItem(TS_STORAGE_KEY, JSON.stringify(tsParams.value));
  emit("setProbeVars", buildVarMap());
}

onMounted(() => {
  loadTsParams();
  emit("setProbeVars", buildVarMap());
});

// ─── Sub-tabs ──────────────────────────────
const subTabs = [
  { id: "viewer", label: "3D Viewer" },
  { id: "machine", label: "Machine" },
  { id: "toolsetter", label: "Toolsetter" },
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

      <template #machine>
        <div class="scrollContent scroll-thin">
          <div class="section">
            <div class="sectionTitle">Tool Load Behavior</div>
            <div class="settingDesc">Controls what happens when you load a tool from the Tool Table.</div>
            <div class="btnGroup modeGroup">
              <button
                class="optBtn modeBtn"
                :class="{ active: toolChangeMode === 'm6g43' }"
                @click="toolChangeMode = 'm6g43'; saveMachine()"
              >
                <span class="modeName">M6 G43</span>
                <span class="modeDesc">Load tool, activate length offset</span>
              </button>
              <button
                class="optBtn modeBtn"
                :class="{ active: toolChangeMode === 'm600' }"
                @click="toolChangeMode = 'm600'; saveMachine()"
              >
                <span class="modeName">M600</span>
                <span class="modeDesc">Load tool, measure with toolsetter, save offset</span>
              </button>
            </div>
          </div>
          <div class="section">
            <div class="sectionTitle">Run from Line</div>
            <div class="settingDesc">Allow starting program execution from a selected line in the code viewer.</div>
            <div class="btnGroup modeGroup">
              <button
                class="optBtn modeBtn"
                :class="{ active: !runFromLine }"
                @click="runFromLine = false; saveMachine()"
              >
                <span class="modeName">Disabled</span>
                <span class="modeDesc">Always start from beginning</span>
              </button>
              <button
                class="optBtn modeBtn"
                :class="{ active: runFromLine }"
                @click="runFromLine = true; saveMachine()"
              >
                <span class="modeName">Enabled</span>
                <span class="modeDesc">Click a line in code viewer to start from it</span>
              </button>
            </div>
            <div v-if="runFromLine" class="rflDefaults">
              <div class="settingDesc">Default spindle preset for run-from-line dialog.</div>
              <div class="rflRow">
                <div class="btnGroup">
                  <button class="optBtn" :class="{ active: rflSpindleDir === 'off' }"
                          @click="rflSpindleDir = 'off'; saveMachine()">Off</button>
                  <button class="optBtn" :class="{ active: rflSpindleDir === 'forward' }"
                          @click="rflSpindleDir = 'forward'; saveMachine()">FWD</button>
                  <button class="optBtn" :class="{ active: rflSpindleDir === 'reverse' }"
                          @click="rflSpindleDir = 'reverse'; saveMachine()">REV</button>
                </div>
                <div v-if="rflSpindleDir !== 'off'" class="rflRpm">
                  <label>RPM</label>
                  <input type="number" v-model.number="rflSpindleRpm" min="0" step="100" @change="saveMachine()" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template #toolsetter>
        <div class="scrollContent scroll-thin">
          <div class="section">
            <div class="sectionTitle">Toolsetter Position (G53)</div>
            <div class="tsGrid">
              <label>Touch X <span class="varNum">#3100</span></label>
              <input type="number" v-model.number="tsParams.touchX" step="0.001" @change="saveTsParams" />
              <label>Touch Y <span class="varNum">#3101</span></label>
              <input type="number" v-model.number="tsParams.touchY" step="0.001" @change="saveTsParams" />
              <label>Touch Z <span class="varNum">#3102</span></label>
              <input type="number" v-model.number="tsParams.touchZ" step="0.001" @change="saveTsParams" />
            </div>
          </div>

          <div class="section">
            <div class="sectionTitle">Probe Settings</div>
            <div class="tsGrid">
              <label>Fast Feed <span class="varNum">#3004</span></label>
              <input type="number" v-model.number="tsParams.fastFeed" min="1" step="10" @change="saveTsParams" />
              <label>Slow Feed <span class="varNum">#3005</span></label>
              <input type="number" v-model.number="tsParams.slowFeed" min="0" step="1" @change="saveTsParams" />
              <label>Traverse Feed <span class="varNum">#3006</span></label>
              <input type="number" v-model.number="tsParams.traverseFeed" min="1" step="100" @change="saveTsParams" />
              <label>Max Z Travel <span class="varNum">#3007</span></label>
              <input type="number" v-model.number="tsParams.maxZTravel" min="1" step="5" @change="saveTsParams" />
              <label>Retract Dist <span class="varNum">#3009</span></label>
              <input type="number" v-model.number="tsParams.retractDist" min="0.1" step="0.5" @change="saveTsParams" />
              <label>Spindle Zero H <span class="varNum">#3010</span></label>
              <input type="number" v-model.number="tsParams.spindleZeroHeight" min="0" step="1" @change="saveTsParams" />
            </div>
          </div>

          <div class="section">
            <div class="sectionTitle">Options</div>
            <div class="tsCheckGrid">
              <label class="checkRow">
                <input type="checkbox" :checked="tsParams.useToolTable === 1" @change="tsParams.useToolTable = ($event.target as HTMLInputElement).checked ? 1 : 0; saveTsParams()" />
                Use Tool Table <span class="varNum">#3103</span>
              </label>
              <label class="checkRow">
                <input type="checkbox" :checked="tsParams.goBackToStart === 1" @change="tsParams.goBackToStart = ($event.target as HTMLInputElement).checked ? 1 : 0; saveTsParams()" />
                Return to Start <span class="varNum">#3106</span>
              </label>
              <label class="checkRow">
                <input type="checkbox" :checked="tsParams.disablePrePos === 1" @change="tsParams.disablePrePos = ($event.target as HTMLInputElement).checked ? 1 : 0; saveTsParams()" />
                Skip G30 Pre-Pos <span class="varNum">#3108</span>
              </label>
              <label class="checkRow">
                <input type="checkbox" :checked="tsParams.lastTry === 1" @change="tsParams.lastTry = ($event.target as HTMLInputElement).checked ? 1 : 0; saveTsParams()" />
                Last Try w/o Table <span class="varNum">#3110</span>
              </label>
            </div>
            <div class="tsGrid" style="margin-top: 12px;">
              <label>Tool Min Dist <span class="varNum">#3104</span></label>
              <input type="number" v-model.number="tsParams.toolMinDis" min="0" step="1" @change="saveTsParams" />
              <label>Extra Retries <span class="varNum">#3109</span></label>
              <input type="number" v-model.number="tsParams.addReps" min="0" step="1" @change="saveTsParams" />

              <label>Brake After <span class="varNum">#3105</span></label>
              <div class="tsBtnRow">
                <button v-for="b in [0, 1, 2]" :key="b" class="optBtn tsToggle" :class="{ active: tsParams.brakeAfter === b }" @click="tsParams.brakeAfter = b; saveTsParams()">{{ BRAKE_LABELS[b] }}</button>
              </div>

              <label>Spindle Stop <span class="varNum">#3107</span></label>
              <div class="tsBtnRow">
                <button class="optBtn tsToggle" :class="{ active: tsParams.spindleStopM === 5 }" @click="tsParams.spindleStopM = 5; saveTsParams()">M5</button>
                <button class="optBtn tsToggle" :class="{ active: tsParams.spindleStopM === 500 }" @click="tsParams.spindleStopM = 500; saveTsParams()">M500</button>
              </div>

              <label>Offset Dir <span class="varNum">#3013</span></label>
              <div class="tsBtnRow">
                <button v-for="d in [0, 1, 2, 3]" :key="d" class="optBtn tsToggle" :class="{ active: tsParams.offsetDirection === d }" @click="tsParams.offsetDirection = d; saveTsParams()">{{ OFFSET_DIR_LABELS[d] }}</button>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="sectionTitle">Diameter Offset</div>
            <div class="tsGrid">
              <label>Min Diameter <span class="varNum">#3111</span></label>
              <input type="number" v-model.number="tsParams.offsetDiameter" min="0" step="1" @change="saveTsParams" />
              <label>Offset % <span class="varNum">#3112</span></label>
              <input type="number" v-model.number="tsParams.offsetValue" min="0" max="100" step="5" @change="saveTsParams" />
            </div>
          </div>

          <div class="section">
            <div class="sectionTitle">Edge-Finder</div>
            <div class="tsGrid">
              <label>Probe Tool # <span class="varNum">#3014</span></label>
              <span class="readonlyVal">T{{ probeTool }} <span class="varNum">(set in Probe tab)</span></span>
              <label>Finder X <span class="varNum">#3113</span></label>
              <input type="number" v-model.number="tsParams.finderTouchX" step="0.001" @change="saveTsParams" />
              <label>Finder Y <span class="varNum">#3114</span></label>
              <input type="number" v-model.number="tsParams.finderTouchY" step="0.001" @change="saveTsParams" />
              <label>Finder Z Diff <span class="varNum">#3115</span></label>
              <input type="number" v-model.number="tsParams.finderDiffZ" step="0.001" @change="saveTsParams" />
            </div>
          </div>
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

.settingDesc {
  font-size: 12px;
  opacity: 0.5;
  margin-bottom: 12px;
}

.modeGroup {
  flex-direction: column;
  gap: 8px;
}

.modeBtn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 14px;
  text-align: left;
}

.modeName {
  font-size: 13px;
  font-weight: 600;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
}

.modeDesc {
  font-size: 11px;
  opacity: 0.5;
}

.rflDefaults {
  margin-top: 10px;
}

.rflRow {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
}

.rflRpm {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rflRpm input {
  width: 90px;
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

/* ─── Toolsetter sub-tab ───── */
.tsGrid {
  display: grid;
  grid-template-columns: auto 1fr auto 1fr;
  gap: 6px 10px;
  align-items: center;
}

.tsGrid label {
  font-size: 11px;
  opacity: 0.7;
}

.tsGrid input {
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
  max-width: 100px;
}

.varNum {
  opacity: 0.4;
  font-size: 10px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
}

.readonlyVal {
  font-size: 12px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-weight: 600;
  opacity: 0.7;
}

.tsCheckGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
}

.tsBtnRow {
  display: flex;
  gap: 3px;
}

.tsToggle {
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.6;
}

.tsToggle.active {
  opacity: 1;
}
</style>
