<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, reactive, ref, watch } from "vue";
import { evaluatePermissions, PERMISSIONS_KEY } from "./permissions";
import { connectWs, connected, status, send, armed, lastReply, viewerGcode, viewerInit, lcncError, latency, networkLatency, messages, unreadCount, dismissMessage, clearAllMessages, markMessagesRead, type LcncMessage } from "./lcncWs";
import ThreeViewer from "./ThreeViewer.vue";
import Toolbar from "./Toolbar.vue";
import TabPanel from "./TabPanel.vue";
import ManualPanel from "./ManualPanel.vue";
import GcodePanel from "./GcodePanel.vue";
import SettingsPanel from "./SettingsPanel.vue";
import ToolTablePanel from "./ToolTablePanel.vue";
import ProbePanel from "./ProbePanel.vue";
import CameraViewer from "./CameraViewer.vue";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineSlider from "./MachineSlider.vue";
import { LocateFixed, SlidersHorizontal, Gauge, MessageSquare, RotateCw, RotateCcw, Square, Droplets, Drill, CodeXml, Lock, LockOpen, TriangleAlert, Power, PowerOff, Gamepad2, BookOpen, ClipboardCopy, Expand, Shrink } from "lucide-vue-next";
import GcodeReferenceDialog from "./GcodeReferenceDialog.vue";
import { loadViewerDefaults, saveViewerDefaults, loadPanelsDefaults, savePanelsDefaults, MAX_PANELS, loadMachineDefaults, loadDisplayDefaults, saveDisplayDefaults, loadMacrosDefaults, loadGamepadDefaults, saveGamepadDefaults, loadKeyboardDefaults, saveKeyboardDefaults, settingsVersion, type ThemeMode, type MacroDef, type GamepadDefaults, type KeyboardDefaults, type KeyboardAction, type Layer, type TrackMode, type Projection, type Vec3, STEP_DEFAULT, STEP_RPM, STEP_OVERRIDE, STEP_RAPID_OVERRIDE } from "./defaults";
import { useGamepad } from "./useGamepad";
import {
  INTERP_IDLE, INTERP_READING, INTERP_PAUSED, INTERP_WAITING,
  TRAJ_MODE_FREE, TRAJ_MODE_TELEOP,
  TASK_MODE_MANUAL, TASK_MODE_AUTO, TASK_MODE_MDI,
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
  if (loadDisplayDefaults().startFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
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

/** ---------- tab definitions ---------- */
const tabs = [
  { id: "viewer", label: "3D Viewer" },
  { id: "manual", label: "Manual Control" },
  { id: "gcode", label: "Program" },
  { id: "probe", label: "Probing" },
  { id: "camera", label: "Camera" },
];

/** ---------- dynamic panels ---------- */
let _nextPanelId = 0;

const _pd = loadPanelsDefaults();
const panels = ref(_pd.tabs.slice(0, MAX_PANELS).map(tab => ({ id: _nextPanelId++, tab })));


const viewerRefs = new Map<number, any>();

function setViewerRef(panelId: number, el: any) {
  if (el) viewerRefs.set(panelId, el);
  else viewerRefs.delete(panelId);
}

function addPanel() {
  if (panels.value.length >= MAX_PANELS) return;
  panels.value.push({ id: _nextPanelId++, tab: "manual" });
}

function removePanel(panelId: number) {
  if (panels.value.length <= 1 || panels.value[0]!.id === panelId) return;
  panels.value = panels.value.filter(p => p.id !== panelId);
  viewerRefs.delete(panelId);
}


watch(
  () => panels.value.map(p => p.tab),
  (tabs) => savePanelsDefaults({ tabs })
);

/** ---------- local UI state ---------- */
const connLabel = computed(() => {
  const h = location.hostname;
  return (h === "localhost" || h === "127.0.0.1") ? "local" : h;
});
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

const machinePos = computed<number[]>(() => {
  const data = st.value ?? {};
  return Array.isArray(data.machine_pos) ? data.machine_pos : [];
});

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

const hasRotation = computed(() => {
  const rot = st.value.rotation_xy;
  if (rot != null && rot !== 0) return true;
  const activeRow = wcsTable.value.find(r => r.name === g5xLabel.value);
  return activeRow != null && activeRow.r !== 0;
});

const hasOffsetWarning = computed(() => hasRotation.value || !!st.value.eoffset_enabled);

function fmtOff(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return "0.0000";
  return v.toFixed(4);
}

// WCS offset table (fetched on demand when popover opens)
type WcsRow = { name: string; [axis: string]: string | number };
const wcsTable = ref<WcsRow[]>([]);
const selectedWcs = ref<string | null>(null);
const offsetColumns = computed(() => [...axes.value.map(l => l.toLowerCase()), "r"]);

function fetchWcsTable() {
  send({ cmd: "get_wcs_table" });
}

// Reset selection to active WCS when popover opens
function openOffsetsPopover() {
  toggleChip("offsets");
  if (openChip.value === "offsets") {
    selectedWcs.value = g5xLabel.value;
    fetchWcsTable();
  }
}

function clearWcs(target: string) {
  send({ cmd: "clear_wcs", target });
  // Local zero for instant feedback; gateway reply will confirm with full table
  const zeroed = Object.fromEntries(offsetColumns.value.map(k => [k, 0]));
  if (target === "all") {
    wcsTable.value = wcsTable.value.map(row => ({ ...row, ...zeroed }));
  } else {
    wcsTable.value = wcsTable.value.map(row =>
      row.name === target ? { ...row, ...zeroed } : row
    );
  }
}

// Inline cell editing
const editingCell = ref<{ wcs: string; axis: string } | null>(null);
const editValue = ref("");
const offsetInputRef = ref<HTMLInputElement | null>(null);

function startEditCell(wcs: string, axis: string, current: number) {
  if (!permissions.value.ready) return;
  editingCell.value = { wcs, axis };
  editValue.value = current.toFixed(4);
  nextTick(() => {
    const el = Array.isArray(offsetInputRef.value) ? offsetInputRef.value[0] : offsetInputRef.value;
    el?.focus();
  });
}

function commitCell(wcs: string, axis: string) {
  if (!editingCell.value) return;
  const val = parseFloat(editValue.value);
  editingCell.value = null;
  if (isNaN(val)) return;
  send({ cmd: "set_wcs", target: wcs, [axis]: val });
  const row = wcsTable.value.find(r => r.name === wcs);
  if (row) (row as any)[axis] = val;
}

function cancelEdit() { editingCell.value = null; }

// Capture WCS table replies (sync flush to avoid missing rapid updates)
watch(lastReply, (r) => {
  if (r?.ok && r.table) wcsTable.value = r.table;
}, { flush: "sync" });

const taskModeLabel = computed(() => {
  const mode = st.value.task_mode;
  if (mode === TASK_MODE_MANUAL) return "MANUAL";
  if (mode === TASK_MODE_AUTO) return "AUTO";
  if (mode === TASK_MODE_MDI) return "MDI";
  return "-";
});

// Interpreter state label
const interpStateLabel = computed(() => {
  if (isPaused.value) return "PAUSED";
  if (isRunning.value) return "RUNNING";
  if (isIdle.value) return "IDLE";
  return "-";
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
const overridesActive = computed(() =>
  feedOverrideValue.value !== 1.0 || spindleOverrideValue.value !== 1.0 || rapidOverrideValue.value !== 1.0
);
const feedOvrEnabled = computed(() => st.value.feed_override_enabled !== false);
const spindleOvrEnabled = computed(() => st.value.spindle_override_enabled !== false);
const overridesDisabled = computed(() => !feedOvrEnabled.value || !spindleOvrEnabled.value);

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

// Status chip popovers (click-to-toggle, only one open at a time)
const openChip = ref<string | null>(null);
const feedSlider = ref(100);
const spindleSlider = ref(100);
const rapidSlider = ref(100);

watch(feedOverrideValue, (val) => { if (Number.isFinite(val)) feedSlider.value = Math.round(val * 100); });
watch(spindleOverrideValue, (val) => { if (Number.isFinite(val)) spindleSlider.value = Math.round(val * 100); });
watch(rapidOverrideValue, (val) => { if (Number.isFinite(val)) rapidSlider.value = Math.round(val * 100); });

function toggleChip(chip: string) {
  closeAllDialogs();
  openChip.value = openChip.value === chip ? null : chip;
}
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

// Active modal codes
const activeGcodes = computed(() => {
  const raw = st.value.gcodes;
  if (!Array.isArray(raw)) return "-";
  return raw
    .slice(1)  // index 0 is N-word sequence number, not a G-code
    .filter((v: number) => v >= 0)
    .sort((a: number, b: number) => a - b)
    .map((v: number) => `G${(v / 10).toFixed(v % 10 ? 1 : 0)}`)
    .join(" ") || "-";
});

const activeMcodes = computed(() => {
  const raw = st.value.mcodes;
  if (!Array.isArray(raw)) return "-";
  return raw
    .slice(1)  // index 0 is N-word sequence number, not an M-code
    .filter((v: number) => v >= 0)
    .sort((a: number, b: number) => a - b)
    .map((v: number) => `M${v}`)
    .join(" ") || "-";
});

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
const spindleMismatch = computed(() =>
  !isSpinning.value && Math.abs(spindleActual.value ?? 0) > 1
);


// Coolant state
const floodOn = computed(() => !!st.value.flood);
const mistOn = computed(() => !!st.value.mist);
const coolantActive = computed(() => floodOn.value || mistOn.value);

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

// Tool sidebar state
const toolDialogOpen = ref(false);
const settingsDialogOpen = ref(false);
const gcodeRefOpen = ref(false);
const gcodeRefInitialSearch = ref("");

function closeAllDialogs() {
  toolDialogOpen.value = false;
  settingsDialogOpen.value = false;
  gcodeRefOpen.value = false;
}

function openDialog(name: "tool" | "settings" | "gcodeRef") {
  // Toggle if already open
  const isOpen = (name === "tool" && toolDialogOpen.value)
    || (name === "settings" && settingsDialogOpen.value)
    || (name === "gcodeRef" && gcodeRefOpen.value);
  closeAllDialogs();
  openChip.value = null;
  if (!isOpen) {
    if (name === "tool") toolDialogOpen.value = true;
    else if (name === "settings") settingsDialogOpen.value = true;
    else if (name === "gcodeRef") gcodeRefOpen.value = true;
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
    openChip.value = null;
  } else {
    const values: Record<string, string> = {};
    for (const p of m.params) values[p.name] = p.default;
    macroParamDialog.value = { macro: m, values };
    openChip.value = null;
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

const probeStatus = computed(() => {
  if (st.value.probing) return "PROBING";
  if (st.value.probe_tripped) return "TRIPPED";
  return "IDLE";
});

const probeStatusClass = computed(() => {
  if (st.value.probing) return "probing";
  if (st.value.probe_tripped) return "tripped";
  return "";
});

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

function formatRpm(val: number | null): string {
  if (val == null || !Number.isFinite(val)) return "\u2014";
  return Math.round(val).toLocaleString();
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

watch(openChip, (chip) => {
  if (chip === "messages") markMessagesRead();
});

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

// Broadcast setMachinePartColor to all ThreeViewer instances
function setMachinePartColor(partId: string, color: string | null) {
  for (const v of viewerRefs.values()) v?.setMachinePartColor?.(partId, color);
}

// Broadcast setMachineEdges to all ThreeViewer instances
function setMachineEdges(on: boolean) {
  for (const v of viewerRefs.values()) v?.setMachineEdges?.(on);
}

// Broadcast setToolColors to all ThreeViewer instances
function setToolColors(toolColor: string | null, cutterColor: string | null) {
  for (const v of viewerRefs.values()) v?.setToolColors?.(toolColor, cutterColor);
}

provide("machineParts", machineParts);
provide("setMachinePartColor", setMachinePartColor);
provide("setMachineEdges", setMachineEdges);
provide("setToolColors", setToolColors);

// Broadcast viewer settings to all ThreeViewer instances
function setPathOnTop(on: boolean) {
  for (const v of viewerRefs.values()) v?.setPathAlwaysOnTop?.(on);
}
function setProjection(proj: "perspective" | "parallel") {
  const wantOrtho = proj === "parallel";
  for (const v of viewerRefs.values()) {
    if (v?.isOrtho?.value !== wantOrtho) v?.switchProjection?.();
  }
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

function sendMdi() {
  fire({ cmd: "mdi", text: mdiText.value });
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

function homeAxis(joint: number) {
  fire({ cmd: "home", joint });
}

function unhomeAxis(joint: number) {
  fire({ cmd: "unhome", joint });
}

function toggleTeleop() {
  fire(isTeleop.value ? { cmd: "teleop_disable" } : { cmd: "teleop_enable" });
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
const gamepadGated = computed(() => panels.value.some(p => p.tab === "settings"));
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

/** Auto-switch to teleop after all joints home (standard LinuxCNC UI behavior) */
watch(isHomed, (nowHomed, wasHomed) => {
  if (nowHomed && !wasHomed && armed.value) {
    send({ cmd: "teleop_enable" });
  }
});
</script>

<template>
  <div class="wrap">
    <!-- ══ Sidebar — outside outer Gate, never disabled ══ -->
    <div class="sidebar">

    <!-- Machine Safety — always accessible -->
    <Gate :allow="permissions.always" class="card">
      <div class="sub">Machine Safety</div>
      <div class="btnrow">
        <MachineBtn type="arm" :variant="armed ? 'ok' : 'default'" class="safetyBtn" @click="arm(!armed)" :disabled="busy" :title="armed ? 'Disarm' : 'Arm'" block>
          <component :is="armed ? LockOpen : Lock" class="safetyIcon" />
        </MachineBtn>

        <div class="vsep"></div>

        <MachineBtn
          type="estop" class="safetyBtn"
          :flashing="isEstop"
          @click="send({ cmd: isEstop ? 'estop_reset' : 'estop' })"
          :disabled="!(isEstop ? canResetEstop : canEstop)"
        >
          <TriangleAlert class="safetyIcon" />
          <span class="safetyLabel">{{ isEstop ? "Reset" : "E-Stop" }}</span>
        </MachineBtn>

        <div class="vsep"></div>

        <Gate :allow="permissions.safety">
          <MachineBtn
            type="machineOn" :variant="isEnabled ? 'ok' : 'default'" class="safetyBtn"
            @click="fire({ cmd: isEnabled ? 'machine_off' : 'machine_on' })"
            :disabled="busy"
            :title="isEnabled ? 'Machine Off' : 'Machine On'"
            block
          >
            <Power class="safetyIcon" />
          </MachineBtn>
        </Gate>
      </div>
    </Gate>

    <section class="card">
      <div class="sub">Machine Status</div>
      <div class="machineStatus">
        <div class="statusRow"><div class="k">E-Stop</div><div class="v" :class="isEstop ? 'badText' : 'okText'">{{ isEstop ? 'TRUE' : 'FALSE' }}</div></div>
        <div class="statusRow"><div class="k">Enabled</div><div class="v" :class="isEnabled ? 'okText' : 'mutedText'">{{ isEnabled ? 'TRUE' : 'FALSE' }}</div></div>
        <div class="statusRow"><div class="k">Homed</div><div class="v" :class="isHomed ? 'okText' : 'badText'">{{ isHomed ? 'TRUE' : 'FALSE' }}</div></div>
        <div class="statusRow"><div class="k">Motion</div><div class="v">{{ isTeleop ? 'WORLD' : 'JOINT' }}</div></div>
        <div class="statusRow"><div class="k">Mode</div><div class="v">{{ taskModeLabel }}</div></div>
        <div class="statusRow"><div class="k">Interp</div><div class="v">{{ interpStateLabel }}</div></div>
        <div class="statusRow"><div class="k">Elapsed</div><div class="v mono">{{ elapsedDisplay }}</div></div>
        <div class="statusRow"><div class="k">Overrides</div><div class="v" :class="overridesActive ? 'warnText' : ''">{{ overridesActive ? 'ACTIVE' : 'INACTIVE' }}</div></div>
        <div class="statusRow codesRow">
          <div class="k">Codes</div>
          <div class="v mono codesShort">{{ activeGcodes }}</div>
          <div class="popover codesPopover">
            <div class="label">G-codes</div>
            <div class="codesValue">{{ activeGcodes }}</div>
            <div class="sep"></div>
            <div class="label">M-codes</div>
            <div class="codesValue">{{ activeMcodes }}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="sub">Controls</div>
      <Gate :allow="permissions.abort">
        <div class="controlBtns">
        <div class="controlGroup">
        <MachineBtn
          type="sidebarChip" class="controlBtn"
          :active="isSpinning"
          :warning="spindleMismatch"
          @click.stop="toggleChip('spindle')"
          title="Spindle"
          block
        >
          <RotateCw class="controlIcon" />
        </MachineBtn>
        <div class="popover spindlePopover" :class="{ open: openChip === 'spindle' }" @click.stop>
          <div class="popHeader"><span class="popTitle">Spindle</span><MachineBtn type="close" @click="openChip = null">&times;</MachineBtn></div>
          <!-- Direction controls -->
          <div class="spDirRow">
            <MachineBtn
              type="spindleRev" class="spDirBtn"
              :active="isReverse"
              @click="spindleReverse(rpmInput)"
              title="Spindle Reverse (CCW)"
            >
              <RotateCcw :size="14" />
              <span class="label">Rev</span>
            </MachineBtn>
            <MachineBtn
              type="spindleStop" class="spDirBtn"
              :active="isSpinning"
              :disabled="!isSpinning"
              @click="spindleStop()"
              title="Spindle Stop"
            >
              <Square :size="14" />
              <span class="label">Stop</span>
            </MachineBtn>
            <MachineBtn
              type="spindleFwd" class="spDirBtn"
              :active="isForward"
              @click="spindleForward(rpmInput)"
              title="Spindle Forward (CW)"
            >
              <RotateCw :size="14" />
              <span class="label">Fwd</span>
            </MachineBtn>
          </div>

          <!-- RPM input -->
          <div class="spRpmRow">
            <span class="spFieldLabel">Speed</span>
            <MachineInput
              gate="rpmInput"
              type="number"
              class="spRpmInput"
              v-model.number="rpmInput"
              :min="minSpindleSpeed"
              :max="maxSpindleSpeed"
              :step="STEP_RPM"
            />
            <span class="spUnit">RPM</span>
          </div>

          <!-- Actual speed display -->
          <div class="spActualGroup">
            <div class="spActualRow">
              <span class="spFieldLabel">Actual</span>
              <span class="spActualValue">{{ formatRpm(spindleActual) }} <span class="spUnit">RPM</span></span>
            </div>
            <div class="spActualRow">
              <span class="spFieldLabel">Commanded</span>
              <span class="spCommandedValue">{{ formatRpm(spindleSpeed) }} <span class="spUnit">RPM</span></span>
            </div>
            <div class="spActualRow">
              <span class="spFieldLabel">Direction</span>
              <span class="spDirValue" :class="{ okText: isSpinning }">
                {{ isForward ? "FWD (CW)" : isReverse ? "REV (CCW)" : "STOPPED" }}
              </span>
            </div>
            <div v-if="spindleLoad != null" class="spActualRow">
              <span class="spFieldLabel">Load</span>
              <span class="spActualValue">{{ Math.round(spindleLoad) }} <span class="spUnit">%</span></span>
            </div>
          </div>
        </div>
        </div>

        <div class="controlGroup">
        <MachineBtn
          type="sidebarChip" class="controlBtn"
          :active="coolantActive"
          @click.stop="toggleChip('coolant')"
          title="Coolant"
          block
        >
          <Droplets class="controlIcon" />
        </MachineBtn>
        <div class="popover coolantPopover" :class="{ open: openChip === 'coolant' }" @click.stop>
          <div class="popHeader"><span class="popTitle">Coolant</span><MachineBtn type="close" @click="openChip = null">&times;</MachineBtn></div>
          <div class="coolantRow">
            <span class="coolantLabel">Flood</span>
            <MachineBtn
              type="flood"
              class="coolantToggle"
              :active="floodOn"
              @click="toggleFlood"
            >{{ floodOn ? 'ON' : 'OFF' }}</MachineBtn>
          </div>
          <div class="coolantRow">
            <span class="coolantLabel">Mist</span>
            <MachineBtn
              type="mist"
              class="coolantToggle"
              :active="mistOn"
              @click="toggleMist"
            >{{ mistOn ? 'ON' : 'OFF' }}</MachineBtn>
          </div>
        </div>
        </div>

        <div class="controlGroup">
        <MachineBtn
          type="sidebarChip" class="controlBtn"
          :active="!!st.probing"
          @click.stop="openDialog('tool')"
          title="Tool"
          block
        >
          <Drill class="controlIcon" />
        </MachineBtn>
        </div>
        <div class="controlGroup">
        <MachineBtn
          type="sidebarChip" class="controlBtn"
          @click.stop="toggleChip('macros')"
          title="Macros"
          block
        >
          <CodeXml class="controlIcon" />
        </MachineBtn>
        <div class="popover macroPopover" :class="{ open: openChip === 'macros' }" @click.stop>
          <div class="popHeader"><span class="popTitle">Macros</span><MachineBtn type="close" @click="openChip = null">&times;</MachineBtn></div>
          <div v-if="userMacros.length === 0" class="macroEmpty">
            No macros configured.<br>Add macros in Settings.
          </div>
          <template v-else>
            <MachineBtn
              v-for="m in userMacros"
              :key="m.id"
              type="macro"
              class="macroBtn"
              @click="executeMacro(m)"
              block
            >{{ m.name }}</MachineBtn>
          </template>
        </div>
        </div>

        <!-- Overrides -->
        <div class="controlGroup">
        <MachineBtn
          type="sidebarChip" class="controlBtn"
          :warning="overridesActive || overridesDisabled"
          @click.stop="toggleChip('overrides')"
          title="Overrides"
          block
        >
          <Gauge class="controlIcon" />
        </MachineBtn>
        <div class="popover overridesPopover" :class="{ open: openChip === 'overrides' }" @click.stop>
          <div class="popHeader"><span class="popTitle">Overrides</span><MachineBtn type="close" @click="openChip = null">&times;</MachineBtn></div>
          <div class="ovrRow">
            <span class="ovrLabel">Feed</span>
            <MachineSlider gate="feedOverride" v-model="feedSlider" @change="onFeedChange" :min="0" :max="maxFeedOverride" :step="STEP_OVERRIDE" :disabled="!feedOvrEnabled" />
            <span class="sliderVal" :class="{ warn: feedSlider !== 100 }">{{ feedSlider }}%</span>
          </div>
          <div class="ovrPresets">
            <MachineBtn v-for="p in [50, 100, 150, 200]" :key="'f'+p" type="overridePreset" :disabled="!feedOvrEnabled" @click="setOverridePreset('feed', p)">{{ p }}%</MachineBtn>
          </div>
          <div class="ovrRow">
            <span class="ovrLabel">Spindle</span>
            <MachineSlider gate="spindleOverride" v-model="spindleSlider" @change="onSpindleSliderChange" :min="minSpindleOverride" :max="maxSpindleOverride" :step="STEP_OVERRIDE" :disabled="!spindleOvrEnabled" />
            <span class="sliderVal" :class="{ warn: spindleSlider !== 100 }">{{ spindleSlider }}%</span>
          </div>
          <div class="ovrPresets">
            <MachineBtn v-for="p in [50, 100, 150, 200]" :key="'s'+p" type="overridePreset" :disabled="!spindleOvrEnabled" @click="setOverridePreset('spindle', p)">{{ p }}%</MachineBtn>
          </div>
          <div class="ovrRow">
            <span class="ovrLabel">Rapid</span>
            <MachineSlider gate="rapidOverride" v-model="rapidSlider" @change="onRapidChange" :min="25" :max="100" :step="STEP_RAPID_OVERRIDE" />
            <span class="sliderVal" :class="{ warn: rapidSlider !== 100 }">{{ rapidSlider }}%</span>
          </div>
          <div class="ovrPresets">
            <MachineBtn v-for="p in [25, 50, 75, 100]" :key="'r'+p" type="overridePreset" @click="setOverridePreset('rapid', p)">{{ p }}%</MachineBtn>
          </div>
          <MachineBtn type="overrideReset" class="ovrResetBtn" @click="resetAllOverrides" block>Reset All</MachineBtn>
        </div>
        </div>

        <!-- Offsets -->
        <div class="controlGroup">
        <MachineBtn
          type="sidebarChip" class="controlBtn"
          :warning="hasOffsetWarning"
          @click.stop="openOffsetsPopover()"
          title="Offsets"
          block
        >
          <LocateFixed class="controlIcon" />
        </MachineBtn>
        <div class="popover offsetsPopover" :class="{ open: openChip === 'offsets' }" @click.stop>
          <div class="popHeader"><span class="popTitle">Work Offsets</span><MachineBtn type="close" @click="openChip = null">&times;</MachineBtn></div>
          <table class="offsetTable">
            <thead>
              <tr><th></th><th v-for="col in offsetColumns" :key="col">{{ col.toUpperCase() }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in wcsTable" :key="row.name"
                  :class="{ activeRow: row.name === g5xLabel, selectedRow: row.name === selectedWcs }"
                  @click="selectedWcs = row.name">
                <td class="offLabel">{{ row.name }}</td>
                <td v-for="axis in offsetColumns" :key="axis"
                    :class="{ warn: axis === 'r' && row[axis] !== 0, editableCell: permissions.ready }"
                    @dblclick.stop="startEditCell(row.name, axis, Number(row[axis]) || 0)">
                  <MachineInput v-if="editingCell?.wcs === row.name && editingCell?.axis === axis"
                         gate="touchoff"
                         ref="offsetInputRef"
                         v-model="editValue"
                         type="number"
                         class="offsetInput"
                         @keydown.enter.prevent="commitCell(row.name, axis)"
                         @keydown.escape.prevent="cancelEdit()"
                         @blur="commitCell(row.name, axis)"
                         @click.stop />
                  <span v-else>{{ fmtOff(Number(row[axis])) }}</span>
                </td>
              </tr>
              <tr v-if="st.g92_offset?.some((v: number) => v !== 0)" class="g92Row">
                <td class="offLabel">G92</td>
                <td v-for="(col, i) in offsetColumns" :key="col">{{ col === 'r' ? '' : fmtOff(st.g92_offset?.[i]) }}</td>
              </tr>
              <tr v-if="st.tool_offset?.some((v: number) => v !== 0)" class="toolRow">
                <td class="offLabel">Tool</td>
                <td v-for="(col, i) in offsetColumns" :key="col">{{ col === 'r' ? '' : fmtOff(st.tool_offset?.[i]) }}</td>
              </tr>
              <tr v-if="st.eoffset_z != null && st.eoffset_z !== 0" class="eoffsetRow">
                <td class="offLabel">Comp</td>
                <td v-for="col in offsetColumns" :key="col">{{ col === 'z' ? fmtOff(st.eoffset_z) : '' }}</td>
              </tr>
            </tbody>
          </table>
          <div class="offsetActions">
            <MachineBtn type="wcs" :disabled="!selectedWcs" @click="clearWcs(selectedWcs!)">Clear {{ selectedWcs }}</MachineBtn>
            <MachineBtn type="wcs" @click="clearWcs('all')">Clear All</MachineBtn>
          </div>
        </div>
        </div>

        <!-- Messages -->
        <div class="controlGroup">
        <MachineBtn
          type="sidebarChip" class="controlBtn"
          :warning="unreadCount > 0"
          @click.stop="toggleChip('messages')"
          title="Messages"
          block
        >
          <MessageSquare class="controlIcon" />
        </MachineBtn>
        <div class="popover messagesPopover" :class="{ open: openChip === 'messages' }" @click.stop>
          <div class="popHeader">
            <span class="popTitle">Messages</span>
            <div class="row-tight">
              <template v-if="messages.length > 0">
                <MachineBtn type="inlineXs" @click="copyAllMessages">Copy All</MachineBtn>
                <MachineBtn type="inlineXs" @click="clearAllMessages">Clear All</MachineBtn>
              </template>
              <MachineBtn type="close" @click="openChip = null">&times;</MachineBtn>
            </div>
          </div>
          <div v-if="messages.length === 0" class="msgPopEmpty">No messages</div>
          <div v-else class="msgPopList">
            <div v-for="msg in [...messages].reverse()" :key="msg.id" class="msgPopItem" :class="msgKindClass(msg.kind)">
              <div class="msgPopIndicator"></div>
              <div class="msgPopBody">
                <div class="msgPopMeta">
                  <span class="msgPopBadge" :class="msgKindClass(msg.kind)">{{ msgKindLabel(msg.kind) }}</span>
                  <span class="msgPopTime">{{ msgFormatTime(msg.ts) }}</span>
                </div>
                <div class="msgPopText">{{ msg.text }}</div>
              </div>
              <MachineBtn type="listAction" title="Copy" @click="copyMessage(msg)"><ClipboardCopy :size="12" /></MachineBtn>
              <MachineBtn type="close" @click="dismissMessage(msg.id)">&times;</MachineBtn>
            </div>
          </div>
        </div>
        </div>

        <div class="controlGroup">
        <MachineBtn type="sidebarNav" class="controlBtn" @click.stop="openGcodeRef()" title="G-code Reference" block>
          <BookOpen class="controlIcon" />
        </MachineBtn>
        </div>
        <div class="controlGroup">
        <MachineBtn type="sidebarNav" class="controlBtn" @click.stop="openDialog('settings')" title="Settings" block>
          <SlidersHorizontal class="controlIcon" />
        </MachineBtn>
        </div>
        <div v-if="st.debug" class="controlGroup simtripGroup">
        <MachineBtn type="simTrip" class="controlBtn simtrip" :disabled="!st.probing" @click.stop="send({ cmd: 'simulate_probe_trip' })" title="Simulate probe contact (sim/debug)" block>Sim Trip</MachineBtn>
        </div>
        </div>
      </Gate>
    </section>
    </div><!-- /sidebar -->

    <!-- ══ Outer Gate — covers everything except sidebar ══ -->
    <Gate :allow="permissions.safety" class="mainArea">

    <header class="hdr">
      <div class="title">LinuxCNC WebUI ({{ connLabel }})</div>

      <div class="hdrRight">
          <div
            class="pill"
            :title="connectedClients.map(c => c.ip + (c.armed ? ' (armed)' : '')).join('\n')"
          >
            {{ connectedClients.length }} client{{ connectedClients.length !== 1 ? 's' : '' }}
          </div>

          <div class="pill" :class="connected ? 'ok' : 'bad'">
            {{ connected ? "WS connected" : "WS disconnected" }}
          </div>

          <div v-if="connected && networkLatency != null" class="pill"
               title="Network latency: WebSocket ping/pong transit time between browser and gateway">
            Net {{ networkLatency }}ms
          </div>
          <div v-if="connected && latency != null" class="pill"
               title="Round-trip latency: full cycle from browser → gateway status poll → browser, includes network + server processing">
            Ping {{ latency }}ms
          </div>

          <div class="pill" :class="lcncError ? 'bad' : (configName ? 'ok' : '')">
            {{ lcncLabel }}
          </div>

          <div class="pill" :class="armed ? 'armed' : 'disarmed'">
            {{ armed ? "ARMED" : "DISARMED" }}
          </div>

          <div v-if="gamepad.gamepadConnected.value" class="pill ok" :title="gamepad.gamepadName.value">
            <Gamepad2 :size="14" />
          </div>

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

    <!-- Dynamic tab panels (1–4) -->
    <div class="panels">
      <div v-for="(panel, idx) in panels" :key="panel.id" class="panel"
           :class="'panel-' + panel.tab">
        <TabPanel
          :tabs="tabs"
          :modelValue="panel.tab"
          @update:modelValue="panel.tab = $event"
          :closable="idx > 0"
          @close="removePanel(panel.id)"
        >
          <template #viewer>
            <Toolbar
              @resetBackplot="viewerRefs.get(panel.id)?.resetBackplot?.()"
              @setView="(p: any) => viewerRefs.get(panel.id)?.setView?.(p)"
              @toggleLayer="(l: Layer, on: boolean) => { viewerLayers[l] = on; for (const v of viewerRefs.values()) v?.setLayerVisible?.(l, on); saveViewerState(); }"
              @setPathOnTop="(on: boolean) => { viewerPathOnTop = on; for (const v of viewerRefs.values()) v?.setPathAlwaysOnTop?.(on); saveViewerState(); }"
              @setTrackMode="(m: string) => { viewerTrackMode = m as TrackMode; for (const v of viewerRefs.values()) v?.setTrackingMode?.(m); saveViewerState(); }"
              @toggleProjection="() => { viewerProjection = viewerProjection === 'parallel' ? 'perspective' : 'parallel'; viewerRefs.get(panel.id)?.switchProjection?.(); saveViewerState(); }"
              :workpieceSize="workpieceSize"
              :workpieceOffset="workpieceOffset"
              @update:workpieceSize="workpieceSize = $event; saveViewerState()"
              @update:workpieceOffset="workpieceOffset = $event; saveViewerState()"
            >
              <ThreeViewer
                :ref="(el: any) => setViewerRef(panel.id, el)"
                :active="panel.tab === 'viewer'"
                :workpieceSize="workpieceSize"
                :workpieceOffset="workpieceOffset"
                :g5xLabel="g5xLabel"
                :linearUnit="linearUnit"
                :jogVel="jogVel"
                :angularJogVel="angularJogVel"
                :isHomed="isHomed"
                :isTeleop="isTeleop"
                :maxJogVel="maxJogVel"
                :maxAngularJogVel="maxAngularJogVel"
                :minAngularJogVel="minAngularJogVel"
                :jogIncrement="jogIncrement"
                :minJogVel="minJogVel"
                :iniIncrements="iniIncrements"
                :activeFile="activeFile"
                :spindleSpeed="spindleSpeed"
                :spindleActual="spindleActual"
                :spindleDirection="spindleDirection"
                :surfacePoints="surfaceLoadedToViewer ? surfacePoints : null"
                :axes="axes"
                :touchoff="touchoff"
                :jogDisabled="!permissions.jog"
                @update:touchoff="touchoff = $event"
                @update:jogVel="jogVel = $event"
                @update:angularJogVel="angularJogVel = $event"
                @update:jogIncrement="jogIncrement = $event"
                @toggleTeleop="toggleTeleop"
                @homeAll="homeAll"
                @unhomeAll="unhomeAll"
                @setAxis="setAxis"
                @setAll="setAll"
                @goToG30="fire({ cmd: 'mdi', text: 'O<go_to_g30> CALL' })"
                @goToHome="fire({ cmd: 'mdi', text: 'O<go_to_home> CALL' })"
                @goToZero="fire({ cmd: 'mdi', text: 'O<go_to_zero> CALL' })"
              />
            </Toolbar>
          </template>

          <template #manual>
            <ManualPanel
              :axes="axes"
              :workPos="workPos" :machinePos="machinePos" :dtg="dtg"
              :g5xLabel="g5xLabel" :linearUnit="linearUnit" :homed="isHomed"
              :homedJoints="homedJoints"
              :jogVel="jogVel" :angularJogVel="angularJogVel"
              :isTeleop="isTeleop" :isHomed="isHomed"
              :maxJogVel="maxJogVel" :maxAngularJogVel="maxAngularJogVel"
              :minAngularJogVel="minAngularJogVel"
              :activeJogActions="jogActions"
              :jogIncrement="jogIncrement"
              :minJogVel="minJogVel" :iniIncrements="iniIncrements"
              :mdiText="mdiText"
              :touchoff="touchoff"
              @update:touchoff="touchoff = $event"
              @setAxis="setAxis" @setAll="setAll" @setG5x="setG5x"
              @homeAll="homeAll" @unhomeAll="unhomeAll" @homeAxis="homeAxis" @unhomeAxis="unhomeAxis"
              @update:jogVel="jogVel = $event"
              @update:angularJogVel="angularJogVel = $event"
              @update:jogIncrement="jogIncrement = $event"
              @toggleTeleop="toggleTeleop"
              @update:mdiText="mdiText = $event"
              @sendMdi="sendMdi"
              @goToG30="fire({ cmd: 'mdi', text: 'O<go_to_g30> CALL' })"
              @goToHome="fire({ cmd: 'mdi', text: 'O<go_to_home> CALL' })"
              @goToZero="fire({ cmd: 'mdi', text: 'O<go_to_zero> CALL' })"
            />
          </template>


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


          <template #camera>
            <CameraViewer :active="panel.tab === 'camera'" />
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

      <div v-if="panels.length < MAX_PANELS">
        <button
          class="addPanel"
          @click="addPanel"
        >+</button>
      </div>
    </div><!-- /panels -->

    <!-- Tool table dialog -->
    <div v-if="toolDialogOpen" class="dialogOverlay">
      <div class="dialog lg dialog-full">
        <div class="dialogHeader">
          <span class="dialogTitle">Tool Table</span>
          <MachineBtn type="close" @click="toolDialogOpen = false">&times;</MachineBtn>
        </div>
        <div class="toolDialogActions">
            <div class="toolInputRow">
              <span class="toolFieldLabel">Tool #</span>
              <MachineInput
                gate="toolEdit"
                type="number"
                class="toolNumInput"
                v-model.number="toolNumber"
                min="1"
                :step="STEP_DEFAULT"
                :disabled="!!st.probing"
                @change="saveToolNumber"
              />
            </div>
            <div class="toolActions">
              <MachineBtn type="toolMeasure" :disabled="!!st.probing" @click="measureAuto">Measure</MachineBtn>
              <MachineBtn type="toolLoad" :disabled="!!st.probing" @click="loadTool">Load</MachineBtn>
              <MachineBtn type="toolUnload" :disabled="!!st.probing || st.tool_number === 0" @click="unloadTool">Unload</MachineBtn>
            </div>
            <div class="toolActions">
              <MachineBtn type="abort" @click="fire({ cmd: 'abort' })">Abort</MachineBtn>
            </div>
            <div class="toolActions">
              <MachineBtn type="manage" @click="toolTableRef?.openAdd()">+ Add</MachineBtn>
              <MachineBtn type="manage" @click="toolTableRef?.triggerImport()">Import</MachineBtn>
              <MachineBtn type="manage" @click="toolTableRef?.fetchTools()">Refresh</MachineBtn>
            </div>
          <div class="toolStatusRow">
            <span class="toolStatusDot" :class="probeStatusClass"></span>
            <span class="toolStatusText">{{ probeStatus }}</span>
          </div>
        </div>
        <div class="toolDialogBody">
          <ToolTablePanel ref="toolTableRef" :currentTool="st.tool_number ?? null" :iniFilename="st.ini_filename ?? null" hideHeader />
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
        <Gate :allow="permissions.abort" class="dialogActions">
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
        <Gate :allow="permissions.ready" class="dialogActions">
          <MachineBtn type="dialogCancel" @click="macroParamDialog = null">Cancel</MachineBtn>
          <MachineBtn type="dialogConfirm" @click="confirmMacroParams">Execute</MachineBtn>
        </Gate>
      </div>
    </div>

    <div v-if="showShutdownConfirm" class="dialogOverlay safetyDialog">
      <div class="dialog">
        <div class="dialogTitle danger">Shut Down LinuxCNC?</div>
        <div class="dialogBody">This will stop all motion and exit LinuxCNC.</div>
        <Gate :allow="permissions.abort" class="dialogActions">
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
        <Gate :allow="permissions.ready" class="dialogActions">
          <MachineBtn type="dialogDanger" @click="cancelCompToggle">Cancel</MachineBtn>
          <MachineBtn type="dialogConfirm" @click="confirmCompToggle">Confirm</MachineBtn>
        </Gate>
      </div>
    </div>

    </Gate><!-- /outerGate -->
  </div>
</template>

<style scoped>
.wrap {
  --sidebar-w: 150px;
  --sidebar-total: 178px; /* 16px wrap padding + sidebar + 12px gap */
  height: 100%;
  display: flex;
  flex-direction: row;
  box-sizing: border-box;
  padding: 16px;
  gap: var(--gap-section);
  font-family: var(--font-sans);
}

.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  z-index: 1020;
}

.mainArea {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
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

/* ---- Shared panel styles (visual, no layout) ---- */
.panels {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: var(--gap-section);
  margin-bottom: var(--gap-section);
  overflow: hidden;
}

.panel {
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  padding: 12px;
  background: var(--panel);
  color: var(--fg);
  display: flex;
  flex-direction: column;
}

.addPanel {
  flex: 0 0 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--radius-2xl);
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--fg);
  font-size: var(--fs-2xl);
  opacity: var(--opacity-disabled);
  transition: opacity 0.15s, background 0.15s;
}

.addPanel:hover {
  opacity: 0.8;
  background: color-mix(in oklab, var(--panel) 50%, transparent);
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

.sidebar > .card {
  margin-bottom: 0;
}

.sidebar .btnrow {
  flex-direction: column;
  align-items: stretch;
  gap: var(--gap-controls);
}

.sidebar .safetyBtn {
  width: 100%;
  padding: 8px 10px;
  min-width: 0;
}

.sidebar .vsep {
  width: 100%;
  height: 1px;
  margin: 0;
}

.machineStatus {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
}

.card {
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  padding: 12px;
  margin-bottom: var(--gap-section);
  background: var(--panel);
  color: var(--fg);
}


.statusGroups {
  display: flex;
  gap: var(--gap-section);
  margin-bottom: var(--gap-controls);
}

.statusGroup {
  flex: 1;
  padding: 12px;
  border: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
  border-radius: var(--radius-xl);
  background: color-mix(in oklab, var(--panel) 30%, transparent);
  display: flex;
  flex-direction: column;
  gap: var(--gap-controls);
}

.statusRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--gap-section);
}

.row {
  display: grid;
  grid-template-columns: 90px 1fr 90px 1fr 90px 1fr;
  gap: var(--gap-controls);
  align-items: center;
}

.k {
  font-size: var(--fs-base);
  opacity: var(--opacity-muted);
}

.v {
  font-weight: var(--fw-semibold);
}

.v.warn {
  color: var(--warn);
  animation: flash-warn 1.2s ease-in-out infinite;
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


.offsetsPopover {
  top: 0;
  left: 100%;
  margin-left: 6px;
  min-width: 300px;
}
.offsetsPopover.open {
  display: flex !important;
  flex-direction: column;
  gap: var(--gap-tight);
}
.offsetTable { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }
.offsetTable th { text-align: right; padding: 2px 6px; color: color-mix(in oklab, var(--fg) 55%, transparent); font-weight: var(--fw-medium); }
.offsetTable td { text-align: right; padding: 2px 6px; font-family: var(--font-mono); }
.offsetTable .offLabel { text-align: left; font-weight: var(--fw-semibold); color: color-mix(in oklab, var(--fg) 80%, transparent); }
.offsetTable tbody tr { cursor: pointer; }
.offsetTable tbody tr:hover { background: color-mix(in oklab, var(--fg) 5%, transparent); }
.offsetTable .activeRow .offLabel { color: var(--info); }
.offsetTable .selectedRow { background: color-mix(in oklab, var(--info) 15%, transparent); outline: 1px solid color-mix(in oklab, var(--info) 40%, transparent); }
.offsetTable .g92Row, .offsetTable .toolRow { border-top: 1px solid color-mix(in oklab, var(--fg) 10%, transparent); cursor: default; }
.offsetTable .warn { color: var(--warn); }
.offsetTable .editableCell { cursor: cell; }
.offsetTable .editableCell:hover { background: color-mix(in oklab, var(--info) 10%, transparent); }
.offsetInput {
  width: 100%; box-sizing: border-box;
  background: var(--button-bg); border: 1px solid var(--info);
  color: var(--fg); text-align: right; font: inherit; padding: 0 4px;
  outline: none;
}
.offsetActions { display: flex; gap: var(--gap-tight); margin-top: var(--gap-controls); justify-content: flex-end; }

.overridesPopover {
  top: 0;
  left: 100%;
  margin-left: 6px;
  min-width: 260px;
  cursor: default;
}
.overridesPopover.open {
  display: flex !important;
  flex-direction: column;
  gap: var(--gap-controls);
}

.ovrRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
}

.ovrLabel {
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  opacity: var(--opacity-muted);
  min-width: 48px;
}

.ovrRow input[type="range"] {
  flex: 1;
  min-width: 0;
}



.ovrPresets {
  display: flex;
  gap: var(--gap-tight);
  padding-left: 56px;
  margin-bottom: var(--gap-tight);
}

.ovrResetBtn {
  margin-top: var(--gap-tight);
}

/* ---- Controls section (Spindle button + popover) ---- */
.controlBtns { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap-controls); position: relative; }
.controlGroup { }
.controlGroup--wide { grid-column: 1 / -1; }

.codesRow {
  position: relative;
}
.codesShort {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.codesRow .codesPopover {
  top: 100%;
  left: 0;
  margin-top: var(--gap-tight);
  min-width: 240px;
}
.codesRow:hover .codesPopover {
  display: flex !important;
  flex-direction: column;
  gap: var(--gap-controls);
}
.codesValue {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  word-break: break-word;
  line-height: 1.5;
}

.controlBtn {
  display: flex;
  align-items: center;
  justify-content: center;
}

.controlIcon { width: var(--fs-2xl); height: var(--fs-2xl); }

.spindlePopover {
  top: 0;
  left: 100%;
  margin-left: 6px;
  min-width: 280px;
}

.spindlePopover.open {
  display: flex !important;
  flex-direction: column;
  gap: var(--gap-section);
}

.spDirRow {
  display: flex;
  gap: var(--gap-controls);
  justify-content: center;
}

.spDirBtn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-tight);
  min-width: 64px;
}

.spDirIcon { font-size: var(--fs-2xl); line-height: 1; }
.spStopIcon { font-size: var(--fs-xl); line-height: 1.4; }

.spRpmRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
}

.spFieldLabel {
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  opacity: 0.8;
  min-width: 72px;
}

.spRpmInput {
  flex: 1;
  padding: 6px 10px;
  border-radius: var(--radius-xl);
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  max-width: 120px;
}

.spUnit {
  font-size: var(--fs-xs);
  font-weight: 400;
  opacity: var(--opacity-muted);
}

.spActualGroup {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
}

.spActualRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.spActualValue {
  font-family: var(--font-mono);
  font-size: var(--fs-xl);
  font-weight: var(--fw-bold);
}

.spCommandedValue {
  font-family: var(--font-mono);
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  opacity: var(--opacity-muted);
}

.spDirValue {
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  opacity: var(--opacity-muted);
}


/* ---- Coolant popover ---- */
.macroPopover {
  top: 0;
  left: 100%;
  margin-left: 6px;
  min-width: 180px;
}
.macroPopover.open {
  display: flex !important;
  flex-direction: column;
  gap: var(--gap-tight);
}
.macroBtn { width: 100%; text-align: left; }
.macroEmpty {
  font-size: var(--fs-sm);
  opacity: var(--opacity-disabled);
  text-align: center;
  padding: var(--gap-section);
}
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

.coolantPopover {
  top: 0;
  left: 100%;
  margin-left: 6px;
  min-width: 200px;
}
.coolantPopover.open {
  display: flex !important;
  flex-direction: column;
  gap: var(--gap-controls);
}
.coolantRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--gap-section);
}
.coolantLabel {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
}
.coolantToggle {
  min-width: 60px;
}

/* ---- Tool dialog ---- */
.toolDialogActions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--gap-controls) var(--gap-section);
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.toolDialogBody {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.toolInputRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
}
.toolFieldLabel {
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  opacity: 0.8;
  min-width: 48px;
}
.toolNumInput {
  flex: 1;
  padding: 6px 10px;
  border-radius: var(--radius-xl);
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  font-family: var(--font-mono);
  max-width: 80px;
  text-align: center;
}
.toolActions {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}
.controlBtn.simtrip {
  background: color-mix(in oklab, var(--accent) 15%, var(--button-bg));
  border-color: color-mix(in oklab, var(--accent) 30%, var(--border));
  color: var(--accent);
  font-style: italic;
}
.controlBtn.simtrip:disabled { color: var(--fg); background: var(--button-bg); border-color: var(--border); font-style: normal; }
.simtripGroup { grid-column: 1 / -1; }

/* ---- Settings dialog ---- */
.settingsDialogBody {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.toolStatusRow {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}
.toolStatusDot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-round);
  background: var(--border);
}
.toolStatusDot.probing {
  background: var(--warn);
  animation: pulse 0.8s ease-in-out infinite alternate;
}
.toolStatusDot.tripped {
  background: var(--ok);
}
.toolStatusText {
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
  opacity: var(--opacity-muted);
}

/* ---- Messages popover ---- */
.messagesPopover {
  top: 0;
  left: 100%;
  margin-left: 6px;
  min-width: 320px;
}
.messagesPopover.open {
  display: flex !important;
  flex-direction: column;
  gap: var(--gap-controls);
}
.msgPopEmpty { padding: 20px 0; text-align: center; font-size: var(--fs-base); opacity: var(--opacity-disabled); }

.msgPopList {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  max-height: 320px;
  overflow-y: auto;
}

.msgPopItem {
  display: flex;
  align-items: stretch;
  gap: var(--gap-controls);
  padding: 8px 10px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--border);
  background: var(--button-bg);
}

.msgPopIndicator { width: 3px; border-radius: var(--radius-sm); flex-shrink: 0; }
.msgPopItem.error .msgPopIndicator { background: var(--err); }
.msgPopItem.info .msgPopIndicator { background: var(--fg); opacity: var(--opacity-disabled); }
.msgPopItem.display .msgPopIndicator { background: var(--display); }

.msgPopBody { flex: 1; min-width: 0; }
.msgPopMeta { display: flex; align-items: center; gap: var(--gap-tight); margin-bottom: 2px; }
.msgPopBadge { font-size: var(--fs-2xs); font-weight: var(--fw-bold); padding: 1px 5px; border-radius: var(--radius-sm); letter-spacing: 0.5px; }
.msgPopBadge.error { background: color-mix(in oklab, var(--err) 20%, var(--panel)); color: var(--danger); }
.msgPopBadge.info { background: color-mix(in oklab, var(--fg) 10%, var(--panel)); color: var(--fg); opacity: var(--opacity-muted); }
.msgPopBadge.display { background: color-mix(in oklab, var(--display) 20%, var(--panel)); color: var(--display); }

.msgPopTime { font-size: var(--fs-xs); font-family: var(--font-mono); opacity: var(--opacity-muted); }
.msgPopText { font-size: var(--fs-base); line-height: 1.3; word-break: break-word; }
.msgPopItem .btn-icon { align-self: flex-start; font-size: var(--fs-xl); }

.btnrow {
  display: flex;
  gap: var(--gap-controls);
  flex-wrap: wrap;
  align-items: center;
}

.vsep {
  width: 1px;
  height: 26px;
  background: var(--border);
  margin: 0 2px;
}


.safetyBtn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-tight);
  padding: 12px 20px;
  min-width: 80px;
  font-size: var(--fs-xl);
}

.safetyIcon {
  font-size: var(--fs-3xl);
  line-height: 1;
  width: var(--fs-3xl);
  height: var(--fs-3xl);
}

.safetyLabel {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}


.hint {
  margin-top: var(--gap-controls);
  font-size: var(--fs-base);
  opacity: var(--opacity-muted);
}

.debugSection {
  margin-top: var(--gap-controls);
}

.pre {
  background: color-mix(in oklab, var(--panel) 50%, transparent);
  padding: 10px;
  border-radius: var(--radius-2xl);
  overflow: auto;
  font-size: var(--fs-sm);
  max-height: 400px;
}

.safetyDialog { z-index: 1010; }

/* ---- Landscape layout — panels side by side ---- */
@media (orientation: landscape) {
  .panels          { align-items: stretch; flex: 1; min-height: 0; overflow-x: auto; overflow-y: hidden; }
  .panel           { flex: 0 0 var(--panel-min-w); min-height: var(--panel-min-h); }
  .panel-viewer    { flex: 1; min-width: var(--panel-min-w-wide); overflow: hidden; }
  .panel-manual,
  .panel-probe { flex: 0.5; min-width: var(--panel-min-w-wide); }
  .panel-gcode,
  .panel-camera    { flex: 0.5; min-width: var(--panel-min-w); }
}

/* ---- Portrait layout — panels stacked vertically ---- */
@media (orientation: portrait) {
  .panels          { flex-direction: column; flex: 1; min-width: 0; min-height: 0; overflow: auto; }
  .panel           { flex: 0 0 auto; min-width: var(--panel-min-w-wide); }
  .panel-viewer    { flex: 1; min-height: var(--viewer-min-h-portrait); overflow: hidden; }
  .panel-gcode     { flex: 0 0 var(--panel-h-portrait); }
  .addPanel        { flex: 0 0 auto; width: 100%; height: 36px; }
}

/* ---- Responsive: tablet landscape / narrow desktop (768–1199px) ---- */
@media (max-width: 1199px) and (min-width: 768px) {
  .statusGroups {
    flex-wrap: wrap;
  }
  .statusGroup {
    min-width: calc(50% - 6px);
  }
}

</style>
