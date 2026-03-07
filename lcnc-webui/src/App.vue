<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, reactive, ref, watch } from "vue";
import { evaluatePermissions, PERMISSIONS_KEY } from "./permissions";
import { connectWs, connected, status, send, armed, lastReply, viewerGcode, viewerInit, lcncError, latency, networkLatency, messages, unreadCount, dismissMessage, clearAllMessages, markMessagesRead } from "./lcncWs";
import ThreeViewer from "./ThreeViewer.vue";
import Toolbar from "./Toolbar.vue";
import TabPanel from "./TabPanel.vue";
import ManualPanel from "./ManualPanel.vue";
import GcodePanel from "./GcodePanel.vue";
import SettingsPanel from "./SettingsPanel.vue";
import ToolTablePanel from "./ToolTablePanel.vue";
import ProbePanel from "./ProbePanel.vue";
import { loadViewerDefaults, loadPanelsDefaults, savePanelsDefaults, MAX_PANELS, loadMachineDefaults, loadDisplayDefaults, saveDisplayDefaults, type ThemeMode } from "./defaults";
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
  saveDisplayDefaults({ theme: mode });
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

onMounted(() => {
  connectWs();
  themeMql.addEventListener("change", onOsThemeChange);
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
  { id: "settings", label: "Settings" },
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

// Workpiece configuration (initialized from saved defaults)
const workpieceSize = ref<[number, number, number]>(_vd.workpieceSize);
const workpieceOffset = ref<[number, number, number]>(_vd.workpieceOffset);

// G-code viewer
const gcodeContent = ref<string | null>(null);

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

const canMachineOn = computed(
  () => armed.value && !isEstop.value && !isEnabled.value
);
const canMachineOff = computed(() => armed.value && isEnabled.value);

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
  if (_prevPerms &&
      _prevPerms.idle === next.idle && _prevPerms.jog === next.jog &&
      _prevPerms.override === next.override && _prevPerms.ready === next.ready &&
      _prevPerms.pause === next.pause && _prevPerms.resume === next.resume &&
      _prevPerms.abort === next.abort && _prevPerms.probe === next.probe &&
      _prevPerms.zero === next.zero) return _prevPerms;
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
  return rot != null && rot !== 0;
});

// Cycle chip value: "G54" → "ROT 45.0" / "Z 0.050" → "G54" when rotation or eoffset is active
const offsetCyclePhase = ref(false);
let _offsetCycleTimer: ReturnType<typeof setInterval> | null = null;
const hasOffsetWarning = computed(() => hasRotation.value || !!st.value.eoffset_enabled);

watch(hasOffsetWarning, (active) => {
  if (active && !_offsetCycleTimer) {
    _offsetCycleTimer = setInterval(() => { offsetCyclePhase.value = !offsetCyclePhase.value; }, 2000);
  } else if (!active) {
    if (_offsetCycleTimer) { clearInterval(_offsetCycleTimer); _offsetCycleTimer = null; }
    offsetCyclePhase.value = false;
  }
}, { immediate: true });

const offsetChipValue = computed(() => {
  if (st.value.eoffset_enabled && offsetCyclePhase.value) {
    const z = st.value.eoffset_z;
    return z != null ? `Z ${z.toFixed(3)}` : "COMP";
  }
  if (hasRotation.value && offsetCyclePhase.value) {
    return `ROT ${st.value.rotation_xy!.toFixed(1)}`;
  }
  return g5xLabel.value;
});

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
  if (!permissions.value.idle) return;
  editingCell.value = { wcs, axis };
  editValue.value = current.toFixed(4);
  nextTick(() => { offsetInputRef.value?.select(); });
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

function toggleChip(chip: string) { openChip.value = openChip.value === chip ? null : chip; }
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

function onDocClick(e: MouseEvent) {
  if (!openChip.value) return;
  const el = document.querySelector('.topRow');
  if (el && !el.contains(e.target as Node)) openChip.value = null;
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
const spindleDirection = computed(() => st.value.spindle_direction ?? null);

// Spindle popover state
const rpmInput = ref(1000);
const isForward = computed(() => spindleDirection.value === SPINDLE_FORWARD);
const isReverse = computed(() => spindleDirection.value === SPINDLE_REVERSE);
const isSpinning = computed(() => isForward.value || isReverse.value);
const spindleMismatch = computed(() =>
  !isSpinning.value && Math.abs(spindleActual.value ?? 0) > 1
);

// Spindle override slider (synced from status)
const spindleOvrSlider = ref(100);
watch(spindleOverrideValue, (val) => {
  if (Number.isFinite(val)) spindleOvrSlider.value = Math.round(val * 100);
});
function onSpindleOvrChange() { setSpindleOverride(spindleOvrSlider.value / 100); }
function setSpindleOvrPreset(percent: number) {
  spindleOvrSlider.value = percent;
  onSpindleOvrChange();
}

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
const toolTableRef = ref<InstanceType<typeof ToolTablePanel> | null>(null);
const toolNumber = ref(1);
const TS_TOOL_KEY = "lcnc-tool-number";

function loadToolNumber() {
  try {
    const raw = localStorage.getItem(TS_TOOL_KEY);
    if (raw) { toolNumber.value = parseInt(raw, 10) || 1; return; }
    // Migrate from old toolsetter params key
    const old = localStorage.getItem("lcnc-toolsetter-params");
    if (old) {
      const saved = JSON.parse(old);
      if (saved.toolNumber != null) toolNumber.value = saved.toolNumber;
    }
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

function measureManual() {
  if (!permissions.value.ready || st.value.probing) return;
  saveToolNumber();
  fire({ cmd: "mdi", text: `T${toolNumber.value} M601` });
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
  return new Date(ts).toLocaleTimeString();
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
const JOG_KEY_MAP: Record<string, { axis: number; dir: 1 | -1 }> = {
  ArrowLeft:  { axis: 0, dir: -1 },
  ArrowRight: { axis: 0, dir:  1 },
  ArrowUp:    { axis: 1, dir:  1 },
  ArrowDown:  { axis: 1, dir: -1 },
  PageUp:     { axis: 2, dir:  1 },
  PageDown:   { axis: 2, dir: -1 },
};

// Dynamic rotary jog keys: [ ] for first rotary axis, ; ' for second
const ROTARY_LETTERS = new Set(["A", "B", "C", "U", "V", "W"]);
const ROTARY_KEY_PAIRS: [string, string][] = [["[", "]"], [";", "'"]];
const rotaryJogKeys = computed(() => {
  const rotary = axes.value.filter(l => ROTARY_LETTERS.has(l));
  const map: Record<string, { axis: number; dir: 1 | -1 }> = {};
  for (let r = 0; r < Math.min(rotary.length, ROTARY_KEY_PAIRS.length); r++) {
    const letter = rotary[r];
    const pair = ROTARY_KEY_PAIRS[r];
    if (!letter || !pair) continue;
    const idx = axes.value.indexOf(letter);
    const [neg, pos] = pair;
    map[neg] = { axis: idx, dir: -1 };
    map[pos] = { axis: idx, dir:  1 };
  }
  return map;
});
const jogKeys = reactive(new Set<string>());

function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function onKeyDown(e: KeyboardEvent) {
  // E-stop: ALWAYS works, even in inputs
  if (e.key === "Escape") {
    e.preventDefault();
    if (canEstop.value) send({ cmd: "estop" });
    else if (canResetEstop.value) send({ cmd: "estop_reset" });
    return;
  }

  // Everything else skipped when typing in inputs
  if (isInputFocused()) return;

  // Jog keys (hold-to-jog or increment)
  const isRotaryKey = !!rotaryJogKeys.value[e.key];
  const jog = JOG_KEY_MAP[e.key] ?? rotaryJogKeys.value[e.key];
  if (jog) {
    e.preventDefault();
    if (e.repeat || jogKeys.has(e.key)) return;
    if (!permissions.value.jog) return;
    jogKeys.add(e.key);
    const vel = isRotaryKey ? angularJogVel.value : jogVel.value;
    const v = vel * jog.dir;
    if (jogIncrement.value > 0) {
      send({ cmd: "jog_incr", axis: jog.axis, vel: v, distance: jogIncrement.value * jog.dir });
    } else {
      send({ cmd: "jog_cont", axis: jog.axis, vel: v });
    }
    return;
  }

  // Space: cycle start / pause / resume
  if (e.key === " ") {
    e.preventDefault();
    if (permissions.value.resume) fire({ cmd: "cycle_resume" });
    else if (permissions.value.pause) fire({ cmd: "cycle_pause" });
    else if (permissions.value.ready && !!activeFile.value) fire({ cmd: "cycle_start" });
    return;
  }

  // Backtick: abort
  if (e.key === "`") {
    e.preventDefault();
    if (permissions.value.abort) fire({ cmd: "abort" });
    return;
  }
}

function onKeyUp(e: KeyboardEvent) {
  const jog = JOG_KEY_MAP[e.key] ?? rotaryJogKeys.value[e.key];
  if (jog && jogKeys.has(e.key)) {
    jogKeys.delete(e.key);
    if (jogIncrement.value <= 0) {
      send({ cmd: "jog_stop", axis: jog.axis });
    }
  }
}

/** ---------- safety: stop jog on focus loss ---------- */
function stopAllJog() {
  jogKeys.clear();
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
  document.addEventListener("click", onDocClick);
});

onUnmounted(() => {
  window.removeEventListener("blur", stopAllJog);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("visibilitychange", visHandler);
  themeMql.removeEventListener("change", onOsThemeChange);
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

function requestProbeResults() {
  send({ cmd: "get_probe_results" });
}

// Listen for get_probe_results reply
watch(lastReply, (r: any) => {
  if (r?.ok && r.points) surfacePoints.value = r.points;
}, { flush: "sync" });

/** ---------- G-code content watcher ---------- */
watch(viewerGcode, (newGcode) => {
  console.log("viewerGcode updated:", newGcode);
  if (newGcode?.content) {
    gcodeContent.value = newGcode.content;
  } else {
    gcodeContent.value = null;
  }
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

        <div v-if="connected && networkLatency != null" class="pill">
          Net {{ networkLatency }}ms
        </div>
        <div v-if="connected && latency != null" class="pill">
          RT {{ latency }}ms
        </div>

        <div class="pill" :class="lcncError ? 'bad' : (configName ? 'ok' : '')">
          {{ lcncLabel }}
        </div>

        <div class="pill" :class="armed ? 'armed' : 'disarmed'">
          {{ armed ? "ARMED" : "DISARMED" }}
        </div>
      </div>
    </header>

    <div v-if="bannerLevel !== 'none'" class="statusBanner" :class="bannerLevel">
      {{ bannerText }}
      <button v-if="bannerLevel === 'refresh'" class="btn" @click="reloadPage">Refresh</button>
    </div>

    <!-- Body: sidebar (safety+status) + main content -->
    <div class="bodyLayout">

    <!-- Machine Safety + Status -->
    <div class="topRow">
    <section class="card">
      <div class="sub">Machine Safety</div>
      <div class="btnrow">
        <button class="btn safetyBtn" :class="{ danger: armed }" @click="arm(!armed)" :disabled="busy">
          <span class="safetyIcon">{{ armed ? "\u{1F513}" : "\u{1F512}" }}</span>
          <span class="safetyLabel">{{ armed ? "Disarm" : "Arm" }}</span>
        </button>

        <div class="vsep"></div>

        <button
          class="btn safetyBtn"
          :class="isEstop ? '' : 'danger'"
          @click="send({ cmd: isEstop ? 'estop_reset' : 'estop' })"
          :disabled="!(isEstop ? canResetEstop : canEstop)"
        >
          <span class="safetyIcon">&#x26A0;</span>
          <span class="safetyLabel">{{ isEstop ? "Reset E-Stop" : "E-Stop" }}</span>
        </button>

        <div class="vsep"></div>

        <button
          class="btn safetyBtn"
          :class="{ danger: isEnabled }"
          @click="fire({ cmd: isEnabled ? 'machine_off' : 'machine_on' })"
          :disabled="!(isEnabled ? canMachineOff : canMachineOn) || busy"
        >
          <span class="safetyIcon">&#x23FB;</span>
          <span class="safetyLabel">{{ isEnabled ? "Machine Off" : "Machine On" }}</span>
        </button>
      </div>
    </section>

    <section class="card topStatus">
      <div class="sub">Machine Status</div>

      <div class="compactStatus">
        <div class="statusChip" :class="isEstop ? 'bad' : (isEnabled && isHomed ? 'ok' : '')" @click.stop="toggleChip('machine')">
          <span class="chipIcon">&#x2699;</span>
          <span class="label">Machine</span>
          <span class="chipValue">{{ isEstop ? 'E-STOP' : (!isEnabled ? 'OFF' : (!isHomed ? 'NOT HOMED' : 'READY')) }}</span>
          <div class="popover chipPopover" :class="{ open: openChip === 'machine' }">
            <div class="statusRow"><div class="k">E-Stop</div><div class="v" :class="isEstop ? 'badText' : 'okText'">{{ isEstop ? 'TRUE' : 'FALSE' }}</div></div>
            <div class="statusRow"><div class="k">Enabled</div><div class="v" :class="isEnabled ? 'okText' : 'mutedText'">{{ isEnabled ? 'TRUE' : 'FALSE' }}</div></div>
            <div class="statusRow"><div class="k">Homed</div><div class="v" :class="isHomed ? 'okText' : 'badText'">{{ isHomed ? 'TRUE' : 'FALSE' }}</div></div>
            <div class="statusRow"><div class="k">Motion</div><div class="v">{{ isTeleop ? 'WORLD' : 'JOINT' }}</div></div>
            <button
              class="btn popoverAction"
              :class="{ primary: !isHomed }"
              :disabled="!permissions.idle"
              @click="isHomed ? unhomeAll() : homeAll()"
            >{{ isHomed ? 'Unhome' : 'Home All' }}</button>
          </div>
        </div>

        <div class="statusChip" :class="isRunning ? 'ok' : (isPaused ? 'warn' : '')" @click.stop="toggleChip('program')">
          <span class="chipIcon">&#x25B6;</span>
          <span class="label">Program</span>
          <span class="chipValue">{{ isRunning ? 'RUNNING' : (isPaused ? 'PAUSED' : 'IDLE') }}</span>
          <div class="popover chipPopover programPopover" :class="{ open: openChip === 'program' }">
            <div class="statusRow"><div class="k">Task Mode</div><div class="v">{{ taskModeLabel }}</div></div>
            <div class="statusRow"><div class="k">Interpreter</div><div class="v">{{ interpStateLabel }}</div></div>
            <div class="statusRow"><div class="k">Elapsed</div><div class="v mono">{{ elapsedDisplay }}</div></div>
            <div class="statusRow"><div class="k">G-codes</div><div class="v codes">{{ activeGcodes }}</div></div>
            <div class="statusRow"><div class="k">M-codes</div><div class="v codes">{{ activeMcodes }}</div></div>
          </div>
        </div>

        <div class="statusChip" :class="{ warn: hasOffsetWarning }" @click.stop="openOffsetsPopover()">
          <span class="label">Offsets</span>
          <span class="chipValue">{{ offsetChipValue }}</span>
          <div class="popover chipPopover offsetsPopover" :class="{ open: openChip === 'offsets' }" @click.stop>
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
                      :class="{ warn: axis === 'r' && row[axis] !== 0, editableCell: permissions.idle }"
                      @dblclick.stop="startEditCell(row.name, axis, Number(row[axis]) || 0)">
                    <input v-if="editingCell?.wcs === row.name && editingCell?.axis === axis"
                           ref="offsetInputRef"
                           v-model="editValue"
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
              <button class="ovrPresetBtn" :disabled="!permissions.idle || !selectedWcs" @click="clearWcs(selectedWcs!)">Clear {{ selectedWcs }}</button>
              <button class="ovrPresetBtn" :disabled="!permissions.idle" @click="clearWcs('all')">Clear All</button>
            </div>
          </div>
        </div>

        <div class="statusChip overridesChip" :class="{ warn: overridesActive && !overridesDisabled, bad: overridesDisabled }" @click.stop="toggleChip('overrides')">
          <span class="chipIcon">%</span>
          <span class="label">Overrides</span>
          <span class="chipValue">{{ overridesDisabled ? 'DISABLED' : (overridesActive ? 'ACTIVE' : 'DEFAULT') }}</span>
          <div class="popover chipPopover overridesPopover" :class="{ open: openChip === 'overrides' }" @click.stop>
            <div class="ovrRow">
              <span class="ovrLabel">Feed</span>
              <input type="range" v-model.number="feedSlider" @change="onFeedChange" min="0" :max="maxFeedOverride" step="5" :disabled="!permissions.override || !feedOvrEnabled" />
              <span class="ovrVal" :class="{ warn: feedSlider !== 100 }">{{ feedSlider }}%</span>
            </div>
            <div class="ovrPresets">
              <button v-for="p in [50, 100, 150, 200]" :key="'f'+p" class="ovrPresetBtn" :disabled="!permissions.override || !feedOvrEnabled" @click="setOverridePreset('feed', p)">{{ p }}%</button>
            </div>
            <div class="ovrRow">
              <span class="ovrLabel">Spindle</span>
              <input type="range" v-model.number="spindleSlider" @change="onSpindleSliderChange" :min="minSpindleOverride" :max="maxSpindleOverride" step="5" :disabled="!permissions.override || !spindleOvrEnabled" />
              <span class="ovrVal" :class="{ warn: spindleSlider !== 100 }">{{ spindleSlider }}%</span>
            </div>
            <div class="ovrPresets">
              <button v-for="p in [50, 100, 150, 200]" :key="'s'+p" class="ovrPresetBtn" :disabled="!permissions.override || !spindleOvrEnabled" @click="setOverridePreset('spindle', p)">{{ p }}%</button>
            </div>
            <div class="ovrRow">
              <span class="ovrLabel">Rapid</span>
              <input type="range" v-model.number="rapidSlider" @change="onRapidChange" min="25" max="100" step="25" :disabled="!permissions.override" />
              <span class="ovrVal" :class="{ warn: rapidSlider !== 100 }">{{ rapidSlider }}%</span>
            </div>
            <div class="ovrPresets">
              <button v-for="p in [25, 50, 75, 100]" :key="'r'+p" class="ovrPresetBtn" :disabled="!permissions.override" @click="setOverridePreset('rapid', p)">{{ p }}%</button>
            </div>
            <button class="ovrResetBtn" :disabled="!permissions.override" @click="resetAllOverrides">Reset All</button>
          </div>
        </div>

        <div class="statusChip" :class="{ warn: unreadCount > 0 }" @click.stop="toggleChip('messages')">
          <span class="label">Messages</span>
          <span class="chipValue">{{ unreadCount > 0 ? unreadCount : 'NONE' }}</span>
          <div class="popover chipPopover messagesPopover" :class="{ open: openChip === 'messages' }" @click.stop>
            <div class="msgPopHeader">
              <span class="msgPopTitle">Messages</span>
              <button v-if="messages.length > 0" class="ovrPresetBtn" @click="clearAllMessages">Clear All</button>
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
                <button class="btn-icon" @click="dismissMessage(msg.id)">&times;</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="sub">Controls</div>
      <div class="controlBtns">
        <div class="controlGroup">
        <button
          class="btn controlBtn"
          :class="{ active: isSpinning, warn: spindleMismatch }"
          @click.stop="toggleChip('spindle')"
        >
          <span class="controlIcon">&#x2699;</span>
          <span class="label">Spindle</span>
          <span class="controlStatus">{{ isSpinning ? ((isForward ? '+' : '-') + Math.round(Math.abs(spindleActual ?? 0)) + ' RPM') : spindleMismatch ? (Math.round(Math.abs(spindleActual ?? 0)) + ' RPM!') : 'OFF' }}</span>
        </button>
        <div class="popover spindlePopover" :class="{ open: openChip === 'spindle' }" @click.stop>
          <!-- Direction controls -->
          <div class="spDirRow">
            <button
              class="btn spDirBtn"
              :class="{ active: isReverse }"
              :disabled="!permissions.ready"
              @click="spindleReverse(rpmInput)"
              title="Spindle Reverse (CCW)"
            >
              <span class="spDirIcon">&#x21BA;</span>
              <span class="label">Rev</span>
            </button>
            <button
              class="btn spDirBtn spStopBtn"
              :class="{ active: isSpinning }"
              :disabled="!permissions.ready"
              @click="spindleStop()"
              title="Spindle Stop"
            >
              <span class="spStopIcon">&#x25A0;</span>
              <span class="label">Stop</span>
            </button>
            <button
              class="btn spDirBtn"
              :class="{ active: isForward }"
              :disabled="!permissions.ready"
              @click="spindleForward(rpmInput)"
              title="Spindle Forward (CW)"
            >
              <span class="spDirIcon">&#x21BB;</span>
              <span class="label">Fwd</span>
            </button>
          </div>

          <!-- RPM input -->
          <div class="spRpmRow">
            <span class="spFieldLabel">Speed</span>
            <input
              type="number"
              class="spRpmInput"
              v-model.number="rpmInput"
              :min="minSpindleSpeed"
              :max="maxSpindleSpeed"
              step="100"
              :disabled="!permissions.ready"
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
          </div>

          <!-- Speed override slider -->
          <div class="spOvrGroup">
            <div class="spOvrHeader">
              <span>Speed Override</span>
              <span class="spOvrValue" :class="{ warn: spindleOvrSlider !== 100 }">{{ spindleOvrSlider }}%</span>
            </div>
            <input
              type="range"
              class="spOvrSlider"
              v-model.number="spindleOvrSlider"
              @change="onSpindleOvrChange"
              :min="minSpindleOverride"
              :max="maxSpindleOverride"
              step="5"
              :disabled="!permissions.override || !spindleOvrEnabled"
            />
            <div class="spOvrPresets">
              <button v-for="p in [50, 100, 150, 200]" :key="'sp'+p" class="ovrPresetBtn" :disabled="!permissions.override || !spindleOvrEnabled" @click="setSpindleOvrPreset(p)">{{ p }}%</button>
            </div>
          </div>
        </div>
        </div>

        <div class="controlGroup">
        <button
          class="btn controlBtn"
          :class="{ active: coolantActive }"
          @click.stop="toggleChip('coolant')"
        >
          <span class="controlIcon">&#x1F4A7;</span>
          <span class="label">Coolant</span>
          <span class="controlStatus">{{ coolantActive ? (floodOn && mistOn ? 'BOTH' : (floodOn ? 'FLOOD' : 'MIST')) : 'OFF' }}</span>
        </button>
        <div class="popover coolantPopover" :class="{ open: openChip === 'coolant' }" @click.stop>
          <div class="coolantRow">
            <span class="coolantLabel">Flood</span>
            <button
              class="btn coolantToggle"
              :class="floodOn ? 'active' : ''"
              :disabled="!permissions.override"
              @click="toggleFlood"
            >{{ floodOn ? 'ON' : 'OFF' }}</button>
          </div>
          <div class="coolantRow">
            <span class="coolantLabel">Mist</span>
            <button
              class="btn coolantToggle"
              :class="mistOn ? 'active' : ''"
              :disabled="!permissions.override"
              @click="toggleMist"
            >{{ mistOn ? 'ON' : 'OFF' }}</button>
          </div>
        </div>
        </div>

        <div class="controlGroup">
        <button
          class="btn controlBtn"
          :class="{ active: !!st.probing }"
          @click.stop="toolDialogOpen = true"
        >
          <span class="controlIcon">&#x1F527;</span>
          <span class="label">Tool</span>
          <span class="controlStatus">{{ st.tool_number != null ? `T${st.tool_number}` : '---' }}{{ st.tool_diameter != null ? ` D${st.tool_diameter.toFixed(3)}` : '' }}{{ st.tool_offset?.[2] ? ` Z${st.tool_offset[2].toFixed(3)}` : '' }}</span>
        </button>
        </div>
        <div class="controlGroup">
        <button class="btn controlBtn simtrip" :disabled="!st.probing" @click.stop="send({ cmd: 'simulate_probe_trip' })" title="Simulate probe contact (sim/debug)">Sim Trip</button>
        </div>
      </div>
    </section>
    </div>

    <!-- Main content column -->
    <div class="mainCol">

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
              @toggleLayer="(l: string, on: boolean) => viewerRefs.get(panel.id)?.setLayerVisible?.(l, on)"
              @setPathOnTop="(on: boolean) => viewerRefs.get(panel.id)?.setPathAlwaysOnTop?.(on)"
              @setTrackMode="(m: string) => viewerRefs.get(panel.id)?.setTrackingMode?.(m)"
              @toggleProjection="viewerRefs.get(panel.id)?.switchProjection?.()"
              :workpieceSize="workpieceSize"
              :workpieceOffset="workpieceOffset"
              @update:workpieceSize="workpieceSize = $event"
              @update:workpieceOffset="workpieceOffset = $event"
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
                :maxJogVel="maxJogVel"
                :maxAngularJogVel="maxAngularJogVel"
                :minAngularJogVel="minAngularJogVel"
                :jogIncrement="jogIncrement"
                :minJogVel="minJogVel"
                :iniIncrements="iniIncrements"
                :gcodeContent="gcodeContent"
                :currentLine="currentLine"
                :isPaused="isPaused"
                :elapsed="elapsedDisplay"
                :activeFile="activeFile"
                :spindleSpeed="spindleSpeed"
                :spindleActual="spindleActual"
                :spindleDirection="spindleDirection"
                :surfacePoints="surfacePoints"
                :axes="axes"
                :touchoff="touchoff"
                :optionalStop="optionalStopOn"
                :blockDelete="blockDeleteOn"
                @update:touchoff="touchoff = $event"
                @update:jogVel="jogVel = $event"
                @update:angularJogVel="angularJogVel = $event"
                @update:jogIncrement="jogIncrement = $event"
                @cycleStart="cycleStart"
                @runFromLine="runFromLine"
                @cycleStep="cycleStep"
                @cyclePause="cyclePause"
                @cycleResume="cycleResume"
                @abort="fire({ cmd: 'abort' })"
                @homeAll="homeAll"
                @unhomeAll="unhomeAll"
                @setAxis="setAxis"
                @setAll="setAll"
                @toggleOptionalStop="toggleOptionalStop"
                @toggleBlockDelete="toggleBlockDelete"
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
              :activeJogKeys="jogKeys"
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
              :currentLine="currentLine"
              :isPaused="isPaused"
              :elapsed="elapsedDisplay"
              :optionalStop="optionalStopOn"
              :blockDelete="blockDeleteOn"
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
              @mdi="send({ cmd: 'mdi', text: $event })"
              @abort="send({ cmd: 'abort' })"
              @setProbeVars="send({ cmd: 'set_probe_vars', vars: $event })"
              @setG5x="setG5x"
              @getProbeResults="requestProbeResults"
              @setCompensation="requestCompToggle"
              @setCompMethod="send({ cmd: 'set_compensation_method', method: $event })"
              @clearSurfaceMap="surfacePoints = null"
            />
          </template>

          <template #settings>
            <SettingsPanel :lastReply="lastReply" :status="status" @setProbeVars="send({ cmd: 'set_probe_vars', vars: $event })" @mdi="send({ cmd: 'mdi', text: $event })" />
          </template>
        </TabPanel>
      </div>

      <button
        v-if="panels.length < MAX_PANELS"
        class="addPanel"
        @click="addPanel"
      >+</button>
    </div>


    </div><!-- /mainCol -->
    </div><!-- /bodyLayout -->

    <!-- Tool table dialog -->
    <div v-if="toolDialogOpen" class="dialogOverlay" @click.self="toolDialogOpen = false">
      <div class="dialog lg toolDialogSize">
        <div class="dialogHeader">
          <span class="dialogTitle">Tool Table</span>
          <button class="btn-icon" @click="toolDialogOpen = false">&times;</button>
        </div>
        <div class="toolDialogActions">
          <div class="toolInputRow">
            <span class="toolFieldLabel">Tool #</span>
            <input
              type="number"
              class="toolNumInput"
              v-model.number="toolNumber"
              min="1"
              step="1"
              :disabled="!permissions.ready || !!st.probing"
              @change="saveToolNumber"
            />
          </div>
          <div class="toolActions">
            <button class="btn toolActionBtn measure" :disabled="!permissions.ready || !!st.probing" @click="measureAuto">Measure</button>
            <button class="btn toolActionBtn" :disabled="!permissions.ready || !!st.probing" @click="measureManual">Manual</button>
            <button class="btn toolActionBtn load" :disabled="!permissions.ready || !!st.probing" @click="loadTool">Load</button>
            <button class="btn toolActionBtn abort" :disabled="!st.probing" @click="fire({ cmd: 'abort' })">Abort</button>
          </div>
          <div class="toolActions">
            <button class="btn toolActionBtn" :disabled="!permissions.idle" @click="toolTableRef?.openAdd()">+ Add</button>
            <button class="btn toolActionBtn" @click="toolTableRef?.triggerImport()">Import</button>
            <button class="btn toolActionBtn" :disabled="!permissions.idle" @click="toolTableRef?.fetchTools()">Refresh</button>
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

    <!-- Safety confirmation dialogs — z-index 1010 to always appear above other dialogs -->
    <div v-if="toolChangeRequested" class="dialogOverlay safetyDialog">
      <div class="dialog">
        <div class="dialogTitle">Load Tool into Spindle</div>
        <div class="dialogBody">
          <strong>T{{ toolChangeTool }}</strong><template v-if="st.tool_change_info"> D{{ st.tool_change_info.D.toFixed(3) }} Z{{ st.tool_change_info.Z.toFixed(3) }}</template><br>
          <template v-if="st.tool_change_info?.description">{{ st.tool_change_info.description }}<br></template>
          Insert tool and press Confirm
        </div>
        <div class="dialogActions">
          <button class="btn danger" @click="send({ cmd: 'abort' })">Cancel</button>
          <button class="btn primary" :disabled="!armed" @click="confirmToolChange">
            Confirm
          </button>
        </div>
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
        <div class="dialogActions">
          <button class="btn danger" @click="cancelCompToggle">Cancel</button>
          <button class="btn primary" @click="confirmCompToggle">Confirm</button>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.wrap {
  --sidebar-total: 178px; /* 16px wrap padding + 150px sidebar + 12px gap */
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 16px;
  font-family: var(--font-sans);
}

.hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  margin-bottom: 14px;
  gap: 12px;
}

.hdrRight {
  display: flex;
  gap: 10px;
  align-items: center;
}

.title {
  font-size: var(--fs-2xl);
  font-weight: 700;
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
  gap: 12px;
  margin-bottom: 12px;
  overflow: hidden;
}

.panel {
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius-3xl);
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
  border-radius: var(--radius-3xl);
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--fg);
  font-size: var(--fs-2xl);
  opacity: 0.4;
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
  gap: 12px;
  padding: 8px 14px;
  min-height: 40px;
  color: var(--fg);
  font-size: var(--fs-md);
  font-weight: 500;
  flex-shrink: 0;
}

.statusBanner.error {
  background: color-mix(in oklab, var(--danger) 25%, var(--panel));
}

.statusBanner.refresh {
  background: color-mix(in oklab, var(--active-tool) 20%, var(--panel));
}

.bodyLayout {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 12px;
}

.mainCol {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.topRow {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 150px;
  gap: 12px;
  position: relative;
  z-index: 1001;  /* above dialog overlays (z-index: 1000) so safety buttons stay accessible */
}

.topRow > .card {
  margin-bottom: 0;
}

.topRow .btnrow {
  flex-direction: column;
  gap: 8px;
}

.topRow .safetyBtn {
  width: 100%;
  padding: 8px 10px;
  min-width: 0;
}

.topRow .vsep {
  width: 100%;
  height: 1px;
  margin: 0;
}

.topRow .compactStatus {
  flex-direction: column;
}

.topRow .statusChip {
  min-width: 0;
}

.card {
  border: 1px solid var(--border);
  border-radius: var(--radius-3xl);
  padding: 12px;
  margin-bottom: 12px;
  background: var(--panel);
  color: var(--fg);
}


.statusGroups {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
}

.statusGroup {
  flex: 1;
  padding: 12px;
  border: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
  border-radius: var(--radius-xl);
  background: color-mix(in oklab, var(--panel) 30%, transparent);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.statusRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.row {
  display: grid;
  grid-template-columns: 90px 1fr 90px 1fr 90px 1fr;
  gap: 8px;
  align-items: center;
}

.k {
  font-size: var(--fs-base);
  opacity: 0.7;
}

.v {
  font-weight: 600;
}

.v.codes {
  text-align: right;
  word-break: break-word;
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
  opacity: 0.7;
}

.compactStatus {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.statusChip {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 14px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--border);
  background: var(--button-bg);
  cursor: default;
  flex: 1;
  min-width: 100px;
  transition: background 0.12s, border-color 0.12s;
}

.statusChip:hover {
  background: var(--hl-hover);
}

.statusChip.ok { border-color: color-mix(in srgb, var(--ok) 50%, transparent); background: color-mix(in oklab, var(--ok) 20%, var(--button-bg)); }
.statusChip.bad { border-color: color-mix(in srgb, var(--danger) 50%, transparent); background: color-mix(in oklab, var(--danger) 20%, var(--button-bg)); }
.statusChip.warn { border-color: color-mix(in srgb, var(--warn) 50%, transparent); animation: flash-chip-warn 1.2s ease-in-out infinite; }

@keyframes flash-chip-warn {
  0%, 100% { background: color-mix(in oklab, var(--warn) 25%, var(--button-bg)); }
  50% { background: color-mix(in oklab, var(--warn) 10%, var(--button-bg)); }
}

.chipIcon { display: none; font-size: var(--fs-xl); }
.chipValue { font-size: var(--fs-md); font-weight: 600; }

.chipPopover {
  top: 0;
  left: 100%;
  margin-left: 6px;
  min-width: 200px;
}

/* All status chip popovers: click-to-toggle */
.statusChip { cursor: pointer; }
.chipPopover.open {
  display: flex !important;
  flex-direction: column;
  gap: 6px;
}

.popoverAction {
  margin-top: 4px;
  width: 100%;
  padding: 8px;
  font-size: var(--fs-base);
  font-weight: 600;
}
.popoverAction.primary {
  background: color-mix(in oklab, var(--ok) 20%, var(--button-bg));
}

.programPopover {
  min-width: 300px;
}

.offsetsPopover { min-width: 300px; }
.offsetTable { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }
.offsetTable th { text-align: right; padding: 2px 6px; color: color-mix(in oklab, var(--fg) 55%, transparent); font-weight: 500; }
.offsetTable td { text-align: right; padding: 2px 6px; font-family: var(--font-mono); }
.offsetTable .offLabel { text-align: left; font-weight: 600; color: color-mix(in oklab, var(--fg) 80%, transparent); }
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
.offsetActions { display: flex; gap: 6px; margin-top: 8px; justify-content: flex-end; }

.overridesPopover {
  min-width: 260px;
  cursor: default;
  gap: 8px;
}

.ovrRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ovrLabel {
  font-size: var(--fs-base);
  font-weight: 500;
  opacity: 0.7;
  min-width: 48px;
}

.ovrRow input[type="range"] {
  flex: 1;
  min-width: 0;
}

.ovrVal {
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  font-weight: 600;
  min-width: 40px;
  text-align: right;
}

.ovrPresets {
  display: flex;
  gap: 4px;
  padding-left: 56px;
  margin-bottom: 4px;
}

.ovrPresetBtn {
  padding: 2px 8px;
  font-size: var(--fs-xs);
  border-radius: var(--radius-md);
}

.ovrResetBtn {
  margin-top: 4px;
  padding: 5px 10px;
  font-size: var(--fs-sm);
  font-weight: 600;
  border-radius: var(--radius-lg);
  width: 100%;
}

/* ---- Controls section (Spindle button + popover) ---- */
.controlBtns { display: flex; flex-direction: column; gap: 8px; }
.controlGroup { position: relative; }

.controlBtn {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
}

.controlBtn.active {
  border-color: color-mix(in srgb, var(--ok) 50%, transparent);
  background: color-mix(in oklab, var(--ok) 20%, var(--button-bg));
}
.controlBtn.warn {
  border-color: color-mix(in srgb, var(--danger) 50%, transparent);
  background: color-mix(in oklab, var(--danger) 20%, var(--button-bg));
  animation: pulse-warn 1s ease-in-out infinite;
}
@keyframes pulse-warn {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.controlIcon { font-size: var(--fs-2xl); }
.controlStatus { font-size: var(--fs-base); font-weight: 600; }

.spindlePopover {
  top: 0;
  left: 100%;
  margin-left: 6px;
  min-width: 280px;
}

.spindlePopover.open {
  display: flex !important;
  flex-direction: column;
  gap: 12px;
}

.spDirRow {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.spDirBtn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 14px;
  border-radius: var(--radius-xl);
  min-width: 64px;
}

.spDirBtn.active {
  background: color-mix(in oklab, var(--ok) 30%, var(--panel));
  border-color: color-mix(in srgb, var(--ok) 50%, transparent);
}

.spStopBtn.active {
  background: color-mix(in oklab, var(--danger) 30%, var(--panel));
  border-color: color-mix(in srgb, var(--danger) 50%, transparent);
}

.spDirIcon { font-size: var(--fs-2xl); line-height: 1; }
.spStopIcon { font-size: var(--fs-xl); line-height: 1.4; }

.spRpmRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spFieldLabel {
  font-size: var(--fs-base);
  font-weight: 500;
  opacity: 0.8;
  min-width: 72px;
}

.spRpmInput {
  flex: 1;
  padding: 6px 10px;
  border-radius: var(--radius-xl);
  font-size: var(--fs-md);
  font-weight: 600;
  max-width: 120px;
}

.spUnit {
  font-size: var(--fs-xs);
  font-weight: 400;
  opacity: 0.6;
}

.spActualGroup {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.spActualRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.spActualValue {
  font-family: var(--font-mono);
  font-size: var(--fs-xl);
  font-weight: 700;
}

.spCommandedValue {
  font-family: var(--font-mono);
  font-size: var(--fs-md);
  font-weight: 600;
  opacity: 0.7;
}

.spDirValue {
  font-size: var(--fs-base);
  font-weight: 600;
  opacity: 0.7;
}

.spOvrGroup {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.spOvrHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--fs-base);
}

.spOvrHeader span:first-child {
  font-weight: 500;
  opacity: 0.8;
}

.spOvrValue {
  font-family: var(--font-mono);
  font-size: var(--fs-md);
  font-weight: 600;
}

.spOvrSlider { width: 100%; }

.spOvrPresets {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

/* ---- Coolant popover ---- */
.coolantPopover {
  top: 0;
  left: 100%;
  margin-left: 6px;
  min-width: 200px;
}
.coolantPopover.open {
  display: flex !important;
  flex-direction: column;
  gap: 10px;
}
.coolantRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.coolantLabel {
  font-size: var(--fs-md);
  font-weight: 600;
}
.coolantToggle {
  min-width: 60px;
  padding: 6px 14px;
  font-size: var(--fs-base);
  font-weight: 600;
  border-radius: var(--radius-xl);
}
.coolantToggle.active {
  border-color: color-mix(in srgb, var(--ok) 50%, transparent);
  background: color-mix(in oklab, var(--ok) 25%, var(--button-bg));
}

/* ---- Tool dialog ---- */
.toolDialogSize { height: 75vh; }
.toolDialogActions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.toolDialogBody {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0 12px 12px;
}
.toolInputRow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toolFieldLabel {
  font-size: var(--fs-base);
  font-weight: 500;
  opacity: 0.8;
  min-width: 48px;
}
.toolNumInput {
  flex: 1;
  padding: 6px 10px;
  border-radius: var(--radius-xl);
  font-size: var(--fs-lg);
  font-weight: 600;
  font-family: var(--font-mono);
  max-width: 80px;
  text-align: center;
}
.toolActions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.toolActionBtn {
  padding: 7px 10px;
  font-size: var(--fs-base);
  font-weight: 600;
  border-radius: var(--radius-xl);
}
.toolActionBtn.measure {
  background: color-mix(in oklab, var(--ok) 20%, var(--button-bg));
  border-color: color-mix(in oklab, var(--ok) 30%, var(--border));
  color: var(--ok);
}
.toolActionBtn.measure:disabled { color: var(--fg); background: var(--button-bg); border-color: var(--border); }
.toolActionBtn.load {
  background: color-mix(in oklab, var(--info) 20%, var(--button-bg));
  border-color: color-mix(in oklab, var(--info) 30%, var(--border));
  color: var(--info);
}
.toolActionBtn.load:disabled { color: var(--fg); background: var(--button-bg); border-color: var(--border); }
.toolActionBtn.abort {
  background: color-mix(in oklab, var(--danger) 20%, var(--button-bg));
  border-color: color-mix(in oklab, var(--danger) 30%, var(--border));
  color: var(--danger);
}
.toolActionBtn.abort:disabled { color: var(--fg); background: var(--button-bg); border-color: var(--border); }
.controlBtn.simtrip {
  background: color-mix(in oklab, var(--accent) 15%, var(--button-bg));
  border-color: color-mix(in oklab, var(--accent) 30%, var(--border));
  color: var(--accent);
  font-style: italic;
}
.controlBtn.simtrip:disabled { color: var(--fg); background: var(--button-bg); border-color: var(--border); font-style: normal; }
.toolStatusRow {
  display: flex;
  align-items: center;
  gap: 6px;
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
  opacity: 0.7;
}

/* ---- Messages popover ---- */
.messagesPopover { min-width: 320px; max-height: 400px; }
.msgPopHeader { display: flex; justify-content: space-between; align-items: center; }
.msgPopTitle { font-weight: 600; font-size: var(--fs-md); }
.msgPopEmpty { padding: 20px 0; text-align: center; font-size: var(--fs-base); opacity: 0.4; }

.msgPopList {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
}

.msgPopItem {
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--border);
  background: var(--button-bg);
}

.msgPopIndicator { width: 3px; border-radius: var(--radius-sm); flex-shrink: 0; }
.msgPopItem.error .msgPopIndicator { background: var(--err); }
.msgPopItem.info .msgPopIndicator { background: var(--fg); opacity: 0.4; }
.msgPopItem.display .msgPopIndicator { background: var(--display); }

.msgPopBody { flex: 1; min-width: 0; }
.msgPopMeta { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.msgPopBadge { font-size: var(--fs-2xs); font-weight: 700; padding: 1px 5px; border-radius: var(--radius-sm); letter-spacing: 0.5px; }
.msgPopBadge.error { background: color-mix(in oklab, var(--err) 20%, var(--panel)); color: var(--danger); }
.msgPopBadge.info { background: color-mix(in oklab, var(--fg) 10%, var(--panel)); color: var(--fg); opacity: 0.7; }
.msgPopBadge.display { background: color-mix(in oklab, var(--display) 20%, var(--panel)); color: var(--display); }

.msgPopTime { font-size: var(--fs-xs); font-family: var(--font-mono); opacity: 0.5; }
.msgPopText { font-size: var(--fs-base); line-height: 1.3; word-break: break-word; }
.msgPopItem .btn-icon { align-self: flex-start; font-size: var(--fs-xl); }

.btnrow {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.vsep {
  width: 1px;
  height: 26px;
  background: var(--border);
  margin: 0 2px;
}

.btn {
  padding: 10px 12px;
  border-radius: var(--radius-2xl);
}

/* .btn.primary and .btn.danger are in style.css (global) */

.safetyBtn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 20px;
  min-width: 80px;
}

.safetyIcon {
  font-size: var(--fs-3xl);
  line-height: 1;
}

.safetyLabel {
  font-size: var(--fs-sm);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.hint {
  margin-top: 10px;
  font-size: var(--fs-base);
  opacity: 0.65;
}

.debugSection {
  margin-top: 8px;
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
  .panel-probe { min-width: var(--panel-min-w-wide); }
  .panel-gcode,
  .panel-settings  { flex: 0.5; min-width: var(--panel-min-w); }
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
