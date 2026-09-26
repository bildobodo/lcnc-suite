<script setup lang="ts">
import { ref, reactive, computed, inject, watch, type Ref, type ComputedRef } from "vue";
import DialogFrame from "./DialogFrame.vue";
import { defaultPartHex } from "./viewer/palette";
import TabPanel from "./TabPanel.vue";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineToggle from "./MachineToggle.vue";
import MachineSlider from "./MachineSlider.vue";
import MachineRadio from "./MachineRadio.vue";
import MachineColor from "./MachineColor.vue";
import FormField from "./FormField.vue";
import {
  loadViewerDefaults, saveViewerDefaults, viewerFallback,
  loadMachineDefaults, saveMachineDefaults,
  loadMacrosDefaults, saveMacrosDefaults, syncMacroParams,
  loadDisplayDefaults, saveDisplayDefaults, settingsVersion, serverSettingsReady,
  loadCameraDefaults, saveCameraDefaults,
  type Layer, type ColorDefaults, type HudDefaults, type HudScale,
  type TrackMode, type Projection, type PreviewMode, type ToolChangeMode, type SpindleDir, type SpindleFeedbackUnit,
  type ThemeMode, type MacroDef, type GamepadDefaults,
  GAMEPAD_FALLBACK,
  loadKeyboardDefaults, type KeyboardDefaults, DEFAULT_KB_MAPPING,
} from "./defaults";
import { saveStatus, saveStatusText } from "./settingsSaveStatus";
import { fmtPct } from "./format";
import type { MappingSource } from "./gamepadProfile";
import { enableWakeLock, disableWakeLock } from "./wakeLock";
import { ChevronUp, ChevronDown, Pencil, Trash2, RotateCcw } from "lucide-vue-next";
import DebugTab from "./DebugTab.vue";
import HalshowTab from "./HalshowTab.vue";
import KeyboardTab from "./KeyboardTab.vue";
import GamepadTab from "./GamepadTab.vue";


const themeMode = inject<Ref<ThemeMode>>("themeMode", ref("auto") as Ref<ThemeMode>);
const setTheme = inject<(mode: ThemeMode) => void>("setTheme", () => {});
const startFullscreen = ref(loadDisplayDefaults().startFullscreen);
const keepAwake = ref(loadDisplayDefaults().keepAwake);
const machineParts = inject<ComputedRef<Array<{ id: string; group: string | null; direction: string | null; color: [number, number, number] | null }>>>("machineParts", computed(() => []));
const setMachinePartColor = inject<(id: string, color: string | null) => void>("setMachinePartColor", () => {});
const setMachineEdges = inject<(on: boolean) => void>("setMachineEdges", () => {});
const setToolColors = inject<(toolColor: string | null, cutterColor: string | null) => void>("setToolColors", () => {});
const setPathColors = inject<(c: { feed?: string; rapid?: string; backplot?: string; bounds?: string; toolpathBounds?: string }) => void>("setPathColors", () => {});
const updateMacros = inject<(macros: MacroDef[]) => void>("updateMacros", () => {});

// ─── Macros CRUD ────────────────────────────────────────────────
const macros = ref<MacroDef[]>(loadMacrosDefaults().macros);
const editingMacro = ref<MacroDef | null>(null);
// The editor's state when it opened: closing Settings over a CHANGED draft
// asks first (UI-K16) — every close path (X, backdrop, header navigation)
// used to unmount this panel and lose the draft without a word.
const macroSnapshot = ref("");
function snapshotMacro() { macroSnapshot.value = JSON.stringify(editingMacro.value); }
const gamepadTabRef = ref<{ wizardOpen: () => boolean } | null>(null);
/** What closing Settings would throw away, in operator words — null when
 *  nothing (settings themselves save automatically). */
function unsavedDraft(): string | null {
  if (editingMacro.value && JSON.stringify(editingMacro.value) !== macroSnapshot.value) return "The macro you are editing";
  if (gamepadTabRef.value?.wizardOpen()) return "The gamepad mapping in progress";
  return null;
}
defineExpose({ unsavedDraft });

// Keep the macro's params in sync with the {placeholders} in its command as the
// user types. A watcher (not a computed) owns this mutation; the template binds
// to editingMacro.params directly. syncMacroParams preserves edits to params
// that remain, so editing a param then changing the command keeps the edit
// (issue #26).
watch(
  () => editingMacro.value?.command,
  () => {
    const m = editingMacro.value;
    if (m) m.params = syncMacroParams(m.command, m.params);
  },
);

function addMacro() {
  editingMacro.value = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: "",
    command: "",
    params: [],
  };
  snapshotMacro();
}

function editMacro(m: MacroDef) {
  const copy = { ...m, params: m.params.map(p => ({ ...p })) };
  // Reconcile params with the command on open: the watch fires only when the
  // command STRING changes, so switching between macros with identical commands
  // (but drifted stored params) wouldn't otherwise sync the editor (review #4).
  copy.params = syncMacroParams(copy.command, copy.params);
  editingMacro.value = copy;
  snapshotMacro();
}

function saveMacro() {
  if (!editingMacro.value) return;
  const m = editingMacro.value;
  if (!m.name.trim() || !m.command.trim()) return;
  // The editor watcher already keeps params in sync with the command; re-run
  // here to cover a save fired right after a command edit (idempotent).
  m.params = syncMacroParams(m.command, m.params);
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

// Deletion is confirmed via dialog — the trash button is a ~30px icon
// target and macro deletion is irreversible.
const macroDeleteId = ref<string | null>(null);
const macroDeleteName = computed(() => macros.value.find(m => m.id === macroDeleteId.value)?.name ?? "");
function confirmMacroDelete() {
  if (macroDeleteId.value) deleteMacro(macroDeleteId.value);
  macroDeleteId.value = null;
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
  gamepadMappingSource?: MappingSource | null;
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
  // Single source: the registered viewer fallback in defaults.ts.
  saveViewerDefaults(viewerFallback());
  const vd = loadViewerDefaults();
  Object.assign(layers, vd.layers);
  Object.assign(colors, vd.colors);
  Object.assign(hud, vd.hud);
  for (const k of Object.keys(machineColors)) delete machineColors[k];
  Object.assign(machineColors, vd.machineColors);
  trackingMode.value = vd.trackingMode;
  pathOnTop.value = vd.pathOnTop;
  machineEdgesOn.value = vd.machineEdges;
  projection.value = vd.projection;
  previewMode.value = vd.previewMode;
  emit("setPathOnTop", vd.pathOnTop);
  emit("setProjection", vd.projection);
  setMachineEdges(vd.machineEdges);
  setToolColors(null, null);
  for (const p of machineParts.value) setMachinePartColor(p.id, null);
}

function resetMachine() {
  saveMachineDefaults({
    toolChangeMode: "m6g43", runFromLine: false,
    rflSpindleDir: "forward", rflSpindleRpm: 10000, rflSafeZ: true,
    spindleFeedbackUnit: "rps", spindleLoadPin: "",
    autoDisarmMin: 10,
  });
  const md = loadMachineDefaults();
  toolChangeMode.value = md.toolChangeMode;
  runFromLine.value = md.runFromLine;
  rflSpindleDir.value = md.rflSpindleDir;
  rflSpindleRpm.value = md.rflSpindleRpm;
  spindleFeedbackUnit.value = md.spindleFeedbackUnit;
  spindleLoadPin.value = md.spindleLoadPin;
  autoDisarmMin.value = md.autoDisarmMin;
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
const previewMode = ref<PreviewMode>(saved.previewMode);
const hud = reactive<HudDefaults>({ ...saved.hud });

function save() {
  saveViewerDefaults({
    layers: { ...layers },
    colors: { ...colors },
    machineColors: { ...machineColors },
    machineEdges: machineEdgesOn.value,
    trackingMode: trackingMode.value,
    pathOnTop: pathOnTop.value,
    projection: projection.value,
    previewMode: previewMode.value,
    hud: { ...hud },
  });
}

const HUD_SCALES: { value: HudScale; label: string }[] = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Normal" },
  { value: "lg", label: "Large" },
  { value: "xl", label: "X-Large" },
];

const HUD_TOGGLES: { key: keyof Omit<HudDefaults, "scale">; label: string }[] = [
  { key: "showMachine", label: "Machine Position" },
  { key: "showTool", label: "Tool Context" },
  { key: "showFeedSpindle", label: "Feed & spindle" },
  { key: "showLoadBar", label: "Spindle load bar" },
];

// ─── Viewer setting handlers (emit to App.vue → ThreeViewer) ──────
const LAYER_LABELS: { key: Layer; label: string }[] = [
  { key: "backplot", label: "Backplot" },
  { key: "toolpath", label: "Toolpath" },
  { key: "workzero", label: "Work Zero" },
  { key: "workplane", label: "Work Plane" },
  { key: "surface", label: "Surface" },
  { key: "toolpathBounds", label: "Toolpath Bounds" },
  { key: "bounds", label: "Machine Bounds" },
  { key: "reachRoom", label: "Machine Reach" },
  { key: "reachPart", label: "Part Reach" },
  { key: "machine", label: "Machine" },
  { key: "groundGrid", label: "Ground Grid" },
  { key: "tool", label: "Tool" },
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

function onPreviewModeChange(mode: PreviewMode) {
  previewMode.value = mode;
  // No direct emit: ThreeViewer rebuilds the toolpath from the settings echo
  // (settingsVersion watcher) — one path for this tab and remote tabs alike.
  save();
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
const autoDisarmMin = ref(machSaved.autoDisarmMin);

function saveMachine() {
  saveMachineDefaults({
    toolChangeMode: toolChangeMode.value,
    runFromLine: runFromLine.value,
    rflSpindleDir: rflSpindleDir.value,
    rflSpindleRpm: rflSpindleRpm.value,
    rflSafeZ: loadMachineDefaults().rflSafeZ,  // managed from the RFL dialog, preserved here
    spindleFeedbackUnit: spindleFeedbackUnit.value,
    spindleLoadPin: spindleLoadPin.value,
    autoDisarmMin: autoDisarmMin.value,
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
  autoDisarmMin.value = md.autoDisarmMin;
  emit("setRunFromLine", md.runFromLine);
  const vd = loadViewerDefaults();
  Object.assign(layers, vd.layers);
  Object.assign(colors, vd.colors);
  Object.assign(machineColors, vd.machineColors);
  trackingMode.value = vd.trackingMode;
  pathOnTop.value = vd.pathOnTop;
  machineEdgesOn.value = vd.machineEdges;
  projection.value = vd.projection;
  previewMode.value = vd.previewMode;
  Object.assign(hud, vd.hud);
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
  { id: "halshow", label: "HAL" },
  { id: "debug", label: "Debug" },
];
const activeTab = ref("viewer");

watch(() => props.initialTab, (t) => { if (t) activeTab.value = t; }, { immediate: true });



function onColorChange(key: keyof ColorDefaults, value: string) {
  colors[key] = value;
  save();
  if (key === "tool" || key === "cutter") {
    setToolColors(colors.tool, colors.cutter);
  } else {
    // feed / rapid / backplot / bounds / toolpathBounds — live-update the
    // existing lines (they used to apply only on the next program load).
    setPathColors({ ...colors });
  }
}

const colorFields: { key: keyof ColorDefaults; label: string }[] = [
  { key: "feed", label: "Toolpath" },
  { key: "rapid", label: "Rapid" },
  { key: "backplot", label: "Backplot" },
  { key: "bounds", label: "Machine Bounds" },
  { key: "toolpathBounds", label: "Toolpath Bounds" },
  { key: "tool", label: "Tool Shaft" },
  { key: "cutter", label: "Tool Cutter" },
];

// ─── Machine part colors ────────────────────
function defaultMachineColor(part: { direction: string | null; color: [number, number, number] | null }): string {
  // machine.json default color wins; then the palette's linear-axis /
  // frame rule (viewer/palette.ts — the same table the scene uses).
  if (part.color) {
    const hex = part.color.map(c => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("");
    return `#${hex}`;
  }
  return "#" + defaultPartHex(part.direction).toString(16).padStart(6, "0");
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
    <!-- The promise and its proof (UX-08): changes save on the server as they
         are made, except where a section shows Save/Cancel (macro editor,
         gamepad wizard) — and the status says what the last save did. -->
    <div class="settingsHead row-controls">
      <div class="hint">Changes save automatically and are shared across all connected clients.</div>
      <span class="saveStatus" :class="saveStatus.state" role="status" aria-live="polite">{{ saveStatusText(saveStatus) }}</span>
    </div>
    <TabPanel :tabs="subTabs" v-model="activeTab" label="Settings sections" class="subTabs">
      <template #viewer>
        <div v-if="!serverSettingsReady" class="emptyState loading settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin fade-scroll">
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
          <div class="settingDesc">Toolpath preview on rotary-axis machines — the path relative to the rotating workpiece (matches the backplot) or the programmed XYZ coordinates.</div>
          <div class="radioGroup inline">
            <label><MachineRadio gate="viewerSetting" name="previewMode" :modelValue="previewMode" value="part" @update:modelValue="onPreviewModeChange('part')" /> Path on part</label>
            <label><MachineRadio gate="viewerSetting" name="previewMode" :modelValue="previewMode" value="programmed" @update:modelValue="onPreviewModeChange('programmed')" /> Programmed XYZ</label>
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
          <div class="sub">HUD</div>
          <div class="settingDesc">Scale of the position readout overlay.</div>
          <div class="radioGroup inline">
            <label v-for="s in HUD_SCALES" :key="s.value">
              <MachineRadio gate="viewerSetting" name="hudScale" :modelValue="hud.scale" :value="s.value" @update:modelValue="hud.scale = s.value; save()" /> {{ s.label }}
            </label>
          </div>
          <div class="settingDesc">Sections shown on the HUD card. Warnings are always shown.</div>
          <div class="layerGrid">
            <MachineToggle
              v-for="t in HUD_TOGGLES" :key="t.key"
              gate="viewerSetting"
              :modelValue="hud[t.key]"
              @update:modelValue="hud[t.key] = $event!; save()"
              :label="t.label"
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
            label="Always on Top"
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
          <div class="formGrid">
            <FormField label="Circle Radius" unit="px">
              <template #default="{ input }">
                <MachineInput v-bind="input" gate="cameraSetting" type="number" v-model.number="camCircleRadius" min="10" max="300" integer @change="saveCamTracked" />
              </template>
            </FormField>
            <FormField label="Grid Spacing" unit="px">
              <template #default="{ input }">
                <MachineInput v-bind="input" gate="cameraSetting" type="number" v-model.number="camGridSpacing" min="10" max="200" integer @change="saveCamTracked" />
              </template>
            </FormField>
            <!-- A slider's head shows its value where a field shows its unit -->
            <FormField label="Opacity" :unit="fmtPct(camOverlayOpacity)">
              <template #default="{ field }">
                <MachineSlider v-bind="field" :aria-valuetext="fmtPct(camOverlayOpacity)" gate="cameraSetting" :min="0" :max="1" :step="0.05" v-model="camOverlayOpacity" @update:modelValue="saveCamTracked" />
              </template>
            </FormField>
            <FormField label="Color">
              <template #default="{ field }">
                <MachineColor v-bind="field" gate="cameraSetting" v-model="camOverlayColor" @update:modelValue="saveCamTracked" />
              </template>
            </FormField>
          </div>
        </div>

        <div class="sep"></div>

        <div class="stack-controls">
          <div class="sub">Colors</div>
          <div class="colorGrid">
            <label class="row-controls" v-for="cf in colorFields" :key="cf.key">
              <MachineColor
                gate="viewerSetting"
                :modelValue="colors[cf.key]"
                @update:modelValue="onColorChange(cf.key, $event!)"
              />
              <span class="colorLabel">{{ cf.label }}</span>
            </label>
          </div>
        </div>

        <div class="sep"></div>

        <div class="stack-controls" v-if="machineParts.length > 0">
          <div class="sub">Machine Colors</div>
          <div class="stack-controls fieldGroup">
            <div class="colorGrid">
              <div class="row-controls" v-for="part in machineParts" :key="part.id">
                <!-- the label names the picker; the reset stays outside it (a
                     button inside a label joins the picker's name) -->
                <label class="row-controls">
                  <MachineColor
                    gate="viewerSetting"
                    :modelValue="machineColors[part.id] ?? defaultMachineColor(part)"
                    @update:modelValue="onMachineColorChange(part.id, $event!)"
                  />
                  <span class="colorLabel">{{ formatPartLabel(part.id) }}</span>
                </label>
                <MachineBtn v-if="machineColors[part.id]" type="listAction" :aria-label="`Reset color for ${formatPartLabel(part.id)}`" :title="`Reset color for ${formatPartLabel(part.id)}`" @click="resetMachineColor(part.id)"><RotateCcw :size="14" /></MachineBtn>
              </div>
            </div>
            <MachineToggle gate="viewerSetting" v-model="machineEdgesOn" @update:modelValue="setMachineEdges(machineEdgesOn); save()" label="Edge Outline" />
          </div>
        </div>

        <div class="resetRow">
          <MachineBtn type="reset" @click="resetTarget = 'viewer'">Reset 3D Viewer</MachineBtn>
        </div>
        </div>
      </template>

      <template #machine>
        <div v-if="!serverSettingsReady" class="emptyState loading settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin fade-scroll">
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
            <div class="sub">Idle Auto-Disarm</div>
            <div class="settingDesc">Disarm this client after a period with no input while the machine is idle — protects an unattended touchscreen from stray taps. Never triggers while a program runs or is paused, while probing, or while a jog is held.</div>
            <div class="radioGroup inline">
              <label v-for="m in [0, 5, 10, 20, 30]" :key="m">
                <MachineRadio gate="displaySetting" name="autoDisarmMin" v-model.number="autoDisarmMin" :value="m" @update:modelValue="saveMachine()" />
                {{ m === 0 ? 'Off' : m + ' min' }}
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
              label="Spindle Load HAL Pin"
              @change="saveMachine()"
              placeholder="e.g. spindle-load-conv.load-percentage"
              class="w-full"
            />
          </div>
          <div class="sep"></div>
          <div class="stack-controls">
            <div class="sub">Run from Line</div>
            <div class="settingDesc">Allow starting program execution from a selected line in the code viewer.</div>
            <MachineToggle gate="displaySetting" v-model="runFromLine" @update:modelValue="emit('setRunFromLine', runFromLine); saveMachine()" label="Enable run from line (advanced — use with care)" />
            <div v-if="runFromLine" class="statusNote warn" role="alert">
              <span>Run-from-line is inherently risky: LinuxCNC reconstructs program
              state by skimming, entry moves follow modal axis words, and skipped
              passes may leave uncut material. The dialog guards tool changes and
              start position where it can, but it cannot cover every program —
              not recommended for unattended use.</span>
            </div>
            <div v-if="runFromLine" class="formGrid">
              <FormField label="Default Spindle Preset" group>
                <template #default="{ group }">
                  <!-- the spindle strip's order and words: Rev · Stop · Fwd (UI-N14) -->
                  <div v-bind="group" class="radioGroup inline">
                    <label><MachineRadio gate="displaySetting" name="rflDefaultSpindleDir" v-model="rflSpindleDir" value="reverse" @update:modelValue="saveMachine()" /> Rev</label>
                    <label><MachineRadio gate="displaySetting" name="rflDefaultSpindleDir" v-model="rflSpindleDir" value="off" @update:modelValue="saveMachine()" /> Stop</label>
                    <label><MachineRadio gate="displaySetting" name="rflDefaultSpindleDir" v-model="rflSpindleDir" value="forward" @update:modelValue="saveMachine()" /> Fwd</label>
                  </div>
                </template>
              </FormField>
              <FormField v-if="rflSpindleDir !== 'off'" label="Default Spindle Speed" unit="RPM">
                <template #default="{ input }">
                  <MachineInput v-bind="input" gate="displaySetting" type="number" v-model.number="rflSpindleRpm" min="0" @change="saveMachine()" />
                </template>
              </FormField>
            </div>
          </div>
          <div class="resetRow">
            <MachineBtn type="reset" @click="resetTarget = 'machine'">Reset Machine</MachineBtn>
          </div>
        </div>
      </template>

      <template #display>
        <div v-if="!serverSettingsReady" class="emptyState loading settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin fade-scroll">
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
        <div v-if="!serverSettingsReady" class="emptyState loading settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin fade-scroll">
          <div class="stack-controls">
            <div class="sub">User Macros</div>

            <div v-if="macros.length === 0 && !editingMacro" class="emptyState macroSettingsEmpty">
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
                  <MachineBtn type="listAction" @click="editMacro(m)" title="Edit" :aria-label="`Edit macro ${m.name}`"><Pencil :size="14" /></MachineBtn>
                  <!-- A destructive control names its target (UX-06) -->
                  <MachineBtn type="listAction" @click="macroDeleteId = m.id" title="Delete" :aria-label="`Delete macro ${m.name}`"><Trash2 :size="14" /></MachineBtn>
                </div>
              </div>
            </div>

            <div v-if="editingMacro" class="macroEditForm">
              <div class="sub">{{ macros.some(m => m.id === editingMacro!.id) ? 'Edit' : 'New' }} Macro</div>
              <div class="stack-controls fieldGroup">
                <div class="formGrid">
                  <FormField label="Name" wide>
                    <template #default="{ input }">
                      <MachineInput v-bind="input" gate="macroEdit" type="text" v-model="editingMacro.name" placeholder="e.g. Face Top" />
                    </template>
                  </FormField>
                  <FormField label="Command" wide>
                    <template #default="{ input }">
                      <MachineInput v-bind="input" gate="macroEdit" type="text" v-model="editingMacro.command" placeholder="e.g. G0 Z{depth} F{feed}" />
                    </template>
                  </FormField>
                </div>
                <div class="macroParamHint">
                  Use <code>{"{name}"}</code> for parameters. Users will be prompted for values.
                </div>

                <div v-if="editingMacro.params.length > 0" class="macroParamEditor">
                  <div class="sub">Parameters</div>
                  <div v-for="p in editingMacro.params" :key="p.name" class="macroParamEditRow">
                    <code class="macroParamBadge">{{"{"}}{{ p.name }}{{"}"}}</code>
                    <MachineInput gate="macroEdit" type="text" v-model="p.label" placeholder="Display label" :label="`${p.name} display label`" />
                    <MachineInput gate="macroEdit" type="text" v-model="p.default" placeholder="Default value" :label="`${p.name} default value`" />
                  </div>
                </div>
              </div>
              <div class="macroEditActions">
                <div class="hint">Unsaved edit — Save or Cancel</div>
                <MachineBtn type="dialogCancel" @click="editingMacro = null">Cancel</MachineBtn>
                <MachineBtn type="dialogConfirm" @click="saveMacro" :disabled="!editingMacro.name.trim() || !editingMacro.command.trim()">Save</MachineBtn>
              </div>
            </div>

            <MachineBtn v-if="!editingMacro && macros.length < 20" type="inlineMd" @click="addMacro">Add Macro</MachineBtn>

          </div>
        </div>
      </template>

      <template #gamepad>
        <div v-if="!serverSettingsReady" class="emptyState loading settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin fade-scroll">
          <GamepadTab
            ref="gamepadTabRef"
            :gamepad-config="props.gamepadConfig"
            :gamepad-connected="props.gamepadConnected"
            :gamepad-name="props.gamepadName"
            :gamepad-mapping-source="props.gamepadMappingSource"
            @set-gamepad-config="emit('setGamepadConfig', $event)"
          />
          <div class="resetRow">
            <MachineBtn type="reset" @click="resetTarget = 'gamepad'">Reset Gamepad</MachineBtn>
          </div>
        </div>
      </template>

      <template #keyboard>
        <div v-if="!serverSettingsReady" class="emptyState loading settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin fade-scroll">
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

      <!-- Nested confirmations stack over Settings (DialogFrame teleports
           them to the content area; Settings' helper pauses meanwhile). -->
      <DialogFrame v-if="macroDeleteId" kind="confirm" :title="`Delete macro &quot;${macroDeleteName}&quot;?`" danger
                   @close="macroDeleteId = null">
        <div class="dialogBody">Its button leaves the macro bar. This cannot be undone.</div>
        <template #actions>
          <MachineBtn type="dialogCancel" @click="macroDeleteId = null">Cancel</MachineBtn>
          <MachineBtn type="dialogDanger" @click="confirmMacroDelete">Delete</MachineBtn>
        </template>
      </DialogFrame>

      <DialogFrame v-if="resetTarget" kind="confirm" :title="`Reset ${resetLabels[resetTarget]} settings?`" danger
                   @close="resetTarget = null">
        <div class="dialogBody">Restores the {{ resetLabels[resetTarget] }} settings to their defaults. This cannot be undone.</div>
        <template #actions>
          <MachineBtn type="dialogCancel" @click="resetTarget = null">Cancel</MachineBtn>
          <Gate gate="setup" class="row-controls">
            <MachineBtn type="dialogDanger" @click="confirmReset">Reset</MachineBtn>
          </Gate>
        </template>
      </DialogFrame>
  </div>
</template>

<style scoped>
.settingsLoading { padding: var(--gap-panel); }
.settings {
  padding: var(--gap-section);
  height: 100%;
  display: flex;
  flex-direction: column;
}

.settingsHead {
  margin-bottom: var(--gap-section);
  flex-shrink: 0;
  align-items: baseline;
  flex-wrap: wrap;
}
/* The promise keeps a readable line; a long save status wraps below it
   instead of squeezing it to one word per line. */
.settingsHead > .hint { flex: 1 1 16rem; min-width: 0; }
.settingsHead > .saveStatus { flex: 0 1 auto; }
.macroEditActions > .hint { margin-right: auto; }
.hint {
  font-size: var(--fs-sm);
  color: var(--fg-muted);
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










/* ─── Macros tab ─────────────────────────────────────────────── */
.macroSettingsEmpty { padding: var(--gap-panel); }
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
  color: var(--fg-muted);
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
  color: var(--fg-muted);
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
