<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { connectWs, connected, status, send, lastReply, viewerGcode, lcncError } from "./lcncWs";
import ThreeViewer from "./ThreeViewer.vue";
import Toolbar from "./Toolbar.vue";
import TabPanel from "./TabPanel.vue";
import DroPanel from "./DroPanel.vue";
import JogPanel from "./JogPanel.vue";
import MdiPanel from "./MdiPanel.vue";
import GcodePanel from "./GcodePanel.vue";
import OverridePanel from "./OverridePanel.vue";
import SettingsPanel from "./SettingsPanel.vue";

type Layer = "backplot" | "toolpath" | "machine" | "workpiece" | "bounds" | "workzero" | "hud";
const ALL_LAYERS: Layer[] = ["backplot", "toolpath", "machine", "workpiece", "bounds", "workzero", "hud"];

/** Load startup defaults from localStorage (shared with SettingsPanel) */
function loadDefaults() {
  const fallback = {
    workpieceSize: [100, 100, 20] as [number, number, number],
    workpieceOffset: [0, 0, -20] as [number, number, number],
    layers: { backplot: true, toolpath: true, machine: true, workpiece: true, bounds: true, workzero: true, hud: true } as Record<Layer, boolean>,
    colors: { feed: "#22b8cf", rapid: "#f5a623", backplot: "#ff00ff", bounds: "#ffffff", workpiece: "#ffffff", tool: "#ffdd00" },
    opacities: { workpiece: 0.16, bounds: 0.10, machine: 1.0, toolpath: 1.0, backplot: 0.55, hud: 1.0 },
  };
  try {
    const raw = localStorage.getItem("lcnc-defaults");
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        workpieceSize: (parsed.workpieceSize ?? [...fallback.workpieceSize]) as [number, number, number],
        workpieceOffset: (parsed.workpieceOffset ?? [...fallback.workpieceOffset]) as [number, number, number],
        layers: { ...fallback.layers, ...parsed.layers } as Record<Layer, boolean>,
        colors: { ...fallback.colors, ...parsed.colors },
        opacities: { ...fallback.opacities, ...parsed.opacities },
      };
    }
  } catch { /* ignore */ }
  return { ...fallback, workpieceSize: [...fallback.workpieceSize] as [number, number, number], workpieceOffset: [...fallback.workpieceOffset] as [number, number, number], layers: { ...fallback.layers }, colors: { ...fallback.colors }, opacities: { ...fallback.opacities } };
}

const defaults = loadDefaults();

onMounted(() => connectWs());

/** ---------- tab definitions ---------- */
const tabs = [
  { id: "viewer", label: "3D Viewer" },
  { id: "dro", label: "DRO" },
  { id: "jog", label: "Jogging" },
  { id: "mdi", label: "MDI" },
  { id: "overrides", label: "Overrides" },
  { id: "gcode", label: "G-code" },
  { id: "settings", label: "Settings" },
];

const leftTab = ref("viewer");
const rightTab = ref("dro");

/** ---------- dual viewer refs ---------- */
const viewerL = ref<InstanceType<typeof ThreeViewer> | null>(null);
const viewerR = ref<InstanceType<typeof ThreeViewer> | null>(null);

function onResetBackplotL() { viewerL.value?.resetBackplot?.(); }
function onSetViewL(preset: any) { viewerL.value?.setView?.(preset); }
function onToggleLayerL(layer: string, on: boolean) { viewerL.value?.setLayerVisible?.(layer, on); }

function onResetBackplotR() { viewerR.value?.resetBackplot?.(); }
function onSetViewR(preset: any) { viewerR.value?.setView?.(preset); }
function onToggleLayerR(layer: string, on: boolean) { viewerR.value?.setLayerVisible?.(layer, on); }

/** ---------- local UI state ---------- */
const armed = ref(false);
const mdiText = ref("G0 X0 Y0");
const busy = ref(false);

// Workpiece configuration (initialized from saved defaults)
const workpieceSize = ref<[number, number, number]>(defaults.workpieceSize);
const workpieceOffset = ref<[number, number, number]>(defaults.workpieceOffset);

// G-code viewer
const gcodeContent = ref<string | null>(null);

/** ---------- status helpers ---------- */
const st = computed<Record<string, any>>(() => status.value?.data ?? {});

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

const canAbort = computed(() => armed.value);
const canMdi = computed(() => armed.value && !isEstop.value && isEnabled.value);

const isHomed = computed(() => {
  const h = st.value.homed;
  if (Array.isArray(h)) return h.every(Boolean);
  return !!h;
});

// LinuxCNC interpreter states: IDLE=1, READING=2, PAUSED=3, WAITING=4
const interpState = computed(() => st.value.interp_state ?? 1);
const isPaused = computed(() => interpState.value === 3); // INTERP_PAUSED
const isRunning = computed(() => interpState.value === 2 || interpState.value === 4); // INTERP_READING or INTERP_WAITING
const isIdle = computed(() => interpState.value === 1); // INTERP_IDLE

const canCycleStart = computed(() =>
  armed.value && !isEstop.value && isEnabled.value && activeFile.value && (isIdle.value || (!isRunning.value && !isPaused.value))
);
const canCyclePause = computed(() =>
  armed.value && isEnabled.value && isRunning.value && !isPaused.value
);
const canCycleResume = computed(() =>
  armed.value && isEnabled.value && isPaused.value
);

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

// Task mode: MANUAL=1, AUTO=2, MDI=3
const taskModeLabel = computed(() => {
  const mode = st.value.task_mode;
  if (mode === 1) return "MANUAL";
  if (mode === 2) return "AUTO";
  if (mode === 3) return "MDI";
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


/** ---------- actions ---------- */
function arm(v: boolean) {
  armed.value = v;
  send({ cmd: "arm", armed: v });
}

/** ---------- local UI jog ---------- */
const jogVel = ref(10);

const canJog = computed(() => armed.value && !isEstop.value && isEnabled.value);


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

/** ---------- safety: stop jog on focus loss ---------- */
function stopAllJog() {
  send({ cmd: "jog_stop", axis: 0 });
  send({ cmd: "jog_stop", axis: 1 });
  send({ cmd: "jog_stop", axis: 2 });
}

function visHandler() {
  if (document.hidden) stopAllJog();
}

onMounted(() => {
  window.addEventListener("blur", stopAllJog);
  document.addEventListener("visibilitychange", visHandler);

  // Apply saved layer defaults after viewers are mounted
  nextTick(() => {
    for (const layer of ALL_LAYERS) {
      const on = defaults.layers[layer];
      viewerL.value?.setLayerVisible?.(layer, on);
      viewerR.value?.setLayerVisible?.(layer, on);
    }
  });
});

onUnmounted(() => {
  window.removeEventListener("blur", stopAllJog);
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
</script>

<template>
  <div class="wrap">
    <header class="hdr">
      <div class="title">LinuxCNC WebUI (local)</div>

      <div class="hdrRight">
        <div class="pill" :class="connected ? 'ok' : 'bad'">
          {{ connected ? "WS connected" : "WS disconnected" }}
        </div>

        <div class="pill" :class="lcncError ? 'bad' : (configName ? 'ok' : '')">
          {{ lcncLabel }}
        </div>

        <div class="pill" :class="armed ? 'armed' : 'disarmed'">
          {{ armed ? "ARMED" : "DISARMED" }}
        </div>
      </div>
    </header>

    <!-- Dual tab panels -->
    <div class="panels">
      <TabPanel :tabs="tabs" v-model="leftTab" class="panel">
        <template #viewer>
          <Toolbar
            @resetBackplot="onResetBackplotL"
            @setView="onSetViewL"
            @toggleLayer="onToggleLayerL"
            :layerDefaults="defaults.layers"
            :workpieceSize="workpieceSize"
            :workpieceOffset="workpieceOffset"
            @update:workpieceSize="workpieceSize = $event"
            @update:workpieceOffset="workpieceOffset = $event"
          >
            <ThreeViewer
              ref="viewerL"
              :workpieceSize="workpieceSize"
              :workpieceOffset="workpieceOffset"
              :colors="defaults.colors"
              :opacities="defaults.opacities"
              :g5xLabel="g5xLabel"
            />
          </Toolbar>
        </template>

        <template #dro>
          <DroPanel
            :workPos="workPos"
            :machinePos="machinePos"
            :dtg="dtg"
            :g5xLabel="g5xLabel"
            :armed="armed"
            :busy="busy"
            :homed="isHomed"
            @zeroAxis="zeroAxis"
            @zeroAll="zeroAll"
            @setG5x="setG5x"
            @homeAll="homeAll"
            @unhomeAll="unhomeAll"
          />
        </template>

        <template #jog>
          <JogPanel :jogVel="jogVel" :canJog="canJog" @update:jogVel="jogVel = $event" />
        </template>

        <template #mdi>
          <MdiPanel
            :mdiText="mdiText"
            :canMdi="canMdi"
            :busy="busy"
            @update:mdiText="mdiText = $event"
            @send="sendMdi"
          />
        </template>

        <template #overrides>
          <OverridePanel
            :feedOverride="feedOverrideValue"
            :spindleOverride="spindleOverrideValue"
            :rapidOverride="rapidOverrideValue"
            :armed="armed"
            :busy="busy"
            @setFeedOverride="setFeedOverride"
            @setSpindleOverride="setSpindleOverride"
            @setRapidOverride="setRapidOverride"
          />
        </template>

        <template #gcode>
          <GcodePanel
            :activeFile="activeFile"
            :gcodeContent="gcodeContent"
            :currentLine="currentLine"
          />
        </template>

        <template #settings>
          <SettingsPanel />
        </template>
      </TabPanel>

      <TabPanel :tabs="tabs" v-model="rightTab" class="panel">
        <template #viewer>
          <Toolbar
            @resetBackplot="onResetBackplotR"
            @setView="onSetViewR"
            @toggleLayer="onToggleLayerR"
            :layerDefaults="defaults.layers"
            :workpieceSize="workpieceSize"
            :workpieceOffset="workpieceOffset"
            @update:workpieceSize="workpieceSize = $event"
            @update:workpieceOffset="workpieceOffset = $event"
          >
            <ThreeViewer
              ref="viewerR"
              :workpieceSize="workpieceSize"
              :workpieceOffset="workpieceOffset"
              :colors="defaults.colors"
              :opacities="defaults.opacities"
            />
          </Toolbar>
        </template>

        <template #dro>
          <DroPanel
            :workPos="workPos"
            :machinePos="machinePos"
            :dtg="dtg"
            :g5xLabel="g5xLabel"
            :armed="armed"
            :busy="busy"
            :homed="isHomed"
            @zeroAxis="zeroAxis"
            @zeroAll="zeroAll"
            @setG5x="setG5x"
            @homeAll="homeAll"
            @unhomeAll="unhomeAll"
          />
        </template>

        <template #jog>
          <JogPanel :jogVel="jogVel" :canJog="canJog" @update:jogVel="jogVel = $event" />
        </template>

        <template #mdi>
          <MdiPanel
            :mdiText="mdiText"
            :canMdi="canMdi"
            :busy="busy"
            @update:mdiText="mdiText = $event"
            @send="sendMdi"
          />
        </template>

        <template #overrides>
          <OverridePanel
            :feedOverride="feedOverrideValue"
            :spindleOverride="spindleOverrideValue"
            :rapidOverride="rapidOverrideValue"
            :armed="armed"
            :busy="busy"
            @setFeedOverride="setFeedOverride"
            @setSpindleOverride="setSpindleOverride"
            @setRapidOverride="setRapidOverride"
          />
        </template>

        <template #gcode>
          <GcodePanel
            :activeFile="activeFile"
            :gcodeContent="gcodeContent"
            :currentLine="currentLine"
          />
        </template>

        <template #settings>
          <SettingsPanel />
        </template>
      </TabPanel>
    </div>

    <!-- Pinned cards below -->
    <section class="card">
      <div class="sub">Machine Status</div>

      <div class="statusGroups">
        <div class="statusGroup">
          <div class="groupTitle">Machine State</div>
          <div class="statusRow">
            <div class="k">E-Stop</div>
            <div class="v" :class="isEstop ? 'badText' : 'okText'">
              {{ isEstop ? "TRUE" : "FALSE" }}
            </div>
          </div>
          <div class="statusRow">
            <div class="k">Enabled</div>
            <div class="v" :class="isEnabled ? 'okText' : 'mutedText'">
              {{ isEnabled ? "TRUE" : "FALSE" }}
            </div>
          </div>
          <div class="statusRow">
            <div class="k">Homed</div>
            <div class="v" :class="isHomed ? 'okText' : 'badText'">
              {{ isHomed ? "TRUE" : "FALSE" }}
            </div>
          </div>
        </div>

        <div class="statusGroup">
          <div class="groupTitle">Program State</div>
          <div class="statusRow">
            <div class="k">Task Mode</div>
            <div class="v">{{ taskModeLabel }}</div>
          </div>
          <div class="statusRow">
            <div class="k">Interpreter</div>
            <div class="v" :class="isRunning ? 'okText' : (isPaused ? 'warnText' : '')">
              {{ interpStateLabel }}
            </div>
          </div>
          <div class="statusRow">
            <div class="k">Work Coord</div>
            <div class="v">{{ g5xLabel }}</div>
          </div>
        </div>

        <div class="statusGroup">
          <div class="groupTitle">Overrides</div>
          <div class="statusRow">
            <div class="k">Feed</div>
            <div class="v">{{ feedOverride }}</div>
          </div>
          <div class="statusRow">
            <div class="k">Spindle</div>
            <div class="v">{{ spindleOverride }}</div>
          </div>
          <div class="statusRow">
            <div class="k">Rapid</div>
            <div class="v">{{ rapidOverride }}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="sub">Control</div>

      <div class="controlGroups">
        <div class="controlGroup">
          <div class="groupTitle">Machine Safety</div>
          <div class="btnrow">
            <button class="btn" @click="arm(true)" :disabled="armed || busy">
              Arm
            </button>
            <button class="btn" @click="arm(false)" :disabled="!armed || busy">
              Disarm
            </button>

            <div class="sep"></div>

            <button class="btn danger" @click="fire({ cmd: 'estop' })" :disabled="!canEstop || busy">
              E-Stop
            </button>

            <button
              class="btn"
              @click="fire({ cmd: 'estop_reset' })"
              :disabled="!canResetEstop || busy"
            >
              Reset E-Stop
            </button>

            <div class="sep"></div>

            <button class="btn" @click="fire({ cmd: 'machine_on' })" :disabled="!canMachineOn || busy">
              Machine On
            </button>

            <button class="btn" @click="fire({ cmd: 'machine_off' })" :disabled="!canMachineOff || busy">
              Machine Off
            </button>
          </div>
        </div>

        <div class="controlGroup">
          <div class="groupTitle">Program Control</div>
          <div class="btnrow">
            <button class="btn primary" @click="cycleStart" :disabled="!canCycleStart || busy">
              Cycle Start
            </button>

            <button class="btn" @click="cyclePause" :disabled="!canCyclePause || busy">
              Pause
            </button>

            <button class="btn" @click="cycleResume" :disabled="!canCycleResume || busy">
              Resume
            </button>

            <div class="sep"></div>

            <button class="btn" @click="fire({ cmd: 'abort' })" :disabled="!canAbort || busy">
              Abort
            </button>
          </div>
        </div>
      </div>

      <div class="hint">
        Arm to enable controls. Cycle Start runs loaded G-code. Abort stops program execution.
      </div>
    </section>

    <!-- Debug widget -->
    <section class="card">
      <details>
        <summary class="sub" style="cursor: pointer">Debug</summary>

        <div class="debugSection">
          <div class="sub" style="margin-top: 10px">Last reply</div>
          <pre class="pre">{{ lastReply }}</pre>

          <div class="sub" style="margin-top: 10px">Raw status</div>
          <pre class="pre">{{ status }}</pre>
        </div>
      </details>
    </section>
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
  background: color-mix(in oklab, #b00020 10%, var(--panel));
}

.pill.armed {
  background: color-mix(in oklab, #0a7a0a 12%, var(--panel));
}

.pill.disarmed {
  background: color-mix(in oklab, var(--panel) 92%, transparent);
}

.panels {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.panel {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px;
  background: var(--panel);
  color: var(--fg);
}

.card {
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--panel);
  color: var(--fg);
}

.sub {
  font-size: 12px;
  opacity: 0.65;
  margin-bottom: 8px;
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
  font-weight: 650;
}

.okText {
  color: #0a7a0a;
}

.badText {
  color: #b00020;
}

.warnText {
  color: #ffa500;
}

.mutedText {
  opacity: 0.7;
}

.btnrow {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.sep {
  width: 1px;
  height: 26px;
  background: var(--border);
  margin: 0 2px;
}

.btn {
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
}

.btn.danger {
  border-color: #b0002030;
  background: #b0002008;
}

.btn.primary {
  border-color: #0a7a0a30;
  background: #0a7a0a12;
  font-weight: 600;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
</style>
