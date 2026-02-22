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
}>();

const emit = defineEmits<{
  (e: "mdi", text: string): void;
  (e: "abort"): void;
  (e: "listProbeMacros"): void;
  (e: "simulateProbeTrip"): void;
  (e: "setProbeVars", vars: Record<string, number>): void;
  (e: "getProbeVars"): void;
}>();

const can = usePermissions();

// ─── Sub-view navigation ──────────────────────────────────────────
const probeView = ref<"edge" | "outside" | "inside" | "boss">("outside");

// ─── Edge probe operations (single-axis) ──────────────────────────
type ProbeOp = {
  id: string;
  label: string;
  macro: string;
  wcoMacro: string;
  axisIdx: number;      // 0=X, 1=Y, 2=Z
  description: string;
};

const operations: ProbeOp[] = [
  { id: "x+", label: "X+", macro: "probe_x_plus",  wcoMacro: "probe_x_plus_wco",  axisIdx: 0, description: "Place probe left of workpiece face" },
  { id: "x-", label: "X−", macro: "probe_x_minus", wcoMacro: "probe_x_minus_wco", axisIdx: 0, description: "Place probe right of workpiece face" },
  { id: "y+", label: "Y+", macro: "probe_y_plus",  wcoMacro: "probe_y_plus_wco",  axisIdx: 1, description: "Place probe in front of workpiece face" },
  { id: "y-", label: "Y−", macro: "probe_y_minus", wcoMacro: "probe_y_minus_wco", axisIdx: 1, description: "Place probe behind workpiece face" },
  { id: "z-", label: "Z−", macro: "probe_z_minus", wcoMacro: "probe_z_minus_wco", axisIdx: 2, description: "Place probe above workpiece surface" },
];

const selectedOp = ref<string>("x+");
const currentOp = computed(() => operations.find(o => o.id === selectedOp.value)!);

// ─── Outside corners 3x3 grid ─────────────────────────────────────
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

const activeGridOp = ref<string | null>(null);
const activeBossOp = ref<string>("rb");
const bossOpIsRound = computed(() => ["rb", "rp", "rpc"].includes(activeBossOp.value));

// ─── Parameters ───────────────────────────────────────────────────
// Parameter order matches config v0.2 subroutines:
// #1=probe_tool, #2=slow_fr, #3=fast_fr, #4=traverse_fr, #5=max_distance, #6=clearance, #7=cal_offset
const params = ref({
  probeTool: 99,
  slowFr: 50.0,
  fastFr: 200.0,
  traverseFr: 1000.0,
  maxDistance: 10.0,
  clearance: 2.0,
  calOffset: 0.0,
  stepOffWidth: 5.0,
  extraProbeDepth: 0.0,
  edgeWidth: 0.5,
  diameterHint: 0.0,
  xHintBP: 0.0,
  yHintBP: 0.0,
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
    "3018": p.maxDistance,   // XY max distance
    "3019": p.clearance,     // XY clearance
    "3020": p.maxDistance,   // Z max distance (same value)
    "3021": p.clearance,     // Z clearance (same value)
    "3022": p.extraProbeDepth,
    "3023": p.stepOffWidth,
    "3024": p.edgeWidth,
    "3025": p.diameterHint,
    "3026": p.xHintBP,
    "3027": p.yHintBP,
    "3030": probeMode,       // 0 = set WCO, 1 = measure only
    "3032": p.calOffset,
  };
}

function loadParams() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.autoZero != null) autoZero.value = saved.autoZero;
      delete saved.autoZero;
      Object.assign(params.value, saved);
    }
  } catch { /* ignore */ }
  // Request current values from var file (overlay on next tick via initialVars watcher)
  emit("getProbeVars");
}

function saveParams() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  // Sync to var file (and best-effort MDI) on every change
  emit("setProbeVars", buildVarMap(autoZero.value ? 0 : 1));
}

/** When var file values arrive, overlay onto current params */
watch(() => props.initialVars, (vars) => {
  if (!vars) return;
  const p = params.value;
  if (vars["3014"] != null) p.probeTool = vars["3014"];
  if (vars["3015"] != null) p.slowFr = vars["3015"];
  if (vars["3016"] != null) p.fastFr = vars["3016"];
  if (vars["3017"] != null) p.traverseFr = vars["3017"];
  // Use XY distance/clearance as canonical (3018/3019)
  if (vars["3018"] != null) p.maxDistance = vars["3018"];
  if (vars["3019"] != null) p.clearance = vars["3019"];
  if (vars["3022"] != null) p.extraProbeDepth = vars["3022"];
  if (vars["3023"] != null) p.stepOffWidth = vars["3023"];
  if (vars["3024"] != null) p.edgeWidth = vars["3024"];
  if (vars["3025"] != null) p.diameterHint = vars["3025"];
  if (vars["3026"] != null) p.xHintBP = vars["3026"];
  if (vars["3027"] != null) p.yHintBP = vars["3027"];
  if (vars["3032"] != null) p.calOffset = vars["3032"];
  // Persist to localStorage
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
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
function runProbe() {
  const op = currentOp.value;
  // Save to localStorage (don't use saveParams() to avoid double setProbeVars emit)
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  // Always use _wco macro — #3030 controls whether WCS is set (0) or measure-only (1)
  // setProbeVars writes to var file AND sets in-memory vars via MDI, then we call the macro
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  emit("setProbeVars", vars);
  emit("mdi", `O<${op.wcoMacro}> CALL`);
}

function runGridProbe(op: GridOp) {
  activeGridOp.value = op.id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  emit("setProbeVars", vars);
  emit("mdi", `O<${op.macro}> CALL`);
}

function runBossProbe(op: GridOp) {
  activeBossOp.value = op.id;
  activeGridOp.value = op.id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  emit("setProbeVars", vars);
  emit("mdi", `O<${op.macro}> CALL`);
}

function fmt(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "---";
  return n.toFixed(4);
}
</script>

<template>
  <div class="probePanel scroll-thin">
    <!-- Sub-view tabs -->
    <div class="viewTabs">
      <button class="viewTab" :class="{ active: probeView === 'outside' }" @click="probeView = 'outside'">Outside</button>
      <button class="viewTab" :class="{ active: probeView === 'inside' }" @click="probeView = 'inside'">Inside</button>
      <button class="viewTab" :class="{ active: probeView === 'boss' }" @click="probeView = 'boss'">Boss/Pocket</button>
      <button class="viewTab" :class="{ active: probeView === 'edge' }" @click="probeView = 'edge'">Edge</button>
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

      <!-- Hint parameters (contextual) -->
      <div class="section">
        <div class="sub">Dimensional Hints</div>
        <div class="paramGrid">
          <label>Diameter</label>
          <input type="number" v-model.number="params.diameterHint" min="0" step="0.5" @change="saveParams" />
          <label>X Hint</label>
          <input type="number" v-model.number="params.xHintBP" min="0" step="0.5" @change="saveParams" />
          <label>Y Hint</label>
          <input type="number" v-model.number="params.yHintBP" min="0" step="0.5" @change="saveParams" />
        </div>
      </div>
    </template>

    <!-- ═══ EDGE VIEW (existing single-axis) ═══ -->
    <template v-else>
      <div class="section">
        <div class="sub">Probe Operation</div>
        <div class="opRow">
          <div class="opButtons">
            <button
              v-for="op in operations"
              :key="op.id"
              class="opBtn"
              :class="{ active: selectedOp === op.id }"
              @click="selectedOp = op.id"
            >{{ op.label }}</button>
          </div>
          <div class="diagramWrap">
            <svg v-if="selectedOp === 'x+'" viewBox="0 0 160 120" class="diagram">
              <rect x="70" y="20" width="70" height="80" rx="3" class="workpiece" />
              <text x="105" y="65" class="wpLabel">W</text>
              <line x1="20" y1="60" x2="52" y2="60" class="stylus" />
              <circle cx="56" cy="60" r="4" class="probeTip" />
              <line x1="30" y1="45" x2="50" y2="45" class="arrow" />
              <polygon points="50,41 58,45 50,49" class="arrowHead" />
              <text x="80" y="112" class="dirLabel">X+</text>
            </svg>
            <svg v-else-if="selectedOp === 'x-'" viewBox="0 0 160 120" class="diagram">
              <rect x="20" y="20" width="70" height="80" rx="3" class="workpiece" />
              <text x="55" y="65" class="wpLabel">W</text>
              <line x1="140" y1="60" x2="108" y2="60" class="stylus" />
              <circle cx="104" cy="60" r="4" class="probeTip" />
              <line x1="130" y1="45" x2="110" y2="45" class="arrow" />
              <polygon points="110,41 102,45 110,49" class="arrowHead" />
              <text x="80" y="112" class="dirLabel">X−</text>
            </svg>
            <svg v-else-if="selectedOp === 'y+'" viewBox="0 0 160 120" class="diagram">
              <rect x="30" y="10" width="100" height="50" rx="3" class="workpiece" />
              <text x="80" y="40" class="wpLabel">W</text>
              <line x1="80" y1="100" x2="80" y2="78" class="stylus" />
              <circle cx="80" cy="74" r="4" class="probeTip" />
              <line x1="65" y1="95" x2="65" y2="78" class="arrow" />
              <polygon points="61,78 65,70 69,78" class="arrowHead" />
              <text x="80" y="115" class="dirLabel">Y+</text>
            </svg>
            <svg v-else-if="selectedOp === 'y-'" viewBox="0 0 160 120" class="diagram">
              <rect x="30" y="60" width="100" height="50" rx="3" class="workpiece" />
              <text x="80" y="90" class="wpLabel">W</text>
              <line x1="80" y1="20" x2="80" y2="42" class="stylus" />
              <circle cx="80" cy="46" r="4" class="probeTip" />
              <line x1="65" y1="25" x2="65" y2="42" class="arrow" />
              <polygon points="61,42 65,50 69,42" class="arrowHead" />
              <text x="80" y="115" class="dirLabel">Y−</text>
            </svg>
            <svg v-else-if="selectedOp === 'z-'" viewBox="0 0 160 120" class="diagram">
              <rect x="20" y="70" width="120" height="30" rx="3" class="workpiece" />
              <text x="80" y="90" class="wpLabel">W</text>
              <line x1="80" y1="10" x2="80" y2="48" class="stylus" />
              <circle cx="80" cy="52" r="4" class="probeTip" />
              <line x1="65" y1="18" x2="65" y2="45" class="arrow" />
              <polygon points="61,45 65,53 69,45" class="arrowHead" />
              <text x="15" y="115" class="viewLabel">side view</text>
              <text x="80" y="115" class="dirLabel">Z−</text>
            </svg>
          </div>
        </div>
        <div class="opHint">{{ currentOp.description }}</div>
      </div>
    </template>

    <div class="sep"></div>

    <!-- Parameters (shared across views) -->
    <div class="section">
      <div class="sub">Parameters</div>
      <div class="paramGrid">
        <label>Probe Tool</label>
        <input type="number" v-model.number="params.probeTool" min="1" step="1" @change="saveParams" />

        <label>Max Distance</label>
        <input type="number" v-model.number="params.maxDistance" min="0.1" step="0.5" @change="saveParams" />

        <label>Clearance</label>
        <input type="number" v-model.number="params.clearance" min="0.01" step="0.1" @change="saveParams" />

        <label>Step Off</label>
        <input type="number" v-model.number="params.stepOffWidth" min="0.1" step="0.5" @change="saveParams" />

        <label>Extra Depth</label>
        <input type="number" v-model.number="params.extraProbeDepth" min="0" step="0.1" @change="saveParams" />

        <label>Slow Feed</label>
        <input type="number" v-model.number="params.slowFr" min="0" step="1" @change="saveParams" />

        <label>Fast Feed</label>
        <input type="number" v-model.number="params.fastFr" min="1" step="10" @change="saveParams" />

        <label>Traverse Feed</label>
        <input type="number" v-model.number="params.traverseFr" min="1" step="100" @change="saveParams" />

        <label>Cal Offset</label>
        <input type="number" v-model.number="params.calOffset" step="0.001" @change="saveParams" />
      </div>
      <label class="checkRow">
        <input type="checkbox" v-model="autoZero" @change="saveParams" />
        Auto Zero
      </label>
    </div>

    <div class="sep"></div>

    <!-- Run / Abort + status (Edge view only has the Run button; Outside view runs from grid) -->
    <div class="section">
      <div class="btnRow">
        <button
          v-if="probeView === 'edge'"
          class="runBtn"
          :class="statusClass"
          :disabled="!can.ready || probing"
          @click="runProbe"
        >
          <span v-if="probing">Probing {{ currentOp.label }}…</span>
          <span v-else>Probe {{ currentOp.label }}</span>
        </button>
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

      <div class="statusRow">
        <span class="statusDot" :class="statusClass"></span>
        <span class="statusText">{{ probeStatus }}</span>
      </div>
    </div>

    <div class="sep"></div>

    <!-- Results -->
    <div class="section">
      <div class="sub">Probed Position</div>
      <div class="resultGrid">
        <div class="resultAxis"><span class="axisLabel">X</span><span class="axisVal">{{ probeTripped ? fmt(probedPosition?.[0]) : '---' }}</span></div>
        <div class="resultAxis"><span class="axisLabel">Y</span><span class="axisVal">{{ probeTripped ? fmt(probedPosition?.[1]) : '---' }}</span></div>
        <div class="resultAxis"><span class="axisLabel">Z</span><span class="axisVal">{{ probeTripped ? fmt(probedPosition?.[2]) : '---' }}</span></div>
      </div>
    </div>

    <div class="sep"></div>

    <!-- Current position reference -->
    <div class="section">
      <div class="sub">Current Work Position</div>
      <div class="resultGrid">
        <div class="resultAxis"><span class="axisLabel">X</span><span class="axisVal dim">{{ fmt(workPos[0]) }}</span></div>
        <div class="resultAxis"><span class="axisLabel">Y</span><span class="axisVal dim">{{ fmt(workPos[1]) }}</span></div>
        <div class="resultAxis"><span class="axisLabel">Z</span><span class="axisVal dim">{{ fmt(workPos[2]) }}</span></div>
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

/* Operation row: buttons left, diagram right */
.opRow {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.opButtons {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.opBtn {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  min-width: 48px;
  text-align: center;
}

.opBtn.active {
  background: color-mix(in oklab, var(--fg) 15%, var(--button-bg));
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

.opHint {
  font-size: 11px;
  opacity: 0.5;
  font-style: italic;
}

/* Diagram */
.diagramWrap {
  flex: 1;
  display: flex;
  justify-content: center;
  min-height: 100px;
}

.diagram {
  width: 100%;
  max-width: 180px;
  height: auto;
}

.workpiece {
  fill: color-mix(in oklab, var(--fg) 12%, var(--bg));
  stroke: var(--fg);
  stroke-width: 1.5;
  stroke-opacity: 0.5;
}

.wpLabel {
  fill: var(--fg);
  opacity: 0.3;
  font-size: 14px;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
}

.stylus {
  stroke: var(--fg);
  stroke-width: 2;
  stroke-opacity: 0.8;
}

.probeTip {
  fill: var(--warn);
  stroke: var(--fg);
  stroke-width: 1;
  stroke-opacity: 0.5;
}

.arrow {
  stroke: var(--ok);
  stroke-width: 1.5;
  stroke-opacity: 0.8;
}

.arrowHead {
  fill: var(--ok);
  opacity: 0.8;
}

.dirLabel {
  fill: var(--fg);
  opacity: 0.5;
  font-size: 11px;
  font-weight: 600;
  text-anchor: middle;
}

.viewLabel {
  fill: var(--fg);
  opacity: 0.3;
  font-size: 9px;
  font-style: italic;
  text-anchor: start;
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

/* 3x3 grid */
.gridWrap {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.gridWrap.bossGrid {
  grid-template-columns: repeat(3, 1fr);
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

.paramGrid label {
  font-size: 11px;
  opacity: 0.7;
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
  margin-top: 4px;
}

/* Run / Abort buttons */
.btnRow {
  display: flex;
  gap: 6px;
}

.runBtn {
  flex: 1;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
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

.runBtn.probing {
  background: color-mix(in oklab, var(--warn) 25%, var(--button-bg));
  border-color: color-mix(in oklab, var(--warn) 40%, var(--border));
}

.runBtn.tripped {
  background: color-mix(in oklab, var(--ok) 25%, var(--button-bg));
  border-color: color-mix(in oklab, var(--ok) 40%, var(--border));
}

/* Status */
.statusRow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
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

/* Results */
.resultGrid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.resultAxis {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.axisLabel {
  font-size: 11px;
  opacity: 0.6;
  width: 14px;
}

.axisVal {
  font-size: 16px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-weight: 600;
}

.axisVal.dim {
  opacity: 0.5;
  font-size: 13px;
}
</style>
