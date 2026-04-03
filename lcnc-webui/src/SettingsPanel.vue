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

// ─── Toolsetter boolean wrappers (0/1 ↔ boolean) ───
const tsUseToolTable = computed({ get: () => tsParams.value.useToolTable === 1, set: (v: boolean) => { tsParams.value.useToolTable = v ? 1 : 0; saveTsParams(); } });
const tsGoBackToStart = computed({ get: () => tsParams.value.goBackToStart === 1, set: (v: boolean) => { tsParams.value.goBackToStart = v ? 1 : 0; saveTsParams(); } });
const tsDisablePrePos = computed({ get: () => tsParams.value.disablePrePos === 1, set: (v: boolean) => { tsParams.value.disablePrePos = v ? 1 : 0; saveTsParams(); } });
const tsLastTry = computed({ get: () => tsParams.value.lastTry === 1, set: (v: boolean) => { tsParams.value.lastTry = v ? 1 : 0; saveTsParams(); } });

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

// ─── Gamepad boolean wrappers (emit-based) ───
const gpEnabled = computed({ get: () => props.gamepadConfig?.enabled ?? false, set: (v: boolean) => { emit('setGamepadConfig', { ...props.gamepadConfig!, enabled: v }); } });
const gpInvertX = computed({ get: () => props.gamepadConfig?.invertX ?? false, set: (v: boolean) => { emit('setGamepadConfig', { ...props.gamepadConfig!, invertX: v }); } });
const gpInvertY = computed({ get: () => props.gamepadConfig?.invertY ?? false, set: (v: boolean) => { emit('setGamepadConfig', { ...props.gamepadConfig!, invertY: v }); } });
const gpInvertZ = computed({ get: () => props.gamepadConfig?.invertZ ?? false, set: (v: boolean) => { emit('setGamepadConfig', { ...props.gamepadConfig!, invertZ: v }); } });

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

      <template #toolsetter>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
          <div class="section">
            <div class="sub">Toolsetter Position (G53)</div>
            <div class="tsGrid">
              <label title="X position (G53 machine coordinates) of the toolsetter button center. Jog to the button with no tool, read the machine X position. (#3100)">Touch X</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.touchX" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="Y position (G53 machine coordinates) of the toolsetter button center. Jog to the button with no tool, read the machine Y position. (#3101)">Touch Y</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.touchY" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="Z approach height (G53) above the toolsetter button. The tool moves to this height before probing downward. Set above the button top plus clearance. (#3102)">Touch Z</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.touchZ" :step="STEP_DEFAULT" @change="saveTsParams" />
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
              <MachineBtn type="manage" @click="setG30">Set Current Position</MachineBtn>
              <MachineBtn type="inline" class="optBtn" @click="loadG30" :disabled="g30Loading">Refresh</MachineBtn>
            </div>
          </div>

          <div class="sep"></div>

          <div class="section">
            <div class="sub">Probe Settings</div>
            <div class="tsGrid">
              <label title="Feed rate for the initial fast probe approach to the touch plate. Higher values reduce cycle time but lower repeatability. (#3004)">Fast Feed</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.fastFeed" min="1" :step="STEP_FEED" @change="saveTsParams" />
              <label title="Feed rate for the refined slow measurement pass after retract. Set to 0 to skip the slow pass — faster but less accurate. (#3005)">Slow Feed</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.slowFeed" min="0" :step="STEP_FEED" @change="saveTsParams" />
              <label title="Feed rate for non-probing positioning moves (travel to touch plate, retract, return). Does not affect measurement accuracy. (#3006)">Traverse Feed</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.traverseFeed" min="1" :step="STEP_FEED" @change="saveTsParams" />
              <label title="Maximum downward travel before the probe aborts if no contact. Safety limit to prevent crashes if the touch plate is missing. (#3007)">Max Z Travel</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.maxZTravel" min="1" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="Distance the tool retracts upward after fast probe contact before the slow pass begins. The slow pass probes 2× this distance. (#3009)">Retract Dist</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.retractDist" min="0.1" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="G53 Z distance from spindle nose to touch plate surface with no tool loaded. Reference for zero-length tools. Measure carefully during initial setup. (#3010)">Spindle Zero H</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.spindleZeroHeight" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />
            </div>
          </div>

          <div class="sep"></div>

          <div class="section">
            <div class="sub">Options</div>
            <div class="tsToggleGrid">
              <MachineToggle gate="toolsetterParam" v-model="tsUseToolTable" label="Use Tool Table" title="When enabled, uses the tool table length to calculate a closer probe start height — faster for known tools. Disable during initial setup or if tool table data is unreliable. (#3103)" />
              <MachineToggle gate="toolsetterParam" v-model="tsGoBackToStart" label="Return to Start" title="After measurement, return to the XYZ position where M600 was called. Disable only if the tool change is at the end of a program. (#3106)" />
              <MachineToggle gate="toolsetterParam" v-model="tsDisablePrePos" label="Skip G30 Pre-Pos" title="Skip the G30 pre-positioning move before traveling to the touch plate. Faster, but risks collision with clamps or fixtures on uncluttered machines only. (#3108)" />
              <MachineToggle gate="toolsetterParam" v-model="tsLastTry" label="Last Try w/o Table" title="On the final retry attempt, ignore tool table offsets and use spindle zero height instead. Provides a fallback for tools with incorrect table entries. (#3110)" />
            </div>
            <div class="tsGrid" style="margin-top: var(--gap-section);">
              <label title="Safety clearance between the expected tool tip position and the touch plate when using tool table pre-positioning. Increase for widely varying tool lengths. (#3104)">Tool Min Dist</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.toolMinDis" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="Number of extra retry attempts if probe contact fails. Each failure pauses for operator correction before retrying. Set to 0 for ATC. (#3109)">Extra Retries</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.addReps" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />

              <label title="Pause after tool measurement: None = continue immediately, M00 = mandatory stop (press Cycle Start to resume), M01 = optional stop (active only when block delete is off). (#3105)">Brake After</label>
              <div class="radioGroup inline">
                <label v-for="b in [0, 1, 2]" :key="b"><MachineRadio gate="toolsetterParam" name="brakeAfter" :value="b" v-model.number="tsParams.brakeAfter" @update:modelValue="saveTsParams()" /> {{ BRAKE_LABELS[b] }}</label>
              </div>

              <label title="M-code sent to stop the spindle before probing. M5 = standard stop. M500 = stop and wait for spindle to fully decelerate (for VFD-controlled spindles). (#3107)">Spindle Stop</label>
              <div class="radioGroup inline">
                <label><MachineRadio gate="toolsetterParam" name="spindleStopM" :value="5" v-model.number="tsParams.spindleStopM" @update:modelValue="saveTsParams()" /> M5</label>
                <label><MachineRadio gate="toolsetterParam" name="spindleStopM" :value="500" v-model.number="tsParams.spindleStopM" @update:modelValue="saveTsParams()" /> M500</label>
              </div>

              <label title="Axis direction to offset the probe position for large tools: X−, X+, Y−, or Y+. Choose based on your machine layout to avoid clamp or fixture collisions. (#3013)">Offset Dir</label>
              <div class="radioGroup inline">
                <label v-for="d in [0, 1, 2, 3]" :key="d"><MachineRadio gate="toolsetterParam" name="offsetDirection" :value="d" v-model.number="tsParams.offsetDirection" @update:modelValue="saveTsParams()" /> {{ OFFSET_DIR_LABELS[d] }}</label>
              </div>
            </div>
          </div>

          <div class="sep"></div>

          <div class="section">
            <div class="sub">Diameter Offset</div>
            <div class="tsGrid">
              <label title="Minimum tool diameter that triggers position offset. Tools smaller than this probe on-center. Set to 0 to disable offset for all tools. (#3111)">Min Diameter</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.offsetDiameter" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="Percentage of tool diameter to offset the probe position. Example: 20% on a large tool offsets the probe position by 20% of the diameter from center. (#3112)">Offset %</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.offsetValue" min="0" max="100" :step="STEP_DEFAULT" @change="saveTsParams" />
            </div>
          </div>

          <div class="sep"></div>

          <div class="section">
            <div class="sub">Edge-Finder</div>
            <div class="tsGrid">
              <label title="Probe tool number, shared with the Probing tab. Must match the tool loaded in the spindle before any probe operation. (#3014)">Probe Tool #</label>
              <span class="readonlyVal">T{{ probeTool }}</span>
              <label title="X position (G53) of a secondary edge-finder reference point. Used only when the selected tool matches the probe tool number. (#3113)">Finder X</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.finderTouchX" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="Y position (G53) of a secondary edge-finder reference point. Used only when the selected tool matches the probe tool number. (#3114)">Finder Y</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.finderTouchY" :step="STEP_DEFAULT" @change="saveTsParams" />
              <label title="Height difference between the edge-finder reference surface and the normal touch plate surface. May be negative if the reference is lower. (#3115)">Finder Z Diff</label>
              <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.finderDiffZ" :step="STEP_DEFAULT" @change="saveTsParams" />
            </div>
          </div>

          <div class="resetRow">
            <MachineBtn type="reset" @click="resetTarget = 'toolsetter'">Reset Toolsetter</MachineBtn>
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

      <template #camera>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
          <div class="section">
            <div class="sub">Overlay Toggles</div>
            <div class="stack-controls">
              <MachineToggle gate="cameraSetting" v-model="cam.showCrosshair" @update:modelValue="saveCam" label="Crosshair" />
              <MachineToggle gate="cameraSetting" v-model="cam.showCircle" @update:modelValue="saveCam" label="Circle" />
              <MachineToggle gate="cameraSetting" v-model="cam.showGrid" @update:modelValue="saveCam" label="Grid" />
            </div>
          </div>

          <div class="sep"></div>

          <div class="section">
            <div class="sub">Overlay Dimensions</div>
            <div class="tsGrid">
              <label>Circle Radius</label>
              <MachineInput gate="cameraSetting" type="number" v-model.number="cam.circleRadius" min="10" max="300" :step="1" @change="saveCam" />
              <label>Grid Spacing</label>
              <MachineInput gate="cameraSetting" type="number" v-model.number="cam.gridSpacing" min="10" max="200" :step="1" @change="saveCam" />
            </div>
          </div>

          <div class="sep"></div>

          <div class="section">
            <div class="sub">Overlay Appearance</div>
            <div class="stack-controls opacityList">
              <div class="opacityRow">
                <span class="opacityLabel">Opacity</span>
                <MachineSlider
                  gate="cameraSetting"
                  class="opacitySlider"
                  :min="0" :max="1" :step="0.05"
                  :modelValue="cam.overlayOpacity"
                  @update:modelValue="cam.overlayOpacity = $event!; saveCam()"
                />
                <span class="opacityValue">{{ Math.round(cam.overlayOpacity * 100) }}%</span>
              </div>
            </div>
            <div class="colorGrid" style="margin-top: var(--gap-controls)">
              <div class="colorRow">
                <MachineColor
                  gate="cameraSetting"
                    :modelValue="cam.overlayColor"
                  @update:modelValue="cam.overlayColor = $event!; saveCam()"
                />
                <span class="colorLabel">Overlay Color</span>
              </div>
            </div>
          </div>
          <div class="resetRow">
            <MachineBtn type="reset" @click="resetTarget = 'camera'">Reset Camera</MachineBtn>
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
              <Gate gate="idle" class="macroEditActions">
                <MachineBtn type="dialogCancel" @click="editingMacro = null">Cancel</MachineBtn>
                <MachineBtn type="dialogConfirm" @click="saveMacro" :disabled="!editingMacro.name.trim() || !editingMacro.command.trim()">Save</MachineBtn>
              </Gate>
            </div>

            <MachineBtn v-if="!editingMacro && macros.length < 20" type="manage" @click="addMacro" style="margin-top: var(--gap-section);">Add Macro</MachineBtn>

          </div>
        </div>
      </template>

      <template #gamepad>
        <div v-if="!serverSettingsReady" class="settingsLoading">Waiting for server settings…</div>
        <div v-else class="stack-panel scrollContent scroll-thin">
          <div class="section">
            <div class="sub">Gamepad Jogging</div>
            <div class="settingDesc">Use an Xbox, PlayStation, or standard gamepad to jog the machine.</div>
            <MachineToggle gate="inputConfig" v-model="gpEnabled" label="Enable gamepad jogging" />
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
            <MachineToggle gate="inputConfig" v-model="gpInvertX" label="Invert X" />
            <MachineToggle gate="inputConfig" v-model="gpInvertY" label="Invert Y" />
            <MachineToggle gate="inputConfig" v-model="gpInvertZ" label="Invert Z" />
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

          <div class="sep" v-if="props.gamepadConfig?.enabled"></div>

          <div v-if="props.gamepadConfig?.enabled" class="section">
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
            <div v-if="props.gamepadConnected" style="margin-top: var(--gap-section);">
              <div class="settingDesc">Move sticks and press buttons to verify mapping.</div>
              <GamepadLiveInput :deadZone="props.gamepadConfig?.deadZone ?? 0.15" />
            </div>
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
              <div class="sub">Keyboard Shortcuts</div>
              <div class="settingDesc">Allow keyboard keys to control the machine. When disabled, no keyboard shortcuts are active except E-Stop.</div>
              <MachineToggle gate="inputConfig" v-model="kbConfig.enabled" @update:modelValue="saveKb()" label="Enable keyboard shortcuts" />
            </div>

            <template v-if="kbConfig.enabled">
              <div class="sep"></div>

              <div class="section">
                <div class="sub">Keyboard Jogging</div>
                <div class="settingDesc">Allow jog keys to move axes.</div>
                <MachineToggle gate="inputConfig" v-model="kbConfig.jogEnabled" @update:modelValue="saveKb()" label="Enable keyboard jogging" />
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
                    <tr v-for="action in COMMAND_ACTIONS" :key="action">
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

      <template #hal>
        <div class="halPane">
          <!-- Header: section toggles + search + refresh (pinned) -->
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
              <MachineBtn type="inline" class="optBtn" @click="refreshHal" :disabled="halLoading">
                {{ halLoading ? '...' : 'Refresh' }}
              </MachineBtn>
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
          <Gate gate="idle" class="dialogActions">
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
  padding: var(--gap-tight) var(--gap-controls);
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
  margin-bottom: var(--gap-micro);
}

.halGroupHeader {
  display: flex;
  align-items: center;
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
