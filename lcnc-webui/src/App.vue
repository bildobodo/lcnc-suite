<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, reactive, ref, watch } from "vue";
import { evaluatePermissions, PERMISSIONS_KEY, type Permissions } from "./permissions";
import { connectWs, connected, status, send, armed, lastReply, viewerGcode, viewerInit, lcncError, latency, networkLatency, messages, unreadCount, dismissMessage, clearAllMessages, markMessagesRead, type LcncMessage } from "./lcncWs";
import ThreeViewer from "./ThreeViewer.vue";
import Toolbar from "./Toolbar.vue";
import TabPanel from "./TabPanel.vue";
import GcodePanel from "./GcodePanel.vue";
import SafetyStrip from "./SafetyStrip.vue";
import JogStrip from "./JogStrip.vue";
import SetupStrip from "./SetupStrip.vue";
import OverridesStrip from "./OverridesStrip.vue";
import SpindleStrip from "./SpindleStrip.vue";
import ToolStrip from "./ToolStrip.vue";
import SettingsPanel from "./SettingsPanel.vue";
import ToolTablePanel from "./ToolTablePanel.vue";
import ProbePanel from "./ProbePanel.vue";
import OffsetPanel from "./OffsetPanel.vue";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import { highlightGcode } from "./gcodeHighlight";
import { fmtElapsed, fmtDuration, fmtDist, fmtSize } from "./format";
import type { GcodeStats } from "./GcodePanel.vue";
import { Settings, MessageSquare, PowerOff, Gamepad2, Keyboard, BookOpen, ClipboardCopy, Expand, Shrink } from "lucide-vue-next";
import GcodeReferenceDialog from "./GcodeReferenceDialog.vue";
import { loadViewerDefaults, saveViewerDefaults, loadMachineDefaults, loadDisplayDefaults, saveDisplayDefaults, loadMacrosDefaults, loadGamepadDefaults, saveGamepadDefaults, loadKeyboardDefaults, saveKeyboardDefaults, loadMdiHistory, saveMdiHistory, settingsVersion, type ThemeMode, type MacroDef, type GamepadDefaults, type KeyboardDefaults, type KeyboardAction, type Layer, type TrackMode, type Projection, type Vec3 } from "./defaults";
import { buildToolsetterVarMap } from "./toolsetterVars";
import { useGamepad } from "./useGamepad";
import { forceStopAllJogs, initJogPointerSafety, destroyJogPointerSafety } from "./useJogPointers";
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

const isDev = import.meta.env.DEV;

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

// ─── Portrait orientation detection ──────────────────────────
const portraitMql = window.matchMedia("(orientation: portrait)");
const isPortrait = ref(portraitMql.matches);
function onOrientationChange() { isPortrait.value = portraitMql.matches; }
provide("isPortrait", isPortrait);

// Select-all on focus for number inputs — typing replaces value
function onNumFocus(e: FocusEvent) {
  const t = e.target;
  if (t instanceof HTMLInputElement && t.type === "number") t.select();
}

onMounted(() => {
  connectWs();
  themeMql.addEventListener("change", onOsThemeChange);
  portraitMql.addEventListener("change", onOrientationChange);
  document.addEventListener("focusin", onNumFocus);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  if (loadDisplayDefaults().startFullscreen) armStartFullscreen();
  mdiHistory.value = loadMdiHistory();
});

watch(lcncError, (newVal, oldVal) => {
  if (oldVal && !newVal) needsRefresh.value = true;
});

function reloadPage() { location.reload(); }

/** ---------- permanent status banner ---------- */
type MachineStateKey = 'disconnected' | 'estop' | 'off' | 'unhomed' | 'toolchange' | 'running' | 'paused' | 'idle';

const machineState = computed<MachineStateKey>(() => {
  if (!connected.value || lcncError.value) return 'disconnected';
  if (isEstop.value) return 'estop';
  if (!isEnabled.value) return 'off';
  if (!isHomed.value) return 'unhomed';
  if (toolChangeRequested.value) return 'toolchange';
  if (isRunning.value) return 'running';
  if (isPaused.value) return 'paused';
  return 'idle';
});

const STATE_COLORS: Record<MachineStateKey, string> = {
  disconnected: '--state-danger',
  estop: '--state-danger',
  off: '--state-warn',
  unhomed: '--state-warn',
  toolchange: '--state-warn',
  running: '--state-ok',
  paused: '--state-warn',
  idle: '--state-ok',
};
const machineStateColor = computed(() => STATE_COLORS[machineState.value]);

const STATE_LABELS: Record<MachineStateKey, string> = {
  disconnected: 'DISCONNECTED',
  estop: 'E-STOP',
  off: 'MACHINE OFF',
  unhomed: 'NOT HOMED',
  toolchange: 'TOOL CHANGE',
  running: 'RUNNING',
  paused: 'PAUSED',
  idle: 'IDLE',
};

const machineStateLabel = computed(() => {
  const label = STATE_LABELS[machineState.value];
  const state = machineState.value;
  if (state === 'disconnected') {
    return lcncError.value ? `${label} — ${lcncError.value}` : `${label} — reconnecting…`;
  }
  if (state === 'running' || state === 'paused') {
    const file = activeFile.value;
    const name = file ? file.split('/').pop() : null;
    const parts = [label];
    if (name) parts.push(name);
    if (elapsedDisplay.value) parts.push(elapsedDisplay.value);
    return parts.join('  ·  ');
  }
  if (state === 'toolchange' && toolChangeTool.value != null) {
    return `${label}  ·  T${toolChangeTool.value}`;
  }
  return label;
});

const bannerShowAbort = computed(() => isRunning.value || isPaused.value);

const bannerFlashMode = computed<'none' | 'pulse' | 'flash'>(() => {
  const s = machineState.value;
  if (s === 'estop' || s === 'disconnected') return 'flash';
  if (s === 'unhomed' || s === 'toolchange' || s === 'idle') return 'pulse';
  return 'none';
});

const bannerMessage = ref<string | null>(null);
const bannerMessageKind = ref(0);
let _bannerMsgTimer: ReturnType<typeof setTimeout> | null = null;

watch(() => messages.value.length, (newLen, oldLen) => {
  if (newLen > oldLen) {
    const msg = messages.value[newLen - 1]!;
    bannerMessage.value = msg.text;
    bannerMessageKind.value = msg.kind;
    if (_bannerMsgTimer) clearTimeout(_bannerMsgTimer);
    _bannerMsgTimer = setTimeout(() => { bannerMessage.value = null; }, 5000);
  }
});

/** ---------- content tab definitions ---------- */
const contentTabs = [
  { id: "gcode", label: "Program" },
  { id: "mdi", label: "MDI" },
  { id: "probe", label: "Probing" },
  { id: "offsets", label: "Offsets" },
  { id: "tools", label: "Tools" },
];

const activeTab = ref("gcode");

const viewerRef = ref<any>(null);

/** ---------- local UI state ---------- */
const connLabel = computed(() => {
  const h = location.hostname;
  return (h === "localhost" || h === "127.0.0.1") ? "local" : h;
});
const mdiText = ref("");
const busy = ref(false);

// ─── MDI history ──────────────────────────────────────────────────
const mdiHistory = ref<string[]>([]);
const mdiHistoryIndex = ref(-1);
const mdiSavedInput = ref("");
const MDI_MAX_HISTORY = 50;

function handleMdiSend() {
  const cmd = mdiText.value.trim();
  if (!cmd) return;
  if (mdiHistory.value[0] !== cmd) {
    mdiHistory.value.unshift(cmd);
    if (mdiHistory.value.length > MDI_MAX_HISTORY) {
      mdiHistory.value = mdiHistory.value.slice(0, MDI_MAX_HISTORY);
    }
  }
  saveMdiHistory(mdiHistory.value);
  mdiHistoryIndex.value = -1;
  mdiSavedInput.value = "";
  send({ cmd: "mdi", text: cmd });
  mdiText.value = "";
}

function clearMdiHistory() {
  mdiHistory.value = [];
  saveMdiHistory([]);
  mdiHistoryIndex.value = -1;
  mdiSavedInput.value = "";
}

function onMdiKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation();
    if (mdiHistory.value.length === 0) return;
    if (mdiHistoryIndex.value === -1) {
      mdiSavedInput.value = mdiText.value;
    }
    if (mdiHistoryIndex.value < mdiHistory.value.length - 1) {
      mdiHistoryIndex.value++;
      mdiText.value = mdiHistory.value[mdiHistoryIndex.value] ?? "";
    }
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    e.stopPropagation();
    if (mdiHistoryIndex.value < 0) return;
    mdiHistoryIndex.value--;
    if (mdiHistoryIndex.value === -1) {
      mdiText.value = mdiSavedInput.value;
    } else {
      mdiText.value = mdiHistory.value[mdiHistoryIndex.value] ?? "";
    }
    return;
  }
}

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
const gcodeStats = ref<GcodeStats | null>(null);
const statsDialogOpen = ref(false);

// SVG donut chart segments (distance breakdown: rapid / linear / arc)
const DONUT_R = 40;
const DONUT_C = 2 * Math.PI * DONUT_R;
const donutSegments = computed(() => {
  const s = gcodeStats.value;
  if (!s) return [];
  const total = s.rapidDist + s.linearDist + s.arcDist;
  if (total <= 0) return [];
  const segs: { color: string; label: string; value: number; pct: number; dasharray: string; dashoffset: number }[] = [];
  let offset = 0;
  const items = [
    { color: "var(--warn)", label: "Rapid", value: s.rapidDist },
    { color: "var(--info)", label: "Linear", value: s.linearDist },
    { color: "var(--ok)", label: "Arc", value: s.arcDist },
  ];
  for (const item of items) {
    if (item.value <= 0) continue;
    const pct = item.value / total;
    const len = pct * DONUT_C;
    segs.push({
      color: item.color,
      label: item.label,
      value: item.value,
      pct: Math.round(pct * 100),
      dasharray: `${len} ${DONUT_C - len}`,
      dashoffset: -offset,
    });
    offset += len;
  }
  return segs;
});

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

const elapsedDisplay = computed(() => fmtElapsed(programElapsed.value));

/** ---------- system clock ---------- */
const clockTime = ref('');
let _clockHandle: ReturnType<typeof setInterval> | null = null;
function _updateClock() {
  const now = new Date();
  clockTime.value = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
_updateClock();
_clockHandle = setInterval(_updateClock, 1000);
onUnmounted(() => { if (_clockHandle) clearInterval(_clockHandle); });
onUnmounted(() => portraitMql.removeEventListener("change", onOrientationChange));

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
  return codes.slice(1).filter((c: number) => c !== -1).map((c: number) => `G${(c / 10).toFixed(c % 10 ? 1 : 0)}`).join(" ");
});
const activeMcodes = computed(() => {
  const codes = st.value.mcodes;
  if (!codes || !Array.isArray(codes)) return "";
  return codes.slice(1).filter((c: number) => c !== -1).map((c: number) => `M${c}`).join(" ");
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
const defaultAngularJogVel = computed(() => {
  const v = st.value.default_angular_jog_velocity;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 10;
});
const maxAngularJogVel = computed(() => {
  const v = st.value.max_angular_jog_velocity;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 50;
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

// Coolant state
const floodOn = computed(() => !!st.value.flood);
const mistOn = computed(() => !!st.value.mist);
function toggleFlood() {
  fire({ cmd: floodOn.value ? "flood_off" : "flood_on" }, 'ready');
}
function toggleMist() {
  fire({ cmd: mistOn.value ? "mist_off" : "mist_on" }, 'ready');
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


function substituteMacro(command: string, values: Record<string, string>): string {
  let cmd = command;
  for (const [key, val] of Object.entries(values)) cmd = cmd.split(`{${key}}`).join(val);
  return cmd;
}

function confirmMacroParams() {
  if (!macroParamDialog.value) return;
  fire({ cmd: "mdi", text: substituteMacro(macroParamDialog.value.macro.command, macroParamDialog.value.values) }, 'ready');
  macroParamDialog.value = null;
}

function macroPreview(): string {
  if (!macroParamDialog.value) return "";
  return substituteMacro(macroParamDialog.value.macro.command, macroParamDialog.value.values);
}

function runMacro(macro: MacroDef) {
  if (macro.params.length > 0) {
    const values: Record<string, string> = {};
    for (const p of macro.params) values[p.name] = p.default;
    macroParamDialog.value = { macro, values };
  } else {
    fire({ cmd: "mdi", text: macro.command }, 'ready');
  }
}
// @ts-ignore TS6133 — kept for future use
const toolTableRef = ref<InstanceType<typeof ToolTablePanel> | null>(null);
function measureAuto() {
  const t = st.value.tool_number;
  if (!permissions.value.ready || st.value.probing || !t) return;
  send({ cmd: "set_probe_vars", vars: buildToolsetterVarMap() });
  fire({ cmd: "mdi", text: `T${t} M600` }, 'ready');
}

function unloadTool() {
  if (!permissions.value.ready) return;
  const mode = loadMachineDefaults().toolChangeMode;
  if (mode === "m600") {
    send({ cmd: "set_probe_vars", vars: buildToolsetterVarMap() });
    fire({ cmd: "mdi", text: "T0 M600" }, 'ready');
  } else {
    fire({ cmd: "mdi", text: "T0 M6 G49" }, 'ready');
  }
}

// Probe status (used in tool table dialog action bar)
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
const probeIndicatorClass = computed(() => {
  if (st.value.probe_input === true) return "tripped";
  return "";
});

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
 * Anti-spam gate with inline permission check (defense-in-depth).
 * Gate param ensures the command is re-checked even if DOM state changed.
 */
async function fire(payload: any, gate?: keyof Permissions, cooldownMs = 200) {
  if (busy.value) return;
  if (gate && !permissions.value[gate]) return;
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
  fire({ cmd: "mdi", text: `G10 L20 P0 ${axisName}${val.toFixed(6)}` }, 'probe');
}

function setAll(values: number[] = []) {
  const eoffsetZ = st.value.eoffset_z ?? 0;
  const parts = axes.value.map((letter, i) => {
    let val = values[i] ?? 0;
    if (letter === "Z") val += eoffsetZ;
    return `${letter}${val.toFixed(6)}`;
  });
  fire({ cmd: "mdi", text: `G10 L20 P0 ${parts.join(" ")}` }, 'probe');
}

function setG5x(gcode: string) {
  fire({ cmd: "mdi", text: gcode }, 'probe');
}

function homeAll() {
  fire({ cmd: "home_all" }, 'idle');
}

function unhomeAll() {
  fire({ cmd: "unhome_all" }, 'idle');
}

const homedJoints = computed<boolean[]>(() => {
  const hj = st.value.homed_joints;
  return Array.isArray(hj) ? hj.map(Boolean) : [];
});

// @ts-ignore TS6133 — kept for future use
function homeAxis(joint: number) {
  fire({ cmd: "home", joint }, 'idle');
}

// @ts-ignore TS6133 — kept for future use
function unhomeAxis(joint: number) {
  fire({ cmd: "unhome", joint }, 'idle');
}



function cycleStart() {
  fire({ cmd: "cycle_start" }, 'ready');
}

function runFromLine(line: number, spindleDir: "off" | "forward" | "reverse", spindleSpeed: number) {
  fire({
    cmd: "auto_run",
    line,
    spindle_dir: spindleDir !== "off" ? spindleDir : undefined,
    spindle_speed: spindleDir !== "off" ? spindleSpeed : undefined,
  }, 'ready');
}

function cycleStep() {
  fire({ cmd: "auto_step" }, 'step');
}

function cyclePause() {
  fire({ cmd: "cycle_pause" }, 'pause');
}

function cycleResume() {
  fire({ cmd: "cycle_resume" }, 'resume');
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
  fire({ cmd: "spindle_forward", speed }, 'ready');
}

function spindleReverse(speed: number) {
  fire({ cmd: "spindle_reverse", speed }, 'ready');
}

function spindleStop() {
  fire({ cmd: "spindle_stop" }, 'ready');
}

function loadFile(path: string) {
  fire({ cmd: "load_file", path }, 'setup');
}

function unloadFile() {
  fire({ cmd: "unload_file" }, 'setup');
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

  if (isInputFocused()) return;

  // Jog actions — gated by jogEnabled independently
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

  // Command shortcuts — gated by buttonsEnabled independently
  if (!keyboardConfig.value.buttonsEnabled) return;

  // Cycle start / pause / resume
  if (action === "cycle") {
    e.preventDefault();
    if (permissions.value.resume) fire({ cmd: "cycle_resume" }, 'resume');
    else if (permissions.value.pause) fire({ cmd: "cycle_pause" }, 'pause');
    else if (permissions.value.ready && !!activeFile.value) fire({ cmd: "cycle_start" }, 'ready');
    return;
  }

  // Abort
  if (action === "abort") {
    e.preventDefault();
    if (permissions.value.abort) fire({ cmd: "abort" }, 'abort');
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

watch(() => keyboardConfig.value.jogEnabled, (curr, prev) => {
  if (!curr && prev) stopAllJog();
});

watch(() => gamepadConfig.value.jogEnabled, (curr, prev) => {
  if (!curr && prev) gamepad.stopAllJog();
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
  forceStopAllJogs(); // clear all pointer-based jog state + send stops
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
  initJogPointerSafety();
  window.addEventListener("blur", stopAllJog);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  document.addEventListener("visibilitychange", visHandler);
  gamepad.start();
});

onUnmounted(() => {
  destroyJogPointerSafety();
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
  if (Array.isArray(st?.surface_points) && st.surface_points.length) {
    surfacePoints.value = st.surface_points;
  }
  if (st?.comp_grid && typeof st.comp_grid === "object") {
    compGrid.value = st.comp_grid;
  }
});

/** ---------- Surface map probe results ---------- */
const surfacePoints = ref<[number, number, number][] | null>(null);
/** ---------- Compensation grid (from compensation.py) ---------- */
const compGrid = ref<{ x: number[]; y: number[]; zi: number[][]; method: number } | null>(null);

function requestProbeResults() {
  send({ cmd: "get_probe_results" });
}

function requestCompGrid() {
  send({ cmd: "get_comp_grid" });
}

// Listen for get_probe_results / get_comp_grid replies
watch(lastReply, (r: any) => {
  if (r?.ok && r.points) surfacePoints.value = r.points;
  if (r?.ok && r.comp_grid) compGrid.value = r.comp_grid;
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
        <div class="pill mono">{{ clockTime }}</div>
        <div class="pill" :title="connectedClients.map(c => c.ip + (c.armed ? ' (armed)' : '')).join('\n')">
          {{ connectedClients.length }} client{{ connectedClients.length !== 1 ? 's' : '' }}
        </div>
        <div class="pill" :class="connected ? 'ok' : 'bad'">
          <span class="stable-width"><span :class="{ alt: !connected }">WS connected</span><span :class="{ alt: connected }">WS disconnected</span></span>
        </div>
        <div v-if="connected && networkLatency != null" class="pill" title="Network latency">Net <span class="mono pill-ms">{{ networkLatency }}</span>ms</div>
        <div v-if="connected && latency != null" class="pill" title="Round-trip latency">Ping <span class="mono pill-ms">{{ latency }}</span>ms</div>
        <div class="pill" :class="lcncError ? 'bad' : (configName ? 'ok' : '')">{{ lcncLabel }}</div>
        <div class="pill" :class="armed ? 'armed' : 'disarmed'"><span class="stable-width"><span :class="{ alt: !armed }">ARMED</span><span :class="{ alt: armed }">DISARMED</span></span></div>
        <div v-if="gamepad.gamepadConnected.value" class="pill ok" :title="gamepad.gamepadName.value"><Gamepad2 :size="14" /></div>
        <div v-if="keyboardConfig.jogEnabled || keyboardConfig.buttonsEnabled" class="pill ok" title="Keyboard shortcuts active"><Keyboard :size="14" /></div>

        <div class="hdrBtns row-tight">
          <MachineBtn type="headerIcon" :warning="unreadCount > 0" :title="'Messages (' + unreadCount + ')'" @click="openDialog('messages')">
            <MessageSquare :size="22" />
          </MachineBtn>
          <MachineBtn type="headerIcon" title="G-code Reference" @click="openGcodeRef()">
            <BookOpen :size="22" />
          </MachineBtn>
          <MachineBtn type="headerIcon" title="Settings" @click="openDialog('settings')">
            <Settings :size="22" />
          </MachineBtn>
          <MachineBtn type="headerIcon" :title="isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'" @click="toggleFullscreen">
            <Shrink v-if="isFullscreen" :size="22" />
            <Expand v-else :size="22" />
          </MachineBtn>
          <MachineBtn type="headerIcon" class="hdrShutdown" title="Shut Down LinuxCNC" @click="showShutdownConfirm = true">
            <PowerOff :size="22" />
          </MachineBtn>
        </div>
      </div>
    </header>

    <div class="statusBanner" :class="{ 'banner-pulse': bannerFlashMode === 'pulse', 'banner-flash': bannerFlashMode === 'flash' }" :style="{ '--state-color': `var(${machineStateColor})` }">
      <div class="bannerContent" @click="messagesDialogOpen = true; markMessagesRead()">
        <Transition name="banner-fade" mode="out-in">
          <span v-if="bannerMessage && !bannerShowAbort" :key="'msg'" :class="{ bannerError: bannerMessageKind <= 2 }">
            {{ bannerMessage }}
          </span>
          <span v-else :key="machineState">
            {{ machineStateLabel }}
          </span>
        </Transition>
      </div>
      <div class="bannerActions row-controls">
        <MachineBtn v-if="bannerShowAbort" type="bannerAbort" @click="send({ cmd: 'abort' })">ABORT</MachineBtn>
        <MachineBtn v-if="machineState === 'unhomed'" type="bannerHome" @click="homeAll">Home All</MachineBtn>
        <MachineBtn v-if="unreadCount > 0" type="bannerAction" @click="messagesDialogOpen = true; markMessagesRead()">
          {{ unreadCount }} message{{ unreadCount === 1 ? '' : 's' }}
        </MachineBtn>
        <MachineBtn v-if="needsRefresh" type="bannerAction" @click="reloadPage">Refresh</MachineBtn>
      </div>
    </div>

    <!-- ══ Content area — outer Gate wraps tabs ══ -->
    <Gate gate="armed" class="content">
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
            :surfacePoints="surfacePoints"
            :compGrid="compGrid"
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
              @abort="fire({ cmd: 'abort' }, 'abort')"
              @toggleOptionalStop="toggleOptionalStop"
              @toggleBlockDelete="toggleBlockDelete"
              @openGcodeRef="openGcodeRef"
              @showStats="statsDialogOpen = true"
            />
          </template>

          <template #probe>
            <ProbePanel
              :probing="st.probing === true"
              :probeTripped="st.probe_tripped === true"
              :probeInput="st.probe_input === true"
              :probedPosition="st.probed_position ?? null"
              :workPos="workPos"
              :probeResults="probeResults"
              :eoffsetZ="st.eoffset_z ?? null"
              :eoffsetEnabled="!!st.eoffset_enabled"
              :compMethod="st.comp_method ?? null"
              :compGridVersion="st.comp_grid_version ?? 0"
              :surfacePoints="surfacePoints"
              :compGrid="compGrid"
              @mdi="fire({ cmd: 'mdi', text: $event }, 'ready')"
              @abort="fire({ cmd: 'abort' }, 'abort')"
              @simTrip="send({ cmd: 'simulate_probe_trip' })"
              @setProbeVars="send({ cmd: 'set_probe_vars', vars: $event })"
              @getProbeResults="requestProbeResults"
              @getCompGrid="requestCompGrid"
              @setCompensation="requestCompToggle"
              @setCompMethod="send({ cmd: 'set_compensation_method', method: $event })"
            />
          </template>

          <template #mdi>
            <div class="mdiTab">
              <div class="mdiRow">
                <MachineInput
                  gate="mdiText"
                  type="text"
                  class="mdiInput"
                  :value="mdiText"
                  @input="mdiText = ($event.target as HTMLInputElement).value"
                  @keyup.enter="handleMdiSend"
                  @keydown="onMdiKeydown"
                  placeholder="G-code command (↑↓ history)"
                />
                <MachineBtn type="mdi" @click="handleMdiSend">Send</MachineBtn>
                <MachineBtn type="abort" @click="send({ cmd: 'abort' })" />
              </div>
              <div class="mdiHistoryHeader">
                <span class="sub">History</span>
                <MachineBtn type="dialogCancel" @click="clearMdiHistory" :disabled="mdiHistory.length === 0">Clear</MachineBtn>
              </div>
              <div class="codeViewer mdiHistoryList scroll-thin">
                <div v-for="(cmd, i) in mdiHistory" :key="i"
                     class="codeLine"
                     :class="{ active: mdiHistoryIndex === i }"
                     @click="mdiText = cmd">
                  <span class="lineContent"><span
                    v-for="(token, ti) in highlightGcode(cmd)" :key="ti"
                    :class="'token-' + token.type">{{ token.text }}</span></span>
                </div>
                <div v-if="mdiHistory.length === 0" class="mdiHistoryEmpty">No history</div>
              </div>
            </div>
          </template>

          <template #offsets>
            <OffsetPanel
              :axes="axes"
              :g5xLabel="g5xLabel"
              :g92Offset="st.g92_offset ?? null"
              :toolOffset="st.tool_offset ?? null"
              :eoffsetZ="st.eoffset_z ?? null"
              :eoffsetEnabled="!!st.eoffset_enabled"
              :rotationXy="st.rotation_xy ?? null"
            />
          </template>

          <template #tools>
            <div class="toolsTab">
              <div class="toolTabActions stack-controls">
                <div class="toolTabRow">
                  <div class="row-tight">
                    <MachineBtn type="toolMeasure" :disabled="!!st.probing" @click="measureAuto">Measure Current</MachineBtn>
                    <MachineBtn type="toolUnload" :disabled="!!st.probing" @click="unloadTool">Unload</MachineBtn>
                    <MachineBtn type="abort" @click="send({ cmd: 'abort' })" />
                  </div>
                  <div class="row-tight toolTabManage">
                    <MachineBtn type="manage" @click="toolTableRef?.openAdd()">+ Add</MachineBtn>
                    <MachineBtn type="manage" @click="toolTableRef?.triggerImport()">Import</MachineBtn>
                    <MachineBtn type="manage" @click="toolTableRef?.fetchTools()">Refresh</MachineBtn>
                  </div>
                </div>
                <div class="row-tight">
                  <span class="statusDot" :class="probeIndicatorClass"></span>
                  <span class="label-muted md">Probe</span>
                  <span class="statusDot" :class="probeStatusClass"></span>
                  <span class="label-muted md mono">{{ probeStatus }}</span>
                  <MachineBtn v-if="isDev" type="simTrip" @click="send({ cmd: 'simulate_probe_trip' })">Sim Trip</MachineBtn>
                </div>
              </div>
              <ToolTablePanel
                ref="toolTableRef"
                :currentTool="st.tool_number ?? null"
                :iniFilename="st.ini_filename ?? null"
                hideHeader
              />
            </div>
          </template>
        </TabPanel>

        <!-- Program stats dialog -->
        <div v-if="statsDialogOpen && gcodeStats" class="dialogOverlay" @click.self="statsDialogOpen = false">
          <div class="dialog md statsDialog">
            <div class="dialogHeader">
              <span class="dialogTitle">Program Stats</span>
              <MachineBtn type="close" @click="statsDialogOpen = false">&times;</MachineBtn>
            </div>
            <div class="dialogContent stack-sections scroll-thin">
              <div v-if="donutSegments.length > 0" class="donutRow">
                <svg class="donut" viewBox="0 0 100 100">
                  <circle class="donutBg" cx="50" cy="50" r="40" />
                  <circle v-for="(seg, i) in donutSegments" :key="i"
                    cx="50" cy="50" r="40"
                    fill="none"
                    :stroke="seg.color"
                    stroke-width="12"
                    :stroke-dasharray="seg.dasharray"
                    :stroke-dashoffset="seg.dashoffset"
                    transform="rotate(-90 50 50)"
                  />
                </svg>
                <div class="donutLegend stack-tight">
                  <div v-for="seg in donutSegments" :key="seg.label" class="legendItem">
                    <span class="legendDot" :style="{ background: seg.color }"></span>
                    <span>{{ seg.label }}</span>
                    <span class="legendPct mono">{{ seg.pct }}%</span>
                  </div>
                </div>
              </div>

              <div class="sep"></div>

              <div class="stack-controls">
                <div class="sub">Time</div>
                <div class="statsGrid">
                  <span class="statsLabel">Estimated</span>
                  <span class="statsValue mono">{{ fmtDuration(gcodeStats.totalTime) }}</span>
                  <span class="statsLabel">Feed</span>
                  <span class="statsValue mono">{{ fmtDuration(gcodeStats.feedTime) }}</span>
                  <span class="statsLabel">Rapid</span>
                  <span class="statsValue mono">{{ fmtDuration(gcodeStats.rapidTime) }}</span>
                </div>
              </div>

              <div class="sep"></div>

              <div class="stack-controls">
                <div class="sub">Distance</div>
                <div class="statsGrid">
                  <span class="statsLabel">Rapid</span>
                  <span class="statsValue mono">{{ fmtDist(gcodeStats.rapidDist, gcodeStats.unit) }} ({{ gcodeStats.rapidMoves }})</span>
                  <span class="statsLabel">Linear</span>
                  <span class="statsValue mono">{{ fmtDist(gcodeStats.linearDist, gcodeStats.unit) }} ({{ gcodeStats.linearMoves }})</span>
                  <span class="statsLabel">Arc</span>
                  <span class="statsValue mono">{{ fmtDist(gcodeStats.arcDist, gcodeStats.unit) }} ({{ gcodeStats.arcMoves }})</span>
                </div>
              </div>

              <div class="sep"></div>

              <div class="stack-controls">
                <div class="sub">Tools &amp; Feeds</div>
                <div class="statsGrid">
                  <span class="statsLabel">Tool changes</span>
                  <span class="statsValue mono">{{ gcodeStats.toolChanges }}</span>
                  <span class="statsLabel">Tools used</span>
                  <span class="statsValue mono">{{ gcodeStats.toolsUsed.length ? gcodeStats.toolsUsed.map(t => 'T' + t).join(', ') : 'None' }}</span>
                  <span class="statsLabel">Feed rates</span>
                  <span class="statsValue mono">{{ gcodeStats.feedRates.length ? gcodeStats.feedRates.join(', ') : '-' }}</span>
                  <span class="statsLabel">File size</span>
                  <span class="statsValue mono">{{ fmtSize(gcodeStats.fileSize) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Dialogs — inside content area so strip stays accessible beneath -->

      <!-- Settings dialog -->
      <div v-if="settingsDialogOpen" class="dialogOverlay" @click.self="settingsDialogOpen = false">
        <div class="dialog lg dialog-full">
          <div class="dialogHeader">
            <span class="dialogTitle">Settings</span>
            <MachineBtn type="close" @click="settingsDialogOpen = false">&times;</MachineBtn>
          </div>
          <div class="dialogContent">
            <SettingsPanel
              :gamepadConnected="gamepad.gamepadConnected.value"
              :gamepadName="gamepad.gamepadName.value"
              :gamepadConfig="gamepadConfig"
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
        <div class="dialog lg dialog-full">
          <div class="dialogHeader">
            <span class="dialogTitle">Messages ({{ messages.length }})</span>
            <div class="row-tight">
              <MachineBtn type="inline" @click="copyAllMessages" :disabled="messages.length === 0">Copy All</MachineBtn>
              <MachineBtn type="inline" @click="clearAllMessages" :disabled="messages.length === 0">Clear All</MachineBtn>
              <MachineBtn type="close" @click="messagesDialogOpen = false; markMessagesRead()">&times;</MachineBtn>
            </div>
          </div>
          <div class="dialogContent stack-tight scroll-thin">
            <div v-for="msg in [...messages].reverse()" :key="msg.id" class="msgItem" :class="msgKindClass(msg.kind)">
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
          <div class="dialogActions">
            <MachineBtn type="abort" @click="send({ cmd: 'abort' })" />
            <MachineBtn type="dialogBase" @click="confirmToolChange">Confirm</MachineBtn>
          </div>
        </div>
      </div>

      <div v-if="macroParamDialog" class="dialogOverlay" @click.self="macroParamDialog = null">
        <div class="dialog">
          <div class="dialogTitle">{{ macroParamDialog.macro.name }}</div>
          <div class="dialogBody">
            <div class="stack-controls">
              <div v-for="p in macroParamDialog.macro.params" :key="p.name" class="macroParamRow">
                <label class="macroParamLabel">{{ p.label || p.name }}</label>
                <MachineInput
                  gate="macroParam"
                  v-model="macroParamDialog.values[p.name]"
                  @keydown.enter="confirmMacroParams"
                />
              </div>
            </div>
            <code class="macroPreview">{{ macroPreview() }}</code>
          </div>
          <div class="dialogActions">
            <MachineBtn type="dialogCancel" @click="macroParamDialog = null">Cancel</MachineBtn>
            <MachineBtn type="dialogReady" @click="confirmMacroParams">Execute</MachineBtn>
          </div>
        </div>
      </div>

      <div v-if="showShutdownConfirm" class="dialogOverlay safetyDialog">
        <div class="dialog">
          <div class="dialogTitle danger">Shut Down LinuxCNC?</div>
          <div class="dialogBody">This will stop all motion and exit LinuxCNC.</div>
          <div class="dialogActions">
            <MachineBtn type="dialogCancel" @click="showShutdownConfirm = false">Cancel</MachineBtn>
            <MachineBtn type="shutdown" @click="send({ cmd: 'shutdown' }); showShutdownConfirm = false">Shut Down</MachineBtn>
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
            <MachineBtn type="dialogCancel" @click="cancelCompToggle">Cancel</MachineBtn>
            <MachineBtn type="dialogReady" @click="confirmCompToggle">Confirm</MachineBtn>
          </div>
        </div>
      </div>
    </Gate><!-- /content (outer gate) -->

    <!-- ══ Macro Bar — thin row of user macro buttons ══ -->
    <Gate v-if="userMacros.length" gate="armed" class="macroBar bordered-panel row-controls scroll-thin">
      <MachineBtn v-for="m in userMacros" :key="m.id" type="macro" @click="runMacro(m)">{{ m.name }}</MachineBtn>
    </Gate>

    <!-- ══ Bottom Action Strip — default-deny Gate, SafetyStrip exempt + sticky ══ -->
    <Gate gate="armed" class="strip bordered-panel scroll-thin">
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
        @machine-on="fire({ cmd: 'machine_on' }, 'safety')"
        @machine-off="fire({ cmd: 'machine_off' }, 'safety')"
      />
      </template>

      <JogStrip
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
        :jogDisabled="!permissions.jog"
        :taskMode="taskMode"
        @update:jogVel="jogVel = $event"
        @update:angularJogVel="angularJogVel = $event"
        @update:jogIncrement="jogIncrement = $event"
        @resetJogVel="jogVel = defaultJogVel"
        @resetAngularJogVel="angularJogVel = defaultAngularJogVel"
        @modeChange="send({ cmd: 'set_mode', mode: $event })"
      />

      <SetupStrip
        :axes="axes"
        :touchoff="touchoff"
        :homedJoints="homedJoints"
        :isHomed="isHomed"
        :g5xLabel="g5xLabel"
        @update:touchoff="touchoff = $event"
        @homeAll="homeAll"
        @unhomeAll="unhomeAll"
        @homeAxis="homeAxis"
        @unhomeAxis="unhomeAxis"
        @setAxis="setAxis"
        @setAll="setAll"
        @setG5x="setG5x"
        @goToG30="fire({ cmd: 'mdi', text: 'O<go_to_g30> CALL' }, 'ready')"
        @goToHome="fire({ cmd: 'mdi', text: 'O<go_to_home> CALL' }, 'ready')"
        @goToZero="fire({ cmd: 'mdi', text: 'O<go_to_zero> CALL' }, 'ready')"
      />

      <OverridesStrip
        :feedSlider="feedSlider"
        :spindleSlider="spindleSlider"
        :rapidSlider="rapidSlider"
        :feedOvrEnabled="feedOvrEnabled"
        :spindleOvrEnabled="spindleOvrEnabled"
        :maxFeedOverride="maxFeedOverride"
        :minSpindleOverride="minSpindleOverride"
        :maxSpindleOverride="maxSpindleOverride"
        @update:feedSlider="feedSlider = $event"
        @update:spindleSlider="spindleSlider = $event"
        @update:rapidSlider="rapidSlider = $event"
        @feedChange="onFeedChange"
        @spindleSliderChange="onSpindleSliderChange"
        @rapidChange="onRapidChange"
        @overridePreset="setOverridePreset"
      />

      <SpindleStrip
        :isForward="isForward"
        :isReverse="isReverse"
        :isSpinning="isSpinning"
        :rpmInput="rpmInput"
        :minSpindleSpeed="minSpindleSpeed"
        :maxSpindleSpeed="maxSpindleSpeed"
        :floodOn="floodOn"
        :mistOn="mistOn"
        @spindleFwd="spindleForward"
        @spindleRev="spindleReverse"
        @spindleStop="spindleStop"
        @update:rpmInput="rpmInput = $event"
        @toggleFlood="toggleFlood"
        @toggleMist="toggleMist"
      />

      <ToolStrip
        :currentTool="st.tool_number ?? 0"
        :toolDiameter="st.tool_diameter ?? null"
        :toolLength="st.tool_length ?? null"
        @openToolTable="activeTab = 'tools'"
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
  min-width: var(--panel-min-w);
  min-height: 0;
}

.sidePane {
  width: var(--panel-min-w-wide);
  flex-shrink: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  padding: var(--gap-controls);
  border-radius: var(--radius-container);
}


.macroBar {
  flex-shrink: 0;
  padding: var(--gap-tight) var(--gap-controls);
  overflow-x: auto;
  overflow-y: hidden;
  border-radius: var(--radius-container);
}

.strip {
  display: flex;
  height: 280px;
  flex-shrink: 0;
  padding: var(--gap-controls);
  gap: var(--gap-controls);
  overflow-x: auto;
  overflow-y: hidden;
  border-radius: var(--radius-container);
}
/* Center all sections when space allows; collapse to 0 on overflow */
.strip::before,
.strip::after {
  content: '';
  flex: 1;
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
.hdrBtns { flex-shrink: 0; }

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

.pill-ms {
  display: inline-block;
  min-width: 3ch;
  text-align: right;
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
  justify-content: space-between;
  gap: var(--gap-section);
  padding: 8px 14px;
  min-height: 56px;
  color: var(--fg);
  font-size: var(--fs-xl);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
  border-radius: var(--radius-container);
  background: color-mix(in oklab, var(--state-color, var(--info)) 25%, var(--panel));
  transition: background 0.4s ease;
}

.bannerContent {
  flex: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.bannerContent span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bannerError {
  color: var(--danger);
}

.bannerActions {
  flex-shrink: 0;
}

.banner-fade-enter-active,
.banner-fade-leave-active {
  transition: opacity 0.3s ease;
}
.banner-fade-enter-from,
.banner-fade-leave-to {
  opacity: 0;
}

.statusBanner.banner-pulse {
  animation: banner-pulse var(--pulse-duration) ease-in-out infinite;
}

@keyframes banner-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.statusBanner.banner-flash {
  animation: flash-danger var(--flash-duration) step-start infinite;
}

@keyframes flash-danger {
  0%, 100% { background: color-mix(in oklab, var(--state-color) 40%, var(--panel)); }
  50% { background: var(--panel); }
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

/* ---- Macro param dialog ---- */
/* .macroParamFields — uses stack-controls utility */
.macroParamRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
}
.macroParamLabel {
  min-width: 100px;
}
.macroPreview {
  display: block;
  margin-top: var(--gap-section);
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
}


/* ---- Stats dialog ---- */
.statsDialog {
  min-width: 340px;
  max-width: 480px;
}

.statsGrid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--gap-tight) var(--gap-controls);
}

.statsLabel {
  opacity: var(--opacity-muted);
}

.statsValue {
  text-align: right;
}

.donutRow {
  display: flex;
  align-items: center;
  gap: var(--gap-section);
}

.donut {
  width: 80px;
  height: 80px;
  flex-shrink: 0;
}

.donutBg {
  fill: none;
  stroke: color-mix(in oklab, var(--panel) 90%, var(--fg));
  stroke-width: 12;
}

.legendItem {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}

.legendDot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-round);
  flex-shrink: 0;
}

.legendPct {
  opacity: var(--opacity-muted);
  margin-left: auto;
}

/* ---- Messages dialog ---- */
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

/* ─── MDI tab ─── */
.mdiTab {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: var(--gap-controls);
}

.mdiRow {
  display: flex;
  gap: var(--gap-controls);
  align-items: stretch;
}

.mdiInput {
  flex: 1;
  min-width: 0;
}

.mdiHistoryHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mdiHistoryList {
  min-height: 0;
}

.mdiHistoryList .codeLine {
  cursor: pointer;
}

.mdiHistoryEmpty {
  padding: var(--gap-section);
  text-align: center;
  opacity: var(--opacity-muted);
}

.toolsTab {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.toolTabActions {
  padding: var(--gap-tight) 0;
  flex-shrink: 0;
}

.toolTabRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gap-controls);
}

.toolTabManage {
  margin-left: auto;
}

/* ── Portrait layout ─────────────────────────────────────────── */
@media (orientation: portrait) {
  .wrap {
    display: grid;
    grid-template-columns: 280px auto 1fr;
    grid-template-rows: auto auto 1fr;
  }

  /* Header + status banner span all 3 columns */
  .wrap > header.hdr {
    grid-column: 1 / -1;
    grid-row: 1;
    margin-bottom: 0;
  }
  .statusBanner {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  /* Action strip: left column, vertical */
  .wrap > .strip {
    grid-column: 1;
    grid-row: 3;
    height: auto;
    width: 280px;
    flex-direction: column;
    overflow-x: hidden;
    overflow-y: auto;
  }
  .wrap > .strip > * + * {
    border-left: none;
    padding-left: 0;
    border-top: 1px solid var(--border-subtle);
    padding-top: var(--gap-controls);
  }
  .wrap > .strip::before,
  .wrap > .strip::after {
    display: none;
  }

  /* Macro bar: thin middle column, vertical (collapses when no macros) */
  .wrap > .macroBar {
    grid-column: 2;
    grid-row: 3;
    flex-direction: column;
    overflow-x: hidden;
    overflow-y: auto;
    height: auto;
    width: auto;
  }

  /* Content: right column, viewer on top / side panel below */
  .wrap > .content {
    grid-column: 3;
    grid-row: 3;
    flex-direction: column;
  }
  .viewerPane {
    flex: 0 0 var(--viewer-min-h-portrait);
    min-width: 0;
  }
  .sidePane {
    flex: 1;
    width: auto;
    min-width: 0;
  }
}

</style>
