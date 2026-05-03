<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { usePermissions } from "./permissions";
import {
  loadToolsetterDefaults, saveToolsetterDefaults,
  loadProbeDefaults, settingsVersion,
  STEP_DEFAULT, STEP_FEED,
} from "./defaults";
import { buildToolsetterVarMap } from "./toolsetterVars";
import { fetchG30 } from "./lcncApi";
import { status } from "./lcncWs";
import MachineInput from "./MachineInput.vue";
import MachineToggle from "./MachineToggle.vue";
import MachineRadio from "./MachineRadio.vue";
import MachineBtn from "./MachineBtn.vue";
import HelpIcon from "./HelpIcon.vue";

const emit = defineEmits<{
  (e: "setProbeVars", vars: Record<string, number>): void;
  (e: "mdi", text: string): void;
  (e: "resetSection", section: string): void;
}>();

const can = usePermissions();

const OFFSET_DIR_LABELS: Record<number, string> = { 0: "X-", 1: "X+", 2: "Y-", 3: "Y+" };
const BRAKE_LABELS: Record<number, string> = { 0: "None", 1: "M00", 2: "M01" };

const probeTool = computed(() => loadProbeDefaults().probeTool);

// ─── Toolsetter params ─────────────────────
const tsParams = ref({
  fastFeed: 500,
  slowFeed: 50,
  traverseFeed: 6000,
  maxZTravel: 150,
  retractDist: 2,
  spindleZeroHeight: 180,
  offsetDirection: 0,
  touchX: 0,
  touchY: 0,
  touchZ: 0,
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

function loadTsParams() {
  Object.assign(tsParams.value, loadToolsetterDefaults());
}

function saveTsParams() {
  saveToolsetterDefaults({ ...tsParams.value });
  if (can.value.ready) emit("setProbeVars", buildToolsetterVarMap());
}

// ─── Toolsetter boolean wrappers (0/1 ↔ boolean) ───
const tsUseToolTable = computed({ get: () => tsParams.value.useToolTable === 1, set: (v: boolean) => { tsParams.value.useToolTable = v ? 1 : 0; saveTsParams(); } });
const tsGoBackToStart = computed({ get: () => tsParams.value.goBackToStart === 1, set: (v: boolean) => { tsParams.value.goBackToStart = v ? 1 : 0; saveTsParams(); } });
const tsDisablePrePos = computed({ get: () => tsParams.value.disablePrePos === 1, set: (v: boolean) => { tsParams.value.disablePrePos = v ? 1 : 0; saveTsParams(); } });
const tsLastTry = computed({ get: () => tsParams.value.lastTry === 1, set: (v: boolean) => { tsParams.value.lastTry = v ? 1 : 0; saveTsParams(); } });

// ─── G30 tool change position ────────────────
const g30X = ref<number | null>(null);
const g30Y = ref<number | null>(null);
const g30Z = ref<number | null>(null);
const g30Loading = ref(false);
const g30Error = ref<string | null>(null);

async function loadG30() {
  g30Loading.value = true;
  g30Error.value = null;
  try {
    const data = await fetchG30();
    if (data.ok) {
      g30X.value = data.x;
      g30Y.value = data.y;
      g30Z.value = data.z;
    } else {
      g30Error.value = data.error || "G30 read failed";
    }
  } catch (e: any) {
    g30Error.value = e?.message ?? String(e);
  } finally {
    g30Loading.value = false;
  }
}

function setG30() {
  if (!can.value.ready) return;
  emit("mdi", "G30.1");
  // After G30.1 saves current position, read back from machine position
  const st = status.value as any;
  if (st?.position) {
    g30X.value = st.position[0];
    g30Y.value = st.position[1];
    g30Z.value = st.position[2];
  }
}

onMounted(() => {
  loadTsParams();
  loadG30();
});

watch(settingsVersion, () => { loadTsParams(); });
</script>

<template>
  <div class="paramGrid twoCol tsPanel">
    <!-- Toolsetter Position -->
    <div class="sub span">Toolsetter Position (G53)</div>
    <label>Touch X<HelpIcon>X position (G53 machine coordinates) of the toolsetter button center. Jog to the button with no tool, read the machine X position. (#3100)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.touchX" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Touch Y<HelpIcon>Y position (G53 machine coordinates) of the toolsetter button center. Jog to the button with no tool, read the machine Y position. (#3101)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.touchY" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Touch Z<HelpIcon>Z approach height (G53) above the toolsetter button. The tool moves to this height before probing downward. Set above the button top plus clearance. (#3102)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.touchZ" :step="STEP_DEFAULT" @change="saveTsParams" />

    <div class="sep span"></div>

    <!-- Tool Change Position (G30) -->
    <div class="sub span" title="G30 tool change position — where the machine moves before a tool change (M6). Read-only, set in the LinuxCNC var file. (#5181–#5183)">Tool Change Position (G30)</div>
    <label>X</label>
    <span class="mono">{{ g30X != null ? g30X.toFixed(3) : '—' }}</span>
    <label>Y</label>
    <span class="mono">{{ g30Y != null ? g30Y.toFixed(3) : '—' }}</span>
    <label>Z</label>
    <span class="mono">{{ g30Z != null ? g30Z.toFixed(3) : '—' }}</span>
    <div class="row-tight span">
      <MachineBtn type="probe" @click="setG30">Set Current Position</MachineBtn>
      <MachineBtn type="inlineMd" @click="loadG30" :disabled="g30Loading">Refresh</MachineBtn>
    </div>
    <div v-if="g30Error" class="span errorText">G30 read failed: {{ g30Error }}</div>

    <div class="sep span"></div>

    <!-- Probe Settings -->
    <div class="sub span">Probe Settings</div>
    <label>Fast Feed<HelpIcon>Feed rate for the initial fast probe approach to the touch plate. Higher values reduce cycle time but lower repeatability. (#3004)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.fastFeed" min="1" :step="STEP_FEED" @change="saveTsParams" />
    <label>Slow Feed<HelpIcon>Feed rate for the refined slow measurement pass after retract. Set to 0 to skip the slow pass — faster but less accurate. (#3005)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.slowFeed" min="0" :step="STEP_FEED" @change="saveTsParams" />
    <label>Traverse Feed<HelpIcon>Feed rate for non-probing positioning moves (travel to touch plate, retract, return). Does not affect measurement accuracy. (#3006)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.traverseFeed" min="1" :step="STEP_FEED" @change="saveTsParams" />
    <label>Max Z Travel<HelpIcon>Maximum downward travel before the probe aborts if no contact. Safety limit to prevent crashes if the touch plate is missing. (#3007)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.maxZTravel" min="1" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Retract Dist<HelpIcon>Distance the tool retracts upward after fast probe contact before the slow pass begins. The slow pass probes 2× this distance. (#3009)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.retractDist" min="0.1" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Spindle Zero H<HelpIcon>G53 Z distance from spindle nose to touch plate surface with no tool loaded. Reference for zero-length tools. Measure carefully during initial setup. (#3010)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.spindleZeroHeight" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />

    <div class="sep span"></div>

    <!-- Options -->
    <div class="sub span">Options</div>
    <label>Tool Min Dist<HelpIcon>Safety clearance between the expected tool tip position and the touch plate when using tool table pre-positioning. Increase for widely varying tool lengths. (#3104)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.toolMinDis" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Extra Retries<HelpIcon>Number of extra retry attempts if probe contact fails. Each failure pauses for operator correction before retrying. Set to 0 for ATC. (#3109)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.addReps" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />
    <div class="toggleGrid span">
      <MachineToggle gate="toolsetterParam" v-model="tsUseToolTable" label="Use Tool Table" title="When enabled, uses the tool table length to calculate a closer probe start height — faster for known tools. Disable during initial setup or if tool table data is unreliable. (#3103)" />
      <MachineToggle gate="toolsetterParam" v-model="tsGoBackToStart" label="Return to Start" title="After measurement, return to the XYZ position where M600 was called. Disable only if the tool change is at the end of a program. (#3106)" />
      <MachineToggle gate="toolsetterParam" v-model="tsDisablePrePos" label="Skip G30 Pre-Pos" title="Skip the G30 pre-positioning move before traveling to the touch plate. Faster, but risks collision with clamps or fixtures on uncluttered machines only. (#3108)" />
      <MachineToggle gate="toolsetterParam" v-model="tsLastTry" label="Last Try w/o Table" title="On the final retry attempt, ignore tool table offsets and use spindle zero height instead. Provides a fallback for tools with incorrect table entries. (#3110)" />
    </div>
    <label>Brake After<HelpIcon>Pause after tool measurement: None = continue immediately, M00 = mandatory stop (press Cycle Start to resume), M01 = optional stop (active only when block delete is off). (#3105)</HelpIcon></label>
    <div class="radioGroup inline spanRow">
      <label v-for="b in [0, 1, 2]" :key="b"><MachineRadio gate="toolsetterParam" name="brakeAfter" :value="b" v-model.number="tsParams.brakeAfter" @update:modelValue="saveTsParams()" /> {{ BRAKE_LABELS[b] }}</label>
    </div>
    <label>Spindle Stop<HelpIcon>M-code sent to stop the spindle before probing. M5 = standard stop. M500 = stop and wait for spindle to fully decelerate (for VFD-controlled spindles). (#3107)</HelpIcon></label>
    <div class="radioGroup inline spanRow">
      <label><MachineRadio gate="toolsetterParam" name="spindleStopM" :value="5" v-model.number="tsParams.spindleStopM" @update:modelValue="saveTsParams()" /> M5</label>
      <label><MachineRadio gate="toolsetterParam" name="spindleStopM" :value="500" v-model.number="tsParams.spindleStopM" @update:modelValue="saveTsParams()" /> M500</label>
    </div>
    <div class="sep span"></div>

    <!-- Diameter Offset -->
    <div class="sub span">Diameter Offset</div>
    <label>Min Diameter<HelpIcon>Minimum tool diameter that triggers position offset. Tools smaller than this probe on-center. Set to 0 to disable offset for all tools. (#3111)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.offsetDiameter" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Offset %<HelpIcon>Percentage of tool diameter to offset the probe position. Example: 20% on a large tool offsets the probe position by 20% of the diameter from center. (#3112)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.offsetValue" min="0" max="100" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Offset Dir<HelpIcon>Axis direction to offset the probe position for large tools: X−, X+, Y−, or Y+. Choose based on your machine layout to avoid clamp or fixture collisions. (#3013)</HelpIcon></label>
    <div class="radioGroup inline spanRow">
      <label v-for="d in [0, 1, 2, 3]" :key="d"><MachineRadio gate="toolsetterParam" name="offsetDirection" :value="d" v-model.number="tsParams.offsetDirection" @update:modelValue="saveTsParams()" /> {{ OFFSET_DIR_LABELS[d] }}</label>
    </div>

    <div class="sep span"></div>

    <!-- Edge-Finder -->
    <div class="sub span">Edge-Finder</div>
    <label>Finder X<HelpIcon>X position (G53) of a secondary edge-finder reference point. Used only when the selected tool matches the probe tool number. (#3113)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.finderTouchX" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Finder Y<HelpIcon>Y position (G53) of a secondary edge-finder reference point. Used only when the selected tool matches the probe tool number. (#3114)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.finderTouchY" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Finder Z Diff<HelpIcon>Height difference between the edge-finder reference surface and the normal touch plate surface. May be negative if the reference is lower. (#3115)</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.finderDiffZ" :step="STEP_DEFAULT" @change="saveTsParams" />
    <span></span><span></span>
    <label>Probe Tool #<HelpIcon>Probe tool number, shared with the Probing tab. Must match the tool loaded in the spindle before any probe operation. (#3014)</HelpIcon></label>
    <span class="mono spanRow">T{{ probeTool }}</span>

    <div class="sep span"></div>

    <MachineBtn type="reset" class="span" @click="emit('resetSection', 'toolsetter')">Reset Toolsetter</MachineBtn>
  </div>
</template>

<style scoped>
.span { grid-column: 1 / -1; }
.spanRow { grid-column: 2 / -1; }
.tsPanel > .sep { margin: var(--gap-controls) 0; }
.tsPanel > .sub { margin-top: var(--gap-tight); }
.toggleGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap-controls);
}
.errorText {
  color: var(--danger);
  font-size: var(--fs-sm);
}
</style>
