<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { usePermissions } from "./permissions";

const STORAGE_KEY = "lcnc-probe-params";

const props = defineProps<{
  probing: boolean;
  probeTripped: boolean;
  probedPosition: number[] | null;
  workPos: number[];
  initialVars: Record<string, number> | null;
  probeResults: Record<string, number> | null;
}>();

const emit = defineEmits<{
  (e: "mdi", text: string): void;
  (e: "abort"): void;
  (e: "listProbeMacros"): void;
  (e: "simulateProbeTrip"): void;
  (e: "setProbeVars", vars: Record<string, number>): void;
}>();

const can = usePermissions();

// ─── Sub-view navigation ──────────────────────────────────────────
const probeView = ref<"outside" | "inside" | "boss" | "ridge" | "angle" | "cal">("outside");

// ─── Grid probe operations ────────────────────────────────────────
type GridOp = {
  id: string;
  label: string;
  macro: string;
  description: string;
};

const outsideGrid: GridOp[] = [
  { id: "bl", label: "BL",  macro: "probe_back_left_top_corner",   description: "Back-left corner" },
  { id: "b",  label: "B",   macro: "probe_back_top_side",          description: "Back edge" },
  { id: "br", label: "BR",  macro: "probe_back_right_top_corner",  description: "Back-right corner" },
  { id: "l",  label: "L",   macro: "probe_left_top_side",          description: "Left edge" },
  { id: "z",  label: "Z",   macro: "probe_z_minus_wco",            description: "Z surface" },
  { id: "r",  label: "R",   macro: "probe_right_top_side",         description: "Right edge" },
  { id: "fl", label: "FL",  macro: "probe_front_left_top_corner",  description: "Front-left corner" },
  { id: "f",  label: "F",   macro: "probe_front_top_side",         description: "Front edge" },
  { id: "fr", label: "FR",  macro: "probe_front_right_top_corner", description: "Front-right corner" },
];

const insideGrid: GridOp[] = [
  { id: "bl", label: "BL",  macro: "probe_back_left_inside_corner",   description: "Back-left inside corner" },
  { id: "b",  label: "B",   macro: "probe_back_top_side",             description: "Back wall" },
  { id: "br", label: "BR",  macro: "probe_back_right_inside_corner",  description: "Back-right inside corner" },
  { id: "l",  label: "L",   macro: "probe_left_top_side",             description: "Left wall" },
  { id: "z",  label: "Z",   macro: "probe_z_minus_wco",               description: "Z surface" },
  { id: "r",  label: "R",   macro: "probe_right_top_side",            description: "Right wall" },
  { id: "fl", label: "FL",  macro: "probe_front_left_inside_corner",  description: "Front-left inside corner" },
  { id: "f",  label: "F",   macro: "probe_front_top_side",            description: "Front wall" },
  { id: "fr", label: "FR",  macro: "probe_front_right_inside_corner", description: "Front-right inside corner" },
];

const bossGrid: GridOp[] = [
  { id: "rb",  label: "Round Boss",     macro: "probe_round_boss",                description: "Probe outside of round feature" },
  { id: "rp",  label: "Round Pocket",   macro: "probe_round_pocket",              description: "Probe inside of round hole (edge start)" },
  { id: "rpc", label: "Round Pocket C", macro: "probe_round_pocket_center_start", description: "Probe inside of round hole (center start)" },
  { id: "xb",  label: "Rect Boss",      macro: "probe_rect_boss",                 description: "Probe outside of rectangular feature" },
  { id: "xp",  label: "Rect Pocket",    macro: "probe_rect_pocket",               description: "Probe inside of rectangular pocket (edge start)" },
  { id: "xpc", label: "Rect Pocket C",  macro: "probe_rect_pocket_center_start",  description: "Probe inside of rectangular pocket (center start)" },
];

const ridgeGrid: GridOp[] = [
  { id: "rx",  label: "Ridge X",    macro: "probe_ridge_x",                description: "Probe ridge in X axis" },
  { id: "vx",  label: "Valley X",   macro: "probe_valley_x",               description: "Probe valley in X axis (edge start)" },
  { id: "vxc", label: "Valley X C", macro: "probe_valley_x_center_start",  description: "Probe valley in X axis (center start)" },
  { id: "ry",  label: "Ridge Y",    macro: "probe_ridge_y",                description: "Probe ridge in Y axis" },
  { id: "vy",  label: "Valley Y",   macro: "probe_valley_y",               description: "Probe valley in Y axis (edge start)" },
  { id: "vyc", label: "Valley Y C", macro: "probe_valley_y_center_start",  description: "Probe valley in Y axis (center start)" },
];

const angleGrid: GridOp[] = [
  { id: "cx+", label: "BL",  macro: "probe_corner_x_plus_edge_angle",  description: "Back-left corner angle" },
  { id: "tb",  label: "B",   macro: "probe_top_back_edge_angle",       description: "Back edge angle" },
  { id: "cy-", label: "BR",  macro: "probe_corner_y_minus_edge_angle", description: "Back-right corner angle" },
  { id: "tl",  label: "L",   macro: "probe_top_left_edge_angle",       description: "Left edge angle" },
  { id: "z",   label: "Z",   macro: "probe_z_minus_wco",              description: "Z surface" },
  { id: "tr",  label: "R",   macro: "probe_top_right_edge_angle",      description: "Right edge angle" },
  { id: "cy+", label: "FL",  macro: "probe_corner_y_plus_edge_angle",  description: "Front-left corner angle" },
  { id: "tf",  label: "F",   macro: "probe_top_front_edge_angle",      description: "Front edge angle" },
  { id: "cx-", label: "FR",  macro: "probe_corner_x_minus_edge_angle", description: "Front-right corner angle" },
];

const activeGridOp = ref<string | null>(null);
const activeBossOp = ref<string>("rb");
const calAxis = ref(0); // 0=avg XY, 1=X only, 2=Y only

// ─── Parameters ───────────────────────────────────────────────────
// Parameter order matches config v0.2 subroutines:
// #1=probe_tool, #2=slow_fr, #3=fast_fr, #4=traverse_fr, #5=max_distance, #6=clearance, #7=cal_offset
const params = ref({
  probeTool: 99,
  slowFr: 50.0,
  fastFr: 200.0,
  traverseFr: 1000.0,
  maxXYDistance: 10.0,
  xyClearance: 2.0,
  maxZDistance: 10.0,
  zClearance: 2.0,
  calOffset: 0.0,
  stepOffWidth: 5.0,
  extraProbeDepth: 0.0,
  edgeWidth: 0.5,
  diameterHint: 0.0,
  xHintBP: 0.0,
  yHintBP: 0.0,
  xHintRV: 0.0,
  yHintRV: 0.0,
  wcoRotation: 0,
  calDiameter: 0.0,
  xCalWidth: 0.0,
  yCalWidth: 0.0,
});

const autoZero = ref(false);

/** Map UI params → LinuxCNC var numbers (writes both XY and Z distance/clearance) */
function buildVarMap(probeMode: number): Record<string, number> {
  const p = params.value;
  return {
    "3014": p.probeTool,
    "3015": p.slowFr,
    "3016": p.fastFr,
    "3017": p.traverseFr,
    "3018": p.maxXYDistance,
    "3019": p.xyClearance,
    "3020": p.maxZDistance,
    "3021": p.zClearance,
    "3022": p.extraProbeDepth,
    "3023": p.stepOffWidth,
    "3024": p.edgeWidth,
    "3025": p.diameterHint,
    "3026": p.xHintBP,
    "3027": p.yHintBP,
    "3028": p.xHintRV,
    "3029": p.yHintRV,
    "3030": probeMode,       // 0 = set WCO, 1 = measure only
    "3031": p.wcoRotation,
    "3032": p.calOffset,
    "3033": p.calDiameter,
    "3034": p.xCalWidth,
    "3035": p.yCalWidth,
  };
}

function loadParams() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      console.log("[probe] loadParams from localStorage", saved);
      if (saved.autoZero != null) autoZero.value = saved.autoZero;
      delete saved.autoZero;
      Object.assign(params.value, saved);
    }
  } catch { /* ignore */ }
  // Var file values arrive via 1 Hz polling in status messages (initialVars watcher)
}

function saveParams() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  console.log("[probe] saveParams → localStorage", { ...params.value });
  // Sync to var file (and best-effort MDI) on every change
  const varMap = buildVarMap(autoZero.value ? 0 : 1);
  console.log("[probe] saveParams → setProbeVars", varMap);
  emit("setProbeVars", varMap);
}

/** Sync machine-written vars (calOffset) from 1 Hz polling. UI-owned params are never overwritten. */
watch(() => props.initialVars, (vars) => {
  if (!vars) return;
  console.log("[probe] initialVars received ←", { ...vars });
  if (vars["3032"] != null) {
    params.value.calOffset = vars["3032"];
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  }
});

onMounted(loadParams);

// ─── Status ───────────────────────────────────────────────────────
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

// ─── Run probe ────────────────────────────────────────────────────
function runGridProbe(op: GridOp) {
  if (!can.ready || props.probing) return;
  activeGridOp.value = op.id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  console.log("[probe] runGridProbe → setProbeVars", op.macro, vars);
  emit("setProbeVars", vars);
  emit("mdi", `O<${op.macro}> CALL`);
}

function runBossProbe(op: GridOp) {
  if (!can.ready || props.probing) return;
  activeBossOp.value = op.id;
  activeGridOp.value = op.id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  console.log("[probe] runBossProbe → setProbeVars", op.macro, vars);
  emit("setProbeVars", vars);
  emit("mdi", `O<${op.macro}> CALL`);
}

function runRidgeProbe(op: GridOp) {
  if (!can.ready || props.probing) return;
  activeGridOp.value = op.id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  console.log("[probe] runRidgeProbe → setProbeVars", op.macro, vars);
  emit("setProbeVars", vars);
  emit("mdi", `O<${op.macro}> CALL`);
}

function runAngleProbe(op: GridOp) {
  if (!can.ready || props.probing) return;
  activeGridOp.value = op.id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  console.log("[probe] runAngleProbe → setProbeVars", op.macro, vars);
  emit("setProbeVars", vars);
  emit("mdi", `O<${op.macro}> CALL`);
}

function runCalProbe(macro: string) {
  if (!can.ready || props.probing) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  vars["3036"] = calAxis.value;
  console.log("[probe] runCalProbe → setProbeVars", macro, vars);
  emit("setProbeVars", vars);
  emit("mdi", `O<${macro}> CALL`);
}

function resetCal() {
  if (!can.ready || props.probing) return;
  emit("mdi", `O<probe_cal_reset> CALL`);
}

function fmt(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "---";
  return n.toFixed(4);
}

function fmtR(key: string): string {
  const v = props.probeResults?.[key];
  if (v == null || !Number.isFinite(v)) return "---";
  return v.toFixed(4);
}
</script>

<template>
  <div class="probePanel scroll-thin">
    <!-- Sub-view tabs -->
    <div class="viewTabs">
      <button class="viewTab" :class="{ active: probeView === 'outside' }" @click="probeView = 'outside'">Outside</button>
      <button class="viewTab" :class="{ active: probeView === 'inside' }" @click="probeView = 'inside'">Inside</button>
      <button class="viewTab" :class="{ active: probeView === 'boss' }" @click="probeView = 'boss'">Boss/Pocket</button>
      <button class="viewTab" :class="{ active: probeView === 'ridge' }" @click="probeView = 'ridge'">Ridge/Valley</button>
      <button class="viewTab" :class="{ active: probeView === 'angle' }" @click="probeView = 'angle'">Angle</button>
      <button class="viewTab" :class="{ active: probeView === 'cal' }" @click="probeView = 'cal'">Calibrate</button>
    </div>

    <!-- Control bar -->
    <div class="controlBar">
      <label class="checkRow">
        <input type="checkbox" v-model="autoZero" :disabled="!can.ready" @change="saveParams" />
        Auto Zero
      </label>
      <span class="calOffsetGroup">
        <span class="calOffsetLabel">Calibration Offset <span class="varNum">#3032</span></span>
        <span class="calOffsetVal">{{ fmt(params.calOffset) }}</span>
        <button class="calResetBtn" :disabled="!can.ready || probing" @click="resetCal">Reset</button>
      </span>
      <div class="controlBarRight">
        <div class="statusRow">
          <span class="statusDot" :class="statusClass"></span>
          <span class="statusText">{{ probeStatus }}</span>
        </div>
        <button
          class="abortBtn compact"
          :disabled="!probing"
          @click="emit('abort')"
        >Abort</button>
        <button
          class="simTripBtn compact"
          :disabled="!probing"
          @click="emit('simulateProbeTrip')"
          title="Simulate probe contact (sim/debug only)"
        >Sim Trip</button>
      </div>
    </div>

    <!-- ═══ OUTSIDE CORNERS VIEW ═══ -->
    <template v-if="probeView === 'outside'">
      <div class="section">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap">
          <button
            v-for="op in outsideGrid"
            :key="op.id"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
            :disabled="!can.ready || probing"
            :title="op.description"
            @click="runGridProbe(op)"
          >
            <!-- BL corner: triangles pointing ↓ and → from outside -->
            <svg v-if="op.id === 'bl'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" rx="3" class="workpiece" />
              <circle cx="28" cy="28" r="4" class="probeTip" />
              <polygon points="28,10 23,1 33,1" class="arrowHead" />
              <polygon points="10,28 1,23 1,33" class="arrowHead" />
              <circle cx="10" cy="10" r="2.5" class="crosshair" />
            </svg>
            <!-- Back edge: triangle pointing ↓ from outside, circle at vertex -->
            <svg v-else-if="op.id === 'b'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" rx="3" class="workpiece" />
              <circle cx="40" cy="28" r="4" class="probeTip" />
              <polygon points="40,10 35,1 45,1" class="arrowHead" />
              <circle cx="40" cy="10" r="2.5" class="crosshair" />
            </svg>
            <!-- BR corner: triangles pointing ↓ and ← from outside -->
            <svg v-else-if="op.id === 'br'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" rx="3" class="workpiece" />
              <circle cx="52" cy="28" r="4" class="probeTip" />
              <polygon points="52,10 47,1 57,1" class="arrowHead" />
              <polygon points="70,28 79,23 79,33" class="arrowHead" />
              <circle cx="70" cy="10" r="2.5" class="crosshair" />
            </svg>
            <!-- Left edge: triangle pointing → from outside, circle at vertex -->
            <svg v-else-if="op.id === 'l'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" rx="3" class="workpiece" />
              <circle cx="28" cy="40" r="4" class="probeTip" />
              <polygon points="10,40 1,35 1,45" class="arrowHead" />
              <circle cx="10" cy="40" r="2.5" class="crosshair" />
            </svg>
            <!-- Z center: probe centered, green crosshair circle around probe tip -->
            <svg v-else-if="op.id === 'z'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" rx="3" class="workpiece" />
              <circle cx="40" cy="40" r="9" class="crosshair" />
              <circle cx="40" cy="40" r="5" class="probeTip" />
              <text x="40" y="60" class="gridZLabel">Z</text>
            </svg>
            <!-- Right edge: triangle pointing ← from outside, circle at vertex -->
            <svg v-else-if="op.id === 'r'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" rx="3" class="workpiece" />
              <circle cx="52" cy="40" r="4" class="probeTip" />
              <polygon points="70,40 79,35 79,45" class="arrowHead" />
              <circle cx="70" cy="40" r="2.5" class="crosshair" />
            </svg>
            <!-- FL corner: triangles pointing ↑ and → from outside -->
            <svg v-else-if="op.id === 'fl'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" rx="3" class="workpiece" />
              <circle cx="28" cy="52" r="4" class="probeTip" />
              <polygon points="28,70 23,79 33,79" class="arrowHead" />
              <polygon points="10,52 1,47 1,57" class="arrowHead" />
              <circle cx="10" cy="70" r="2.5" class="crosshair" />
            </svg>
            <!-- Front edge: triangle pointing ↑ from outside, circle at vertex -->
            <svg v-else-if="op.id === 'f'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" rx="3" class="workpiece" />
              <circle cx="40" cy="52" r="4" class="probeTip" />
              <polygon points="40,70 35,79 45,79" class="arrowHead" />
              <circle cx="40" cy="70" r="2.5" class="crosshair" />
            </svg>
            <!-- FR corner: triangles pointing ↑ and ← from outside -->
            <svg v-else-if="op.id === 'fr'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" rx="3" class="workpiece" />
              <circle cx="52" cy="52" r="4" class="probeTip" />
              <polygon points="52,70 47,79 57,79" class="arrowHead" />
              <polygon points="70,52 79,47 79,57" class="arrowHead" />
              <circle cx="70" cy="70" r="2.5" class="crosshair" />
            </svg>
          </button>
        </div>
      </div>
    </template>

    <!-- ═══ INSIDE CORNERS VIEW ═══ -->
    <template v-else-if="probeView === 'inside'">
      <div class="section">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap">
          <button
            v-for="op in insideGrid"
            :key="op.id"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
            :disabled="!can.ready || probing"
            :title="op.description"
            @click="runGridProbe(op)"
          >
            <!-- BL corner: L-shape wall top+left, probe inside L near corner -->
            <svg v-if="op.id === 'bl'" viewBox="0 0 80 80" class="gridIcon">
              <path d="M0 0H80V35H35V80H0Z" class="workpiece" />
              <circle cx="24" cy="24" r="4" class="probeTip" />
              <polygon points="52,35 47,44 57,44" class="arrowHead" />
              <polygon points="35,52 44,47 44,57" class="arrowHead" />
              <circle cx="35" cy="35" r="2.5" class="crosshair" />
            </svg>
            <!-- Back wall: half-rect top -->
            <svg v-else-if="op.id === 'b'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="0" y="0" width="80" height="35" class="workpiece" />
              <circle cx="40" cy="55" r="4" class="probeTip" />
              <polygon points="40,35 35,44 45,44" class="arrowHead" />
              <circle cx="40" cy="35" r="2.5" class="crosshair" />
            </svg>
            <!-- BR corner: L-shape wall top+right, probe inside L near corner -->
            <svg v-else-if="op.id === 'br'" viewBox="0 0 80 80" class="gridIcon">
              <path d="M0 0H80V80H45V35H0Z" class="workpiece" />
              <circle cx="56" cy="24" r="4" class="probeTip" />
              <polygon points="28,35 23,44 33,44" class="arrowHead" />
              <polygon points="45,52 36,47 36,57" class="arrowHead" />
              <circle cx="45" cy="35" r="2.5" class="crosshair" />
            </svg>
            <!-- Left wall: half-rect left -->
            <svg v-else-if="op.id === 'l'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="0" y="0" width="35" height="80" class="workpiece" />
              <circle cx="55" cy="40" r="4" class="probeTip" />
              <polygon points="35,40 44,35 44,45" class="arrowHead" />
              <circle cx="35" cy="40" r="2.5" class="crosshair" />
            </svg>
            <!-- Z center: full workpiece -->
            <svg v-else-if="op.id === 'z'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="0" y="0" width="80" height="80" rx="3" class="workpiece" />
              <circle cx="40" cy="40" r="9" class="crosshair" />
              <circle cx="40" cy="40" r="5" class="probeTip" />
              <text x="40" y="60" class="gridZLabel">Z</text>
            </svg>
            <!-- Right wall: half-rect right -->
            <svg v-else-if="op.id === 'r'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="45" y="0" width="35" height="80" class="workpiece" />
              <circle cx="25" cy="40" r="4" class="probeTip" />
              <polygon points="45,40 36,35 36,45" class="arrowHead" />
              <circle cx="45" cy="40" r="2.5" class="crosshair" />
            </svg>
            <!-- FL corner: L-shape wall bottom+left, probe inside L near corner -->
            <svg v-else-if="op.id === 'fl'" viewBox="0 0 80 80" class="gridIcon">
              <path d="M0 0H35V45H80V80H0Z" class="workpiece" />
              <circle cx="24" cy="56" r="4" class="probeTip" />
              <polygon points="52,45 47,36 57,36" class="arrowHead" />
              <polygon points="35,28 44,23 44,33" class="arrowHead" />
              <circle cx="35" cy="45" r="2.5" class="crosshair" />
            </svg>
            <!-- Front wall: half-rect bottom -->
            <svg v-else-if="op.id === 'f'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="0" y="45" width="80" height="35" class="workpiece" />
              <circle cx="40" cy="25" r="4" class="probeTip" />
              <polygon points="40,45 35,36 45,36" class="arrowHead" />
              <circle cx="40" cy="45" r="2.5" class="crosshair" />
            </svg>
            <!-- FR corner: L-shape wall bottom+right, probe inside L near corner -->
            <svg v-else-if="op.id === 'fr'" viewBox="0 0 80 80" class="gridIcon">
              <path d="M45 0H80V80H0V45H45Z" class="workpiece" />
              <circle cx="56" cy="56" r="4" class="probeTip" />
              <polygon points="28,45 23,36 33,36" class="arrowHead" />
              <polygon points="45,28 36,23 36,33" class="arrowHead" />
              <circle cx="45" cy="45" r="2.5" class="crosshair" />
            </svg>
          </button>
        </div>
      </div>
    </template>

    <!-- ═══ BOSS / POCKET VIEW ═══ -->
    <template v-else-if="probeView === 'boss'">
      <div class="section">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap bossGrid">
          <button
            v-for="op in bossGrid"
            :key="op.id"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id, active: activeBossOp === op.id }"
            :disabled="!can.ready || probing"
            :title="op.description"
            @click="runBossProbe(op)"
          >
            <!-- Round Boss: solid circle workpiece, probe at CENTER, arrows inward tips at surface -->
            <svg v-if="op.id === 'rb'" viewBox="0 0 80 80" class="gridIcon">
              <circle cx="40" cy="40" r="22" class="workpiece" />
              <polygon points="40,18 35,9 45,9" class="arrowHead" />
              <polygon points="40,62 35,71 45,71" class="arrowHead" />
              <polygon points="18,40 9,35 9,45" class="arrowHead" />
              <polygon points="62,40 71,35 71,45" class="arrowHead" />
              <circle cx="40" cy="40" r="8" class="crosshair" />
              <circle cx="40" cy="40" r="4" class="probeTip" />
            </svg>
            <!-- Round Pocket: ring workpiece, probe OUTSIDE left, arrows outward tips at walls -->
            <svg v-else-if="op.id === 'rp'" viewBox="0 0 80 80" class="gridIcon">
              <path d="M0 0H80V80H0Z M40 18a22 22 0 1 0 0 44a22 22 0 1 0 0-44Z" fill-rule="evenodd" class="workpiece" />
              <circle cx="5" cy="40" r="3" class="probeTip" />
              <polygon points="40,18 35,27 45,27" class="arrowHead" />
              <polygon points="40,62 35,53 45,53" class="arrowHead" />
              <polygon points="18,40 27,35 27,45" class="arrowHead" />
              <polygon points="62,40 53,35 53,45" class="arrowHead" />
              <circle cx="40" cy="40" r="2.5" class="crosshair" />
            </svg>
            <!-- Round Pocket Center Start: ring workpiece, probe at CENTER, arrows outward tips at walls -->
            <svg v-else-if="op.id === 'rpc'" viewBox="0 0 80 80" class="gridIcon">
              <path d="M0 0H80V80H0Z M40 18a22 22 0 1 0 0 44a22 22 0 1 0 0-44Z" fill-rule="evenodd" class="workpiece" />
              <polygon points="40,18 35,27 45,27" class="arrowHead" />
              <polygon points="40,62 35,53 45,53" class="arrowHead" />
              <polygon points="18,40 27,35 27,45" class="arrowHead" />
              <polygon points="62,40 53,35 53,45" class="arrowHead" />
              <circle cx="40" cy="40" r="8" class="crosshair" />
              <circle cx="40" cy="40" r="4" class="probeTip" />
            </svg>
            <!-- Rect Boss: solid rect workpiece, probe at CENTER, arrows inward -->
            <svg v-else-if="op.id === 'xb'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="15" y="15" width="50" height="50" rx="2" class="workpiece" />
              <polygon points="40,15 35,6 45,6" class="arrowHead" />
              <polygon points="40,65 35,74 45,74" class="arrowHead" />
              <polygon points="15,40 6,35 6,45" class="arrowHead" />
              <polygon points="65,40 74,35 74,45" class="arrowHead" />
              <circle cx="40" cy="40" r="8" class="crosshair" />
              <circle cx="40" cy="40" r="4" class="probeTip" />
            </svg>
            <!-- Rect Pocket: ring workpiece (rect hole), probe OUTSIDE left, arrows outward tips at walls -->
            <svg v-else-if="op.id === 'xp'" viewBox="0 0 80 80" class="gridIcon">
              <path d="M0 0H80V80H0Z M15 15H65V65H15Z" fill-rule="evenodd" class="workpiece" />
              <circle cx="5" cy="40" r="3" class="probeTip" />
              <polygon points="40,15 35,24 45,24" class="arrowHead" />
              <polygon points="40,65 35,56 45,56" class="arrowHead" />
              <polygon points="15,40 24,35 24,45" class="arrowHead" />
              <polygon points="65,40 56,35 56,45" class="arrowHead" />
              <circle cx="40" cy="40" r="2.5" class="crosshair" />
            </svg>
            <!-- Rect Pocket Center Start: ring workpiece (rect hole), probe at CENTER, arrows outward tips at walls -->
            <svg v-else-if="op.id === 'xpc'" viewBox="0 0 80 80" class="gridIcon">
              <path d="M0 0H80V80H0Z M15 15H65V65H15Z" fill-rule="evenodd" class="workpiece" />
              <polygon points="40,15 35,24 45,24" class="arrowHead" />
              <polygon points="40,65 35,56 45,56" class="arrowHead" />
              <polygon points="15,40 24,35 24,45" class="arrowHead" />
              <polygon points="65,40 56,35 56,45" class="arrowHead" />
              <circle cx="40" cy="40" r="8" class="crosshair" />
              <circle cx="40" cy="40" r="4" class="probeTip" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Hint parameters (inline) -->
      <div class="inlineParams">
        <label>Diameter <span class="varNum">#3025</span></label>
        <input type="number" v-model.number="params.diameterHint" min="0" step="0.5" :disabled="!can.ready" @change="saveParams" />
        <label>X Hint <span class="varNum">#3026</span></label>
        <input type="number" v-model.number="params.xHintBP" min="0" step="0.5" :disabled="!can.ready" @change="saveParams" />
        <label>Y Hint <span class="varNum">#3027</span></label>
        <input type="number" v-model.number="params.yHintBP" min="0" step="0.5" :disabled="!can.ready" @change="saveParams" />
      </div>
    </template>

    <!-- ═══ EDGE ANGLE VIEW ═══ -->
    <template v-else-if="probeView === 'angle'">
      <div class="section">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap angleGrid">
          <button
            v-for="op in angleGrid"
            :key="op.id"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
            :disabled="!can.ready || probing"
            :title="op.description"
            @click="runAngleProbe(op)"
          >
            <!-- Top Front (F): 56×56 square, arrows ↑ from below, crosshair on bottom edge -->
            <svg v-if="op.id === 'tf'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="12" y="2" width="56" height="56" class="workpiece" transform="rotate(-4, 40, 30)" />
              <circle cx="30" cy="38" r="4" class="probeTip" />
              <polygon points="30,58 25,69 35,69" class="arrowHead" />
              <polygon points="52,58 47,69 57,69" class="arrowHead" />
              <circle cx="30" cy="58" r="2.5" class="crosshair" />
            </svg>
            <!-- Top Back (B): 56×56 square, arrows ↓ from above, crosshair on top edge -->
            <svg v-else-if="op.id === 'tb'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="12" y="22" width="56" height="56" class="workpiece" transform="rotate(-4, 40, 50)" />
              <circle cx="50" cy="42" r="4" class="probeTip" />
              <polygon points="50,22 45,11 55,11" class="arrowHead" />
              <polygon points="28,22 23,11 33,11" class="arrowHead" />
              <circle cx="50" cy="22" r="2.5" class="crosshair" />
            </svg>
            <!-- Top Left (L): 56×56 square, arrows → from left, crosshair on left edge -->
            <svg v-else-if="op.id === 'tl'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="22" y="12" width="56" height="56" class="workpiece" transform="rotate(-4, 50, 40)" />
              <circle cx="42" cy="30" r="4" class="probeTip" />
              <polygon points="22,30 11,25 11,35" class="arrowHead" />
              <polygon points="22,52 11,47 11,57" class="arrowHead" />
              <circle cx="22" cy="30" r="2.5" class="crosshair" />
            </svg>
            <!-- Top Right (R): 56×56 square, arrows ← from right, crosshair on right edge -->
            <svg v-else-if="op.id === 'tr'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="2" y="12" width="56" height="56" class="workpiece" transform="rotate(-4, 30, 40)" />
              <circle cx="38" cy="50" r="4" class="probeTip" />
              <polygon points="58,50 69,45 69,55" class="arrowHead" />
              <polygon points="58,28 69,23 69,33" class="arrowHead" />
              <circle cx="58" cy="50" r="2.5" class="crosshair" />
            </svg>
            <!-- Z surface: rotated workpiece centered, crosshair+probe center -->
            <svg v-else-if="op.id === 'z'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" rx="3" class="workpiece" transform="rotate(-4, 40, 40)" />
              <circle cx="40" cy="40" r="9" class="crosshair" />
              <circle cx="40" cy="40" r="5" class="probeTip" />
              <text x="40" y="60" class="gridZLabel">Z</text>
            </svg>
            <!-- Corner X+ (BL): 1×↓ + 2×→, two arrows cross at probe dot -->
            <svg v-else-if="op.id === 'cx+'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="22" y="22" width="56" height="56" class="workpiece" transform="rotate(-4, 50, 50)" />
              <circle cx="42" cy="42" r="4" class="probeTip" />
              <polygon points="42,22 37,11 47,11" class="arrowHead" />
              <polygon points="22,42 11,37 11,47" class="arrowHead" />
              <polygon points="22,64 11,59 11,69" class="arrowHead" />
              <circle cx="22" cy="22" r="2.5" class="crosshair" transform="rotate(-4, 50, 50)" />
            </svg>
            <!-- Corner X− (FR): 1×↑ + 2×←, two arrows cross at probe dot -->
            <svg v-else-if="op.id === 'cx-'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="2" y="2" width="56" height="56" class="workpiece" transform="rotate(-4, 30, 30)" />
              <circle cx="38" cy="38" r="4" class="probeTip" />
              <polygon points="38,58 33,69 43,69" class="arrowHead" />
              <polygon points="58,38 69,33 69,43" class="arrowHead" />
              <polygon points="58,16 69,11 69,21" class="arrowHead" />
              <circle cx="58" cy="58" r="2.5" class="crosshair" transform="rotate(-4, 30, 30)" />
            </svg>
            <!-- Corner Y+ (FL): 1×→ + 2×↑, two arrows cross at probe dot -->
            <svg v-else-if="op.id === 'cy+'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="22" y="2" width="56" height="56" class="workpiece" transform="rotate(-4, 50, 30)" />
              <circle cx="42" cy="38" r="4" class="probeTip" />
              <polygon points="22,38 11,33 11,43" class="arrowHead" />
              <polygon points="42,58 37,69 47,69" class="arrowHead" />
              <polygon points="64,58 59,69 69,69" class="arrowHead" />
              <circle cx="22" cy="58" r="2.5" class="crosshair" transform="rotate(-4, 50, 30)" />
            </svg>
            <!-- Corner Y− (BR): 1×← + 2×↓, two arrows cross at probe dot -->
            <svg v-else-if="op.id === 'cy-'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="2" y="22" width="56" height="56" class="workpiece" transform="rotate(-4, 30, 50)" />
              <circle cx="38" cy="42" r="4" class="probeTip" />
              <polygon points="58,42 69,37 69,47" class="arrowHead" />
              <polygon points="38,22 33,11 43,11" class="arrowHead" />
              <polygon points="16,22 11,11 21,11" class="arrowHead" />
              <circle cx="58" cy="22" r="2.5" class="crosshair" transform="rotate(-4, 30, 50)" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Angle parameters (inline) -->
      <div class="inlineParams">
        <label>Edge Width <span class="varNum">#3024</span></label>
        <input type="number" v-model.number="params.edgeWidth" min="0.1" step="0.1" :disabled="!can.ready" @change="saveParams" />
        <label class="checkRow">
          <input type="checkbox" :checked="params.wcoRotation === 1" :disabled="!can.ready" @change="params.wcoRotation = ($event.target as HTMLInputElement).checked ? 1 : 0; saveParams()" />
          Set Rotation WCO
        </label>
      </div>
    </template>

    <!-- ═══ CALIBRATE VIEW ═══ -->
    <template v-else-if="probeView === 'cal'">
      <!-- Round calibration: buttons + diameter -->
      <div class="calSection">
        <div class="sub">Round Hole</div>
        <div class="calRow">
          <div class="calBtnPair">
            <button class="gridCell" :disabled="!can.ready || probing" title="Round hole — edge start" @click="runCalProbe('probe_cal_round_pocket')">
              <svg viewBox="0 0 80 80" class="gridIcon">
                <path d="M0 0H80V80H0Z M40 18a22 22 0 1 0 0 44a22 22 0 1 0 0-44Z" fill-rule="evenodd" class="workpiece" />
                <circle cx="5" cy="40" r="3" class="probeTip" />
                <polygon points="40,18 35,27 45,27" class="arrowHead" />
                <polygon points="40,62 35,53 45,53" class="arrowHead" />
                <polygon points="18,40 27,35 27,45" class="arrowHead" />
                <polygon points="62,40 53,35 53,45" class="arrowHead" />
                <circle cx="40" cy="40" r="2.5" class="crosshair" />
              </svg>
            </button>
            <button class="gridCell" :disabled="!can.ready || probing" title="Round hole — center start" @click="runCalProbe('probe_cal_round_boss')">
              <svg viewBox="0 0 80 80" class="gridIcon">
                <path d="M0 0H80V80H0Z M40 18a22 22 0 1 0 0 44a22 22 0 1 0 0-44Z" fill-rule="evenodd" class="workpiece" />
                <polygon points="40,18 35,27 45,27" class="arrowHead" />
                <polygon points="40,62 35,53 45,53" class="arrowHead" />
                <polygon points="18,40 27,35 27,45" class="arrowHead" />
                <polygon points="62,40 53,35 53,45" class="arrowHead" />
                <circle cx="40" cy="40" r="8" class="crosshair" />
                <circle cx="40" cy="40" r="4" class="probeTip" />
              </svg>
            </button>
          </div>
          <div class="calParamStacked">
            <div class="calParamRow">
              <label>Diameter <span class="varNum">#3033</span></label>
              <input type="number" v-model.number="params.calDiameter" min="0" step="0.001" :disabled="!can.ready" @change="saveParams" />
            </div>
          </div>
        </div>
      </div>

      <!-- Rect calibration: buttons + x/y width -->
      <div class="calSection">
        <div class="sub">Rectangular Pocket</div>
        <div class="calRow">
          <div class="calBtnPair">
            <button class="gridCell" :disabled="!can.ready || probing" title="Rect pocket — edge start" @click="runCalProbe('probe_cal_square_pocket')">
              <svg viewBox="0 0 80 80" class="gridIcon">
                <path d="M0 0H80V80H0Z M15 15H65V65H15Z" fill-rule="evenodd" class="workpiece" />
                <circle cx="5" cy="40" r="3" class="probeTip" />
                <polygon points="40,15 35,24 45,24" class="arrowHead" />
                <polygon points="40,65 35,56 45,56" class="arrowHead" />
                <polygon points="15,40 24,35 24,45" class="arrowHead" />
                <polygon points="65,40 56,35 56,45" class="arrowHead" />
                <circle cx="40" cy="40" r="2.5" class="crosshair" />
              </svg>
            </button>
            <button class="gridCell" :disabled="!can.ready || probing" title="Rect pocket — center start" @click="runCalProbe('probe_cal_square_boss')">
              <svg viewBox="0 0 80 80" class="gridIcon">
                <path d="M0 0H80V80H0Z M15 15H65V65H15Z" fill-rule="evenodd" class="workpiece" />
                <polygon points="40,15 35,24 45,24" class="arrowHead" />
                <polygon points="40,65 35,56 45,56" class="arrowHead" />
                <polygon points="15,40 24,35 24,45" class="arrowHead" />
                <polygon points="65,40 56,35 56,45" class="arrowHead" />
                <circle cx="40" cy="40" r="8" class="crosshair" />
                <circle cx="40" cy="40" r="4" class="probeTip" />
              </svg>
            </button>
          </div>
          <div class="calParamStacked">
            <div class="calParamRow">
              <label>X Width <span class="varNum">#3034</span></label>
              <input type="number" v-model.number="params.xCalWidth" min="0" step="0.001" :disabled="!can.ready" @change="saveParams" />
            </div>
            <div class="calParamRow">
              <label>Y Width <span class="varNum">#3035</span></label>
              <input type="number" v-model.number="params.yCalWidth" min="0" step="0.001" :disabled="!can.ready" @change="saveParams" />
            </div>
          </div>
        </div>
      </div>

      <!-- Calibrate on axis selector -->
      <div class="section">
        <div class="calParamTitle">Calibrate on:</div>
        <div class="calAxisRow">
          <button class="calAxisBtn" :class="{ active: calAxis === 0 }" :disabled="!can.ready" @click="calAxis = 0">Avg XY</button>
          <button class="calAxisBtn" :class="{ active: calAxis === 1 }" :disabled="!can.ready" @click="calAxis = 1">X Error</button>
          <button class="calAxisBtn" :class="{ active: calAxis === 2 }" :disabled="!can.ready" @click="calAxis = 2">Y Error</button>
        </div>
      </div>
    </template>

    <!-- ═══ RIDGE / VALLEY VIEW ═══ -->
    <template v-else>
      <div class="section">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap bossGrid">
          <button
            v-for="op in ridgeGrid"
            :key="op.id"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
            :disabled="!can.ready || probing"
            :title="op.description"
            @click="runRidgeProbe(op)"
          >
            <!-- Ridge X: vertical bar, 2 horizontal arrows inward, probe+crosshair at center -->
            <svg v-if="op.id === 'rx'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="25" y="0" width="30" height="80" class="workpiece" />
              <polygon points="25,40 16,35 16,45" class="arrowHead" />
              <polygon points="55,40 64,35 64,45" class="arrowHead" />
              <circle cx="40" cy="40" r="8" class="crosshair" />
              <circle cx="40" cy="40" r="4" class="probeTip" />
            </svg>
            <!-- Ridge Y: horizontal bar, 2 vertical arrows inward, probe+crosshair at center -->
            <svg v-else-if="op.id === 'ry'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="0" y="25" width="80" height="30" class="workpiece" />
              <polygon points="40,25 35,16 45,16" class="arrowHead" />
              <polygon points="40,55 35,64 45,64" class="arrowHead" />
              <circle cx="40" cy="40" r="8" class="crosshair" />
              <circle cx="40" cy="40" r="4" class="probeTip" />
            </svg>
            <!-- Valley X: two vertical walls, 2 horizontal arrows outward, probe dot outside left -->
            <svg v-else-if="op.id === 'vx'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="0" y="0" width="20" height="80" class="workpiece" />
              <rect x="60" y="0" width="20" height="80" class="workpiece" />
              <polygon points="20,40 29,35 29,45" class="arrowHead" />
              <polygon points="60,40 51,35 51,45" class="arrowHead" />
              <circle cx="5" cy="40" r="3" class="probeTip" />
              <circle cx="40" cy="40" r="2.5" class="crosshair" />
            </svg>
            <!-- Valley Y: two horizontal walls, 2 vertical arrows outward, probe dot outside top -->
            <svg v-else-if="op.id === 'vy'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="0" y="0" width="80" height="20" class="workpiece" />
              <rect x="0" y="60" width="80" height="20" class="workpiece" />
              <polygon points="40,20 35,29 45,29" class="arrowHead" />
              <polygon points="40,60 35,51 45,51" class="arrowHead" />
              <circle cx="40" cy="5" r="3" class="probeTip" />
              <circle cx="40" cy="40" r="2.5" class="crosshair" />
            </svg>
            <!-- Valley X Center: two vertical walls, 2 horizontal arrows outward, probe+crosshair at center -->
            <svg v-else-if="op.id === 'vxc'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="0" y="0" width="20" height="80" class="workpiece" />
              <rect x="60" y="0" width="20" height="80" class="workpiece" />
              <polygon points="20,40 29,35 29,45" class="arrowHead" />
              <polygon points="60,40 51,35 51,45" class="arrowHead" />
              <circle cx="40" cy="40" r="8" class="crosshair" />
              <circle cx="40" cy="40" r="4" class="probeTip" />
            </svg>
            <!-- Valley Y Center: two horizontal walls, 2 vertical arrows outward, probe+crosshair at center -->
            <svg v-else-if="op.id === 'vyc'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="0" y="0" width="80" height="20" class="workpiece" />
              <rect x="0" y="60" width="80" height="20" class="workpiece" />
              <polygon points="40,20 35,29 45,29" class="arrowHead" />
              <polygon points="40,60 35,51 45,51" class="arrowHead" />
              <circle cx="40" cy="40" r="8" class="crosshair" />
              <circle cx="40" cy="40" r="4" class="probeTip" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Hint parameters (inline) -->
      <div class="inlineParams">
        <label>X Hint <span class="varNum">#3028</span></label>
        <input type="number" v-model.number="params.xHintRV" min="0" step="0.5" :disabled="!can.ready" @change="saveParams" />
        <label>Y Hint <span class="varNum">#3029</span></label>
        <input type="number" v-model.number="params.yHintRV" min="0" step="0.5" :disabled="!can.ready" @change="saveParams" />
      </div>
    </template>

    <div class="sep"></div>

    <!-- Parameters (shared across views) -->
    <div class="section">
      <div class="sub">Parameters</div>
      <div class="paramGrid twoCol">
        <label>Probe Tool # <span class="varNum">#3014</span></label>
        <input type="number" v-model.number="params.probeTool" min="1" step="1" :disabled="!can.ready" @change="saveParams" />

        <label>Probe Slow FRate <span class="varNum">#3015</span></label>
        <input type="number" v-model.number="params.slowFr" min="0" step="1" :disabled="!can.ready" @change="saveParams" />

        <label>Probe Traverse FR <span class="varNum">#3017</span></label>
        <input type="number" v-model.number="params.traverseFr" min="1" step="100" :disabled="!can.ready" @change="saveParams" />

        <label>Probe Fast FRate <span class="varNum">#3016</span></label>
        <input type="number" v-model.number="params.fastFr" min="1" step="10" :disabled="!can.ready" @change="saveParams" />

        <label>Max X/Y Distance <span class="varNum">#3018</span></label>
        <input type="number" v-model.number="params.maxXYDistance" min="0" step="0.5" :disabled="!can.ready" @change="saveParams" />

        <label>X/Y Clearance <span class="varNum">#3019</span></label>
        <input type="number" v-model.number="params.xyClearance" min="0" step="0.1" :disabled="!can.ready" @change="saveParams" />

        <label>Max Z Distance <span class="varNum">#3020</span></label>
        <input type="number" v-model.number="params.maxZDistance" min="0" step="0.5" :disabled="!can.ready" @change="saveParams" />

        <label>Z Clearance <span class="varNum">#3021</span></label>
        <input type="number" v-model.number="params.zClearance" min="0" step="0.1" :disabled="!can.ready" @change="saveParams" />

        <label>Extra Probe Depth <span class="varNum">#3022</span></label>
        <input type="number" v-model.number="params.extraProbeDepth" min="0" step="0.1" :disabled="!can.ready" @change="saveParams" />

        <label>Step Off Width <span class="varNum">#3023</span></label>
        <input type="number" v-model.number="params.stepOffWidth" min="0.1" step="0.5" :disabled="!can.ready" @change="saveParams" />
      </div>
    </div>

    <div class="sep"></div>

    <!-- Probe Results (PB-style feedback) -->
    <div class="section">
      <div class="sub">Probe Results</div>
      <div class="probeResultsGrid">
        <div class="prCell"><span class="prLabel">X-</span><span class="prVal">{{ fmtR("x_minus") }}</span></div>
        <div class="prCell"><span class="prLabel">X+</span><span class="prVal">{{ fmtR("x_plus") }}</span></div>
        <div class="prCell"><span class="prLabel">X Width</span><span class="prVal">{{ fmtR("x_width") }}</span></div>

        <div class="prCell"><span class="prLabel">Y-</span><span class="prVal">{{ fmtR("y_minus") }}</span></div>
        <div class="prCell"><span class="prLabel">Y+</span><span class="prVal">{{ fmtR("y_plus") }}</span></div>
        <div class="prCell"><span class="prLabel">Y Width</span><span class="prVal">{{ fmtR("y_width") }}</span></div>

        <div class="prCell"><span class="prLabel">Z-</span><span class="prVal">{{ fmtR("z_minus") }}</span></div>
        <div class="prCell"><span class="prLabel">Diam</span><span class="prVal">{{ fmtR("diameter") }}</span></div>
        <div class="prCell"><span class="prLabel">X Center</span><span class="prVal">{{ fmtR("x_center") }}</span></div>

        <div class="prCell"><span class="prLabel">Edge Delta</span><span class="prVal">{{ fmtR("edge_delta") }}</span></div>
        <div class="prCell"><span class="prLabel">Edge Angle</span><span class="prVal">{{ fmtR("edge_angle") }}</span></div>
        <div class="prCell"><span class="prLabel">Y Center</span><span class="prVal">{{ fmtR("y_center") }}</span></div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.probePanel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  height: 100%;
}

/* Control bar (horizontal, between tabs and grid) */
.controlBar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}

.controlBarRight {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
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

.workpiece {
  fill: color-mix(in oklab, var(--fg) 12%, var(--bg));
  stroke: var(--fg);
  stroke-width: 1.5;
  stroke-opacity: 0.5;
}

.probeTip {
  fill: var(--warn);
  stroke: var(--fg);
  stroke-width: 1;
  stroke-opacity: 0.5;
}

.arrowHead {
  fill: var(--ok);
  opacity: 0.8;
}

/* View tabs */
.viewTabs {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}

.viewTab {
  flex: 1;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  text-align: center;
  opacity: 0.6;
}

.viewTab.active {
  opacity: 1;
  background: color-mix(in oklab, var(--fg) 15%, var(--button-bg));
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

/* Grids (centered) */
.gridWrap {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  max-width: 294px;
  margin: 0 auto;
}

.gridWrap.bossGrid {
  grid-template-columns: repeat(3, 1fr);
}

.gridWrap.angleGrid {
  grid-template-columns: repeat(3, 1fr);
}

/* Calibration rows */
.calSection {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.calRow {
  display: flex;
  align-items: center;
  gap: 12px;
}

.calBtnPair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  width: 196px;
  flex-shrink: 0;
}

.calParamStacked {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-self: center;
}

.calParamRow {
  display: grid;
  grid-template-columns: 100px 80px;
  align-items: center;
  gap: 6px;
}

.calParamRow label {
  font-size: 11px;
  opacity: 0.7;
  white-space: nowrap;
}

.calParamRow input {
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
  width: 100%;
  box-sizing: border-box;
}

/* Inline params (single horizontal row) */
.inlineParams {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.inlineParams label {
  font-size: 11px;
  opacity: 0.7;
  white-space: nowrap;
}

.inlineParams input {
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
  width: 80px;
}

/* Calibration layout */
.calOffsetGroup {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
}

.calOffsetLabel {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.7;
}

.calOffsetVal {
  font-size: 13px;
  font-weight: 700;
  font-family: monospace;
  padding: 4px 8px;
  border-radius: 4px;
  background: color-mix(in oklab, var(--fg) 6%, var(--bg));
  border: 1px solid var(--border);
}

.calResetBtn {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  margin-left: auto;
}

.calParamTitle {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.6;
}

.calAxisRow {
  display: flex;
  gap: 4px;
  max-width: 294px;
}

.calAxisBtn {
  flex: 1;
  padding: 6px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  text-align: center;
}

.calAxisBtn.active {
  background: color-mix(in oklab, var(--fg) 15%, var(--button-bg));
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

.gridCell {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  padding: 4px;
  transition: background 0.12s, border-color 0.12s;
}

.gridCell:hover:not(:disabled) {
  background: color-mix(in oklab, var(--fg) 15%, var(--button-bg));
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

.gridCell:disabled {
  opacity: 0.35;
}

.gridCell.probing {
  background: color-mix(in oklab, var(--warn) 25%, var(--button-bg));
  border-color: color-mix(in oklab, var(--warn) 40%, var(--border));
  animation: pulse 0.8s ease-in-out infinite alternate;
}

.gridIcon {
  width: 100%;
  height: 100%;
  max-width: 80px;
  max-height: 80px;
}

.gridZLabel {
  fill: var(--fg);
  opacity: 0.5;
  font-size: 14px;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
}

.crosshair {
  fill: none;
  stroke: var(--ok);
  stroke-width: 1.5;
}

.crosshairLine {
  stroke: var(--ok);
  stroke-width: 1.5;
  opacity: 0.8;
}

/* Parameters */
.paramGrid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 10px;
  align-items: center;
}

.paramGrid.twoCol {
  grid-template-columns: auto 1fr auto 1fr;
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

.paramGrid input {
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
  max-width: 100px;
}

.checkRow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

/* Run / Abort buttons */
.btnRow {
  display: flex;
  gap: 6px;
}

.abortBtn {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  background: color-mix(in oklab, var(--danger) 20%, var(--button-bg));
  border-color: color-mix(in oklab, var(--danger) 30%, var(--border));
  color: var(--danger);
}

.abortBtn.compact,
.simTripBtn.compact {
  padding: 5px 10px;
  font-size: 11px;
  border-radius: 6px;
}

.abortBtn:disabled {
  opacity: 0.3;
  color: var(--fg);
  background: var(--button-bg);
  border-color: var(--border);
}

.simTripBtn {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
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

/* Status */
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

/* Probe results (PB-style 3×4 grid) */
.probeResultsGrid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 4px;
}

.prCell {
  display: flex;
  flex-direction: column;
  padding: 4px 6px;
  border-radius: 4px;
  background: color-mix(in oklab, var(--fg) 4%, var(--bg));
  border: 1px solid var(--border);
}

.prLabel {
  font-size: 10px;
  font-weight: 600;
  opacity: 0.5;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.prVal {
  font-size: 13px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-weight: 600;
}

</style>
