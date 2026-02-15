<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, reactive, ref, watch } from "vue";
import { evaluatePermissions, PERMISSIONS_KEY } from "./permissions";
import { connectWs, connected, status, send, lastReply, viewerGcode, lcncError, latency, messages, unreadCount, dismissMessage, clearAllMessages, markMessagesRead } from "./lcncWs";
import ThreeViewer from "./ThreeViewer.vue";
import Toolbar from "./Toolbar.vue";
import TabPanel from "./TabPanel.vue";
import DroPanel from "./DroPanel.vue";
import JogPanel from "./JogPanel.vue";
import MdiPanel from "./MdiPanel.vue";
import GcodePanel from "./GcodePanel.vue";
import OverridePanel from "./OverridePanel.vue";
import SettingsPanel from "./SettingsPanel.vue";
import SpindlePanel from "./SpindlePanel.vue";
import MessagesPanel from "./MessagesPanel.vue";

import { loadViewerDefaults, loadPanelsDefaults, savePanelsDefaults } from "./defaults";
import {
  INTERP_IDLE, INTERP_READING, INTERP_PAUSED, INTERP_WAITING,
  TRAJ_MODE_FREE, TRAJ_MODE_TELEOP,
  TASK_MODE_MANUAL, TASK_MODE_AUTO, TASK_MODE_MDI,
} from "./lcnc";

const _vd = loadViewerDefaults();

onMounted(() => connectWs());

/** ---------- tab definitions ---------- */
const tabs = [
  { id: "viewer", label: "3D Viewer" },
  { id: "dro", label: "DRO" },
  { id: "jog", label: "Jogging" },
  { id: "mdi", label: "MDI" },
  { id: "overrides", label: "Overrides" },
  { id: "spindle", label: "Spindle" },
  { id: "gcode", label: "Program" },
  { id: "messages", label: "Messages" },
  { id: "settings", label: "Settings" },
];

/** ---------- dynamic panels (1–3) ---------- */
const maxPanels = 3;

let _nextPanelId = 0;

const _pd = loadPanelsDefaults();
const panels = ref(_pd.tabs.slice(0, maxPanels).map(tab => ({ id: _nextPanelId++, tab })));


const viewerRefs = new Map<number, any>();

function setViewerRef(panelId: number, el: any) {
  if (el) viewerRefs.set(panelId, el);
  else viewerRefs.delete(panelId);
}

function addPanel() {
  if (panels.value.length >= maxPanels) return;
  panels.value.push({ id: _nextPanelId++, tab: "dro" });
}

function removePanel(panelId: number) {
  if (panels.value.length <= 1 || panels.value[0].id === panelId) return;
  panels.value = panels.value.filter(p => p.id !== panelId);
  viewerRefs.delete(panelId);
}

function panelMinWidth(tab: string): string {
  if (tab === "viewer" || tab === "dro") return "420px";
  return "320px";
}


const tabBadges = computed((): Record<string, number> =>
  unreadCount.value > 0 ? { messages: unreadCount.value } : {}
);

watch(
  () => panels.value.map(p => p.tab),
  (tabs) => {
    if (tabs.includes("messages")) markMessagesRead();
    savePanelsDefaults({ tabs });
  }
);

/** ---------- local UI state ---------- */
const connLabel = computed(() => {
  const h = location.hostname;
  return (h === "localhost" || h === "127.0.0.1") ? "local" : h;
});
const armed = ref(false);
const mdiText = ref("G0 X0 Y0");
const busy = ref(false);

// Workpiece configuration (initialized from saved defaults)
const workpieceSize = ref<[number, number, number]>(_vd.workpieceSize);
const workpieceOffset = ref<[number, number, number]>(_vd.workpieceOffset);

// G-code viewer
const gcodeContent = ref<string | null>(null);

/** ---------- status helpers ---------- */
const st = computed<Record<string, any>>(() => status.value?.data ?? {});
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

const homedLabel = computed(() => {
  const h = st.value.homed;
  if (Array.isArray(h)) return h.map((x: any) => (x ? "1" : "0")).join("");
  if (typeof h === "boolean") return h ? "true" : "false";
  if (h == null) return "-";
  return String(h);
});

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
const canEstop = computed(() => armed.value && !isEstop.value);
const canResetEstop = computed(() => armed.value && isEstop.value);

const canMachineOn = computed(
  () => armed.value && !isEstop.value && !isEnabled.value
);
const canMachineOff = computed(() => armed.value && isEnabled.value);

/** Centralized permissions — single source of truth for all button enable/disable */
const permissions = computed(() => evaluatePermissions({
  armed: armed.value,
  isEstop: isEstop.value,
  isEnabled: isEnabled.value,
  isHomed: isHomed.value,
  isIdle: isIdle.value,
  isRunning: isRunning.value,
  isPaused: isPaused.value,
  busy: busy.value,
  hasFile: !!activeFile.value,
}));
provide(PERMISSIONS_KEY, permissions);

const isHomed = computed(() => {
  const h = st.value.homed;
  if (Array.isArray(h)) return h.every(Boolean);
  return !!h;
});

const motionMode = computed(() => st.value.motion_mode ?? TRAJ_MODE_FREE);
const isTeleop = computed(() => motionMode.value === TRAJ_MODE_TELEOP);

const interpState = computed(() => st.value.interp_state ?? INTERP_IDLE);
const isPaused = computed(() => interpState.value === INTERP_PAUSED);
const isRunning = computed(() => interpState.value === INTERP_READING || interpState.value === INTERP_WAITING);
const isIdle = computed(() => interpState.value === INTERP_IDLE);

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

// Feed override percentage
const feedOverride = computed(() => {
  const fo = st.value.feed_override;
  if (fo == null || !Number.isFinite(fo)) return "-";
  return `${Math.round(fo * 100)}%`;
});

// Spindle override percentage
const spindleOverride = computed(() => {
  const so = st.value.spindle_override;
  if (so == null || !Number.isFinite(so)) return "-";
  return `${Math.round(so * 100)}%`;
});

// Rapid override percentage
const rapidOverride = computed(() => {
  const ro = st.value.rapid_override;
  if (ro == null || !Number.isFinite(ro)) return "-";
  return `${Math.round(ro * 100)}%`;
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


// Active modal codes
const activeGcodes = computed(() => {
  const raw = st.value.gcodes;
  if (!Array.isArray(raw)) return "-";
  return raw
    .filter((v: number) => v >= 0)
    .sort((a: number, b: number) => a - b)
    .map((v: number) => `G${(v / 10).toFixed(v % 10 ? 1 : 0)}`)
    .join(" ") || "-";
});

const activeMcodes = computed(() => {
  const raw = st.value.mcodes;
  if (!Array.isArray(raw)) return "-";
  return raw
    .filter((v: number) => v >= 0)
    .sort((a: number, b: number) => a - b)
    .map((v: number) => `M${v}`)
    .join(" ") || "-";
});

// Linear unit system (derived from active G20/G21)
const linearUnit = computed(() => {
  const raw = st.value.gcodes;
  if (!Array.isArray(raw)) return "mm";
  if (raw.includes(200)) return "in";   // G20 = inches
  return "mm";                           // G21 (210) or default
});

// Max jog velocity from INI [DISPLAY]MAX_LINEAR_VELOCITY (u/s)
const maxJogVel = computed(() => {
  const v = st.value.max_jog_velocity ?? st.value.max_velocity;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 50;
});

// Spindle state
const spindleSpeed = computed(() => st.value.spindle_speed ?? null);
const spindleActual = computed(() => st.value.spindle_speed_actual ?? null);
const spindleDirection = computed(() => st.value.spindle_direction ?? null);

/** ---------- actions ---------- */
function arm(v: boolean) {
  armed.value = v;
  send({ cmd: "arm", armed: v });
}

/** ---------- local UI jog ---------- */
const jogVel = ref(10);
const jogIncrement = ref(0); // 0 = continuous, >0 = increment distance in machine units

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

function zeroAxis(axis: number) {
  const axisNames = ['X', 'Y', 'Z'];
  const axisName = axisNames[axis];
  if (!axisName) return;

  // G10 L20 P0 sets current work offset, axis letter followed by 0 sets that axis to zero
  fire({ cmd: "mdi", text: `G10 L20 P0 ${axisName}0` });
}

function zeroAll() {
  fire({ cmd: "mdi", text: "G10 L20 P0 X0 Y0 Z0" });
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

function toggleTeleop() {
  fire(isTeleop.value ? { cmd: "teleop_disable" } : { cmd: "teleop_enable" });
}

function cycleStart() {
  fire({ cmd: "cycle_start" });
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
const jogKeys = reactive(new Set<string>());

function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function onKeyDown(e: KeyboardEvent) {
  // E-stop: ALWAYS works, even in inputs
  if (e.key === "Escape") {
    e.preventDefault();
    if (canEstop.value) fire({ cmd: "estop" });
    else if (canResetEstop.value) fire({ cmd: "estop_reset" });
    return;
  }

  // Everything else skipped when typing in inputs
  if (isInputFocused()) return;

  // Jog keys (hold-to-jog or increment)
  const jog = JOG_KEY_MAP[e.key];
  if (jog) {
    e.preventDefault();
    if (e.repeat || jogKeys.has(e.key)) return;
    if (!permissions.value.jog) return;
    jogKeys.add(e.key);
    const v = jogVel.value * jog.dir;
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
  const jog = JOG_KEY_MAP[e.key];
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
  send({ cmd: "jog_stop", axis: 0 });
  send({ cmd: "jog_stop", axis: 1 });
  send({ cmd: "jog_stop", axis: 2 });
}

function visHandler() {
  if (document.hidden) stopAllJog();
}

onMounted(() => {
  window.addEventListener("blur", stopAllJog);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  document.addEventListener("visibilitychange", visHandler);
});

onUnmounted(() => {
  window.removeEventListener("blur", stopAllJog);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  document.removeEventListener("visibilitychange", visHandler);
});

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

        <div v-if="connected && latency != null" class="pill">
          {{ latency }}ms
        </div>

        <div class="pill" :class="lcncError ? 'bad' : (configName ? 'ok' : '')">
          {{ lcncLabel }}
        </div>

        <div class="pill" :class="armed ? 'armed' : 'disarmed'">
          {{ armed ? "ARMED" : "DISARMED" }}
        </div>
      </div>
    </header>

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
          @click="fire({ cmd: isEstop ? 'estop_reset' : 'estop' })"
          :disabled="!(isEstop ? canResetEstop : canEstop) || busy"
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
        <div class="statusChip" :class="isEstop ? 'bad' : (isEnabled && isHomed ? 'ok' : '')">
          <span class="chipIcon">&#x2699;</span>
          <span class="chipLabel">Machine</span>
          <span class="chipValue">{{ isEstop ? 'E-STOP' : (!isEnabled ? 'OFF' : (!isHomed ? 'NOT HOMED' : 'READY')) }}</span>
          <div class="popover chipPopover">
            <div class="statusRow"><div class="k">E-Stop</div><div class="v" :class="isEstop ? 'badText' : 'okText'">{{ isEstop ? 'TRUE' : 'FALSE' }}</div></div>
            <div class="statusRow"><div class="k">Enabled</div><div class="v" :class="isEnabled ? 'okText' : 'mutedText'">{{ isEnabled ? 'TRUE' : 'FALSE' }}</div></div>
            <div class="statusRow"><div class="k">Homed</div><div class="v" :class="isHomed ? 'okText' : 'badText'">{{ isHomed ? 'TRUE' : 'FALSE' }}</div></div>
            <div class="statusRow"><div class="k">Motion</div><div class="v">{{ isTeleop ? 'WORLD' : 'JOINT' }}</div></div>
          </div>
        </div>

        <div class="statusChip" :class="isRunning ? 'ok' : (isPaused ? 'warn' : '')">
          <span class="chipIcon">&#x25B6;</span>
          <span class="chipLabel">Program</span>
          <span class="chipValue">{{ isRunning ? 'RUNNING' : (isPaused ? 'PAUSED' : 'IDLE') }}</span>
          <div class="popover chipPopover">
            <div class="statusRow"><div class="k">Task Mode</div><div class="v">{{ taskModeLabel }}</div></div>
            <div class="statusRow"><div class="k">Interpreter</div><div class="v">{{ interpStateLabel }}</div></div>
            <div class="statusRow"><div class="k">Work Coord</div><div class="v">{{ g5xLabel }}</div></div>
            <div class="statusRow"><div class="k">G-codes</div><div class="v codes">{{ activeGcodes }}</div></div>
            <div class="statusRow"><div class="k">M-codes</div><div class="v codes">{{ activeMcodes }}</div></div>
          </div>
        </div>

        <div class="statusChip" :class="{ warn: overridesActive }">
          <span class="chipIcon">%</span>
          <span class="chipLabel">Overrides</span>
          <span class="chipValue">{{ overridesActive ? 'ACTIVE' : 'DEFAULT' }}</span>
          <div class="popover chipPopover">
            <div class="statusRow"><div class="k">Feed</div><div class="v" :class="{ warn: feedOverrideValue !== 1.0 }">{{ feedOverride }}</div></div>
            <div class="statusRow"><div class="k">Spindle</div><div class="v" :class="{ warn: spindleOverrideValue !== 1.0 }">{{ spindleOverride }}</div></div>
            <div class="statusRow"><div class="k">Rapid</div><div class="v" :class="{ warn: rapidOverrideValue !== 1.0 }">{{ rapidOverride }}</div></div>
          </div>
        </div>
      </div>
    </section>
    </div>

    <!-- Main content column -->
    <div class="mainCol">

    <!-- Dynamic tab panels (1–4) -->
    <div class="panels">
      <div v-for="(panel, idx) in panels" :key="panel.id" class="panel"
           :class="'panel-' + panel.tab"
           :style="{ minWidth: panelMinWidth(panel.tab) }">
        <TabPanel
          :tabs="tabs"
          :modelValue="panel.tab"
          @update:modelValue="panel.tab = $event"
          :badges="tabBadges"
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
                :isHomed="isHomed"
                :maxJogVel="maxJogVel"
                :jogIncrement="jogIncrement"
                :gcodeContent="gcodeContent"
                :currentLine="currentLine"
                :isPaused="isPaused"
                :activeFile="activeFile"
                :spindleSpeed="spindleSpeed"
                :spindleActual="spindleActual"
                :spindleDirection="spindleDirection"
                :spindleOverride="spindleOverrideValue"
                :feedOverride="feedOverrideValue"
                :rapidOverride="rapidOverrideValue"
                @update:jogVel="jogVel = $event"
                @update:jogIncrement="jogIncrement = $event"
                @cycleStart="cycleStart"
                @cyclePause="cyclePause"
                @cycleResume="cycleResume"
                @abort="fire({ cmd: 'abort' })"
                @homeAll="homeAll"
                @unhomeAll="unhomeAll"
                @zeroAxis="zeroAxis"
                @zeroAll="zeroAll"
                @spindleForward="spindleForward"
                @spindleReverse="spindleReverse"
                @spindleStop="spindleStop"
                @setSpindleOverride="setSpindleOverride"
                @setFeedOverride="setFeedOverride"
                @setRapidOverride="setRapidOverride"
              />
            </Toolbar>
          </template>

          <template #dro>
            <DroPanel
              :workPos="workPos"
              :machinePos="machinePos"
              :dtg="dtg"
              :g5xLabel="g5xLabel"
              :linearUnit="linearUnit"
              :homed="isHomed"
              @zeroAxis="zeroAxis"
              @zeroAll="zeroAll"
              @setG5x="setG5x"
              @homeAll="homeAll"
              @unhomeAll="unhomeAll"
            />
          </template>

          <template #jog>
            <JogPanel :jogVel="jogVel" :isTeleop="isTeleop" :isHomed="isHomed" :linearUnit="linearUnit" :maxJogVel="maxJogVel" :activeJogKeys="jogKeys" :jogIncrement="jogIncrement" @update:jogVel="jogVel = $event" @update:jogIncrement="jogIncrement = $event" @toggleTeleop="toggleTeleop" />
          </template>

          <template #mdi>
            <MdiPanel
              :mdiText="mdiText"
              @update:mdiText="mdiText = $event"
              @send="sendMdi"
            />
          </template>

          <template #overrides>
            <OverridePanel
              :feedOverride="feedOverrideValue"
              :spindleOverride="spindleOverrideValue"
              :rapidOverride="rapidOverrideValue"
              @setFeedOverride="setFeedOverride"
              @setSpindleOverride="setSpindleOverride"
              @setRapidOverride="setRapidOverride"
            />
          </template>

          <template #spindle>
            <SpindlePanel
              :spindleSpeed="spindleSpeed"
              :spindleActual="spindleActual"
              :spindleDirection="spindleDirection"
              :spindleOverride="spindleOverrideValue"
              @spindleForward="spindleForward"
              @spindleReverse="spindleReverse"
              @spindleStop="spindleStop"
              @setSpindleOverride="setSpindleOverride"
            />
          </template>

          <template #gcode>
            <GcodePanel
              :activeFile="activeFile"
              :gcodeContent="gcodeContent"
              :currentLine="currentLine"
              :isPaused="isPaused"
              @loadFile="loadFile"
              @unloadFile="unloadFile"
              @cycleStart="cycleStart"
              @cyclePause="cyclePause"
              @cycleResume="cycleResume"
              @abort="fire({ cmd: 'abort' })"
            />
          </template>

          <template #messages>
            <MessagesPanel
              :messages="messages"
              @dismiss="dismissMessage"
              @clearAll="clearAllMessages"
            />
          </template>

          <template #settings>
            <SettingsPanel :lastReply="lastReply" :status="status" />
          </template>
        </TabPanel>
      </div>

      <button
        v-if="panels.length < maxPanels"
        class="addPanel"
        @click="addPanel"
      >+</button>
    </div>


    </div><!-- /mainCol -->
    </div><!-- /bodyLayout -->
  </div>
</template>

<style scoped>
.wrap {
  padding: 16px;
  margin: 0 auto;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}

.hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 12px;
}

.hdrRight {
  display: flex;
  gap: 10px;
  align-items: center;
}

.title {
  font-size: 20px;
  font-weight: 700;
}

.pill {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
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
}

.panel {
  min-width: 0;
  min-height: 0;
  position: relative;
  border: 1px solid var(--border);
  border-radius: 14px;
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
  border-radius: 14px;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--fg);
  font-size: 22px;
  opacity: 0.4;
  transition: opacity 0.15s, background 0.15s;
}

.addPanel:hover {
  opacity: 0.8;
  background: color-mix(in oklab, var(--panel) 50%, transparent);
}

.bodyLayout {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.mainCol {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 86px);
  overflow: hidden;
}

.topRow {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 150px;
  gap: 12px;
  margin-bottom: 0;
  position: sticky;
  top: 8px;
  z-index: 50;
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
  border-radius: 14px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--panel);
  color: var(--fg);
}

.controlGroups {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
}

.controlGroup {
  flex: 1;
  padding: 12px;
  border: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
  border-radius: 8px;
  background: color-mix(in oklab, var(--panel) 30%, transparent);
}

.groupTitle {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
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
  border-radius: 8px;
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
  font-size: 12px;
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
  color: #ffa500;
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
  border-radius: 8px;
  border: 1px solid var(--border);
  background: color-mix(in oklab, var(--panel) 30%, transparent);
  cursor: default;
  flex: 1;
  min-width: 100px;
}

.statusChip.ok { border-color: color-mix(in srgb, var(--ok) 50%, transparent); background: color-mix(in oklab, var(--ok) 20%, var(--panel)); }
.statusChip.bad { border-color: color-mix(in srgb, var(--danger) 50%, transparent); background: color-mix(in oklab, var(--danger) 20%, var(--panel)); }
.statusChip.warn { border-color: #b8860b80; animation: flash-chip-warn 1.2s ease-in-out infinite; }

@keyframes flash-chip-warn {
  0%, 100% { background: color-mix(in oklab, #b8860b 25%, var(--panel)); }
  50% { background: color-mix(in oklab, #b8860b 10%, var(--panel)); }
}

.chipIcon { display: none; font-size: 16px; }
.chipLabel { font-size: 10px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; }
.chipValue { font-size: 13px; font-weight: 600; }

.chipPopover {
  top: 0;
  left: 100%;
  margin-left: 6px;
  min-width: 200px;
}

.statusChip:hover > .chipPopover {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

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
  border-radius: 12px;
}

.btn.danger {
  border-color: color-mix(in srgb, var(--danger) 50%, transparent);
  background: color-mix(in oklab, var(--danger) 25%, var(--button-bg));
}

.btn.primary {
  border-color: color-mix(in srgb, var(--ok) 50%, transparent);
  background: color-mix(in oklab, var(--ok) 25%, var(--button-bg));
  font-weight: 600;
}

.safetyBtn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 20px;
  min-width: 80px;
}

.safetyIcon {
  font-size: 24px;
  line-height: 1;
}

.safetyLabel {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.hint {
  margin-top: 10px;
  font-size: 12px;
  opacity: 0.65;
}

.debugSection {
  margin-top: 8px;
}

.pre {
  background: color-mix(in oklab, var(--panel) 50%, transparent);
  padding: 10px;
  border-radius: 12px;
  overflow: auto;
  font-size: 11px;
  max-height: 400px;
}

/* ---- Landscape layout — panels side by side ---- */
@media (orientation: landscape) {
  .panels          { align-items: stretch; flex: 1; min-height: 0; }
  .panel           { flex: 0 0 auto; }   /* width = content */
  .panel-viewer    { flex: 1; overflow: hidden; } /* fills remaining width */
  .panel-gcode     { flex: 0.5; }        /* medium width priority */
}

/* ---- Portrait layout — panels stacked vertically ---- */
@media (orientation: portrait) {
  .mainCol         { overflow-y: auto; } /* scroll when panels exceed viewport */
  .panels          { flex-direction: column; flex: 1; min-height: 0; }
  .panel           { flex: 0 0 auto; }   /* height = content */
  .panel-viewer    { flex: 1; min-height: 500px; overflow: hidden; } /* fills remaining height, can't be crushed */
  .panel-gcode     { flex: 0 0 350px; }  /* fixed height, includes program control row */
  .panel-settings  { flex: 0 0 350px; }  /* fixed height, content scrolls */
  .panel-mdi       { flex: 0 0 350px; }  /* fixed height, history scrolls */
  .addPanel        { flex: 0 0 auto; width: 100%; height: 36px; }
}

/* ---- Responsive: narrow — icon-only sidebar ---- */
@media (max-width: 500px) {
  .topRow {
    width: 52px;
  }
  .topRow .card {
    padding: 6px;
  }
  .topRow .sub {
    display: none;
  }
  .topRow .safetyLabel {
    display: none;
  }
  .topRow .safetyBtn {
    padding: 8px 0;
    justify-content: center;
    width: 100%;
    box-sizing: border-box;
  }
  .topRow .chipLabel,
  .topRow .chipValue {
    display: none;
  }
  .topRow .chipIcon {
    display: block;
    text-align: center;
  }
  .topRow .statusChip {
    padding: 8px 0;
    justify-content: center;
  }
}

/* ---- Responsive: tablet landscape / narrow desktop (768–1199px) ---- */
@media (max-width: 1199px) and (min-width: 768px) {
  .statusGroups, .controlGroups {
    flex-wrap: wrap;
  }
  .statusGroup, .controlGroup {
    min-width: calc(50% - 6px);
  }
}
</style>
