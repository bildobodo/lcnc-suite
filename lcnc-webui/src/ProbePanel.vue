<script setup lang="ts">
import { ref, computed, inject, onMounted, onUnmounted, watch, type Ref } from "vue";
import MachineBtn from "./MachineBtn.vue";
import { fmtNum } from "./format";
import MachineInput from "./MachineInput.vue";
import MachineToggle from "./MachineToggle.vue";
import MachineRadio from "./MachineRadio.vue";
import { usePermissions } from "./permissions";
import { STEP_DEFAULT, STEP_FEED, loadProbeDefaults, saveProbeDefaults, settingsVersion, serverSettingsReady, saveToolsetterDefaults, TOOLSETTER_FALLBACK } from "./defaults";
import ToolsetterSettings from "./ToolsetterSettings.vue";
import CornerGlyph from "./CornerGlyph.vue";
import Gate from "./Gate.vue";
import HelpIcon from "./HelpIcon.vue";

const props = defineProps<{
  probing: boolean;
  probeTripped: boolean;
  probeInput: boolean;
  probedPosition: number[] | null;
  workPos: number[];
  probeResults: Record<string, number> | null;
  eoffsetZ: number | null;
  eoffsetEnabled: boolean;
  compMethod: number | null;  // 0=nearest, 1=linear, 2=cubic
  compGridVersion: number;
  surfacePoints: [number, number, number][] | null;
  compGrid: { x: number[]; y: number[]; zi: number[][]; method: number } | null;
  surfaceLayerVisible: boolean;
}>();

const emit = defineEmits<{
  (e: "mdi", text: string): void;
  (e: "abort"): void;
  (e: "simTrip"): void;
  (e: "listProbeMacros"): void;
  (e: "setProbeVars", vars: Record<string, number>): void;
  (e: "runProbe", payload: { vars: Record<string, number>; macro: string }): void;
  (e: "getProbeResults"): void;
  (e: "getCompGrid"): void;
  (e: "setCompensation", enable: boolean): void;
  (e: "setCompMethod", method: number): void;
  (e: "toggleSurfaceLayer", on: boolean): void;
}>();


const can = usePermissions();
const themeMode = inject<Ref<string>>("themeMode", ref("auto"));
const isDev = import.meta.env.DEV;

// ─── Sub-view navigation ──────────────────────────────────────────
const probeView = ref<"outside" | "inside" | "boss" | "ridge" | "angle" | "cal" | "surface" | "toolsetter">("outside");

// ─── Reset confirmation ──────────────────────────────────────────
const resetTarget = ref<string | null>(null);
function confirmReset() {
  const target = resetTarget.value;
  resetTarget.value = null;
  if (target === "toolsetter") saveToolsetterDefaults({ ...TOOLSETTER_FALLBACK });
  else if (target === "cal") emit("mdi", `O<probe_cal_reset> CALL`);
}

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
  // Surface map scan params
  scanX0: 10.0,
  scanX1: 200.0,
  scanY0: 10.0,
  scanY1: 200.0,
  scanXProbes: 5,
  scanYProbes: 5,
  scanSafeZ: 20.0,
  scanDepthZ: 24.0,
});

const autoZero = ref(false);
const setRotation = computed({
  get: () => params.value.wcoRotation === 1,
  set: (v: boolean) => { params.value.wcoRotation = v ? 1 : 0; saveParams(); },
});


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
    // Surface map scan (#3050-#3059)
    "3050": p.scanX0,
    "3051": p.scanX1,
    "3052": p.scanY0,
    "3053": p.scanY1,
    "3054": p.scanXProbes,
    "3055": p.scanYProbes,
    "3056": p.fastFr,     // shared with #3016
    "3057": p.slowFr,     // shared with #3015
    "3058": p.scanSafeZ,
    "3059": p.scanDepthZ,
  };
}

function loadParams() {
  const saved = loadProbeDefaults();
  autoZero.value = saved.autoZero;
  const { autoZero: _, ...rest } = saved;
  Object.assign(params.value, rest);
}

function saveParams() {
  saveProbeDefaults({ ...params.value, autoZero: autoZero.value });
  // Sync to var file when machine is ready (execution functions also sync before each probe)
  if (can.value.ready) emit("setProbeVars", buildVarMap(autoZero.value ? 0 : 1));
}

/** Sync cal offset from DEBUG EVAL messages (emitted by cal subroutines and reset). */
watch(() => props.probeResults?.cal_offset, (v) => {
  if (v != null) {
    params.value.calOffset = v;
    saveProbeDefaults({ ...params.value, autoZero: autoZero.value });
  }
});

// Re-read when another client changes probe settings
watch(settingsVersion, () => { loadParams(); });

onMounted(() => {
  loadParams();
});

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

const probeIndicatorClass = computed(() => {
  if (props.probeInput) return "tripped";
  return "";
});

// ─── Run probe ────────────────────────────────────────────────────
function runGridProbe(op: GridOp) {
  if (!can.value.ready || props.probing) return;
  activeGridOp.value = op.id;
  saveProbeDefaults({ ...params.value, autoZero: autoZero.value });
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  emit("runProbe", { vars, macro: op.macro });
}

function runBossProbe(op: GridOp) {
  if (!can.value.ready || props.probing) return;
  activeGridOp.value = op.id;
  saveProbeDefaults({ ...params.value, autoZero: autoZero.value });
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  emit("runProbe", { vars, macro: op.macro });
}

function runRidgeProbe(op: GridOp) {
  if (!can.value.ready || props.probing) return;
  activeGridOp.value = op.id;
  saveProbeDefaults({ ...params.value, autoZero: autoZero.value });
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  emit("runProbe", { vars, macro: op.macro });
}

function runAngleProbe(op: GridOp) {
  if (!can.value.ready || props.probing) return;
  activeGridOp.value = op.id;
  saveProbeDefaults({ ...params.value, autoZero: autoZero.value });
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  emit("runProbe", { vars, macro: op.macro });
}

function runCalProbe(macro: string) {
  if (!can.value.ready || props.probing) return;
  saveProbeDefaults({ ...params.value, autoZero: autoZero.value });
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  vars["3036"] = calAxis.value;
  emit("runProbe", { vars, macro });
}

function resetCal() {
  if (!can.value.ready || props.probing) return;
  resetTarget.value = "cal";
}

// ─── Surface map ──────────────────────────────────────────────────
function runSurfaceScan() {
  if (!can.value.ready || props.probing) return;
  saveProbeDefaults({ ...params.value, autoZero: autoZero.value });
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  emit("runProbe", { vars, macro: "surface_scan" });
}

function refreshSurface() {
  emit("getProbeResults");
  emit("getCompGrid");
}


const METHOD_LABELS: Record<number, string> = { 0: "Nearest", 1: "Linear", 2: "Cubic" };

function setMethod(m: number) {
  if (!can.value.ready) return;
  emit("setCompMethod", m);
}

function onCompToggle(v: boolean | undefined) { if (v !== undefined) emit("setCompensation", v); }


// ─── Inline 3D surface viewer ────────────────────────────────────
const surfaceContainer = ref<HTMLDivElement | null>(null);
const surfaceViewerActive = computed(() =>
  probeView.value === 'surface' && (props.surfacePoints?.length ?? 0) > 0
);

/** Viridis-like colormap (simplified 5-stop) */
function viridis(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  const c: [number, number, number][] = [
    [68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37],
  ];
  const idx = t * (c.length - 1);
  const i = Math.floor(idx);
  const f = idx - i;
  const a = c[Math.min(i, c.length - 1)]!;
  const b = c[Math.min(i + 1, c.length - 1)]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}


// Persistent surface viewer state — lives for the duration of surfaceViewerActive.
// Splitting setup (renderer/camera/controls) from rebuild (geometry/mesh/labels)
// avoids re-creating the WebGL context on every data update, which was blocking
// the JS main thread for 300ms–1500ms per call on slow hardware (Intel N100).
let _svRenderer: any = null;
let _svScene: any = null;
let _svCamera: any = null;
let _svControls: any = null;
let _svLabels: any[] = [];    // Text objects — disposed on rebuild
let _svItems: any[] = [];     // all scene children added during rebuild
let _svAnimId = 0;
let _svRo: ResizeObserver | null = null;
let _threeCleanup: (() => void) | null = null;
let _renderTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRender() {
  if (_renderTimer) clearTimeout(_renderTimer);
  _renderTimer = setTimeout(() => {
    _renderTimer = null;
    if (surfaceViewerActive.value && props.surfacePoints?.length) {
      render3DSurface(props.surfacePoints!);
    }
  }, 150);
}

function render3DSurface(pts: [number, number, number][]) {
  if (!surfaceContainer.value || pts.length < 3) return;
  // Atomic render: scipy comp grid required, no IDW fallback
  const grid = props.compGrid;
  if (!grid || grid.x.length < 2 || grid.y.length < 2) return;

  // Dynamic import Three.js (already bundled, cached after first load)
  Promise.all([
    import("three"),
    import("three/examples/jsm/controls/OrbitControls.js"),
    import("troika-three-text"),
  ]).then(([THREE, { OrbitControls }, { Text }]) => {
      const container = surfaceContainer.value!;
      const style = getComputedStyle(document.documentElement);
      const bgColor = style.getPropertyValue('--bg').trim();
      const fgColor = style.getPropertyValue('--fg').trim();

      // ── One-time setup: create renderer/scene/camera only on first render ─────
      // On subsequent renders (new data, theme change) we reuse the existing
      // context — no WebGL re-initialisation, no shader recompilation.
      if (!_svRenderer) {
        const w = container.clientWidth || 300;
        const h = container.clientHeight || 200;

        _svScene = new THREE.Scene();
        _svCamera = new THREE.PerspectiveCamera(45, w / h, 0.1, 10000);
        _svCamera.up.set(0, 0, 1); // Z-up before OrbitControls construction
        _svRenderer = new THREE.WebGLRenderer({ antialias: true });
        _svRenderer.setSize(w, h);
        container.innerHTML = "";
        container.appendChild(_svRenderer.domElement);

        _svControls = new OrbitControls(_svCamera, _svRenderer.domElement);
        _svControls.enableDamping = false;
        _svControls.rotateSpeed = 0.6;
        _svControls.zoomSpeed = 1.2;
        _svControls.panSpeed = 0.8;
        _svControls.enablePan = true;
        _svControls.screenSpacePanning = true;

        function animate() {
          _svAnimId = requestAnimationFrame(animate);
          for (const lbl of _svLabels) lbl.quaternion.copy(_svCamera!.quaternion);
          _svControls!.update();
          _svRenderer!.render(_svScene, _svCamera);
        }
        animate();

        _svRo = new ResizeObserver(() => {
          const cw = container.clientWidth || 1;
          const ch = container.clientHeight || 1;
          if (cw === 0 || ch === 0) return;
          _svCamera!.aspect = cw / ch;
          _svCamera!.updateProjectionMatrix();
          _svRenderer!.setSize(cw, ch);
        });
        _svRo.observe(container);

        _threeCleanup = () => {
          cancelAnimationFrame(_svAnimId);
          _svRo?.disconnect(); _svRo = null;
          for (const lbl of _svLabels) { _svScene?.remove(lbl); lbl.dispose(); }
          _svLabels = [];
          _svItems = [];
          _svRenderer?.dispose(); _svRenderer = null;
          _svScene = null; _svCamera = null; _svControls = null;
          container.innerHTML = "";
        };
      }

      // ── Rebuild: remove previous scene items, build from current data ─────────
      // Remove all data-specific objects (mesh, dots, labels, lights, arrows)
      for (const obj of _svItems) {
        _svScene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose());
          else obj.material.dispose();
        }
      }
      for (const lbl of _svLabels) { _svScene.remove(lbl); lbl.dispose(); }
      _svLabels = [];
      _svItems = [];

      _svScene.background = new THREE.Color(bgColor);

      // Build mesh from scipy-interpolated comp grid (atomic — early return above
      // ensures grid is valid here)
      const nx = grid.x.length, ny = grid.y.length;
      const gxRange = grid.x[nx - 1]! - grid.x[0]!;
      const gyRange = grid.y[ny - 1]! - grid.y[0]!;
      const geom = new THREE.PlaneGeometry(gxRange || 1, gyRange || 1, nx - 1, ny - 1);
      const posArr = geom.attributes.position!;

      // First pass: set XY positions and collect Z values (handle NaN/null from scipy)
      let gridZMin = Infinity, gridZMax = -Infinity;
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const vi = iy * nx + ix;
          let z = grid.zi[ix]?.[iy];
          if (z == null || !isFinite(z)) {
            // Outside convex hull — nearest raw point
            const gx = grid.x[ix]!, gy = grid.y[iy]!;
            let bestD2 = Infinity, bestZ = 0;
            for (const p of pts) {
              const d2 = (gx - p[0]) ** 2 + (gy - p[1]) ** 2;
              if (d2 < bestD2) { bestD2 = d2; bestZ = p[2]; }
            }
            z = bestZ;
          }
          if (z < gridZMin) gridZMin = z;
          if (z > gridZMax) gridZMax = z;
          posArr.setX(vi, grid.x[ix]! - grid.x[0]! - (gxRange / 2));
          posArr.setY(vi, grid.y[iy]! - grid.y[0]! - (gyRange / 2));
          posArr.setZ(vi, z); // raw Z, scaled below
        }
      }

      // Second pass: scale Z for visualization and apply colors
      const gzRange = gridZMax - gridZMin || 0.001;
      const gzScale = Math.min(gxRange || 1, gyRange || 1) * 0.3;
      const colors: number[] = [];
      for (let i = 0; i < posArr.count; i++) {
        const z = posArr.getZ(i);
        const t = (z - gridZMin) / gzRange;
        posArr.setZ(i, t * gzScale);
        const [r, g, b] = viridis(t);
        colors.push(r / 255, g / 255, b / 255);
      }
      geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

      // Bounds for dot/label/arrow placement come from the grid
      const xMin = grid.x[0]!;
      const yMin = grid.y[0]!;
      const xRange = gxRange || 1, yRange = gyRange || 1;
      const zMin = gridZMin, zRange = gzRange;

      geom.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geom, mat);
      _svScene.add(mesh);
      _svItems.push(mesh);

      // Add measured points as red spheres + Z value labels
      const dotGeom = new THREE.SphereGeometry(Math.min(xRange, yRange) * 0.015, 8, 8);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
      const zScale = Math.min(xRange, yRange) * 0.3;
      const labelFs = Math.max(xRange, yRange) * 0.03;
      for (const p of pts) {
        const sx = p[0] - xMin - xRange / 2;
        const sy = p[1] - yMin - yRange / 2;
        const sz = (p[2] - zMin) / zRange * zScale;
        const dot = new THREE.Mesh(dotGeom, dotMat);
        dot.position.set(sx, sy, sz);
        _svScene.add(dot);
        _svItems.push(dot);

        const lbl = new Text();
        lbl.text = p[2].toFixed(3);
        lbl.fontSize = labelFs;
        lbl.color = fgColor;
        lbl.anchorX = "center";
        lbl.anchorY = "middle";
        lbl.outlineWidth = "4%";
        lbl.outlineColor = bgColor;
        lbl.depthWrite = false;
        lbl.position.set(sx, sy, sz + zScale * 0.08 + Math.min(xRange, yRange) * 0.025);
        lbl.sync();
        _svScene.add(lbl);
        _svLabels.push(lbl);
      }
      // dotGeom/dotMat are shared across all dots; push sentinel so rebuild disposes them
      _svItems.push({ geometry: dotGeom, material: dotMat });

      // Lighting
      const ambient = new THREE.AmbientLight(0xffffff, 0.5);
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(1, 1, 2);
      _svScene.add(ambient);
      _svScene.add(dirLight);
      _svItems.push(ambient, dirLight);

      // X/Y/Z axis arrows with labels
      const arrowLen = Math.max(xRange, yRange) * 0.18;
      const arrowOrigin = new THREE.Vector3(-xRange / 2 - arrowLen * 0.3, -yRange / 2 - arrowLen * 0.3, 0);
      const xArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), arrowOrigin, arrowLen, 0xff4444, arrowLen * 0.15, arrowLen * 0.08);
      const yArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), arrowOrigin, arrowLen, 0x44ff44, arrowLen * 0.15, arrowLen * 0.08);
      const zArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), arrowOrigin, arrowLen, 0x4488ff, arrowLen * 0.15, arrowLen * 0.08);
      _svScene.add(xArrow, yArrow, zArrow);
      _svItems.push(xArrow, yArrow, zArrow);

      const axisFs = arrowLen * 0.35;
      for (const [text, color, offset] of [
        ["X", "#ff4444", new THREE.Vector3(arrowLen * 1.15, 0, 0)],
        ["Y", "#44ff44", new THREE.Vector3(0, arrowLen * 1.15, 0)],
        ["Z", "#4488ff", new THREE.Vector3(0, 0, arrowLen * 1.15)],
      ] as [string, string, InstanceType<typeof THREE.Vector3>][]) {
        const lbl = new Text();
        lbl.text = text;
        lbl.fontSize = axisFs;
        lbl.color = color;
        lbl.anchorX = "center";
        lbl.anchorY = "middle";
        lbl.outlineWidth = "4%";
        lbl.outlineColor = bgColor;
        lbl.depthWrite = false;
        lbl.position.copy(arrowOrigin).add(offset);
        lbl.sync();
        _svScene.add(lbl);
        _svLabels.push(lbl);
      }

      // Zoom to fit — compute bounding box of all scene objects
      const box = new THREE.Box3().setFromObject(_svScene);
      const center = box.getCenter(new THREE.Vector3());
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const fov = _svCamera.fov * (Math.PI / 180);
      const dist = sphere.radius / Math.sin(fov / 2) * 1.1;
      const dir = new THREE.Vector3(1, -1, 1).normalize();
      _svCamera.position.copy(center).addScaledVector(dir, dist);
      _svControls.target.copy(center);
      _svControls.update();
    });
}

// Auto-fetch probe results when entering surface tab
watch(probeView, (view) => {
  if (view === 'surface' && !props.surfacePoints?.length) {
    emit('getProbeResults');
  }
});

// Render inline viewer when active (surface tab + points exist).
// scheduleRender() debounces all triggers into a single 150ms-delayed render,
// preventing double WebGL-context creation (tab-switch + compGrid reply) that
// would block the JS main thread for 600ms–3s and miss client heartbeats.
watch(surfaceViewerActive, (active) => {
  if (active) {
    emit("getCompGrid");
    scheduleRender();
  } else {
    if (_renderTimer) { clearTimeout(_renderTimer); _renderTimer = null; }
    if (_threeCleanup) { _threeCleanup(); _threeCleanup = null; }
  }
});

// Re-render when comp grid arrives while viewer is active
watch(() => props.compGrid, () => {
  if (surfaceViewerActive.value) scheduleRender();
});

// Re-render when surface points arrive (first visit or new scan)
watch(() => props.surfacePoints, (pts) => {
  if (surfaceViewerActive.value && pts?.length) scheduleRender();
});

// Re-render when theme changes while viewer is active
watch(themeMode, () => {
  if (surfaceViewerActive.value) scheduleRender();
});

// Fetch grid when compensation.py increments the version counter (loadMap done)
watch(() => props.compGridVersion, (ver, prev) => {
  if (ver !== prev) emit("getCompGrid");
});

onUnmounted(() => {
  if (_threeCleanup) { _threeCleanup(); _threeCleanup = null; }
});

// fmt → fmtNum imported from format.ts

function fmtR(key: string): string {
  return fmtNum(props.probeResults?.[key]);
}
</script>

<template>
  <div class="probePanelWrap">
    <!-- Sub-view tabs (pinned) -->
    <div class="row-tight viewTabs">
        <MachineBtn type="tab" :selected="probeView === 'outside'" @click="probeView = 'outside'">Outside</MachineBtn>
        <MachineBtn type="tab" :selected="probeView === 'inside'" @click="probeView = 'inside'">Inside</MachineBtn>
        <MachineBtn type="tab" :selected="probeView === 'angle'" @click="probeView = 'angle'">Angle</MachineBtn>
        <MachineBtn type="tab" :selected="probeView === 'boss'" @click="probeView = 'boss'">Boss/Pocket</MachineBtn>
        <MachineBtn type="tab" :selected="probeView === 'ridge'" @click="probeView = 'ridge'">Ridge/Valley</MachineBtn>
        <MachineBtn type="tab" :selected="probeView === 'surface'" @click="probeView = 'surface'">Surface</MachineBtn>
        <MachineBtn type="tab" :selected="probeView === 'cal'" @click="probeView = 'cal'">Calibrate</MachineBtn>
        <MachineBtn type="tab" :selected="probeView === 'toolsetter'" @click="probeView = 'toolsetter'">Toolsetter</MachineBtn>
    </div>

    <div class="stack-sections probePanel scroll-thin">
    <!-- Control bar (hidden for toolsetter view) -->
    <div v-if="probeView !== 'toolsetter'" class="controlBar">
      <MachineToggle gate="probeParam" v-model="autoZero" label="Auto Zero" @update:model-value="saveParams" />
      <MachineToggle gate="probeParam" v-model="setRotation" label="Set Rotation" />
      <div class="controlBarRight">
        <div class="row-tight">
          <span class="statusDot" :class="probeIndicatorClass"></span>
          <span class="label-muted md">Probe</span>
        </div>
        <div class="row-tight">
          <span class="statusDot" :class="statusClass"></span>
          <span class="label-muted md mono">{{ probeStatus }}</span>
        </div>
        <MachineBtn v-if="isDev" type="simTrip" @click="emit('simTrip')">Sim Trip</MachineBtn>
        <MachineBtn type="abort" @click="emit('abort')" />
      </div>
    </div>

    <!-- ═══ OUTSIDE CORNERS VIEW ═══ -->
    <template v-if="probeView === 'outside'">
      <div class="gridSection stack-sections">
      <div class="stack-controls">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap">
          <MachineBtn
            v-for="op in outsideGrid"
            :key="op.id"
            type="probe"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
            :title="op.description"
            @click="runGridProbe(op)"
          >
            <CornerGlyph mode="outside" :corner="op.id" />
          </MachineBtn>
        </div>
      </div>
      </div>
    </template>

    <!-- ═══ INSIDE CORNERS VIEW ═══ -->
    <template v-else-if="probeView === 'inside'">
      <div class="gridSection stack-sections">
      <div class="stack-controls">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap">
          <MachineBtn
            v-for="op in insideGrid"
            :key="op.id"
            type="probe"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
            :title="op.description"
            @click="runGridProbe(op)"
          >
            <CornerGlyph mode="inside" :corner="op.id" />
          </MachineBtn>
        </div>
      </div>
      </div>
    </template>

    <!-- ═══ BOSS / POCKET VIEW ═══ -->
    <template v-else-if="probeView === 'boss'">
      <div class="gridSection stack-sections">
      <div class="stack-controls">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap bossGrid">
          <MachineBtn
            v-for="op in bossGrid"
            :key="op.id"
            type="probe"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
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
          </MachineBtn>
        </div>
      </div>

      <!-- Hint parameters (inline) -->
      <div class="inlineParams">
        <label>Diameter<HelpIcon>Approximate pocket/bore diameter for initial positioning. Extends max XY travel to reach the far edge. Set to 0 for blind probing, or to the approximate diameter to speed up the cycle. (#3025)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.diameterHint" min="0" :step="STEP_DEFAULT" @change="saveParams" />
        <label>X Hint<HelpIcon>Approximate X size of a boss or pocket feature. Helps pre-position probes for faster measurement. Set to 0 for fully blind probing. (#3026)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.xHintBP" min="0" :step="STEP_DEFAULT" @change="saveParams" />
        <label>Y Hint<HelpIcon>Approximate Y size of a boss or pocket feature. Helps pre-position probes for faster measurement. Set to 0 for fully blind probing. (#3027)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.yHintBP" min="0" :step="STEP_DEFAULT" @change="saveParams" />
      </div>
      </div>
    </template>

    <!-- ═══ EDGE ANGLE VIEW ═══ -->
    <template v-else-if="probeView === 'angle'">
      <div class="gridSection stack-sections">
      <div class="stack-controls">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap angleGrid">
          <MachineBtn
            v-for="op in angleGrid"
            :key="op.id"
            type="probe"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
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
              <rect x="10" y="10" width="60" height="60" class="workpiece" transform="rotate(-4, 40, 40)" />
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
          </MachineBtn>
        </div>
      </div>

      <!-- Angle parameters (inline) -->
      <div class="inlineParams">
        <label>Edge Width<HelpIcon>Width of the ridge or valley feature being probed. Used to position probes on opposite sides of the feature. Set to actual measured width. (#3024)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.edgeWidth" min="0.1" :step="STEP_DEFAULT" @change="saveParams" />
      </div>
      </div>
    </template>

    <!-- ═══ CALIBRATE VIEW ═══ -->
    <template v-else-if="probeView === 'cal'">
      <div class="gridSection stack-sections">
      <!-- Round calibration: buttons + diameter -->
      <div class="stack-tight">
        <div class="sub">Round Hole</div>
        <div class="row-sections">
          <div class="calBtnPair">
            <MachineBtn type="probe" class="gridCell" title="Round hole — edge start" @click="runCalProbe('probe_cal_round_pocket')">
              <svg viewBox="0 0 80 80" class="gridIcon">
                <path d="M0 0H80V80H0Z M40 18a22 22 0 1 0 0 44a22 22 0 1 0 0-44Z" fill-rule="evenodd" class="workpiece" />
                <circle cx="5" cy="40" r="3" class="probeTip" />
                <polygon points="40,18 35,27 45,27" class="arrowHead" />
                <polygon points="40,62 35,53 45,53" class="arrowHead" />
                <polygon points="18,40 27,35 27,45" class="arrowHead" />
                <polygon points="62,40 53,35 53,45" class="arrowHead" />
                <circle cx="40" cy="40" r="2.5" class="crosshair" />
              </svg>
            </MachineBtn>
            <MachineBtn type="probe" class="gridCell" title="Round boss — outside start" @click="runCalProbe('probe_cal_round_boss')">
              <svg viewBox="0 0 80 80" class="gridIcon">
                <circle cx="40" cy="40" r="22" class="workpiece" />
                <polygon points="40,18 35,9 45,9" class="arrowHead" />
                <polygon points="40,62 35,71 45,71" class="arrowHead" />
                <polygon points="18,40 9,35 9,45" class="arrowHead" />
                <polygon points="62,40 71,35 71,45" class="arrowHead" />
                <circle cx="40" cy="40" r="8" class="crosshair" />
                <circle cx="40" cy="40" r="4" class="probeTip" />
              </svg>
            </MachineBtn>
          </div>
          <div class="calParamStacked stack-tight">
            <div class="calParamRow">
              <label>Diameter<HelpIcon>Known diameter of the calibration ring or pocket. Used by calibration routines to compute the probe tip offset. Use a precision ring gauge for best results. (#3033)</HelpIcon></label>
              <MachineInput gate="probeParam" type="number" v-model.number="params.calDiameter" min="0" :step="STEP_DEFAULT" @change="saveParams" />
            </div>
          </div>
        </div>
      </div>

      <!-- Rect calibration: buttons + x/y width -->
      <div class="stack-tight">
        <div class="sub">Rectangular Pocket</div>
        <div class="row-sections">
          <div class="calBtnPair">
            <MachineBtn type="probe" class="gridCell" title="Rect pocket — edge start" @click="runCalProbe('probe_cal_square_pocket')">
              <svg viewBox="0 0 80 80" class="gridIcon">
                <path d="M0 0H80V80H0Z M15 15H65V65H15Z" fill-rule="evenodd" class="workpiece" />
                <circle cx="5" cy="40" r="3" class="probeTip" />
                <polygon points="40,15 35,24 45,24" class="arrowHead" />
                <polygon points="40,65 35,56 45,56" class="arrowHead" />
                <polygon points="15,40 24,35 24,45" class="arrowHead" />
                <polygon points="65,40 56,35 56,45" class="arrowHead" />
                <circle cx="40" cy="40" r="2.5" class="crosshair" />
              </svg>
            </MachineBtn>
            <MachineBtn type="probe" class="gridCell" title="Rect boss — outside start" @click="runCalProbe('probe_cal_square_boss')">
              <svg viewBox="0 0 80 80" class="gridIcon">
                <rect x="15" y="15" width="50" height="50" class="workpiece" />
                <polygon points="40,15 35,6 45,6" class="arrowHead" />
                <polygon points="40,65 35,74 45,74" class="arrowHead" />
                <polygon points="15,40 6,35 6,45" class="arrowHead" />
                <polygon points="65,40 74,35 74,45" class="arrowHead" />
                <circle cx="40" cy="40" r="8" class="crosshair" />
                <circle cx="40" cy="40" r="4" class="probeTip" />
              </svg>
            </MachineBtn>
          </div>
          <div class="calParamStacked stack-tight">
            <div class="calParamRow">
              <label>X Width<HelpIcon>Known X width of a rectangular calibration reference block. (#3034)</HelpIcon></label>
              <MachineInput gate="probeParam" type="number" v-model.number="params.xCalWidth" min="0" :step="STEP_DEFAULT" @change="saveParams" />
            </div>
            <div class="calParamRow">
              <label>Y Width<HelpIcon>Known Y width of a rectangular calibration reference block. (#3035)</HelpIcon></label>
              <MachineInput gate="probeParam" type="number" v-model.number="params.yCalWidth" min="0" :step="STEP_DEFAULT" @change="saveParams" />
            </div>
          </div>
        </div>
      </div>

      <!-- Calibrate on axis selector -->
      <div class="stack-controls">
        <div class="row-controls">
          <label class="sub">Calibrate on:</label>
          <div class="radioGroup inline">
            <label><MachineRadio gate="probeParam" name="calAxis" :value="0" v-model.number="calAxis" /> Avg XY</label>
            <label><MachineRadio gate="probeParam" name="calAxis" :value="1" v-model.number="calAxis" /> X Error</label>
            <label><MachineRadio gate="probeParam" name="calAxis" :value="2" v-model.number="calAxis" /> Y Error</label>
          </div>
        </div>
        <MachineBtn type="probeReset" @click="resetCal">Reset Calibration</MachineBtn>
      </div>
      </div>
    </template>

    <!-- ═══ RIDGE / VALLEY VIEW ═══ -->
    <template v-else-if="probeView === 'ridge'">
      <div class="gridSection stack-sections">
      <div class="stack-controls">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap bossGrid">
          <MachineBtn
            v-for="op in ridgeGrid"
            :key="op.id"
            type="probe"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
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
          </MachineBtn>
        </div>
      </div>

      <!-- Hint parameters (inline) -->
      <div class="inlineParams">
        <label>X Hint<HelpIcon>Approximate X width of the ridge or valley feature. Used to position probes on opposite sides. Set to approximate feature width. (#3028)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.xHintRV" min="0" :step="STEP_DEFAULT" @change="saveParams" />
        <label>Y Hint<HelpIcon>Approximate Y width of the ridge or valley feature. Used to position probes on opposite sides. Set to approximate feature width. (#3029)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.yHintRV" min="0" :step="STEP_DEFAULT" @change="saveParams" />
      </div>
      </div>
    </template>

    <!-- ─── Surface Map ─── -->
    <template v-else-if="probeView === 'surface'">
      <div class="paramGrid twoCol surfaceGrid">
        <div class="sub span">Scan Grid</div>
        <label>X0<HelpIcon>Scan grid minimum X bound in work coordinates. Must be less than X Max. Defines the left edge of the probing area. (#3050)</HelpIcon></label>
        <MachineInput gate="scanParam" type="number" v-model.number="params.scanX0" :step="STEP_DEFAULT" @change="saveParams" />
        <label>X1<HelpIcon>Scan grid maximum X bound in work coordinates. Must be greater than X Min. Defines the right edge of the probing area. (#3051)</HelpIcon></label>
        <MachineInput gate="scanParam" type="number" v-model.number="params.scanX1" :step="STEP_DEFAULT" @change="saveParams" />
        <label>Y0<HelpIcon>Scan grid minimum Y bound in work coordinates. Must be less than Y Max. Defines the front edge of the probing area. (#3052)</HelpIcon></label>
        <MachineInput gate="scanParam" type="number" v-model.number="params.scanY0" :step="STEP_DEFAULT" @change="saveParams" />
        <label>Y1<HelpIcon>Scan grid maximum Y bound in work coordinates. Must be greater than Y Min. Defines the back edge of the probing area. (#3053)</HelpIcon></label>
        <MachineInput gate="scanParam" type="number" v-model.number="params.scanY1" :step="STEP_DEFAULT" @change="saveParams" />
        <label>X Probes<HelpIcon>Number of probe points along X. Minimum 2. Point spacing = (X Max - X Min) / (count - 1). (#3054)</HelpIcon></label>
        <MachineInput gate="scanParam" type="number" v-model.number="params.scanXProbes" min="2" :step="STEP_DEFAULT" @change="saveParams" />
        <label>Y Probes<HelpIcon>Number of probe points along Y. Minimum 2. Point spacing = (Y Max - Y Min) / (count - 1). (#3055)</HelpIcon></label>
        <MachineInput gate="scanParam" type="number" v-model.number="params.scanYProbes" min="2" :step="STEP_DEFAULT" @change="saveParams" />
        <label>Safe Z<HelpIcon>Safe Z height in work coordinates for retraction between scan probe points. Set above the highest point of the workpiece plus clearance for clamps. (#3058)</HelpIcon></label>
        <MachineInput gate="scanParam" type="number" v-model.number="params.scanSafeZ" :step="STEP_DEFAULT" @change="saveParams" />
        <label>Probe Depth<HelpIcon>Maximum downward probe distance from current Z. Always positive. Set larger than the deepest surface valley expected. (#3059)</HelpIcon></label>
        <MachineInput gate="scanParam" type="number" v-model.number="params.scanDepthZ" min="0.1" :step="STEP_DEFAULT" @change="saveParams" />
      </div>

      <div class="sep"></div>

      <div class="row-sections">
        <div ref="surfaceContainer" class="surface3d no-drag-scroll">
          <div v-if="!surfacePoints?.length" class="emptyState">No scan data</div>
        </div>
        <div class="compPanel stack-controls">
          <MachineBtn type="probe" @click="runSurfaceScan">Start Scan</MachineBtn>
          <MachineBtn type="surfaceRefresh" @click="refreshSurface">Reload Data</MachineBtn>
          <div class="sep"></div>
          <div class="row-tight">
            <span class="compDot" :class="{ on: eoffsetEnabled }"></span>
            <span>Compensation: <b class="stable-width"><span :class="{ alt: !eoffsetEnabled }">ON</span><span :class="{ alt: eoffsetEnabled }">OFF</span></b></span>
          </div>
          <span v-if="eoffsetZ != null" class="compValue mono">Z: {{ eoffsetZ.toFixed(4) }}</span>
          <div class="sep"></div>
          <div class="sub">Method</div>
          <div class="radioGroup">
            <label v-for="(label, id) in METHOD_LABELS" :key="id">
              <MachineRadio gate="compMethod" name="compMethod" :value="Number(id)"
                :modelValue="compMethod ?? 2" @update:modelValue="setMethod(Number(id))" /> {{ label }}
            </label>
          </div>
          <div class="sep"></div>
          <MachineToggle gate="viewerSetting" :modelValue="surfaceLayerVisible"
            @update:modelValue="emit('toggleSurfaceLayer', $event!)" label="Show Surface" />
          <div class="sep"></div>
          <MachineToggle gate="compToggle" :modelValue="eoffsetEnabled" :disabled="probing"
            @update:modelValue="onCompToggle" label="Enable Comp" />
        </div>
      </div>

      <div class="sep"></div>

      <div class="paramGrid twoCol surfaceGrid">
        <div class="sub span">Parameters</div>
        <label>Probe Tool #<HelpIcon>Tool number of the probe. Must match the tool loaded in the spindle before any probing operation. (#3014)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.probeTool" min="1" :step="STEP_DEFAULT" @change="saveParams" />

        <label>Probe Slow FRate<HelpIcon>Feed rate for the refined slow probe pass. Set to 0 to skip the slow pass entirely — faster but less accurate. (#3015)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.slowFr" min="0" :step="STEP_FEED" @change="saveParams" />

        <label>Probe Traverse FR<HelpIcon>Feed rate for non-probing positioning moves between probe points. Does not affect probe accuracy. (#3017)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.traverseFr" min="1" :step="STEP_FEED" @change="saveParams" />

        <label>Probe Fast FRate<HelpIcon>Feed rate for initial fast probe contact. Higher values are faster but reduce repeatability. (#3016)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.fastFr" min="1" :step="STEP_FEED" @change="saveParams" />

        <label>Max X/Y Distance<HelpIcon>Maximum lateral travel before probe aborts if no contact is made. Safety limit — set slightly larger than the expected edge distance. (#3018)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.maxXYDistance" min="0" :step="STEP_DEFAULT" @change="saveParams" />

        <label>X/Y Clearance<HelpIcon>Retract distance in X/Y after each edge contact before the next move. Prevents the probe tip from scraping the feature wall. (#3019)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.xyClearance" min="0" :step="STEP_DEFAULT" @change="saveParams" />

        <label>Max Z Distance<HelpIcon>Maximum downward travel before probe aborts if no contact. Safety limit to prevent crashes. Set slightly larger than expected distance to surface. (#3020)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.maxZDistance" min="0" :step="STEP_DEFAULT" @change="saveParams" />

        <label>Z Clearance<HelpIcon>Retract height above the workpiece between Z probe passes. Also controls slow probe depth (2x this value). (#3021)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.zClearance" min="0" :step="STEP_DEFAULT" @change="saveParams" />

        <label>Extra Probe Depth<HelpIcon>Additional depth added to the slow probe pass beyond Z clearance. Ensures solid re-contact on rough surfaces. Increase if slow probe misses contact. (#3022)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.extraProbeDepth" min="0" :step="STEP_DEFAULT" @change="saveParams" />

        <label>Step Off Width<HelpIcon>Distance the probe steps away from an edge before approaching perpendicular for measurement. Ensures a clean, straight-on contact. (#3023)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.stepOffWidth" min="0.1" :step="STEP_DEFAULT" @change="saveParams" />

        <label>Cal Offset<HelpIcon>Probe tip radius calibration offset. Compensates for the difference between electrical trigger point and true tip center. Set via calibration routines — do not guess. (#3032)</HelpIcon></label>
        <span class="calOffsetReadonly mono">{{ fmtNum(params.calOffset) }}</span>
      </div>
    </template>

    <!-- ═══ TOOLSETTER VIEW ═══ -->
    <template v-else-if="probeView === 'toolsetter'">
      <div v-if="!serverSettingsReady" class="emptyState">Waiting for server settings…</div>
      <ToolsetterSettings
        v-else
        @setProbeVars="emit('setProbeVars', $event)"
        @mdi="emit('mdi', $event)"
        @resetSection="resetTarget = $event"
      />
    </template>

    <template v-if="probeView !== 'toolsetter' && probeView !== 'surface'">
    <div class="sep"></div>

    <!-- Parameters (shared across non-surface views) -->
    <div class="stack-controls">
      <div class="sub">Parameters</div>
      <div class="paramGrid twoCol">
        <label>Probe Tool #<HelpIcon>Tool number of the probe. Must match the tool loaded in the spindle before any probing operation. (#3014)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.probeTool" min="1" :step="STEP_DEFAULT" @change="saveParams" />

        <label>Probe Slow FRate<HelpIcon>Feed rate for the refined slow probe pass. Set to 0 to skip the slow pass entirely — faster but less accurate. (#3015)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.slowFr" min="0" :step="STEP_FEED" @change="saveParams" />

        <label>Probe Traverse FR<HelpIcon>Feed rate for non-probing positioning moves between probe points. Does not affect probe accuracy. (#3017)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.traverseFr" min="1" :step="STEP_FEED" @change="saveParams" />

        <label>Probe Fast FRate<HelpIcon>Feed rate for initial fast probe contact. Higher values are faster but reduce repeatability. (#3016)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.fastFr" min="1" :step="STEP_FEED" @change="saveParams" />

        <label>Max X/Y Distance<HelpIcon>Maximum lateral travel before probe aborts if no contact is made. Safety limit — set slightly larger than the expected edge distance. (#3018)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.maxXYDistance" min="0" :step="STEP_DEFAULT" @change="saveParams" />

        <label>X/Y Clearance<HelpIcon>Retract distance in X/Y after each edge contact before the next move. Prevents the probe tip from scraping the feature wall. (#3019)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.xyClearance" min="0" :step="STEP_DEFAULT" @change="saveParams" />

        <label>Max Z Distance<HelpIcon>Maximum downward travel before probe aborts if no contact. Safety limit to prevent crashes. Set slightly larger than expected distance to surface. (#3020)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.maxZDistance" min="0" :step="STEP_DEFAULT" @change="saveParams" />

        <label>Z Clearance<HelpIcon>Retract height above the workpiece between Z probe passes. Also controls slow probe depth (2x this value). (#3021)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.zClearance" min="0" :step="STEP_DEFAULT" @change="saveParams" />

        <label>Extra Probe Depth<HelpIcon>Additional depth added to the slow probe pass beyond Z clearance. Ensures solid re-contact on rough surfaces. Increase if slow probe misses contact. (#3022)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.extraProbeDepth" min="0" :step="STEP_DEFAULT" @change="saveParams" />

        <label>Step Off Width<HelpIcon>Distance the probe steps away from an edge before approaching perpendicular for measurement. Ensures a clean, straight-on contact. (#3023)</HelpIcon></label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.stepOffWidth" min="0.1" :step="STEP_DEFAULT" @change="saveParams" />

        <label>Cal Offset<HelpIcon>Probe tip radius calibration offset. Compensates for the difference between electrical trigger point and true tip center. Set via calibration routines — do not guess. (#3032)</HelpIcon></label>
        <span class="calOffsetReadonly mono">{{ fmtNum(params.calOffset) }}</span>
      </div>
    </div>
    </template>

    <template v-if="probeView !== 'toolsetter'">
    <div class="sep"></div>

    <!-- Probe Results (shared across all probe views) -->
    <div class="stack-controls">
      <div class="sub">Probe Results</div>
      <div class="probeResultsGrid">
        <div class="prCell"><span class="label">X-</span><span class="prVal">{{ fmtR("x_minus") }}</span></div>
        <div class="prCell"><span class="label">X+</span><span class="prVal">{{ fmtR("x_plus") }}</span></div>
        <div class="prCell"><span class="label">X Width</span><span class="prVal">{{ fmtR("x_width") }}</span></div>

        <div class="prCell"><span class="label">Y-</span><span class="prVal">{{ fmtR("y_minus") }}</span></div>
        <div class="prCell"><span class="label">Y+</span><span class="prVal">{{ fmtR("y_plus") }}</span></div>
        <div class="prCell"><span class="label">Y Width</span><span class="prVal">{{ fmtR("y_width") }}</span></div>

        <div class="prCell"><span class="label">Z-</span><span class="prVal">{{ fmtR("z_minus") }}</span></div>
        <div class="prCell"><span class="label">Diam</span><span class="prVal">{{ fmtR("diameter") }}</span></div>
        <div class="prCell"><span class="label">X Center</span><span class="prVal">{{ fmtR("x_center") }}</span></div>

        <div class="prCell"><span class="label">Edge Delta</span><span class="prVal">{{ fmtR("edge_delta") }}</span></div>
        <div class="prCell"><span class="label">Edge Angle</span><span class="prVal">{{ fmtR("edge_angle") }}</span></div>
        <div class="prCell"><span class="label">Y Center</span><span class="prVal">{{ fmtR("y_center") }}</span></div>
      </div>
    </div>
    </template>

  </div>

  <!-- Reset confirmation dialog -->
  <div v-if="resetTarget" class="dialogOverlay" @click.self="resetTarget = null">
    <div class="dialog">
      <div class="dialogTitle danger">{{ resetTarget === 'cal' ? 'Reset Calibration' : 'Reset Toolsetter' }}</div>
      <div class="dialogBody">{{ resetTarget === 'cal'
        ? 'Zero the probe tip calibration offset? This affects all future probe measurements.'
        : 'Restore toolsetter settings to defaults? This cannot be undone.' }}</div>
      <Gate :gate="resetTarget === 'cal' ? 'ready' : 'safety'" class="dialogActions">
        <MachineBtn type="dialogCancel" @click="resetTarget = null">Cancel</MachineBtn>
        <MachineBtn type="dialogDanger" @click="confirmReset">Reset</MachineBtn>
      </Gate>
    </div>
  </div>

  </div>
</template>

<style scoped>
.probePanelWrap {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.probePanel {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  position: relative;
}

/* Control bar (horizontal, between tabs and grid) */
.controlBar {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  padding: var(--gap-controls) 0;
}

.controlBarRight {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  margin-left: auto;
}

/* .section — uses stack-controls utility */

/* Fixed-height section so grid + params don't shift when switching tabs */
.gridSection {
  height: 360px;
}

/* Grids (centered) */
.gridWrap {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--gap-tight);
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
/* .calSection — uses stack-tight utility */

/* .calRow — replaced by row-sections utility (same shape) */

.calBtnPair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap-tight);
  width: 196px;
  flex-shrink: 0;
}

.calParamStacked {
  align-self: center;
}

.calParamRow {
  display: grid;
  grid-template-columns: 100px 80px;
  align-items: center;
  gap: var(--gap-tight);
}

.calParamRow label {
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
  white-space: nowrap;
}

.calParamRow input {
  width: 100%;
  box-sizing: border-box;
}

/* Inline params (single horizontal row) */
.inlineParams {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--gap-tight);
  flex-wrap: wrap;
}

.inlineParams label {
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
  white-space: nowrap;
}

.inlineParams input {
  width: 80px;
}

/* Calibration layout */
.calOffsetReadonly {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  font-size: var(--fs-base);
  font-variant-numeric: tabular-nums;
}


.gridCell {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
}

.gridCell.probing {
  background: color-mix(in oklab, var(--warn) 25%, var(--button-bg));
  border-color: color-mix(in oklab, var(--warn) 40%, var(--border));
  animation: pulse 0.8s ease-in-out infinite alternate;
}


.checkRow {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  font-size: var(--fs-base);
  cursor: pointer;
  user-select: none;
}




/* Probe results (PB-style 3×4 grid) */
.probeResultsGrid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: var(--gap-tight);
}

.prCell {
  display: flex;
  flex-direction: column;
  padding: 4px 6px;
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--fg) 4%, var(--bg));
  border: 1px solid var(--border);
}


.prVal {
  font-size: var(--fs-md);
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-semibold);
}

/* ─── Surface Map ─── */
.span { grid-column: 1 / -1; }
.surfaceGrid > .sep { margin: var(--gap-controls) 0; }
.compPanel {
  flex-shrink: 0;
  min-width: 140px;
}
.compDot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-round);
  background: var(--border);
  flex-shrink: 0;
}
.compDot.on {
  background: var(--ok);
  box-shadow: 0 0 6px var(--ok);
}
.compValue {
  opacity: var(--opacity-muted);
}
.surface3d {
  flex: 1;
  min-width: 0;
  height: 350px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  touch-action: none;
  position: relative;
}

</style>
