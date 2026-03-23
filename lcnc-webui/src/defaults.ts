import { ref } from "vue";

// ─── Input step constants ─────────────────────────────────────────
export const STEP_DEFAULT = 1;
export const STEP_FEED = 10;
export const STEP_RPM = 10;
export const STEP_OVERRIDE = 5;
export const STEP_RAPID_OVERRIDE = 25;

// ─── Shared types (single source of truth) ───────────────────────

export type Vec3 = [number, number, number];

export type Layer = "backplot" | "toolpath" | "machine" | "workpiece" | "bounds" | "workzero" | "hud" | "surface" | "tool";
export const ALL_LAYERS: Layer[] = ["backplot", "toolpath", "machine", "workpiece", "bounds", "workzero", "hud", "surface", "tool"];

export type TrackMode = "none" | "tool" | "workpiece";
export type Projection = "perspective" | "parallel";

export interface ColorDefaults {
  feed: string;
  rapid: string;
  backplot: string;
  bounds: string;
  workpiece: string;
  tool: string;
  cutter: string;
}

export interface OpacityDefaults {
  workpiece: number;
  bounds: number;
  machine: number;
  toolpath: number;
  backplot: number;
  hud: number;
}

export interface ViewerDefaults {
  workpieceSize: Vec3;
  workpieceOffset: Vec3;
  layers: Record<Layer, boolean>;
  colors: ColorDefaults;
  opacities: OpacityDefaults;
  machineColors: Record<string, string>;
  machineEdges: boolean;
  trackingMode: TrackMode;
  pathOnTop: boolean;
  projection: Projection;
}

// ─── Section registry ────────────────────────────────────────────

const STORAGE_KEY = "lcnc-defaults";

interface SectionDef<T> {
  fallback: T;
  merge: (saved: any, fallback: T) => T;
}

const sections = new Map<string, SectionDef<any>>();

/**
 * Register a defaults section. Call at module top-level.
 * Future features (tooltable, tool handling, etc.) register their own section.
 */
export function registerSection<T>(key: string, fallback: T, merge: (saved: any, fb: T) => T): void {
  sections.set(key, { fallback, merge });
}

// ─── Storage I/O ─────────────────────────────────────────────────

/** Sections stored on the server (shared across all clients). */
const SERVER_SECTIONS = new Set(["macros", "machine", "camera", "mdi", "gamepad", "keyboard", "probe", "toolsetter"]);

/** Reactive version counter — incremented on every server settings update.
 *  Components watch this to re-read their section when another client saves. */
export const settingsVersion = ref(0);

/** In-memory cache — localStorage is read at most once per page load. */
let _cache: Record<string, any> | null = null;

/** Server-side data populated before app mount. */
let _serverData: Record<string, any> = {};

/** True once server settings have been confirmed (REST fetch or WS delivery). */
export const serverSettingsReady = ref(false);

/** Debounce timers for server saves. */
const _saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};

/** Pending saves awaiting debounce flush — used by sendBeacon on page exit. */
const _pendingSaves = new Map<string, any>();

/** Called once from main.ts before createApp().mount(). */
export function initServerDefaults(data: Record<string, any>, fetchOk: boolean): void {
  _serverData = data;
  if (!_cache) _cache = {};
  for (const [key, val] of Object.entries(data)) {
    _cache[key] = val;
  }
  if (fetchOk) serverSettingsReady.value = true;
}

/** Called from lcncWs.ts on settings_init (connect) or settings_changed (broadcast). */
export function updateServerCache(data: Record<string, any>): void {
  _serverData = data;
  if (!_cache) _cache = {};
  for (const [key, val] of Object.entries(data)) {
    _cache[key] = val;
  }
  serverSettingsReady.value = true;
  settingsVersion.value++;
}

/** Flush pending debounced saves via sendBeacon (called on page hide). */
function flushPendingSaves(): void {
  for (const [section, data] of _pendingSaves) {
    navigator.sendBeacon(
      `/settings/${section}`,
      new Blob([JSON.stringify({ data })], { type: "application/json" }),
    );
  }
  _pendingSaves.clear();
  for (const key of Object.keys(_saveTimers)) {
    clearTimeout(_saveTimers[key]);
    delete _saveTimers[key];
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPendingSaves();
});

function readAll(): Record<string, any> {
  if (_cache) return _cache;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migration: flat format (has "layers" at top level, no "viewer" key)
      // → wrap under "viewer" section
      if (parsed && typeof parsed === "object" && !parsed.viewer && parsed.layers) {
        _cache = { viewer: parsed };
      } else {
        _cache = (parsed as Record<string, any>) ?? {};
      }
    } else {
      _cache = {};
    }
  } catch {
    _cache = {};
  }

  // Server sections override localStorage
  for (const [key, val] of Object.entries(_serverData)) {
    _cache[key] = val;
  }
  return _cache;
}

/** Load a section. Returns fully merged data (saved values + fallbacks). */
export function loadSection<T>(key: string): T {
  const def = sections.get(key);
  if (!def) throw new Error(`defaults: unknown section "${key}"`);

  const all = readAll();
  const saved = all[key];
  return def.merge(saved, def.fallback);
}

/** Save a section. Routes server sections through WS, local sections to localStorage. */
export function saveSection(key: string, data: any): void {
  // Block server section saves until server data is confirmed
  if (SERVER_SECTIONS.has(key) && !serverSettingsReady.value) return;

  const all = readAll();
  all[key] = data;
  _cache = all;

  if (SERVER_SECTIONS.has(key)) {
    // Track pending save for sendBeacon flush on page exit
    _pendingSaves.set(key, data);
    // Debounce server saves (camera sliders fire rapidly)
    clearTimeout(_saveTimers[key]);
    _saveTimers[key] = setTimeout(() => {
      _pendingSaves.delete(key);
      // Dynamic import to avoid circular dependency at module load time
      import("./lcncWs").then(({ saveSettings }) => saveSettings(key, data));
    }, 300);
  } else {
    // Only persist local-only sections to localStorage
    const localOnly: Record<string, any> = {};
    for (const [k, v] of Object.entries(all)) {
      if (!SERVER_SECTIONS.has(k)) localOnly[k] = v;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localOnly));
  }
}

// ─── Viewer section ──────────────────────────────────────────────

const VIEWER_FALLBACK: ViewerDefaults = {
  workpieceSize: [100, 100, 20],
  workpieceOffset: [0, 0, -20],
  layers: { backplot: true, toolpath: true, machine: true, workpiece: true, bounds: true, workzero: true, hud: true, surface: true, tool: true },
  colors: { feed: "#22b8cf", rapid: "#f5a623", backplot: "#ff00ff", bounds: "#ffffff", workpiece: "#ffffff", tool: "#c0c0c0", cutter: "#ffdd00" },
  opacities: { workpiece: 0.16, bounds: 0.10, machine: 1.0, toolpath: 1.0, backplot: 0.55, hud: 1.0 },
  machineColors: {},
  machineEdges: true,
  trackingMode: "none",
  pathOnTop: false,
  projection: "parallel",
};

registerSection<ViewerDefaults>("viewer", VIEWER_FALLBACK, (saved, fb) => {
  if (!saved) return JSON.parse(JSON.stringify(fb));
  return {
    workpieceSize: (saved.workpieceSize ?? [...fb.workpieceSize]) as Vec3,
    workpieceOffset: (saved.workpieceOffset ?? [...fb.workpieceOffset]) as Vec3,
    layers: { ...fb.layers, ...saved.layers } as Record<Layer, boolean>,
    colors: { ...fb.colors, ...saved.colors },
    opacities: { ...fb.opacities, ...saved.opacities },
    machineColors: { ...fb.machineColors, ...saved.machineColors },
    machineEdges: saved.machineEdges ?? fb.machineEdges,
    trackingMode: (saved.trackingMode ?? fb.trackingMode) as TrackMode,
    pathOnTop: saved.pathOnTop ?? fb.pathOnTop,
    projection: (saved.projection ?? fb.projection) as Projection,
  };
});

/** Load viewer defaults (typed convenience wrapper). */
export function loadViewerDefaults(): ViewerDefaults {
  return loadSection<ViewerDefaults>("viewer");
}

/** Save viewer defaults (typed convenience wrapper). */
export function saveViewerDefaults(data: ViewerDefaults): void {
  saveSection("viewer", data);
}

// ─── Machine section ─────────────────────────────────────────────

export type ToolChangeMode = "m6g43" | "m600";

export type SpindleDir = "off" | "forward" | "reverse";

export type SpindleFeedbackUnit = "rps" | "rpm";

export interface MachineDefaults {
  toolChangeMode: ToolChangeMode;
  runFromLine: boolean;
  rflSpindleDir: SpindleDir;
  rflSpindleRpm: number;
  spindleFeedbackUnit: SpindleFeedbackUnit;
  spindleLoadPin: string;
}

const MACHINE_FALLBACK: MachineDefaults = {
  toolChangeMode: "m6g43",
  runFromLine: false,
  rflSpindleDir: "forward",
  rflSpindleRpm: 10000,
  spindleFeedbackUnit: "rps",
  spindleLoadPin: "",
};

registerSection<MachineDefaults>("machine", MACHINE_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb };
  const dir = saved.rflSpindleDir;
  return {
    toolChangeMode: (saved.toolChangeMode === "m600" ? "m600" : "m6g43") as ToolChangeMode,
    runFromLine: saved.runFromLine ?? fb.runFromLine,
    rflSpindleDir: (dir === "off" || dir === "forward" || dir === "reverse" ? dir : fb.rflSpindleDir) as SpindleDir,
    rflSpindleRpm: typeof saved.rflSpindleRpm === "number" ? saved.rflSpindleRpm : fb.rflSpindleRpm,
    spindleFeedbackUnit: (saved.spindleFeedbackUnit === "rpm" ? "rpm" : "rps") as SpindleFeedbackUnit,
    spindleLoadPin: typeof saved.spindleLoadPin === "string" ? saved.spindleLoadPin : fb.spindleLoadPin,
  };
});

export function loadMachineDefaults(): MachineDefaults {
  return loadSection<MachineDefaults>("machine");
}

export function saveMachineDefaults(data: MachineDefaults): void {
  saveSection("machine", data);
}

// ─── Panels section ─────────────────────────────────────────────

export const MAX_PANELS = 3;

export interface PanelsDefaults {
  tabs: string[];
}

registerSection<PanelsDefaults>("panels", { tabs: ["viewer", "manual"] }, (saved, fb) => {
  if (!saved) return { ...fb };
  const tabs = saved.tabs;
  if (!Array.isArray(tabs) || tabs.length === 0) return { ...fb };

  // Migration: replace old/removed tabs with "manual"
  const OLD_TABS = new Set(["dro", "jog", "mdi", "overrides", "spindle", "messages", "settings"]);
  let migrated = false;
  const result: string[] = [];
  for (const t of tabs) {
    if (OLD_TABS.has(t)) {
      if (!migrated) { result.push("manual"); migrated = true; }
      // skip subsequent old tabs
    } else {
      result.push(t);
    }
  }

  return { tabs: result.slice(0, MAX_PANELS) };
});

/** Load panels defaults (typed convenience wrapper). */
export function loadPanelsDefaults(): PanelsDefaults {
  return loadSection<PanelsDefaults>("panels");
}

/** Save panels defaults (typed convenience wrapper). */
export function savePanelsDefaults(data: PanelsDefaults): void {
  saveSection("panels", data);
}

// ─── MDI section ────────────────────────────────────────────────

export interface MdiDefaults {
  history: string[];
}

registerSection<MdiDefaults>("mdi", { history: [] }, (saved, fb) => {
  if (!saved) return { ...fb };
  return {
    history: Array.isArray(saved.history) ? saved.history.slice(0, 50) : fb.history,
  };
});

export function loadMdiHistory(): string[] {
  return loadSection<MdiDefaults>("mdi").history;
}

export function saveMdiHistory(history: string[]): void {
  saveSection("mdi", { history });
}

// ─── Display section ────────────────────────────────────────────

export type ThemeMode = "auto" | "light" | "dark" | "hc-light" | "hc-dark";
const VALID_THEMES = new Set<string>(["auto", "light", "dark", "hc-light", "hc-dark"]);

export interface DisplayDefaults {
  theme: ThemeMode;
  startFullscreen: boolean;
}

const DISPLAY_FALLBACK: DisplayDefaults = { theme: "auto", startFullscreen: false };

registerSection<DisplayDefaults>("display", DISPLAY_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb };
  const t = saved.theme;
  return {
    theme: (VALID_THEMES.has(t) ? t : fb.theme) as ThemeMode,
    startFullscreen: typeof saved.startFullscreen === "boolean" ? saved.startFullscreen : fb.startFullscreen,
  };
});

export function loadDisplayDefaults(): DisplayDefaults {
  return loadSection<DisplayDefaults>("display");
}

export function saveDisplayDefaults(data: DisplayDefaults): void {
  saveSection("display", data);
}

// ─── Macros section ─────────────────────────────────────────────

export interface MacroParam {
  name: string;      // placeholder key, e.g. "depth"
  label: string;     // display label, e.g. "Depth (mm)"
  default: string;   // default value shown in prompt
}

export interface MacroDef {
  id: string;        // unique ID
  name: string;      // button label, e.g. "Face Top"
  command: string;   // G-code template, e.g. "G0 Z{depth} F{feed}"
  params: MacroParam[];
}

export interface MacrosDefaults {
  macros: MacroDef[];
}

const MACROS_FALLBACK: MacrosDefaults = { macros: [] };

registerSection<MacrosDefaults>("macros", MACROS_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb };
  if (!Array.isArray(saved.macros)) return { ...fb };
  const macros = saved.macros
    .filter((m: any) => m && typeof m.id === "string" && typeof m.name === "string" && typeof m.command === "string")
    .map((m: any) => ({
      id: m.id,
      name: m.name,
      command: m.command,
      params: Array.isArray(m.params) ? m.params
        .filter((p: any) => p && typeof p.name === "string")
        .map((p: any) => ({
          name: p.name,
          label: typeof p.label === "string" ? p.label : p.name,
          default: typeof p.default === "string" ? p.default : "",
        })) : [],
    }))
    .slice(0, 20);
  return { macros };
});

export function loadMacrosDefaults(): MacrosDefaults {
  return loadSection<MacrosDefaults>("macros");
}

export function saveMacrosDefaults(data: MacrosDefaults): void {
  saveSection("macros", data);
}

/** Extract unique placeholder names from a macro command string. */
export function extractParams(command: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of command.matchAll(/\{(\w+)\}/g)) {
    const name = match[1]!;
    if (!seen.has(name)) { seen.add(name); result.push(name); }
  }
  return result;
}

// ─── Camera section ─────────────────────────────────────────────

export interface CameraDefaults {
  showCrosshair: boolean;
  showCircle: boolean;
  showGrid: boolean;
  circleRadius: number;
  gridSpacing: number;
  overlayOpacity: number;
  overlayColor: string;
}

const CAMERA_FALLBACK: CameraDefaults = {
  showCrosshair: true,
  showCircle: true,
  showGrid: false,
  circleRadius: 50,
  gridSpacing: 50,
  overlayOpacity: 0.8,
  overlayColor: "#00ff00",
};

registerSection<CameraDefaults>("camera", CAMERA_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb };
  return {
    showCrosshair: saved.showCrosshair ?? fb.showCrosshair,
    showCircle: saved.showCircle ?? fb.showCircle,
    showGrid: saved.showGrid ?? fb.showGrid,
    circleRadius: typeof saved.circleRadius === "number" ? saved.circleRadius : fb.circleRadius,
    gridSpacing: typeof saved.gridSpacing === "number" ? saved.gridSpacing : fb.gridSpacing,
    overlayOpacity: typeof saved.overlayOpacity === "number" ? saved.overlayOpacity : fb.overlayOpacity,
    overlayColor: typeof saved.overlayColor === "string" ? saved.overlayColor : fb.overlayColor,
  };
});

export function loadCameraDefaults(): CameraDefaults {
  return loadSection<CameraDefaults>("camera");
}

export function saveCameraDefaults(data: CameraDefaults): void {
  saveSection("camera", data);
}

// ─── Gamepad section ─────────────────────────────────────────────

/** Actions assignable to gamepad buttons. */
export type GamepadAction =
  | "start" | "pause" | "resume" | "abort"
  | "estop" | "spindle_stop" | "flood_toggle" | "mist_toggle" | "home_all"
  | "z_mod" | "dead_man" | "none";

export const GAMEPAD_ACTIONS: { value: GamepadAction; label: string }[] = [
  { value: "start", label: "Cycle Start / Resume" },
  { value: "pause", label: "Pause" },
  { value: "resume", label: "Resume" },
  { value: "abort", label: "Abort" },
  { value: "estop", label: "E-Stop" },
  { value: "spindle_stop", label: "Spindle Stop" },
  { value: "flood_toggle", label: "Flood Toggle" },
  { value: "mist_toggle", label: "Mist Toggle" },
  { value: "home_all", label: "Home All" },
  { value: "z_mod", label: "Z Modifier (D-pad)" },
  { value: "dead_man", label: "Dead Man (hold to jog)" },
  { value: "none", label: "Unassigned" },
];

export interface GamepadMapping {
  btn_a: GamepadAction;
  btn_b: GamepadAction;
  btn_x: GamepadAction;
  btn_y: GamepadAction;
  btn_lb: GamepadAction;
  btn_rb: GamepadAction;
  btn_lt: GamepadAction;
  btn_rt: GamepadAction;
  btn_back: GamepadAction;
  btn_start: GamepadAction;
  btn_ls: GamepadAction;
  btn_rs: GamepadAction;
}

export const DEFAULT_MAPPING: GamepadMapping = {
  btn_a: "start",
  btn_b: "abort",
  btn_x: "pause",
  btn_y: "resume",
  btn_lb: "z_mod",
  btn_rb: "none",
  btn_lt: "none",
  btn_rt: "dead_man",
  btn_back: "none",
  btn_start: "none",
  btn_ls: "none",
  btn_rs: "none",
};

/** Map standard gamepad button index → mapping key. */
export const BTN_INDEX_TO_KEY: Record<number, keyof GamepadMapping> = {
  0: "btn_a",
  1: "btn_b",
  2: "btn_x",
  3: "btn_y",
  4: "btn_lb",
  5: "btn_rb",
  6: "btn_lt",
  7: "btn_rt",
  8: "btn_back",
  9: "btn_start",
  10: "btn_ls",
  11: "btn_rs",
};

/** Short display labels for actions (used in diagram). */
export const ACTION_LABELS: Record<GamepadAction, string> = {
  start: "Start",
  pause: "Pause",
  resume: "Resume",
  abort: "Abort",
  estop: "E-Stop",
  spindle_stop: "Spdl Stop",
  flood_toggle: "Flood",
  mist_toggle: "Mist",
  home_all: "Home",
  z_mod: "Z Mod",
  dead_man: "Dead Man",
  none: "",
};

export interface GamepadDefaults {
  enabled: boolean;
  deadZone: number;
  invertX: boolean;
  invertY: boolean;
  invertZ: boolean;
  mapping: GamepadMapping;
}

export const GAMEPAD_FALLBACK: GamepadDefaults = {
  enabled: false,
  deadZone: 0.15,
  invertX: false,
  invertY: false,
  invertZ: false,
  mapping: { ...DEFAULT_MAPPING },
};

function mergeMapping(saved: any, fb: GamepadMapping): GamepadMapping {
  if (!saved || typeof saved !== "object") return { ...fb };
  const valid = new Set<string>(GAMEPAD_ACTIONS.map(a => a.value));
  const result: any = {};
  for (const key of Object.keys(fb)) {
    const v = saved[key];
    result[key] = (typeof v === "string" && valid.has(v)) ? v : (fb as any)[key];
  }
  return result as GamepadMapping;
}

registerSection<GamepadDefaults>("gamepad", GAMEPAD_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb, mapping: { ...fb.mapping } };
  return {
    enabled: saved.enabled ?? fb.enabled,
    deadZone: typeof saved.deadZone === "number" ? saved.deadZone : fb.deadZone,
    invertX: saved.invertX ?? fb.invertX,
    invertY: saved.invertY ?? fb.invertY,
    invertZ: saved.invertZ ?? fb.invertZ,
    mapping: mergeMapping(saved.mapping, fb.mapping),
  };
});

export function loadGamepadDefaults(): GamepadDefaults {
  return loadSection<GamepadDefaults>("gamepad");
}

export function saveGamepadDefaults(data: GamepadDefaults): void {
  saveSection("gamepad", data);
}

// ── Keyboard shortcuts ──────────────────────────────────────────

export type KeyboardAction =
  | "jog_x+" | "jog_x-" | "jog_y+" | "jog_y-" | "jog_z+" | "jog_z-"
  | "jog_a+" | "jog_a-" | "jog_b+" | "jog_b-"
  | "estop" | "cycle" | "abort";

export const KEYBOARD_ACTION_LABELS: Record<KeyboardAction, string> = {
  "jog_x+": "Jog X+", "jog_x-": "Jog X-",
  "jog_y+": "Jog Y+", "jog_y-": "Jog Y-",
  "jog_z+": "Jog Z+", "jog_z-": "Jog Z-",
  "jog_a+": "Jog A+", "jog_a-": "Jog A-",
  "jog_b+": "Jog B+", "jog_b-": "Jog B-",
  estop: "E-Stop",
  cycle: "Cycle Start / Pause / Resume",
  abort: "Abort",
};

const ALL_KB_ACTIONS = Object.keys(KEYBOARD_ACTION_LABELS) as KeyboardAction[];

export const DEFAULT_KB_MAPPING: Record<KeyboardAction, string> = {
  "jog_x+": "ArrowRight", "jog_x-": "ArrowLeft",
  "jog_y+": "ArrowUp",    "jog_y-": "ArrowDown",
  "jog_z+": "PageUp",     "jog_z-": "PageDown",
  "jog_a+": "]",           "jog_a-": "[",
  "jog_b+": "'",           "jog_b-": ";",
  estop: "Escape",
  cycle: " ",
  abort: "Backspace",
};

export interface KeyboardDefaults {
  enabled: boolean;
  jogEnabled: boolean;
  mapping: Record<KeyboardAction, string>;
}

const KEYBOARD_FALLBACK: KeyboardDefaults = {
  enabled: true,
  jogEnabled: false,
  mapping: { ...DEFAULT_KB_MAPPING },
};

const KEY_DISPLAY: Record<string, string> = {
  ArrowRight: "→", ArrowLeft: "←", ArrowUp: "↑", ArrowDown: "↓",
  " ": "Space", Escape: "Esc", Backspace: "⌫",
  PageUp: "PgUp", PageDown: "PgDn",
  Delete: "Del", Insert: "Ins",
  Enter: "Enter", Home: "Home", End: "End",
};

export function formatKeyName(key: string): string {
  if (!key) return "None";
  if (KEY_DISPLAY[key]) return KEY_DISPLAY[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

registerSection<KeyboardDefaults>("keyboard", KEYBOARD_FALLBACK, (saved, fb) => {
  if (!saved) {
    // Cross-section migration: read keyboardJog from raw machine data
    // (loadSection strips unknown fields, so read raw cache instead)
    const machRaw = readAll().machine;
    const jogEnabled = machRaw?.keyboardJog ?? fb.jogEnabled;
    return { ...fb, jogEnabled, mapping: { ...fb.mapping } };
  }
  const mapping = { ...fb.mapping };
  if (saved.mapping && typeof saved.mapping === "object") {
    for (const action of ALL_KB_ACTIONS) {
      if (typeof saved.mapping[action] === "string") {
        mapping[action] = saved.mapping[action];
      }
    }
  }
  return {
    enabled: saved.enabled ?? fb.enabled,
    jogEnabled: saved.jogEnabled ?? fb.jogEnabled,
    mapping,
  };
});

export function loadKeyboardDefaults(): KeyboardDefaults {
  return loadSection<KeyboardDefaults>("keyboard");
}

export function saveKeyboardDefaults(data: KeyboardDefaults): void {
  saveSection("keyboard", data);
}

// ─── Probe section ──────────────────────────────────────────────

export interface ProbeDefaults {
  probeTool: number;
  slowFr: number;
  fastFr: number;
  traverseFr: number;
  maxXYDistance: number;
  xyClearance: number;
  maxZDistance: number;
  zClearance: number;
  calOffset: number;
  stepOffWidth: number;
  extraProbeDepth: number;
  edgeWidth: number;
  diameterHint: number;
  xHintBP: number;
  yHintBP: number;
  xHintRV: number;
  yHintRV: number;
  wcoRotation: number;
  calDiameter: number;
  xCalWidth: number;
  yCalWidth: number;
  scanX0: number;
  scanX1: number;
  scanY0: number;
  scanY1: number;
  scanXProbes: number;
  scanYProbes: number;
  scanSafeZ: number;
  scanDepthZ: number;
  autoZero: boolean;
}

const PROBE_FALLBACK: ProbeDefaults = {
  probeTool: 99, slowFr: 50, fastFr: 200, traverseFr: 1000,
  maxXYDistance: 10, xyClearance: 2, maxZDistance: 10, zClearance: 2,
  calOffset: 0, stepOffWidth: 5, extraProbeDepth: 0, edgeWidth: 0.5,
  diameterHint: 0, xHintBP: 0, yHintBP: 0, xHintRV: 0, yHintRV: 0,
  wcoRotation: 0, calDiameter: 0, xCalWidth: 0, yCalWidth: 0,
  scanX0: 10, scanX1: 200, scanY0: 10, scanY1: 200,
  scanXProbes: 5, scanYProbes: 5, scanSafeZ: 20, scanDepthZ: 24,
  autoZero: false,
};

function mergeNumField(saved: any, key: string, fb: number): number {
  return typeof saved?.[key] === "number" ? saved[key] : fb;
}

registerSection<ProbeDefaults>("probe", PROBE_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb };
  const r: any = {};
  for (const [k, v] of Object.entries(fb)) {
    if (typeof v === "boolean") r[k] = saved[k] ?? v;
    else r[k] = mergeNumField(saved, k, v as number);
  }
  return r as ProbeDefaults;
});

export function loadProbeDefaults(): ProbeDefaults {
  return loadSection<ProbeDefaults>("probe");
}

export function saveProbeDefaults(data: ProbeDefaults): void {
  saveSection("probe", data);
}

// ─── Toolsetter section ─────────────────────────────────────────

export interface ToolsetterDefaults {
  fastFeed: number;
  slowFeed: number;
  traverseFeed: number;
  maxZTravel: number;
  retractDist: number;
  spindleZeroHeight: number;
  offsetDirection: number;
  touchX: number;
  touchY: number;
  touchZ: number;
  useToolTable: number;
  toolMinDis: number;
  brakeAfter: number;
  goBackToStart: number;
  spindleStopM: number;
  disablePrePos: number;
  addReps: number;
  lastTry: number;
  offsetDiameter: number;
  offsetValue: number;
  finderTouchX: number;
  finderTouchY: number;
  finderDiffZ: number;
}

export const TOOLSETTER_FALLBACK: ToolsetterDefaults = {
  fastFeed: 0, slowFeed: 0, traverseFeed: 0, maxZTravel: 0,
  retractDist: 0, spindleZeroHeight: 0, offsetDirection: 0,
  touchX: 0, touchY: 0, touchZ: 0, useToolTable: 0, toolMinDis: 0,
  brakeAfter: 0, goBackToStart: 0, spindleStopM: 5, disablePrePos: 0,
  addReps: 0, lastTry: 0, offsetDiameter: 0, offsetValue: 0,
  finderTouchX: 0, finderTouchY: 0, finderDiffZ: 0,
};

registerSection<ToolsetterDefaults>("toolsetter", TOOLSETTER_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb };
  const r: any = {};
  for (const [k, v] of Object.entries(fb)) {
    r[k] = mergeNumField(saved, k, v as number);
  }
  return r as ToolsetterDefaults;
});

export function loadToolsetterDefaults(): ToolsetterDefaults {
  return loadSection<ToolsetterDefaults>("toolsetter");
}

export function saveToolsetterDefaults(data: ToolsetterDefaults): void {
  saveSection("toolsetter", data);
}

/** Clear all persisted settings so next load returns factory defaults. */
export function resetAllDefaults(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("lcnc-toolsetter-params");
  localStorage.removeItem("lcnc-probe-params");
  _cache = null;
  _serverData = {};
  // Fire-and-forget server reset
  import("./lcncApi").then(({ resetServerSettings }) => resetServerSettings());
}
