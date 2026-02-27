<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { usePermissions } from "./permissions";

const STORAGE_KEY = "lcnc-probe-params";

const props = defineProps<{
  probing: boolean;
  probeTripped: boolean;
  probedPosition: number[] | null;
  workPos: number[];
  probeResults: Record<string, number> | null;
  g5xLabel: string;
  eoffsetZ: number | null;
  eoffsetEnabled: boolean;
  compMethod: number | null;  // 0=nearest, 1=linear, 2=cubic
  surfacePoints: number[][] | null;
}>();

const emit = defineEmits<{
  (e: "mdi", text: string): void;
  (e: "abort"): void;
  (e: "listProbeMacros"): void;
  (e: "simulateProbeTrip"): void;
  (e: "setProbeVars", vars: Record<string, number>): void;
  (e: "setG5x", gcode: string): void;
  (e: "getProbeResults"): void;
  (e: "setCompensation", enable: boolean): void;
  (e: "setCompMethod", method: number): void;
  (e: "clearSurfaceMap"): void;
}>();

const g5xOptions = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"];

const can = usePermissions();

// ─── Sub-view navigation ──────────────────────────────────────────
const probeView = ref<"outside" | "inside" | "boss" | "ridge" | "angle" | "cal" | "surface">("outside");

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
}

function saveParams() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  console.log("[probe] saveParams → localStorage", { ...params.value });
  // Sync to var file (and best-effort MDI) on every change
  const varMap = buildVarMap(autoZero.value ? 0 : 1);
  console.log("[probe] saveParams → setProbeVars", varMap);
  emit("setProbeVars", varMap);
}

/** Sync cal offset from DEBUG EVAL messages (emitted by cal subroutines and reset). */
watch(() => props.probeResults?.cal_offset, (v) => {
  if (v != null) {
    params.value.calOffset = v;
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
  if (!can.value.ready || props.probing) return;
  activeGridOp.value = op.id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  console.log("[probe] runGridProbe → setProbeVars", op.macro, vars);
  emit("setProbeVars", vars);
  emit("mdi", `O<${op.macro}> CALL`);
}

function runBossProbe(op: GridOp) {
  if (!can.value.ready || props.probing) return;
  activeBossOp.value = op.id;
  activeGridOp.value = op.id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  console.log("[probe] runBossProbe → setProbeVars", op.macro, vars);
  emit("setProbeVars", vars);
  emit("mdi", `O<${op.macro}> CALL`);
}

function runRidgeProbe(op: GridOp) {
  if (!can.value.ready || props.probing) return;
  activeGridOp.value = op.id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  console.log("[probe] runRidgeProbe → setProbeVars", op.macro, vars);
  emit("setProbeVars", vars);
  emit("mdi", `O<${op.macro}> CALL`);
}

function runAngleProbe(op: GridOp) {
  if (!can.value.ready || props.probing) return;
  activeGridOp.value = op.id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  console.log("[probe] runAngleProbe → setProbeVars", op.macro, vars);
  emit("setProbeVars", vars);
  emit("mdi", `O<${op.macro}> CALL`);
}

function runCalProbe(macro: string) {
  if (!can.value.ready || props.probing) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  vars["3036"] = calAxis.value;
  console.log("[probe] runCalProbe → setProbeVars", macro, vars);
  emit("setProbeVars", vars);
  emit("mdi", `O<${macro}> CALL`);
}

function resetCal() {
  if (!can.value.ready || props.probing) return;
  emit("mdi", `O<probe_cal_reset> CALL`);
}

// ─── Surface map ──────────────────────────────────────────────────
function runSurfaceScan() {
  if (!can.value.ready || props.probing) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...params.value, autoZero: autoZero.value }));
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  emit("setProbeVars", vars);
  emit("mdi", "O<surface_scan> CALL");
}

function toggleComp() {
  if (!can.value.ready) return;
  emit("setCompensation", !props.eoffsetEnabled);
}

const METHOD_LABELS: Record<number, string> = { 0: "Nearest", 1: "Linear", 2: "Cubic" };

function setMethod(m: number) {
  if (!can.value.ready) return;
  emit("setCompMethod", m);
}

function loadSurfaceMap() {
  emit("getProbeResults");
}

// ─── 3D surface popout dialog ────────────────────────────────────
const mapDialogOpen = ref(false);
const surfaceContainer = ref<HTMLDivElement | null>(null);

/** Viridis-like colormap (simplified 5-stop) */
function viridis(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  const c = [
    [68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37],
  ];
  const idx = t * (c.length - 1);
  const i = Math.floor(idx);
  const f = idx - i;
  const a = c[Math.min(i, c.length - 1)];
  const b = c[Math.min(i + 1, c.length - 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** Inverse-distance weighted interpolation for a single point */
function idwInterp(px: number, py: number, points: number[][], power = 2): number {
  let wSum = 0, vSum = 0;
  for (const p of points) {
    const dx = px - p[0], dy = py - p[1];
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-10) return p[2];
    const w = 1 / Math.pow(Math.sqrt(d2), power);
    wSum += w;
    vSum += w * p[2];
  }
  return wSum > 0 ? vSum / wSum : 0;
}

let _threeCleanup: (() => void) | null = null;

function render3DSurface(pts: number[][]) {
  if (!surfaceContainer.value || pts.length < 3) return;

  // Dynamic import Three.js (already bundled)
  import("three").then((THREE) => {
    import("three/examples/jsm/controls/OrbitControls.js").then(({ OrbitControls }) => {
      // Clean up previous
      if (_threeCleanup) { _threeCleanup(); _threeCleanup = null; }

      const container = surfaceContainer.value!;
      const w = container.clientWidth || 300;
      const h = container.clientHeight || 200;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a2e);
      const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 10000);
      camera.up.set(0, 0, 1); // Z-up before OrbitControls construction
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(w, h);
      container.innerHTML = "";
      container.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.rotateSpeed = 0.6;
      controls.zoomSpeed = 1.2;
      controls.panSpeed = 0.8;
      controls.enablePan = true;
      controls.screenSpacePanning = true;

      // Compute bounds
      let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;
      for (const p of pts) {
        if (p[0] < xMin) xMin = p[0]; if (p[0] > xMax) xMax = p[0];
        if (p[1] < yMin) yMin = p[1]; if (p[1] > yMax) yMax = p[1];
        if (p[2] < zMin) zMin = p[2]; if (p[2] > zMax) zMax = p[2];
      }
      const xRange = xMax - xMin || 1, yRange = yMax - yMin || 1, zRange = zMax - zMin || 0.001;

      // Create interpolated grid surface
      const res = 30;
      const geom = new THREE.PlaneGeometry(xRange, yRange, res - 1, res - 1);
      const colors: number[] = [];
      const posArr = geom.attributes.position;
      for (let i = 0; i < posArr.count; i++) {
        const gx = posArr.getX(i) + xRange / 2 + xMin;
        const gy = posArr.getY(i) + yRange / 2 + yMin;
        const gz = idwInterp(gx, gy, pts);
        posArr.setZ(i, (gz - zMin) / zRange * Math.min(xRange, yRange) * 0.3);
        const t = (gz - zMin) / zRange;
        const [r, g, b] = viridis(t);
        colors.push(r / 255, g / 255, b / 255);
      }
      geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geom.computeVertexNormals();

      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geom, mat);
      scene.add(mesh);

      // Add measured points as red spheres + Z value labels
      const dotGeom = new THREE.SphereGeometry(Math.min(xRange, yRange) * 0.015, 8, 8);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
      const zScale = Math.min(xRange, yRange) * 0.3;
      for (const p of pts) {
        const sx = p[0] - xMin - xRange / 2;
        const sy = p[1] - yMin - yRange / 2;
        const sz = (p[2] - zMin) / zRange * zScale;
        const dot = new THREE.Mesh(dotGeom, dotMat);
        dot.position.set(sx, sy, sz);
        scene.add(dot);

        // Z value text sprite
        const canvas = document.createElement("canvas");
        canvas.width = 256; canvas.height = 64;
        const ctx = canvas.getContext("2d")!;
        ctx.font = "bold 48px monospace";
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 3;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeText(p[2].toFixed(3), 128, 32);
        ctx.fillText(p[2].toFixed(3), 128, 32);
        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(spriteMat);
        const labelScale = Math.max(xRange, yRange) * 0.12;
        sprite.scale.set(labelScale, labelScale * 0.25, 1);
        sprite.position.set(sx, sy, sz + zScale * 0.08 + Math.min(xRange, yRange) * 0.025);
        scene.add(sprite);
      }

      // Lighting
      scene.add(new THREE.AmbientLight(0xffffff, 0.5));
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(1, 1, 2);
      scene.add(dirLight);

      // X/Y axis arrows with labels
      const arrowLen = Math.max(xRange, yRange) * 0.18;
      const arrowOrigin = new THREE.Vector3(-xRange / 2 - arrowLen * 0.3, -yRange / 2 - arrowLen * 0.3, 0);
      const xArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), arrowOrigin, arrowLen, 0xff4444, arrowLen * 0.15, arrowLen * 0.08);
      const yArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), arrowOrigin, arrowLen, 0x44ff44, arrowLen * 0.15, arrowLen * 0.08);
      const zArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), arrowOrigin, arrowLen, 0x4488ff, arrowLen * 0.15, arrowLen * 0.08);
      scene.add(xArrow);
      scene.add(yArrow);
      scene.add(zArrow);

      function makeAxisLabel(text: string, color: string): THREE.Sprite {
        const c = document.createElement("canvas");
        c.width = 64; c.height = 64;
        const cx = c.getContext("2d")!;
        cx.font = "bold 48px sans-serif";
        cx.fillStyle = color;
        cx.textAlign = "center";
        cx.textBaseline = "middle";
        cx.fillText(text, 32, 32);
        const t = new THREE.CanvasTexture(c);
        const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false });
        const s = new THREE.Sprite(m);
        const ls = arrowLen * 0.35;
        s.scale.set(ls, ls, 1);
        return s;
      }
      const xLabel = makeAxisLabel("X", "#ff4444");
      xLabel.position.copy(arrowOrigin).add(new THREE.Vector3(arrowLen + arrowLen * 0.15, 0, 0));
      scene.add(xLabel);
      const yLabel = makeAxisLabel("Y", "#44ff44");
      yLabel.position.copy(arrowOrigin).add(new THREE.Vector3(0, arrowLen + arrowLen * 0.15, 0));
      scene.add(yLabel);
      const zLabel = makeAxisLabel("Z", "#4488ff");
      zLabel.position.copy(arrowOrigin).add(new THREE.Vector3(0, 0, arrowLen + arrowLen * 0.15));
      scene.add(zLabel);

      // Camera position
      const maxDim = Math.max(xRange, yRange);
      camera.position.set(maxDim * 0.8, -maxDim * 0.8, maxDim * 0.8);
      controls.target.set(0, 0, 0);
      controls.update();

      let animId = 0;
      function animate() {
        animId = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      }
      animate();

      // Resize observer
      const ro = new ResizeObserver(() => {
        const cw = container.clientWidth || 1;
        const ch = container.clientHeight || 1;
        if (cw === 0 || ch === 0) return;
        camera.aspect = cw / ch;
        camera.updateProjectionMatrix();
        renderer.setSize(cw, ch);
      });
      ro.observe(container);

      _threeCleanup = () => {
        cancelAnimationFrame(animId);
        ro.disconnect();
        renderer.dispose();
        geom.dispose();
        mat.dispose();
        container.innerHTML = "";
      };
    });
  });
}

// Render into dialog when it opens or points change
watch([mapDialogOpen, () => props.surfacePoints], ([open, pts]) => {
  if (open && pts && pts.length > 0) {
    nextTick(() => render3DSurface(pts));
  } else if (!open) {
    if (_threeCleanup) { _threeCleanup(); _threeCleanup = null; }
  }
});

onUnmounted(() => {
  if (_threeCleanup) { _threeCleanup(); _threeCleanup = null; }
});

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
    <!-- WCS selector -->
    <div class="g5xRow">
      <button
        v-for="g in g5xOptions"
        :key="g"
        class="g5xBtn"
        :class="{ active: g === g5xLabel }"
        :disabled="!can.idle"
        @click="emit('setG5x', g)"
      >{{ g }}</button>
    </div>

    <!-- Sub-view tabs -->
    <div class="viewTabs">
      <button class="viewTab" :class="{ active: probeView === 'outside' }" @click="probeView = 'outside'">Outside</button>
      <button class="viewTab" :class="{ active: probeView === 'inside' }" @click="probeView = 'inside'">Inside</button>
      <button class="viewTab" :class="{ active: probeView === 'boss' }" @click="probeView = 'boss'">Boss/Pocket</button>
      <button class="viewTab" :class="{ active: probeView === 'ridge' }" @click="probeView = 'ridge'">Ridge/Valley</button>
      <button class="viewTab" :class="{ active: probeView === 'angle' }" @click="probeView = 'angle'">Angle</button>
      <button class="viewTab" :class="{ active: probeView === 'cal' }" @click="probeView = 'cal'">Calibrate</button>
      <button class="viewTab" :class="{ active: probeView === 'surface' }" @click="probeView = 'surface'">Surface</button>
    </div>

    <!-- Control bar -->
    <div class="controlBar">
      <label class="checkRow">
        <input type="checkbox" v-model="autoZero" :disabled="!can.ready" @change="saveParams" />
        Auto Zero
      </label>
      <label class="checkRow">
        <input type="checkbox" :checked="params.wcoRotation === 1" :disabled="!can.ready" @change="params.wcoRotation = ($event.target as HTMLInputElement).checked ? 1 : 0; saveParams()" />
        Set Rotation
      </label>
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
      <div class="gridSection">
      <div class="section">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap">
          <button
            v-for="op in outsideGrid"
            :key="op.id"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
            :disabled="!can.probe || probing"
            :title="op.description"
            @click="runGridProbe(op)"
          >
            <!-- BL corner: triangles pointing ↓ and → from outside -->
            <svg v-if="op.id === 'bl'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" class="workpiece" />
              <circle cx="28" cy="28" r="4" class="probeTip" />
              <polygon points="28,10 23,1 33,1" class="arrowHead" />
              <polygon points="10,28 1,23 1,33" class="arrowHead" />
              <circle cx="10" cy="10" r="2.5" class="crosshair" />
            </svg>
            <!-- Back edge: triangle pointing ↓ from outside, circle at vertex -->
            <svg v-else-if="op.id === 'b'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" class="workpiece" />
              <circle cx="40" cy="28" r="4" class="probeTip" />
              <polygon points="40,10 35,1 45,1" class="arrowHead" />
              <circle cx="40" cy="10" r="2.5" class="crosshair" />
            </svg>
            <!-- BR corner: triangles pointing ↓ and ← from outside -->
            <svg v-else-if="op.id === 'br'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" class="workpiece" />
              <circle cx="52" cy="28" r="4" class="probeTip" />
              <polygon points="52,10 47,1 57,1" class="arrowHead" />
              <polygon points="70,28 79,23 79,33" class="arrowHead" />
              <circle cx="70" cy="10" r="2.5" class="crosshair" />
            </svg>
            <!-- Left edge: triangle pointing → from outside, circle at vertex -->
            <svg v-else-if="op.id === 'l'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" class="workpiece" />
              <circle cx="28" cy="40" r="4" class="probeTip" />
              <polygon points="10,40 1,35 1,45" class="arrowHead" />
              <circle cx="10" cy="40" r="2.5" class="crosshair" />
            </svg>
            <!-- Z center: probe centered, green crosshair circle around probe tip -->
            <svg v-else-if="op.id === 'z'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" class="workpiece" />
              <circle cx="40" cy="40" r="9" class="crosshair" />
              <circle cx="40" cy="40" r="5" class="probeTip" />
              <text x="40" y="60" class="gridZLabel">Z</text>
            </svg>
            <!-- Right edge: triangle pointing ← from outside, circle at vertex -->
            <svg v-else-if="op.id === 'r'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" class="workpiece" />
              <circle cx="52" cy="40" r="4" class="probeTip" />
              <polygon points="70,40 79,35 79,45" class="arrowHead" />
              <circle cx="70" cy="40" r="2.5" class="crosshair" />
            </svg>
            <!-- FL corner: triangles pointing ↑ and → from outside -->
            <svg v-else-if="op.id === 'fl'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" class="workpiece" />
              <circle cx="28" cy="52" r="4" class="probeTip" />
              <polygon points="28,70 23,79 33,79" class="arrowHead" />
              <polygon points="10,52 1,47 1,57" class="arrowHead" />
              <circle cx="10" cy="70" r="2.5" class="crosshair" />
            </svg>
            <!-- Front edge: triangle pointing ↑ from outside, circle at vertex -->
            <svg v-else-if="op.id === 'f'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" class="workpiece" />
              <circle cx="40" cy="52" r="4" class="probeTip" />
              <polygon points="40,70 35,79 45,79" class="arrowHead" />
              <circle cx="40" cy="70" r="2.5" class="crosshair" />
            </svg>
            <!-- FR corner: triangles pointing ↑ and ← from outside -->
            <svg v-else-if="op.id === 'fr'" viewBox="0 0 80 80" class="gridIcon">
              <rect x="10" y="10" width="60" height="60" class="workpiece" />
              <circle cx="52" cy="52" r="4" class="probeTip" />
              <polygon points="52,70 47,79 57,79" class="arrowHead" />
              <polygon points="70,52 79,47 79,57" class="arrowHead" />
              <circle cx="70" cy="70" r="2.5" class="crosshair" />
            </svg>
          </button>
        </div>
      </div>
      </div>
    </template>

    <!-- ═══ INSIDE CORNERS VIEW ═══ -->
    <template v-else-if="probeView === 'inside'">
      <div class="gridSection">
      <div class="section">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap">
          <button
            v-for="op in insideGrid"
            :key="op.id"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
            :disabled="!can.probe || probing"
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
              <rect x="0" y="0" width="80" height="80" class="workpiece" />
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
      </div>
    </template>

    <!-- ═══ BOSS / POCKET VIEW ═══ -->
    <template v-else-if="probeView === 'boss'">
      <div class="gridSection">
      <div class="section">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap bossGrid">
          <button
            v-for="op in bossGrid"
            :key="op.id"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id, active: activeBossOp === op.id }"
            :disabled="!can.probe || probing"
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
      </div>
    </template>

    <!-- ═══ EDGE ANGLE VIEW ═══ -->
    <template v-else-if="probeView === 'angle'">
      <div class="gridSection">
      <div class="section">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap angleGrid">
          <button
            v-for="op in angleGrid"
            :key="op.id"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
            :disabled="!can.probe || probing"
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
          </button>
        </div>
      </div>

      <!-- Angle parameters (inline) -->
      <div class="inlineParams">
        <label>Edge Width <span class="varNum">#3024</span></label>
        <input type="number" v-model.number="params.edgeWidth" min="0.1" step="0.1" :disabled="!can.ready" @change="saveParams" />
      </div>
      </div>
    </template>

    <!-- ═══ CALIBRATE VIEW ═══ -->
    <template v-else-if="probeView === 'cal'">
      <div class="gridSection">
      <!-- Round calibration: buttons + diameter -->
      <div class="calSection">
        <div class="sub">Round Hole</div>
        <div class="calRow">
          <div class="calBtnPair">
            <button class="gridCell" :disabled="!can.probe || probing" title="Round hole — edge start" @click="runCalProbe('probe_cal_round_pocket')">
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
            <button class="gridCell" :disabled="!can.probe || probing" title="Round hole — center start" @click="runCalProbe('probe_cal_round_boss')">
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
            <button class="gridCell" :disabled="!can.probe || probing" title="Rect pocket — edge start" @click="runCalProbe('probe_cal_square_pocket')">
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
            <button class="gridCell" :disabled="!can.probe || probing" title="Rect pocket — center start" @click="runCalProbe('probe_cal_square_boss')">
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
      </div>
    </template>

    <!-- ═══ RIDGE / VALLEY VIEW ═══ -->
    <template v-else-if="probeView === 'ridge'">
      <div class="gridSection">
      <div class="section">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap bossGrid">
          <button
            v-for="op in ridgeGrid"
            :key="op.id"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
            :disabled="!can.probe || probing"
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
      </div>
    </template>

    <!-- ─── Surface Map ─── -->
    <template v-else>
      <div class="section">
        <div class="sub">Scan Grid</div>
        <div class="paramGrid twoCol">
          <label>X0 <span class="varNum">#3050</span></label>
          <input type="number" v-model.number="params.scanX0" step="1" :disabled="!can.ready" @change="saveParams" />
          <label>X1 <span class="varNum">#3051</span></label>
          <input type="number" v-model.number="params.scanX1" step="1" :disabled="!can.ready" @change="saveParams" />
          <label>Y0 <span class="varNum">#3052</span></label>
          <input type="number" v-model.number="params.scanY0" step="1" :disabled="!can.ready" @change="saveParams" />
          <label>Y1 <span class="varNum">#3053</span></label>
          <input type="number" v-model.number="params.scanY1" step="1" :disabled="!can.ready" @change="saveParams" />
          <label>X Probes <span class="varNum">#3054</span></label>
          <input type="number" v-model.number="params.scanXProbes" min="2" step="1" :disabled="!can.ready" @change="saveParams" />
          <label>Y Probes <span class="varNum">#3055</span></label>
          <input type="number" v-model.number="params.scanYProbes" min="2" step="1" :disabled="!can.ready" @change="saveParams" />
          <label>Safe Z <span class="varNum">#3058</span></label>
          <input type="number" v-model.number="params.scanSafeZ" step="1" :disabled="!can.ready" @change="saveParams" />
          <label>Probe Depth <span class="varNum">#3059</span></label>
          <input type="number" v-model.number="params.scanDepthZ" min="0.1" step="1" :disabled="!can.ready" @change="saveParams" />
        </div>
      </div>

      <div class="surfaceActions">
        <button class="btn" :disabled="!can.probe || probing" @click="runSurfaceScan">Start Scan</button>
        <button v-if="!surfacePoints?.length" class="btn" :disabled="!can.idle" @click="loadSurfaceMap">Load Map</button>
        <button v-else class="btn" :disabled="!can.idle" @click="emit('clearSurfaceMap')">Unload Map</button>
        <button class="btn" :disabled="!can.idle" @click="if (!surfacePoints?.length) emit('getProbeResults'); mapDialogOpen = true">3D Inspect</button>
        <button class="btn" :class="{ active: eoffsetEnabled }" :disabled="!can.ready || probing" @click="toggleComp">{{ eoffsetEnabled ? 'Disable Comp' : 'Enable Comp' }}</button>
      </div>

      <div class="compStatus">
        <span class="compDot" :class="{ on: eoffsetEnabled }"></span>
        <span>Compensation: <b>{{ eoffsetEnabled ? 'ON' : 'OFF' }}</b></span>
        <span v-if="eoffsetZ != null" class="compValue">Z: {{ eoffsetZ.toFixed(4) }}</span>
        <span class="compMethod">
          Method:
          <button v-for="(label, id) in METHOD_LABELS" :key="id"
            class="methodBtn" :class="{ active: compMethod === Number(id) }"
            :disabled="!can.ready"
            @click="setMethod(Number(id))">{{ label }}</button>
        </span>
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

        <label>Cal Offset <span class="varNum">#3032</span></label>
        <span class="calOffsetReadonly">{{ fmt(params.calOffset) }} <button class="calResetBtn" :disabled="!can.ready || probing" @click="resetCal">Reset</button></span>
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

  <!-- Surface map popout dialog -->
  <div v-if="mapDialogOpen" class="mapOverlay" @click.self="mapDialogOpen = false">
    <div class="mapDialog">
      <div class="mapHeader">
        <span class="mapTitle">Surface Compensation Map</span>
        <button class="btn" @click="mapDialogOpen = false">Close</button>
      </div>
      <div ref="surfaceContainer" class="surface3d"></div>
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

/* WCS selector row */
.g5xRow {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.g5xBtn {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 6px;
  opacity: 0.6;
}

.g5xBtn.active {
  opacity: 1;
  font-weight: 700;
  border-color: var(--fg);
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

/* Fixed-height section so grid + params don't shift when switching tabs */
.gridSection {
  height: 360px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  justify-content: center;
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
.calOffsetReadonly {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
}

.calResetBtn {
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
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

/* ─── Surface Map ─── */
.surfaceActions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.surfaceActions .btn {
  flex: 1;
  min-width: 80px;
}
.surfaceActions .btn.active {
  background: var(--ok);
  color: #fff;
}
.compStatus {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
}
.compDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border);
}
.compDot.on {
  background: var(--ok);
  box-shadow: 0 0 6px var(--ok);
}
.compValue {
  margin-left: auto;
  opacity: 0.7;
}
.compMethod {
  margin-left: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.methodBtn {
  padding: 1px 6px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg);
  color: var(--fg);
  cursor: pointer;
}
.methodBtn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.mapOverlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.mapDialog {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  width: 70vw;
  height: 65vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
}
.mapHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
}
.mapTitle {
  font-weight: 600;
  font-size: 14px;
}
.surface3d {
  flex: 1;
  min-height: 0;
  border-radius: 0 0 12px 12px;
  overflow: hidden;
}

</style>
