<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { connectWs, connected, status, send, lastReply } from "./lcncWs";
import ThreeViewer from "./ThreeViewer.vue";
import Toolbar from "./Toolbar.vue";
import TabPanel from "./TabPanel.vue";
import DroPanel from "./DroPanel.vue";
import JogPanel from "./JogPanel.vue";
import MdiPanel from "./MdiPanel.vue";

onMounted(() => connectWs());

/** ---------- tab definitions ---------- */
const tabs = [
  { id: "viewer", label: "3D Viewer" },
  { id: "dro", label: "Position" },
  { id: "jog", label: "Jogging" },
  { id: "mdi", label: "MDI" },
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
const coordMode = ref<"work" | "machine">("work");
const busy = ref(false);

// Workpiece configuration
const workpieceSize = ref<[number, number, number]>([100, 100, 20]);
const workpieceOffset = ref<[number, number, number]>([0, 0, -20]); // Z offset = -height (zero at top)

/** ---------- status helpers ---------- */
const st = computed<Record<string, any>>(() => status.value?.data ?? {});

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
const pos = computed<number[]>(() => {
  const data = st.value ?? {};
  const arr = coordMode.value === "work" ? data.work_pos : data.machine_pos;
  return Array.isArray(arr) ? arr : [];
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
});

onUnmounted(() => {
  window.removeEventListener("blur", stopAllJog);
  document.removeEventListener("visibilitychange", visHandler);
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
            :workpieceSize="workpieceSize"
            :workpieceOffset="workpieceOffset"
            @update:workpieceSize="workpieceSize = $event"
            @update:workpieceOffset="workpieceOffset = $event"
          >
            <ThreeViewer
              ref="viewerL"
              :workpieceSize="workpieceSize"
              :workpieceOffset="workpieceOffset"
            />
          </Toolbar>
        </template>

        <template #dro>
          <DroPanel :pos="pos" :coordMode="coordMode" @update:coordMode="coordMode = $event" />
        </template>

        <template #jog>
          <JogPanel :jogVel="jogVel" :canJog="canJog" @update:jogVel="jogVel = $event" />
        </template>

        <template #mdi>
          <MdiPanel
            :mdiText="mdiText"
            :canMdi="canMdi"
            :busy="busy"
            :lastReply="lastReply"
            :status="status"
            @update:mdiText="mdiText = $event"
            @send="sendMdi"
          />
        </template>
      </TabPanel>

      <TabPanel :tabs="tabs" v-model="rightTab" class="panel">
        <template #viewer>
          <Toolbar
            @resetBackplot="onResetBackplotR"
            @setView="onSetViewR"
            @toggleLayer="onToggleLayerR"
            :workpieceSize="workpieceSize"
            :workpieceOffset="workpieceOffset"
            @update:workpieceSize="workpieceSize = $event"
            @update:workpieceOffset="workpieceOffset = $event"
          >
            <ThreeViewer
              ref="viewerR"
              :workpieceSize="workpieceSize"
              :workpieceOffset="workpieceOffset"
            />
          </Toolbar>
        </template>

        <template #dro>
          <DroPanel :pos="pos" :coordMode="coordMode" @update:coordMode="coordMode = $event" />
        </template>

        <template #jog>
          <JogPanel :jogVel="jogVel" :canJog="canJog" @update:jogVel="jogVel = $event" />
        </template>

        <template #mdi>
          <MdiPanel
            :mdiText="mdiText"
            :canMdi="canMdi"
            :busy="busy"
            :lastReply="lastReply"
            :status="status"
            @update:mdiText="mdiText = $event"
            @send="sendMdi"
          />
        </template>
      </TabPanel>
    </div>

    <!-- Pinned cards below -->
    <section class="card">
      <div class="sub">Machine status</div>
        <div class="row">
          <div class="k">E-Stop</div>
          <div class="v" :class="isEstop ? 'badText' : 'okText'">
            {{ isEstop ? "TRUE" : "FALSE" }}
          </div>

          <div class="k">Enabled</div>
          <div class="v" :class="isEnabled ? 'okText' : 'mutedText'">
            {{ isEnabled ? "TRUE" : "FALSE" }}
          </div>

          <div class="k">Homed</div>
          <div class="v" :class="isHomed ? 'okText' : 'badText'">
            {{ isHomed ? "TRUE" : "FALSE" }}
          </div>
        </div>
    </section>

     <section class="card">
      <div class="sub">Safety</div>

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
          Reset
        </button>

        <button class="btn" @click="fire({ cmd: 'machine_on' })" :disabled="!canMachineOn || busy">
          Machine On
        </button>

        <button class="btn" @click="fire({ cmd: 'machine_off' })" :disabled="!canMachineOff || busy">
          Machine Off
        </button>

        <button class="btn" @click="fire({ cmd: 'abort' })" :disabled="!canAbort || busy">
          Abort
        </button>
      </div>

      <div class="hint">
        MDI requires: armed + enabled + not in E-Stop.
      </div>
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

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hint {
  margin-top: 10px;
  font-size: 12px;
  opacity: 0.65;
}
</style>
