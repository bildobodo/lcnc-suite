<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { usePermissions } from "./permissions";

const STORAGE_KEY = "lcnc-toolsetter-params";

const props = defineProps<{
  probing: boolean;
  probeTripped: boolean;
  currentTool: number | null;
  machinePos: number[];
  isHomed: boolean;
}>();

const emit = defineEmits<{
  (e: "mdi", text: string): void;
  (e: "abort"): void;
  (e: "simulateProbeTrip"): void;
  (e: "setProbeVars", vars: Record<string, number>): void;
}>();

const can = usePermissions();

// ─── Parameters ──────────────────────────────────────────────────
const params = ref({
  // Transfer params (#3004-#3013)
  fastFeed: 500,
  slowFeed: 50,
  traverseFeed: 6000,
  maxZTravel: 150,
  retractDist: 2,
  spindleZeroHeight: 180,
  offsetDirection: 0,
  // Fixed params (#3100-#3116)
  touchX: 0,
  touchY: 0,
  touchZ: -180,
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

const toolNumber = ref(1);

/** Read probe tool number from probe panel's localStorage (shared via #3014) */
const probeTool = computed(() => {
  try {
    const raw = localStorage.getItem("lcnc-probe-params");
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.probeTool != null) return saved.probeTool;
    }
  } catch { /* ignore */ }
  return 99;
});

function buildVarMap(): Record<string, number> {
  const p = params.value;
  return {
    "3004": p.fastFeed,
    "3005": p.slowFeed,
    "3006": p.traverseFeed,
    "3007": p.maxZTravel,
    "3009": p.retractDist,
    "3010": p.spindleZeroHeight,
    "3013": p.offsetDirection,
    "3100": p.touchX,
    "3101": p.touchY,
    "3102": p.touchZ,
    "3103": p.useToolTable,
    "3104": p.toolMinDis,
    "3105": p.brakeAfter,
    "3106": p.goBackToStart,
    "3107": p.spindleStopM,
    "3108": p.disablePrePos,
    "3109": p.addReps,
    "3110": p.lastTry,
    "3111": p.offsetDiameter,
    "3112": p.offsetValue,
    "3113": p.finderTouchX,
    "3114": p.finderTouchY,
    "3115": p.finderDiffZ,
  };
}

function loadParams() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.toolNumber != null) toolNumber.value = saved.toolNumber;
      delete saved.toolNumber;
      Object.assign(params.value, saved);
    }
  } catch { /* ignore */ }
}

function saveParams() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, toolNumber: toolNumber.value }));
  emit("setProbeVars", buildVarMap());
}

onMounted(() => {
  loadParams();
  // Seed var file with defaults on first load
  emit("setProbeVars", buildVarMap());
});

// ─── Status ──────────────────────────────────────────────────────
const probeStatus = computed(() => {
  if (props.probing) return "PROBING";
  if (props.probeTripped) return "TRIPPED";
  return "IDLE";
});

const statusClass = computed(() => {
  if (props.probing) return "probing";
  if (props.probeTripped) return "tripped";
  return "";
});

// ─── Actions ─────────────────────────────────────────────────────
function measureAuto() {
  if (!can.value.ready || props.probing) return;
  saveParams();
  emit("mdi", `T${toolNumber.value} M600`);
}

function measureManual() {
  if (!can.value.ready || props.probing) return;
  saveParams();
  emit("mdi", `T${toolNumber.value} M601`);
}

const OFFSET_DIR_LABELS: Record<number, string> = {
  0: "X-",
  1: "X+",
  2: "Y-",
  3: "Y+",
};

const BRAKE_LABELS: Record<number, string> = {
  0: "None",
  1: "M00",
  2: "M01",
};

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "---";
  return n.toFixed(4);
}
</script>

<template>
  <div class="tsPanel scroll-thin">
    <!-- Tool selection + action bar -->
    <div class="section">
      <div class="sub">Tool Measurement</div>
      <div class="actionRow">
        <label class="toolInput">
          <span class="toolLabel">Tool #</span>
          <input
            type="number"
            v-model.number="toolNumber"
            min="1"
            step="1"
            :disabled="!can.ready || probing"
            @change="saveParams"
          />
        </label>
        <button
          class="measureBtn"
          :disabled="!can.ready || probing"
          @click="measureAuto"
        >Measure</button>
        <button
          class="manualBtn"
          :disabled="!can.ready || probing"
          @click="measureManual"
        >Manual</button>
        <button
          class="abortBtn"
          :disabled="!probing"
          @click="emit('abort')"
        >Abort</button>
        <button
          class="simTripBtn"
          :disabled="!probing"
          @click="emit('simulateProbeTrip')"
          title="Simulate probe contact (sim/debug only)"
        >Sim Trip</button>
      </div>
    </div>

    <!-- Status bar -->
    <div class="controlBar">
      <div class="statusRow">
        <span class="statusDot" :class="statusClass"></span>
        <span class="statusText">{{ probeStatus }}</span>
      </div>
      <div class="controlBarRight">
        <div class="currentTool" v-if="currentTool != null">
          Loaded: <b>T{{ currentTool }}</b>
        </div>
      </div>
    </div>

    <div class="sep"></div>

    <!-- Toolsetter Position -->
    <div class="section">
      <div class="sub">Toolsetter Position (G53)</div>
      <div class="paramGrid">
        <label>Touch X <span class="varNum">#3100</span></label>
        <input type="number" v-model.number="params.touchX" step="0.001" :disabled="!can.ready" @change="saveParams" />

        <label>Touch Y <span class="varNum">#3101</span></label>
        <input type="number" v-model.number="params.touchY" step="0.001" :disabled="!can.ready" @change="saveParams" />

        <label>Touch Z <span class="varNum">#3102</span></label>
        <input type="number" v-model.number="params.touchZ" step="0.001" :disabled="!can.ready" @change="saveParams" />
      </div>
    </div>

    <div class="sep"></div>

    <!-- Probe Settings -->
    <div class="section">
      <div class="sub">Probe Settings</div>
      <div class="paramGrid">
        <label>Fast Feed <span class="varNum">#3004</span></label>
        <input type="number" v-model.number="params.fastFeed" min="1" step="10" :disabled="!can.ready" @change="saveParams" />

        <label>Slow Feed <span class="varNum">#3005</span></label>
        <input type="number" v-model.number="params.slowFeed" min="0" step="1" :disabled="!can.ready" @change="saveParams" />

        <label>Traverse Feed <span class="varNum">#3006</span></label>
        <input type="number" v-model.number="params.traverseFeed" min="1" step="100" :disabled="!can.ready" @change="saveParams" />

        <label>Max Z Travel <span class="varNum">#3007</span></label>
        <input type="number" v-model.number="params.maxZTravel" min="1" step="5" :disabled="!can.ready" @change="saveParams" />

        <label>Retract Dist <span class="varNum">#3009</span></label>
        <input type="number" v-model.number="params.retractDist" min="0.1" step="0.5" :disabled="!can.ready" @change="saveParams" />

        <label>Spindle Zero H <span class="varNum">#3010</span></label>
        <input type="number" v-model.number="params.spindleZeroHeight" min="0" step="1" :disabled="!can.ready" @change="saveParams" />
      </div>
    </div>

    <div class="sep"></div>

    <!-- Options -->
    <div class="section">
      <div class="sub">Options</div>
      <div class="optionsGrid">
        <label class="checkRow">
          <input type="checkbox" :checked="params.useToolTable === 1" :disabled="!can.ready" @change="params.useToolTable = ($event.target as HTMLInputElement).checked ? 1 : 0; saveParams()" />
          Use Tool Table <span class="varNum">#3103</span>
        </label>
        <label class="checkRow">
          <input type="checkbox" :checked="params.goBackToStart === 1" :disabled="!can.ready" @change="params.goBackToStart = ($event.target as HTMLInputElement).checked ? 1 : 0; saveParams()" />
          Return to Start <span class="varNum">#3106</span>
        </label>
        <label class="checkRow">
          <input type="checkbox" :checked="params.disablePrePos === 1" :disabled="!can.ready" @change="params.disablePrePos = ($event.target as HTMLInputElement).checked ? 1 : 0; saveParams()" />
          Skip G30 Pre-Pos <span class="varNum">#3108</span>
        </label>
        <label class="checkRow">
          <input type="checkbox" :checked="params.lastTry === 1" :disabled="!can.ready" @change="params.lastTry = ($event.target as HTMLInputElement).checked ? 1 : 0; saveParams()" />
          Last Try w/o Table <span class="varNum">#3110</span>
        </label>
      </div>

      <div class="paramGrid">
        <label>Tool Min Dist <span class="varNum">#3104</span></label>
        <input type="number" v-model.number="params.toolMinDis" min="0" step="1" :disabled="!can.ready" @change="saveParams" />

        <label>Extra Retries <span class="varNum">#3109</span></label>
        <input type="number" v-model.number="params.addReps" min="0" step="1" :disabled="!can.ready" @change="saveParams" />

        <label>Brake After <span class="varNum">#3105</span></label>
        <div class="dirRow">
          <button
            v-for="b in [0, 1, 2]"
            :key="b"
            class="dirBtn"
            :class="{ active: params.brakeAfter === b }"
            :disabled="!can.ready"
            @click="params.brakeAfter = b; saveParams()"
          >{{ BRAKE_LABELS[b] }}</button>
        </div>

        <label>Spindle Stop <span class="varNum">#3107</span></label>
        <div class="dirRow">
          <button class="dirBtn" :class="{ active: params.spindleStopM === 5 }" :disabled="!can.ready" @click="params.spindleStopM = 5; saveParams()">M5</button>
          <button class="dirBtn" :class="{ active: params.spindleStopM === 500 }" :disabled="!can.ready" @click="params.spindleStopM = 500; saveParams()">M500</button>
        </div>

        <label>Offset Dir <span class="varNum">#3013</span></label>
        <div class="dirRow">
          <button
            v-for="d in [0, 1, 2, 3]"
            :key="d"
            class="dirBtn"
            :class="{ active: params.offsetDirection === d }"
            :disabled="!can.ready"
            @click="params.offsetDirection = d; saveParams()"
          >{{ OFFSET_DIR_LABELS[d] }}</button>
        </div>
      </div>
    </div>

    <div class="sep"></div>

    <!-- Diameter Offset -->
    <div class="section">
      <div class="sub">Diameter Offset</div>
      <div class="paramGrid">
        <label>Min Diameter <span class="varNum">#3111</span></label>
        <input type="number" v-model.number="params.offsetDiameter" min="0" step="1" :disabled="!can.ready" @change="saveParams" />

        <label>Offset % <span class="varNum">#3112</span></label>
        <input type="number" v-model.number="params.offsetValue" min="0" max="100" step="5" :disabled="!can.ready" @change="saveParams" />
      </div>
    </div>

    <div class="sep"></div>

    <!-- Edge-Finder -->
    <div class="section">
      <div class="sub">Edge-Finder</div>
      <div class="paramGrid">
        <label>Probe Tool # <span class="varNum">#3014</span></label>
        <span class="readonlyVal">T{{ probeTool }} <span class="varNum">(set in Probe tab)</span></span>

        <label>Finder X <span class="varNum">#3113</span></label>
        <input type="number" v-model.number="params.finderTouchX" step="0.001" :disabled="!can.ready" @change="saveParams" />

        <label>Finder Y <span class="varNum">#3114</span></label>
        <input type="number" v-model.number="params.finderTouchY" step="0.001" :disabled="!can.ready" @change="saveParams" />

        <label>Finder Z Diff <span class="varNum">#3115</span></label>
        <input type="number" v-model.number="params.finderDiffZ" step="0.001" :disabled="!can.ready" @change="saveParams" />
      </div>
    </div>

    <div class="sep"></div>

    <!-- Current state -->
    <div class="section">
      <div class="sub">Machine State</div>
      <div class="stateGrid">
        <div class="stateCell"><span class="stateLabel">Machine Z</span><span class="stateVal">{{ fmt(machinePos[2]) }}</span></div>
        <div class="stateCell"><span class="stateLabel">Tool</span><span class="stateVal">{{ currentTool != null ? `T${currentTool}` : '---' }}</span></div>
        <div class="stateCell"><span class="stateLabel">Homed</span><span class="stateVal">{{ isHomed ? 'Yes' : 'No' }}</span></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tsPanel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  height: 100%;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sub {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sep {
  border-top: 1px solid var(--border);
  opacity: 0.3;
}

/* Action row */
.actionRow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.toolInput {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toolLabel {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.toolInput input {
  width: 70px;
  padding: 6px 8px;
  font-size: 14px;
  font-weight: 600;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  border-radius: 6px;
  text-align: center;
}

.measureBtn {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  background: color-mix(in oklab, var(--ok) 20%, var(--button-bg));
  border-color: color-mix(in oklab, var(--ok) 30%, var(--border));
  color: var(--ok);
}

.measureBtn:disabled {
  opacity: 0.35;
  color: var(--fg);
  background: var(--button-bg);
  border-color: var(--border);
}

.manualBtn {
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
}

.abortBtn {
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  background: color-mix(in oklab, var(--danger) 20%, var(--button-bg));
  border-color: color-mix(in oklab, var(--danger) 30%, var(--border));
  color: var(--danger);
}

.abortBtn:disabled {
  opacity: 0.3;
  color: var(--fg);
  background: var(--button-bg);
  border-color: var(--border);
}

/* Control bar */
.controlBar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}

.statusRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.statusDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border);
}

.statusDot.probing {
  background: var(--warn);
  animation: pulse 0.8s ease-in-out infinite alternate;
}

.statusDot.tripped {
  background: var(--ok);
}

@keyframes pulse {
  from { opacity: 0.4; }
  to { opacity: 1; }
}

.statusText {
  font-size: 11px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  opacity: 0.7;
}

.controlBarRight {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.currentTool {
  font-size: 12px;
  opacity: 0.7;
}

.currentTool b {
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
}

.simTripBtn {
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  background: color-mix(in oklab, #6c63ff 15%, var(--button-bg));
  border-color: color-mix(in oklab, #6c63ff 30%, var(--border));
  color: #6c63ff;
  font-style: italic;
}

.simTripBtn:disabled {
  opacity: 0.3;
  color: var(--fg);
  background: var(--button-bg);
  border-color: var(--border);
  font-style: normal;
}

/* Parameters */
.paramGrid {
  display: grid;
  grid-template-columns: auto 1fr auto 1fr;
  gap: 6px 10px;
  align-items: center;
}

.paramGrid label {
  font-size: 11px;
  opacity: 0.7;
}

.varNum {
  opacity: 0.4;
  font-size: 10px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
}

.readonlyVal {
  font-size: 12px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-weight: 600;
  opacity: 0.7;
}

.paramGrid input {
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
  max-width: 100px;
}

/* Options checkboxes */
.optionsGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
}

.checkRow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

/* Direction / toggle selectors */
.dirRow {
  display: flex;
  gap: 3px;
}

.dirBtn {
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  opacity: 0.6;
}

.dirBtn.active {
  opacity: 1;
  background: color-mix(in oklab, var(--fg) 15%, var(--button-bg));
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

/* State grid */
.stateGrid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 4px;
}

.stateCell {
  display: flex;
  flex-direction: column;
  padding: 4px 6px;
  border-radius: 4px;
  background: color-mix(in oklab, var(--fg) 4%, var(--bg));
  border: 1px solid var(--border);
}

.stateLabel {
  font-size: 10px;
  font-weight: 600;
  opacity: 0.5;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.stateVal {
  font-size: 13px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-weight: 600;
}
</style>
