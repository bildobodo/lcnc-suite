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
  ON_TOP_LAYERS, type OnTopLayer, type Layer, type ColorDefaults, type PaletteMode, type PaletteOrigin, type HudDefaults, type HudScale,
  type TrackMode, type Projection, type PreviewMode, type ToolChangeMode, type SpindleDir, type SpindleFeedbackUnit,
  type ThemeMode, type MacroDef, type GamepadDefaults,
  GAMEPAD_FALLBACK,
  loadKeyboardDefaults, type KeyboardDefaults, DEFAULT_KB_MAPPING,
} from "./defaults";
import { resolveViewerPalette, userColorsOf, USER_ROLES, type UserRole, type ViewerRole } from "./viewer/viewerPalette";
import { LAYER_GROUPS, HUD_LAYER } from "./viewerLayerGroups";
import { saveStatus, saveStatusText } from "./settingsSaveStatus";
import { fmtNum, fmtPct, fmtRatio } from "./format";
import { customContrastRows, customPairRows } from "./viewer/customContrast";
import type { MappingSource } from "./gamepadProfile";
import { enableWakeLock, disableWakeLock } from "./wakeLock";
import { ChevronUp, ChevronDown, Pencil, Trash2, RotateCcw, Triangle, X } from "lucide-vue-next";
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
const applyPaletteFromSettings = inject<() => void>("applyPaletteFromSettings", () => {});
// The theme the legend's colours come from (App: the explicit theme, else
// the system scheme) — a switch re-resolves the shown palette.
const isDark = inject<Ref<boolean>>("isDark", ref(false));   // with themeMode (below)
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
  (e: "setLayerOnTop", layer: OnTopLayer, on: boolean): void;
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
  paletteMode.value = vd.paletteMode;
  paletteOrigin.value = vd.paletteOrigin;
  for (const k of Object.keys(colors)) delete colors[k as keyof ColorDefaults];
  Object.assign(colors, vd.colors);
  Object.assign(hud, vd.hud);
  for (const k of Object.keys(machineColors)) delete machineColors[k];
  Object.assign(machineColors, vd.machineColors);
  trackingMode.value = vd.trackingMode;
  Object.assign(onTop, vd.onTop);
  machineEdgesOn.value = vd.machineEdges;
  projection.value = vd.projection;
  previewMode.value = vd.previewMode;
  for (const l of ON_TOP_LAYERS) emit("setLayerOnTop", l, vd.onTop[l]);
  emit("setProjection", vd.projection);
  setMachineEdges(vd.machineEdges);
  applyPaletteFromSettings();   // back to Automatic
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
const paletteMode = ref<PaletteMode>(saved.paletteMode);
const paletteOrigin = ref<PaletteOrigin | undefined>(saved.paletteOrigin);
const colors = reactive<Partial<ColorDefaults>>({ ...saved.colors });
const machineColors = reactive<Record<string, string>>({ ...saved.machineColors });
const trackingMode = ref<TrackMode>(saved.trackingMode);
const onTop = reactive<Record<OnTopLayer, boolean>>({ ...saved.onTop });
const machineEdgesOn = ref(saved.machineEdges);
const projection = ref<Projection>(saved.projection);
const previewMode = ref<PreviewMode>(saved.previewMode);
const hud = reactive<HudDefaults>({ ...saved.hud });

function save() {
  saveViewerDefaults({
    layers: { ...layers },
    paletteMode: paletteMode.value,
    ...(paletteOrigin.value ? { paletteOrigin: paletteOrigin.value } : {}),
    colors: { ...colors },
    machineColors: { ...machineColors },
    machineEdges: machineEdgesOn.value,
    trackingMode: trackingMode.value,
    onTop: { ...onTop },
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
function onLayerChange(layer: Layer, on: boolean) {
  layers[layer] = on;
  save();
  emit("toggleLayer", layer, on);
}

/** The layers the "On top" column offers (lines and markers, never a body). */
const offersOnTop = (l: Layer): l is OnTopLayer => (ON_TOP_LAYERS as readonly string[]).includes(l);

function onLayerOnTopChange(layer: OnTopLayer, on: boolean) {
  onTop[layer] = on;
  save();
  emit("setLayerOnTop", layer, on);
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
  paletteMode.value = vd.paletteMode;
  paletteOrigin.value = vd.paletteOrigin;
  for (const k of Object.keys(colors)) delete colors[k as keyof ColorDefaults];
  Object.assign(colors, vd.colors);
  Object.assign(machineColors, vd.machineColors);
  trackingMode.value = vd.trackingMode;
  Object.assign(onTop, vd.onTop);
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



// ─── Viewer palette (design wave D8c, UI-K08 / UI-D05) ─────────────
// What the viewer draws, resolved like the viewer resolves it: the theme's
// --viewer-* roles, the Custom colours over the seven user roles.
const shownPalette = computed(() => {
  void isDark.value; void themeMode.value;   // a theme switch re-resolves
  return resolveViewerPalette(n => getComputedStyle(document.documentElement).getPropertyValue(n),
    { paletteMode: paletteMode.value, colors });
});

function onPaletteModeChange(mode: PaletteMode) {
  // The first switch to Custom starts from what is drawn — never from a
  // retired default; a Custom palette kept through Automatic comes back.
  if (mode === "custom" && USER_ROLES.every(r => !colors[r])) Object.assign(colors, userColorsOf(shownPalette.value));
  paletteMode.value = mode;
  paletteOrigin.value = "operator";   // an explicit choice (viewer contrast plan, V6)
  save();
  applyPaletteFromSettings();
}

function onColorChange(key: UserRole, value: string) {
  colors[key] = value;
  paletteOrigin.value = "operator";
  save();
  applyPaletteFromSettings();   // live on the existing lines and materials
}

// The legend (every role, in drawing order); in Custom the seven user roles
// are the colour pickers, the two finding roles stay the theme's.
const PALETTE_ROWS: { role: ViewerRole; label: string; dashed?: boolean; twoTone?: boolean }[] = [
  { role: "feed", label: "Toolpath" },
  { role: "rapid", label: "Rapid", dashed: true },
  { role: "backplot", label: "Backplot" },
  { role: "limit", label: "Limit violation" },
  { role: "collision", label: "Collision" },
  { role: "bounds", label: "Machine Bounds", twoTone: true },
  { role: "toolpathBounds", label: "Toolpath Bounds", twoTone: true },
  { role: "tool", label: "Tool Shaft" },
  { role: "cutter", label: "Tool Cutter" },
];
const isUserRole = (r: ViewerRole): r is UserRole => (USER_ROLES as readonly string[]).includes(r);
// A line sample's colour; a two-tone box names both tones (its colour and the light dashes).
const legendStyle = (role: ViewerRole, twoTone?: boolean) =>
  twoTone ? { "--tone-a": shownPalette.value[role], "--tone-b": shownPalette.value.boundsAlt } : { color: shownPalette.value[role] };
// The Custom palette's contrast, told and never corrected (plan K3, Codex
// R25 OP-I05): each custom line on the background and on the lit table
// (viewer/customContrast.ts — the rules themeTokens.test.ts holds the
// automatic palettes to).
const CONTRAST_LABEL: Record<string, string> = Object.fromEntries(PALETTE_ROWS.map(r => [r.role, r.label]));
const contrastRows = computed(() => {
  if (paletteMode.value !== "custom") return [];
  void isDark.value;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  return customContrastRows(shownPalette.value, bg, themeMode.value.startsWith("hc"))
    .map(r => ({ ...r, label: CONTRAST_LABEL[r.role] ?? r.role }));
});
// "low" in words, not the warn colour alone
const ratioCell = (v: number | null, low: boolean) => `${fmtRatio(v)}${low && v != null ? " · low" : ""}`;
// The lines against each other (the palette's pair rule, operator
// 2026-09-28): the OKLab distance — "close" in words.
const pairRows = computed(() => {
  if (paletteMode.value !== "custom") return [];
  return customPairRows(shownPalette.value, themeMode.value)
    .map(r => ({ ...r, label: `${CONTRAST_LABEL[r.a] ?? r.a} / ${CONTRAST_LABEL[r.b] ?? r.b}` }));
});
const apartCell = (v: number | null, low: boolean) => `${fmtNum(v, 2)}${low && v != null ? " · close" : ""}`;

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
        <!-- Two columns where they fit (operator 2026-09-30): the grouped
             layers left; View, HUD and Camera Overlay right; the colours
             below across both. One column reads them in this order. -->
        <div class="sectionColumns">
          <div class="stack-controls">
            <div class="sub">Layers</div>
            <div class="settingDesc">On top: drawn over the machine, where a machine part stands in front.</div>
            <!-- Shown | legend | On top (operator 2026-09-30). The column heads are
                 the first body row: .dataTable's sticky head covers the top row
                 inside the scrolling Settings page (KeyboardTab). The layers in
                 four row groups (viewerLayerGroups.ts). -->
            <div class="dataTable layerTable" data-layer-legend>
              <table>
                <tbody>
                  <tr>
                    <th scope="col">Layer</th>
                    <th scope="col">On top</th>
                  </tr>
                </tbody>
                <tbody v-for="g in LAYER_GROUPS" :key="g.id" :data-layer-group="g.id">
                  <tr class="layerGroupHead">
                    <th scope="rowgroup" colspan="2">{{ g.label }}</th>
                  </tr>
                  <tr v-for="lf in g.rows" :key="lf.key" :data-layer="lf.key">
                    <!-- The line sample at the cell's end, under the name where
                         the dialog is narrow (150 % portrait) -->
                    <td>
                      <div class="layerCell">
                        <MachineToggle
                          gate="viewerSetting"
                          :modelValue="layers[lf.key]"
                          @update:modelValue="onLayerChange(lf.key, $event!)"
                          :label="lf.label"
                          :help="lf.help"
                        />
                        <span v-if="lf.role" class="legendLine" :class="{ dashed: lf.dashed, twoTone: lf.twoTone }"
                              :style="legendStyle(lf.role, lf.twoTone)" aria-hidden="true"></span>
                      </div>
                    </td>
                    <td>
                      <MachineToggle
                        v-if="offersOnTop(lf.key)"
                        gate="viewerSetting"
                        :modelValue="onTop[lf.key]"
                        @update:modelValue="onLayerOnTopChange(lf.key as OnTopLayer, $event!)"
                        :aria-label="`${lf.label} on top`"
                        data-on-top
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- The findings drawn ON the path: the same glyph as the timeline
                 and the code panel, the colour the 3D view draws. -->
            <!-- One grid for both rows (live look 2026-10-01): glyph, line
                 sample, text — the texts start at one x (the collision is a
                 body: its line cell stays empty), and glyph and sample sit
                 on the text's FIRST line however the text wraps. -->
            <div class="findingLegend" data-finding-legend>
              <div class="findingRow" data-role="limit">
                <span class="findingCell"><Triangle :size="12" fill="currentColor" :style="{ color: shownPalette.limit }" aria-hidden="true" /></span>
                <span class="findingCell"><span class="legendLine" :style="{ color: shownPalette.limit }" aria-hidden="true"></span></span>
                <span class="settingDesc findingText">Limit violation — on the path, the box outside the machine window dashed</span>
              </div>
              <div class="findingRow" data-role="collision">
                <span class="findingCell"><X :size="12" :stroke-width="3" :style="{ color: shownPalette.collision }" aria-hidden="true" /></span>
                <span class="findingCell" aria-hidden="true"></span>
                <span class="settingDesc findingText">Collision — the machine part glows</span>
              </div>
            </div>
          </div>
          <div class="stack-panel">
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
              <div class="sub">HUD</div>
              <MachineToggle gate="viewerSetting" :modelValue="layers[HUD_LAYER]" @update:modelValue="onLayerChange(HUD_LAYER, $event!)" label="Show HUD" />
              <div class="settingDesc">Largest scale of the position readout. In a short or narrow viewer it steps down to fit.</div>
              <div class="radioGroup inline">
                <label v-for="s in HUD_SCALES" :key="s.value">
                  <MachineRadio gate="viewerSetting" name="hudScale" :modelValue="hud.scale" :value="s.value" @update:modelValue="hud.scale = s.value; save()" /> {{ s.label }}
                </label>
              </div>
              <div class="settingDesc">Sections shown on the HUD card. A short viewer folds Machine, F / S and the tool line first. Warnings are always shown, at the viewer's bottom edge.</div>
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
              <div class="sub">Camera Overlay</div>
              <div class="settingDesc">Overlays drawn on top of the camera PIP feed.</div>
              <div class="layerGrid">
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
          </div>
        </div>

        <div class="sep"></div>

        <div class="stack-controls">
          <div class="sub">Colors</div>
          <div class="settingDesc">Automatic colors are the checked ones, the same in every theme. Custom colors stay as you set them; their contrast is shown, never corrected.</div>
          <div class="radioGroup inline">
            <label><MachineRadio gate="viewerSetting" name="paletteMode" :modelValue="paletteMode" value="auto" @update:modelValue="onPaletteModeChange('auto')" /> Automatic</label>
            <label><MachineRadio gate="viewerSetting" name="paletteMode" :modelValue="paletteMode" value="custom" @update:modelValue="onPaletteModeChange('custom')" /> Custom</label>
          </div>
          <!-- A Custom palette nobody chose here (viewer contrast plan, V6):
               from an earlier version — certain only when it was stored
               without a mode — or of unknown origin, which claims nothing. -->
          <div v-if="paletteMode === 'custom' && paletteOrigin === 'legacy'" class="statusNote warn" role="alert" data-palette-note="legacy">
            <span>Colors from an earlier version — Automatic uses the checked colors</span>
            <MachineBtn type="inline" @click="onPaletteModeChange('auto')">Use automatic colors</MachineBtn>
          </div>
          <div v-else-if="paletteMode === 'custom' && !paletteOrigin" class="row-controls" data-palette-note="unknown">
            <MachineBtn type="inline" @click="onPaletteModeChange('auto')">Use automatic colors</MachineBtn>
          </div>
          <!-- The legend: a line sample per role (dashed = rapid); in Custom
               the user roles are pickers named by their label. -->
          <div class="colorGrid" data-viewer-legend>
            <template v-for="row in PALETTE_ROWS" :key="row.role">
              <label v-if="paletteMode === 'custom' && isUserRole(row.role)" class="row-controls">
                <MachineColor
                  gate="viewerSetting"
                  :modelValue="shownPalette[row.role]"
                  @update:modelValue="onColorChange(row.role as UserRole, $event!)"
                />
                <span class="colorLabel">{{ row.label }}</span>
              </label>
              <div v-else class="row-controls" :data-role="row.role">
                <span class="legendLine" :class="{ dashed: row.dashed, twoTone: row.twoTone }" :style="legendStyle(row.role, row.twoTone)" aria-hidden="true"></span>
                <span class="colorLabel">{{ row.label }}</span>
              </div>
            </template>
          </div>
          <template v-if="contrastRows.length">
            <div class="settingDesc">Contrast: a line needs 3 : 1 on the background (4.5 : 1 in high contrast) and 1.8 : 1 on the machine's grey surfaces; a two-tone box needs one of its tones.</div>
            <div class="dataTable" data-contrast-hint>
              <table>
                <thead><tr><th>Color</th><th>On background</th><th>On the machine</th></tr></thead>
                <tbody>
                  <tr v-for="r in contrastRows" :key="r.role" :data-role="r.role">
                    <td>{{ r.label }}</td>
                    <td :class="{ 'text-warn': r.bgLow }">{{ ratioCell(r.onBg, r.bgLow) }}</td>
                    <td :class="{ 'text-warn': r.modelLow }">{{ ratioCell(r.onModel, r.modelLow) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="settingDesc">Apart: two lines need 0.25 (0.24 in dark high contrast).</div>
            <div class="dataTable" data-pair-hint>
              <table>
                <thead><tr><th>Lines</th><th>Apart</th></tr></thead>
                <tbody>
                  <tr v-for="r in pairRows" :key="`${r.a}/${r.b}`" :data-pair="`${r.a}/${r.b}`">
                    <td>{{ r.label }}</td>
                    <td :class="{ 'text-warn': r.normalLow }">{{ apartCell(r.normal, r.normalLow) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
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

            <div class="stack-controls">
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
/* The findings legend: three columns shared by both rows; a cell is one
   text line high (1lh at the description's size) and centres its glyph or
   line sample on it. */
.findingLegend {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  column-gap: var(--gap-controls);
  row-gap: var(--gap-tight);
  align-items: start;
}
.findingRow { display: contents; }
.findingCell {
  display: flex;
  align-items: center;
  font-size: var(--fs-base);
  height: 1lh;
}
.findingText { margin-bottom: 0; }
.settingsLoading { padding: var(--gap-panel); }
/* A line may end in a "?" (a layer's help): its invisible hit area reaches
   past the glyph, and in a scroller that is overflow (2 px sideways at 150 %
   portrait) — the end padding holds the reach, the negative margin gives
   the width back (CLAUDE.md, "An invisible hit area is real overflow"). */
.scrollContent {
  --help-reach: calc((var(--help-hit) - var(--help-icon-size)) / 2);
  padding-inline-end: var(--help-reach);
  margin-inline-end: calc(-1 * var(--help-reach));
}

/* No padding of its own: the dialog's content box pads it (a second
   --gap-section took 48 px of the 248 px dialog at 150 % portrait). */
.settings {
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

.fieldGroup {
  margin-bottom: var(--gap-section);
}




/* Toggles in two columns where each keeps --form-col-min, else one (the
   .formGrid rule): at 150 % portrait two fixed columns ran out sideways. */
.layerGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit,
    minmax(min(100%, max(var(--form-col-min), calc((100% - var(--gap-controls)) / 2))), 1fr));
  gap: var(--gap-controls);
}

/* A row group's name (viewerLayerGroups.ts) stands a section's step below
   the rows of the group above it. */
.layerTable .layerGroupHead > th { padding-top: var(--gap-section); }
/* The layer's switch, then its line sample at the cell's end — under the
   name where the column is narrow. */
.layerCell {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  column-gap: var(--gap-controls);
  row-gap: var(--gap-tight);
}

.layerGrid label,
.layerTable label {
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
}










/* ─── Macros tab ─────────────────────────────────────────────── */
.macroSettingsEmpty { padding: var(--gap-panel); }
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
