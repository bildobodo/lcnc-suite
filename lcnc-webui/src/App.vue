<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, reactive, ref, watch } from "vue";
import { evaluatePermissions, PERMISSIONS_KEY } from "./permissions";
import { connectWs, connected, status, send, armed, lastReply, viewerGcode, viewerInit, lcncError, latency, networkLatency, messages, unreadCount, dismissMessage, clearAllMessages, markMessagesRead, type LcncMessage } from "./lcncWs";
import ThreeViewer from "./ThreeViewer.vue";
import Toolbar from "./Toolbar.vue";
import TabPanel from "./TabPanel.vue";
import GcodePanel from "./GcodePanel.vue";
import SafetyStrip from "./SafetyStrip.vue";
import ControlsStrip from "./ControlsStrip.vue";
import ModeStrip from "./ModeStrip.vue";
import SettingsPanel from "./SettingsPanel.vue";
import ToolTablePanel from "./ToolTablePanel.vue";
import ProbePanel from "./ProbePanel.vue";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import { SlidersHorizontal, MessageSquare, PowerOff, Gamepad2, BookOpen, ClipboardCopy, Expand, Shrink } from "lucide-vue-next";
import GcodeReferenceDialog from "./GcodeReferenceDialog.vue";
import { loadViewerDefaults, saveViewerDefaults, loadMachineDefaults, loadDisplayDefaults, saveDisplayDefaults, loadMacrosDefaults, loadGamepadDefaults, saveGamepadDefaults, loadKeyboardDefaults, saveKeyboardDefaults, settingsVersion, type ThemeMode, type MacroDef, type GamepadDefaults, type KeyboardDefaults, type KeyboardAction, type Layer, type TrackMode, type Projection, type Vec3 } from "./defaults";
import { useGamepad } from "./useGamepad";
import {
  INTERP_IDLE, INTERP_READING, INTERP_PAUSED, INTERP_WAITING,
  TRAJ_MODE_FREE, TRAJ_MODE_TELEOP,
  SPINDLE_FORWARD, SPINDLE_REVERSE,
} from "./lcnc";

const _vd = loadViewerDefaults();
const needsRefresh = ref(false);

// ─── Theme ──────────────────────────────────────────────────────
const themeMode = ref<ThemeMode>(loadDisplayDefaults().theme);
const themeMql = window.matchMedia("(prefers-color-scheme: dark)");

function applyTheme(mode: ThemeMode) {
  if (mode === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", mode);
  }
}

const isDark = computed(() => {
  const m = themeMode.value;
  if (m === "dark" || m === "hc-dark") return true;
  if (m === "light" || m === "hc-light") return false;
  return themeMql.matches;
});

function setTheme(mode: ThemeMode) {
  themeMode.value = mode;
  applyTheme(mode);
  saveDisplayDefaults({ ...loadDisplayDefaults(), theme: mode });
}

// Re-evaluate isDark when OS preference changes in auto mode
function onOsThemeChange() {
  // Trigger Vue reactivity by toggling a dummy ref isn't needed —
  // isDark reads themeMql.matches which is live. But we need to
  // notify watchers, so reassign themeMode to itself.
  if (themeMode.value === "auto") {
    themeMode.value = "auto"; // triggers computed re-eval
  }
}

provide("isDark", isDark);
provide("setTheme", setTheme);
provide("themeMode", themeMode);

applyTheme(themeMode.value);

// ─── Fullscreen ──────────────────────────────────────────────────
const isFullscreen = ref(!!document.fullscreenElement);
let _fsListenersActive = false;

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
}

// Browsers require a user gesture before requestFullscreen().
// Register one-shot listeners that enter fullscreen on first interaction.
function armStartFullscreen() {
  if (_fsListenersActive || document.fullscreenElement) return;
  _fsListenersActive = true;
  const enterFs = () => {
    document.removeEventListener("pointerdown", enterFs);
    document.removeEventListener("keydown", enterFs);
    _fsListenersActive = false;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };
  document.addEventListener("pointerdown", enterFs, { once: true });
  document.addEventListener("keydown", enterFs, { once: true });
}

provide("isFullscreen", isFullscreen);
provide("toggleFullscreen", toggleFullscreen);

// Select-all on focus for number inputs — typing replaces value
function onNumFocus(e: FocusEvent) {
  const t = e.target;
  if (t instanceof HTMLInputElement && t.type === "number") t.select();
}

onMounted(() => {
  connectWs();
  themeMql.addEventListener("change", onOsThemeChange);
  document.addEventListener("focusin", onNumFocus);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  if (loadDisplayDefaults().startFullscreen) armStartFullscreen();
});

watch(lcncError, (newVal, oldVal) => {
  if (oldVal && !newVal) needsRefresh.value = true;
});

type BannerLevel = "none" | "error" | "refresh";
const bannerLevel = computed<BannerLevel>(() => {
  if (!connected.value) return "error";
  if (lcncError.value) return "error";
  if (needsRefresh.value) return "refresh";
  return "none";
});
const bannerText = computed(() => {
  if (!connected.value) return "Gateway disconnected — reconnecting…";
  if (lcncError.value) return `LinuxCNC: ${lcncError.value}`;
  if (needsRefresh.value) return "LinuxCNC reconnected — data may be stale";
  return "";
});

function reloadPage() { location.reload(); }

/** ---------- content tab definitions ---------- */
const contentTabs = [
  { id: "gcode", label: "Program" },
  { id: "probe", label: "Probing" },
];

const activeTab = ref("gcode");

const viewerRef = ref<any>(null);

/** ---------- local UI state ---------- */
const connLabel = computed(() => {
  const h = location.hostname;
  return (h === "localhost" || h === "127.0.0.1") ? "local" : h;
});
// @ts-expect-error TS6133 — mdiText will be wired to MDI panel in strip
const mdiText = ref("G0 X0 Y0");
const busy = ref(false);

// Viewer state (initialized from saved defaults, persisted on every change)
const workpieceSize = ref<[number, number, number]>(_vd.workpieceSize);
const workpieceOffset = ref<[number, number, number]>(_vd.workpieceOffset);
const viewerLayers = reactive<Record<Layer, boolean>>({ ..._vd.layers });
const viewerTrackMode = ref<TrackMode>(_vd.trackingMode);
const viewerPathOnTop = ref(_vd.pathOnTop);
const viewerProjection = ref<Projection>(_vd.projection);

function saveViewerState() {
  const current = loadViewerDefaults();
  saveViewerDefaults({
    ...current,
    layers: { ...viewerLayers },
    workpieceSize: [...workpieceSize.value] as Vec3,
    workpieceOffset: [...workpieceOffset.value] as Vec3,
    trackingMode: viewerTrackMode.value,
    pathOnTop: viewerPathOnTop.value,
    projection: viewerProjection.value,
  });
}

// G-code viewer
const gcodeContent = ref<string | null>(null);
const gcodeStats = ref<import('./GcodePanel.vue').GcodeStats | null>(null);

/** ---------- status helpers ---------- */
const st = computed<Record<string, any>>(() => {
  if (lcncError.value) return {};  // LinuxCNC disconnected — show safe defaults
  return status.value?.data ?? {};
});
const connectedClients = computed<{ip: string, armed: boolean}[]>(() => status.value?.clients ?? []);

// LinuxCNC config name from INI path (e.g. "/home/cnc/.../my-mill/my-mill.ini" → "my-mill")
const configName = computed(() => {
  const ini = st.value.ini_filename;
  if (!ini) return null;
  const parts = ini.replace(/\\/g, "/").split("/");
  // Use parent folder name (the config directory)
  return parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1];
});

const lcncLabel = computed(() => {
  if (lcncError.value) return "LCNC error";
  if (configName.value) return configName.value;
  return "LCNC: -";
});

const isEstop = computed(() => !!st.value.estop);
const isEnabled = computed(() => !!st.value.enabled);



/** DRO: work/machine */
const workPos = computed<number[]>(() => {
  const data = st.value ?? {};
  return Array.isArray(data.work_pos) ? data.work_pos : [];
});

// @ts-ignore TS6133 — kept for future use
const machinePos = computed<number[]>(() => {
  const data = st.value ?? {};
  return Array.isArray(data.machine_pos) ? data.machine_pos : [];
});

// @ts-ignore TS6133 — kept for future use
const dtg = computed<number[]>(() => {
  const data = st.value ?? {};
  return Array.isArray(data.dtg) ? data.dtg : [];
});

const activeFile = computed<string | null>(() => {
  return st.value?.active_file || null;
});

const currentLine = computed<number | null>(() => {
  return st.value?.motion_line ?? null;
});

/** ---------- permissions (arming + machine state) ---------- */
const canEstop = computed(() => !isEstop.value);
const canResetEstop = computed(() => armed.value && isEstop.value);


/** Centralized permissions — single source of truth for all button enable/disable.
 *  Memoized: returns the same object reference when values haven't changed,
 *  so child components using usePermissions() don't re-render on every status update. */
let _prevPerms: ReturnType<typeof evaluatePermissions> | null = null;
const permissions = computed(() => {
  const next = evaluatePermissions({
    armed: armed.value,
    isEstop: isEstop.value,
    isEnabled: isEnabled.value,
    isHomed: isHomed.value,
    isIdle: isIdle.value,
    isRunning: isRunning.value,
    isPaused: isPaused.value,
    busy: busy.value,
    hasFile: !!activeFile.value,
    eoffsetEnabled: !!st.value.eoffset_enabled,
  });
  const keys = Object.keys(next) as (keyof typeof next)[];
  if (_prevPerms && keys.every(k => _prevPerms![k] === next[k])) return _prevPerms;
  _prevPerms = next;
  return next;
});
provide(PERMISSIONS_KEY, permissions);

const isHomed = computed(() => {
  const h = st.value.homed;
  if (Array.isArray(h)) return h.every(Boolean);
  return !!h;
});

const motionMode = computed(() => st.value.motion_mode ?? TRAJ_MODE_FREE);
const isTeleop = computed(() => motionMode.value === TRAJ_MODE_TELEOP);

const interpState = computed(() => st.value.interp_state ?? INTERP_IDLE);
const isPaused = computed(() => st.value.paused ?? interpState.value === INTERP_PAUSED);
const isRunning = computed(() => !isPaused.value && (interpState.value === INTERP_READING || interpState.value === INTERP_WAITING));
const isIdle = computed(() => interpState.value === INTERP_IDLE);

/** ---------- program elapsed timer ---------- */
let _timerStartMs: number | null = null;
let _timerAccMs = 0;
let _timerHandle: ReturnType<typeof setInterval> | null = null;
const programElapsed = ref(0); // seconds

function _startTimer() {
  _timerStartMs = Date.now();
  if (_timerHandle) clearInterval(_timerHandle);
  _timerHandle = setInterval(() => {
    programElapsed.value = Math.floor((_timerAccMs + Date.now() - (_timerStartMs ?? Date.now())) / 1000);
  }, 1000);
}
function _stopTimer() {
  if (_timerHandle) { clearInterval(_timerHandle); _timerHandle = null; }
}

watch([isRunning, isPaused], ([running, paused], [wasRunning, wasPaused]) => {
  if (running && !wasRunning && !wasPaused) {
    // IDLE → RUNNING: reset and start
    _timerAccMs = 0;
    programElapsed.value = 0;
    _startTimer();
  } else if (running && !wasRunning && wasPaused) {
    // PAUSED → RUNNING: resume
    _startTimer();
  } else if (paused && wasRunning) {
    // RUNNING → PAUSED: accumulate and stop
    _timerAccMs += Date.now() - (_timerStartMs ?? Date.now());
    programElapsed.value = Math.floor(_timerAccMs / 1000);
    _stopTimer();
  } else if (!running && !paused) {
    // → IDLE: stop, keep final value
    if (wasRunning && _timerStartMs) {
      _timerAccMs += Date.now() - _timerStartMs;
      programElapsed.value = Math.floor(_timerAccMs / 1000);
    }
    _stopTimer();
  }
});

onUnmounted(() => _stopTimer());

function formatElapsed(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const elapsedDisplay = computed(() => formatElapsed(programElapsed.value));

/** ---------- display helpers for machine states ---------- */
// G5x work coordinate system (G54, G55, etc.)
const g5xLabel = computed(() => {
  const idx = st.value.g5x_index;
  if (idx == null) return "-";
  // LinuxCNC g5x_index is 1-based: 1=G54, 2=G55, 3=G56, 4=G57, 5=G58, 6=G59, 7=G59.1, 8=G59.2, 9=G59.3
  if (idx >= 1 && idx <= 6) return `G${53 + idx}`;
  if (idx === 7) return "G59.1";
  if (idx === 8) return "G59.2";
  if (idx === 9) return "G59.3";
  return `G5x[${idx}]`;
});

// Override values (raw 0.0-2.0 scale) - with NaN handling
const feedOverrideValue = computed(() => {
  const val = st.value.feed_override;
  return (val != null && Number.isFinite(val)) ? val : 1.0;
});
const spindleOverrideValue = computed(() => {
  const val = st.value.spindle_override;
  return (val != null && Number.isFinite(val)) ? val : 1.0;
});
const rapidOverrideValue = computed(() => {
  const val = st.value.rapid_override;
  return (val != null && Number.isFinite(val)) ? val : 1.0;
});
const feedOvrEnabled = computed(() => st.value.feed_override_enabled !== false);
const spindleOvrEnabled = computed(() => st.value.spindle_override_enabled !== false);

const taskMode = computed(() => st.value.task_mode ?? 0);
const activeGcodes = computed(() => {
  const codes = st.value.gcodes;
  if (!codes || !Array.isArray(codes)) return "";
  return codes.filter((c: number) => c !== -1).map((c: number) => `G${(c / 10).toFixed(c % 10 ? 1 : 0)}`).join(" ");
});
const activeMcodes = computed(() => {
  const codes = st.value.mcodes;
  if (!codes || !Array.isArray(codes)) return "";
  return codes.filter((c: number) => c !== -1).map((c: number) => `M${c}`).join(" ");
});

// Tool change dialog (global — tool changes can happen from any context)
const toolChangeRequested = computed(() => !!st.value.tool_change_requested);
const toolChangeTool = computed(() => st.value.tool_change_tool ?? null);
function confirmToolChange() { send({ cmd: "confirm_tool_change" }); }

// Compensation confirmation dialog
const compConfirmPending = ref<boolean | null>(null);
function requestCompToggle(enable: boolean) { compConfirmPending.value = enable; }
function confirmCompToggle() {
  if (compConfirmPending.value !== null) {
    send({ cmd: 'set_compensation', enable: compConfirmPending.value });
    compConfirmPending.value = null;
  }
}
function cancelCompToggle() { compConfirmPending.value = null; }

const feedSlider = ref(100);
const spindleSlider = ref(100);
const rapidSlider = ref(100);

watch(feedOverrideValue, (val) => { if (Number.isFinite(val)) feedSlider.value = Math.round(val * 100); });
watch(spindleOverrideValue, (val) => { if (Number.isFinite(val)) spindleSlider.value = Math.round(val * 100); });
watch(rapidOverrideValue, (val) => { if (Number.isFinite(val)) rapidSlider.value = Math.round(val * 100); });

function onFeedChange() { setFeedOverride(feedSlider.value / 100); }
function onSpindleSliderChange() { setSpindleOverride(spindleSlider.value / 100); }
function onRapidChange() { setRapidOverride(rapidSlider.value / 100); }
function setOverridePreset(type: "feed" | "spindle" | "rapid", percent: number) {
  if (type === "feed") { feedSlider.value = percent; onFeedChange(); }
  else if (type === "spindle") { spindleSlider.value = percent; onSpindleSliderChange(); }
  else { rapidSlider.value = percent; onRapidChange(); }
}
function resetAllOverrides() {
  feedSlider.value = 100; onFeedChange();
  spindleSlider.value = 100; onSpindleSliderChange();
  rapidSlider.value = 100; onRapidChange();
}

// Machine native unit (from INI [TRAJ]LINEAR_UNITS — static, not affected by G20/G21)
const linearUnit = computed(() => st.value.linear_units ?? "mm");

// Max jog velocity from INI [DISPLAY]MAX_LINEAR_VELOCITY (u/s)
const maxJogVel = computed(() => {
  const v = st.value.max_jog_velocity ?? st.value.max_velocity;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 50;
});

// INI config: jog
const defaultJogVel = computed(() => {
  const v = st.value.default_jog_velocity;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 10;
});
const minJogVel = computed(() => {
  const v = st.value.min_jog_velocity;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 0.1;
});
// Angular (rotary) jog velocity from INI [DISPLAY]
const maxAngularJogVel = computed(() => {
  const v = st.value.max_angular_jog_velocity;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 60; // 60 deg/s default
});
const defaultAngularJogVel = computed(() => {
  const v = st.value.default_angular_jog_velocity;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 10;
});
const minAngularJogVel = computed(() => {
  const v = st.value.min_angular_jog_velocity;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 0.1;
});

const iniIncrements = computed<number[] | null>(() => {
  const v = st.value.increments;
  return Array.isArray(v) && v.length > 0 ? v : null;
});

// INI config: spindle
const defaultSpindleSpeed = computed(() => {
  const v = st.value.default_spindle_speed;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 1000;
});
const minSpindleSpeed = computed(() => {
  const v = st.value.min_spindle_speed;
  return (v != null && Number.isFinite(v) && v >= 0) ? v : 0;
});
const maxSpindleSpeed = computed(() => {
  const v = st.value.max_spindle_speed;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 99999;
});

// INI config: overrides (INI 0-1 fractions → percentage integers)
const minSpindleOverride = computed(() => {
  const v = st.value.min_spindle_override;
  return (v != null && Number.isFinite(v)) ? Math.round(v * 100) : 50;
});
const maxSpindleOverride = computed(() => {
  const v = st.value.max_spindle_override;
  return (v != null && Number.isFinite(v)) ? Math.round(v * 100) : 200;
});
const maxFeedOverride = computed(() => {
  const v = st.value.max_feed_override;
  return (v != null && Number.isFinite(v)) ? Math.round(v * 100) : 200;
});

// Spindle state
const spindleSpeed = computed(() => st.value.spindle_speed ?? null);
const spindleActual = computed(() => st.value.spindle_speed_actual ?? null);
const spindleLoad = computed(() => st.value.spindle_load ?? null);
const spindleDirection = computed(() => st.value.spindle_direction ?? null);

// Spindle popover state
const rpmInput = ref(1000);
const isForward = computed(() => spindleDirection.value === SPINDLE_FORWARD);
const isReverse = computed(() => spindleDirection.value === SPINDLE_REVERSE);
const isSpinning = computed(() => isForward.value || isReverse.value);

// Coolant state
const floodOn = computed(() => !!st.value.flood);
const mistOn = computed(() => !!st.value.mist);
function toggleFlood() {
  fire({ cmd: floodOn.value ? "flood_off" : "flood_on" });
}
function toggleMist() {
  fire({ cmd: mistOn.value ? "mist_off" : "mist_on" });
}

// Program switches
const optionalStopOn = computed(() => !!st.value.optional_stop);
const blockDeleteOn = computed(() => !!st.value.block_delete);

function toggleOptionalStop() {
  send({ cmd: "set_optional_stop", value: !optionalStopOn.value });
}
function toggleBlockDelete() {
  send({ cmd: "set_block_delete", value: !blockDeleteOn.value });
}

// Dialog state
const settingsDialogOpen = ref(false);
const gcodeRefOpen = ref(false);
const gcodeRefInitialSearch = ref("");
const messagesDialogOpen = ref(false);
const toolTableDialogOpen = ref(false);

function closeAllDialogs() {
  settingsDialogOpen.value = false;
  gcodeRefOpen.value = false;
  messagesDialogOpen.value = false;
}

function openDialog(name: "settings" | "gcodeRef" | "messages") {
  const isOpen = (name === "settings" && settingsDialogOpen.value)
    || (name === "gcodeRef" && gcodeRefOpen.value)
    || (name === "messages" && messagesDialogOpen.value);
  closeAllDialogs();
  if (!isOpen) {
    if (name === "settings") settingsDialogOpen.value = true;
    else if (name === "gcodeRef") gcodeRefOpen.value = true;
    else if (name === "messages") { messagesDialogOpen.value = true; markMessagesRead(); }
  }
}

function openGcodeRef(code?: string) {
  gcodeRefInitialSearch.value = code ?? "";
  openDialog("gcodeRef");
}
const showShutdownConfirm = ref(false);

// Macro state
const userMacros = ref<MacroDef[]>(loadMacrosDefaults().macros);
const macroParamDialog = ref<{ macro: MacroDef; values: Record<string, string> } | null>(null);

provide("updateMacros", (macros: MacroDef[]) => { userMacros.value = macros; });

function executeMacro(m: MacroDef) {
  if (m.params.length === 0) {
    fire({ cmd: "mdi", text: m.command });
  } else {
    const values: Record<string, string> = {};
    for (const p of m.params) values[p.name] = p.default;
    macroParamDialog.value = { macro: m, values };
  }
}

function substituteMacro(command: string, values: Record<string, string>): string {
  let cmd = command;
  for (const [key, val] of Object.entries(values)) cmd = cmd.split(`{${key}}`).join(val);
  return cmd;
}

function confirmMacroParams() {
  if (!macroParamDialog.value) return;
  fire({ cmd: "mdi", text: substituteMacro(macroParamDialog.value.macro.command, macroParamDialog.value.values) });
  macroParamDialog.value = null;
}

function macroPreview(): string {
  if (!macroParamDialog.value) return "";
  return substituteMacro(macroParamDialog.value.macro.command, macroParamDialog.value.values);
}
// @ts-ignore TS6133 — kept for future use
const toolTableRef = ref<InstanceType<typeof ToolTablePanel> | null>(null);
const toolNumber = ref(1);
const TS_TOOL_KEY = "lcnc-tool-number";

function loadToolNumber() {
  try {
    const raw = localStorage.getItem(TS_TOOL_KEY);
    if (raw) { toolNumber.value = parseInt(raw, 10) || 1; }
  } catch { /* ignore */ }
}
loadToolNumber();

function saveToolNumber() {
  localStorage.setItem(TS_TOOL_KEY, String(toolNumber.value));
}

function measureAuto() {
  if (!permissions.value.ready || st.value.probing) return;
  saveToolNumber();
  fire({ cmd: "mdi", text: `T${toolNumber.value} M600` });
}

function loadTool() {
  if (!permissions.value.ready || st.value.probing) return;
  saveToolNumber();
  const n = toolNumber.value;
  const mode = loadMachineDefaults().toolChangeMode;
  if (mode === "m600") {
    fire({ cmd: "mdi", text: `T${n} M600` });
  } else {
    fire({ cmd: "mdi", text: `T${n} M6 G43 H${n}` });
  }
}

function unloadTool() {
  if (!permissions.value.ready) return;
  const mode = loadMachineDefaults().toolChangeMode;
  if (mode === "m600") {
    fire({ cmd: "mdi", text: "T0 M600" });
  } else {
    fire({ cmd: "mdi", text: "T0 M6 G49" });
  }
}

// Message popover helpers
function msgKindClass(kind: number): string {
  if (kind <= 2) return "error";
  if (kind <= 4) return "info";
  return "display";
}
function msgKindLabel(kind: number): string {
  if (kind <= 2) return "ERROR";
  if (kind <= 4) return "INFO";
  return "DISPLAY";
}
function msgFormatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString();
}

function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

function copyMessage(msg: LcncMessage) {
  copyToClipboard(`[${msgKindLabel(msg.kind)}] ${msgFormatTime(msg.ts)} — ${msg.text}`);
}

function copyAllMessages() {
  const text = [...messages.value].reverse().map(m =>
    `[${msgKindLabel(m.kind)}] ${msgFormatTime(m.ts)} — ${m.text}`
  ).join("\n");
  copyToClipboard(text);
}

/** ---------- actions ---------- */
function arm(v: boolean) {
  send({ cmd: "arm", armed: v });
  // armed.value updates when the gateway reply arrives (server-authoritative)
}

/** ---------- local UI jog ---------- */
const jogVel = ref(10);
const angularJogVel = ref(10); // deg/s for rotary axes
const jogIncrement = ref(0); // 0 = continuous, >0 = increment distance in machine units
const AXIS_LETTERS = "XYZABCUVW";

// Axis list from viewer_init (gateway derives from axis_mask), fallback to XYZ
const axes = computed<string[]>(() => {
  const vi = viewerInit.value;
  if (vi?.axes && Array.isArray(vi.axes)) return vi.axes;
  // Fallback: derive from axis_mask in status
  const mask = st.value?.axis_mask ?? 7;
  return [...AXIS_LETTERS].filter((_, i) => mask & (1 << i));
});

// Machine STL parts list (for dynamic color pickers in Settings)
const machineParts = computed<Array<{ id: string; group: string | null; direction: string | null }>>(() => {
  const vi = viewerInit.value;
  if (!vi?.parts) return [];
  // Build group → direction map from kinematics
  const groupDir: Record<string, string> = {};
  const kin = vi.kinematics;
  if (Array.isArray(kin)) {
    for (const k of kin) if (k.direction) groupDir[k.group] = k.direction;
  } else if (kin && typeof kin === "object") {
    for (const key of Object.keys(kin)) groupDir[key] = key;
  }
  return (vi.parts as any[]).map((p: any) => {
    const grp = (p.group ?? p.parent ?? null) as string | null;
    return { id: p.id as string, group: grp, direction: grp ? (groupDir[grp] ?? null) : null };
  });
});

function setMachinePartColor(partId: string, color: string | null) {
  viewerRef.value?.setMachinePartColor?.(partId, color);
}

function setMachineEdges(on: boolean) {
  viewerRef.value?.setMachineEdges?.(on);
}

function setToolColors(toolColor: string | null, cutterColor: string | null) {
  viewerRef.value?.setToolColors?.(toolColor, cutterColor);
}

provide("machineParts", machineParts);
provide("setMachinePartColor", setMachinePartColor);
provide("setMachineEdges", setMachineEdges);
provide("setToolColors", setToolColors);

// Broadcast viewer settings to all ThreeViewer instances
function setPathOnTop(on: boolean) {
  viewerRef.value?.setPathAlwaysOnTop?.(on);
}
function setProjection(proj: "perspective" | "parallel") {
  const wantOrtho = proj === "parallel";
  const v = viewerRef.value;
  if (v?.isOrtho?.value !== wantOrtho) v?.switchProjection?.();
}

const runFromLineEnabled = ref(loadMachineDefaults().runFromLine);

const touchoff = ref<number[]>([0, 0, 0]);

// Resize touchoff when axes change (e.g. 3→5 axes on reconnect)
watch(axes, (a) => {
  if (touchoff.value.length !== a.length) {
    const copy = [...touchoff.value];
    copy.length = a.length;
    for (let i = 0; i < a.length; i++) if (copy[i] == null) copy[i] = 0;
    touchoff.value = copy;
  }
});

// Initialize defaults from INI (once, when first non-fallback value arrives)
let _jogVelInit = false;
watch(defaultJogVel, (v) => { if (!_jogVelInit && v !== 10) { jogVel.value = v; _jogVelInit = true; } });
let _angJogVelInit = false;
watch(defaultAngularJogVel, (v) => { if (!_angJogVelInit && v !== 10) { angularJogVel.value = v; _angJogVelInit = true; } });
let _rpmInit = false;
watch(defaultSpindleSpeed, (v) => { if (!_rpmInit && v !== 1000) { rpmInput.value = v; _rpmInit = true; } });

/**
 * Simple anti-spam gate so you don't double-send on fast clicks.
 */
async function fire(payload: any, cooldownMs = 200) {
  if (busy.value) return;
  busy.value = true;
  try {
    send(payload);
  } finally {
    window.setTimeout(() => (busy.value = false), cooldownMs);
  }
}

function setAxis(axis: number, value: number = 0) {
  const axisName = AXIS_LETTERS[axis];
  if (!axisName) return;

  // For Z: subtract current eoffset so G5x doesn't absorb it
  let val = value;
  if (axis === 2 && st.value.eoffset_z) val += st.value.eoffset_z;
  fire({ cmd: "mdi", text: `G10 L20 P0 ${axisName}${val}` });
}

function setAll(values: number[] = []) {
  const eoffsetZ = st.value.eoffset_z ?? 0;
  const parts = axes.value.map((letter, i) => {
    let val = values[i] ?? 0;
    if (letter === "Z") val += eoffsetZ;
    return `${letter}${val}`;
  });
  fire({ cmd: "mdi", text: `G10 L20 P0 ${parts.join(" ")}` });
}

function setG5x(gcode: string) {
  fire({ cmd: "mdi", text: gcode });
}

function homeAll() {
  fire({ cmd: "home_all" });
}

function unhomeAll() {
  fire({ cmd: "unhome_all" });
}

const homedJoints = computed<boolean[]>(() => {
  const hj = st.value.homed_joints;
  return Array.isArray(hj) ? hj.map(Boolean) : [];
});

// @ts-ignore TS6133 — kept for future use
function homeAxis(joint: number) {
  fire({ cmd: "home", joint });
}

// @ts-ignore TS6133 — kept for future use
function unhomeAxis(joint: number) {
  fire({ cmd: "unhome", joint });
}



function cycleStart() {
  fire({ cmd: "cycle_start" });
}

function runFromLine(line: number, spindleDir: "off" | "forward" | "reverse", spindleSpeed: number) {
  fire({
    cmd: "auto_run",
    line,
    spindle_dir: spindleDir !== "off" ? spindleDir : undefined,
    spindle_speed: spindleDir !== "off" ? spindleSpeed : undefined,
  });
}

function cycleStep() {
  fire({ cmd: "auto_step" });
}

function cyclePause() {
  fire({ cmd: "cycle_pause" });
}

function cycleResume() {
  fire({ cmd: "cycle_resume" });
}

function setFeedOverride(scale: number) {
  send({ cmd: "set_feed_override", scale });
}

function setSpindleOverride(scale: number) {
  send({ cmd: "set_spindle_override", scale });
}

function setRapidOverride(scale: number) {
  send({ cmd: "set_rapid_override", scale });
}

function spindleForward(speed: number) {
  fire({ cmd: "spindle_forward", speed });
}

function spindleReverse(speed: number) {
  fire({ cmd: "spindle_reverse", speed });
}

function spindleStop() {
  fire({ cmd: "spindle_stop" });
}

function loadFile(path: string) {
  fire({ cmd: "load_file", path });
}

function unloadFile() {
  fire({ cmd: "unload_file" });
}

/** ---------- keyboard shortcuts ---------- */
const keyboardConfig = ref<KeyboardDefaults>(loadKeyboardDefaults());

const reverseKeyMap = computed(() => {
  const map = new Map<string, KeyboardAction>();
  for (const [action, key] of Object.entries(keyboardConfig.value.mapping)) {
    if (key) map.set(key, action as KeyboardAction);
  }
  return map;
});

const jogActions = reactive(new Set<string>());

const ANGULAR_LETTERS = new Set(["A", "B", "C"]);

function jogActionToAxis(action: string): { axis: number; dir: 1 | -1; isAngular: boolean } | null {
  const match = action.match(/^jog_([a-z])([+-])$/);
  if (!match) return null;
  const letter = match[1]!.toUpperCase();
  const dir = match[2] === "+" ? 1 : -1;
  const idx = axes.value.indexOf(letter);
  if (idx < 0) return null;
  return { axis: idx, dir, isAngular: ANGULAR_LETTERS.has(letter) };
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!(el as HTMLElement).isContentEditable;
}

function onKeyDown(e: KeyboardEvent) {
  const action = reverseKeyMap.value.get(e.key);
  if (!action) return;

  // E-Stop always fires — bypasses master toggle and input focus
  if (action === "estop") {
    e.preventDefault();
    if (canEstop.value) send({ cmd: "estop" });
    else if (canResetEstop.value) send({ cmd: "estop_reset" });
    return;
  }

  if (!keyboardConfig.value.enabled) return;
  if (isInputFocused()) return;

  // Jog actions
  if (action.startsWith("jog_")) {
    if (!keyboardConfig.value.jogEnabled) return;
    e.preventDefault();
    if (e.repeat || jogActions.has(action)) return;
    if (!permissions.value.jog) return;
    const jog = jogActionToAxis(action);
    if (!jog) return;
    jogActions.add(action);
    const vel = (jog.isAngular ? angularJogVel.value : jogVel.value) * jog.dir;
    if (jogIncrement.value > 0) {
      send({ cmd: "jog_incr", axis: jog.axis, vel, distance: jogIncrement.value * jog.dir });
    } else {
      send({ cmd: "jog_cont", axis: jog.axis, vel });
    }
    return;
  }

  // Cycle start / pause / resume
  if (action === "cycle") {
    e.preventDefault();
    if (permissions.value.resume) fire({ cmd: "cycle_resume" });
    else if (permissions.value.pause) fire({ cmd: "cycle_pause" });
    else if (permissions.value.ready && !!activeFile.value) fire({ cmd: "cycle_start" });
    return;
  }

  // Abort
  if (action === "abort") {
    e.preventDefault();
    if (permissions.value.abort) fire({ cmd: "abort" });
    return;
  }
}

function onKeyUp(e: KeyboardEvent) {
  const action = reverseKeyMap.value.get(e.key);
  if (!action || !action.startsWith("jog_")) return;
  if (jogActions.has(action)) {
    jogActions.delete(action);
    if (jogIncrement.value <= 0) {
      const jog = jogActionToAxis(action);
      if (jog) send({ cmd: "jog_stop", axis: jog.axis });
    }
  }
}

/** ---------- gamepad jogging ---------- */
const gamepadConfig = ref<GamepadDefaults>(loadGamepadDefaults());
const gamepadGated = computed(() => settingsDialogOpen.value);
const gamepad = useGamepad({
  jogVel,
  angularJogVel,
  jogIncrement,
  permissions,
  send,
  fire,
  activeFile: computed(() => activeFile.value),
  config: gamepadConfig,
  axisCount: computed(() => axes.value.length),
  gated: gamepadGated,
});

function setGamepadConfig(cfg: GamepadDefaults) {
  gamepadConfig.value = cfg;
  saveGamepadDefaults(cfg);
}

function setKeyboardConfig(cfg: KeyboardDefaults) {
  keyboardConfig.value = cfg;
  saveKeyboardDefaults(cfg);
}

watch(() => [keyboardConfig.value.enabled, keyboardConfig.value.jogEnabled], (curr, prev) => {
  if (!prev) return;
  const [enabled, jogEnabled] = curr;
  const [prevEnabled, prevJogEnabled] = prev;
  if ((!enabled && prevEnabled) || (!jogEnabled && prevJogEnabled)) {
    stopAllJog();
  }
});

provide("gamepadAxes", gamepad.gamepadAxesState);
provide("gamepadButtons", gamepad.gamepadButtonsState);

// Re-read server-synced settings when another client saves
watch(settingsVersion, () => {
  userMacros.value = loadMacrosDefaults().macros;
  const mach = loadMachineDefaults();
  runFromLineEnabled.value = mach.runFromLine;
  keyboardConfig.value = loadKeyboardDefaults();
  gamepadConfig.value = loadGamepadDefaults();
  const disp = loadDisplayDefaults();
  if (disp.theme !== themeMode.value) {
    themeMode.value = disp.theme;
    applyTheme(disp.theme);
  }
  if (disp.startFullscreen) armStartFullscreen();
  const vd = loadViewerDefaults();
  workpieceSize.value = vd.workpieceSize;
  workpieceOffset.value = vd.workpieceOffset;
  Object.assign(viewerLayers, vd.layers);
  viewerTrackMode.value = vd.trackingMode;
  viewerPathOnTop.value = vd.pathOnTop;
  viewerProjection.value = vd.projection;
});

/** ---------- safety: stop jog on focus loss ---------- */
function stopAllJog() {
  jogActions.clear();
  gamepad.stopAllJog();
  if (!permissions.value.jog) return; // no jog possible unless armed + enabled + homed
  if (isRunning.value || isPaused.value) return; // no jog during program execution
  for (let i = 0; i < axes.value.length; i++) {
    send({ cmd: "jog_stop", axis: i });
  }
}

function visHandler() {
  if (document.hidden) stopAllJog();
}

onMounted(() => {
  window.addEventListener("blur", stopAllJog);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  document.addEventListener("visibilitychange", visHandler);
  gamepad.start();
});

onUnmounted(() => {
  window.removeEventListener("blur", stopAllJog);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  document.removeEventListener("visibilitychange", visHandler);
  document.removeEventListener("focusin", onNumFocus);
  themeMql.removeEventListener("change", onOsThemeChange);
  gamepad.stop();
});

/** ---------- Probe results from DEBUG EVAL messages ---------- */
const probeResults = ref<Record<string, number> | null>(null);

watch(status, (st) => {
  if (st?.probe_results && typeof st.probe_results === "object") {
    probeResults.value = st.probe_results;
  }
});

/** ---------- Surface map probe results ---------- */
const surfacePoints = ref<[number, number, number][] | null>(null);
const surfaceLoadedToViewer = ref(false);

function requestProbeResults() {
  send({ cmd: "get_probe_results" });
}

function loadSurfaceToViewer() {
  surfaceLoadedToViewer.value = true;
  requestProbeResults();
}

// Listen for get_probe_results reply
watch(lastReply, (r: any) => {
  if (r?.ok && r.points) surfacePoints.value = r.points;
}, { flush: "sync" });

/** ---------- G-code content watcher ---------- */
watch(viewerGcode, (newGcode) => {
  // content is omitted on rotation-only re-parses (toolpath update without file change)
  if ("content" in (newGcode ?? {})) {
    gcodeContent.value = newGcode?.content ?? null;
  }
  gcodeStats.value = newGcode?.stats ?? null;
});


</script>

<template>
  <div class="wrap">
    <!-- ══ Header ══ -->
    <header class="hdr">
      <div class="title">LinuxCNC WebUI ({{ connLabel }})</div>
      <div class="hdrRight">
        <div class="pill" :title="connectedClients.map(c => c.ip + (c.armed ? ' (armed)' : '')).join('\n')">
          {{ connectedClients.length }} client{{ connectedClients.length !== 1 ? 's' : '' }}
        </div>
        <div class="pill" :class="connected ? 'ok' : 'bad'">
          {{ connected ? "WS connected" : "WS disconnected" }}
        </div>
        <div v-if="connected && networkLatency != null" class="pill" title="Network latency">Net {{ networkLatency }}ms</div>
        <div v-if="connected && latency != null" class="pill" title="Round-trip latency">Ping {{ latency }}ms</div>
        <div class="pill" :class="lcncError ? 'bad' : (configName ? 'ok' : '')">{{ lcncLabel }}</div>
        <div class="pill" :class="armed ? 'armed' : 'disarmed'">{{ armed ? "ARMED" : "DISARMED" }}</div>
        <div v-if="gamepad.gamepadConnected.value" class="pill ok" :title="gamepad.gamepadName.value"><Gamepad2 :size="14" /></div>

        <MachineBtn type="headerIcon" :warning="unreadCount > 0" :title="'Messages (' + unreadCount + ')'" @click="openDialog('messages')">
          <MessageSquare :size="16" />
        </MachineBtn>
        <MachineBtn type="headerIcon" title="G-code Reference" @click="openGcodeRef()">
          <BookOpen :size="16" />
        </MachineBtn>
        <MachineBtn type="headerIcon" title="Settings" @click="openDialog('settings')">
          <SlidersHorizontal :size="16" />
        </MachineBtn>
        <MachineBtn type="headerIcon" :title="isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'" @click="toggleFullscreen">
          <Shrink v-if="isFullscreen" :size="16" />
          <Expand v-else :size="16" />
        </MachineBtn>
        <MachineBtn type="headerIcon" class="hdrShutdown" title="Shut Down LinuxCNC" @click="showShutdownConfirm = true">
          <PowerOff :size="16" />
        </MachineBtn>
      </div>
    </header>

    <div v-if="bannerLevel !== 'none'">
      <div class="statusBanner" :class="bannerLevel">
        {{ bannerText }}
        <MachineBtn v-if="bannerLevel === 'refresh'" type="bannerAction" @click="reloadPage">Refresh</MachineBtn>
      </div>
    </div>

    <!-- ══ Content area — outer Gate wraps tabs ══ -->
    <Gate gate="safety" class="content">
      <!-- ══ Left pane — 3D Viewer (always visible) ══ -->
      <div class="viewerPane">
        <Toolbar
          @resetBackplot="viewerRef?.resetBackplot?.()"
          @setView="(p: any) => viewerRef?.setView?.(p)"
          @toggleLayer="(l: Layer, on: boolean) => { viewerLayers[l] = on; viewerRef?.setLayerVisible?.(l, on); saveViewerState(); }"
          @setPathOnTop="(on: boolean) => { viewerPathOnTop = on; viewerRef?.setPathAlwaysOnTop?.(on); saveViewerState(); }"
          @setTrackMode="(m: string) => { viewerTrackMode = m as TrackMode; viewerRef?.setTrackingMode?.(m); saveViewerState(); }"
          @toggleProjection="() => { viewerProjection = viewerProjection === 'parallel' ? 'perspective' : 'parallel'; viewerRef?.switchProjection?.(); saveViewerState(); }"
          :workpieceSize="workpieceSize"
          :workpieceOffset="workpieceOffset"
          @update:workpieceSize="workpieceSize = $event; saveViewerState()"
          @update:workpieceOffset="workpieceOffset = $event; saveViewerState()"
        >
          <ThreeViewer
            ref="viewerRef"
            :active="true"
            :workpieceSize="workpieceSize"
            :workpieceOffset="workpieceOffset"
            :g5xLabel="g5xLabel"
            :linearUnit="linearUnit"
            :activeFile="activeFile"
            :spindleSpeed="spindleSpeed"
            :spindleActual="spindleActual"
            :spindleDirection="spindleDirection"
            :surfacePoints="surfaceLoadedToViewer ? surfacePoints : null"
            :axes="axes"
          />
        </Toolbar>
      </div>

      <!-- ══ Right pane — Program / Probing tabs ══ -->
      <div class="sidePane bordered-panel">
        <TabPanel :tabs="contentTabs" :modelValue="activeTab" @update:modelValue="activeTab = $event">
          <template #gcode>
            <GcodePanel
              :activeFile="activeFile"
              :gcodeContent="gcodeContent"
              :gcodeStats="gcodeStats"
              :currentLine="currentLine"
              :isPaused="isPaused"
              :elapsed="elapsedDisplay"
              :optionalStop="optionalStopOn"
              :blockDelete="blockDeleteOn"
              :runFromLine="runFromLineEnabled"
              @loadFile="loadFile"
              @unloadFile="unloadFile"
              @cycleStart="cycleStart"
              @runFromLine="runFromLine"
              @cycleStep="cycleStep"
              @cyclePause="cyclePause"
              @cycleResume="cycleResume"
              @abort="fire({ cmd: 'abort' })"
              @toggleOptionalStop="toggleOptionalStop"
              @toggleBlockDelete="toggleBlockDelete"
              @openGcodeRef="openGcodeRef"
            />
          </template>

          <template #probe>
            <ProbePanel
              :probing="st.probing === true"
              :probeTripped="st.probe_tripped === true"
              :probedPosition="st.probed_position ?? null"
              :workPos="workPos"
              :probeResults="probeResults"
              :g5xLabel="g5xLabel"
              :eoffsetZ="st.eoffset_z ?? null"
              :eoffsetEnabled="!!st.eoffset_enabled"
              :compMethod="st.comp_method ?? null"
              :surfacePoints="surfacePoints"
              :surfaceInViewer="surfaceLoadedToViewer"
              @mdi="send({ cmd: 'mdi', text: $event })"
              @abort="send({ cmd: 'abort' })"
              @setProbeVars="send({ cmd: 'set_probe_vars', vars: $event })"
              @setG5x="setG5x"
              @getProbeResults="requestProbeResults"
              @loadSurfaceToViewer="loadSurfaceToViewer"
              @setCompensation="requestCompToggle"
              @setCompMethod="send({ cmd: 'set_compensation_method', method: $event })"
              @clearSurfaceMap="surfacePoints = null; surfaceLoadedToViewer = false"
            />
          </template>
        </TabPanel>
      </div>

      <!-- Dialogs — inside content area so strip stays accessible beneath -->

      <!-- Tool table dialog -->
      <div v-if="toolTableDialogOpen" class="dialogOverlay">
        <div class="dialog lg dialog-full">
          <div class="dialogHeader">
            <span class="dialogTitle">Tool Table</span>
            <MachineBtn type="close" @click="toolTableDialogOpen = false">&times;</MachineBtn>
          </div>
          <div class="toolTableDialogBody">
            <ToolTablePanel ref="toolTableRef" :currentTool="st.tool_number ?? null" :iniFilename="st.ini_filename ?? null" />
          </div>
        </div>
      </div>

      <!-- Settings dialog -->
      <div v-if="settingsDialogOpen" class="dialogOverlay">
        <div class="dialog lg dialog-full">
          <div class="dialogHeader">
            <span class="dialogTitle">Settings</span>
            <MachineBtn type="close" @click="settingsDialogOpen = false">&times;</MachineBtn>
          </div>
          <div class="settingsDialogBody">
            <SettingsPanel
              :gamepadConnected="gamepad.gamepadConnected.value"
              :gamepadName="gamepad.gamepadName.value"
              :gamepadConfig="gamepadConfig"
              @setProbeVars="send({ cmd: 'set_probe_vars', vars: $event })"
              @mdi="send({ cmd: 'mdi', text: $event })"
              @setPathOnTop="setPathOnTop"
              @setProjection="setProjection"
              :keyboardConfig="keyboardConfig"
              @setKeyboardConfig="setKeyboardConfig"
              @setRunFromLine="runFromLineEnabled = $event"
              @setGamepadConfig="setGamepadConfig" />
          </div>
        </div>
      </div>

      <!-- G-code reference dialog -->
      <GcodeReferenceDialog :open="gcodeRefOpen" :initialSearch="gcodeRefInitialSearch" @close="gcodeRefOpen = false" />

      <!-- Messages dialog -->
      <div v-if="messagesDialogOpen" class="dialogOverlay" @click.self="messagesDialogOpen = false">
        <div class="dialog lg">
          <div class="dialogHeader">
            <span class="dialogTitle">Messages ({{ messages.length }})</span>
            <div class="row-tight">
              <MachineBtn type="inline" @click="copyAllMessages" :disabled="messages.length === 0">Copy All</MachineBtn>
              <MachineBtn type="inline" @click="clearAllMessages" :disabled="messages.length === 0">Clear All</MachineBtn>
              <MachineBtn type="close" @click="messagesDialogOpen = false; markMessagesRead()">&times;</MachineBtn>
            </div>
          </div>
          <div class="messagesBody scroll-thin">
            <div v-for="msg in messages" :key="msg.id" class="msgItem" :class="msgKindClass(msg.kind)">
              <span class="msgTime">{{ msgFormatTime(msg.ts) }}</span>
              <span class="msgKind">{{ msgKindLabel(msg.kind) }}</span>
              <span class="msgText">{{ msg.text }}</span>
              <MachineBtn type="listAction" @click="copyMessage(msg)" title="Copy"><ClipboardCopy :size="12" /></MachineBtn>
              <MachineBtn type="listAction" @click="dismissMessage(msg.id)" title="Dismiss">&times;</MachineBtn>
            </div>
            <div v-if="messages.length === 0" class="msgEmpty">No messages</div>
          </div>
        </div>
      </div>

      <!-- Safety confirmation dialogs — z-index 1010 to always appear above other dialogs -->
      <div v-if="toolChangeRequested" class="dialogOverlay safetyDialog">
        <div class="dialog">
          <div class="dialogTitle">{{ !toolChangeTool ? 'Remove Tool from Spindle' : 'Load Tool into Spindle' }}</div>
          <div class="dialogBody">
            <template v-if="toolChangeTool">
              <strong>T{{ toolChangeTool }}</strong><template v-if="st.tool_change_info"> D{{ st.tool_change_info.D.toFixed(3) }} Z{{ st.tool_change_info.Z.toFixed(3) }}</template><br>
              <template v-if="st.tool_change_info?.description">{{ st.tool_change_info.description }}<br></template>
              Insert tool and press Confirm
            </template>
            <template v-else>
              Remove tool and press Confirm
            </template>
          </div>
          <Gate gate="abort" class="dialogActions">
            <MachineBtn type="dialogDanger" @click="send({ cmd: 'abort' })">Cancel</MachineBtn>
            <MachineBtn type="dialogConfirm" @click="confirmToolChange">Confirm</MachineBtn>
          </Gate>
        </div>
      </div>

      <div v-if="macroParamDialog" class="dialogOverlay" @click.self="macroParamDialog = null">
        <div class="dialog">
          <div class="dialogTitle">{{ macroParamDialog.macro.name }}</div>
          <div class="dialogBody">
            <div class="macroParamFields">
              <div v-for="p in macroParamDialog.macro.params" :key="p.name" class="macroParamRow">
                <label class="macroParamLabel">{{ p.label || p.name }}</label>
                <input
                  type="text"
                  v-model="macroParamDialog.values[p.name]"
                  @keydown.enter="confirmMacroParams"
                />
              </div>
            </div>
            <code class="macroPreview">{{ macroPreview() }}</code>
          </div>
          <Gate gate="ready" class="dialogActions">
            <MachineBtn type="dialogCancel" @click="macroParamDialog = null">Cancel</MachineBtn>
            <MachineBtn type="dialogConfirm" @click="confirmMacroParams">Execute</MachineBtn>
          </Gate>
        </div>
      </div>

      <div v-if="showShutdownConfirm" class="dialogOverlay safetyDialog">
        <div class="dialog">
          <div class="dialogTitle danger">Shut Down LinuxCNC?</div>
          <div class="dialogBody">This will stop all motion and exit LinuxCNC.</div>
          <Gate gate="abort" class="dialogActions">
            <MachineBtn type="dialogCancel" @click="showShutdownConfirm = false">Cancel</MachineBtn>
            <MachineBtn type="dialogDanger" @click="send({ cmd: 'shutdown' }); showShutdownConfirm = false">Shut Down</MachineBtn>
          </Gate>
        </div>
      </div>

      <div v-if="compConfirmPending !== null" class="dialogOverlay safetyDialog">
        <div class="dialog">
          <div class="dialogTitle">{{ compConfirmPending ? 'Enable' : 'Disable' }} Compensation</div>
          <div class="dialogBody">
            <template v-if="compConfirmPending">
              Z axis will move based on the surface compensation map.<br>
              Ensure tool is clear of the workpiece.
            </template>
            <template v-else>
              Z axis will move by approximately
              <strong>{{ ((st.eoffset_z ?? 0) * -1).toFixed(4) }}</strong> mm.<br>
              Ensure tool is clear of the workpiece.
            </template>
          </div>
          <Gate gate="ready" class="dialogActions">
            <MachineBtn type="dialogDanger" @click="cancelCompToggle">Cancel</MachineBtn>
            <MachineBtn type="dialogConfirm" @click="confirmCompToggle">Confirm</MachineBtn>
          </Gate>
        </div>
      </div>
    </Gate><!-- /content (outer gate) -->

    <!-- ══ Bottom Action Strip — default-deny Gate, SafetyStrip exempt ══ -->
    <Gate gate="safety" class="strip bordered-panel">
      <template #exempt>
      <SafetyStrip
        :armed="armed"
        :busy="busy"
        :isEstop="isEstop"
        :isEnabled="isEnabled"
        :isHomed="isHomed"
        :canEstop="canEstop"
        :canResetEstop="canResetEstop"
        :isTeleop="isTeleop"
        :taskMode="taskMode"
        :interpState="interpState"
        :feedOverride="feedOverrideValue"
        :spindleOverride="spindleOverrideValue"
        :rapidOverride="rapidOverrideValue"
        :gcodes="activeGcodes"
        :mcodes="activeMcodes"
        :elapsed="elapsedDisplay"
        @arm="arm"
        @estop="send({ cmd: 'estop' })"
        @estop-reset="send({ cmd: 'estop_reset' })"
        @machine-on="fire({ cmd: 'machine_on' })"
        @machine-off="fire({ cmd: 'machine_off' })"
      />
      </template>

      <ModeStrip
        :axes="axes"
        :jogVel="jogVel"
        :angularJogVel="angularJogVel"
        :linearUnit="linearUnit"
        :maxJogVel="maxJogVel"
        :maxAngularJogVel="maxAngularJogVel"
        :minAngularJogVel="minAngularJogVel"
        :jogIncrement="jogIncrement"
        :minJogVel="minJogVel"
        :iniIncrements="iniIncrements"
        :isHomed="isHomed"
        :jogDisabled="!permissions.jog"
        :touchoff="touchoff"
        :homedJoints="homedJoints"
        :g5xLabel="g5xLabel"
        @update:jogVel="jogVel = $event"
        @update:angularJogVel="angularJogVel = $event"
        @update:jogIncrement="jogIncrement = $event"
        @resetJogVel="jogVel = defaultJogVel"
        @homeAll="homeAll"
        @unhomeAll="unhomeAll"
        @homeAxis="homeAxis"
        @unhomeAxis="unhomeAxis"
        @setAxis="setAxis"
        @setAll="setAll"
        @update:touchoff="touchoff = $event"
        @setG5x="setG5x"
        @goToG30="fire({ cmd: 'mdi', text: 'O<go_to_g30> CALL' })"
        @goToHome="fire({ cmd: 'mdi', text: 'O<go_to_home> CALL' })"
        @goToZero="fire({ cmd: 'mdi', text: 'O<go_to_zero> CALL' })"
      />


      <ControlsStrip
        :feedSlider="feedSlider"
        :spindleSlider="spindleSlider"
        :rapidSlider="rapidSlider"
        :feedOvrEnabled="feedOvrEnabled"
        :spindleOvrEnabled="spindleOvrEnabled"
        :maxFeedOverride="maxFeedOverride"
        :minSpindleOverride="minSpindleOverride"
        :maxSpindleOverride="maxSpindleOverride"
        :isForward="isForward"
        :isReverse="isReverse"
        :isSpinning="isSpinning"
        :rpmInput="rpmInput"
        :spindleActual="spindleActual"
        :spindleSpeed="spindleSpeed"
        :spindleLoad="spindleLoad"
        :minSpindleSpeed="minSpindleSpeed"
        :maxSpindleSpeed="maxSpindleSpeed"
        :floodOn="floodOn"
        :mistOn="mistOn"
        :toolNumber="toolNumber"
        :currentTool="st.tool_number ?? 0"
        :probing="!!st.probing"
        :userMacros="userMacros"
        @update:feedSlider="feedSlider = $event"
        @update:spindleSlider="spindleSlider = $event"
        @update:rapidSlider="rapidSlider = $event"
        @feedChange="onFeedChange"
        @spindleSliderChange="onSpindleSliderChange"
        @rapidChange="onRapidChange"
        @overridePreset="setOverridePreset"
        @resetAllOverrides="resetAllOverrides"
        @spindleFwd="spindleForward"
        @spindleRev="spindleReverse"
        @spindleStop="spindleStop"
        @update:rpmInput="rpmInput = $event"
        @toggleFlood="toggleFlood"
        @toggleMist="toggleMist"
        @update:toolNumber="toolNumber = $event"
        @saveToolNumber="saveToolNumber"
        @measureAuto="measureAuto"
        @loadTool="loadTool"
        @unloadTool="unloadTool"
        @openToolTable="toolTableDialogOpen = true"
        @executeMacro="executeMacro"
      />
    </Gate><!-- /strip -->

  </div>
</template>
<style scoped>
.wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: var(--gap-controls);
  gap: var(--gap-controls);
  font-family: var(--font-sans);
}

.content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  gap: var(--gap-controls);
  overflow: hidden;
  position: relative; /* containing block for dialogs */
}

.viewerPane {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.sidePane {
  width: var(--panel-min-w-wide);
  flex-shrink: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: var(--gap-controls);
}

.toolTableDialogBody {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.strip {
  display: flex;
  height: 250px;
  flex-shrink: 0;
  padding: var(--gap-controls);
  gap: var(--gap-controls);
}
.strip > * + * {
  border-left: 1px solid var(--border-subtle);
  padding-left: var(--gap-controls);
}

.hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  margin-bottom: var(--gap-section);
  gap: var(--gap-section);
}

.hdrRight {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-tight);
  align-items: center;
  justify-content: flex-end;
}

.title {
  font-size: var(--fs-2xl);
  font-weight: var(--fw-bold);
}

.pill {
  padding: 6px 10px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-base);
  border: 1px solid var(--border);
  user-select: none;
  background: color-mix(in oklab, var(--panel) 80%, transparent);
  color: var(--fg);
}

.pill.ok {
  background: color-mix(in oklab, var(--panel) 92%, transparent);
}

.pill.bad {
  background: color-mix(in oklab, var(--danger) 25%, var(--panel));
}

.pill.armed {
  background: color-mix(in oklab, var(--ok) 25%, var(--panel));
}

.pill.disarmed {
  background: color-mix(in oklab, var(--panel) 92%, transparent);
}

.statusBanner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--gap-section);
  padding: 8px 14px;
  min-height: 40px;
  color: var(--fg);
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  flex-shrink: 0;
}

.statusBanner.error {
  background: color-mix(in oklab, var(--danger) 25%, var(--panel));
}

.statusBanner.refresh {
  background: color-mix(in oklab, var(--active-tool) 20%, var(--panel));
}

@keyframes flash-warn {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.okText {
  color: var(--ok);
}

.badText {
  color: var(--err);
}

.warnText {
  color: var(--warn);
}

.mutedText {
  opacity: var(--opacity-muted);
}

.mono {
  font-family: var(--font-mono);
}

/* ---- Macro param dialog ---- */
.macroParamFields {
  display: flex;
  flex-direction: column;
  gap: var(--gap-controls);
}
.macroParamRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
}
.macroParamLabel {
  min-width: 100px;
  font-size: var(--fs-base);
}
.macroPreview {
  display: block;
  margin-top: var(--gap-section);
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
}

/* ---- Settings dialog ---- */
.settingsDialogBody {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ---- Messages dialog ---- */
.messagesBody {
  overflow-y: auto;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  padding: var(--gap-controls);
}
.msgItem {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  padding: var(--gap-tight) var(--gap-controls);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
}
.msgItem.error { border-color: color-mix(in oklab, var(--danger) 40%, var(--border)); }
.msgItem.display { border-color: color-mix(in oklab, var(--display) 40%, var(--border)); }
.msgTime {
  font-size: var(--fs-2xs);
  font-family: var(--font-mono);
  opacity: var(--opacity-muted);
  flex-shrink: 0;
}
.msgKind {
  font-size: var(--fs-2xs);
  font-weight: var(--fw-bold);
  flex-shrink: 0;
  min-width: 50px;
}
.msgText {
  flex: 1;
  font-size: var(--fs-sm);
  word-break: break-word;
}
.msgEmpty {
  padding: var(--gap-panel);
  text-align: center;
  opacity: var(--opacity-muted);
}

.dialogBody .danger {
  color: var(--danger);
}

.safetyDialog { z-index: 1010; }

</style>
