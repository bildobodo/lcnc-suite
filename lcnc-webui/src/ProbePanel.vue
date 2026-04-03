<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineToggle from "./MachineToggle.vue";
import { usePermissions } from "./permissions";
import { STEP_DEFAULT, STEP_FEED, loadProbeDefaults, saveProbeDefaults, settingsVersion } from "./defaults";
import { idwInterp } from "./interpolation";

const props = defineProps<{
  probing: boolean;
  probeTripped: boolean;
  probedPosition: number[] | null;
  workPos: number[];
  probeResults: Record<string, number> | null;
  eoffsetZ: number | null;
  eoffsetEnabled: boolean;
  compMethod: number | null;  // 0=nearest, 1=linear, 2=cubic
  surfacePoints: [number, number, number][] | null;
  surfaceInViewer: boolean;
}>();

const emit = defineEmits<{
  (e: "mdi", text: string): void;
  (e: "abort"): void;
  (e: "listProbeMacros"): void;
  (e: "setProbeVars", vars: Record<string, number>): void;
  (e: "getProbeResults"): void;
  (e: "loadSurfaceToViewer"): void;
  (e: "setCompensation", enable: boolean): void;
  (e: "setCompMethod", method: number): void;
  (e: "clearSurfaceMap"): void;
}>();


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
  // Sync to var file (and best-effort MDI) on every change
  const varMap = buildVarMap(autoZero.value ? 0 : 1);
  emit("setProbeVars", varMap);
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

// ─── Run probe ────────────────────────────────────────────────────
function runGridProbe(op: GridOp) {
  if (!can.value.ready || props.probing) return;
  activeGridOp.value = op.id;
  saveProbeDefaults({ ...params.value, autoZero: autoZero.value });
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  emit("setProbeVars", vars);
  emit("mdi", `O<${op.macro}> CALL`);
}

function runBossProbe(op: GridOp) {
  if (!can.value.ready || props.probing) return;
  activeBossOp.value = op.id;
  activeGridOp.value = op.id;
  saveProbeDefaults({ ...params.value, autoZero: autoZero.value });
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  emit("setProbeVars", vars);
  emit("mdi", `O<${op.macro}> CALL`);
}

function runRidgeProbe(op: GridOp) {
  if (!can.value.ready || props.probing) return;
  activeGridOp.value = op.id;
  saveProbeDefaults({ ...params.value, autoZero: autoZero.value });
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  emit("setProbeVars", vars);
  emit("mdi", `O<${op.macro}> CALL`);
}

function runAngleProbe(op: GridOp) {
  if (!can.value.ready || props.probing) return;
  activeGridOp.value = op.id;
  saveProbeDefaults({ ...params.value, autoZero: autoZero.value });
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  emit("setProbeVars", vars);
  emit("mdi", `O<${op.macro}> CALL`);
}

function runCalProbe(macro: string) {
  if (!can.value.ready || props.probing) return;
  saveProbeDefaults({ ...params.value, autoZero: autoZero.value });
  const vars = buildVarMap(autoZero.value ? 0 : 1);
  vars["3036"] = calAxis.value;
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
  saveProbeDefaults({ ...params.value, autoZero: autoZero.value });
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
  emit("loadSurfaceToViewer");
}

// ─── 3D surface popout dialog ────────────────────────────────────
const mapDialogOpen = ref(false);
const surfaceContainer = ref<HTMLDivElement | null>(null);

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


let _threeCleanup: (() => void) | null = null;

function render3DSurface(pts: [number, number, number][]) {
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
      const posArr = geom.attributes.position!;
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

      function makeAxisLabel(text: string, color: string) {
        const c = document.createElement("canvas");
        c.width = 64; c.height = 64;
        const cx = c.getContext("2d")!;
        cx.font = "bold 48px sans-serif";
        cx.textAlign = "center";
        cx.textBaseline = "middle";
        cx.strokeStyle = "#000000";
        cx.lineWidth = 5;
        cx.strokeText(text, 32, 32);
        cx.fillStyle = color;
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
  <div class="stack-sections probePanel scroll-thin">
    <!-- Sub-view tabs -->
    <div class="row-tight viewTabs">
        <MachineBtn type="tab" :selected="probeView === 'outside'" @click="probeView = 'outside'">Outside</MachineBtn>
        <MachineBtn type="tab" :selected="probeView === 'inside'" @click="probeView = 'inside'">Inside</MachineBtn>
        <MachineBtn type="tab" :selected="probeView === 'boss'" @click="probeView = 'boss'">Boss/Pocket</MachineBtn>
        <MachineBtn type="tab" :selected="probeView === 'ridge'" @click="probeView = 'ridge'">Ridge/Valley</MachineBtn>
        <MachineBtn type="tab" :selected="probeView === 'angle'" @click="probeView = 'angle'">Angle</MachineBtn>
        <MachineBtn type="tab" :selected="probeView === 'surface'" @click="probeView = 'surface'">Surface</MachineBtn>
        <MachineBtn type="tab" :selected="probeView === 'cal'" @click="probeView = 'cal'">Calibrate</MachineBtn>
    </div>

    <!-- Control bar -->
    <div class="controlBar">
      <MachineToggle gate="probeParam" v-model="autoZero" label="Auto Zero" @update:model-value="saveParams" />
      <MachineToggle gate="probeParam" v-model="setRotation" label="Set Rotation" />
      <div class="controlBarRight">
        <div class="statusRow">
          <span class="statusDot" :class="statusClass"></span>
          <span class="statusText">{{ probeStatus }}</span>
        </div>
        <MachineBtn
          type="abort"
          :disabled="!probing"
          @click="emit('abort')"
        >Abort</MachineBtn>
      </div>
    </div>

    <!-- ═══ OUTSIDE CORNERS VIEW ═══ -->
    <template v-if="probeView === 'outside'">
      <div class="gridSection">
      <div class="section">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap">
          <MachineBtn
            v-for="op in outsideGrid"
            :key="op.id"
            type="probe"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
            :disabled="probing"
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
          </MachineBtn>
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
          <MachineBtn
            v-for="op in insideGrid"
            :key="op.id"
            type="probe"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
            :disabled="probing"
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
          </MachineBtn>
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
          <MachineBtn
            v-for="op in bossGrid"
            :key="op.id"
            type="probe"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
            :active="activeBossOp === op.id"
            :disabled="probing"
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
        <label title="Approximate pocket/bore diameter for initial positioning. Extends max XY travel to reach the far edge. Set to 0 for blind probing, or to the approximate diameter to speed up the cycle. (#3025)">Diameter</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.diameterHint" min="0" :step="STEP_DEFAULT" @change="saveParams" />
        <label title="Approximate X size of a boss or pocket feature. Helps pre-position probes for faster measurement. Set to 0 for fully blind probing. (#3026)">X Hint</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.xHintBP" min="0" :step="STEP_DEFAULT" @change="saveParams" />
        <label title="Approximate Y size of a boss or pocket feature. Helps pre-position probes for faster measurement. Set to 0 for fully blind probing. (#3027)">Y Hint</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.yHintBP" min="0" :step="STEP_DEFAULT" @change="saveParams" />
      </div>
      </div>
    </template>

    <!-- ═══ EDGE ANGLE VIEW ═══ -->
    <template v-else-if="probeView === 'angle'">
      <div class="gridSection">
      <div class="section">
        <div class="sub">Probe Operation</div>
        <div class="gridWrap angleGrid">
          <MachineBtn
            v-for="op in angleGrid"
            :key="op.id"
            type="probe"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
            :disabled="probing"
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
        <label title="Width of the ridge or valley feature being probed. Used to position probes on opposite sides of the feature. Set to actual measured width. (#3024)">Edge Width</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.edgeWidth" min="0.1" :step="STEP_DEFAULT" @change="saveParams" />
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
            <MachineBtn type="probe" class="gridCell" :disabled="probing" title="Round hole — edge start" @click="runCalProbe('probe_cal_round_pocket')">
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
            <MachineBtn type="probe" class="gridCell" :disabled="probing" title="Round hole — center start" @click="runCalProbe('probe_cal_round_boss')">
              <svg viewBox="0 0 80 80" class="gridIcon">
                <path d="M0 0H80V80H0Z M40 18a22 22 0 1 0 0 44a22 22 0 1 0 0-44Z" fill-rule="evenodd" class="workpiece" />
                <polygon points="40,18 35,27 45,27" class="arrowHead" />
                <polygon points="40,62 35,53 45,53" class="arrowHead" />
                <polygon points="18,40 27,35 27,45" class="arrowHead" />
                <polygon points="62,40 53,35 53,45" class="arrowHead" />
                <circle cx="40" cy="40" r="8" class="crosshair" />
                <circle cx="40" cy="40" r="4" class="probeTip" />
              </svg>
            </MachineBtn>
          </div>
          <div class="calParamStacked">
            <div class="calParamRow">
              <label title="Known diameter of the calibration ring or pocket. Used by calibration routines to compute the probe tip offset. Use a precision ring gauge for best results. (#3033)">Diameter</label>
              <MachineInput gate="probeParam" type="number" v-model.number="params.calDiameter" min="0" :step="STEP_DEFAULT" @change="saveParams" />
            </div>
          </div>
        </div>
      </div>

      <!-- Rect calibration: buttons + x/y width -->
      <div class="calSection">
        <div class="sub">Rectangular Pocket</div>
        <div class="calRow">
          <div class="calBtnPair">
            <MachineBtn type="probe" class="gridCell" :disabled="probing" title="Rect pocket — edge start" @click="runCalProbe('probe_cal_square_pocket')">
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
            <MachineBtn type="probe" class="gridCell" :disabled="probing" title="Rect pocket — center start" @click="runCalProbe('probe_cal_square_boss')">
              <svg viewBox="0 0 80 80" class="gridIcon">
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
          <div class="calParamStacked">
            <div class="calParamRow">
              <label title="Known X width of a rectangular calibration reference block. (#3034)">X Width</label>
              <MachineInput gate="probeParam" type="number" v-model.number="params.xCalWidth" min="0" :step="STEP_DEFAULT" @change="saveParams" />
            </div>
            <div class="calParamRow">
              <label title="Known Y width of a rectangular calibration reference block. (#3035)">Y Width</label>
              <MachineInput gate="probeParam" type="number" v-model.number="params.yCalWidth" min="0" :step="STEP_DEFAULT" @change="saveParams" />
            </div>
          </div>
        </div>
      </div>

      <!-- Calibrate on axis selector -->
      <div class="section">
        <div class="calParamTitle">Calibrate on:</div>
        <div class="calAxisRow">
          <MachineBtn type="probe" class="calAxisBtn" muted :selected="calAxis === 0" @click="calAxis = 0">Avg XY</MachineBtn>
          <MachineBtn type="probe" class="calAxisBtn" muted :selected="calAxis === 1" @click="calAxis = 1">X Error</MachineBtn>
          <MachineBtn type="probe" class="calAxisBtn" muted :selected="calAxis === 2" @click="calAxis = 2">Y Error</MachineBtn>
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
          <MachineBtn
            v-for="op in ridgeGrid"
            :key="op.id"
            type="probe"
            class="gridCell"
            :class="{ probing: probing && activeGridOp === op.id }"
            :disabled="probing"
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
        <label title="Approximate X width of the ridge or valley feature. Used to position probes on opposite sides. Set to approximate feature width. (#3028)">X Hint</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.xHintRV" min="0" :step="STEP_DEFAULT" @change="saveParams" />
        <label title="Approximate Y width of the ridge or valley feature. Used to position probes on opposite sides. Set to approximate feature width. (#3029)">Y Hint</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.yHintRV" min="0" :step="STEP_DEFAULT" @change="saveParams" />
      </div>
      </div>
    </template>

    <!-- ─── Surface Map ─── -->
    <template v-else>
      <div class="section">
        <div class="sub">Scan Grid</div>
        <div class="paramGrid twoCol">
          <label title="Scan grid minimum X bound in work coordinates. Must be less than X Max. Defines the left edge of the probing area. (#3050)">X0</label>
          <MachineInput gate="scanParam" type="number" v-model.number="params.scanX0" :step="STEP_DEFAULT" @change="saveParams" />
          <label title="Scan grid maximum X bound in work coordinates. Must be greater than X Min. Defines the right edge of the probing area. (#3051)">X1</label>
          <MachineInput gate="scanParam" type="number" v-model.number="params.scanX1" :step="STEP_DEFAULT" @change="saveParams" />
          <label title="Scan grid minimum Y bound in work coordinates. Must be less than Y Max. Defines the front edge of the probing area. (#3052)">Y0</label>
          <MachineInput gate="scanParam" type="number" v-model.number="params.scanY0" :step="STEP_DEFAULT" @change="saveParams" />
          <label title="Scan grid maximum Y bound in work coordinates. Must be greater than Y Min. Defines the back edge of the probing area. (#3053)">Y1</label>
          <MachineInput gate="scanParam" type="number" v-model.number="params.scanY1" :step="STEP_DEFAULT" @change="saveParams" />
          <label title="Number of probe points along X. Minimum 2. Point spacing = (X Max - X Min) / (count - 1). (#3054)">X Probes</label>
          <MachineInput gate="scanParam" type="number" v-model.number="params.scanXProbes" min="2" :step="STEP_DEFAULT" @change="saveParams" />
          <label title="Number of probe points along Y. Minimum 2. Point spacing = (Y Max - Y Min) / (count - 1). (#3055)">Y Probes</label>
          <MachineInput gate="scanParam" type="number" v-model.number="params.scanYProbes" min="2" :step="STEP_DEFAULT" @change="saveParams" />
          <label title="Safe Z height in work coordinates for retraction between scan probe points. Set above the highest point of the workpiece plus clearance for clamps. (#3058)">Safe Z</label>
          <MachineInput gate="scanParam" type="number" v-model.number="params.scanSafeZ" :step="STEP_DEFAULT" @change="saveParams" />
          <label title="Maximum downward probe distance from current Z. Always positive. Set larger than the deepest surface valley expected. (#3059)">Probe Depth</label>
          <MachineInput gate="scanParam" type="number" v-model.number="params.scanDepthZ" min="0.1" :step="STEP_DEFAULT" @change="saveParams" />
        </div>
      </div>

      <div class="surfaceActions">
        <MachineBtn type="probe" :disabled="probing" @click="runSurfaceScan">Start Scan</MachineBtn>
        <MachineBtn type="probe" v-if="!surfaceInViewer" @click="loadSurfaceMap">Load Map</MachineBtn>
        <MachineBtn type="probe" v-else @click="emit('clearSurfaceMap')">Unload Map</MachineBtn>
        <MachineBtn type="probe" @click="if (!surfacePoints?.length) emit('getProbeResults'); mapDialogOpen = true">3D Inspect</MachineBtn>
        <MachineBtn type="probe" :active="eoffsetEnabled" :disabled="probing" @click="toggleComp"><span class="stable-width"><span :class="{ alt: eoffsetEnabled }">Enable Comp</span><span :class="{ alt: !eoffsetEnabled }">Disable Comp</span></span></MachineBtn>
      </div>

      <div class="compStatus">
        <span class="compDot" :class="{ on: eoffsetEnabled }"></span>
        <span>Compensation: <b class="stable-width"><span :class="{ alt: !eoffsetEnabled }">ON</span><span :class="{ alt: eoffsetEnabled }">OFF</span></b></span>
        <span v-if="eoffsetZ != null" class="compValue">Z: {{ eoffsetZ.toFixed(4) }}</span>
        <span class="compMethod">
          Method:
          <MachineBtn v-for="(label, id) in METHOD_LABELS" :key="id"
            type="probe" class="methodBtn" muted :selected="compMethod === Number(id)"
            @click="setMethod(Number(id))">{{ label }}</MachineBtn>
        </span>
      </div>
    </template>

    <div class="sep"></div>

    <!-- Parameters (shared across views) -->
    <div class="section">
      <div class="sub">Parameters</div>
      <div class="paramGrid twoCol">
        <label title="Tool number of the probe. Must match the tool loaded in the spindle before any probing operation. (#3014)">Probe Tool #</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.probeTool" min="1" :step="STEP_DEFAULT" @change="saveParams" />

        <label title="Feed rate for the refined slow probe pass. Set to 0 to skip the slow pass entirely — faster but less accurate. (#3015)">Probe Slow FRate</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.slowFr" min="0" :step="STEP_FEED" @change="saveParams" />

        <label title="Feed rate for non-probing positioning moves between probe points. Does not affect probe accuracy. (#3017)">Probe Traverse FR</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.traverseFr" min="1" :step="STEP_FEED" @change="saveParams" />

        <label title="Feed rate for initial fast probe contact. Higher values are faster but reduce repeatability. (#3016)">Probe Fast FRate</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.fastFr" min="1" :step="STEP_FEED" @change="saveParams" />

        <label title="Maximum lateral travel before probe aborts if no contact is made. Safety limit — set slightly larger than the expected edge distance. (#3018)">Max X/Y Distance</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.maxXYDistance" min="0" :step="STEP_DEFAULT" @change="saveParams" />

        <label title="Retract distance in X/Y after each edge contact before the next move. Prevents the probe tip from scraping the feature wall. (#3019)">X/Y Clearance</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.xyClearance" min="0" :step="STEP_DEFAULT" @change="saveParams" />

        <label title="Maximum downward travel before probe aborts if no contact. Safety limit to prevent crashes. Set slightly larger than expected distance to surface. (#3020)">Max Z Distance</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.maxZDistance" min="0" :step="STEP_DEFAULT" @change="saveParams" />

        <label title="Retract height above the workpiece between Z probe passes. Also controls slow probe depth (2x this value). (#3021)">Z Clearance</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.zClearance" min="0" :step="STEP_DEFAULT" @change="saveParams" />

        <label title="Additional depth added to the slow probe pass beyond Z clearance. Ensures solid re-contact on rough surfaces. Increase if slow probe misses contact. (#3022)">Extra Probe Depth</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.extraProbeDepth" min="0" :step="STEP_DEFAULT" @change="saveParams" />

        <label title="Distance the probe steps away from an edge before approaching perpendicular for measurement. Ensures a clean, straight-on contact. (#3023)">Step Off Width</label>
        <MachineInput gate="probeParam" type="number" v-model.number="params.stepOffWidth" min="0.1" :step="STEP_DEFAULT" @change="saveParams" />

        <label title="Probe tip radius calibration offset. Compensates for the difference between electrical trigger point and true tip center. Set via calibration routines — do not guess. (#3032)">Cal Offset</label>
        <span class="calOffsetReadonly">{{ fmt(params.calOffset) }} <MachineBtn type="probe" :disabled="probing" @click="resetCal">Reset</MachineBtn></span>
      </div>
    </div>

    <div class="sep"></div>

    <!-- Probe Results (PB-style feedback) -->
    <div class="section">
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

  </div>

  <!-- Surface map popout dialog -->
    <div v-if="mapDialogOpen" class="dialogOverlay" @click.self="mapDialogOpen = false">
      <div class="dialog lg dialog-full">
        <div class="dialogHeader">
          <span class="dialogTitle">Surface Compensation Map</span>
          <MachineBtn type="close" @click="mapDialogOpen = false">&times;</MachineBtn>
        </div>
        <div ref="surfaceContainer" class="surface3d"></div>
      </div>
    </div>
</template>

<style scoped>
.probePanel {
  overflow-y: auto;
  height: 100%;
  position: relative;
}

/* Control bar (horizontal, between tabs and grid) */
.controlBar {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  padding: 6px 0;
}

.controlBarRight {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  margin-left: auto;
}

.section {
  display: flex;
  flex-direction: column;
  gap: var(--gap-controls);
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

/* Fixed-height section so grid + params don't shift when switching tabs */
.gridSection {
  height: 360px;
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
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
.calSection {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
}

.calRow {
  display: flex;
  align-items: center;
  gap: var(--gap-section);
}

.calBtnPair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap-tight);
  width: 196px;
  flex-shrink: 0;
}

.calParamStacked {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
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
  font-family: var(--font-mono);
}


.calParamTitle {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  opacity: var(--opacity-muted);
}

.calAxisRow {
  display: flex;
  gap: var(--gap-tight);
  max-width: 294px;
}

.calAxisBtn {
  flex: 1;
  text-align: center;
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

.gridIcon {
  width: 100%;
  height: 100%;
  max-width: 80px;
  max-height: 80px;
}

.gridZLabel {
  fill: var(--fg);
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
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
  gap: var(--gap-tight) var(--gap-controls);
  align-items: center;
}

.paramGrid.twoCol {
  grid-template-columns: auto 1fr auto 1fr;
}

.paramGrid label {
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
}

.paramGrid input {
  padding: 4px 8px;
  font-size: var(--fs-base);
  border-radius: var(--radius-md);
  max-width: 100px;
}

.checkRow {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  font-size: var(--fs-base);
  cursor: pointer;
  user-select: none;
}

/* Run / Abort buttons */
.btnRow {
  display: flex;
  gap: var(--gap-tight);
}



/* Status */
.statusRow {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}

.statusDot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-round);
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
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
  opacity: var(--opacity-muted);
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
  font-family: var(--font-mono);
  font-weight: var(--fw-semibold);
}

/* ─── Surface Map ─── */
.surfaceActions {
  display: flex;
  gap: var(--gap-tight);
  flex-wrap: wrap;
}
.surfaceActions :deep(.b) {
  flex: 1;
}
.compStatus {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  font-size: var(--fs-base);
  font-family: var(--font-mono);
}
.compDot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-round);
  background: var(--border);
}
.compDot.on {
  background: var(--ok);
  box-shadow: 0 0 6px var(--ok);
}
.compValue {
  margin-left: auto;
  opacity: var(--opacity-muted);
}
.compMethod {
  margin-left: var(--gap-section);
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}
.methodBtn {
  font-size: var(--fs-sm);
}
.surface3d {
  flex: 1;
  min-height: 0;
  border-radius: 0 0 var(--radius-2xl) var(--radius-2xl);
  overflow: hidden;
}

</style>
