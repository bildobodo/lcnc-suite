<script setup lang="ts">
import { ref, reactive, computed, inject, onMounted, type Ref, type ComputedRef } from "vue";
import TabPanel from "./TabPanel.vue";
import {
  loadViewerDefaults, saveViewerDefaults,
  loadMachineDefaults, saveMachineDefaults,
  type Vec3, type Layer, type ColorDefaults, type OpacityDefaults,
  type TrackMode, type Projection, type ToolChangeMode, type SpindleDir,
  type ThemeMode,
} from "./defaults";
import { fetchHal, fetchG30, type HalPin, type HalSignal, type HalParam } from "./lcncApi";

const TS_STORAGE_KEY = "lcnc-toolsetter-params";

const themeMode = inject<Ref<ThemeMode>>("themeMode", ref("auto") as Ref<ThemeMode>);
const setTheme = inject<(mode: ThemeMode) => void>("setTheme", () => {});
const machineParts = inject<ComputedRef<Array<{ id: string; group: string | null; direction: string | null }>>>("machineParts", computed(() => []));
const setMachinePartColor = inject<(id: string, color: string | null) => void>("setMachinePartColor", () => {});
const setMachineEdges = inject<(on: boolean) => void>("setMachineEdges", () => {});

const props = defineProps<{
  lastReply?: unknown;
  status?: unknown;
}>();

const emit = defineEmits<{
  (e: "setProbeVars", vars: Record<string, number>): void;
  (e: "mdi", text: string): void;
}>();

// ─── Viewer defaults ───────────────────────
const saved = loadViewerDefaults();
const wpSize = reactive<Vec3>([...saved.workpieceSize] as Vec3);
const wpOffset = reactive<Vec3>([...saved.workpieceOffset] as Vec3);
const layers = reactive<Record<Layer, boolean>>({ ...saved.layers });
const colors = reactive<ColorDefaults>({ ...saved.colors });
const opacities = reactive<OpacityDefaults>({ ...saved.opacities });
const machineColors = reactive<Record<string, string>>({ ...saved.machineColors });
const trackingMode = ref<TrackMode>(saved.trackingMode);
const pathOnTop = ref(saved.pathOnTop);
const machineEdgesOn = ref(saved.machineEdges);
const projection = ref<Projection>(saved.projection);

function save() {
  saveViewerDefaults({
    workpieceSize: [...wpSize] as Vec3,
    workpieceOffset: [...wpOffset] as Vec3,
    layers: { ...layers },
    colors: { ...colors },
    opacities: { ...opacities },
    machineColors: { ...machineColors },
    machineEdges: machineEdgesOn.value,
    trackingMode: trackingMode.value,
    pathOnTop: pathOnTop.value,
    projection: projection.value,
  });
}

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

// ─── G30 tool change position ────────────────
const g30X = ref<number | null>(null);
const g30Y = ref<number | null>(null);
const g30Z = ref<number | null>(null);
const g30Loading = ref(false);

async function loadG30() {
  g30Loading.value = true;
  try {
    const data = await fetchG30();
    if (data.ok) {
      g30X.value = data.x;
      g30Y.value = data.y;
      g30Z.value = data.z;
    }
  } catch { /* ignore */ }
  g30Loading.value = false;
}

function setG30() {
  emit("mdi", "G30.1");
  // After G30.1 saves current position, read back from machine position
  const st = props.status as any;
  if (st?.position) {
    g30X.value = st.position[0];
    g30Y.value = st.position[1];
    g30Z.value = st.position[2];
  }
}

onMounted(() => {
  loadTsParams();
  emit("setProbeVars", buildVarMap());
  loadG30();
});

// ─── Sub-tabs ──────────────────────────────
const subTabs = [
  { id: "viewer", label: "3D Viewer" },
  { id: "machine", label: "Machine" },
  { id: "toolsetter", label: "Toolsetter" },
  { id: "display", label: "Display" },
  { id: "hal", label: "HAL" },
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

// ─── Machine part colors ────────────────────
const DIR_DEFAULT_COLORS: Record<string, string> = { x: "#9b4a4a", y: "#4a8f5a", z: "#4a6f9b" };
const FRAME_COLOR = "#bfbfbf";

function defaultMachineColor(part: { direction: string | null }): string {
  return (part.direction ? DIR_DEFAULT_COLORS[part.direction] : null) ?? FRAME_COLOR;
}

function formatPartLabel(id: string): string {
  return id.replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function onMachineColorChange(id: string, hex: string) {
  machineColors[id] = hex;
  save();
  setMachinePartColor(id, hex);
}

function resetMachineColor(id: string) {
  delete machineColors[id];
  save();
  setMachinePartColor(id, null);
}

// ─── HAL viewer ─────────────────────────────
type HalSection = "pins" | "signals" | "params";

const halSection = ref<HalSection>("pins");
const halPins = ref<HalPin[]>([]);
const halSignals = ref<HalSignal[]>([]);
const halParams = ref<HalParam[]>([]);
const halLoading = ref(false);
const halError = ref<string | null>(null);
const halSearch = ref("");
const halExpanded = ref(new Set<string>());

async function refreshHal() {
  halLoading.value = true;
  halError.value = null;
  try {
    const data = await fetchHal();
    halPins.value = data.pins;
    halSignals.value = data.signals;
    halParams.value = data.params;
  } catch (e: any) {
    halError.value = e.message || "Failed to fetch HAL data";
  } finally {
    halLoading.value = false;
  }
}

function toggleHalGroup(group: string) {
  const s = halExpanded.value;
  if (s.has(group)) s.delete(group);
  else s.add(group);
  halExpanded.value = new Set(s);
}

function expandAllHal() {
  const items = halSection.value === "params" ? halParams.value : halPins.value;
  const groups = new Set<string>();
  for (const p of items) groups.add(p.name.split(".")[0]!);
  halExpanded.value = groups;
}

function collapseAllHal() {
  halExpanded.value = new Set();
}

function pinGroup(name: string): string {
  const dot = name.indexOf(".");
  return dot > 0 ? name.substring(0, dot) : name;
}

const filteredPins = computed(() => {
  const q = halSearch.value.trim().toLowerCase();
  if (!q) return halPins.value;
  return halPins.value.filter(p =>
    p.name.toLowerCase().includes(q) ||
    (p.signal && p.signal.toLowerCase().includes(q)) ||
    p.value.toLowerCase().includes(q)
  );
});

const pinGroups = computed(() => {
  const groups = new Map<string, HalPin[]>();
  for (const p of filteredPins.value) {
    const g = pinGroup(p.name);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }
  return groups;
});

const filteredSignals = computed(() => {
  const q = halSearch.value.trim().toLowerCase();
  if (!q) return halSignals.value;
  return halSignals.value.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.pins.some(p => p.pin.toLowerCase().includes(q))
  );
});

const filteredParams = computed(() => {
  const q = halSearch.value.trim().toLowerCase();
  if (!q) return halParams.value;
  return halParams.value.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.value.toLowerCase().includes(q)
  );
});

const paramGroups = computed(() => {
  const groups = new Map<string, HalParam[]>();
  for (const p of filteredParams.value) {
    const g = pinGroup(p.name);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }
  return groups;
});

const halStats = computed(() => ({
  pins: halPins.value.length,
  signals: halSignals.value.length,
  params: halParams.value.length,
}));
</script>

<template>
  <div class="settings">
    <div class="hint">Changes here set startup defaults. They take effect on next page load.</div>
    <TabPanel :tabs="subTabs" v-model="activeTab" class="subTabs">
      <template #viewer>
        <div class="scrollContent scroll-thin">
        <div class="section">
          <div class="sub">Workpiece Defaults</div>
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
          <div class="sub">Layer Defaults</div>
          <div class="layerGrid">
            <label v-for="layer in (['backplot', 'toolpath', 'machine', 'workpiece', 'bounds', 'workzero', 'hud'] as Layer[])" :key="layer">
              <input type="checkbox" v-model="layers[layer]" @change="onLayerChange" />
              {{ layer === 'hud' ? 'HUD' : layer === 'workzero' ? 'Work Zero' : layer.charAt(0).toUpperCase() + layer.slice(1) }}
            </label>
          </div>
        </div>

        <div class="section">
          <div class="sub">Color Defaults</div>
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
          <div class="sub">Opacity Defaults</div>
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
        <div class="section" v-if="machineParts.length > 0">
          <div class="sub">Machine Colors</div>
          <div class="colorGrid">
            <div class="colorRow" v-for="part in machineParts" :key="part.id">
              <input
                type="color"
                class="colorInput"
                :value="machineColors[part.id] ?? defaultMachineColor(part)"
                @input="onMachineColorChange(part.id, ($event.target as HTMLInputElement).value)"
              />
              <span class="colorLabel">{{ formatPartLabel(part.id) }}</span>
              <button v-if="machineColors[part.id]" class="btn-icon" @click="resetMachineColor(part.id)">&times;</button>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="sub">Viewer Behavior</div>
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
            <label class="checkRow">
              <input type="checkbox" v-model="machineEdgesOn" @change="setMachineEdges(machineEdgesOn); save()" />
              Machine edge outline
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
            <div class="sub">Tool Load Behavior</div>
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
            <div class="sub">Run from Line</div>
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
            <div class="sub">Toolsetter Position (G53)</div>
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
            <div class="sub">Tool Change Position (G30) <span class="varNum">#5181–#5183</span></div>
            <div class="tsGrid">
              <label>X</label>
              <span class="readonlyVal">{{ g30X != null ? g30X.toFixed(3) : '—' }}</span>
              <label>Y</label>
              <span class="readonlyVal">{{ g30Y != null ? g30Y.toFixed(3) : '—' }}</span>
              <label>Z</label>
              <span class="readonlyVal">{{ g30Z != null ? g30Z.toFixed(3) : '—' }}</span>
            </div>
            <div class="tsBtnRow" style="margin-top: 8px;">
              <button class="optBtn" @click="setG30">Set Current Position</button>
              <button class="optBtn" @click="loadG30" :disabled="g30Loading">Refresh</button>
            </div>
          </div>

          <div class="section">
            <div class="sub">Probe Settings</div>
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
            <div class="sub">Options</div>
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
            <div class="sub">Diameter Offset</div>
            <div class="tsGrid">
              <label>Min Diameter <span class="varNum">#3111</span></label>
              <input type="number" v-model.number="tsParams.offsetDiameter" min="0" step="1" @change="saveTsParams" />
              <label>Offset % <span class="varNum">#3112</span></label>
              <input type="number" v-model.number="tsParams.offsetValue" min="0" max="100" step="5" @change="saveTsParams" />
            </div>
          </div>

          <div class="section">
            <div class="sub">Edge-Finder</div>
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

      <template #display>
        <div class="scrollContent scroll-thin">
          <div class="section">
            <div class="sub">Theme</div>
            <div class="btnGroup">
              <button class="optBtn" :class="{ active: themeMode === 'auto' }" @click="setTheme('auto')">Auto</button>
              <button class="optBtn" :class="{ active: themeMode === 'light' }" @click="setTheme('light')">Light</button>
              <button class="optBtn" :class="{ active: themeMode === 'dark' }" @click="setTheme('dark')">Dark</button>
            </div>
            <div class="btnGroup" style="margin-top: 8px;">
              <button class="optBtn" :class="{ active: themeMode === 'hc-light' }" @click="setTheme('hc-light')">HC Light</button>
              <button class="optBtn" :class="{ active: themeMode === 'hc-dark' }" @click="setTheme('hc-dark')">HC Dark</button>
            </div>
          </div>
        </div>
      </template>

      <template #hal>
        <div class="halPane">
          <!-- Header: section toggles + search + refresh (pinned) -->
          <div class="halHeader">
            <div class="btnGroup">
              <button class="optBtn" :class="{ active: halSection === 'pins' }"
                      @click="halSection = 'pins'">
                Pins <span class="halCount" v-if="halStats.pins">({{ halStats.pins }})</span>
              </button>
              <button class="optBtn" :class="{ active: halSection === 'signals' }"
                      @click="halSection = 'signals'">
                Signals <span class="halCount" v-if="halStats.signals">({{ halStats.signals }})</span>
              </button>
              <button class="optBtn" :class="{ active: halSection === 'params' }"
                      @click="halSection = 'params'">
                Params <span class="halCount" v-if="halStats.params">({{ halStats.params }})</span>
              </button>
            </div>
            <div class="halActions">
              <input type="text" class="halSearchInput" v-model="halSearch" placeholder="Search..." />
              <button class="optBtn" @click="refreshHal" :disabled="halLoading">
                {{ halLoading ? '...' : 'Refresh' }}
              </button>
            </div>
          </div>

          <!-- Tree controls (pinned) -->
          <div v-if="!halSearch.trim() && ((halSection === 'pins' && halPins.length > 0) || (halSection === 'params' && halParams.length > 0))" class="halTreeControls">
            <button class="optBtn" @click="expandAllHal">+ all</button>
            <button class="optBtn" @click="collapseAllHal">- all</button>
            <span class="halFilterInfo" v-if="halSection === 'pins' && filteredPins.length !== halPins.length">
              {{ filteredPins.length }} / {{ halPins.length }}
            </span>
          </div>

          <div class="scrollContent scroll-thin">
          <!-- Error -->
          <div v-if="halError" class="halError">{{ halError }}</div>

          <!-- Empty state -->
          <div v-if="!halLoading && halPins.length === 0 && !halError" class="halEmpty">
            Click Refresh to load HAL data.
          </div>

          <!-- PINS -->
          <div v-if="halSection === 'pins' && halPins.length > 0">

            <!-- Tree view -->
            <template v-if="!halSearch.trim()">
              <div v-for="[group, pins] of pinGroups" :key="group" class="halGroup">
                <button class="halGroupHeader" @click="toggleHalGroup(group)">
                  <span class="halChevron">{{ halExpanded.has(group) ? '\u25BC' : '\u25B6' }}</span>
                  <span class="halGroupName">{{ group }}</span>
                  <span class="halGroupCount">({{ pins.length }})</span>
                </button>
                <div v-if="halExpanded.has(group)" class="halGroupBody">
                  <div class="halRow" v-for="pin in pins" :key="pin.name">
                    <span class="halName" :title="pin.name">{{ pin.name }}</span>
                    <span class="halType">{{ pin.type }}</span>
                    <span class="halDir">{{ pin.dir }}</span>
                    <span class="halValue" :class="{ halTrue: pin.value === 'TRUE', halFalse: pin.value === 'FALSE' }">{{ pin.value }}</span>
                    <span class="halSignal" v-if="pin.signal">{{ pin.arrow }} {{ pin.signal }}</span>
                    <span class="halSignal halUnlinked" v-else>unlinked</span>
                  </div>
                </div>
              </div>
            </template>

            <!-- Flat filtered list -->
            <template v-else>
              <div class="halFilterInfo">{{ filteredPins.length }} matches</div>
              <div class="halRow" v-for="pin in filteredPins" :key="pin.name">
                <span class="halName" :title="pin.name">{{ pin.name }}</span>
                <span class="halType">{{ pin.type }}</span>
                <span class="halDir">{{ pin.dir }}</span>
                <span class="halValue" :class="{ halTrue: pin.value === 'TRUE', halFalse: pin.value === 'FALSE' }">{{ pin.value }}</span>
                <span class="halSignal" v-if="pin.signal">{{ pin.arrow }} {{ pin.signal }}</span>
                <span class="halSignal halUnlinked" v-else>unlinked</span>
              </div>
            </template>
          </div>

          <!-- SIGNALS -->
          <div v-if="halSection === 'signals' && halSignals.length > 0">
            <div class="halFilterInfo" v-if="halSearch.trim()">{{ filteredSignals.length }} matches</div>
            <div class="halSigRow" v-for="sig in filteredSignals" :key="sig.name">
              <div class="halSigHeader">
                <span class="halSigName">{{ sig.name }}</span>
                <span class="halType">{{ sig.type }}</span>
                <span class="halValue" :class="{ halTrue: sig.value === 'TRUE', halFalse: sig.value === 'FALSE' }">{{ sig.value }}</span>
              </div>
              <div class="halSigPins" v-if="sig.pins.length">
                <span v-for="(p, i) in sig.pins" :key="i" class="halSigPin">{{ p.arrow }} {{ p.pin }}</span>
              </div>
            </div>
          </div>

          <!-- PARAMS -->
          <div v-if="halSection === 'params' && halParams.length > 0">
            <template v-if="!halSearch.trim()">
              <div v-for="[group, params] of paramGroups" :key="group" class="halGroup">
                <button class="halGroupHeader" @click="toggleHalGroup(group)">
                  <span class="halChevron">{{ halExpanded.has(group) ? '\u25BC' : '\u25B6' }}</span>
                  <span class="halGroupName">{{ group }}</span>
                  <span class="halGroupCount">({{ params.length }})</span>
                </button>
                <div v-if="halExpanded.has(group)" class="halGroupBody">
                  <div class="halRow" v-for="param in params" :key="param.name">
                    <span class="halName" :title="param.name">{{ param.name }}</span>
                    <span class="halType">{{ param.type }}</span>
                    <span class="halDir">{{ param.dir }}</span>
                    <span class="halValue">{{ param.value }}</span>
                  </div>
                </div>
              </div>
            </template>

            <template v-else>
              <div class="halFilterInfo">{{ filteredParams.length }} matches</div>
              <div class="halRow" v-for="param in filteredParams" :key="param.name">
                <span class="halName" :title="param.name">{{ param.name }}</span>
                <span class="halType">{{ param.type }}</span>
                <span class="halDir">{{ param.dir }}</span>
                <span class="halValue">{{ param.value }}</span>
              </div>
            </template>
          </div>
          </div>
        </div>
      </template>

      <template #debug>
        <div class="scrollContent scroll-thin">
          <div class="section">
            <div class="sub">Last reply</div>
            <pre class="debugPre">{{ props.lastReply }}</pre>
          </div>
          <div class="section">
            <div class="sub">Raw status</div>
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
  font-size: var(--fs-sm);
  opacity: 0.45;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.scrollContent {
  overflow-y: auto;
  height: 100%;
}


.section {
  margin-bottom: 24px;
}

.sub {
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
  font-size: var(--fs-base);
  opacity: 0.8;
  min-width: 60px;
}

.numInput {
  padding: 4px 8px;
  font-size: var(--fs-base);
  border-radius: var(--radius-md);
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
  font-size: var(--fs-md);
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
  border-radius: var(--radius-md);
  background: none;
  cursor: pointer;
  padding: 0;
}

.colorInput::-webkit-color-swatch-wrapper {
  padding: 2px;
}

.colorInput::-webkit-color-swatch {
  border: none;
  border-radius: var(--radius-sm);
}

.colorLabel {
  font-size: var(--fs-base);
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
  font-size: var(--fs-base);
  opacity: 0.8;
  min-width: 100px;
}

.opacitySlider {
  flex: 1;
}

.opacityValue {
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
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
  font-size: var(--fs-base);
  border-radius: var(--radius-md);
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
  font-size: var(--fs-md);
  cursor: pointer;
  user-select: none;
}

.settingDesc {
  font-size: var(--fs-base);
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
  font-size: var(--fs-md);
  font-weight: 600;
}

.modeDesc {
  font-size: var(--fs-sm);
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

.debugPre {
  font-size: var(--fs-sm);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow: auto;
  margin: 0;
  padding: 6px;
  background: color-mix(in oklab, var(--fg) 5%, var(--bg));
  border-radius: var(--radius-md);
}

/* ─── Toolsetter sub-tab ───── */
.tsGrid {
  display: grid;
  grid-template-columns: auto 1fr auto 1fr;
  gap: 6px 10px;
  align-items: center;
}

.tsGrid label {
  font-size: var(--fs-sm);
  opacity: 0.7;
}

.tsGrid input {
  padding: 4px 8px;
  font-size: var(--fs-base);
  border-radius: var(--radius-md);
  max-width: 100px;
}

.varNum {
  opacity: 0.4;
  font-size: var(--fs-xs);
  font-family: var(--font-mono);
}

.readonlyVal {
  font-size: var(--fs-base);
  font-family: var(--font-mono);
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
  padding: 5px 8px;
  font-size: var(--fs-sm);
  font-weight: 600;
  opacity: 0.6;
}

.tsToggle.active {
  opacity: 1;
}

/* ─── HAL viewer ───── */
.halPane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.halHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.halActions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.halSearchInput {
  width: 160px;
}

.halError {
  padding: 6px 10px;
  margin-bottom: 8px;
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--danger) 15%, var(--bg));
  opacity: 0.9;
}

.halEmpty {
  text-align: center;
  opacity: 0.4;
  padding: 40px 0;
}

.halTreeControls {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.halCount {
  opacity: 0.5;
}

.halFilterInfo {
  opacity: 0.5;
  margin-bottom: 6px;
}

.halGroup {
  margin-bottom: 2px;
}

.halGroupHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  background: none;
  border: none;
  border-radius: 0;
  color: inherit;
  font: inherit;
  width: 100%;
  text-align: left;
  cursor: pointer;
  user-select: none;
}

.halGroupHeader:hover {
  opacity: 0.8;
  background: none;
}

.halChevron {
  width: 12px;
  text-align: center;
  flex-shrink: 0;
}

.halGroupName {
  font-weight: 600;
}

.halGroupCount {
  opacity: 0.4;
}

.halGroupBody {
  padding-left: 18px;
}

.halRow {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 1px 0;
}

.halRow:hover {
  background: color-mix(in oklab, var(--fg) 4%, transparent);
}

.halName {
  flex: 2;
  min-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.halType {
  width: 36px;
  flex-shrink: 0;
  text-align: center;
  opacity: 0.5;
}

.halDir {
  width: 24px;
  flex-shrink: 0;
  text-align: center;
  opacity: 0.5;
}

.halValue {
  width: 80px;
  flex-shrink: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.halTrue {
  color: var(--ok);
}

.halFalse {
  opacity: 0.4;
}

.halSignal {
  flex: 1;
  min-width: 60px;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.halUnlinked {
  opacity: 0.25;
}

.halSigRow {
  padding: 4px 0;
  border-bottom: 1px solid color-mix(in oklab, var(--border) 30%, transparent);
}

.halSigHeader {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.halSigName {
  font-weight: 600;
  flex: 1;
  min-width: 0;
}

.halSigPins {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding-left: 12px;
  padding-top: 2px;
  opacity: 0.6;
}

.halSigPin {
  white-space: nowrap;
}
</style>
