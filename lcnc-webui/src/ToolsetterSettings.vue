<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { fmtNum } from "./format";
import { usePermissions } from "./permissions";
import {
  loadToolsetterDefaults, saveToolsetterDefaults,
  loadProbeDefaults, settingsVersion,
  STEP_DEFAULT, STEP_FEED,
} from "./defaults";
import { buildToolsetterVarMap } from "./toolsetterVars";
import { fetchG30 } from "./lcncApi";
import { status, viewerInit } from "./lcncWs";
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
  // Read back BY LETTER via the machine's axis order (viewer_init.axes) —
  // st.position is index-aligned to it; positional [0/1/2] broke on any
  // machine whose axes aren't XYZ-first.
  const st = status.value as any;
  const axes: string[] = viewerInit.value?.axes ?? [];
  if (st?.position && axes.length) {
    const at = (l: string) => { const i = axes.indexOf(l); return i >= 0 ? st.position[i] : undefined; };
    g30X.value = at("X");
    g30Y.value = at("Y");
    g30Z.value = at("Z");
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
    <label>Touch X<HelpIcon label="Touch X">Toolsetter centre X, machine coordinates (G53).</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.touchX" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Touch Y<HelpIcon label="Touch Y">Toolsetter centre Y, machine coordinates (G53).</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.touchY" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Touch Z<HelpIcon label="Touch Z">Toolsetter surface height, machine Z (G53) — usually negative.</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.touchZ" :step="STEP_DEFAULT" @change="saveTsParams" />

    <div class="sep span"></div>

    <!-- Tool Change Position (G30) -->
    <div class="sub span textWithHelp">Tool Change Position (G30)<HelpIcon label="Tool Change Position (G30)">Where the machine moves before a tool change (M6). Set in the var file.</HelpIcon></div>
    <label>X</label>
    <span class="mono">{{ fmtNum(g30X, 3) }}</span>
    <label>Y</label>
    <span class="mono">{{ fmtNum(g30Y, 3) }}</span>
    <label>Z</label>
    <span class="mono">{{ fmtNum(g30Z, 3) }}</span>
    <div class="row-tight span">
      <!-- hold=false: records the current position (var write), no motion -->
      <MachineBtn type="probe" :hold="false" @click="setG30">Set Current Position</MachineBtn>
      <MachineBtn type="inlineMd" @click="loadG30" :disabled="g30Loading">Refresh</MachineBtn>
    </div>
    <div v-if="g30Error" class="span errorText">G30 read failed: {{ g30Error }}</div>

    <div class="sep span"></div>

    <!-- Probe Settings -->
    <div class="sub span">Probe Settings</div>
    <label>Fast Feed<HelpIcon label="Fast Feed">Feed of the first touch on the setter — faster costs repeatability.</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.fastFeed" min="1" :step="STEP_FEED" @change="saveTsParams" />
    <label>Slow Feed<HelpIcon label="Slow Feed">Feed of the precise second touch. 0 skips it: faster, less accurate.</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.slowFeed" min="0" :step="STEP_FEED" @change="saveTsParams" />
    <label>Traverse Feed<HelpIcon label="Traverse Feed">Feed of the moves to and from the setter — no effect on accuracy.</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.traverseFeed" min="1" :step="STEP_FEED" @change="saveTsParams" />
    <label>Max Z Travel<HelpIcon label="Max Z Travel">Downward search limit — stops with an error if the setter is not hit.</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.maxZTravel" min="1" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Retract Distance<HelpIcon label="Retract Distance">Lift after the first touch; the slow pass searches 2× this.</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.retractDist" min="0.1" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Spindle Zero Height<HelpIcon label="Spindle Zero Height">Spindle nose to setter surface with no tool (G53 Z) — the zero-length reference.</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.spindleZeroHeight" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />

    <div class="sep span"></div>

    <!-- Options -->
    <div class="sub span">Options</div>
    <label>Tool Min Distance<HelpIcon label="Tool Min Distance">Clearance above the expected tool tip when starting from the tool table.</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.toolMinDis" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Extra Retries<HelpIcon label="Extra Retries">Retries after a missed touch, each after a pause. 0 for a tool changer.</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.addReps" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />
    <div class="toggleGrid span">
      <MachineToggle gate="toolsetterParam" v-model="tsUseToolTable" label="Use Tool Table" help="Starts the search just above the expected tip — faster. Off for new or unmeasured tools." />
      <MachineToggle gate="toolsetterParam" v-model="tsGoBackToStart" label="Return to Start" help="Return to where M600 was called after measuring." />
      <MachineToggle gate="toolsetterParam" v-model="tsDisablePrePos" label="Skip G30 Pre-Position" help="Go straight to the setter without the G30 move — only if nothing is in the way." />
      <MachineToggle gate="toolsetterParam" v-model="tsLastTry" label="Last Try Without Table" help="The last retry ignores the tool table and starts from spindle zero height." />
    </div>
    <label>Brake After<HelpIcon label="Brake After">Stop after measuring: None, M00 (always) or M01 (with optional stop on).</HelpIcon></label>
    <div class="radioGroup inline spanRow">
      <label v-for="b in [0, 1, 2]" :key="b"><MachineRadio gate="toolsetterParam" name="brakeAfter" :value="b" v-model.number="tsParams.brakeAfter" @update:modelValue="saveTsParams()" /> {{ BRAKE_LABELS[b] }}</label>
    </div>
    <label>Spindle Stop<HelpIcon label="Spindle Stop">M5 stops the spindle; M500 also waits until it has stopped (VFD).</HelpIcon></label>
    <div class="radioGroup inline spanRow">
      <label><MachineRadio gate="toolsetterParam" name="spindleStopM" :value="5" v-model.number="tsParams.spindleStopM" @update:modelValue="saveTsParams()" /> M5</label>
      <label><MachineRadio gate="toolsetterParam" name="spindleStopM" :value="500" v-model.number="tsParams.spindleStopM" @update:modelValue="saveTsParams()" /> M500</label>
    </div>
    <div class="sep span"></div>

    <!-- Diameter Offset -->
    <div class="sub span">Diameter Offset</div>
    <label>Min Diameter<HelpIcon label="Min Diameter">Tools from this diameter touch off-centre (Offset %). 0 = never.</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.offsetDiameter" min="0" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Offset %<HelpIcon label="Offset %">Off-centre distance as a share of the tool diameter.</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.offsetValue" min="0" max="100" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Offset Direction<HelpIcon label="Offset Direction">Side of the off-centre touch — pick the one away from clamps.</HelpIcon></label>
    <div class="radioGroup inline spanRow">
      <label v-for="d in [0, 1, 2, 3]" :key="d"><MachineRadio gate="toolsetterParam" name="offsetDirection" :value="d" v-model.number="tsParams.offsetDirection" @update:modelValue="saveTsParams()" /> {{ OFFSET_DIR_LABELS[d] }}</label>
    </div>

    <div class="sep span"></div>

    <!-- Edge-Finder -->
    <div class="sub span">Edge-Finder</div>
    <label>Finder X<HelpIcon label="Finder X">Reference X (G53) used instead when the probe tool is measured.</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.finderTouchX" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Finder Y<HelpIcon label="Finder Y">Reference Y (G53) used instead when the probe tool is measured.</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.finderTouchY" :step="STEP_DEFAULT" @change="saveTsParams" />
    <label>Finder Z Difference<HelpIcon label="Finder Z Difference">Finder reference height relative to the setter surface; may be negative.</HelpIcon></label>
    <MachineInput gate="toolsetterParam" type="number" v-model.number="tsParams.finderDiffZ" :step="STEP_DEFAULT" @change="saveTsParams" />
    <span></span><span></span>
    <label>Probe Tool #<HelpIcon label="Probe Tool #">Tool number of the probe (shared with Probing) — load it before probing.</HelpIcon></label>
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
