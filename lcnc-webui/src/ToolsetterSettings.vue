<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { fmtNum } from "./format";
import FormField from "./FormField.vue";
import { TS_POSITION_FIELDS, TS_PROBE_FIELDS, TS_OPTION_FIELDS, TS_OFFSET_FIELDS, TS_FINDER_FIELDS, unitText } from "./probeFields";
import { usePermissions } from "./permissions";
import {
  loadToolsetterDefaults, saveToolsetterDefaults,
  loadProbeDefaults, settingsVersion,
} from "./defaults";
import { buildToolsetterVarMap } from "./toolsetterVars";
import { fetchG30 } from "./lcncApi";
import { status, viewerInit } from "./lcncWs";
import MachineInput from "./MachineInput.vue";
import MachineToggle from "./MachineToggle.vue";
import MachineRadio from "./MachineRadio.vue";
import MachineBtn from "./MachineBtn.vue";
import HelpIcon from "./HelpIcon.vue";

defineProps<{
  /** The machine's linear unit — the unit of every length and feed field. */
  linearUnit: string;
}>();

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

/** The G30 readout, one entry per axis (read-only form values). */
const G30_AXES = [
  { letter: "X", value: g30X }, { letter: "Y", value: g30Y }, { letter: "Z", value: g30Z },
];

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
  <div class="formGrid tsPanel">
    <!-- Toolsetter Position -->
    <div class="sub">Toolsetter Position (G53)</div>
    <FormField v-for="f in TS_POSITION_FIELDS" :key="f.key" :label="f.label" :unit="unitText(f.unit, linearUnit)">
      <template #default="{ input }">
        <MachineInput v-bind="input" gate="toolsetterParam" type="number" v-model.number="tsParams[f.key]"
                      :min="f.min" :max="f.max" :integer="f.integer" @change="saveTsParams" />
      </template>
      <template #help>{{ f.help }}</template>
    </FormField>

    <div class="sep"></div>

    <!-- Tool Change Position (G30): read from the var file -->
    <div class="sub textWithHelp">Tool Change Position (G30)<HelpIcon label="Tool Change Position (G30)">Where the machine moves before a tool change (M6). Set in the var file.</HelpIcon></div>
    <FormField v-for="a in G30_AXES" :key="a.letter" :label="`G30 ${a.letter}`" :unit="linearUnit">
      <template #default="{ field }">
        <output v-bind="field" class="formValue">{{ fmtNum(a.value.value, 3) }}</output>
      </template>
    </FormField>
    <div class="row-tight wide">
      <!-- hold=false: records the current position (var write), no motion -->
      <MachineBtn type="probe" :hold="false" @click="setG30">Set Current Position</MachineBtn>
      <MachineBtn type="inlineMd" @click="loadG30" :disabled="g30Loading">Refresh</MachineBtn>
    </div>
    <div v-if="g30Error" class="statusNote error wide" role="alert"><span>G30 read failed: {{ g30Error }}</span></div>

    <div class="sep"></div>

    <!-- Probe Settings -->
    <div class="sub">Probe Settings</div>
    <FormField v-for="f in TS_PROBE_FIELDS" :key="f.key" :label="f.label" :unit="unitText(f.unit, linearUnit)">
      <template #default="{ input }">
        <MachineInput v-bind="input" gate="toolsetterParam" type="number" v-model.number="tsParams[f.key]"
                      :min="f.min" :max="f.max" :integer="f.integer" @change="saveTsParams" />
      </template>
      <template #help>{{ f.help }}</template>
    </FormField>

    <div class="sep"></div>

    <!-- Options -->
    <div class="sub">Options</div>
    <FormField v-for="f in TS_OPTION_FIELDS" :key="f.key" :label="f.label" :unit="unitText(f.unit, linearUnit)">
      <template #default="{ input }">
        <MachineInput v-bind="input" gate="toolsetterParam" type="number" v-model.number="tsParams[f.key]"
                      :min="f.min" :max="f.max" :integer="f.integer" @change="saveTsParams" />
      </template>
      <template #help>{{ f.help }}</template>
    </FormField>
    <div class="toggleGrid wide">
      <MachineToggle gate="toolsetterParam" v-model="tsUseToolTable" label="Use Tool Table" help="Starts the search just above the expected tip — faster. Off for new or unmeasured tools." />
      <MachineToggle gate="toolsetterParam" v-model="tsGoBackToStart" label="Return to Start" help="Return to where M600 was called after measuring." />
      <MachineToggle gate="toolsetterParam" v-model="tsDisablePrePos" label="Skip G30 Pre-Position" help="Go straight to the setter without the G30 move — only if nothing is in the way." />
      <MachineToggle gate="toolsetterParam" v-model="tsLastTry" label="Last Try Without Table" help="The last retry ignores the tool table and starts from spindle zero height." />
    </div>
    <FormField label="Brake After" group wide>
      <template #default="{ group }">
        <div v-bind="group" class="radioGroup inline">
          <label v-for="v in [0, 1, 2]" :key="v"><MachineRadio gate="toolsetterParam" name="brakeAfter" :value="v" v-model.number="tsParams.brakeAfter" @update:modelValue="saveTsParams()" /> {{ BRAKE_LABELS[v] }}</label>
        </div>
      </template>
      <template #help>Stop after measuring: None, M00 (always) or M01 (with optional stop on).</template>
    </FormField>
    <FormField label="Spindle Stop" group wide>
      <template #default="{ group }">
        <div v-bind="group" class="radioGroup inline">
          <label v-for="v in [5, 500]" :key="v"><MachineRadio gate="toolsetterParam" name="spindleStopM" :value="v" v-model.number="tsParams.spindleStopM" @update:modelValue="saveTsParams()" /> {{ `M${v}` }}</label>
        </div>
      </template>
      <template #help>M5 stops the spindle; M500 also waits until it has stopped (VFD).</template>
    </FormField>

    <div class="sep"></div>

    <!-- Diameter Offset -->
    <div class="sub">Diameter Offset</div>
    <FormField v-for="f in TS_OFFSET_FIELDS" :key="f.key" :label="f.label" :unit="unitText(f.unit, linearUnit)">
      <template #default="{ input }">
        <MachineInput v-bind="input" gate="toolsetterParam" type="number" v-model.number="tsParams[f.key]"
                      :min="f.min" :max="f.max" :integer="f.integer" @change="saveTsParams" />
      </template>
      <template #help>{{ f.help }}</template>
    </FormField>
    <FormField label="Offset Direction" group wide>
      <template #default="{ group }">
        <div v-bind="group" class="radioGroup inline">
          <label v-for="v in [0, 1, 2, 3]" :key="v"><MachineRadio gate="toolsetterParam" name="offsetDirection" :value="v" v-model.number="tsParams.offsetDirection" @update:modelValue="saveTsParams()" /> {{ OFFSET_DIR_LABELS[v] }}</label>
        </div>
      </template>
      <template #help>Side of the off-centre touch — pick the one away from clamps.</template>
    </FormField>

    <div class="sep"></div>

    <!-- Edge-Finder -->
    <div class="sub">Edge-Finder</div>
    <FormField v-for="f in TS_FINDER_FIELDS" :key="f.key" :label="f.label" :unit="unitText(f.unit, linearUnit)">
      <template #default="{ input }">
        <MachineInput v-bind="input" gate="toolsetterParam" type="number" v-model.number="tsParams[f.key]"
                      :min="f.min" :max="f.max" :integer="f.integer" @change="saveTsParams" />
      </template>
      <template #help>{{ f.help }}</template>
    </FormField>
    <FormField label="Probe Tool #">
      <template #default="{ field }">
        <output v-bind="field" class="formValue">T{{ probeTool }}</output>
      </template>
      <template #help>Tool number of the probe (shared with Probing) — load it before probing.</template>
    </FormField>

    <div class="sep"></div>

    <MachineBtn type="reset" class="wide" @click="emit('resetSection', 'toolsetter')">Reset Toolsetter</MachineBtn>
  </div>
</template>

<style scoped>
.tsPanel > .sep { margin: var(--gap-controls) 0; }
.toggleGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap-controls);
}
</style>
