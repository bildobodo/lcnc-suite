<script setup lang="ts">
import { ref, reactive, computed, inject, onMounted, onUnmounted, watch, type Ref, type ComputedRef } from "vue";
import TabPanel from "./TabPanel.vue";
import Btn from "./Btn.vue";
import Gate from "./Gate.vue";
import {
  loadViewerDefaults, saveViewerDefaults,
  loadMachineDefaults, saveMachineDefaults,
  loadMacrosDefaults, saveMacrosDefaults, extractParams,
  loadCameraDefaults, saveCameraDefaults, type CameraDefaults,
  loadToolsetterDefaults, saveToolsetterDefaults, TOOLSETTER_FALLBACK,
  loadProbeDefaults,
  loadDisplayDefaults, saveDisplayDefaults, settingsVersion, serverSettingsReady,
  type Vec3, type Layer, type ColorDefaults, type OpacityDefaults,
  type TrackMode, type Projection, type ToolChangeMode, type SpindleDir, type SpindleFeedbackUnit,
  type ThemeMode, type MacroDef, type MacroParam, type GamepadDefaults,
  type GamepadMapping, GAMEPAD_ACTIONS, DEFAULT_MAPPING, GAMEPAD_FALLBACK,
  STEP_DEFAULT, STEP_FEED, STEP_RPM,
  loadKeyboardDefaults, type KeyboardDefaults, type KeyboardAction, KEYBOARD_ACTION_LABELS, DEFAULT_KB_MAPPING, formatKeyName,
} from "./defaults";
import { fetchHal, fetchG30, type HalPin, type HalSignal, type HalParam } from "./lcncApi";
import { status } from "./lcncWs";
import { usePermissions } from "./permissions";
import { ChevronUp, ChevronDown, Pencil, Trash2 } from "lucide-vue-next";
import GamepadLiveInput from "./GamepadLiveInput.vue";
import DebugTab from "./DebugTab.vue";

const can = usePermissions();


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
  editingMacro.value = JSON.parse(JSON.stringify(m));
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
}>();

const emit = defineEmits<{
  (e: "setProbeVars", vars: Record<string, number>): void;
  (e: "mdi", text: string): void;
  (e: "setPathOnTop", on: boolean): void;
  (e: "setProjection", proj: Projection): void;
  (e: "setRunFromLine", on: boolean): void;
  (e: "setGamepadConfig", cfg: GamepadDefaults): void;
  (e: "setKeyboardConfig", cfg: KeyboardDefaults): void;
}>();

// ─── Per-tab reset ──────────────────────────────────────────────
const resetTarget = ref<string | null>(null);

const resetLabels: Record<string, string> = {
  viewer: "3D Viewer", machine: "Machine", toolsetter: "Toolsetter",
  display: "Display", camera: "Camera", gamepad: "Gamepad", keyboard: "Keyboard",
};

function resetViewer() {
  saveViewerDefaults({
    workpieceSize: [100, 100, 20], workpieceOffset: [0, 0, -20],
    layers: { backplot: true, toolpath: true, machine: true, workpiece: true, bounds: true, workzero: true, hud: true, surface: true, tool: true },
    colors: { feed: "#22b8cf", rapid: "#f5a623", backplot: "#ff00ff", bounds: "#ffffff", workpiece: "#ffffff", tool: "#c0c0c0", cutter: "#ffdd00" },
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

function resetToolsetter() {
  Object.assign(tsParams.value, { ...TOOLSETTER_FALLBACK });
  saveTsParams();
}

function saveStartFullscreen() {
  saveDisplayDefaults({ ...loadDisplayDefaults(), startFullscreen: startFullscreen.value });
}

function resetDisplay() {
  setTheme("auto");
  startFullscreen.value = false;
  saveDisplayDefaults({ theme: "auto", startFullscreen: false });
}

function resetCamera() {
  saveCameraDefaults({
    showCrosshair: true, showCircle: true, showGrid: false,
    circleRadius: 50, gridSpacing: 50, overlayOpacity: 0.8, overlayColor: "#00ff00",
  });
  const cd = loadCameraDefaults();
  Object.assign(cam, cd);
}

function resetGamepad() {
  const fb = { ...GAMEPAD_FALLBACK, mapping: { ...GAMEPAD_FALLBACK.mapping } };
  for (const k of Object.keys(gpMapping) as (keyof GamepadMapping)[]) {
    gpMapping[k] = fb.mapping[k];
  }
  emit("setGamepadConfig", fb);
}

const resetActions: Record<string, () => void> = {
  viewer: resetViewer, machine: resetMachine, toolsetter: resetToolsetter,
  display: resetDisplay, camera: resetCamera, gamepad: resetGamepad, keyboard: resetKeyboard,
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
  touchZ: 0,
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

const probeTool = computed(() => loadProbeDefaults().probeTool);

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
  Object.assign(tsParams.value, loadToolsetterDefaults());
}

function saveTsParams() {
  saveToolsetterDefaults({ ...tsParams.value });
  if (can.value.ready) emit("setProbeVars", buildVarMap());
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
  const st = status.value as any;
  if (st?.position) {
    g30X.value = st.position[0];
    g30Y.value = st.position[1];
    g30Z.value = st.position[2];
  }
}

onMounted(() => {
  loadTsParams();
  loadG30();
});

// Re-read when another client changes settings
watch(settingsVersion, () => {
  loadTsParams();
  macros.value = loadMacrosDefaults().macros;
  Object.assign(cam, loadCameraDefaults());
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
});

// ─── Camera overlay ──────────────────────────────────────────
const cam = reactive<CameraDefaults>(loadCameraDefaults());
function saveCam() { saveCameraDefaults({ ...cam }); }

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

// Show rotary rows only if machine has axes beyond XYZ (bits 3+ in axis_mask)
const hasRotaryAxes = computed(() => ((status.value?.axis_mask ?? 7) >> 3) !== 0);

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
    enabled: true,
    jogEnabled: false,
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
  { id: "toolsetter", label: "Toolsetter" },
  { id: "display", label: "Display" },
  { id: "camera", label: "Camera" },
  { id: "macros", label: "Macros" },
  { id: "gamepad", label: "Gamepad" },
  { id: "keyboard", label: "Keyboard" },
  { id: "hal", label: "HAL" },
  { id: "debug", label: "Debug" },
];
const activeTab = ref("viewer");



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

function onGpMappingChanged() {
  if (!props.gamepadConfig) return;
  emit("setGamepadConfig", { ...props.gamepadConfig, mapping: { ...gpMapping } });
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
    <div class="hint">Settings are saved automatically and shared across all connected clients.</div>
    <TabPanel :tabs="subTabs" v-model="activeTab" class="subTabs">
      <template #viewer>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
        <Gate :allow="can.idle">
        <div class="section">
          <div class="sub">Colors</div>
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

        <div class="sep"></div>

        <div class="section">
          <div class="sub">Opacity</div>
          <div class="stack-controls opacityList">
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

        <div class="sep"></div>

        <div class="section" v-if="machineParts.length > 0">
          <div class="sub">Machine Colors</div>
          <div class="stack-controls fieldGroup">
            <div class="colorGrid">
              <div class="colorRow" v-for="part in machineParts" :key="part.id">
                <input
                  type="color"
                  class="colorInput"
                  :value="machineColors[part.id] ?? defaultMachineColor(part)"
                  @input="onMachineColorChange(part.id, ($event.target as HTMLInputElement).value)"
                />
                <span class="colorLabel">{{ formatPartLabel(part.id) }}</span>
                <Btn v-if="machineColors[part.id]" icon @click="resetMachineColor(part.id)">&times;</Btn>
              </div>
            </div>
            <label class="toggleRow">
              <input type="checkbox" class="toggle" v-model="machineEdgesOn" @change="setMachineEdges(machineEdgesOn); save()" />
              Edge outline
            </label>
          </div>
        </div>

        <div class="resetRow">
          <Btn variant="danger" :disabled="!can.idle" @click="resetTarget = 'viewer'">Reset 3D Viewer</Btn>
        </div>
        </Gate>
        </div>
      </template>

      <template #machine>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
          <Gate :allow="can.idle">
          <div class="section">
            <div class="sub">Tool Load Behavior</div>
            <div class="settingDesc">Controls what happens when you load a tool from the Tool Table.</div>
            <div class="radioGroup">
              <label>
                <input type="radio" v-model="toolChangeMode" value="m6g43" @change="saveMachine()" />
                <span><span class="radioLabel">M6 G43</span><br><span class="radioDesc">Load tool, activate length offset</span></span>
              </label>
              <label>
                <input type="radio" v-model="toolChangeMode" value="m600" @change="saveMachine()" />
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
                <input type="radio" v-model="spindleFeedbackUnit" value="rps" @change="saveMachine()" />
                <span><span class="radioLabel">RPS (default)</span><br><span class="radioDesc">Pin outputs revolutions per second (×60 for display)</span></span>
              </label>
              <label>
                <input type="radio" v-model="spindleFeedbackUnit" value="rpm" @change="saveMachine()" />
                <span><span class="radioLabel">RPM</span><br><span class="radioDesc">Pin outputs RPM directly (most VFDs)</span></span>
              </label>
            </div>
          </div>
          <div class="sep"></div>
          <div class="section">
            <div class="sub">Spindle Load HAL Pin</div>
            <div class="settingDesc">HAL pin that outputs spindle load percentage (e.g. <code>spindle-load-conv.load-percentage</code>). Leave empty to disable.</div>
            <input
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
            <label class="toggleRow">
              <input type="checkbox" class="toggle" v-model="runFromLine" @change="emit('setRunFromLine', runFromLine); saveMachine()" />
              Enable run from line
            </label>
            <div v-if="runFromLine" class="rflDefaults">
              <div class="settingDesc">Default spindle preset for run-from-line dialog.</div>
              <div class="rflRow">
                <div class="radioGroup inline">
                  <label><input type="radio" v-model="rflSpindleDir" value="off" @change="saveMachine()" /> Off</label>
                  <label><input type="radio" v-model="rflSpindleDir" value="forward" @change="saveMachine()" /> FWD</label>
                  <label><input type="radio" v-model="rflSpindleDir" value="reverse" @change="saveMachine()" /> REV</label>
                </div>
                <div v-if="rflSpindleDir !== 'off'" class="rflRpm">
                  <label>RPM</label>
                  <input type="number" v-model.number="rflSpindleRpm" min="0" :step="STEP_RPM" @change="saveMachine()" />
                </div>
              </div>
            </div>
          </div>
          <div class="resetRow">
            <Btn variant="danger" :disabled="!can.idle" @click="resetTarget = 'machine'">Reset Machine</Btn>
          </div>
          </Gate>
        </div>
      </template>

      <template #toolsetter>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
          <Gate :allow="can.ready">
          <div class="section">
            <div class="sub">Toolsetter Position (G53)</div>
            <div class="tsGrid">
              <label title="X position (G53 machine coordinates) of the toolsetter button center. Jog to the button with no tool, read the machine X position. (#3100)">Touch X</label>
              <input type="number" v-model.number="tsParams.touchX" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="Y position (G53 machine coordinates) of the toolsetter button center. Jog to the button with no tool, read the machine Y position. (#3101)">Touch Y</label>
              <input type="number" v-model.number="tsParams.touchY" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="Z approach height (G53) above the toolsetter button. The tool moves to this height before probing downward. Set above the button top plus clearance. (#3102)">Touch Z</label>
              <input type="number" v-model.number="tsParams.touchZ" :step="STEP_DEFAULT" @change="saveTsParams" />
            </div>
          </div>

          <div class="sep"></div>

          <div class="section">
            <div class="sub" title="G30 tool change position — where the machine moves before a tool change (M6). Read-only, set in the LinuxCNC var file. (#5181–#5183)">Tool Change Position (G30)</div>
            <div class="tsGrid">
              <label>X</label>
              <span class="readonlyVal">{{ g30X != null ? g30X.toFixed(3) : '—' }}</span>
              <label>Y</label>
              <span class="readonlyVal">{{ g30Y != null ? g30Y.toFixed(3) : '—' }}</span>
              <label>Z</label>
              <span class="readonlyVal">{{ g30Z != null ? g30Z.toFixed(3) : '—' }}</span>
            </div>
            <div class="tsBtnRow" style="margin-top: var(--gap-controls);">
              <Btn size="sm" class="optBtn" :disabled="!can.idle" @click="setG30">Set Current Position</Btn>
              <Btn size="sm" class="optBtn" @click="loadG30" :disabled="g30Loading">Refresh</Btn>
            </div>
          </div>

          <div class="sep"></div>

          <div class="section">
            <div class="sub">Probe Settings</div>
            <div class="tsGrid">
              <label title="Feed rate for the initial fast probe approach to the touch plate. Higher values reduce cycle time but lower repeatability. (#3004)">Fast Feed</label>
              <input type="number" v-model.number="tsParams.fastFeed" min="1" :step="STEP_FEED" @change="saveTsParams" />
              <label title="Feed rate for the refined slow measurement pass after retract. Set to 0 to skip the slow pass — faster but less accurate. (#3005)">Slow Feed</label>
              <input type="number" v-model.number="tsParams.slowFeed" min="0" :step="STEP_FEED" @change="saveTsParams" />
              <label title="Feed rate for non-probing positioning moves (travel to touch plate, retract, return). Does not affect measurement accuracy. (#3006)">Traverse Feed</label>
              <input type="number" v-model.number="tsParams.traverseFeed" min="1" :step="STEP_FEED" @change="saveTsParams" />
              <label title="Maximum downward travel before the probe aborts if no contact. Safety limit to prevent crashes if the touch plate is missing. (#3007)">Max Z Travel</label>
              <input type="number" v-model.number="tsParams.maxZTravel" min="1" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="Distance the tool retracts upward after fast probe contact before the slow pass begins. The slow pass probes 2× this distance. (#3009)">Retract Dist</label>
              <input type="number" v-model.number="tsParams.retractDist" min="0.1" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="G53 Z distance from spindle nose to touch plate surface with no tool loaded. Reference for zero-length tools. Measure carefully during initial setup. (#3010)">Spindle Zero H</label>
              <input type="number" v-model.number="tsParams.spindleZeroHeight" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />
            </div>
          </div>

          <div class="sep"></div>

          <div class="section">
            <div class="sub">Options</div>
            <div class="tsToggleGrid">
              <label class="toggleRow" title="When enabled, uses the tool table length to calculate a closer probe start height — faster for known tools. Disable during initial setup or if tool table data is unreliable. (#3103)">
                <input type="checkbox" class="toggle" :checked="tsParams.useToolTable === 1" @change="tsParams.useToolTable = ($event.target as HTMLInputElement).checked ? 1 : 0; saveTsParams()" />
                Use Tool Table
              </label>
              <label class="toggleRow" title="After measurement, return to the XYZ position where M600 was called. Disable only if the tool change is at the end of a program. (#3106)">
                <input type="checkbox" class="toggle" :checked="tsParams.goBackToStart === 1" @change="tsParams.goBackToStart = ($event.target as HTMLInputElement).checked ? 1 : 0; saveTsParams()" />
                Return to Start
              </label>
              <label class="toggleRow" title="Skip the G30 pre-positioning move before traveling to the touch plate. Faster, but risks collision with clamps or fixtures on uncluttered machines only. (#3108)">
                <input type="checkbox" class="toggle" :checked="tsParams.disablePrePos === 1" @change="tsParams.disablePrePos = ($event.target as HTMLInputElement).checked ? 1 : 0; saveTsParams()" />
                Skip G30 Pre-Pos
              </label>
              <label class="toggleRow" title="On the final retry attempt, ignore tool table offsets and use spindle zero height instead. Provides a fallback for tools with incorrect table entries. (#3110)">
                <input type="checkbox" class="toggle" :checked="tsParams.lastTry === 1" @change="tsParams.lastTry = ($event.target as HTMLInputElement).checked ? 1 : 0; saveTsParams()" />
                Last Try w/o Table
              </label>
            </div>
            <div class="tsGrid" style="margin-top: var(--gap-section);">
              <label title="Safety clearance between the expected tool tip position and the touch plate when using tool table pre-positioning. Increase for widely varying tool lengths. (#3104)">Tool Min Dist</label>
              <input type="number" v-model.number="tsParams.toolMinDis" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="Number of extra retry attempts if probe contact fails. Each failure pauses for operator correction before retrying. Set to 0 for ATC. (#3109)">Extra Retries</label>
              <input type="number" v-model.number="tsParams.addReps" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />

              <label title="Pause after tool measurement: None = continue immediately, M00 = mandatory stop (press Cycle Start to resume), M01 = optional stop (active only when block delete is off). (#3105)">Brake After</label>
              <div class="radioGroup inline">
                <label v-for="b in [0, 1, 2]" :key="b"><input type="radio" :value="b" v-model.number="tsParams.brakeAfter" @change="saveTsParams()" /> {{ BRAKE_LABELS[b] }}</label>
              </div>

              <label title="M-code sent to stop the spindle before probing. M5 = standard stop. M500 = stop and wait for spindle to fully decelerate (for VFD-controlled spindles). (#3107)">Spindle Stop</label>
              <div class="radioGroup inline">
                <label><input type="radio" :value="5" v-model.number="tsParams.spindleStopM" @change="saveTsParams()" /> M5</label>
                <label><input type="radio" :value="500" v-model.number="tsParams.spindleStopM" @change="saveTsParams()" /> M500</label>
              </div>

              <label title="Axis direction to offset the probe position for large tools: X−, X+, Y−, or Y+. Choose based on your machine layout to avoid clamp or fixture collisions. (#3013)">Offset Dir</label>
              <div class="radioGroup inline">
                <label v-for="d in [0, 1, 2, 3]" :key="d"><input type="radio" :value="d" v-model.number="tsParams.offsetDirection" @change="saveTsParams()" /> {{ OFFSET_DIR_LABELS[d] }}</label>
              </div>
            </div>
          </div>

          <div class="sep"></div>

          <div class="section">
            <div class="sub">Diameter Offset</div>
            <div class="tsGrid">
              <label title="Minimum tool diameter that triggers position offset. Tools smaller than this probe on-center. Set to 0 to disable offset for all tools. (#3111)">Min Diameter</label>
              <input type="number" v-model.number="tsParams.offsetDiameter" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="Percentage of tool diameter to offset the probe position. Example: 20% on a large tool offsets the probe position by 20% of the diameter from center. (#3112)">Offset %</label>
              <input type="number" v-model.number="tsParams.offsetValue" min="0" max="100" :step="STEP_DEFAULT" @change="saveTsParams" />
            </div>
          </div>

          <div class="sep"></div>

          <div class="section">
            <div class="sub">Edge-Finder</div>
            <div class="tsGrid">
              <label title="Probe tool number, shared with the Probing tab. Must match the tool loaded in the spindle before any probe operation. (#3014)">Probe Tool #</label>
              <span class="readonlyVal">T{{ probeTool }}</span>
              <label title="X position (G53) of a secondary edge-finder reference point. Used only when the selected tool matches the probe tool number. (#3113)">Finder X</label>
              <input type="number" v-model.number="tsParams.finderTouchX" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="Y position (G53) of a secondary edge-finder reference point. Used only when the selected tool matches the probe tool number. (#3114)">Finder Y</label>
              <input type="number" v-model.number="tsParams.finderTouchY" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="Height difference between the edge-finder reference surface and the normal touch plate surface. May be negative if the reference is lower. (#3115)">Finder Z Diff</label>
              <input type="number" v-model.number="tsParams.finderDiffZ" :step="STEP_DEFAULT" @change="saveTsParams" />
            </div>
          </div>

          <div class="resetRow">
            <Btn variant="danger" :disabled="!can.idle" @click="resetTarget = 'toolsetter'">Reset Toolsetter</Btn>
          </div>
          </Gate>
        </div>
      </template>

      <template #display>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
          <Gate :allow="can.idle">
          <div class="section">
            <div class="sub">Theme</div>
            <div class="radioGroup">
              <label><input type="radio" name="theme" :checked="themeMode === 'auto'" @change="setTheme('auto')" /> Auto</label>
              <label><input type="radio" name="theme" :checked="themeMode === 'light'" @change="setTheme('light')" /> Light</label>
              <label><input type="radio" name="theme" :checked="themeMode === 'dark'" @change="setTheme('dark')" /> Dark</label>
              <label><input type="radio" name="theme" :checked="themeMode === 'hc-light'" @change="setTheme('hc-light')" /> High Contrast Light</label>
              <label><input type="radio" name="theme" :checked="themeMode === 'hc-dark'" @change="setTheme('hc-dark')" /> High Contrast Dark</label>
            </div>
          </div>
          <div class="sep"></div>
          <div class="section">
            <div class="sub">Fullscreen</div>
            <label class="toggleRow">
              <input type="checkbox" class="toggle" v-model="startFullscreen" @change="saveStartFullscreen" />
              Start in fullscreen mode
            </label>
          </div>
          <div class="resetRow">
            <Btn variant="danger" :disabled="!can.idle" @click="resetTarget = 'display'">Reset Display</Btn>
          </div>
          </Gate>
        </div>
      </template>

      <template #camera>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
          <Gate :allow="can.idle">
          <div class="section">
            <div class="sub">Overlay Toggles</div>
            <div class="stack-controls">
              <label class="toggleRow"><input type="checkbox" class="toggle" v-model="cam.showCrosshair" @change="saveCam" /> Crosshair</label>
              <label class="toggleRow"><input type="checkbox" class="toggle" v-model="cam.showCircle" @change="saveCam" /> Circle</label>
              <label class="toggleRow"><input type="checkbox" class="toggle" v-model="cam.showGrid" @change="saveCam" /> Grid</label>
            </div>
          </div>

          <div class="sep"></div>

          <div class="section">
            <div class="sub">Overlay Dimensions</div>
            <div class="tsGrid">
              <label>Circle Radius</label>
              <input type="number" v-model.number="cam.circleRadius" min="10" max="300" :step="1" @change="saveCam" />
              <label>Grid Spacing</label>
              <input type="number" v-model.number="cam.gridSpacing" min="10" max="200" :step="1" @change="saveCam" />
            </div>
          </div>

          <div class="sep"></div>

          <div class="section">
            <div class="sub">Overlay Appearance</div>
            <div class="stack-controls opacityList">
              <div class="opacityRow">
                <span class="opacityLabel">Opacity</span>
                <input type="range" class="opacitySlider" min="0" max="1" step="0.05"
                  :value="cam.overlayOpacity"
                  @input="cam.overlayOpacity = parseFloat(($event.target as HTMLInputElement).value); saveCam()" />
                <span class="opacityValue">{{ Math.round(cam.overlayOpacity * 100) }}%</span>
              </div>
            </div>
            <div class="colorGrid" style="margin-top: var(--gap-controls)">
              <div class="colorRow">
                <input type="color" class="colorInput" :value="cam.overlayColor"
                  @input="cam.overlayColor = ($event.target as HTMLInputElement).value; saveCam()" />
                <span class="colorLabel">Overlay Color</span>
              </div>
            </div>
          </div>
          <div class="resetRow">
            <Btn variant="danger" :disabled="!can.idle" @click="resetTarget = 'camera'">Reset Camera</Btn>
          </div>
          </Gate>
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
                <div class="macroSettingsInfo">
                  <span class="macroSettingsName">{{ m.name }}</span>
                  <code class="macroSettingsCmd">{{ m.command }}</code>
                </div>
                <div class="macroSettingsActions">
                  <Btn icon :disabled="idx === 0 || !can.idle" @click="moveMacro(idx, -1)" title="Move up"><ChevronUp :size="14" /></Btn>
                  <Btn icon :disabled="idx === macros.length - 1 || !can.idle" @click="moveMacro(idx, 1)" title="Move down"><ChevronDown :size="14" /></Btn>
                  <Btn icon :disabled="!can.idle" @click="editMacro(m)" title="Edit"><Pencil :size="14" /></Btn>
                  <Btn icon :disabled="!can.idle" @click="deleteMacro(m.id)" title="Delete"><Trash2 :size="14" /></Btn>
                </div>
              </div>
            </div>

            <div v-if="editingMacro" class="macroEditForm">
              <div class="sub">{{ macros.some(m => m.id === editingMacro!.id) ? 'Edit' : 'New' }} Macro</div>
              <div class="stack-controls fieldGroup">
                <div class="inputRow">
                  <span class="inputLabel">Name</span>
                  <input type="text" v-model="editingMacro.name" placeholder="e.g. Face Top" />
                </div>
                <div class="inputRow">
                  <span class="inputLabel">Command</span>
                  <input type="text" v-model="editingMacro.command" placeholder="e.g. G0 Z{depth} F{feed}" />
                </div>
                <div class="macroParamHint">
                  Use <code>{"{name}"}</code> for parameters. Users will be prompted for values.
                </div>

                <div v-if="editingMacroParams.length > 0" class="macroParamEditor">
                  <div class="sub">Parameters</div>
                  <div v-for="p in editingMacroParams" :key="p.name" class="macroParamEditRow">
                    <code class="macroParamBadge">{{"{"}}{{ p.name }}{{"}"}}</code>
                    <input type="text" v-model="p.label" placeholder="Display label" />
                    <input type="text" v-model="p.default" placeholder="Default value" />
                  </div>
                </div>
              </div>
              <div class="macroEditActions">
                <Btn @click="editingMacro = null">Cancel</Btn>
                <Btn variant="primary" @click="saveMacro" :disabled="!editingMacro.name.trim() || !editingMacro.command.trim()">Save</Btn>
              </div>
            </div>

            <Btn v-if="!editingMacro && macros.length < 20" variant="primary" :disabled="!can.idle" @click="addMacro" style="margin-top: var(--gap-section);">Add Macro</Btn>
          </div>
        </div>
      </template>

      <template #gamepad>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
        <Gate :allow="can.idle">
          <div class="section">
            <div class="sub">Gamepad Jogging</div>
            <div class="settingDesc">Use an Xbox, PlayStation, or standard gamepad to jog the machine.</div>
            <label class="toggleRow">
              <input type="checkbox" class="toggle" :checked="props.gamepadConfig?.enabled" @change="emit('setGamepadConfig', { ...props.gamepadConfig!, enabled: ($event.target as HTMLInputElement).checked })" />
              Enable gamepad jogging
            </label>
          </div>

          <div class="sep"></div>

          <div class="section">
            <div class="sub">Connection</div>
            <div class="settingDesc" :class="{ okText: props.gamepadConnected }">
              {{ props.gamepadConnected ? props.gamepadName : 'No gamepad detected — connect one and press a button' }}
            </div>
          </div>

          <div class="sep" v-if="props.gamepadConfig?.enabled"></div>

          <div v-if="props.gamepadConfig?.enabled" class="section">
            <div class="sub">Axis Inversion</div>
            <div class="settingDesc">Flip axis direction if your gamepad moves the wrong way.</div>
            <label class="toggleRow"><input type="checkbox" class="toggle" :checked="props.gamepadConfig?.invertX" @change="emit('setGamepadConfig', { ...props.gamepadConfig!, invertX: ($event.target as HTMLInputElement).checked })" /> Invert X</label>
            <label class="toggleRow"><input type="checkbox" class="toggle" :checked="props.gamepadConfig?.invertY" @change="emit('setGamepadConfig', { ...props.gamepadConfig!, invertY: ($event.target as HTMLInputElement).checked })" /> Invert Y</label>
            <label class="toggleRow"><input type="checkbox" class="toggle" :checked="props.gamepadConfig?.invertZ" @change="emit('setGamepadConfig', { ...props.gamepadConfig!, invertZ: ($event.target as HTMLInputElement).checked })" /> Invert Z</label>
          </div>

          <div class="sep" v-if="props.gamepadConfig?.enabled"></div>

          <div v-if="props.gamepadConfig?.enabled" class="section">
            <div class="sub">Button Mapping</div>
            <table class="gpMapTable">
              <tbody>
                <tr><td class="gpMapKey">Left Stick</td><td>XY continuous jog (proportional)</td></tr>
                <tr><td class="gpMapKey">Right Stick Y</td><td>Z continuous jog (proportional)</td></tr>
                <tr><td class="gpMapKey">D-pad</td><td>XY discrete jog (full speed)</td></tr>
                <tr v-for="(label, key) in GP_BTN_LABELS" :key="key">
                  <td class="gpMapKey">{{ label }}</td>
                  <td>
                    <select
                      class="gpActionSelect"
                      v-model="gpMapping[key]"
                      @change="onGpMappingChanged"
                    >
                      <option v-for="a in GAMEPAD_ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="sep" v-if="props.gamepadConfig?.enabled"></div>

          <div v-if="props.gamepadConfig?.enabled" class="section">
            <div class="sub">Dead Zone & Live Input</div>
            <div class="settingDesc">Ignore stick deflection below this threshold to prevent drift.</div>
            <div class="sliderRow">
              <input
                type="range" min="0.05" max="0.50" step="0.01"
                :value="props.gamepadConfig?.deadZone ?? 0.15"
                @input="emit('setGamepadConfig', { ...props.gamepadConfig!, deadZone: parseFloat(($event.target as HTMLInputElement).value) })"
              />
              <span class="sliderVal">{{ Math.round((props.gamepadConfig?.deadZone ?? 0.15) * 100) }}%</span>
            </div>
            <div v-if="props.gamepadConnected" style="margin-top: var(--gap-section);">
              <div class="settingDesc">Move sticks and press buttons to verify mapping.</div>
              <GamepadLiveInput :deadZone="props.gamepadConfig?.deadZone ?? 0.15" />
            </div>
          </div>

          <div class="resetRow">
            <Btn variant="danger" :disabled="!can.idle" @click="resetTarget = 'gamepad'">Reset Gamepad</Btn>
          </div>
        </Gate>
        </div>
      </template>

      <template #keyboard>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
          <Gate :allow="can.idle">
            <div class="section">
              <div class="sub">Keyboard Shortcuts</div>
              <div class="settingDesc">Allow keyboard keys to control the machine. When disabled, no keyboard shortcuts are active except E-Stop.</div>
              <label class="toggleRow">
                <input type="checkbox" class="toggle" v-model="kbConfig.enabled" @change="saveKb()" />
                Enable keyboard shortcuts
              </label>
            </div>

            <template v-if="kbConfig.enabled">
              <div class="sep"></div>

              <div class="section">
                <div class="sub">Keyboard Jogging</div>
                <div class="settingDesc">Allow jog keys to move axes.</div>
                <label class="toggleRow">
                  <input type="checkbox" class="toggle" v-model="kbConfig.jogEnabled" @change="saveKb()" />
                  Enable keyboard jogging
                </label>
              </div>

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
                        <Btn icon v-if="kbConfig.mapping[action]" @click.stop="unbindKey(action)" title="Unbind">&times;</Btn>
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
                        <Btn icon v-if="kbConfig.mapping[action]" @click.stop="unbindKey(action)" title="Unbind">&times;</Btn>
                      </td>
                    </tr>
                    </template>
                    <tr class="kbSep"><td colspan="3"></td></tr>
                    <tr v-for="action in COMMAND_ACTIONS" :key="action">
                      <td class="kbMapAction">{{ KEYBOARD_ACTION_LABELS[action] }}</td>
                      <td class="kbKeyCell"
                          :class="{ listening: listeningAction === action }"
                          @click="startCapture(action)">
                        {{ listeningAction === action ? 'Press a key...' : formatKeyName(kbConfig.mapping[action]) }}
                      </td>
                      <td class="kbUnbind">
                        <Btn icon v-if="kbConfig.mapping[action]" @click.stop="unbindKey(action)" title="Unbind">&times;</Btn>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div v-if="captureError" class="kbCaptureError">{{ captureError }}</div>
              </div>
            </template>

            <div class="resetRow">
              <Btn variant="danger" :disabled="!can.idle" @click="resetTarget = 'keyboard'">Reset Keyboard</Btn>
            </div>
          </Gate>
        </div>
      </template>

      <template #hal>
        <div class="halPane">
          <!-- Header: section toggles + search + refresh (pinned) -->
          <div class="halHeader">
            <div class="btnGroup">
              <Btn size="sm" :selected="halSection === 'pins'" class="optBtn"
                      @click="halSection = 'pins'">
                Pins <span class="halCount" v-if="halStats.pins">({{ halStats.pins }})</span>
              </Btn>
              <Btn size="sm" :selected="halSection === 'signals'" class="optBtn"
                      @click="halSection = 'signals'">
                Signals <span class="halCount" v-if="halStats.signals">({{ halStats.signals }})</span>
              </Btn>
              <Btn size="sm" :selected="halSection === 'params'" class="optBtn"
                      @click="halSection = 'params'">
                Params <span class="halCount" v-if="halStats.params">({{ halStats.params }})</span>
              </Btn>
            </div>
            <div class="halActions">
              <input type="text" class="halSearchInput" v-model="halSearch" placeholder="Search..." />
              <Btn size="sm" class="optBtn" @click="refreshHal" :disabled="halLoading">
                {{ halLoading ? '...' : 'Refresh' }}
              </Btn>
            </div>
          </div>

          <!-- Tree controls (pinned) -->
          <div v-if="!halSearch.trim() && ((halSection === 'pins' && halPins.length > 0) || (halSection === 'params' && halParams.length > 0))" class="halTreeControls">
            <Btn size="sm" class="optBtn" @click="expandAllHal">+ all</Btn>
            <Btn size="sm" class="optBtn" @click="collapseAllHal">- all</Btn>
            <span class="halFilterInfo" v-if="halSection === 'pins' && filteredPins.length !== halPins.length">
              {{ filteredPins.length }} / {{ halPins.length }}
            </span>
          </div>

          <div class="stack-panel scrollContent scroll-thin">
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
                <Btn class="halGroupHeader" @click="toggleHalGroup(group)">
                  <span class="halChevron">{{ halExpanded.has(group) ? '\u25BC' : '\u25B6' }}</span>
                  <span class="halGroupName">{{ group }}</span>
                  <span class="halGroupCount">({{ pins.length }})</span>
                </Btn>
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
                <Btn class="halGroupHeader" @click="toggleHalGroup(group)">
                  <span class="halChevron">{{ halExpanded.has(group) ? '\u25BC' : '\u25B6' }}</span>
                  <span class="halGroupName">{{ group }}</span>
                  <span class="halGroupCount">({{ params.length }})</span>
                </Btn>
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

    <Teleport to="body">
      <div v-if="resetTarget" class="dialogOverlay" data-gate-exempt @click.self="resetTarget = null">
        <div class="dialog">
          <div class="dialogTitle danger">Reset {{ resetLabels[resetTarget] }}</div>
          <div class="dialogBody">Restore {{ resetLabels[resetTarget] }} settings to defaults? This cannot be undone.</div>
          <div class="dialogActions">
            <Btn @click="resetTarget = null">Cancel</Btn>
            <Btn variant="danger" @click="confirmReset">Reset</Btn>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.settingsLoading {
  padding: var(--gap-panel);
  opacity: var(--opacity-disabled);
}
.settings {
  padding: var(--gap-section) 14px 14px;
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
}

.sub {
  margin-bottom: var(--gap-section);
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
}

.opacityRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
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

/* ─── Toolsetter sub-tab ───── */
.tsGrid {
  display: grid;
  grid-template-columns: auto 1fr auto 1fr;
  gap: var(--gap-tight) var(--gap-controls);
  align-items: center;
}

.tsGrid > label {
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
}

.tsGrid input {
  padding: 4px 8px;
  font-size: var(--fs-base);
  border-radius: var(--radius-md);
  max-width: 100px;
}

.readonlyVal {
  font-size: var(--fs-base);
  font-family: var(--font-mono);
  font-weight: var(--fw-semibold);
  opacity: var(--opacity-muted);
}

.tsToggleGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap-controls);
}

.tsBtnRow {
  display: flex;
  gap: var(--gap-micro);
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
  padding: 6px 10px;
  margin-bottom: var(--gap-controls);
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--danger) 15%, var(--bg));
  opacity: 0.9;
}

.halEmpty {
  text-align: center;
  opacity: var(--opacity-disabled);
  padding: 40px 0;
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
  margin-bottom: 2px;
}

.halGroupHeader {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  padding: 3px 0;
  background: none;
  border: none;
  border-radius: 0;
  width: 100%;
  text-align: left;
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
  opacity: var(--opacity-muted);
}

.halDir {
  width: 24px;
  flex-shrink: 0;
  text-align: center;
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
  opacity: 0.25;
}

.halSigRow {
  padding: 4px 0;
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
  padding-left: 12px;
  padding-top: 2px;
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
  display: flex;
  flex-direction: column;
  gap: var(--gap-micro);
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
