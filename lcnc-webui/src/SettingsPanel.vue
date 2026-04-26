<script setup lang="ts">
import { ref, reactive, computed, inject, onMounted, onUnmounted, watch, type Ref, type ComputedRef } from "vue";
import TabPanel from "./TabPanel.vue";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineToggle from "./MachineToggle.vue";
import MachineSlider from "./MachineSlider.vue";
import MachineSelect from "./MachineSelect.vue";
import MachineRadio from "./MachineRadio.vue";
import MachineColor from "./MachineColor.vue";
import {
  loadViewerDefaults, saveViewerDefaults,
  loadMachineDefaults, saveMachineDefaults,
  loadMacrosDefaults, saveMacrosDefaults, extractParams,
  loadDisplayDefaults, saveDisplayDefaults, settingsVersion, serverSettingsReady,
  loadCameraDefaults, saveCameraDefaults,
  STEP_DEFAULT,
  type Vec3, type Layer, type ColorDefaults, type OpacityDefaults,
  type TrackMode, type Projection, type ToolChangeMode, type SpindleDir, type SpindleFeedbackUnit,
  type ThemeMode, type MacroDef, type MacroParam, type GamepadDefaults,
  type GamepadMapping, GAMEPAD_ACTIONS, DEFAULT_MAPPING, GAMEPAD_FALLBACK,
  STEP_RPM,
  loadKeyboardDefaults, type KeyboardDefaults, type KeyboardAction, KEYBOARD_ACTION_LABELS, DEFAULT_KB_MAPPING, formatKeyName,
} from "./defaults";
import { viewerInit, halPins, halSignals, halParams, halInitialized, send, type HalPin, type HalParam } from "./lcncWs";
import { ChevronUp, ChevronDown, Pencil, Trash2 } from "lucide-vue-next";
import GamepadLiveInput from "./GamepadLiveInput.vue";
import DebugTab from "./DebugTab.vue";


const themeMode = inject<Ref<ThemeMode>>("themeMode", ref("auto") as Ref<ThemeMode>);
const setTheme = inject<(mode: ThemeMode) => void>("setTheme", () => {});
const startFullscreen = ref(loadDisplayDefaults().startFullscreen);
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
  (e: "update:workpieceSize", value: Vec3): void;
  (e: "update:workpieceOffset", value: Vec3): void;
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
    workpieceSize: [100, 100, 20], workpieceOffset: [0, 0, -20],
    layers: { backplot: true, toolpath: true, machine: true, workpiece: true, bounds: true, toolpathBounds: false, workzero: true, hud: true, surface: true, tool: true },
    colors: { feed: "#22b8cf", rapid: "#f5a623", backplot: "#ff00ff", bounds: "#ffffff", toolpathBounds: "#f5a623", workpiece: "#ffffff", tool: "#c0c0c0", cutter: "#ffdd00" },
    opacities: { workpiece: 0.16, bounds: 0.10, machine: 1.0, toolpath: 1.0, backplot: 0.55, hud: 1.0 },
    machineColors: {}, machineEdges: true, trackingMode: "none", pathOnTop: false, projection: "parallel",
  });
  const vd = loadViewerDefaults();
  wpSize.splice(0, 3, ...vd.workpieceSize);
  wpOffset.splice(0, 3, ...vd.workpieceOffset);
  Object.assign(layers, vd.layers);
  Object.assign(colors, vd.colors);
  Object.assign(opacities, vd.opacities);
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

function resetDisplay() {
  setTheme("auto");
  startFullscreen.value = false;
  saveDisplayDefaults({ theme: "auto", startFullscreen: false });
}

function resetGamepad() {
  const fb = { ...GAMEPAD_FALLBACK, mapping: { ...GAMEPAD_FALLBACK.mapping } };
  for (const k of Object.keys(gpMapping) as (keyof GamepadMapping)[]) {
    gpMapping[k] = fb.mapping[k];
  }
  emit("setGamepadConfig", fb);
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

// ─── Viewer setting handlers (emit to App.vue → ThreeViewer) ──────
const LAYER_LABELS: { key: Layer; label: string }[] = [
  { key: "backplot", label: "Backplot" },
  { key: "toolpath", label: "Toolpath" },
  { key: "workzero", label: "Work Zero" },
  { key: "surface", label: "Surface" },
  { key: "toolpathBounds", label: "Toolpath Bounds" },
  { key: "workpiece", label: "Stock Bounds" },
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

function onWpSizeChange(axis: number) {
  const value = wpSize[axis]!;
  if (isNaN(value) || value < 0) return;
  save();
  emit("update:workpieceSize", [...wpSize] as Vec3);
  if (axis === 2) {
    wpOffset[2] = -value;
    save();
    emit("update:workpieceOffset", [...wpOffset] as Vec3);
  }
}

function onWpOffsetChange(axis: number) {
  if (isNaN(wpOffset[axis]!)) return;
  save();
  emit("update:workpieceOffset", [...wpOffset] as Vec3);
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
  Object.assign(opacities, vd.opacities);
  Object.assign(machineColors, vd.machineColors);
  wpSize.splice(0, 3, ...vd.workpieceSize);
  wpOffset.splice(0, 3, ...vd.workpieceOffset);
  trackingMode.value = vd.trackingMode;
  pathOnTop.value = vd.pathOnTop;
  machineEdgesOn.value = vd.machineEdges;
  projection.value = vd.projection;
  const dd = loadDisplayDefaults();
  startFullscreen.value = dd.startFullscreen;
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
const kbConfig = ref<KeyboardDefaults>(props.keyboardConfig ?? loadKeyboardDefaults());
const listeningAction = ref<KeyboardAction | null>(null);
const captureError = ref("");
let captureErrorTimer: ReturnType<typeof setTimeout> | null = null;

// Sync from prop changes
watch(() => props.keyboardConfig, (cfg) => {
  if (cfg) kbConfig.value = cfg;
});

function saveKb() {
  emit("setKeyboardConfig", { ...kbConfig.value, mapping: { ...kbConfig.value.mapping } });
}

// Actions to show in the key binding table
const COMMAND_ACTIONS: KeyboardAction[] = ["estop", "cycle", "abort"];
const LINEAR_JOG_ACTIONS: KeyboardAction[] = ["jog_x+", "jog_x-", "jog_y+", "jog_y-", "jog_z+", "jog_z-"];
const ROTARY_JOG_ACTIONS: KeyboardAction[] = ["jog_a+", "jog_a-", "jog_b+", "jog_b-"];

// Show rotary rows only if machine has axes beyond XYZ
const hasRotaryAxes = computed(() => {
  const axes = viewerInit.value?.axes;
  return Array.isArray(axes) && axes.some((a: string) => !"XYZ".includes(a.toUpperCase()));
});

// Modifier keys to reject
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

function startCapture(action: KeyboardAction) {
  listeningAction.value = action;
  captureError.value = "";
  if (captureErrorTimer) clearTimeout(captureErrorTimer);
}

function handleCapture(e: KeyboardEvent) {
  if (!listeningAction.value) return;
  e.preventDefault();
  e.stopPropagation();

  // Reject modifier-only keys
  if (MODIFIER_KEYS.has(e.key)) return;

  // Reject Tab
  if (e.key === "Tab") {
    showCaptureError("Tab cannot be bound");
    return;
  }

  // Duplicate check
  const existing = Object.entries(kbConfig.value.mapping).find(
    ([a, k]) => k === e.key && a !== listeningAction.value
  );
  if (existing) {
    showCaptureError(`Already bound to ${KEYBOARD_ACTION_LABELS[existing[0] as KeyboardAction]}`);
    return;
  }

  // Accept the key
  kbConfig.value.mapping[listeningAction.value] = e.key;
  listeningAction.value = null;
  saveKb();
}

function showCaptureError(msg: string) {
  captureError.value = msg;
  if (captureErrorTimer) clearTimeout(captureErrorTimer);
  captureErrorTimer = setTimeout(() => { captureError.value = ""; }, 2000);
}

function unbindKey(action: KeyboardAction) {
  kbConfig.value.mapping[action] = "";
  saveKb();
}

function cancelCapture() {
  listeningAction.value = null;
  captureError.value = "";
}

function resetKeyboard() {
  kbConfig.value = {
    jogEnabled: false,
    buttonsEnabled: true,
    mapping: { ...DEFAULT_KB_MAPPING },
  };
  saveKb();
}

function onCaptureKeydown(e: KeyboardEvent) {
  if (listeningAction.value) handleCapture(e);
}

function onClickOutside(e: MouseEvent) {
  if (!listeningAction.value) return;
  const target = e.target as HTMLElement;
  if (!target.closest(".kbKeyCell")) cancelCapture();
}

onMounted(() => {
  window.addEventListener("keydown", onCaptureKeydown, true);
  window.addEventListener("click", onClickOutside);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onCaptureKeydown, true);
  window.removeEventListener("click", onClickOutside);
});

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
  { key: "workpiece", label: "Workpiece" },
  { key: "tool", label: "Tool Shaft" },
  { key: "cutter", label: "Tool Cutter" },
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

// ─── Gamepad button mapping ─────────────────
const GP_BTN_LABELS: Record<keyof GamepadMapping, string> = {
  btn_a: "A", btn_b: "B", btn_x: "X", btn_y: "Y",
  btn_lb: "LB", btn_rb: "RB", btn_lt: "LT", btn_rt: "RT",
  btn_back: "Back", btn_start: "Start", btn_ls: "LS", btn_rs: "RS",
};

const gpMapping = reactive<GamepadMapping>({ ...(props.gamepadConfig?.mapping ?? DEFAULT_MAPPING) });

watch(() => props.gamepadConfig?.mapping, (m) => {
  if (!m) return;
  for (const k of Object.keys(gpMapping) as (keyof GamepadMapping)[]) {
    if (gpMapping[k] !== m[k]) gpMapping[k] = m[k];
  }
});

// ─── Gamepad boolean wrappers (emit-based) ───
const gpJogEnabled = computed({ get: () => props.gamepadConfig?.jogEnabled ?? false, set: (v: boolean) => { emit('setGamepadConfig', { ...props.gamepadConfig!, jogEnabled: v }); } });
const gpButtonsEnabled = computed({ get: () => props.gamepadConfig?.buttonsEnabled ?? false, set: (v: boolean) => { emit('setGamepadConfig', { ...props.gamepadConfig!, buttonsEnabled: v }); } });
const gpInvertX = computed({ get: () => props.gamepadConfig?.invertX ?? false, set: (v: boolean) => { emit('setGamepadConfig', { ...props.gamepadConfig!, invertX: v }); } });
const gpInvertY = computed({ get: () => props.gamepadConfig?.invertY ?? false, set: (v: boolean) => { emit('setGamepadConfig', { ...props.gamepadConfig!, invertY: v }); } });
const gpInvertZ = computed({ get: () => props.gamepadConfig?.invertZ ?? false, set: (v: boolean) => { emit('setGamepadConfig', { ...props.gamepadConfig!, invertZ: v }); } });

function onGpMappingChanged() {
  if (!props.gamepadConfig) return;
  emit("setGamepadConfig", { ...props.gamepadConfig, mapping: { ...gpMapping } });
}

// ─── Halshow viewer ─────────────────────────
// Pin/signal/param topology + values are shared reactive state in lcncWs.ts;
// the gateway pushes a snapshot on subscribe and 5 Hz value deltas while the
// tab is visible. Subscribe/unsubscribe is wired to activeTab below.
type HalSection = "pins" | "signals" | "params";

const halSection = ref<HalSection>("pins");
const halSearch = ref("");
const halExpanded = ref(new Set<string>());

let _halSubscribed = false;
function _setHalshowLive(on: boolean) {
  if (on === _halSubscribed) return;
  _halSubscribed = on;
  send({ cmd: "halshow_live", on });
}

watch(activeTab, (next, prev) => {
  if (next === "halshow") _setHalshowLive(true);
  else if (prev === "halshow") _setHalshowLive(false);
}, { immediate: true });

onUnmounted(() => { _setHalshowLive(false); });

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
    <div class="hint">Settings are saved automatically and shared across all connected clients.</div>
    <TabPanel :tabs="subTabs" v-model="activeTab" class="subTabs">
      <template #viewer>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
        <div class="section">
          <div class="sub">View</div>
          <div class="settingDesc">Projection mode for the 3D viewport.</div>
          <div class="radioGroup inline">
            <label><MachineRadio gate="viewerSetting" name="projection" :modelValue="projection" value="perspective" @update:modelValue="onProjectionChange('perspective')" /> Perspective</label>
            <label><MachineRadio gate="viewerSetting" name="projection" :modelValue="projection" value="parallel" @update:modelValue="onProjectionChange('parallel')" /> Parallel</label>
          </div>
          <div class="settingDesc">Camera tracking — keep the tool or workpiece centered while it moves.</div>
          <div class="radioGroup inline">
            <label><MachineRadio gate="viewerSetting" name="tracking" :modelValue="trackingMode" value="none" @update:modelValue="onTrackModeChange('none')" /> None</label>
            <label><MachineRadio gate="viewerSetting" name="tracking" :modelValue="trackingMode" value="tool" @update:modelValue="onTrackModeChange('tool')" /> Tool</label>
            <label><MachineRadio gate="viewerSetting" name="tracking" :modelValue="trackingMode" value="workpiece" @update:modelValue="onTrackModeChange('workpiece')" /> Workpiece</label>
          </div>
        </div>

        <div class="sep"></div>

        <div class="section">
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

        <div class="section">
          <div class="sub">Toolpath</div>
          <MachineToggle
            gate="viewerSetting"
            :modelValue="pathOnTop"
            @update:modelValue="onPathOnTopChange($event!)"
            label="Always on top"
          />
        </div>

        <div class="sep"></div>

        <div class="section">
          <div class="sub">Workpiece</div>
          <div class="wpGrid">
            <div class="inputRow">
              <span class="inputLabel">Size X</span>
              <MachineInput gate="viewerSettingNum" type="number" v-model.number="wpSize[0]" @change="onWpSizeChange(0)" :step="STEP_DEFAULT" min="0" max="9999" />
            </div>
            <div class="inputRow">
              <span class="inputLabel">Size Y</span>
              <MachineInput gate="viewerSettingNum" type="number" v-model.number="wpSize[1]" @change="onWpSizeChange(1)" :step="STEP_DEFAULT" min="0" max="9999" />
            </div>
            <div class="inputRow">
              <span class="inputLabel">Size Z</span>
              <MachineInput gate="viewerSettingNum" type="number" v-model.number="wpSize[2]" @change="onWpSizeChange(2)" :step="STEP_DEFAULT" min="0" max="9999" />
            </div>
            <div class="inputRow">
              <span class="inputLabel">Offset X</span>
              <MachineInput gate="viewerSettingNum" type="number" v-model.number="wpOffset[0]" @change="onWpOffsetChange(0)" :step="STEP_DEFAULT" min="-9999" max="9999" />
            </div>
            <div class="inputRow">
              <span class="inputLabel">Offset Y</span>
              <MachineInput gate="viewerSettingNum" type="number" v-model.number="wpOffset[1]" @change="onWpOffsetChange(1)" :step="STEP_DEFAULT" min="-9999" max="9999" />
            </div>
            <div class="inputRow">
              <span class="inputLabel">Offset Z</span>
              <MachineInput gate="viewerSettingNum" type="number" v-model.number="wpOffset[2]" @change="onWpOffsetChange(2)" :step="STEP_DEFAULT" min="-9999" max="9999" />
            </div>
          </div>
        </div>

        <div class="sep"></div>

        <div class="section">
          <div class="sub">Camera Overlay</div>
          <div class="settingDesc">Overlays drawn on top of the camera PIP feed.</div>
          <div class="row-controls">
            <MachineToggle gate="cameraSetting" v-model="camShowCrosshair" @update:modelValue="saveCamTracked" label="Crosshair" />
            <MachineToggle gate="cameraSetting" v-model="camShowCircle" @update:modelValue="saveCamTracked" label="Circle" />
            <MachineToggle gate="cameraSetting" v-model="camShowGrid" @update:modelValue="saveCamTracked" label="Grid" />
          </div>
          <div class="inputRow">
            <span class="inputLabel">Radius</span>
            <MachineInput gate="cameraSetting" type="number" v-model.number="camCircleRadius" min="10" max="300" :step="1" @change="saveCamTracked" />
          </div>
          <div class="inputRow">
            <span class="inputLabel">Grid</span>
            <MachineInput gate="cameraSetting" type="number" v-model.number="camGridSpacing" min="10" max="200" :step="1" @change="saveCamTracked" />
          </div>
          <div class="opacityRow">
            <span class="opacityLabel">Opacity</span>
            <MachineSlider gate="cameraSetting" class="opacitySlider" :min="0" :max="1" :step="0.05" v-model="camOverlayOpacity" @update:modelValue="saveCamTracked" />
            <span class="opacityValue">{{ Math.round(camOverlayOpacity * 100) }}%</span>
          </div>
          <div class="inputRow">
            <span class="inputLabel">Color</span>
            <MachineColor gate="cameraSetting" v-model="camOverlayColor" @update:modelValue="saveCamTracked" />
          </div>
        </div>

        <div class="sep"></div>

        <div class="section">
          <div class="sub">Colors</div>
          <div class="colorGrid">
            <div class="colorRow" v-for="cf in colorFields" :key="cf.key">
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

        <div class="section">
          <div class="sub">Opacity</div>
          <div class="stack-controls opacityList">
            <div class="opacityRow" v-for="of_ in opacityFields" :key="of_.key">
              <span class="opacityLabel">{{ of_.label }}</span>
              <MachineSlider
                gate="viewerSetting"
                class="opacitySlider"
                :min="0" :max="1" :step="0.05"
                :modelValue="opacities[of_.key]"
                @update:modelValue="onOpacityChange(of_.key, $event!)"
              />
              <span class="opacityValue">{{ Math.round(opacities[of_.key] * 100) }}%</span>
            </div>
          </div>
        </div>

        <div class="sep"></div>

        <div class="section" v-if="machineParts.length > 0">
          <div class="sub">Machine Colors</div>
          <div class="stack-controls fieldGroup">
            <div class="colorGrid">
              <div class="colorRow" v-for="part in machineParts" :key="part.id">
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
          <div class="section">
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
          <div class="section">
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
          <div class="section">
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
          <div class="section">
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
                <div v-if="rflSpindleDir !== 'off'" class="rflRpm">
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
          <div class="section">
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
          <div class="section">
            <div class="sub">Fullscreen</div>
            <MachineToggle gate="displaySetting" v-model="startFullscreen" @update:modelValue="saveStartFullscreen" label="Start in fullscreen mode" />
          </div>
          <div class="resetRow">
            <MachineBtn type="reset" @click="resetTarget = 'display'">Reset Display</MachineBtn>
          </div>
        </div>
      </template>

      <template #macros>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
          <div class="section">
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
                <div class="inputRow">
                  <span class="inputLabel">Name</span>
                  <MachineInput gate="macroEdit" type="text" v-model="editingMacro.name" placeholder="e.g. Face Top" />
                </div>
                <div class="inputRow">
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
          <div class="section">
            <div class="sub">Gamepad</div>
            <div class="settingDesc">Use an Xbox, PlayStation, or standard gamepad to control the machine.</div>
            <MachineToggle gate="inputConfig" v-model="gpJogEnabled" label="Enable gamepad jogging" />
            <MachineToggle gate="inputConfig" v-model="gpButtonsEnabled" label="Enable gamepad buttons" />
          </div>

          <div class="sep"></div>

          <div class="section">
            <div class="sub">Connection</div>
            <div class="settingDesc" :class="{ okText: props.gamepadConnected }">
              {{ props.gamepadConnected ? props.gamepadName : 'No gamepad detected — connect one and press a button' }}
            </div>
          </div>

          <div class="sep" v-if="props.gamepadConfig?.jogEnabled"></div>

          <div v-if="props.gamepadConfig?.jogEnabled" class="section">
            <div class="sub">Axis Inversion</div>
            <div class="settingDesc">Flip axis direction if your gamepad moves the wrong way.</div>
            <MachineToggle gate="inputConfig" v-model="gpInvertX" label="Invert X" />
            <MachineToggle gate="inputConfig" v-model="gpInvertY" label="Invert Y" />
            <MachineToggle gate="inputConfig" v-model="gpInvertZ" label="Invert Z" />
          </div>

          <div class="sep" v-if="props.gamepadConfig?.jogEnabled"></div>

          <div v-if="props.gamepadConfig?.jogEnabled" class="section">
            <div class="sub">Dead Zone & Live Input</div>
            <div class="settingDesc">Ignore stick deflection below this threshold to prevent drift.</div>
            <div class="sliderRow">
              <MachineSlider
                gate="inputConfig"
                :min="0.05" :max="0.50" :step="0.01"
                :modelValue="props.gamepadConfig?.deadZone ?? 0.15"
                @update:modelValue="(v: number | undefined) => emit('setGamepadConfig', { ...props.gamepadConfig!, deadZone: v ?? 0.15 })"
              />
              <span class="sliderVal">{{ Math.round((props.gamepadConfig?.deadZone ?? 0.15) * 100) }}%</span>
            </div>
            <div v-if="props.gamepadConnected">
              <div class="settingDesc">Move sticks and press buttons to verify mapping.</div>
              <GamepadLiveInput :deadZone="props.gamepadConfig?.deadZone ?? 0.15" />
            </div>
          </div>

          <div class="sep" v-if="props.gamepadConfig?.buttonsEnabled"></div>

          <div v-if="props.gamepadConfig?.buttonsEnabled" class="section">
            <div class="sub">Button Mapping</div>
            <table class="gpMapTable">
              <tbody>
                <tr><td class="gpMapKey">Left Stick</td><td>XY continuous jog (proportional)</td></tr>
                <tr><td class="gpMapKey">Right Stick Y</td><td>Z continuous jog (proportional)</td></tr>
                <tr><td class="gpMapKey">D-pad</td><td>XY discrete jog (full speed)</td></tr>
                <tr v-for="(label, key) in GP_BTN_LABELS" :key="key">
                  <td class="gpMapKey">{{ label }}</td>
                  <td>
                    <MachineSelect
                      gate="inputConfig"
                      class="gpActionSelect"
                      v-model="gpMapping[key]"
                      @update:modelValue="onGpMappingChanged"
                    >
                      <option v-for="a in GAMEPAD_ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
                    </MachineSelect>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="resetRow">
            <MachineBtn type="reset" @click="resetTarget = 'gamepad'">Reset Gamepad</MachineBtn>
          </div>
        </div>
      </template>

      <template #keyboard>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
            <div class="section">
              <div class="sub">Keyboard</div>
              <div class="settingDesc">Allow keyboard keys to control the machine. E-Stop is always active regardless of these settings.</div>
              <MachineToggle gate="inputConfig" v-model="kbConfig.jogEnabled" @update:modelValue="saveKb()" label="Enable keyboard jogging" />
              <MachineToggle gate="inputConfig" v-model="kbConfig.buttonsEnabled" @update:modelValue="saveKb()" label="Enable keyboard shortcuts" />
            </div>

            <template v-if="kbConfig.jogEnabled || kbConfig.buttonsEnabled">
              <div class="sep"></div>

              <div class="section">
                <div class="sub">Key Bindings</div>
                <table class="kbMapTable">
                  <tbody>
                    <tr v-for="action in LINEAR_JOG_ACTIONS" :key="action" :class="{ inactive: !kbConfig.jogEnabled }">
                      <td class="kbMapAction">{{ KEYBOARD_ACTION_LABELS[action] }}</td>
                      <td class="kbKeyCell"
                          :class="{ listening: listeningAction === action }"
                          @click="startCapture(action)">
                        {{ listeningAction === action ? 'Press a key...' : formatKeyName(kbConfig.mapping[action]) }}
                      </td>
                      <td class="kbUnbind">
                        <MachineBtn type="close" v-if="kbConfig.mapping[action]" @click.stop="unbindKey(action)" title="Unbind">&times;</MachineBtn>
                      </td>
                    </tr>
                    <template v-if="hasRotaryAxes">
                    <tr v-for="action in ROTARY_JOG_ACTIONS" :key="action" :class="{ inactive: !kbConfig.jogEnabled }">
                      <td class="kbMapAction">{{ KEYBOARD_ACTION_LABELS[action] }}</td>
                      <td class="kbKeyCell"
                          :class="{ listening: listeningAction === action }"
                          @click="startCapture(action)">
                        {{ listeningAction === action ? 'Press a key...' : formatKeyName(kbConfig.mapping[action]) }}
                      </td>
                      <td class="kbUnbind">
                        <MachineBtn type="close" v-if="kbConfig.mapping[action]" @click.stop="unbindKey(action)" title="Unbind">&times;</MachineBtn>
                      </td>
                    </tr>
                    </template>
                    <tr class="kbSep"><td colspan="3"></td></tr>
                    <tr v-for="action in COMMAND_ACTIONS" :key="action" :class="{ inactive: !kbConfig.buttonsEnabled }">
                      <td class="kbMapAction">{{ KEYBOARD_ACTION_LABELS[action] }}</td>
                      <td class="kbKeyCell"
                          :class="{ listening: listeningAction === action }"
                          @click="startCapture(action)">
                        {{ listeningAction === action ? 'Press a key...' : formatKeyName(kbConfig.mapping[action]) }}
                      </td>
                      <td class="kbUnbind">
                        <MachineBtn type="close" v-if="kbConfig.mapping[action]" @click.stop="unbindKey(action)" title="Unbind">&times;</MachineBtn>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div v-if="captureError" class="kbCaptureError">{{ captureError }}</div>
              </div>
            </template>

            <div class="resetRow">
              <MachineBtn type="reset" @click="resetTarget = 'keyboard'">Reset Keyboard</MachineBtn>
            </div>
        </div>
      </template>

      <template #halshow>
        <div class="halPane">
          <!-- Header: section toggles + search (pinned) -->
          <div class="halHeader">
            <div class="btnGroup">
              <MachineBtn type="inline" :selected="halSection === 'pins'" class="optBtn"
                      @click="halSection = 'pins'">
                Pins <span class="halCount" v-if="halStats.pins">({{ halStats.pins }})</span>
              </MachineBtn>
              <MachineBtn type="inline" :selected="halSection === 'signals'" class="optBtn"
                      @click="halSection = 'signals'">
                Signals <span class="halCount" v-if="halStats.signals">({{ halStats.signals }})</span>
              </MachineBtn>
              <MachineBtn type="inline" :selected="halSection === 'params'" class="optBtn"
                      @click="halSection = 'params'">
                Params <span class="halCount" v-if="halStats.params">({{ halStats.params }})</span>
              </MachineBtn>
            </div>
            <div class="halActions">
              <MachineInput gate="search" type="text" class="halSearchInput" v-model="halSearch" placeholder="Search..." />
            </div>
          </div>

          <!-- Tree controls (pinned) -->
          <div v-if="!halSearch.trim() && ((halSection === 'pins' && halPins.length > 0) || (halSection === 'params' && halParams.length > 0))" class="halTreeControls">
            <MachineBtn type="inline" class="optBtn" @click="expandAllHal">+ all</MachineBtn>
            <MachineBtn type="inline" class="optBtn" @click="collapseAllHal">- all</MachineBtn>
            <span class="halFilterInfo" v-if="halSection === 'pins' && filteredPins.length !== halPins.length">
              {{ filteredPins.length }} / {{ halPins.length }}
            </span>
          </div>

          <div class="stack-panel scrollContent scroll-thin">
          <!-- Empty state (waiting for first snapshot) -->
          <div v-if="!halInitialized" class="halEmpty">
            Connecting…
          </div>

          <!-- PINS -->
          <div v-if="halSection === 'pins' && halPins.length > 0">

            <!-- Tree view -->
            <template v-if="!halSearch.trim()">
              <div v-for="[group, pins] of pinGroups" :key="group" class="halGroup">
                <MachineBtn type="inline" class="halGroupHeader" @click="toggleHalGroup(group)">
                  <span class="halChevron">{{ halExpanded.has(group) ? '\u25BC' : '\u25B6' }}</span>
                  <span class="halGroupName">{{ group }}</span>
                  <span class="halGroupCount">({{ pins.length }})</span>
                </MachineBtn>
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
                <MachineBtn type="inline" class="halGroupHeader" @click="toggleHalGroup(group)">
                  <span class="halChevron">{{ halExpanded.has(group) ? '\u25BC' : '\u25B6' }}</span>
                  <span class="halGroupName">{{ group }}</span>
                  <span class="halGroupCount">({{ params.length }})</span>
                </MachineBtn>
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


.section {
  display: flex;
  flex-direction: column;
  gap: var(--gap-controls);
}

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

.inputRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
}

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

.wpGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: repeat(3, auto);
  grid-auto-flow: column;
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

.colorRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
}


.colorLabel {
  font-size: var(--fs-base);
  opacity: var(--opacity-secondary);
}

.opacityList {
}

.opacityRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
}

.opacityLabel {
  font-size: var(--fs-base);
  opacity: var(--opacity-secondary);
  min-width: 100px;
}

.opacitySlider {
  flex: 1;
}

.opacityValue {
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
  opacity: var(--opacity-muted);
  min-width: 32px;
  text-align: right;
}

.btnGroup {
  display: flex;
  gap: var(--gap-tight);
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

.rflRpm {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}

.rflRpm input {
  width: 90px;
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
  gap: var(--gap-controls);
  margin-bottom: var(--gap-section);
  flex-wrap: wrap;
  flex-shrink: 0;
}

.halActions {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}

.halSearchInput {
  width: 160px;
}

.halError {
  padding: var(--gap-tight) var(--gap-controls);
  margin-bottom: var(--gap-controls);
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--danger) 15%, var(--bg));
  opacity: var(--opacity-secondary);
}

.halEmpty {
  text-align: center;
  opacity: var(--opacity-disabled);
  padding: var(--gap-panel) 0;
}

.halTreeControls {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  margin-bottom: var(--gap-controls);
  flex-shrink: 0;
}

.halCount {
  opacity: var(--opacity-muted);
}

.halFilterInfo {
  opacity: var(--opacity-muted);
  margin-bottom: var(--gap-tight);
}

.halGroup {
  margin-bottom: var(--gap-micro);
}

.halGroupHeader {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--gap-tight);
  padding: var(--gap-tight) 0;
  background: none;
  border: none;
  border-radius: 0;
  width: 100%;
  text-align: left;
  user-select: none;
}

.halGroupHeader:hover {
  opacity: var(--opacity-secondary);
  background: none;
}

.halChevron {
  width: 12px;
  text-align: center;
  flex-shrink: 0;
}

.halGroupName {
  font-weight: var(--fw-semibold);
}

.halGroupCount {
  opacity: var(--opacity-disabled);
}

.halGroupBody {
  padding-left: 18px;
}

.halRow {
  display: flex;
  align-items: baseline;
  gap: var(--gap-controls);
  padding: var(--gap-micro) 0;
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
  opacity: var(--opacity-muted);
}

.halDir {
  width: 24px;
  flex-shrink: 0;
  opacity: var(--opacity-muted);
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
  opacity: var(--opacity-disabled);
}

.halSignal {
  flex: 1;
  min-width: 60px;
  opacity: var(--opacity-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.halUnlinked {
  opacity: var(--opacity-subtle);
}

.halSigRow {
  padding: var(--gap-tight) 0;
  border-bottom: 1px solid color-mix(in oklab, var(--border) 30%, transparent);
}

.halSigHeader {
  display: flex;
  align-items: baseline;
  gap: var(--gap-controls);
}

.halSigName {
  font-weight: var(--fw-semibold);
  flex: 1;
  min-width: 0;
}

.halSigPins {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-tight) var(--gap-section);
  padding-left: var(--gap-section);
  padding-top: var(--gap-micro);
  opacity: var(--opacity-muted);
}

.halSigPin {
  white-space: nowrap;
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
  font-family: var(--font-mono);
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
  font-family: var(--font-mono);
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

/* ── Gamepad settings ─────────────────────────────────────────── */

.gpMapTable {
  width: 100%;
  border-collapse: collapse;
}

.gpMapTable td {
  padding: 4px 8px;
  font-size: var(--fs-sm);
  border-bottom: 1px solid var(--border);
}

.gpMapKey {
  font-weight: var(--fw-semibold);
  white-space: nowrap;
  width: 1%;
}

.gpActionSelect {
  width: 100%;
}

/* ── Keyboard settings ───────────────────────────────────────── */
.kbMapTable {
  width: 100%;
  border-collapse: collapse;
}

.kbMapTable td {
  padding: 4px 8px;
  font-size: var(--fs-sm);
  border-bottom: 1px solid var(--border);
}

.kbMapAction {
  font-weight: var(--fw-semibold);
  white-space: nowrap;
  width: 1%;
}

.kbKeyCell {
  cursor: pointer;
  font-family: var(--font-mono);
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}

.kbKeyCell:hover {
  background: color-mix(in oklab, var(--fg) var(--hl-hover), var(--bg));
}

.kbKeyCell.listening {
  background: color-mix(in oklab, var(--info) var(--hl-selected), var(--bg));
  outline: 1px solid var(--info);
}

.kbUnbind {
  width: 1%;
}

.kbSep td {
  padding: 0;
  height: var(--gap-section);
  border-bottom: none;
}

.kbCaptureError {
  font-size: var(--fs-sm);
  color: var(--danger);
  margin-top: var(--gap-controls);
}
</style>
