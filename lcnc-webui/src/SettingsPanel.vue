<script setup lang="ts">
import { ref, reactive, computed, inject, watch, type Ref, type ComputedRef } from "vue";
import TabPanel from "./TabPanel.vue";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineToggle from "./MachineToggle.vue";
import MachineSlider from "./MachineSlider.vue";
import MachineRadio from "./MachineRadio.vue";
import MachineColor from "./MachineColor.vue";
import {
  loadViewerDefaults, saveViewerDefaults,
  loadMachineDefaults, saveMachineDefaults,
  loadMacrosDefaults, saveMacrosDefaults, extractParams,
  loadDisplayDefaults, saveDisplayDefaults, settingsVersion, serverSettingsReady,
  loadCameraDefaults, saveCameraDefaults,
  type Layer, type ColorDefaults,
  type TrackMode, type Projection, type ToolChangeMode, type SpindleDir, type SpindleFeedbackUnit,
  type ThemeMode, type MacroDef, type MacroParam, type GamepadDefaults,
  GAMEPAD_FALLBACK,
  STEP_RPM,
  loadKeyboardDefaults, type KeyboardDefaults, DEFAULT_KB_MAPPING,
} from "./defaults";
import { enableWakeLock, disableWakeLock } from "./wakeLock";
import { ChevronUp, ChevronDown, Pencil, Trash2 } from "lucide-vue-next";
import DebugTab from "./DebugTab.vue";
import HalshowTab from "./HalshowTab.vue";
import KeyboardTab from "./KeyboardTab.vue";
import GamepadTab from "./GamepadTab.vue";


const themeMode = inject<Ref<ThemeMode>>("themeMode", ref("auto") as Ref<ThemeMode>);
const setTheme = inject<(mode: ThemeMode) => void>("setTheme", () => {});
const startFullscreen = ref(loadDisplayDefaults().startFullscreen);
const keepAwake = ref(loadDisplayDefaults().keepAwake);
const machineParts = inject<ComputedRef<Array<{ id: string; group: string | null; direction: string | null }>>>("machineParts", computed(() => []));
const setMachinePartColor = inject<(id: string, color: string | null) => void>("setMachinePartColor", () => {});
const setMachineEdges = inject<(on: boolean) => void>("setMachineEdges", () => {});
const setToolColors = inject<(toolColor: string | null, cutterColor: string | null) => void>("setToolColors", () => {});
const updateMacros = inject<(macros: MacroDef[]) => void>("updateMacros", () => {});

// ─── Macros CRUD ────────────────────────────────────────────────
const macros = ref<MacroDef[]>(loadMacrosDefaults().macros);
const editingMacro = ref<MacroDef | null>(null);

const editingMacroParams = computed<MacroParam[]>(() => {
  if (!editingMacro.value) return [];
  const names = extractParams(editingMacro.value.command);
  const existing = new Map(editingMacro.value.params.map(p => [p.name, p]));
  const result = names.map(name => existing.get(name) || { name, label: name, default: "" });
  editingMacro.value.params = result;
  return result;
});

function addMacro() {
  editingMacro.value = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: "",
    command: "",
    params: [],
  };
}

function editMacro(m: MacroDef) {
  editingMacro.value = { ...m, params: m.params.map(p => ({ ...p })) };
}

function saveMacro() {
  if (!editingMacro.value) return;
  const m = editingMacro.value;
  if (!m.name.trim() || !m.command.trim()) return;
  // Sync params from command placeholders
  const paramNames = extractParams(m.command);
  const existingMap = new Map(m.params.map(p => [p.name, p]));
  m.params = paramNames.map(name => existingMap.get(name) || { name, label: name, default: "" });
  const idx = macros.value.findIndex(x => x.id === m.id);
  if (idx >= 0) macros.value[idx] = m;
  else macros.value.push(m);
  editingMacro.value = null;
  persistMacros();
}

function deleteMacro(id: string) {
  macros.value = macros.value.filter(m => m.id !== id);
  if (editingMacro.value?.id === id) editingMacro.value = null;
  persistMacros();
}

function moveMacro(idx: number, dir: -1 | 1) {
  const target = idx + dir;
  if (target < 0 || target >= macros.value.length) return;
  const arr = [...macros.value];
  [arr[idx]!, arr[target]!] = [arr[target]!, arr[idx]!];
  macros.value = arr;
  persistMacros();
}

function persistMacros() {
  saveMacrosDefaults({ macros: macros.value });
  updateMacros(macros.value);
}

const props = defineProps<{
  gamepadConnected?: boolean;
  gamepadName?: string;
  gamepadConfig?: GamepadDefaults;
  keyboardConfig?: KeyboardDefaults;
  initialTab?: string | null;
}>();

const emit = defineEmits<{
  (e: "setPathOnTop", on: boolean): void;
  (e: "setProjection", proj: Projection): void;
  (e: "setTrackMode", mode: TrackMode): void;
  (e: "toggleLayer", layer: Layer, on: boolean): void;
  (e: "setRunFromLine", on: boolean): void;
  (e: "setGamepadConfig", cfg: GamepadDefaults): void;
  (e: "setKeyboardConfig", cfg: KeyboardDefaults): void;
}>();

// ─── Per-tab reset ──────────────────────────────────────────────
const resetTarget = ref<string | null>(null);

const resetLabels: Record<string, string> = {
  viewer: "3D Viewer", machine: "Machine",
  display: "Display", gamepad: "Gamepad", keyboard: "Keyboard",
};

function resetViewer() {
  saveViewerDefaults({
    layers: { backplot: true, toolpath: true, machine: true, bounds: true, toolpathBounds: false, workzero: true, hud: true, surface: true, tool: true },
    colors: { feed: "#22b8cf", rapid: "#f5a623", backplot: "#ff00ff", bounds: "#ffffff", toolpathBounds: "#f5a623", tool: "#c0c0c0", cutter: "#ffdd00" },
    machineColors: {}, machineEdges: true, trackingMode: "none", pathOnTop: false, projection: "parallel",
  });
  const vd = loadViewerDefaults();
  Object.assign(layers, vd.layers);
  Object.assign(colors, vd.colors);
  for (const k of Object.keys(machineColors)) delete machineColors[k];
  Object.assign(machineColors, vd.machineColors);
  trackingMode.value = vd.trackingMode;
  pathOnTop.value = vd.pathOnTop;
  machineEdgesOn.value = vd.machineEdges;
  projection.value = vd.projection;
  emit("setPathOnTop", vd.pathOnTop);
  emit("setProjection", vd.projection);
  setMachineEdges(vd.machineEdges);
  setToolColors(null, null);
  for (const p of machineParts.value) setMachinePartColor(p.id, null);
}

function resetMachine() {
  saveMachineDefaults({
    toolChangeMode: "m6g43", runFromLine: false,
    rflSpindleDir: "forward", rflSpindleRpm: 10000,
    spindleFeedbackUnit: "rps", spindleLoadPin: "",
  });
  const md = loadMachineDefaults();
  toolChangeMode.value = md.toolChangeMode;
  runFromLine.value = md.runFromLine;
  rflSpindleDir.value = md.rflSpindleDir;
  rflSpindleRpm.value = md.rflSpindleRpm;
  spindleFeedbackUnit.value = md.spindleFeedbackUnit;
  spindleLoadPin.value = md.spindleLoadPin;
  emit("setRunFromLine", md.runFromLine);
}

function saveStartFullscreen() {
  saveDisplayDefaults({ ...loadDisplayDefaults(), startFullscreen: startFullscreen.value });
}

function saveKeepAwake() {
  saveDisplayDefaults({ ...loadDisplayDefaults(), keepAwake: keepAwake.value });
  // Apply immediately — the WS open path also reads this on next reconnect,
  // but toggling at runtime should acquire/release without waiting.
  if (keepAwake.value) void enableWakeLock();
  else disableWakeLock();
}

function resetDisplay() {
  setTheme("auto");
  startFullscreen.value = false;
  keepAwake.value = true;
  saveDisplayDefaults({ theme: "auto", startFullscreen: false, keepAwake: true });
  void enableWakeLock();
}

function resetGamepad() {
  // Server-synced reset: emit the fallback config; the parent updates the
  // gamepadConfig prop, which GamepadTab mirrors via its own watch.
  emit("setGamepadConfig", { ...GAMEPAD_FALLBACK, mapping: { ...GAMEPAD_FALLBACK.mapping } });
}

const resetActions: Record<string, () => void> = {
  viewer: resetViewer, machine: resetMachine,
  display: resetDisplay, gamepad: resetGamepad, keyboard: resetKeyboard,
};

function confirmReset() {
  const target = resetTarget.value;
  resetTarget.value = null;
  if (target && resetActions[target]) resetActions[target]();
}

// ─── Viewer defaults ───────────────────────
const saved = loadViewerDefaults();
const layers = reactive<Record<Layer, boolean>>({ ...saved.layers });
const colors = reactive<ColorDefaults>({ ...saved.colors });
const machineColors = reactive<Record<string, string>>({ ...saved.machineColors });
const trackingMode = ref<TrackMode>(saved.trackingMode);
const pathOnTop = ref(saved.pathOnTop);
const machineEdgesOn = ref(saved.machineEdges);
const projection = ref<Projection>(saved.projection);

function save() {
  saveViewerDefaults({
    layers: { ...layers },
    colors: { ...colors },
    machineColors: { ...machineColors },
    machineEdges: machineEdgesOn.value,
    trackingMode: trackingMode.value,
    pathOnTop: pathOnTop.value,
    projection: projection.value,
  });
}

// ─── Viewer setting handlers (emit to App.vue → ThreeViewer) ──────
const LAYER_LABELS: { key: Layer; label: string }[] = [
  { key: "backplot", label: "Backplot" },
  { key: "toolpath", label: "Toolpath" },
  { key: "workzero", label: "Work Zero" },
  { key: "surface", label: "Surface" },
  { key: "toolpathBounds", label: "Toolpath Bounds" },
  { key: "bounds", label: "Machine Bounds" },
  { key: "machine", label: "Machine" },
  { key: "hud", label: "HUD" },
];

function onLayerChange(layer: Layer, on: boolean) {
  layers[layer] = on;
  save();
  emit("toggleLayer", layer, on);
}

function onPathOnTopChange(on: boolean) {
  pathOnTop.value = on;
  save();
  emit("setPathOnTop", on);
}

function onTrackModeChange(mode: TrackMode) {
  trackingMode.value = mode;
  save();
  emit("setTrackMode", mode);
}

function onProjectionChange(proj: Projection) {
  projection.value = proj;
  save();
  emit("setProjection", proj);
}

// ─── Camera overlay state ─────────────────────────────────────────
const camDefs = loadCameraDefaults();
const camShowCrosshair = ref(camDefs.showCrosshair);
const camShowCircle = ref(camDefs.showCircle);
const camShowGrid = ref(camDefs.showGrid);
const camCircleRadius = ref(camDefs.circleRadius);
const camGridSpacing = ref(camDefs.gridSpacing);
const camOverlayOpacity = ref(camDefs.overlayOpacity);
const camOverlayColor = ref(camDefs.overlayColor);

let _camSkipNext = 0;

function saveCamTracked() {
  _camSkipNext++;
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

// ─── Machine defaults ──────────────────────
const machSaved = loadMachineDefaults();
const toolChangeMode = ref<ToolChangeMode>(machSaved.toolChangeMode);
const runFromLine = ref(machSaved.runFromLine);
const rflSpindleDir = ref<SpindleDir>(machSaved.rflSpindleDir);
const rflSpindleRpm = ref(machSaved.rflSpindleRpm);
const spindleFeedbackUnit = ref<SpindleFeedbackUnit>(machSaved.spindleFeedbackUnit);
const spindleLoadPin = ref(machSaved.spindleLoadPin);

function saveMachine() {
  saveMachineDefaults({
    toolChangeMode: toolChangeMode.value,
    runFromLine: runFromLine.value,
    rflSpindleDir: rflSpindleDir.value,
    rflSpindleRpm: rflSpindleRpm.value,
    spindleFeedbackUnit: spindleFeedbackUnit.value,
    spindleLoadPin: spindleLoadPin.value,
  });
}

// Re-read when another client changes settings
watch(settingsVersion, () => {
  macros.value = loadMacrosDefaults().macros;
  const md = loadMachineDefaults();
  toolChangeMode.value = md.toolChangeMode;
  runFromLine.value = md.runFromLine;
  rflSpindleDir.value = md.rflSpindleDir;
  rflSpindleRpm.value = md.rflSpindleRpm;
  spindleFeedbackUnit.value = md.spindleFeedbackUnit;
  spindleLoadPin.value = md.spindleLoadPin;
  emit("setRunFromLine", md.runFromLine);
  const vd = loadViewerDefaults();
  Object.assign(layers, vd.layers);
  Object.assign(colors, vd.colors);
  Object.assign(machineColors, vd.machineColors);
  trackingMode.value = vd.trackingMode;
  pathOnTop.value = vd.pathOnTop;
  machineEdgesOn.value = vd.machineEdges;
  projection.value = vd.projection;
  const dd = loadDisplayDefaults();
  startFullscreen.value = dd.startFullscreen;
  keepAwake.value = dd.keepAwake;
  if (_camSkipNext > 0) { _camSkipNext--; }
  else {
    const cd = loadCameraDefaults();
    camShowCrosshair.value = cd.showCrosshair;
    camShowCircle.value = cd.showCircle;
    camShowGrid.value = cd.showGrid;
    camCircleRadius.value = cd.circleRadius;
    camGridSpacing.value = cd.gridSpacing;
    camOverlayOpacity.value = cd.overlayOpacity;
    camOverlayColor.value = cd.overlayColor;
  }
});

// ── Keyboard tab state ──
// Fallback when the parent hasn't yet supplied a keyboardConfig prop.
// Read once at setup; the live config is owned by KeyboardTab + parent.
const defaultKbConfig = loadKeyboardDefaults();

function resetKeyboard() {
  // Server-synced reset: emit the defaults; the parent updates the
  // keyboardConfig prop, which KeyboardTab mirrors via its own watch.
  emit("setKeyboardConfig", {
    jogEnabled: false,
    buttonsEnabled: true,
    mapping: { ...DEFAULT_KB_MAPPING },
  });
}

// ─── Sub-tabs ──────────────────────────────
const subTabs = [
  { id: "viewer", label: "3D Viewer" },
  { id: "machine", label: "Machine" },
  { id: "display", label: "Display" },
  { id: "macros", label: "Macros" },
  { id: "gamepad", label: "Gamepad" },
  { id: "keyboard", label: "Keyboard" },
  { id: "halshow", label: "Halshow" },
  { id: "debug", label: "Debug" },
];
const activeTab = ref("viewer");

watch(() => props.initialTab, (t) => { if (t) activeTab.value = t; }, { immediate: true });



function onColorChange(key: keyof ColorDefaults, value: string) {
  colors[key] = value;
  save();
  if (key === "tool" || key === "cutter") {
    setToolColors(colors.tool, colors.cutter);
  }
}

const colorFields: { key: keyof ColorDefaults; label: string }[] = [
  { key: "feed", label: "Toolpath" },
  { key: "rapid", label: "Fast Feed" },
  { key: "backplot", label: "Backplot" },
  { key: "bounds", label: "Machine Bounds" },
  { key: "toolpathBounds", label: "Toolpath Bounds" },
  { key: "tool", label: "Tool Shaft" },
  { key: "cutter", label: "Tool Cutter" },
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

</script>

<template>
  <div class="settings">
    <div class="hint">Settings are saved automatically and shared across all connected clients.</div>
    <TabPanel :tabs="subTabs" v-model="activeTab" class="subTabs">
      <template #viewer>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
        <div class="stack-controls">
          <div class="sub">View</div>
          <div class="settingDesc">Projection mode for the 3D viewport.</div>
          <div class="radioGroup inline">
            <label><MachineRadio gate="viewerSetting" name="projection" :modelValue="projection" value="perspective" @update:modelValue="onProjectionChange('perspective')" /> Perspective</label>
            <label><MachineRadio gate="viewerSetting" name="projection" :modelValue="projection" value="parallel" @update:modelValue="onProjectionChange('parallel')" /> Parallel</label>
          </div>
          <div class="settingDesc">Camera tracking — keep the tool or WCS origin centered while it moves.</div>
          <div class="radioGroup inline">
            <label><MachineRadio gate="viewerSetting" name="tracking" :modelValue="trackingMode" value="none" @update:modelValue="onTrackModeChange('none')" /> None</label>
            <label><MachineRadio gate="viewerSetting" name="tracking" :modelValue="trackingMode" value="tool" @update:modelValue="onTrackModeChange('tool')" /> Tool</label>
            <label><MachineRadio gate="viewerSetting" name="tracking" :modelValue="trackingMode" value="wcs" @update:modelValue="onTrackModeChange('wcs')" /> WCS</label>
          </div>
        </div>

        <div class="sep"></div>

        <div class="stack-controls">
          <div class="sub">Layers</div>
          <div class="layerGrid">
            <MachineToggle
              v-for="lf in LAYER_LABELS" :key="lf.key"
              gate="viewerSetting"
              :modelValue="layers[lf.key]"
              @update:modelValue="onLayerChange(lf.key, $event!)"
              :label="lf.label"
            />
          </div>
        </div>

        <div class="sep"></div>

        <div class="stack-controls">
          <div class="sub">Toolpath</div>
          <MachineToggle
            gate="viewerSetting"
            :modelValue="pathOnTop"
            @update:modelValue="onPathOnTopChange($event!)"
            label="Always on top"
          />
        </div>

        <div class="sep"></div>

        <div class="stack-controls">
          <div class="sub">Camera Overlay</div>
          <div class="settingDesc">Overlays drawn on top of the camera PIP feed.</div>
          <div class="row-controls">
            <MachineToggle gate="cameraSetting" v-model="camShowCrosshair" @update:modelValue="saveCamTracked" label="Crosshair" />
            <MachineToggle gate="cameraSetting" v-model="camShowCircle" @update:modelValue="saveCamTracked" label="Circle" />
            <MachineToggle gate="cameraSetting" v-model="camShowGrid" @update:modelValue="saveCamTracked" label="Grid" />
          </div>
          <div class="row-controls">
            <span class="inputLabel">Radius</span>
            <MachineInput gate="cameraSetting" type="number" v-model.number="camCircleRadius" min="10" max="300" :step="1" @change="saveCamTracked" />
          </div>
          <div class="row-controls">
            <span class="inputLabel">Grid</span>
            <MachineInput gate="cameraSetting" type="number" v-model.number="camGridSpacing" min="10" max="200" :step="1" @change="saveCamTracked" />
          </div>
          <div class="row-controls">
            <span class="camOverlayLabel">Opacity</span>
            <MachineSlider gate="cameraSetting" class="camOverlaySlider" :min="0" :max="1" :step="0.05" v-model="camOverlayOpacity" @update:modelValue="saveCamTracked" />
            <span class="camOverlayValue">{{ Math.round(camOverlayOpacity * 100) }}%</span>
          </div>
          <div class="row-controls">
            <span class="inputLabel">Color</span>
            <MachineColor gate="cameraSetting" v-model="camOverlayColor" @update:modelValue="saveCamTracked" />
          </div>
        </div>

        <div class="sep"></div>

        <div class="stack-controls">
          <div class="sub">Colors</div>
          <div class="colorGrid">
            <div class="row-controls" v-for="cf in colorFields" :key="cf.key">
              <MachineColor
                gate="viewerSetting"
                :modelValue="colors[cf.key]"
                @update:modelValue="onColorChange(cf.key, $event!)"
              />
              <span class="colorLabel">{{ cf.label }}</span>
            </div>
          </div>
        </div>

        <div class="sep"></div>

        <div class="stack-controls" v-if="machineParts.length > 0">
          <div class="sub">Machine Colors</div>
          <div class="stack-controls fieldGroup">
            <div class="colorGrid">
              <div class="row-controls" v-for="part in machineParts" :key="part.id">
                <MachineColor
                  gate="viewerSetting"
                    :modelValue="machineColors[part.id] ?? defaultMachineColor(part)"
                  @update:modelValue="onMachineColorChange(part.id, $event!)"
                />
                <span class="colorLabel">{{ formatPartLabel(part.id) }}</span>
                <MachineBtn v-if="machineColors[part.id]" type="close" @click="resetMachineColor(part.id)">&times;</MachineBtn>
              </div>
            </div>
            <MachineToggle gate="viewerSetting" v-model="machineEdgesOn" @update:modelValue="setMachineEdges(machineEdgesOn); save()" label="Edge outline" />
          </div>
        </div>

        <div class="resetRow">
          <MachineBtn type="reset" @click="resetTarget = 'viewer'">Reset 3D Viewer</MachineBtn>
        </div>
        </div>
      </template>

      <template #machine>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
          <div class="stack-controls">
            <div class="sub">Tool Load Behavior</div>
            <div class="settingDesc">Controls what happens when you load a tool from the Tool Table.</div>
            <div class="radioGroup">
              <label>
                <MachineRadio gate="displaySetting" name="toolChangeMode" v-model="toolChangeMode" value="m6g43" @update:modelValue="saveMachine()" />
                <span><span class="radioLabel">M6 G43</span><br><span class="radioDesc">Load tool, activate length offset</span></span>
              </label>
              <label>
                <MachineRadio gate="displaySetting" name="toolChangeMode" v-model="toolChangeMode" value="m600" @update:modelValue="saveMachine()" />
                <span><span class="radioLabel">M600</span><br><span class="radioDesc">Load tool, measure with toolsetter, save offset</span></span>
              </label>
            </div>
          </div>
          <div class="sep"></div>
          <div class="stack-controls">
            <div class="sub">Spindle Feedback Unit</div>
            <div class="settingDesc">What unit does your spindle encoder / VFD driver output on the speed-in HAL pin? Simulators use RPS; most real VFDs output RPM directly.</div>
            <div class="radioGroup">
              <label>
                <MachineRadio gate="displaySetting" name="spindleFeedbackUnit" v-model="spindleFeedbackUnit" value="rps" @update:modelValue="saveMachine()" />
                <span><span class="radioLabel">RPS (default)</span><br><span class="radioDesc">Pin outputs revolutions per second (×60 for display)</span></span>
              </label>
              <label>
                <MachineRadio gate="displaySetting" name="spindleFeedbackUnit" v-model="spindleFeedbackUnit" value="rpm" @update:modelValue="saveMachine()" />
                <span><span class="radioLabel">RPM</span><br><span class="radioDesc">Pin outputs RPM directly (most VFDs)</span></span>
              </label>
            </div>
          </div>
          <div class="sep"></div>
          <div class="stack-controls">
            <div class="sub">Spindle Load HAL Pin</div>
            <div class="settingDesc">HAL pin that outputs spindle load percentage (e.g. <code>spindle-load-conv.load-percentage</code>). Leave empty to disable.</div>
            <MachineInput
              gate="displaySetting"
              type="text"
              v-model="spindleLoadPin"
              @change="saveMachine()"
              placeholder="e.g. spindle-load-conv.load-percentage"
              style="width: 100%"
            />
          </div>
          <div class="sep"></div>
          <div class="stack-controls">
            <div class="sub">Run from Line</div>
            <div class="settingDesc">Allow starting program execution from a selected line in the code viewer.</div>
            <MachineToggle gate="displaySetting" v-model="runFromLine" @update:modelValue="emit('setRunFromLine', runFromLine); saveMachine()" label="Enable run from line" />
            <div v-if="runFromLine" class="rflDefaults">
              <div class="settingDesc">Default spindle preset for run-from-line dialog.</div>
              <div class="rflRow">
                <div class="radioGroup inline">
                  <label><MachineRadio gate="displaySetting" name="rflSpindleDir" v-model="rflSpindleDir" value="off" @update:modelValue="saveMachine()" /> Off</label>
                  <label><MachineRadio gate="displaySetting" name="rflSpindleDir" v-model="rflSpindleDir" value="forward" @update:modelValue="saveMachine()" /> FWD</label>
                  <label><MachineRadio gate="displaySetting" name="rflSpindleDir" v-model="rflSpindleDir" value="reverse" @update:modelValue="saveMachine()" /> REV</label>
                </div>
                <div v-if="rflSpindleDir !== 'off'" class="row-tight rflRpm">
                  <label>RPM</label>
                  <MachineInput gate="displaySetting" type="number" v-model.number="rflSpindleRpm" min="0" :step="STEP_RPM" @change="saveMachine()" />
                </div>
              </div>
            </div>
          </div>
          <div class="resetRow">
            <MachineBtn type="reset" @click="resetTarget = 'machine'">Reset Machine</MachineBtn>
          </div>
        </div>
      </template>

      <template #display>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
          <div class="stack-controls">
            <div class="sub">Theme</div>
            <div class="radioGroup">
              <label><MachineRadio gate="displaySetting" name="theme" v-model="themeMode" value="auto" @update:modelValue="setTheme('auto')" /> Auto</label>
              <label><MachineRadio gate="displaySetting" name="theme" v-model="themeMode" value="light" @update:modelValue="setTheme('light')" /> Light</label>
              <label><MachineRadio gate="displaySetting" name="theme" v-model="themeMode" value="dark" @update:modelValue="setTheme('dark')" /> Dark</label>
              <label><MachineRadio gate="displaySetting" name="theme" v-model="themeMode" value="hc-light" @update:modelValue="setTheme('hc-light')" /> High Contrast Light</label>
              <label><MachineRadio gate="displaySetting" name="theme" v-model="themeMode" value="hc-dark" @update:modelValue="setTheme('hc-dark')" /> High Contrast Dark</label>
            </div>
          </div>
          <div class="sep"></div>
          <div class="stack-controls">
            <div class="sub">Fullscreen</div>
            <MachineToggle gate="displaySetting" v-model="startFullscreen" @update:modelValue="saveStartFullscreen" label="Start in fullscreen mode" />
          </div>
          <div class="sep"></div>
          <div class="stack-controls">
            <div class="sub">Keep Screen Awake</div>
            <MachineToggle gate="displaySetting" v-model="keepAwake" @update:modelValue="saveKeepAwake" label="Prevent screen lock while connected" />
          </div>
          <div class="resetRow">
            <MachineBtn type="reset" @click="resetTarget = 'display'">Reset Display</MachineBtn>
          </div>
        </div>
      </template>

      <template #macros>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
          <div class="stack-controls">
            <div class="sub">User Macros</div>

            <div v-if="macros.length === 0 && !editingMacro" class="macroSettingsEmpty">
              No macros configured. Click "Add Macro" to create one.
            </div>

            <div class="stack-controls macroSettingsList">
              <div v-for="(m, idx) in macros" :key="m.id" class="macroSettingsItem">
                <div class="macroSettingsInfo stack-micro">
                  <span class="macroSettingsName">{{ m.name }}</span>
                  <code class="macroSettingsCmd">{{ m.command }}</code>
                </div>
                <div class="macroSettingsActions">
                  <MachineBtn type="listAction" :disabled="idx === 0" @click="moveMacro(idx, -1)" title="Move up"><ChevronUp :size="14" /></MachineBtn>
                  <MachineBtn type="listAction" :disabled="idx === macros.length - 1" @click="moveMacro(idx, 1)" title="Move down"><ChevronDown :size="14" /></MachineBtn>
                  <MachineBtn type="listAction" @click="editMacro(m)" title="Edit"><Pencil :size="14" /></MachineBtn>
                  <MachineBtn type="listAction" @click="deleteMacro(m.id)" title="Delete"><Trash2 :size="14" /></MachineBtn>
                </div>
              </div>
            </div>

            <div v-if="editingMacro" class="macroEditForm">
              <div class="sub">{{ macros.some(m => m.id === editingMacro!.id) ? 'Edit' : 'New' }} Macro</div>
              <div class="stack-controls fieldGroup">
                <div class="row-controls inputRow">
                  <span class="inputLabel">Name</span>
                  <MachineInput gate="macroEdit" type="text" v-model="editingMacro.name" placeholder="e.g. Face Top" />
                </div>
                <div class="row-controls inputRow">
                  <span class="inputLabel">Command</span>
                  <MachineInput gate="macroEdit" type="text" v-model="editingMacro.command" placeholder="e.g. G0 Z{depth} F{feed}" />
                </div>
                <div class="macroParamHint">
                  Use <code>{"{name}"}</code> for parameters. Users will be prompted for values.
                </div>

                <div v-if="editingMacroParams.length > 0" class="macroParamEditor">
                  <div class="sub">Parameters</div>
                  <div v-for="p in editingMacroParams" :key="p.name" class="macroParamEditRow">
                    <code class="macroParamBadge">{{"{"}}{{ p.name }}{{"}"}}</code>
                    <MachineInput gate="macroEdit" type="text" v-model="p.label" placeholder="Display label" />
                    <MachineInput gate="macroEdit" type="text" v-model="p.default" placeholder="Default value" />
                  </div>
                </div>
              </div>
              <div class="macroEditActions">
                <MachineBtn type="dialogCancel" @click="editingMacro = null">Cancel</MachineBtn>
                <MachineBtn type="dialogConfirm" @click="saveMacro" :disabled="!editingMacro.name.trim() || !editingMacro.command.trim()">Save</MachineBtn>
              </div>
            </div>

            <MachineBtn v-if="!editingMacro && macros.length < 20" type="inline" @click="addMacro">Add Macro</MachineBtn>

          </div>
        </div>
      </template>

      <template #gamepad>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
          <GamepadTab
            :gamepad-config="props.gamepadConfig"
            :gamepad-connected="props.gamepadConnected"
            :gamepad-name="props.gamepadName"
            @set-gamepad-config="emit('setGamepadConfig', $event)"
          />
          <div class="resetRow">
            <MachineBtn type="reset" @click="resetTarget = 'gamepad'">Reset Gamepad</MachineBtn>
          </div>
        </div>
      </template>

      <template #keyboard>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
          <KeyboardTab
            :kb-config="props.keyboardConfig ?? defaultKbConfig"
            @set-keyboard-config="emit('setKeyboardConfig', $event)"
          />
          <div class="resetRow">
            <MachineBtn type="reset" @click="resetTarget = 'keyboard'">Reset Keyboard</MachineBtn>
          </div>
        </div>
      </template>

      <template #halshow>
        <HalshowTab :active="activeTab === 'halshow'" />
      </template>


      <template #debug>
        <DebugTab />
      </template>
    </TabPanel>

      <div v-if="resetTarget" class="dialogOverlay" @click.self="resetTarget = null">
        <div class="dialog">
          <div class="dialogTitle danger">Reset {{ resetLabels[resetTarget] }}</div>
          <div class="dialogBody">Restore {{ resetLabels[resetTarget] }} settings to defaults? This cannot be undone.</div>
          <Gate gate="setup" class="dialogActions">
            <MachineBtn type="dialogCancel" @click="resetTarget = null">Cancel</MachineBtn>
            <MachineBtn type="dialogDanger" @click="confirmReset">Reset</MachineBtn>
          </Gate>
        </div>
      </div>
  </div>
</template>

<style scoped>
.settingsLoading {
  padding: var(--gap-panel);
  opacity: var(--opacity-disabled);
}
.settings {
  padding: var(--gap-section);
  height: 100%;
  display: flex;
  flex-direction: column;
}

.hint {
  font-size: var(--fs-sm);
  opacity: var(--opacity-disabled);
  margin-bottom: var(--gap-section);
  flex-shrink: 0;
}

.resetRow {
  flex-shrink: 0;
  padding-top: var(--gap-section);
  display: flex;
  justify-content: flex-end;
}

.scrollContent {
  overflow-y: auto;
  height: 100%;
  position: relative;
}


/* .section — replaced by stack-controls utility (same shape) */

.wpColumns {
  display: flex;
  gap: var(--gap-panel);
}

.wpColumns .fieldGroup {
  flex: 1;
  margin-bottom: 0;
}

.fieldGroup {
  margin-bottom: var(--gap-section);
}

/* .inputRow layout replaced by row-controls utility on the template element.
   The .inputRow class is retained as a hook for the descendant rule below. */
.inputRow input[type="text"] {
  flex: 1;
  min-width: 0;
}

.inputLabel {
  font-size: var(--fs-base);
  opacity: var(--opacity-secondary);
  min-width: 60px;
}


.layerGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap-controls);
}

.layerGrid label {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  font-size: var(--fs-md);
  cursor: pointer;
  user-select: none;
}

.colorGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap-controls);
}

/* .colorRow — replaced by row-controls utility (same shape) */

.colorLabel {
  font-size: var(--fs-base);
  opacity: var(--opacity-secondary);
}

/* .camOverlayRow — replaced by row-controls utility (same shape) */

.camOverlayLabel {
  font-size: var(--fs-base);
  opacity: var(--opacity-secondary);
  min-width: 100px;
}

.camOverlaySlider {
  flex: 1;
}

.camOverlayValue {
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
  opacity: var(--opacity-muted);
  min-width: 32px;
  text-align: right;
}

.settingDesc {
  font-size: var(--fs-base);
  opacity: var(--opacity-muted);
  margin-bottom: var(--gap-section);
}


.rflDefaults {
  margin-top: var(--gap-controls);
}

.rflRow {
  display: flex;
  align-items: center;
  gap: var(--gap-section);
  margin-top: var(--gap-tight);
}

/* .rflRpm layout replaced by row-tight utility on the template element.
   The .rflRpm class is retained as a hook for the descendant rule below. */
.rflRpm input {
  width: 90px;
}

/* ─── Macros tab ─────────────────────────────────────────────── */
.macroSettingsEmpty {
  opacity: var(--opacity-disabled);
  text-align: center;
  padding: var(--gap-panel);
}
.macroSettingsList {
}
.macroSettingsItem {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  padding: var(--gap-tight) var(--gap-controls);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
}
.macroSettingsInfo {
  flex: 1;
  min-width: 0;
}
.macroSettingsName {
  font-weight: var(--fw-semibold);
}
.macroSettingsCmd {
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.macroSettingsActions {
  display: flex;
  gap: var(--gap-tight);
  flex-shrink: 0;
}
.macroEditForm {
  margin-top: var(--gap-section);
  padding: var(--gap-controls);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
}
.macroParamHint {
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
}
.macroParamEditor {
  margin-top: var(--gap-controls);
}
.macroParamEditRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  margin-top: var(--gap-tight);
}
.macroParamBadge {
  font-size: var(--fs-sm);
  min-width: 70px;
  flex-shrink: 0;
}
.macroEditActions {
  display: flex;
  justify-content: flex-end;
  gap: var(--gap-controls);
  margin-top: var(--gap-section);
}

</style>
