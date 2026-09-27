<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue";
import { fmtClock } from "./format";
import FormField from "./FormField.vue";
import { TS_POSITION_FIELDS, TS_PROBE_FIELDS, TS_OPTION_FIELDS, TS_OFFSET_FIELDS, TS_FINDER_FIELDS, unitText } from "./probeFields";
import { usePermissions } from "./permissions";
import {
  saveToolsetterDefaults, savedSection, confirmedSection, serverSettingsReady,
  loadProbeDefaults, settingsVersion, TOOLSETTER_FALLBACK, type ToolsetterDefaults,
} from "./defaults";
import { confirmedToolsetter, toolsetterVarMap, TOOLSETTER_REQUIRED } from "./toolsetterVars";
import { fetchG30 } from "./lcncApi";
import { status, viewerInit, request } from "./lcncWs";
import { useAxes, DEFAULT_AXES } from "./useAxes";
import { savePayload, sameG30, contextChanged, type G30Values, type G30Context } from "./g30Form";
import MachineInput from "./MachineInput.vue";
import MachineToggle from "./MachineToggle.vue";
import MachineRadio from "./MachineRadio.vue";
import MachineBtn from "./MachineBtn.vue";
import HelpIcon from "./HelpIcon.vue";

const props = defineProps<{
  /** The machine's linear unit — the unit of every length and feed field. */
  linearUnit: string;
}>();

const emit = defineEmits<{
  (e: "resetSection", section: string): void;
}>();

const can = usePermissions();

const OFFSET_DIR_LABELS: Record<number, string> = { 0: "X-", 1: "X+", 2: "Y-", 3: "Y+" };
const BRAKE_LABELS: Record<number, string> = { 0: "None", 1: "M00", 2: "M01" };

const probeTool = computed(() => loadProbeDefaults().probeTool);

// ─── Toolsetter params ─────────────────────
// A field the operator never set is EMPTY, not the fallback's 0 (Codex R15
// B1): a required field (TOOLSETTER_REQUIRED) shows blank until entered;
// an option shows its default (off). A change saves THAT field onto what
// was saved — never the whole form, whose unset fields would become saved
// zeros. The values go to the machine only once the SERVER holds a set-up
// section (confirmedToolsetter), and the form says what is missing.
type TsKey = keyof ToolsetterDefaults;
type RequiredKey = (typeof TOOLSETTER_REQUIRED)[number];
/** Required fields may be unset (null, shown empty); options always hold a value. */
type TsForm = { [K in TsKey]: K extends RequiredKey ? number | null : number };
const TS_KEYS = Object.keys(TOOLSETTER_FALLBACK) as TsKey[];
const REQUIRED = new Set<string>(TOOLSETTER_REQUIRED);
const tsParams = ref<TsForm>({ ...TOOLSETTER_FALLBACK });

function savedToolsetter(): Record<string, unknown> {
  const s = savedSection("toolsetter");
  return s && typeof s === "object" ? { ...(s as Record<string, unknown>) } : {};
}

function loadTsParams() {
  const saved = savedToolsetter();
  for (const k of TS_KEYS) {
    const v = saved[k];
    (tsParams.value as Record<TsKey, number | null>)[k] = typeof v === "number" && Number.isFinite(v) ? v
      : REQUIRED.has(k) ? null : TOOLSETTER_FALLBACK[k];
  }
}

// Fields saved here and not yet in the server's section: the push waits for
// them (a broadcast of someone else's save must not push the old values).
const awaiting = new Map<TsKey, number>();
const pushError = ref<string | null>(null);

function saveTsParams(key: TsKey) {
  const v = tsParams.value[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return;
  saveToolsetterDefaults({ ...savedToolsetter(), [key]: v });
  awaiting.set(key, v);
}

async function pushWhenConfirmed() {
  if (!awaiting.size) return;
  const confirmed = (confirmedSection("toolsetter") ?? {}) as Record<string, unknown>;
  if ([...awaiting].some(([k, v]) => confirmed[k] !== v)) return;
  awaiting.clear();
  const setup = confirmedToolsetter();
  if (!setup.ok || !can.value.ready) return;   // not set up: the machine keeps its values
  const reply = await request({ cmd: "set_probe_vars", vars: toolsetterVarMap(setup.values) });
  pushError.value = reply && reply.ok !== false && reply.mdi_set === true ? null
    : `Saved, but not sent to the machine — ${!reply ? "no reply" : reply.ok === false ? (reply.error ?? "refused") : "not taken over by the interpreter"}`;
}

const LABELS = new Map([...TS_POSITION_FIELDS, ...TS_PROBE_FIELDS, ...TS_OPTION_FIELDS, ...TS_OFFSET_FIELDS, ...TS_FINDER_FIELDS]
  .map(f => [f.key as string, f.label]));
const setupNote = computed(() => {
  const s = confirmedToolsetter();
  if (s.ok || !serverSettingsReady.value) return null;
  const names = (keys: string[]) => keys.map(k => LABELS.get(k) ?? k).join(", ");
  return s.missing.length ? `Not set up — enter ${names(s.missing)}. Until then Measure Current and Unload (M600) stay off.`
    : `Check ${names(s.invalid)} — Measure Current and Unload (M600) stay off.`;
});

// ─── Toolsetter boolean wrappers (0/1 ↔ boolean) ───
const tsUseToolTable = computed({ get: () => tsParams.value.useToolTable === 1, set: (v: boolean) => { tsParams.value.useToolTable = v ? 1 : 0; saveTsParams("useToolTable"); } });
const tsGoBackToStart = computed({ get: () => tsParams.value.goBackToStart === 1, set: (v: boolean) => { tsParams.value.goBackToStart = v ? 1 : 0; saveTsParams("goBackToStart"); } });
const tsDisablePrePos = computed({ get: () => tsParams.value.disablePrePos === 1, set: (v: boolean) => { tsParams.value.disablePrePos = v ? 1 : 0; saveTsParams("disablePrePos"); } });
const tsLastTry = computed({ get: () => tsParams.value.lastTry === 1, set: (v: boolean) => { tsParams.value.lastTry = v ? 1 : 0; saveTsParams("lastTry"); } });

// ─── G30 tool change position (operator P4, Codex R21–R24) ───
// Every configured axis, in the DRO's order. The fields are a DRAFT; "Use
// current position" fills it from the machine's commanded position (what
// G30.1 stores), only Save writes — one gateway command that confirms from a
// fresh parameter file. Nothing here claims a value LinuxCNC did not show:
// the stored line says whether it is CONFIRMED or as of the last synch, and
// a missing value is "—", never 0. (The old "Set Current Position" sent
// G30.1 and meant to show the position — through a status field that does
// not exist, so the readout stayed on the old value.)
const { entries: g30Axes } = useAxes(computed(() => [...(viewerInit.value?.axes ?? DEFAULT_AXES)]));
const g30Letters = computed(() => g30Axes.value.map(a => a.letter));
const g30Stored = ref<G30Values>({});
const g30StoredState = ref<"unknown" | "file" | "confirmed" | "unconfirmed">("unknown");
const g30StoredAt = ref<number | null>(null);
const g30Basis = ref<G30Values | null>(null);
const g30Draft = reactive<G30Values>({});
const g30DraftContext = ref<G30Context | null>(null);
const g30Busy = ref(false);
const g30Note = ref<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);

// The status frame carries the machine's fields under `data`.
const kinsType = computed<number | null>(() => (status.value?.data as Record<string, any> | undefined)?.kins_type ?? null);
const g30Context = (): G30Context => ({ units: props.linearUnit, kinsType: kinsType.value });
/** The draft differs from what the section shows as stored (empty = empty). */
const g30Dirty = computed(() => g30Letters.value.some(l => g30Draft[l] == null
  ? g30Stored.value[l] != null : !sameG30(g30Draft[l], g30Stored.value[l])));
const g30SaveCheck = computed(() => savePayload(g30Draft, g30Basis.value, g30Letters.value));
const g30StoredLine = computed(() => {
  const state = g30StoredState.value === "confirmed" ? "confirmed by LinuxCNC"
    : g30StoredState.value === "file" ? `as of LinuxCNC's last synch${g30StoredAt.value ? ` (${fmtClock(g30StoredAt.value)})` : ""}`
    : g30StoredState.value === "unconfirmed" ? "not confirmed — refresh" : "unknown — refresh";
  return `Stored: ${state}${g30Dirty.value ? " · draft not saved" : ""}`;
});

function resetG30Draft() {
  for (const l of g30Letters.value) g30Draft[l] = g30Stored.value[l] ?? null;
  g30DraftContext.value = null;
}
function takeStored(values: G30Values | undefined, state: "file" | "confirmed") {
  g30Stored.value = { ...(values ?? {}) };
  g30StoredState.value = state;
  const known = g30Letters.value.every(l => g30Stored.value[l] != null);
  g30Basis.value = known ? { ...g30Stored.value } : null;
}

async function loadG30() {
  try {
    const data = await fetchG30();
    if (data.ok) {
      takeStored(data.values, "file");
      g30StoredAt.value = data.mtime_ms ?? null;
      resetG30Draft();
    } else {
      g30Note.value = { kind: "error", text: `G30 read failed: ${data.error ?? "no data"}` };
    }
  } catch (e: any) {
    g30Note.value = { kind: "error", text: `G30 read failed: ${e?.message ?? String(e)}` };
  }
}

/** Run one G30 command; a lost reply is "not confirmed", never success. */
async function g30Request(msg: { cmd: "read_g30" } | { cmd: "capture_g30" } | { cmd: "set_g30"; values: Record<string, number>; based_on: Record<string, number> }) {
  g30Busy.value = true;
  try {
    return await request(msg, 15000);
  } finally {
    g30Busy.value = false;
  }
}

async function refreshG30() {
  const r = await g30Request({ cmd: "read_g30" });
  if (r?.ok) {
    takeStored(r.values, "confirmed");
    resetG30Draft();
    g30Note.value = null;
  } else {
    if (r?.confirmed === false) g30StoredState.value = "unconfirmed";
    g30Note.value = { kind: "error", text: r?.error ?? "No reply — G30 not confirmed" };
  }
}

async function captureG30() {
  const r = await g30Request({ cmd: "capture_g30" });
  if (!r?.ok || !r.current) {
    g30Note.value = { kind: "error", text: r?.error ?? "No reply — nothing taken over" };
    return;
  }
  for (const l of g30Letters.value) g30Draft[l] = r.current[l] ?? null;
  g30DraftContext.value = g30Context();
  // The basis stays: a stored value that moved meanwhile is said, never
  // swapped in silently (Codex R22 OP22-02).
  const moved = g30Basis.value && g30Letters.value.some(l => !sameG30(r.values?.[l], g30Basis.value![l]));
  g30Note.value = moved ? { kind: "warn", text: "Stored G30 changed meanwhile — refresh before saving" } : null;
}

async function saveG30() {
  const p = g30SaveCheck.value;
  if ("error" in p) return;
  const r = await g30Request({ cmd: "set_g30", ...p });
  if (r?.ok) {
    takeStored(r.values, "confirmed");
    resetG30Draft();
    g30Note.value = { kind: "ok", text: r.open_axes?.length
      ? `G30 saved — ${r.open_axes.join(", ")} has no limit in the INI` : "G30 saved — confirmed by LinuxCNC" };
    return;
  }
  if (r?.confirmed === true && r.values) {
    g30Stored.value = { ...r.values };
    g30StoredState.value = "confirmed";
  } else if (r?.confirmed === false || r === null) {
    g30StoredState.value = "unconfirmed";
  }
  g30Note.value = { kind: "error", text: r?.error ?? "No reply — G30 not confirmed" };
}

// A captured draft belongs to its units and kinematics mode (Codex R22
// OP22-02): another one drops it, said at the section.
watch(() => [props.linearUnit, kinsType.value], () => {
  if (g30Dirty.value && contextChanged(g30DraftContext.value, g30Context())) {
    resetG30Draft();
    g30Note.value = { kind: "warn", text: "Draft dropped — units or kinematics changed" };
  }
});
watch(g30Letters, () => { if (!g30Dirty.value) resetG30Draft(); });

onMounted(() => {
  loadTsParams();
  loadG30();
});

// The form follows the saved section — this tab's saves (a Reset) and the server's.
watch(() => JSON.stringify(savedSection("toolsetter") ?? null), loadTsParams);
watch(settingsVersion, () => { void pushWhenConfirmed(); });
</script>

<template>
  <div class="formGrid tsPanel">
    <div v-if="setupNote" class="statusNote warn wide" role="alert"><span>{{ setupNote }}</span></div>
    <div v-if="pushError" class="statusNote error wide" role="alert"><span>{{ pushError }}</span></div>
    <!-- Toolsetter Position -->
    <div class="sub">Toolsetter Position (G53)</div>
    <FormField v-for="f in TS_POSITION_FIELDS" :key="f.key" :label="f.label" :unit="unitText(f.unit, linearUnit)">
      <template #default="{ input }">
        <MachineInput v-bind="input" gate="toolsetterParam" type="number" v-model.number="tsParams[f.key]"
                      :min="f.min" :max="f.max" :integer="f.integer" @change="saveTsParams(f.key)" />
      </template>
      <template #help>{{ f.help }}</template>
    </FormField>

    <div class="sep"></div>

    <!-- Tool change position (G30): a draft, saved as one confirmed write -->
    <div class="sub textWithHelp">Tool Change Position (G30)<HelpIcon label="Tool Change Position (G30)">The machine position a tool change and G30 move to. Save writes it into LinuxCNC, within each axis' limits.</HelpIcon></div>
    <FormField v-for="a in g30Axes" :key="a.letter" :label="`G30 ${a.letter}`" :unit="a.kind === 'rotary' ? '°' : linearUnit">
      <template #default="{ input }">
        <MachineInput v-bind="input" gate="toolsetterParam" type="number" v-model.number="g30Draft[a.letter]" />
      </template>
    </FormField>
    <div class="text-muted wide g30Stored">{{ g30StoredLine }}</div>
    <div class="row-tight wide">
      <!-- No motion: Use Current Position fills the draft, Save writes it. -->
      <MachineBtn type="g30Capture" :disabled="g30Busy" @click="captureG30">Use Current Position</MachineBtn>
      <MachineBtn type="g30Save" :disabled="g30Busy || 'error' in g30SaveCheck"
                  :reason="'error' in g30SaveCheck ? g30SaveCheck.error : undefined" @click="saveG30">Save G30</MachineBtn>
      <MachineBtn type="g30Read" :disabled="g30Busy" @click="refreshG30">Refresh</MachineBtn>
    </div>
    <div v-if="g30Note" class="statusNote wide" :class="g30Note.kind" :role="g30Note.kind === 'ok' ? undefined : 'alert'"><span>{{ g30Note.text }}</span></div>

    <div class="sep"></div>

    <!-- Probe Settings -->
    <div class="sub">Probe Settings</div>
    <FormField v-for="f in TS_PROBE_FIELDS" :key="f.key" :label="f.label" :unit="unitText(f.unit, linearUnit)">
      <template #default="{ input }">
        <MachineInput v-bind="input" gate="toolsetterParam" type="number" v-model.number="tsParams[f.key]"
                      :min="f.min" :max="f.max" :integer="f.integer" @change="saveTsParams(f.key)" />
      </template>
      <template #help>{{ f.help }}</template>
    </FormField>

    <div class="sep"></div>

    <!-- Options -->
    <div class="sub">Options</div>
    <FormField v-for="f in TS_OPTION_FIELDS" :key="f.key" :label="f.label" :unit="unitText(f.unit, linearUnit)">
      <template #default="{ input }">
        <MachineInput v-bind="input" gate="toolsetterParam" type="number" v-model.number="tsParams[f.key]"
                      :min="f.min" :max="f.max" :integer="f.integer" @change="saveTsParams(f.key)" />
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
          <label v-for="v in [0, 1, 2]" :key="v"><MachineRadio gate="toolsetterParam" name="brakeAfter" :value="v" v-model.number="tsParams.brakeAfter" @update:modelValue="saveTsParams('brakeAfter')" /> {{ BRAKE_LABELS[v] }}</label>
        </div>
      </template>
      <template #help>Stop after measuring: None, M00 (always) or M01 (with optional stop on).</template>
    </FormField>
    <FormField label="Spindle Stop" group wide>
      <template #default="{ group }">
        <div v-bind="group" class="radioGroup inline">
          <label v-for="v in [5, 500]" :key="v"><MachineRadio gate="toolsetterParam" name="spindleStopM" :value="v" v-model.number="tsParams.spindleStopM" @update:modelValue="saveTsParams('spindleStopM')" /> {{ `M${v}` }}</label>
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
                      :min="f.min" :max="f.max" :integer="f.integer" @change="saveTsParams(f.key)" />
      </template>
      <template #help>{{ f.help }}</template>
    </FormField>
    <FormField label="Offset Direction" group wide>
      <template #default="{ group }">
        <div v-bind="group" class="radioGroup inline">
          <label v-for="v in [0, 1, 2, 3]" :key="v"><MachineRadio gate="toolsetterParam" name="offsetDirection" :value="v" v-model.number="tsParams.offsetDirection" @update:modelValue="saveTsParams('offsetDirection')" /> {{ OFFSET_DIR_LABELS[v] }}</label>
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
                      :min="f.min" :max="f.max" :integer="f.integer" @change="saveTsParams(f.key)" />
      </template>
      <template #help>{{ f.help }}</template>
    </FormField>
    <FormField label="Probe Tool #">
      <template #default="{ field }">
        <output v-bind="field" class="formValue">T{{ probeTool }}</output>
      </template>
      <template #help>Tool number of the probe (shared with Probing) — load it before probing.</template>
    </FormField>

    <!-- A reset sits at the end of its section, right (design wave D4, N65) -->
    <div class="resetRow wide">
      <MachineBtn type="reset" @click="emit('resetSection', 'toolsetter')">Reset Toolsetter</MachineBtn>
    </div>
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
