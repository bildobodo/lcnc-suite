<script lang="ts">
import { ref as _ref } from "vue";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

// ---- Central asset cache (shared across ALL ThreeViewer instances) ----
const _geometryCache = new Map<string, THREE.BufferGeometry>();
let _loadPromise: Promise<void> | null = null;
let _loadedInitJson: string | null = null;
export const machineReady = _ref(false);

async function fetchAndParseStl(url: string, signal?: AbortSignal): Promise<THREE.BufferGeometry> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 200)).toLowerCase();
  if (head.includes("<!doctype") || head.includes("<html")) throw new Error(`Not an STL from ${url}`);
  const loader = new STLLoader();
  const looksAscii = head.startsWith("solid") && head.includes("facet");
  if (looksAscii) return loader.parse(new TextDecoder().decode(bytes));
  if (buf.byteLength >= 84) {
    const dv = new DataView(buf);
    const triCount = dv.getUint32(80, true);
    if (84 + triCount * 50 <= buf.byteLength && triCount < 50_000_000) return loader.parse(buf);
    return loader.parse(new TextDecoder().decode(bytes));
  }
  throw new Error(`STL too small / invalid: ${url}`);
}

export function loadMachineAssets(init: any, onProgress?: (msg: string) => void): Promise<void> {
  const json = JSON.stringify({ base: init.stl_base_url, parts: init.parts });
  // Return in-progress OR completed promise (true deduplication).
  // Rejected promises clear _loadPromise in the catch below so the next call retries.
  if (_loadPromise && json === _loadedInitJson) return _loadPromise;

  _loadedInitJson = json;
  machineReady.value = false;

  _loadPromise = (async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new DOMException("STL fetch timed out after 120s", "TimeoutError")), 120_000);
    try {
      const base = init.stl_base_url;
      const toFetch = (init.parts ?? []).filter((p: any) => !_geometryCache.has(p.id));

      if (toFetch.length === 0) {
        onProgress?.("All STLs already cached");
      }

      await Promise.all(toFetch.map(async (p: any) => {
        const url = base.endsWith("/") ? `${base}${p.file}` : `${base}/${p.file}`;
        const t0 = performance.now();
        onProgress?.(`Fetching ${p.id}…`);
        console.log(`[loader] fetching ${p.id}: ${url}`);
        const geom = await fetchAndParseStl(url, abort.signal);
        geom.computeVertexNormals();
        geom.userData._shared = true;
        _geometryCache.set(p.id, geom);
        onProgress?.(`✓ ${p.id} (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
      }));

      machineReady.value = true;
      console.log(`[loader] all assets ready (${_geometryCache.size} geometries)`);
    } catch (err) {
      _loadPromise = null; // clear so the next buildFromInit call retries fresh
      throw err;
    } finally {
      clearTimeout(timer);
    }
  })();

  return _loadPromise;
}

export function getCachedGeometry(id: string): THREE.BufferGeometry | undefined {
  return _geometryCache.get(id);
}
</script>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { viewerInit, viewerGcode, status } from "./lcncWs";
import { loadViewerDefaults, ALL_LAYERS, type Vec3, type ColorDefaults, type OpacityDefaults, type Layer } from "./defaults";
import JogHUD from "./JogHUD.vue";
import GcodeHUD from "./GcodeHUD.vue";
import SetupHUD from "./SetupHUD.vue";

const viewerDefaults = loadViewerDefaults();

type ViewerInit = {
  units?: "mm" | "inch" | string;
  stl_base_url: string;
  parts: Array<{
    id: string;
    file: string;
    parent: string | null; // "x" | "y" | "z" | null
    t?: Vec3;              // static translation
    r?: Vec3;              // optional static rotation
  }>;
  kinematics: {
    x: { axis: number; sign: number };
    y: { axis: number; sign: number };
    z: { axis: number; sign: number };
  };
};

type ViewPreset = "top" | "bottom" | "left" | "right" | "front" | "back" | "iso" | "dimetric" | "reset";


type ViewerState = {
  ts?: number;

  machine_pos?: number[];
  joint_pos?: number[];
  tool_offset?: number[];

  g5x_offset?: number[];
  g92_offset?: number[];

  active_file?: string;
  motion_line?: number;

  tool_number?: number | null;
  tool_diameter?: number | null;
  tool_length?: number | null;

  work_pos?: Vec3;

  current_vel?: number | null;
  spindle_speed?: number | null;
  spindle_direction?: number | null;
};



type ViewerGcode = {
  file?: string;
  feed?: number[][];
  feed_lines?: number[];     // parallel: g-code line number per feed point
  rapid?: number[][];
};

const props = defineProps<{
  workpieceSize: Vec3;
  workpieceOffset: Vec3;
  g5xLabel?: string;
  linearUnit?: string;
  active?: boolean;
  jogVel?: number;
  isHomed?: boolean;
  maxJogVel?: number;
  jogIncrement?: number;
  minJogVel?: number;
  iniIncrements?: number[] | null;
  gcodeContent?: string | null;
  currentLine?: number | null;
  isPaused?: boolean;
  activeFile?: string | null;
  spindleSpeed?: number | null;
  spindleActual?: number | null;
  spindleDirection?: number | null;
}>();

const emit = defineEmits<{
  (e: "update:jogVel", vel: number): void;
  (e: "update:jogIncrement", val: number): void;
  (e: "cycleStart"): void;
  (e: "cyclePause"): void;
  (e: "cycleResume"): void;
  (e: "abort"): void;
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "zeroAxis", axis: number): void;
  (e: "zeroAll"): void;
}>();

// HUD data (read from status for template)
const vst = computed(() => status.value?.data ?? null);

// ---------- DOM ----------
const host = ref<HTMLDivElement | null>(null);
const hudVisible = ref(true);
type HudPanel = "none" | "jog" | "gcode" | "setup";
const activeHudPanel = ref<HudPanel>("none");
function toggleHud(panel: HudPanel) { activeHudPanel.value = activeHudPanel.value === panel ? "none" : panel; }

// ---------- Three globals ----------
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null = null;
let perspCam: THREE.PerspectiveCamera | null = null;
let orthoCam: THREE.OrthographicCamera | null = null;
const isOrtho = ref(false);
let controls: OrbitControls | null = null;
let raf = 0;

// Transform groups (logical)
const groups: Record<string, THREE.Group> = {};
let workOrigin: THREE.Group | null = null;

// Visual objects
let toolMarker: THREE.Object3D | null = null;
let feedLine: THREE.Line | null = null;
let rapidLine: THREE.Line | null = null;
let highlightLine: THREE.Line | null = null;
let workAxes: THREE.AxesHelper | null = null;

// Map g-code line number → { start, end } point-index range in feed arrays
let feedPtsCache: number[][] = [];
let feedLineMap: Map<number, { start: number; end: number }> = new Map();

// Pending layer visibility: stores calls made before scene objects exist
let pendingLayers: Map<Layer, boolean> | null = new Map();
let toolpathVisible = true;

// ---- Camera tracking ----
let trackingMode: "none" | "tool" | "workpiece" = "none";

// ---- Path rendering ----
let pathAlwaysOnTop = true; // default; overridden by setPathAlwaysOnTop()

// ---- Unit scale ----
// 1 for mm machines, 1/25.4 for inch machines. Set in buildFromInit() from viewer_init.units.
let _unitScale = 1;

// ---- Backplot (live toolpath history) ----
let backplotLine: THREE.Line | null = null;
let backplotGeom: THREE.BufferGeometry | null = null;
let backplotPos: Float32Array | null = null;
let backplotCount = 0;
const BACKPLOT_MAX = 20000;   // points (10 Hz -> ~33 min)
const BACKPLOT_EPS = 0.01;    // mm; min distance before adding a point
let lastBackplotPt: THREE.Vector3 | null = null;
let lastBackplotFile: string | null = null;
let lastBackplotMotionLine: number | null = null;

let machineBoundsMesh: THREE.Mesh | null = null;
let workpieceMesh: THREE.Mesh | null = null;
let machineMeshes: THREE.Mesh[] = [];

function resetBackplot() {
  backplotCount = 0;
  lastBackplotPt = null;

  if (backplotGeom && backplotPos) {
    // Keep allocation, just “empty” it
    backplotGeom.setDrawRange(0, 0);
    backplotGeom.attributes.position.needsUpdate = true;
  }
}

// Frame camera to show the given bounding box.
// Handles both PerspectiveCamera (moves camera) and OrthographicCamera (sets frustum).
function frameToBounds(box: THREE.Box3) {
  if (!camera || !controls || box.isEmpty()) return;
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);

  controls.target.copy(center);
  camera.up.set(0, 0, 1);
  camera.near = Math.max(0.1, maxDim / 1000);
  camera.far  = Math.max(200000, maxDim * 20);

  if (camera instanceof THREE.OrthographicCamera) {
    const aspect = host.value ? (host.value.clientWidth / host.value.clientHeight) || 1 : 1;
    const halfH  = maxDim * 1.2;
    camera.top    =  halfH;  camera.bottom = -halfH;
    camera.right  =  halfH * aspect; camera.left = -halfH * aspect;
    camera.zoom   = 1;
    camera.position.set(center.x + maxDim, center.y - maxDim, center.z + maxDim);
  } else {
    // 1.5× offset → distance ≈ 2.35 × maxDim, fills ~90% of 45° FOV
    camera.position.set(center.x + maxDim * 1.5, center.y - maxDim * 1.5, center.z + maxDim);
  }

  camera.updateProjectionMatrix();
  controls.update();
}

function setView(p: ViewPreset) {
  if (!camera || !controls) return;

  if (p === "reset") {
    if (!groups?.root) return;
    frameToBounds(new THREE.Box3().setFromObject(groups.root));
    return;
  }

  const target = controls.target;
  const dist = camera.position.distanceTo(target);

  const dir = new THREE.Vector3();
  let up: [number, number, number] = [0, 0, 1];

  switch (p) {
    case "top":      dir.set(0, 0, 1);     up = [0, 1, 0]; break;
    case "bottom":   dir.set(0, 0, -1);    up = [0, -1, 0]; break;
    case "front":    dir.set(1, 0, 0);     break;
    case "back":     dir.set(-1, 0, 0);    break;
    case "left":     dir.set(0, -1, 0);    break;
    case "right":    dir.set(0, 1, 0);     break;
    case "iso":      dir.set(1, -1, 0.8);  break;
    case "dimetric": dir.set(0.7, -0.7, 1); break;
  }

  dir.normalize().multiplyScalar(dist);
  camera.position.copy(target).add(dir);
  camera.up.set(...up);

  camera.updateProjectionMatrix();
  controls.update();
}

const PERSP_FOV = 45;

function switchProjection() {
  if (!camera || !controls || !perspCam || !orthoCam) return;

  const target = controls.target.clone();
  const dist = camera.position.distanceTo(target);
  const aspect = host.value ? (host.value.clientWidth / host.value.clientHeight) || 1 : 1;

  if (!isOrtho.value) {
    // Perspective → Orthographic
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(PERSP_FOV / 2));
    orthoCam.top = halfH;
    orthoCam.bottom = -halfH;
    orthoCam.right = halfH * aspect;
    orthoCam.left = -halfH * aspect;
    orthoCam.near = perspCam.near;
    orthoCam.far = perspCam.far;
    orthoCam.position.copy(camera.position);
    orthoCam.up.copy(camera.up);
    orthoCam.zoom = 1;
    orthoCam.updateProjectionMatrix();
    camera = orthoCam;
  } else {
    // Orthographic → Perspective
    const effectiveHalfH = orthoCam.top / orthoCam.zoom;
    const newDist = effectiveHalfH / Math.tan(THREE.MathUtils.degToRad(PERSP_FOV / 2));
    const dir = camera.position.clone().sub(target).normalize();
    perspCam.position.copy(target).addScaledVector(dir, newDist);
    perspCam.up.copy(camera.up);
    perspCam.near = orthoCam.near;
    perspCam.far = orthoCam.far;
    perspCam.updateProjectionMatrix();
    camera = perspCam;
  }

  isOrtho.value = !isOrtho.value;
  controls.object = camera;
  controls.update();
}

function setLayerVisible(layer: Layer | string, on: boolean) {
  if (pendingLayers) {
    pendingLayers.set(layer, on);
  }
  switch (layer) {
    case "backplot":
      if (backplotLine) backplotLine.visible = on;
      break;
    case "toolpath":
      toolpathVisible = on;
      if (feedLine) feedLine.visible = on;
      if (rapidLine) rapidLine.visible = on;
      if (highlightLine) highlightLine.visible = on;
      break;
    case "machine":
      for (const m of machineMeshes) m.visible = on;
      break;
    case "workpiece":
      if (workpieceMesh) workpieceMesh.visible = on;
      break;
    case "bounds":
      if (machineBoundsMesh) machineBoundsMesh.visible = on;
      break;
    case "tool":
      if (toolMarker) toolMarker.visible = on;
      break;
    case "workzero":
      if (workAxes) workAxes.visible = on;
      break;
    case "hud":
      hudVisible.value = on;
      break;
  }
}

function setPathAlwaysOnTop(on: boolean) {
  pathAlwaysOnTop = on;
  const dt = !on; // depthTest: false = always on top

  if (backplotLine) {
    const m = backplotLine.material as THREE.LineBasicMaterial;
    m.depthTest = dt;
    m.depthWrite = false; // backplot is transparent, never write depth
    m.needsUpdate = true;
  }
  if (feedLine) {
    const m = feedLine.material as THREE.LineBasicMaterial;
    m.depthTest = dt;
    m.depthWrite = dt;
    m.needsUpdate = true;
  }
  if (rapidLine) {
    const m = rapidLine.material as THREE.LineDashedMaterial;
    m.depthTest = dt;
    m.depthWrite = dt;
    m.needsUpdate = true;
  }
  if (highlightLine) {
    const m = highlightLine.material as THREE.LineBasicMaterial;
    m.depthTest = dt;
    m.depthWrite = false;
    m.needsUpdate = true;
  }
}

function setTrackingMode(mode: "none" | "tool" | "workpiece") {
  trackingMode = mode;
}

function pushBackplotPoint(p: [number, number, number]) {
  if (!backplotGeom || !backplotPos || !backplotLine) return;


  const x = p[0] ?? 0;
  const y = p[1] ?? 0;
  const z = p[2] ?? 0;

  const v = new THREE.Vector3(x, y, z);

  if (lastBackplotPt) {
    if (v.distanceTo(lastBackplotPt) < BACKPLOT_EPS) return;
  }

  // Ensure objects exist (created in ensureCoreGroups)
  if (!backplotGeom || !backplotPos || !backplotLine) return;

  // If full, shift left by one (simple & robust)
  if (backplotCount >= BACKPLOT_MAX) {
    backplotPos.copyWithin(0, 3, BACKPLOT_MAX * 3);
    backplotCount = BACKPLOT_MAX - 1;
  }

  const i = backplotCount * 3;
  backplotPos[i + 0] = v.x;
  backplotPos[i + 1] = v.y;
  backplotPos[i + 2] = v.z;

  backplotCount++;
  lastBackplotPt = v;

  backplotGeom.setDrawRange(0, backplotCount);
  backplotGeom.attributes.position.needsUpdate = true;
}



// Used to ignore late async loads after rebuild
let buildToken = 0;

// ---------- Materials (muted colors requested) ----------
const MAT = {
  tool: new THREE.MeshStandardMaterial({ metalness: 0.2, roughness: 0.4 }),
  frame: new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.8 }),
  axisX: new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.7 }),
  axisY: new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.7 }),
  axisZ: new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.7 }),
};

// light gray frame
MAT.frame.color.setHex(0xbfbfbf);
// muted red/green/blue axes
MAT.axisX.color.setHex(0x9b4a4a); // X muted red
MAT.axisY.color.setHex(0x4a8f5a); // Y muted green
MAT.axisZ.color.setHex(0x4a6f9b); // Z muted blue
MAT.tool.color.setHex(0xf5f5f5);  // near-white tool

/** Apply machine STL opacity to all MAT materials */
function applyMachineOpacity(op: number) {
  for (const mat of [MAT.frame, MAT.axisX, MAT.axisY, MAT.axisZ]) {
    mat.transparent = op < 1;
    mat.opacity = op;
    mat.depthWrite = op >= 1;
    mat.needsUpdate = true;
  }
}

// ---------- helpers ----------
function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child: any) => {
    // Skip shared geometries from the central cache — they're reused across viewers
    if (child.geometry && !child.geometry.userData?._shared) child.geometry.dispose?.();
    // IMPORTANT: don't dispose shared MAT.* materials
    // so we intentionally skip disposing child.material here.
  });
}

function clearScene() {
  if (!scene) return;
  while (scene.children.length) {
    const c = scene.children.pop()!;
    disposeObject(c);
  }
}

function applyBox(mesh: THREE.Mesh, size: Vec3, origin: Vec3) {
  const [sx, sy, sz] = size;
  const [ox, oy, oz] = origin;

  mesh.scale.set(Math.max(0.001, sx), Math.max(0.001, sy), Math.max(0.001, sz));
  mesh.position.set(ox + sx / 2, oy + sy / 2, oz + sz / 2);
}

function makeLine(points: number[][], colorHex: number | string, dashed = false, opacity = 1.0) {
  const geom = new THREE.BufferGeometry();
  const flat = new Float32Array(points.flat());
  geom.setAttribute("position", new THREE.BufferAttribute(flat, 3));

  // Important: stable bounds so Three doesn't cull it incorrectly
  geom.computeBoundingSphere();

  let mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial;

  if (dashed) {
    mat = new THREE.LineDashedMaterial({
      color: colorHex,
      dashSize: 10,
      gapSize: 6,
      transparent: opacity < 1,
      opacity,
    });
    mat.depthTest = !pathAlwaysOnTop;
    mat.depthWrite = !pathAlwaysOnTop && opacity >= 1;
  } else {
    mat = new THREE.LineBasicMaterial({ color: colorHex, transparent: opacity < 1, opacity });
    mat.depthTest = !pathAlwaysOnTop;
    mat.depthWrite = !pathAlwaysOnTop;
  }

  const line = new THREE.Line(geom, mat);
  line.renderOrder = 10;

  // Important: prevent disappearing when workOrigin shifts / bounds get odd
  line.frustumCulled = false;

  if (dashed) (line as any).computeLineDistances?.();
  return line;
}


function ensureCoreGroups() {
  if (!scene) return;

  // reset pointers
  workOrigin = null;
  workAxes = null;
  machineBoundsMesh = null;
  workpieceMesh = null;
  machineMeshes = [];

  groups.root = new THREE.Group();
  groups.x = new THREE.Group();
  groups.y = new THREE.Group();
  groups.z = new THREE.Group();
  groups.tool = new THREE.Group();
 
  scene.add(groups.root);

  // ✅ Your topology:
  // root → x
  // root → y
  // y → z
  // z → tool
  groups.root.add(groups.x);
  groups.root.add(groups.y);
  groups.y.add(groups.z);
  groups.z.add(groups.tool);

  // Work origin (DRO zero frame) — must sit on X like your vismach toolpath/work_cs
  workOrigin = new THREE.Group();
  groups.x.add(workOrigin);

  // Work/DRO axes helper (the one you kept)
  workAxes = new THREE.AxesHelper(120 * _unitScale);
  workOrigin.add(workAxes);

  // ---- Backplot line (tool history in WORK coordinates) ----
{
  backplotGeom = new THREE.BufferGeometry();
  backplotPos = new Float32Array(BACKPLOT_MAX * 3);
  backplotGeom.setAttribute("position", new THREE.BufferAttribute(backplotPos, 3));
  backplotGeom.setDrawRange(0, 0);

  const bpColor = viewerDefaults.colors.backplot ?? "#ff00ff";
  const bpOpacity = viewerDefaults.opacities.backplot ?? 0.55;
  const mat = new THREE.LineBasicMaterial({
    color: bpColor,
    transparent: true,
    opacity: bpOpacity,
    depthTest: !pathAlwaysOnTop,
    depthWrite: false,
  });

  backplotLine = new THREE.Line(backplotGeom, mat);
  backplotLine.renderOrder = 10;
  backplotLine.frustumCulled = false;   // ✅ prevents disappearing when origin is off-screen
  groups.x.add(backplotLine);

resetBackplot();


}


  // Tool marker (TIP pinned at local origin, extends +Z into holder)
  function makeToolMesh(diam: number, len: number) {
    const r = Math.max(0.2, diam * 0.5);
    const L = Math.max(5, len);

    const g = new THREE.CylinderGeometry(r, r, L, 20);

    // CylinderGeometry is Y-up by default.
    // Rotate geometry to Z-up and translate so tip is at Z=0.
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, L / 2);

    return new THREE.Mesh(g, MAT.tool);
  }

  // Default until viewer_state arrives
  toolMarker = makeToolMesh(6 * _unitScale, 60 * _unitScale);
  groups.tool.add(toolMarker);



  // --- Machine bounds box (also sits on X, like your vismach limits_vis) ---
  {
    const boundsColor = viewerDefaults.colors.bounds ?? "#ffffff";
    const boundsOp = viewerDefaults.opacities.bounds ?? 0.10;
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: boundsColor,
      transparent: true,
      opacity: boundsOp,
      depthWrite: false,
    });
    machineBoundsMesh = new THREE.Mesh(geom, mat);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geom),
      new THREE.LineBasicMaterial({ color: boundsColor, transparent: true, opacity: Math.min(1, boundsOp * 2.5) })
    );
    machineBoundsMesh.add(edges);

    groups.x.add(machineBoundsMesh);
  }

  // --- Workpiece box (in work coordinates, relative to DRO zero, and sits on X via workOrigin) ---
  {
    const wpColor = viewerDefaults.colors.workpiece ?? "#ffffff";
    const wpOp = viewerDefaults.opacities.workpiece ?? 0.16;
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: wpColor,
      transparent: true,
      opacity: wpOp,
      depthWrite: false,
    });
    workpieceMesh = new THREE.Mesh(geom, mat);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geom),
      new THREE.LineBasicMaterial({ color: wpColor, transparent: true, opacity: Math.min(1, wpOp * 2.2) })
    );
    workpieceMesh.add(edges);

    workOrigin.add(workpieceMesh);
    applyBox(workpieceMesh, props.workpieceSize, props.workpieceOffset);
  }

  // Apply machine STL opacity
  applyMachineOpacity(viewerDefaults.opacities.machine ?? 1.0);

  // Apply tool color
  MAT.tool.color.set(viewerDefaults.colors.tool ?? "#ffdd00");
}

function sceneBgFromTheme(): THREE.Color {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  return new THREE.Color(bg);
}

async function buildFromInit(init: ViewerInit) {
  if (!scene) return;

  buildToken++;
  const myToken = buildToken;

  clearScene();
  (window as any).__viewerDiag = { ready: false };

  try {
    _unitScale = (init.units === "in" || init.units === "inch") ? 1 / 25.4 : 1;

    scene.background = sceneBgFromTheme();

    // lights (no grid)
    scene.add(new THREE.AmbientLight());

    const dl = new THREE.DirectionalLight();
    dl.position.set(800, -800, 1200);
    scene.add(dl);

    ensureCoreGroups();
    // Apply machine bounds from viewer_init (INI-derived)
    const mb = (init as any).machine_bounds;
    if (machineBoundsMesh && mb?.size && mb?.origin) {
      applyBox(machineBoundsMesh, mb.size as Vec3, mb.origin as Vec3);
    } else {
      console.warn("No machine_bounds in viewer_init; bounds box will remain default");
    }

    // Load all STL assets via the central cache (first caller fetches, others await same Promise)
    await loadMachineAssets(init);
    if (myToken !== buildToken) return;

    const parts = init.parts ?? [];
    for (const p of parts) {
      const geom = getCachedGeometry(p.id);
      if (!geom) { console.warn(`No cached geometry for ${p.id}`); continue; }

      let mat = MAT.frame;
      if (p.parent === "x") mat = MAT.axisX;
      else if (p.parent === "y") mat = MAT.axisY;
      else if (p.parent === "z") mat = MAT.axisZ;

      const mesh = new THREE.Mesh(geom, mat);  // shares GPU geometry, no copy
      if (p.t) mesh.position.set(p.t[0] * _unitScale, p.t[1] * _unitScale, p.t[2] * _unitScale);
      if (p.r) mesh.rotation.set(p.r[0], p.r[1], p.r[2]);
      mesh.scale.setScalar(_unitScale);  // convert mm STL geometry → machine-unit world

      const parent = (p.parent ? groups[p.parent] : groups.root) ?? groups.root;
      parent.add(mesh);
      machineMeshes.push(mesh);
    }

    // Auto-frame to machine work envelope — use raw INI data (not setFromObject) so
    // the frame is immune to axis movement that may have shifted groups.x/y/z above.
    // Falls back to STL mesh world bounds if no bounds data present.
    {
      let autoBox = new THREE.Box3();
      const mb = (init as any).machine_bounds;
      if (mb?.size && mb?.origin) {
        const [ox, oy, oz] = mb.origin as [number, number, number];
        const [sx, sy, sz] = mb.size as [number, number, number];
        autoBox.set(new THREE.Vector3(ox, oy, oz),
                    new THREE.Vector3(ox + sx, oy + sy, oz + sz));
      } else if (machineMeshes.length > 0) {
        for (const m of machineMeshes) autoBox.expandByObject(m);
      }
      frameToBounds(autoBox);

      (window as any).__viewerDiag = {
        ready: true,
        meshCount: machineMeshes.length,
        boundsValid: !autoBox.isEmpty(),
        timestamp: Date.now(),
      };
    }

    // Apply any layer visibility that was requested before objects existed
    if (pendingLayers) {
      for (const [layer, on] of pendingLayers) {
        setLayerVisible(layer, on);
      }
      pendingLayers = null;
    }

  } catch (err) {
    console.error("buildFromInit failed:", err);
    (window as any).__viewerDiag = { ready: false, error: (err as Error).message };
  }
}

function applyState(init: ViewerInit, st: ViewerState) {
  // Drive machine axes from JOINT positions (spindle nose / carriage reference)
  const jp = st.joint_pos;
  if (!jp) return;

  if (!groups.x || !groups.y || !groups.z || !groups.tool) return;

  const kin = init.kinematics;
  const ax = (idx: number) => (idx >= 0 && idx < jp.length ? jp[idx] : 0);

  // Apply to your group topology (machine model motion)
  groups.x.position.x = ax(kin.x.axis) * (kin.x.sign ?? 1);
  groups.y.position.y = ax(kin.y.axis) * (kin.y.sign ?? 1);
  groups.z.position.z = ax(kin.z.axis) * (kin.z.sign ?? 1);

  // Tool spatial compensation:
  // Put the tool TIP at TCP by moving the tool group by -tool_offset relative to spindle nose.
  const tofs = st.tool_offset;
  if (tofs && tofs.length >= 3) {
    groups.tool.position.set(-(tofs[0] ?? 0), -(tofs[1] ?? 0), -(tofs[2] ?? 0));
  } else {
    groups.tool.position.set(0, 0, 0);
  }

  // Work origin offset: place DRO/work zero in machine space.
  // workOrigin is parented under X, matching your vismach structure.
  const g5x = st.g5x_offset ?? [];
  const g92 = st.g92_offset ?? [];

  const ox = (g5x[0] ?? 0) + (g92[0] ?? 0);
  const oy = (g5x[1] ?? 0) + (g92[1] ?? 0);
  const oz = (g5x[2] ?? 0) + (g92[2] ?? 0);

  if (workOrigin) workOrigin.position.set(ox, oy, oz);

  // ---- Tool visual: diameter + length (TIP stays at local z=0) ----
  if (toolMarker && (toolMarker as any).geometry) {
    const diam   = st.tool_diameter ?? 6.0  * _unitScale;
    const rawLen = st.tool_length   ?? 60.0 * _unitScale;

    const sinkIntoHolder = 20 * _unitScale;
    const minVisualLen   = 40 * _unitScale;
    const visLen = Math.max(minVisualLen, rawLen + sinkIntoHolder);

    const r = Math.max(0.2, diam * 0.5);

    const mesh = toolMarker as THREE.Mesh;

    // Only rebuild if it meaningfully changed (prevents churn)
    const prev = (mesh.userData.toolVis as any) || {};
    const changed = Math.abs((prev.r ?? 0) - r) > 0.01 || Math.abs((prev.L ?? 0) - visLen) > 0.5;

    if (changed) {
      mesh.geometry.dispose();

      const g = new THREE.CylinderGeometry(r, r, visLen, 20);
      g.rotateX(Math.PI / 2);      // axis -> Z
      g.translate(0, 0, visLen / 2); // tip at z=0

      mesh.geometry = g;
      mesh.userData.toolVis = { r, L: visLen };
    }
  }
    if (toolMarker) {
    toolMarker.visible = true;
  }


  
  // ---- Backplot update (use WORK tool-tip position directly) ----
  const curFile = st.active_file ?? null;
  const curLine = typeof st.motion_line === "number" ? st.motion_line : null;

  lastBackplotFile = curFile;
  lastBackplotMotionLine = curLine;

  // Append the actual rendered tool tip position, expressed in groups.x local space.
  // This guarantees the backplot starts exactly at the tooltip (independent of joint_pos vs machine_pos nuances).
  if (toolMarker && groups.x) {
    const w = new THREE.Vector3();
    toolMarker.getWorldPosition(w);

    const xl = groups.x.worldToLocal(w.clone());
    pushBackplotPoint([xl.x, xl.y, xl.z]);
  }

  // ---- Highlight current motion line in toolpath ----
  // motion_line can be ~1 line ahead during G64 blending; try previous line first
  if (highlightLine && curLine != null) {
    const effectiveLine = feedLineMap.has(curLine - 1) ? curLine - 1 : curLine;
    const range = feedLineMap.get(effectiveLine);
    if (range) {
      const s = Math.max(0, range.start - 1);
      highlightLine.geometry.setDrawRange(s, range.end - s + 1);
    } else {
      highlightLine.geometry.setDrawRange(0, 0);
    }
  } else {
    if (highlightLine) highlightLine.geometry.setDrawRange(0, 0);
  }
}



function applyGcode(g: ViewerGcode) {
  if (!scene || !workOrigin) return;

  // Remove old lines
  if (feedLine) {
    workOrigin.remove(feedLine);
    disposeObject(feedLine);
    feedLine = null;
  }
  if (rapidLine) {
    workOrigin.remove(rapidLine);
    disposeObject(rapidLine);
    rapidLine = null;
  }
  if (highlightLine) {
    workOrigin.remove(highlightLine);
    disposeObject(highlightLine);
    highlightLine = null;
  }
  feedPtsCache = [];
  feedLineMap = new Map();

  const feedPts = g.feed ?? [];
  const feedLines = g.feed_lines ?? [];
  const rapidPts = g.rapid ?? [];

  // Build line-number → point-index range map
  for (let i = 0; i < feedLines.length; i++) {
    const ln = feedLines[i];
    const entry = feedLineMap.get(ln);
    if (entry) {
      entry.end = i;
    } else {
      feedLineMap.set(ln, { start: i, end: i });
    }
  }

  // Feed + Rapid toolpath lines (colors + opacity from props or defaults)
  const feedColor = viewerDefaults.colors.feed ?? "#22b8cf";
  const rapidColor = viewerDefaults.colors.rapid ?? "#f5a623";
  const toolpathOp = viewerDefaults.opacities.toolpath ?? 1.0;
  if (feedPts.length >= 2) {
    feedLine = makeLine(feedPts, feedColor, false, toolpathOp);
    workOrigin.add(feedLine);
  }
  if (rapidPts.length >= 2) {
    rapidLine = makeLine(rapidPts, rapidColor, true, toolpathOp);
    workOrigin.add(rapidLine);
  }

  // Prepare highlight line (reuses feed geometry, drawn on top with bright color)
  feedPtsCache = feedPts;
  if (feedPts.length >= 2) {
    const hlGeom = new THREE.BufferGeometry();
    const flat = new Float32Array(feedPts.flat());
    hlGeom.setAttribute("position", new THREE.BufferAttribute(flat, 3));
    hlGeom.setDrawRange(0, 0); // hidden until motion_line updates
    const hlMat = new THREE.LineBasicMaterial({ color: 0xff3333 });
    hlMat.depthTest = !pathAlwaysOnTop;
    hlMat.depthWrite = false;
    highlightLine = new THREE.Line(hlGeom, hlMat);
    highlightLine.renderOrder = 11;
    highlightLine.frustumCulled = false;
    workOrigin.add(highlightLine);

  }

  // Apply stored toolpath visibility (may have been set before lines existed)
  if (!toolpathVisible) {
    if (feedLine) feedLine.visible = false;
    if (rapidLine) rapidLine.visible = false;
    if (highlightLine) highlightLine.visible = false;
  }
}

// ---------- lifecycle ----------
let resizeObs: ResizeObserver | null = null;

function resize() {
  if (!renderer || !camera || !host.value) return;
  const w = host.value.clientWidth;
  const h = host.value.clientHeight;
  if (w === 0 || h === 0) return; // hidden (v-show)
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = w / h;
  } else if (camera instanceof THREE.OrthographicCamera) {
    const aspect = w / h;
    const halfH = camera.top; // frustum half-height stays fixed
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
  }
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

let pendingState: any = null;

function animate() {
  if (props.active === false) return; // paused — don't schedule next frame
  raf = requestAnimationFrame(animate);

  // Apply pending state before render (natural frame dropping —
  // if multiple status updates arrive between frames, only the latest is used)
  if (pendingState && viewerInit.value) {
    applyState(viewerInit.value as ViewerInit, pendingState as ViewerState);
    pendingState = null;
  }

  // Camera tracking — move both target and camera to maintain viewing angle
  if (trackingMode !== "none" && controls && camera) {
    const target = new THREE.Vector3();
    if (trackingMode === "tool" && toolMarker) {
      toolMarker.getWorldPosition(target);
    } else if (trackingMode === "workpiece" && workOrigin) {
      workOrigin.getWorldPosition(target);
    }
    const delta = target.sub(controls.target);
    controls.target.add(delta);
    camera.position.add(delta);
  }

  controls?.update();
  renderer?.render(scene!, camera!);
}

const themeMql = window.matchMedia('(prefers-color-scheme: dark)');
function onThemeChange() {
  if (scene) scene.background = sceneBgFromTheme();
}

onMounted(() => {
  scene = new THREE.Scene();
  scene.background = sceneBgFromTheme();

  perspCam = new THREE.PerspectiveCamera(45, 1, 1, 20000);
  perspCam.up.set(0, 0, 1); // Z-up
  perspCam.position.set(1200, -1200, 800);

  // Ortho camera — frustum will be computed on first switch
  orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
  orthoCam.up.set(0, 0, 1);
  orthoCam.position.copy(perspCam.position);

  camera = perspCam;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);

  if (host.value) {
    host.value.appendChild(renderer.domElement);
  }

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.target.set(0, 0, 0);

  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 1.2;
  controls.panSpeed = 0.8;

  controls.enablePan = true;
  controls.screenSpacePanning = true;

  themeMql.addEventListener('change', onThemeChange);

  resizeObs = new ResizeObserver(() => resize());
  resizeObs.observe(host.value!);

  resize();
  animate();

  // viewerGcode may already be set before this component mounted
  if (viewerGcode.value) applyGcode(viewerGcode.value as ViewerGcode);

  // Apply saved defaults (self-contained — no external wiring needed)
  for (const layer of ALL_LAYERS) setLayerVisible(layer, viewerDefaults.layers[layer]);
  setTrackingMode(viewerDefaults.trackingMode);
  setPathAlwaysOnTop(viewerDefaults.pathOnTop);
  if (viewerDefaults.projection === "parallel") switchProjection();
});

onUnmounted(() => {
  themeMql.removeEventListener('change', onThemeChange);
  resizeObs?.disconnect();
  resizeObs = null;
  cancelAnimationFrame(raf);

  controls?.dispose();

  if (renderer) {
    renderer.dispose();
    if (renderer.domElement.parentElement) {
      renderer.domElement.parentElement.removeChild(renderer.domElement);
    }
  }

  if (scene) clearScene();

  renderer = null;
  scene = null;
  camera = null;
  controls = null;
});

// ---------- reactive wiring ----------

// Rebuild when init arrives — dedup by content to prevent unnecessary scene rebuilds
let _lastInitJson = "";
watch(
  () => viewerInit.value as ViewerInit | null,
  (init) => {
    if (!init) return;
    const json = JSON.stringify(init);
    if (json === _lastInitJson) return;
    _lastInitJson = json;
    buildFromInit(init);
  },
  { immediate: true }
);

// Pause/resume RAF loop when active prop changes
watch(() => props.active, (now) => {
  if (now !== false && renderer) {
    resize();
    animate();
  } else {
    cancelAnimationFrame(raf);
  }
});

// Buffer latest status for rAF consumption (frame dropping)
watch(
  () => status.value,
  (msg) => {
    if (props.active === false) return; // skip when hidden
    if (msg?.data) pendingState = msg.data;
  },
);

// Apply gcode preview when it arrives
watch(
  () => viewerGcode.value as ViewerGcode | null,
  (g) => {
    if (g) applyGcode(g);
  },
);


// Update workpiece live from UI
watch(
  () => [props.workpieceSize, props.workpieceOffset] as const,
  () => {
    if (workpieceMesh) applyBox(workpieceMesh, props.workpieceSize, props.workpieceOffset);
  },
  { deep: true }
);


// Format coordinate for HUD display
function formatCoord(val: number | null | undefined): string {
  if (val == null) return '---';
  return val.toFixed(3);
}

defineExpose({
  resetBackplot,
  setView,
  setLayerVisible,
  setPathAlwaysOnTop,
  setTrackingMode,
  switchProjection,
  isOrtho,
});


</script>

<template>
  <div class="viewerWrapper">
    <div ref="host" class="viewerHost" />

    <!-- HUD Overlay -->
    <div v-show="hudVisible" class="hud" :style="{ opacity: viewerDefaults.opacities.hud ?? 1 }">
      <div class="hudSection">
        <div class="hudLabel">Machine Position</div>
        <div class="hudCoords">
          <div class="hudCoord"><span class="hudAxis">X</span> {{ formatCoord(vst?.machine_pos?.[0]) }}</div>
          <div class="hudCoord"><span class="hudAxis">Y</span> {{ formatCoord(vst?.machine_pos?.[1]) }}</div>
          <div class="hudCoord"><span class="hudAxis">Z</span> {{ formatCoord(vst?.machine_pos?.[2]) }}</div>
        </div>
      </div>

      <div class="hudSection">
        <div class="hudLabel">Work Position ({{ props.g5xLabel || '-' }})</div>
        <div class="hudCoords">
          <div class="hudCoord"><span class="hudAxis">X</span> {{ formatCoord(vst?.work_pos?.[0]) }}</div>
          <div class="hudCoord"><span class="hudAxis">Y</span> {{ formatCoord(vst?.work_pos?.[1]) }}</div>
          <div class="hudCoord"><span class="hudAxis">Z</span> {{ formatCoord(vst?.work_pos?.[2]) }}</div>
        </div>
      </div>

      <div class="hudSection">
        <div class="hudLabel">Tool</div>
        <div class="hudCoords">
          <div class="hudCoord"><span class="hudAxis">T</span> {{ vst?.tool_number ?? '-' }}</div>
          <div class="hudCoord"><span class="hudAxis">Ø</span> {{ formatCoord(vst?.tool_diameter) }}</div>
          <div class="hudCoord"><span class="hudAxis">L</span> {{ formatCoord(vst?.tool_length) }}</div>
        </div>
      </div>

      <div class="hudSection">
        <div class="hudLabel">Feed</div>
        <div class="hudValue">{{ vst?.current_vel != null ? (vst.current_vel * 60).toFixed(1) : '---' }}/min</div>
      </div>

      <div class="hudSection">
        <div class="hudLabel">Spindle</div>
        <div class="hudValue">{{ formatCoord(vst?.spindle_speed_actual) }} RPM</div>
      </div>
    </div>

    <!-- HUD pills (top-left) -->
    <div class="hudOverlay">
      <div class="hudPills">
        <button class="hudPill" :class="{ active: activeHudPanel === 'jog' }" @click="toggleHud('jog')">Jog</button>
        <button class="hudPill" :class="{ active: activeHudPanel === 'gcode' }" @click="toggleHud('gcode')">Program</button>
        <button class="hudPill" :class="{ active: activeHudPanel === 'setup' }" @click="toggleHud('setup')">Setup</button>
      </div>

      <div v-show="activeHudPanel === 'jog'">
        <JogHUD
          :jogVel="props.jogVel ?? 10"
          :linearUnit="props.linearUnit ?? 'mm'"
          :maxJogVel="props.maxJogVel ?? 100"
          :jogIncrement="props.jogIncrement ?? 0"
          :minJogVel="props.minJogVel ?? 0.1"
          :iniIncrements="props.iniIncrements ?? null"
          @update:jogVel="emit('update:jogVel', $event)"
          @update:jogIncrement="emit('update:jogIncrement', $event)"
        />
      </div>

      <div v-show="activeHudPanel === 'gcode'">
        <GcodeHUD
          :gcodeContent="props.gcodeContent ?? null"
          :currentLine="props.currentLine ?? null"
          :isPaused="props.isPaused ?? false"
          @cycleStart="emit('cycleStart')"
          @cyclePause="emit('cyclePause')"
          @cycleResume="emit('cycleResume')"
          @abort="emit('abort')"
        />
      </div>

      <div v-show="activeHudPanel === 'setup'">
        <SetupHUD
          :homed="props.isHomed ?? false"
          @homeAll="emit('homeAll')"
          @unhomeAll="emit('unhomeAll')"
          @zeroAxis="emit('zeroAxis', $event)"
          @zeroAll="emit('zeroAll')"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.hudOverlay {
  position: absolute;
  top: 12px;
  left: 12px;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hudPills {
  display: flex;
  gap: 4px;
}

.hudPill {
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: color-mix(in oklab, var(--panel) 85%, transparent);
  opacity: 0.75;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  transition: opacity 0.12s, background 0.12s;
}

.hudPill:hover {
  opacity: 1;
}

.hudPill.active {
  opacity: 1;
  background: color-mix(in oklab, var(--fg) 15%, var(--panel));
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

.hudPill.warn {
  opacity: 1;
  border-color: #b8860b80;
  animation: flash-pill-warn 1.2s ease-in-out infinite;
}

@keyframes flash-pill-warn {
  0%, 100% { background: color-mix(in oklab, #b8860b 25%, var(--panel)); }
  50% { background: color-mix(in oklab, #b8860b 10%, var(--panel)); }
}

.viewerWrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.viewerHost {
  width: 100%;
  height: 100%;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: color-mix(in oklab, var(--panel) 70%, transparent);
}

.hud {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  user-select: none;
}

.hudSection {
  background: color-mix(in oklab, var(--panel) 85%, transparent);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.4;
}

.hudLabel {
  color: var(--fg);
  opacity: 0.6;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.hudValue {
  color: var(--fg);
  font-weight: 500;
}

.hudCoords {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hudCoord {
  color: var(--fg);
  font-weight: 500;
}
.hudAxis {
  color: var(--fg);
  opacity: 0.5;
  margin-right: 4px;
}

</style>

