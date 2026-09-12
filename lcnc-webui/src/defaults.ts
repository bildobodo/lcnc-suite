import { ref } from "vue";
import { withToken } from "./auth";
import { resetServerSettings } from "./lcncApi";
import type { GamepadProfile } from "./gamepadProfile";

// lcncWs registers its WS settings-saver here so this module can flush a save
// WITHOUT importing lcncWs (which imports defaults) — removes the import cycle and
// the ineffective-dynamic-import build warning (P6). Registered when lcncWs loads
// (app startup), long before any user-triggered save flush.
let _settingsSaver: ((section: string, data: any) => void) | null = null;
export function registerSettingsSaver(fn: (section: string, data: any) => void): void {
  _settingsSaver = fn;
}

// ─── Input step constants ─────────────────────────────────────────
export const STEP_DEFAULT = 1;
export const STEP_FEED = 10;
export const STEP_RPM = 10;
export const STEP_OVERRIDE = 5;
export const STEP_RAPID_OVERRIDE = 25;

// ─── Shared types (single source of truth) ───────────────────────

export type Vec3 = [number, number, number];

export type Layer = "backplot" | "toolpath" | "machine" | "bounds" | "toolpathBounds" | "reach" | "workzero" | "hud" | "surface" | "tool" | "workplane";
export const ALL_LAYERS: Layer[] = ["backplot", "toolpath", "machine", "bounds", "toolpathBounds", "reach", "workzero", "hud", "surface", "tool", "workplane"];

export type TrackMode = "none" | "tool" | "wcs";
export type Projection = "perspective" | "parallel";

export interface ColorDefaults {
  feed: string;
  rapid: string;
  backplot: string;
  bounds: string;
  toolpathBounds: string;
  tool: string;
  cutter: string;
}

export type HudScale = "sm" | "md" | "lg" | "xl";

export interface HudDefaults {
  scale: HudScale;
  showMachine: boolean;      // machine-position column next to work position
  showTool: boolean;         // T / Ø / L segment of the context line
  showFeedSpindle: boolean;  // F / S segment of the context line
  showLoadBar: boolean;      // spindle load bar under the context line
}

// Toolpath preview frame: "part" transforms rotary-swept moves into the
// rotating work frame (matches the backplot); "programmed" plots raw XYZ.
// Only differs on machines with rotary axes in the work/tool chain.
export type PreviewMode = "part" | "programmed";

export interface ViewerDefaults {
  layers: Record<Layer, boolean>;
  colors: ColorDefaults;
  machineColors: Record<string, string>;
  machineEdges: boolean;
  trackingMode: TrackMode;
  pathOnTop: boolean;
  projection: Projection;
  previewMode: PreviewMode;
  hud: HudDefaults;
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

/** Reactive version counter — incremented on every server settings update.
 *  Components watch this to re-read their section when another client saves. */
export const settingsVersion = ref(0);

/** In-memory cache — localStorage is read at most once per page load. */
let _cache: Record<string, any> | null = null;

/** True once server settings have been confirmed (REST fetch or WS delivery). */
export const serverSettingsReady = ref(false);

/** Debounce timers for server saves. */
const _saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};

/** Pending saves awaiting debounce flush — used by sendBeacon on page exit. */
const _pendingSaves = new Map<string, any>();

/** Called once from main.ts before createApp().mount(). */
export function initServerDefaults(data: Record<string, any>, fetchOk: boolean): void {
  _cache = { ...data };
  if (fetchOk) serverSettingsReady.value = true;
}

/**
 * Called from lcncWs.ts on settings_init (connect) or settings_changed (broadcast).
 * Full-replace is intentional and load-bearing: the gateway ALWAYS sends the
 * complete per-INI settings blob on both messages (gateway.py status_loop
 * "send full settings when version changes" + settings_init). Do NOT change
 * this to a merge — a merge would resurrect a section the operator deleted.
 */
export function updateServerCache(data: Record<string, any>): void {
  _cache = { ...data };
  serverSettingsReady.value = true;
  settingsVersion.value++;
}

/** Flush pending debounced saves via sendBeacon (called on page hide). */
function flushPendingSaves(): void {
  for (const [section, data] of _pendingSaves) {
    // sendBeacon can't set headers, so the token rides in the query string
    // (the require_token dependency accepts ?token= as well as the header).
    navigator.sendBeacon(
      withToken(`/settings/${section}`),
      new Blob([JSON.stringify({ data })], { type: "application/json" }),
    );
  }
  _pendingSaves.clear();
  for (const key of Object.keys(_saveTimers)) {
    clearTimeout(_saveTimers[key]);
    delete _saveTimers[key];
  }
}

const _onVisibilityFlush = () => {
  if (document.visibilityState === "hidden") flushPendingSaves();
};
document.addEventListener("visibilitychange", _onVisibilityFlush);
// Remove on HMR dispose so reloads don't stack duplicate flush listeners (#32).
if (import.meta.hot) {
  import.meta.hot.dispose(() => document.removeEventListener("visibilitychange", _onVisibilityFlush));
}

function readAll(): Record<string, any> {
  if (!_cache) _cache = {};
  return _cache;
}

/** Load a section. Returns fully merged data (saved values + fallbacks). */
export function loadSection<T>(key: string): T {
  const def = sections.get(key);
  if (!def) throw new Error(`defaults: unknown section "${key}"`);

  const all = readAll();
  const saved = all[key];
  try {
    return def.merge(saved, def.fallback);
  } catch (e) {
    // Section merge functions can throw on malformed server data (e.g. wrong
    // shape after a manual settings.json edit). Fall back to defaults loudly
    // so the issue is visible rather than masked by a partial merge.
    console.warn(`[defaults] merge failed for section "${key}", using fallback:`, e);
    return JSON.parse(JSON.stringify(def.fallback));
  }
}

/** Save a section. Routes server sections through WS, local sections to localStorage. */
export function saveSection(key: string, data: any): void {
  // Block saves until server data is confirmed (prevents overwriting with fallback zeros)
  if (!serverSettingsReady.value) return;

  const all = readAll();
  all[key] = data;
  _cache = all;

  // Track pending save for sendBeacon flush on page exit
  _pendingSaves.set(key, data);
  // Debounce server saves (camera sliders fire rapidly)
  clearTimeout(_saveTimers[key]);
  _saveTimers[key] = setTimeout(() => {
    _pendingSaves.delete(key);
    if (_settingsSaver) {
      _settingsSaver(key, data);  // registered by lcncWs (avoids the import cycle)
    } else {
      // No silent drop: lcncWs registers at module load, so this "can't happen" —
      // which is exactly why it must be loud if it does (the save would vanish).
      // console.error is captured by the error.console telemetry hook → auditable.
      console.error(`[settings] save DROPPED — no saver registered (section=${key})`);
    }
  }, 300);
}

// ─── Viewer section ──────────────────────────────────────────────

export const HUD_FALLBACK: HudDefaults = {
  scale: "md",
  showMachine: true,
  showTool: true,
  showFeedSpindle: true,
  showLoadBar: true,
};

const VIEWER_FALLBACK: ViewerDefaults = {
  layers: { backplot: true, toolpath: true, machine: true, bounds: true, toolpathBounds: false, reach: false, workzero: true, hud: true, surface: true, tool: true, workplane: true },
  colors: { feed: "#22b8cf", rapid: "#f5a623", backplot: "#ff00ff", bounds: "#ffffff", toolpathBounds: "#f5a623", tool: "#c0c0c0", cutter: "#ffdd00" },
  machineColors: {},
  machineEdges: true,
  trackingMode: "none",
  pathOnTop: false,
  projection: "parallel",
  previewMode: "part",
  hud: { ...HUD_FALLBACK },
};

registerSection<ViewerDefaults>("viewer", VIEWER_FALLBACK, (saved, fb) => {
  if (!saved) return JSON.parse(JSON.stringify(fb));
  return {
    ...fb,
    ...saved,
    layers: { ...fb.layers, ...saved.layers } as Record<Layer, boolean>,
    colors: { ...fb.colors, ...saved.colors },
    machineColors: { ...fb.machineColors, ...saved.machineColors },
    hud: { ...fb.hud, ...saved.hud },
  };
});

/** Load viewer defaults (typed convenience wrapper). */
export function loadViewerDefaults(): ViewerDefaults {
  return loadSection<ViewerDefaults>("viewer");
}

/** Fresh deep copy of the viewer fallback — the single source for "factory
 *  state" (used by the Settings reset; never hand-duplicate the literal). */
export function viewerFallback(): ViewerDefaults {
  return JSON.parse(JSON.stringify(VIEWER_FALLBACK));
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
  rflSafeZ: boolean;          // retract to G53 Z0 (never lowered) before a run-from-line start
  spindleFeedbackUnit: SpindleFeedbackUnit;
  spindleLoadPin: string;
  autoDisarmMin: number;      // idle auto-disarm timeout in minutes; 0 = off
}

const MACHINE_FALLBACK: MachineDefaults = {
  toolChangeMode: "m6g43",
  runFromLine: false,
  rflSpindleDir: "forward",
  rflSpindleRpm: 10000,
  rflSafeZ: true,
  spindleFeedbackUnit: "rps",
  spindleLoadPin: "",
  autoDisarmMin: 10,
};

registerSection<MachineDefaults>("machine", MACHINE_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb };
  const dir = saved.rflSpindleDir;
  return {
    ...fb,
    ...saved,
    toolChangeMode: (saved.toolChangeMode === "m600" ? "m600" : "m6g43") as ToolChangeMode,
    rflSpindleDir: (dir === "off" || dir === "forward" || dir === "reverse" ? dir : fb.rflSpindleDir) as SpindleDir,
    rflSafeZ: typeof (saved as any).rflSafeZ === "boolean" ? (saved as any).rflSafeZ : fb.rflSafeZ,
    spindleFeedbackUnit: (saved.spindleFeedbackUnit === "rpm" ? "rpm" : "rps") as SpindleFeedbackUnit,
    autoDisarmMin: typeof (saved as any).autoDisarmMin === "number" && (saved as any).autoDisarmMin >= 0
      ? (saved as any).autoDisarmMin : fb.autoDisarmMin,
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
  keepAwake: boolean;
}

const DISPLAY_FALLBACK: DisplayDefaults = { theme: "auto", startFullscreen: false, keepAwake: true };

registerSection<DisplayDefaults>("display", DISPLAY_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb };
  const t = saved.theme;
  return {
    ...fb,
    ...saved,
    theme: (VALID_THEMES.has(t) ? t : fb.theme) as ThemeMode,
    keepAwake: typeof saved.keepAwake === "boolean" ? saved.keepAwake : fb.keepAwake,
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
  if (!saved || !Array.isArray(saved.macros)) return { ...fb };
  const macros: MacroDef[] = saved.macros
    .filter((m: any) => m && typeof m.id === "string" && typeof m.name === "string" && typeof m.command === "string")
    .map((m: any) => ({
      id: m.id,
      name: m.name,
      command: m.command,
      params: Array.isArray(m.params) ? m.params : [],
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

// Pure macro-param helpers live in a side-effect-free module so they're
// unit-testable without importing this file's page-lifecycle listeners.
// Re-exported here for back-compat with existing `from "./defaults"` imports.
export { extractParams, syncMacroParams } from "./macroParams";

// ─── Camera section ─────────────────────────────────────────────

export interface CameraDefaults {
  showCrosshair: boolean;
  showCircle: boolean;
  showGrid: boolean;
  circleRadius: number;
  gridSpacing: number;
  overlayOpacity: number;
  overlayColor: string;
  pipX: number;
  pipY: number;
  pipWidth: number;
  pipHeight: number;
  pipVisible: boolean;
}

const CAMERA_FALLBACK: CameraDefaults = {
  showCrosshair: true,
  showCircle: true,
  showGrid: false,
  circleRadius: 50,
  gridSpacing: 50,
  overlayOpacity: 0.8,
  overlayColor: "#00ff00",
  pipX: -1,
  pipY: -1,
  pipWidth: 320,
  pipHeight: 240,
  pipVisible: false,
};

registerSection<CameraDefaults>("camera", CAMERA_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb };
  return { ...fb, ...saved };
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
  jogEnabled: boolean;
  buttonsEnabled: boolean;
  deadZone: number;
  invertX: boolean;
  invertY: boolean;
  invertZ: boolean;
  mapping: GamepadMapping;
  /** Per-controller raw-binding profiles, keyed by gamepad.id. */
  profiles: Record<string, GamepadProfile>;
}

export const GAMEPAD_FALLBACK: GamepadDefaults = {
  jogEnabled: false,
  buttonsEnabled: false,
  deadZone: 0.15,
  invertX: false,
  invertY: false,
  invertZ: false,
  mapping: { ...DEFAULT_MAPPING },
  profiles: {},
};

/** Keep only entries shaped like profiles; binding internals are guarded at
    resolve time (isBindingPressed treats unknown shapes as unpressed). */
function mergeProfiles(saved: any): Record<string, GamepadProfile> {
  if (!saved || typeof saved !== "object") return {};
  const out: Record<string, GamepadProfile> = {};
  for (const [key, p] of Object.entries<any>(saved)) {
    if (p && typeof p === "object"
        && typeof p.id === "string"
        && p.buttons && typeof p.buttons === "object"
        && p.sticks && typeof p.sticks === "object") {
      out[key] = p as GamepadProfile;
    }
  }
  return out;
}

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
  // Migration: old single 'enabled' → both toggles
  const hadOldEnabled = typeof saved.enabled === "boolean" && saved.jogEnabled === undefined;
  const jogEnabled = hadOldEnabled ? saved.enabled : (saved.jogEnabled ?? fb.jogEnabled);
  const buttonsEnabled = hadOldEnabled ? saved.enabled : (saved.buttonsEnabled ?? fb.buttonsEnabled);
  return {
    jogEnabled,
    buttonsEnabled,
    deadZone: typeof saved.deadZone === "number" ? saved.deadZone : fb.deadZone,
    invertX: saved.invertX ?? fb.invertX,
    invertY: saved.invertY ?? fb.invertY,
    invertZ: saved.invertZ ?? fb.invertZ,
    mapping: mergeMapping(saved.mapping, fb.mapping),
    profiles: mergeProfiles(saved.profiles),
  };
});

export function loadGamepadDefaults(): GamepadDefaults {
  return loadSection<GamepadDefaults>("gamepad");
}

export function saveGamepadDefaults(data: GamepadDefaults): void {
  saveSection("gamepad", data);
}

// ── Keyboard shortcuts ──────────────────────────────────────────

// All 9 axes are bindable (WS-D). Axes the machine lacks simply don't get
// a binding row in KeyboardTab; stored bindings for absent axes are inert
// (jogActionToAxis returns null when the letter isn't in viewer_init.axes).
export const KB_AXIS_LETTERS = ["x", "y", "z", "a", "b", "c", "u", "v", "w"] as const;
type KbAxisLetter = (typeof KB_AXIS_LETTERS)[number];

export type KeyboardAction =
  | `jog_${KbAxisLetter}${"+" | "-"}`
  | "estop" | "cycle" | "abort";

function _jogEntries(value: (l: KbAxisLetter, dir: "+" | "-") => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of KB_AXIS_LETTERS) {
    out[`jog_${l}+`] = value(l, "+");
    out[`jog_${l}-`] = value(l, "-");
  }
  return out;
}

export const KEYBOARD_ACTION_LABELS: Record<KeyboardAction, string> = {
  ..._jogEntries((l, d) => `Jog ${l.toUpperCase()}${d}`),
  estop: "E-Stop",
  cycle: "Cycle Start / Pause / Resume",
  abort: "Abort",
} as Record<KeyboardAction, string>;

const ALL_KB_ACTIONS = Object.keys(KEYBOARD_ACTION_LABELS) as KeyboardAction[];

// C/U/V/W ship unbound ("" never matches a KeyboardEvent.key) — the historic
// x/y/z/a/b defaults are preserved for existing users.
export const DEFAULT_KB_MAPPING: Record<KeyboardAction, string> = {
  ..._jogEntries(() => ""),
  "jog_x+": "ArrowRight", "jog_x-": "ArrowLeft",
  "jog_y+": "ArrowUp",    "jog_y-": "ArrowDown",
  "jog_z+": "PageUp",     "jog_z-": "PageDown",
  "jog_a+": "]",           "jog_a-": "[",
  "jog_b+": "'",           "jog_b-": ";",
  estop: "Escape",
  cycle: " ",
  abort: "Backspace",
} as Record<KeyboardAction, string>;

export interface KeyboardDefaults {
  jogEnabled: boolean;
  buttonsEnabled: boolean;
  mapping: Record<KeyboardAction, string>;
}

const KEYBOARD_FALLBACK: KeyboardDefaults = {
  jogEnabled: false,
  buttonsEnabled: true,
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
  // Migration: old 'enabled' → 'buttonsEnabled'
  const hadOldEnabled = typeof saved.enabled === "boolean" && saved.buttonsEnabled === undefined;
  const buttonsEnabled = hadOldEnabled ? saved.enabled : (saved.buttonsEnabled ?? fb.buttonsEnabled);
  return {
    jogEnabled: saved.jogEnabled ?? fb.jogEnabled,
    buttonsEnabled,
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

registerSection<ProbeDefaults>("probe", PROBE_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb };
  return { ...fb, ...saved };
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
  return { ...fb, ...saved };
});

export function loadToolsetterDefaults(): ToolsetterDefaults {
  return loadSection<ToolsetterDefaults>("toolsetter");
}

export function saveToolsetterDefaults(data: ToolsetterDefaults): void {
  saveSection("toolsetter", data);
}

/** Clear all persisted settings so next load returns factory defaults. */
export function resetAllDefaults(): void {
  // Migration artifact: these localStorage keys existed in pre-server-sync
  // versions. Clearing them here ensures old installs don't re-hydrate stale
  // local state after a reset. Safe to remove after ~2027 when no stale
  // browsers are likely to still have these keys.
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("lcnc-toolsetter-params");
  localStorage.removeItem("lcnc-probe-params");
  _cache = null;
  resetServerSettings().catch((e) =>
    console.error("[settings] server reset failed:", e),
  );
}
