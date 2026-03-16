<script lang="ts">
import { ref as _ref } from "vue";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

interface HolderSegment {
  height: number;
  lower_diameter: number;
  upper_diameter: number;
}

interface ProfileSegment {
  end: [number, number];
  arc?: boolean;
  ccw?: boolean;
  center?: [number, number];
}

interface ToolMeta {
  type?: string;
  oal?: number;
  flute_length?: number;
  body_length?: number;
  shaft_diameter?: number;
  taper_angle?: number;
  point_angle?: number;
  tip_diameter?: number;
  corner_radius?: number;
  holder_segments?: HolderSegment[];
  profile?: ProfileSegment[];
}

// ---- Central caches (shared across ALL ThreeViewer instances) ----
const _geometryCache = new Map<string, THREE.BufferGeometry>();
const _toolMetaCache = new Map<number, ToolMeta>();  // tool_number → ToolMeta, populated on first sight
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
        const geom = await fetchAndParseStl(url, abort.signal);
        geom.computeVertexNormals();
        geom.userData._shared = true;
        _geometryCache.set(p.id, geom);
        onProgress?.(`✓ ${p.id} (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
      }));

      machineReady.value = true;
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
import { computed, inject, onMounted, onUnmounted, ref, watch, type ComputedRef } from "vue";

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Text } from "troika-three-text";

import { viewerInit, viewerGcode, status } from "./lcncWs";
import { loadViewerDefaults, ALL_LAYERS, type Vec3, type Layer } from "./defaults";
import JogHUD from "./JogHUD.vue";
import GcodeHUD from "./GcodeHUD.vue";
import SetupHUD from "./SetupHUD.vue";

const isDark = inject<ComputedRef<boolean>>("isDark", computed(() => window.matchMedia("(prefers-color-scheme: dark)").matches));

const viewerDefaults = loadViewerDefaults();

type ViewerInit = {
  units?: "mm" | "inch" | string;
  stl_base_url: string;
  groups?: Array<{ id: string; parent: string; translate?: Vec3 }>;
  parts: Array<{
    id: string;
    file: string;
    group?: string | null;
    translate?: Vec3;
    rotate?: Vec3;
    // Legacy field names (backward compat)
    parent?: string | null;
    t?: Vec3;
    r?: Vec3;
  }>;
  kinematics: Array<{
    group: string;
    joint: number;
    type?: "translate" | "rotate";     // default: "translate"
    direction?: "x" | "y" | "z";      // standard axis (required unless axis[] provided)
    axis?: [number, number, number];   // arbitrary rotation axis vector (Phase 2)
    sign: number;
  }> | Record<string, { axis: number; sign: number }>;  // accept legacy object form
  workGroup?: string;
  toolGroup?: string;
  machine_bounds?: { origin: Vec3; size: Vec3 };
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
  tool_meta?: ToolMeta | null;

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
  angularJogVel?: number;
  isHomed?: boolean;
  isTeleop?: boolean;
  maxJogVel?: number;
  maxAngularJogVel?: number;
  minAngularJogVel?: number;
  jogIncrement?: number;
  minJogVel?: number;
  iniIncrements?: number[] | null;
  gcodeContent?: string | null;
  currentLine?: number | null;
  isPaused?: boolean;
  elapsed?: string;
  activeFile?: string | null;
  spindleSpeed?: number | null;
  spindleActual?: number | null;
  spindleDirection?: number | null;
  surfacePoints?: [number, number, number][] | null;
  axes?: string[];
  touchoff?: number[];
  optionalStop?: boolean;
  blockDelete?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:jogVel", vel: number): void;
  (e: "update:angularJogVel", vel: number): void;
  (e: "update:jogIncrement", val: number): void;
  (e: "update:touchoff", values: number[]): void;
  (e: "cycleStart"): void;
  (e: "cycleStep"): void;
  (e: "cyclePause"): void;
  (e: "cycleResume"): void;
  (e: "abort"): void;
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "setAxis", axis: number, value: number): void;
  (e: "setAll", values: number[]): void;
  (e: "toggleOptionalStop"): void;
  (e: "toggleBlockDelete"): void;
  (e: "goToG30"): void;
  (e: "goToHome"): void;
  (e: "goToZero"): void;
  (e: "toggleTeleop"): void;
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

// Orientation gizmo (viewport overlay)
let _gizmoScene: THREE.Scene | null = null;
let _gizmoCam: THREE.OrthographicCamera | null = null;
const GIZMO_SIZE = 140; // pixels

// Transform groups (logical)
const groups: Record<string, THREE.Group> = {};
let workOrigin: THREE.Group | null = null;
let _workGrp: THREE.Group | null = null;   // resolved from init.workGroup
let _toolGrp: THREE.Group | null = null;   // resolved from init.toolGroup

// Normalize kinematics: accept legacy object form or new array form
type KinEntry = {
  group: string;
  joint: number;
  type?: "translate" | "rotate";
  direction?: "x" | "y" | "z";
  axis?: [number, number, number];
  sign: number;
};
function normalizeKinematics(kin: ViewerInit["kinematics"]): KinEntry[] {
  if (Array.isArray(kin)) return kin;
  // Legacy object form: { x: { axis: 0, sign: -1 }, ... }
  return Object.entries(kin).map(([key, v]) => ({
    group: key,
    joint: v.axis,
    type: "translate" as const,
    direction: key as "x" | "y" | "z",
    sign: v.sign,
  }));
}

// Visual objects
let toolMarker: THREE.Group | null = null;
let toolCutterMesh: THREE.Mesh | null = null;
let toolBodyMesh: THREE.Mesh | null = null;
let holderMesh: THREE.Mesh | null = null;
let _currentToolNum: number | null = null;
let _lastToolMeta: ToolMeta | null = null;
let feedLine: THREE.Line | null = null;
let rapidLine: THREE.Line | null = null;
let feedOverflow: THREE.Line | null = null;
let rapidOverflow: THREE.Line | null = null;
let highlightLine: THREE.Line | null = null;
let workAxes: THREE.Group | null = null;
let surfaceGroup: THREE.Group | null = null;

// Map g-code line number → { start, end } point-index range in feed arrays
let feedLineMap: Map<number, { start: number; end: number }> = new Map();

// Pending layer visibility: stores calls made before scene objects exist
let pendingLayers: Map<Layer, boolean> | null = new Map();
let toolpathVisible = true;
const toolpathOverflow = ref(false);
// Toolpath bounding box in work coordinates (set by applyGcode, used by updateOverflowCheck)
let toolpathBBox: { min: [number, number, number]; max: [number, number, number] } | null = null;

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

let machineBoundsMesh: THREE.Mesh | null = null;
let boundsLabels: THREE.Group | null = null;
const _billboardLabels: Text[] = [];
let workpieceMesh: THREE.Mesh | null = null;
let overflowEdges: THREE.LineSegments | null = null;
const boundsClipPlanes: THREE.Plane[] = [];
const _localBoundsPlanes: THREE.Plane[] = [];
let machineMeshes: THREE.Mesh[] = [];
let _machineEdgeLines: THREE.LineSegments[] = [];
let machineEdges = false;
let _groupDirMap: Record<string, string | null> = {};  // group → direction (x/y/z/null)
let _partGroupMap: Record<string, string | null> = {};  // partId → group

function mkTextLabel(text: string, color: string, fontSize: number): Text {
  const t = new Text();
  t.text = text;
  t.fontSize = fontSize;
  t.color = color;
  t.anchorX = "center";
  t.anchorY = "middle";
  t.outlineWidth = "4%";
  t.outlineColor = "#000000";
  t.depthWrite = false;
  t.sync();
  return t;
}

function buildGizmo() {
  _gizmoScene = new THREE.Scene();
  const al = 60, ah = al * 0.15, aw = al * 0.08;
  _gizmoScene.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), al, 0xff4444, ah, aw));
  _gizmoScene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), al, 0x44ff44, ah, aw));
  _gizmoScene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), al, 0x4488ff, ah, aw));

  const fs = al * 0.35;
  const lblOff = al * 1.15;
  for (const [text, color, pos] of [
    ["X", "#ff4444", [lblOff, 0, 0]],
    ["Y", "#44ff44", [0, lblOff, 0]],
    ["Z", "#4488ff", [0, 0, lblOff]],
  ] as [string, string, number[]][]) {
    const lbl = mkTextLabel(text, color, fs);
    lbl.position.set(pos[0]!, pos[1]!, pos[2]!);
    _gizmoScene.add(lbl);
  }

  _gizmoCam = new THREE.OrthographicCamera(-80, 80, 80, -80, 1, 500);
  _gizmoCam.up.set(0, 0, 1);
}

function resetBackplot() {
  backplotCount = 0;
  lastBackplotPt = null;

  if (backplotGeom && backplotPos) {
    // Keep allocation, just “empty” it
    backplotGeom.setDrawRange(0, 0);
    backplotGeom.attributes.position!.needsUpdate = true;
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

function setLayerVisible(layer: Layer, on: boolean) {
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
      if (feedOverflow) feedOverflow.visible = on;
      if (rapidOverflow) rapidOverflow.visible = on;
      if (highlightLine) highlightLine.visible = on;
      break;
    case "machine":
      for (const m of machineMeshes) m.visible = on;
      for (const e of _machineEdgeLines) e.visible = on && machineEdges;
      break;
    case "workpiece":
      if (workpieceMesh) workpieceMesh.visible = on;
      if (overflowEdges) overflowEdges.visible = on;
      break;
    case "bounds":
      if (machineBoundsMesh) machineBoundsMesh.visible = on;
      if (boundsLabels) boundsLabels.visible = on;
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
    case "surface":
      if (surfaceGroup) surfaceGroup.visible = on;
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
  for (const ol of [feedOverflow, rapidOverflow]) {
    if (ol) {
      const m = ol.material as THREE.LineDashedMaterial;
      m.depthTest = dt;
      m.depthWrite = dt;
      m.needsUpdate = true;
    }
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
  backplotGeom.attributes.position!.needsUpdate = true;
}



// Used to ignore late async loads after rebuild
let buildToken = 0;

// ---------- Materials (muted colors requested) ----------
const MAT = {
  tool: new THREE.MeshStandardMaterial({ metalness: 0.2, roughness: 0.4 }),
  cutter: new THREE.MeshStandardMaterial({ metalness: 0.2, roughness: 0.4 }),
  holder: new THREE.MeshStandardMaterial({ metalness: 0.7, roughness: 0.3 }),
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
MAT.tool.color.setHex(0xc0c0c0);  // silver shaft
MAT.cutter.color.setHex(0xffdd00); // gold cutter
MAT.holder.color.setHex(0x888888); // steel gray holder

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

function rebuildOverflowEdges(size: Vec3, offset: Vec3): THREE.LineSegments | null {
  if (boundsClipPlanes.length === 0) return null;
  const [sx, sy, sz] = size;
  if (sx <= 0 || sy <= 0 || sz <= 0) return null;
  const [ox, oy, oz] = offset;
  const geom = new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sy, sz));
  const mat = new THREE.LineDashedMaterial({
    color: 0xff4444,
    dashSize: 3,
    gapSize: 2,
    transparent: true,
    opacity: 0.8,
    clipIntersection: true,
    clippingPlanes: boundsClipPlanes,
  });
  const lines = new THREE.LineSegments(geom, mat);
  lines.computeLineDistances();
  lines.position.set(ox + sx / 2, oy + sy / 2, oz + sz / 2);
  return lines;
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

/** Yellow dashed duplicate of a toolpath line, clipped to show only outside machine bounds. */
function makeOverflowLine(srcLine: THREE.Line): THREE.Line | null {
  if (boundsClipPlanes.length === 0) return null;
  const geom = srcLine.geometry.clone();
  const mat = new THREE.LineDashedMaterial({
    color: 0xffcc00,
    dashSize: 3,
    gapSize: 2,
    transparent: true,
    opacity: 0.9,
    depthTest: !pathAlwaysOnTop,
    depthWrite: !pathAlwaysOnTop,
    clipIntersection: true,
    clippingPlanes: boundsClipPlanes,
  });
  const line = new THREE.Line(geom, mat);
  line.renderOrder = 10;
  line.frustumCulled = false;
  line.computeLineDistances();
  return line;
}


function ensureCoreGroups(init: ViewerInit) {
  if (!scene) return;

  // reset pointers
  for (const lbl of _billboardLabels) lbl.dispose();
  _billboardLabels.length = 0;
  workOrigin = null;
  workAxes = null;
  machineBoundsMesh = null;
  workpieceMesh = null;
  overflowEdges = null;
  machineMeshes = [];
  _machineEdgeLines = [];
  _edgesBuilt = false;
  _edgeBuildToken++;

  // Clear old group references
  for (const key of Object.keys(groups)) delete groups[key];

  groups.root = new THREE.Group();
  scene.add(groups.root);

  // Build groups from config (or legacy hardcoded fallback)
  const grpDefs = init.groups ?? [
    { id: "x", parent: "root" },
    { id: "y", parent: "root" },
    { id: "z", parent: "y" },
    { id: "tool", parent: "z" },
  ];
  for (const g of grpDefs) {
    groups[g.id] = new THREE.Group();
    // Static pivot offset (e.g. rotary axis center not at parent origin)
    if (g.translate) {
      const [x, y, z] = g.translate;
      groups[g.id]!.position.set(x * _unitScale, y * _unitScale, z * _unitScale);
    }
  }
  for (const g of grpDefs) {
    const parent = g.parent === "root" ? groups.root : groups[g.parent];
    (parent ?? groups.root).add(groups[g.id]!);
  }

  // Resolve work/tool group references
  _workGrp = groups[init.workGroup ?? grpDefs[0]?.id ?? "root"] ?? groups.root;
  _toolGrp = groups[init.toolGroup ?? "tool"] ?? groups.root;

  // Work origin (DRO zero frame) — attached to the work/table group
  workOrigin = new THREE.Group();
  _workGrp.add(workOrigin);

  // Work zero XYZ arrows with labels
  workAxes = new THREE.Group();
  const _al = 60 * _unitScale;
  const _ah = _al * 0.15, _aw = _al * 0.08;
  workAxes.add(new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(), _al, 0xff4444, _ah, _aw));
  workAxes.add(new THREE.ArrowHelper(new THREE.Vector3(0,1,0), new THREE.Vector3(), _al, 0x44ff44, _ah, _aw));
  workAxes.add(new THREE.ArrowHelper(new THREE.Vector3(0,0,1), new THREE.Vector3(), _al, 0x4488ff, _ah, _aw));

  const _lblOff = _al * 1.15;
  const _fs = _al * 0.5;
  for (const [text, color, pos] of [
    ["X", "#ff4444", [_lblOff, 0, 0]],
    ["Y", "#44ff44", [0, _lblOff, 0]],
    ["Z", "#4488ff", [0, 0, _lblOff]],
  ] as [string, string, number[]][]) {
    const lbl = mkTextLabel(text, color, _fs);
    lbl.position.set(pos[0]!, pos[1]!, pos[2]!);
    workAxes.add(lbl);
    _billboardLabels.push(lbl);
  }

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
  _workGrp!.add(backplotLine);

resetBackplot();


}

  // Default tool until viewer_state arrives — but skip if applyState already
  // built the real tool during the async gap (loadMachineAssets yield).
  if (_currentToolNum == null) {
    toolMarker = buildToolGroup(6 * _unitScale, 60 * _unitScale, null);
    _toolGrp!.add(toolMarker);
  }



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

    _workGrp!.add(machineBoundsMesh);
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

  // Apply tool colors
  MAT.tool.color.set(viewerDefaults.colors.tool ?? "#c0c0c0");
  MAT.cutter.color.set(viewerDefaults.colors.cutter ?? "#ffdd00");
}

// ---- Parametric tool profile generation ----
// Builds 2D outline (radius vs height) for THREE.LatheGeometry.
// Tip at Y=0, extends upward. LatheGeometry revolves around Y axis.
// Returns profile points and fluteY (Y coordinate where cutting flutes end).
function buildToolProfile(
  diam: number, len: number, meta: ToolMeta | null
): { pts: THREE.Vector2[], fluteY: number } {
  const r = Math.max(0.2, diam * 0.5);
  const type = meta?.type ?? "other";
  const fluteLen = meta?.flute_length ?? len * 0.6;
  const bodyLen = meta?.body_length ?? fluteLen;
  const shaftR = (meta?.shaft_diameter ?? diam) * 0.5;
  const oal = meta?.oal ?? len;
  const tipR = (meta?.tip_diameter ?? 0) * 0.5;
  const cornerR = meta?.corner_radius ?? 0;
  const pointAngle = meta?.point_angle ?? 118;
  const taperAngle = meta?.taper_angle ?? 45;

  const pts: THREE.Vector2[] = [];
  const V = (x: number, y: number) => new THREE.Vector2(Math.max(0, x), y);

  switch (type) {
    case "endmill":
    case "slotmill":
    case "threadmill": {
      pts.push(V(0, 0), V(r, 0), V(r, fluteLen));
      if (Math.abs(shaftR - r) > 0.01) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "ball": {
      const steps = 12;
      pts.push(V(0, 0));
      for (let i = 1; i <= steps; i++) {
        const a = (Math.PI / 2) * (1 - i / steps);
        pts.push(V(r * Math.cos(a), r - r * Math.sin(a)));
      }
      pts.push(V(r, fluteLen));
      if (Math.abs(shaftR - r) > 0.01) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "bullnose": {
      const cr = Math.min(cornerR || r * 0.2, r);
      const arcN = 8;
      const cylTop = Math.max(cr, bodyLen);
      pts.push(V(0, 0), V(r - cr, 0));
      for (let i = 1; i <= arcN; i++) {
        const a = (Math.PI / 2) * (i / arcN);
        pts.push(V(r - cr + cr * Math.sin(a), cr - cr * Math.cos(a)));
      }
      pts.push(V(r, cylTop));
      if (Math.abs(shaftR - r) > 0.01) pts.push(V(shaftR, cylTop));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "radiusmill": {
      const cr = cornerR || r * 0.2;
      const arcN = 8;
      const arcTop = r + cr; // arc endpoint radius = shaftR for standard radius mills
      const cylTop = Math.max(cr, bodyLen);
      // Narrow flat bottom at DC/2, concave 90° arc out to shaft
      pts.push(V(0, 0), V(r, 0));
      for (let i = 1; i <= arcN; i++) {
        const a = (Math.PI / 2) * (i / arcN);
        pts.push(V(r + cr * (1 - Math.cos(a)), cr * Math.sin(a)));
      }
      // Arc ends at (r+cr, cr) — continue shaft
      if (Math.abs(shaftR - arcTop) > 0.01) pts.push(V(shaftR, cr));
      pts.push(V(shaftR, cylTop));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "drill": {
      const halfA = (pointAngle / 2) * (Math.PI / 180);
      const tipH = r / Math.tan(halfA);
      pts.push(V(0, 0), V(r, tipH), V(r, fluteLen));
      if (Math.abs(shaftR - r) > 0.01) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "chamfer":
    case "countersink": {
      const chamA = taperAngle * (Math.PI / 180);
      const chamH = (r - tipR) / Math.tan(chamA || 1);
      pts.push(V(0, 0));
      if (tipR > 0.01) pts.push(V(tipR, 0));
      pts.push(V(r, chamH), V(r, fluteLen));
      if (Math.abs(shaftR - r) > 0.01) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "tapered": {
      pts.push(V(0, 0));
      if (tipR > 0.01) pts.push(V(tipR, 0));
      else pts.push(V(0.1, 0));
      pts.push(V(r, bodyLen), V(r, fluteLen));
      if (Math.abs(shaftR - r) > 0.01) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "dovetail": {
      const wideR = tipR > r ? tipR : r * 1.5;
      const neckR = Math.min(r, shaftR) * 0.5;
      pts.push(V(0, 0), V(wideR, 0), V(neckR, fluteLen));
      pts.push(V(shaftR, bodyLen), V(shaftR, oal), V(0, oal));
      break;
    }
    case "lollipop": {
      const ballR = r;
      const neckR2 = (tipR || shaftR || r * 0.4);
      const steps2 = 10;
      pts.push(V(0, 0));
      for (let i = 0; i <= steps2; i++) {
        const a = -Math.PI / 2 + Math.PI * (i / steps2);
        pts.push(V(ballR * Math.cos(a), ballR + ballR * Math.sin(a)));
      }
      pts.push(V(neckR2, ballR * 2), V(neckR2, fluteLen));
      if (Math.abs(shaftR - neckR2) > 0.01) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "facemill": {
      const discH = Math.max(5, bodyLen * 0.3);
      const arbor = shaftR || r * 0.3;
      pts.push(V(0, 0), V(r, 0), V(r, discH));
      pts.push(V(arbor, discH), V(arbor, oal), V(0, oal));
      break;
    }
    case "probe": {
      const probeR = tipR || r * 0.2;
      const probeLen = fluteLen || oal * 0.5;
      pts.push(V(0, 0), V(probeR, 0), V(probeR, probeLen));
      pts.push(V(shaftR || r, probeLen), V(shaftR || r, oal), V(0, oal));
      break;
    }
    case "formmill": {
      const profile = meta?.profile;
      if (profile && profile.length >= 2) {
        let px = 0, py = 0;
        for (const seg of profile) {
          const [ex, ey] = seg.end;
          if (seg.arc && seg.center) {
            const [cx, cy] = seg.center;
            const arcR = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
            const startA = Math.atan2(py - cy, px - cx);
            const endA = Math.atan2(ey - cy, ex - cx);
            let sweep = endA - startA;
            if (seg.ccw && sweep < 0) sweep += 2 * Math.PI;
            if (!seg.ccw && sweep > 0) sweep -= 2 * Math.PI;
            const steps = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
            for (let i = 1; i <= steps; i++) {
              const a = startA + sweep * (i / steps);
              pts.push(V(cx + arcR * Math.cos(a), cy + arcR * Math.sin(a)));
            }
          } else {
            const dx = ex - px, dy = ey - py;
            if (dx * dx + dy * dy > 0.001) pts.push(V(ex, ey));
          }
          px = ex; py = ey;
        }
      } else {
        pts.push(V(0, 0), V(r, 0), V(r, oal), V(0, oal));
      }
      break;
    }
    default: {
      pts.push(V(0, 0), V(r, 0), V(r, oal), V(0, oal));
      break;
    }
  }
  return { pts, fluteY: fluteLen };
}

/** Split a profile at the given Y coordinate into cutter (below) and shaft (above) sub-profiles */
function splitProfileAt(pts: THREE.Vector2[], splitY: number): { cutter: THREE.Vector2[], shaft: THREE.Vector2[] } {
  const eps = 0.01;
  const below: THREE.Vector2[] = [];
  const atBound: THREE.Vector2[] = [];
  const above: THREE.Vector2[] = [];
  let interpPt: THREE.Vector2 | null = null;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (p.y < splitY - eps) {
      below.push(p.clone());
      const next = pts[i + 1];
      if (next && next.y > splitY + eps) {
        const t = (splitY - p.y) / (next.y - p.y);
        interpPt = new THREE.Vector2(Math.max(0, p.x + t * (next.x - p.x)), splitY);
      }
    } else if (Math.abs(p.y - splitY) <= eps) {
      atBound.push(p.clone());
    } else {
      above.push(p.clone());
    }
  }

  // Cutter: below + interpolated boundary + first boundary point + close at axis
  const cutter = [...below];
  if (interpPt) cutter.push(interpPt);
  if (atBound.length > 0) cutter.push(atBound[0]!);
  const edgeR = cutter.length > 0 ? cutter[cutter.length - 1]!.x : 0;
  if (edgeR > eps) cutter.push(new THREE.Vector2(0, splitY));

  // Shaft: axis at splitY + remaining boundary points + above
  const shaft: THREE.Vector2[] = [new THREE.Vector2(0, splitY)];
  if (atBound.length > 1) {
    for (let i = 1; i < atBound.length; i++) shaft.push(atBound[i]!);
  } else if (above.length > 0) {
    const r = interpPt ? interpPt.x : edgeR;
    if (r > eps) shaft.push(new THREE.Vector2(r, splitY));
  }
  shaft.push(...above);

  return { cutter, shaft };
}

/** Build LatheGeometry from 2D profile, rotated to Z-up with tip at Z=0 */
function buildToolGeometry(profile: THREE.Vector2[], segments = 24): THREE.LatheGeometry {
  const geom = new THREE.LatheGeometry(profile, segments);
  geom.rotateX(Math.PI / 2);
  return geom;
}

/** Build holder geometry from stacked frustum segments, starting at Z=toolOAL */
function buildHolderGeometry(
  segments: HolderSegment[], toolOAL: number, latheSegments = 24
): THREE.LatheGeometry | null {
  if (!segments.length) return null;
  const pts: THREE.Vector2[] = [];
  let z = toolOAL;
  pts.push(new THREE.Vector2(0, z));
  for (const seg of segments) {
    pts.push(new THREE.Vector2(seg.lower_diameter * 0.5, z));
    z += seg.height;
    pts.push(new THREE.Vector2(seg.upper_diameter * 0.5, z));
  }
  pts.push(new THREE.Vector2(0, z));
  const geom = new THREE.LatheGeometry(pts, latheSegments);
  geom.rotateX(Math.PI / 2);
  return geom;
}

/** Build full tool group (cutter + shaft + optional holder) */
function buildToolGroup(diam: number, len: number, meta: ToolMeta | null): THREE.Group {
  const grp = new THREE.Group();
  const { pts, fluteY } = buildToolProfile(diam, len, meta);
  const { cutter, shaft } = splitProfileAt(pts, fluteY);

  toolCutterMesh = null;
  if (cutter.length >= 3) {
    toolCutterMesh = new THREE.Mesh(buildToolGeometry(cutter), MAT.cutter);
    grp.add(toolCutterMesh);
  }
  toolBodyMesh = null;
  if (shaft.length >= 3) {
    toolBodyMesh = new THREE.Mesh(buildToolGeometry(shaft), MAT.tool);
    grp.add(toolBodyMesh);
  }

  holderMesh = null;
  if (meta?.holder_segments?.length) {
    const oal = meta.oal ?? len;
    const hGeom = buildHolderGeometry(meta.holder_segments, oal);
    if (hGeom) {
      holderMesh = new THREE.Mesh(hGeom, MAT.holder);
      grp.add(holderMesh);
    }
  }
  return grp;
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

    ensureCoreGroups(init);
    // Apply machine bounds from viewer_init (INI-derived)
    const mb = init.machine_bounds;
    if (machineBoundsMesh && mb?.size && mb?.origin) {
      applyBox(machineBoundsMesh, mb.size as Vec3, mb.origin as Vec3);

      // Build clipping planes for overflow visualization (normals point outward)
      // Stored in _workGrp local space; transformed to world space each frame in animate()
      const [bx, by, bz] = mb.origin as Vec3;
      const [bsx, bsy, bsz] = mb.size as Vec3;
      if (bsx > 0 && bsy > 0 && bsz > 0) {
        _localBoundsPlanes.length = 0;
        _localBoundsPlanes.push(
          new THREE.Plane(new THREE.Vector3(-1, 0, 0),  bx),
          new THREE.Plane(new THREE.Vector3( 1, 0, 0), -(bx + bsx)),
          new THREE.Plane(new THREE.Vector3(0, -1, 0),  by),
          new THREE.Plane(new THREE.Vector3(0,  1, 0), -(by + bsy)),
          new THREE.Plane(new THREE.Vector3(0, 0, -1),  bz),
          new THREE.Plane(new THREE.Vector3(0, 0,  1), -(bz + bsz)),
        );
        boundsClipPlanes.length = 0;
        for (const p of _localBoundsPlanes) boundsClipPlanes.push(p.clone());

        // Overflow outline (workpiece parts outside machine bounds)
        overflowEdges = rebuildOverflowEdges(props.workpieceSize, props.workpieceOffset);
        if (overflowEdges && workOrigin) workOrigin.add(overflowEdges);
      }

      // Dimension labels along bottom edges
      if (boundsLabels) {
        boundsLabels.traverse((c: any) => { if (c.dispose) { c.dispose(); _billboardLabels.splice(_billboardLabels.indexOf(c), 1); } });
        _workGrp!.remove(boundsLabels);
        boundsLabels = null;
      }
      boundsLabels = new THREE.Group();
      const [sx, sy, sz] = mb.size as Vec3;
      const [ox, oy, oz] = mb.origin as Vec3;
      const unit = (init.units === "in" || init.units === "inch") ? "in" : "mm";
      const boundsFs = Math.min(sx, sy, sz) * 0.12;
      const axes: [string, number, THREE.Vector3, string][] = [
        ["X", sx, new THREE.Vector3(ox + sx / 2, oy, oz), "#ff4444"],
        ["Y", sy, new THREE.Vector3(ox, oy + sy / 2, oz), "#44ff44"],
        ["Z", sz, new THREE.Vector3(ox, oy, oz + sz / 2), "#4488ff"],
      ];
      for (const [name, size, pos, color] of axes) {
        const lbl = mkTextLabel(`${name}: ${size.toFixed(0)} ${unit}`, color, boundsFs);
        lbl.position.copy(pos);
        boundsLabels.add(lbl);
        _billboardLabels.push(lbl);
      }
      _workGrp!.add(boundsLabels);
    } else {
      console.warn("No machine_bounds in viewer_init; bounds box will remain default");
    }

    // Load all STL assets via the central cache (first caller fetches, others await same Promise)
    await loadMachineAssets(init);
    if (myToken !== buildToken) return;

    // Build group → material map from kinematics direction
    const kinEntries = normalizeKinematics(init.kinematics);
    const dirMat: Record<string, THREE.MeshStandardMaterial> = { x: MAT.axisX, y: MAT.axisY, z: MAT.axisZ };
    const groupMat: Record<string, THREE.MeshStandardMaterial> = {};
    _groupDirMap = {};
    _partGroupMap = {};
    for (const k of kinEntries) {
      groupMat[k.group] = (k.direction ? dirMat[k.direction] : null) ?? MAT.frame;
      _groupDirMap[k.group] = k.direction ?? null;
    }

    const parts = init.parts ?? [];
    for (const p of parts) {
      const geom = getCachedGeometry(p.id);
      if (!geom) { console.warn(`No cached geometry for ${p.id}`); continue; }

      const grp = p.group ?? p.parent ?? null;  // support both new and legacy field names
      _partGroupMap[p.id] = grp;
      let mat: THREE.MeshStandardMaterial = (grp ? groupMat[grp] : null) ?? MAT.frame;

      // Per-part color override from settings
      const customColor = viewerDefaults.machineColors[p.id];
      if (customColor) {
        mat = mat.clone();
        mat.color.set(customColor);
      }

      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData.partId = p.id;  // tag for live color updates
      const t = p.translate ?? p.t;
      if (t) mesh.position.set(t[0] * _unitScale, t[1] * _unitScale, t[2] * _unitScale);
      const r = p.rotate ?? p.r;
      if (r) mesh.rotation.set(r[0], r[1], r[2]);
      mesh.scale.setScalar(_unitScale);  // convert mm STL geometry → machine-unit world

      const parent = (grp ? groups[grp] : groups.root) ?? groups.root!;
      parent.add(mesh);
      machineMeshes.push(mesh);
    }

    // Auto-frame to machine work envelope — use raw INI data (not setFromObject) so
    // the frame is immune to axis movement that may have shifted axis groups above.
    // Falls back to STL mesh world bounds if no bounds data present.
    {
      let autoBox = new THREE.Box3();
      const mb = init.machine_bounds;
      if (mb?.size && mb?.origin) {
        const [ox, oy, oz] = mb.origin as [number, number, number];
        const [sx, sy, sz] = mb.size as [number, number, number];
        autoBox.set(new THREE.Vector3(ox, oy, oz),
                    new THREE.Vector3(ox + sx, oy + sy, oz + sz));
      } else if (machineMeshes.length > 0) {
        for (const m of machineMeshes) autoBox.expandByObject(m);
      }
      _iniBox = autoBox.clone();
      frameToBounds(autoBox);
      _needsReframe = true;

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

    // If edge mode is active, lazily build edges now that meshes exist
    if (machineEdges) buildEdgesLazy();

  } catch (err) {
    console.error("buildFromInit failed:", err);
    (window as any).__viewerDiag = { ready: false, error: (err as Error).message };
  }
}

function applyState(init: ViewerInit, st: ViewerState) {
  // Drive machine axes from JOINT positions (spindle nose / carriage reference)
  const jp = st.joint_pos;
  if (!jp) return;

  if (!_workGrp || !_toolGrp) return;

  const kinEntries = normalizeKinematics(init.kinematics);
  const ax = (idx: number) => (idx >= 0 && idx < jp.length ? jp[idx]! : 0);

  // Apply kinematics: each entry drives a group's position or rotation
  for (const k of kinEntries) {
    const g = groups[k.group];
    if (!g) continue;
    const val = ax(k.joint) * (k.sign ?? 1);
    if (k.type === "rotate") {
      const rad = THREE.MathUtils.degToRad(val);
      if (k.axis) {
        // Arbitrary rotation axis (Phase 2: nutating spindles, etc.)
        const axisVec = new THREE.Vector3(...k.axis).normalize();
        g.quaternion.setFromAxisAngle(axisVec, rad);
      } else if (k.direction) {
        // Standard rotation around cartesian axis (A/B/C)
        g.rotation[k.direction] = rad;
      }
    } else {
      // Translation (default)
      if (k.direction) g.position[k.direction] = val;
    }
  }

  // Tool spatial compensation:
  // Put the tool TIP at TCP by moving the tool group by -tool_offset relative to spindle nose.
  const tofs = st.tool_offset;
  if (tofs && tofs.length >= 3) {
    _toolGrp.position.set(-(tofs[0] ?? 0), -(tofs[1] ?? 0), -(tofs[2] ?? 0));
  } else {
    _toolGrp.position.set(0, 0, 0);
  }

  // Work origin offset: place DRO/work zero in machine space.
  const g5x = st.g5x_offset ?? [];
  const g92 = st.g92_offset ?? [];

  const ox = (g5x[0] ?? 0) + (g92[0] ?? 0);
  const oy = (g5x[1] ?? 0) + (g92[1] ?? 0);
  const oz = (g5x[2] ?? 0) + (g92[2] ?? 0);

  if (workOrigin) {
    workOrigin.position.set(ox, oy, oz);
    updateOverflowCheck();
  }

  // ---- Tool visual: parametric profile (TIP stays at local z=0) ----
  {
    const toolNum = st.tool_number ?? null;
    const meta: ToolMeta | null = st.tool_meta ?? null;
    const diam = st.tool_diameter ?? 6.0 * _unitScale;
    const rawLen = st.tool_length ?? 60.0 * _unitScale;
    const sinkIntoHolder = 20 * _unitScale;
    const minVisualLen = 40 * _unitScale;
    const visLen = Math.max(minVisualLen, rawLen + sinkIntoHolder);

    if (toolNum !== _currentToolNum && _toolGrp) {
      // Tool number changed — full rebuild with metadata
      _currentToolNum = toolNum;
      if (meta) {
        _lastToolMeta = meta;
        if (toolNum != null) _toolMetaCache.set(toolNum, meta);
      } else if (toolNum != null) {
        // Status didn't include tool_meta (only sent on tool change);
        // fall back to the shared cache populated by another viewer instance.
        _lastToolMeta = _toolMetaCache.get(toolNum) ?? null;
      }

      if (toolMarker) {
        _toolGrp.remove(toolMarker);
        disposeObject(toolMarker);
        toolCutterMesh = null;
        toolBodyMesh = null;
        holderMesh = null;
      }
      toolMarker = buildToolGroup(diam, visLen, _lastToolMeta);
      _toolGrp.add(toolMarker);
      const visMesh = toolBodyMesh ?? toolCutterMesh;
      if (visMesh) visMesh.userData.toolVis = { r: diam * 0.5, L: visLen };

    } else if (toolBodyMesh || toolCutterMesh) {
      // Check if tool_meta changed (e.g. shaft_diameter edited in tool table)
      if (meta && JSON.stringify(meta) !== JSON.stringify(_lastToolMeta)) {
        _lastToolMeta = meta;
        if (toolNum != null) _toolMetaCache.set(toolNum, meta);
        // Full rebuild with new metadata
        if (toolMarker) {
          _toolGrp!.remove(toolMarker);
          disposeObject(toolMarker);
          toolCutterMesh = null;
          toolBodyMesh = null;
          holderMesh = null;
        }
        toolMarker = buildToolGroup(diam, visLen, _lastToolMeta);
        _toolGrp!.add(toolMarker);
        const visMesh = toolBodyMesh ?? toolCutterMesh;
        if (visMesh) visMesh.userData.toolVis = { r: diam * 0.5, L: visLen };
      } else {
        // Same tool, same meta — rebuild geometry only if diam/length changed
        const r = Math.max(0.2, diam * 0.5);
        const visMesh = toolBodyMesh ?? toolCutterMesh;
        const prev = (visMesh!.userData.toolVis as any) || {};
        const changed = Math.abs((prev.r ?? 0) - r) > 0.01
                     || Math.abs((prev.L ?? 0) - visLen) > 0.5;
        if (changed) {
          const { pts, fluteY } = buildToolProfile(diam, visLen, _lastToolMeta);
          const { cutter, shaft } = splitProfileAt(pts, fluteY);
          if (toolCutterMesh && cutter.length >= 3) {
            toolCutterMesh.geometry.dispose();
            toolCutterMesh.geometry = buildToolGeometry(cutter);
          }
          if (toolBodyMesh && shaft.length >= 3) {
            toolBodyMesh.geometry.dispose();
            toolBodyMesh.geometry = buildToolGeometry(shaft);
          }
          visMesh!.userData.toolVis = { r, L: visLen };
        }
      }
    }
  }


  
  // ---- Backplot update (use WORK tool-tip position directly) ----
  const curLine = typeof st.motion_line === "number" ? st.motion_line : null;

  // Append the actual rendered tool tip position, expressed in work group local space.
  // This guarantees the backplot starts exactly at the tooltip (independent of joint_pos vs machine_pos nuances).
  if (toolMarker && _workGrp) {
    const w = new THREE.Vector3();
    toolMarker.getWorldPosition(w);

    const xl = _workGrp.worldToLocal(w.clone());
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

/** Check if stored toolpath bbox exceeds machine bounds (in current WCS). */
function updateOverflowCheck() {
  toolpathOverflow.value = false;
  if (!toolpathBBox || !workOrigin) return;
  const mb = (viewerInit.value as ViewerInit | null)?.machine_bounds;
  if (!mb) return;
  const wo = workOrigin.position;
  // Machine bounds converted to work coordinates
  const bMin0 = mb.origin[0] - wo.x, bMin1 = mb.origin[1] - wo.y, bMin2 = mb.origin[2] - wo.z;
  const bMax0 = bMin0 + mb.size[0], bMax1 = bMin1 + mb.size[1], bMax2 = bMin2 + mb.size[2];
  // Any part of toolpath bbox outside machine bounds?
  toolpathOverflow.value =
    toolpathBBox.min[0] < bMin0 || toolpathBBox.max[0] > bMax0 ||
    toolpathBBox.min[1] < bMin1 || toolpathBBox.max[1] > bMax1 ||
    toolpathBBox.min[2] < bMin2 || toolpathBBox.max[2] > bMax2;
}

function applyGcode(g: ViewerGcode) {
  if (!scene || !workOrigin) return;

  // Remove old lines
  for (const old of [feedLine, rapidLine, feedOverflow, rapidOverflow, highlightLine]) {
    if (old) { workOrigin.remove(old); disposeObject(old); }
  }
  feedLine = rapidLine = feedOverflow = rapidOverflow = highlightLine = null;
  feedLineMap = new Map();

  const feedPts = g.feed ?? [];
  const feedLines = g.feed_lines ?? [];
  const rapidPts = g.rapid ?? [];

  // Build line-number → point-index range map
  for (let i = 0; i < feedLines.length; i++) {
    const ln = feedLines[i]!;
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
    feedOverflow = makeOverflowLine(feedLine);
    if (feedOverflow) workOrigin.add(feedOverflow);
  }
  if (rapidPts.length >= 2) {
    rapidLine = makeLine(rapidPts, rapidColor, true, toolpathOp);
    workOrigin.add(rapidLine);
    rapidOverflow = makeOverflowLine(rapidLine);
    if (rapidOverflow) workOrigin.add(rapidOverflow);
  }

  // Prepare highlight line (reuses feed geometry, drawn on top with bright color)
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

  // Compute toolpath bounding box (work coordinates) for overflow detection
  toolpathBBox = null;
  const allPts = [...feedPts, ...rapidPts];
  if (allPts.length > 0) {
    const mn: [number, number, number] = [Infinity, Infinity, Infinity];
    const mx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const p of allPts) {
      if (p[0]! < mn[0]) mn[0] = p[0]!; if (p[0]! > mx[0]) mx[0] = p[0]!;
      if (p[1]! < mn[1]) mn[1] = p[1]!; if (p[1]! > mx[1]) mx[1] = p[1]!;
      if (p[2]! < mn[2]) mn[2] = p[2]!; if (p[2]! > mx[2]) mx[2] = p[2]!;
    }
    toolpathBBox = { min: mn, max: mx };
  }
  updateOverflowCheck();

  // Apply stored toolpath visibility (may have been set before lines existed)
  if (!toolpathVisible) {
    if (feedLine) feedLine.visible = false;
    if (rapidLine) rapidLine.visible = false;
    if (feedOverflow) feedOverflow.visible = false;
    if (rapidOverflow) rapidOverflow.visible = false;
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
let _needsReframe = false;
let _iniBox: THREE.Box3 | null = null;

function animate() {
  if (props.active === false) return; // paused — don't schedule next frame
  raf = requestAnimationFrame(animate);

  // Apply pending state before render (natural frame dropping —
  // if multiple status updates arrive between frames, only the latest is used)
  if (pendingState && viewerInit.value) {
    applyState(viewerInit.value as ViewerInit, pendingState as ViewerState);
    pendingState = null;

    // Re-frame after first status update so camera accounts for actual axis positions
    if (_needsReframe && _iniBox && _workGrp) {
      _needsReframe = false;
      const box = _iniBox.clone().translate(_workGrp.position);
      frameToBounds(box);
    }
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

  // Update overflow clipping planes to track _workGrp world transform
  if (_localBoundsPlanes.length > 0 && _localBoundsPlanes.length === boundsClipPlanes.length && _workGrp) {
    _workGrp.updateMatrixWorld();
    for (let i = 0; i < _localBoundsPlanes.length; i++) {
      boundsClipPlanes[i]!.copy(_localBoundsPlanes[i]!);
      boundsClipPlanes[i]!.applyMatrix4(_workGrp.matrixWorld);
    }
  }

  // Billboard text labels — face camera each frame
  if (camera) {
    for (const lbl of _billboardLabels) lbl.quaternion.copy(camera.quaternion);
  }

  controls?.update();
  renderer?.render(scene!, camera!);

  // Orientation gizmo — always ortho, render into bottom-left viewport
  if (renderer && _gizmoScene && _gizmoCam && camera) {
    _gizmoCam.position.set(0, 0, 200).applyQuaternion(camera.quaternion);
    _gizmoCam.quaternion.copy(camera.quaternion);

    // Billboard gizmo labels
    _gizmoScene.traverse((c: any) => { if (c instanceof Text) c.quaternion.copy(_gizmoCam!.quaternion); });

    const px = renderer.getPixelRatio();
    const gx = 8 * px, gy = 60 * px, gs = GIZMO_SIZE * px;
    renderer.setViewport(gx, gy, gs, gs);
    renderer.setScissor(gx, gy, gs, gs);
    renderer.setScissorTest(true);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(_gizmoScene, _gizmoCam);
    renderer.setScissorTest(false);
    renderer.autoClear = true;
    const el = renderer.domElement;
    renderer.setViewport(0, 0, el.width, el.height);
  }
}

watch(isDark, () => {
  if (scene) scene.background = sceneBgFromTheme();
});

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
  renderer.localClippingEnabled = true;

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

  resizeObs = new ResizeObserver(() => resize());
  resizeObs.observe(host.value!);

  buildGizmo();

  resize();
  animate();

  // viewerInit / viewerGcode may already be set before this component mounted
  // (e.g. dynamically-added panels after WebSocket connected).
  // The immediate watcher fires during setup (before scene exists) and bails,
  // so we must call buildFromInit here now that scene is ready.
  if (viewerInit.value) buildFromInit(viewerInit.value as ViewerInit);
  if (viewerGcode.value) applyGcode(viewerGcode.value as ViewerGcode);

  // Apply saved defaults (self-contained — no external wiring needed)
  for (const layer of ALL_LAYERS) setLayerVisible(layer, viewerDefaults.layers[layer]);
  setTrackingMode(viewerDefaults.trackingMode);
  setPathAlwaysOnTop(viewerDefaults.pathOnTop);
  machineEdges = viewerDefaults.machineEdges;  // set flag; lazy build triggers in buildFromInit
  if (viewerDefaults.projection === "parallel") switchProjection();
});

onUnmounted(() => {
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
  // Dispose troika text labels
  for (const lbl of _billboardLabels) lbl.dispose();
  _billboardLabels.length = 0;

  // Dispose gizmo
  if (_gizmoScene) {
    _gizmoScene.traverse((c: any) => { if (c.dispose) c.dispose(); });
    _gizmoScene = null;
  }
  _gizmoCam = null;

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
// flush: 'post' ensures DOM (v-show) has updated before we resize
watch(() => props.active, (now) => {
  if (now !== false && renderer) {
    resize();
    animate();
  } else {
    cancelAnimationFrame(raf);
  }
}, { flush: 'post' });

// Buffer latest status for rAF consumption (frame dropping)
// Always buffer even when hidden so state is ready when viewer becomes active.
// Also cache tool_meta in the shared cache — gateway sends it only once per
// tool change, so we must grab it here before pendingState gets overwritten.
watch(
  () => status.value,
  (msg) => {
    if (!msg?.data) return;
    pendingState = msg.data;
    if (msg.data.tool_meta && msg.data.tool_number != null) {
      _toolMetaCache.set(msg.data.tool_number, msg.data.tool_meta);
    }
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
    if (overflowEdges && workOrigin) {
      workOrigin.remove(overflowEdges);
      disposeObject(overflowEdges);
    }
    overflowEdges = rebuildOverflowEdges(props.workpieceSize, props.workpieceOffset);
    if (overflowEdges && workOrigin) workOrigin.add(overflowEdges);
  },
  { deep: true }
);


// Format coordinate for HUD display
const HUD_ROTARY = new Set(["A", "B", "C"]);
function formatCoord(val: number | null | undefined, axisLetter?: string): string {
  if (val == null) return '---';
  if (axisLetter && HUD_ROTARY.has(axisLetter)) return val.toFixed(2) + "°";
  return val.toFixed(3);
}

const hudAxes = computed(() => props.axes ?? ["X", "Y", "Z"]);

const PRIMARY = new Set(["X", "Y", "Z"]);
const ABC = new Set(["A", "B", "C"]);
const UVW = new Set(["U", "V", "W"]);

interface HudAxisEntry { letter: string; index: number }

const hudPrimary = computed<HudAxisEntry[]>(() =>
  hudAxes.value.map((l, i) => ({ letter: l, index: i })).filter(a => PRIMARY.has(a.letter))
);
const hudAbc = computed<HudAxisEntry[]>(() =>
  hudAxes.value.map((l, i) => ({ letter: l, index: i })).filter(a => ABC.has(a.letter))
);
const hudUvw = computed<HudAxisEntry[]>(() =>
  hudAxes.value.map((l, i) => ({ letter: l, index: i })).filter(a => UVW.has(a.letter))
);

// ─── Surface map layer ──────────────────────────────────────────

function viridis(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  const c: [number, number, number][] = [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]];
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

function idwInterp(px: number, py: number, points: [number, number, number][], power = 2): number {
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

function buildSurfaceLayer(pts: [number, number, number][]) {
  if (!scene || !workOrigin) return;

  // Remove previous
  if (surfaceGroup) {
    surfaceGroup.parent?.remove(surfaceGroup);
    surfaceGroup.traverse((o: any) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    surfaceGroup = null;
  }

  if (!pts || pts.length < 3) return;

  surfaceGroup = new THREE.Group();

  // Compute bounds
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (const p of pts) {
    if (p[0] < xMin) xMin = p[0]; if (p[0] > xMax) xMax = p[0];
    if (p[1] < yMin) yMin = p[1]; if (p[1] > yMax) yMax = p[1];
    if (p[2] < zMin) zMin = p[2]; if (p[2] > zMax) zMax = p[2];
  }
  const xRange = xMax - xMin || 1, yRange = yMax - yMin || 1, zRange = zMax - zMin || 0.001;

  // Create interpolated grid at 1:1 WCS scale
  const res = 30;
  const geom = new THREE.PlaneGeometry(xRange, yRange, res - 1, res - 1);
  const colors: number[] = [];
  const posArr = geom.attributes.position!;
  for (let i = 0; i < posArr.count; i++) {
    // PlaneGeometry vertices are in local space centered at origin
    const gx = posArr.getX(i) + xRange / 2 + xMin;
    const gy = posArr.getY(i) + yRange / 2 + yMin;
    const gz = idwInterp(gx, gy, pts);
    // Set Z at real WCS height (1:1 scale)
    posArr.setZ(i, gz);
    // Set XY at real WCS positions
    posArr.setX(i, gx);
    posArr.setY(i, gy);
    const t = (gz - zMin) / zRange;
    const [r, g, b] = viridis(t);
    colors.push(r / 255, g / 255, b / 255);
  }
  geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geom.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
  });
  surfaceGroup.add(new THREE.Mesh(geom, mat));

  // Add probe point dots
  const dotR = Math.min(xRange, yRange) * 0.012;
  const dotGeom = new THREE.SphereGeometry(dotR, 8, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
  for (const p of pts) {
    const dot = new THREE.Mesh(dotGeom, dotMat);
    dot.position.set(p[0], p[1], p[2]);
    surfaceGroup.add(dot);
  }

  // Add to work coordinate origin (same parent as workpiece/backplot)
  workOrigin.add(surfaceGroup);

  // Respect current layer visibility
  if (pendingLayers?.has("surface")) {
    surfaceGroup.visible = pendingLayers.get("surface")!;
  }
}

watch(() => props.surfacePoints, (pts) => {
  buildSurfaceLayer(pts ?? []);
});

/** Live-update a machine part's color without rebuilding the scene.
 *  Pass `null` as color to revert to the built-in default. */
function setMachinePartColor(partId: string, color: string | null) {
  const dirColorMap: Record<string, number> = { x: 0x9b4a4a, y: 0x4a8f5a, z: 0x4a6f9b };
  const grp = _partGroupMap[partId];
  const dir = grp ? _groupDirMap[grp] : null;
  const defaultHex = (dir ? dirColorMap[dir] : null) ?? 0xbfbfbf;

  for (const mesh of machineMeshes) {
    if (mesh.userData.partId !== partId) continue;
    const mat = (mesh.material as THREE.MeshStandardMaterial);
    if (color) {
      if (!mat.userData._clonedFor || mat.userData._clonedFor !== partId) {
        const cloned = mat.clone();
        cloned.userData._clonedFor = partId;
        mesh.material = cloned;
        cloned.color.set(color);
      } else {
        mat.color.set(color);
      }
    } else if (mat.userData._clonedFor) {
      mat.color.setHex(defaultHex);
    }
  }
  // Sync edge line colors
  for (const edge of _machineEdgeLines) {
    if (edge.userData.partId !== partId) continue;
    (edge.material as THREE.LineBasicMaterial).color.set(color ?? defaultHex);
  }
}

/** Build edge lines off-thread via Web Worker to avoid blocking the UI. */
let _edgeBuildToken = 0;
let _edgesBuilt = false;
let _edgeWorker: Worker | null = null;

function getEdgeWorker(): Worker {
  if (!_edgeWorker) {
    _edgeWorker = new Worker(new URL("./edgeWorker.ts", import.meta.url), { type: "module" });
  }
  return _edgeWorker;
}

function computeEdgesOffThread(geom: THREE.BufferGeometry, partId: string): Promise<Float32Array> {
  return new Promise((resolve) => {
    const worker = getEdgeWorker();
    const handler = (e: MessageEvent) => {
      if (e.data.id === partId) {
        worker.removeEventListener("message", handler);
        resolve(new Float32Array(e.data.positions));
      }
    };
    worker.addEventListener("message", handler);

    const srcPos = geom.attributes.position!.array as Float32Array;
    const srcIdx = geom.index?.array as Uint32Array | undefined;
    const posCopy = new Float32Array(srcPos);
    const idxCopy = srcIdx ? new Uint32Array(srcIdx) : null;
    const transfer: ArrayBuffer[] = [posCopy.buffer];
    if (idxCopy) transfer.push(idxCopy.buffer);

    worker.postMessage({ id: partId, positions: posCopy, index: idxCopy, threshold: 30 }, transfer);
  });
}

async function buildEdgesLazy() {
  if (_edgesBuilt) return;
  const token = ++_edgeBuildToken;

  for (const mesh of machineMeshes) {
    if (token !== _edgeBuildToken) return;
    const partId = mesh.userData.partId as string;

    const edgePositions = await computeEdgesOffThread(mesh.geometry, partId);
    if (token !== _edgeBuildToken) return;

    const edgesGeom = new THREE.BufferGeometry();
    edgesGeom.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const edgeMat = new THREE.LineBasicMaterial({ color: mat.color.clone() });
    const edgeLine = new THREE.LineSegments(edgesGeom, edgeMat);
    edgeLine.position.copy(mesh.position);
    edgeLine.rotation.copy(mesh.rotation);
    edgeLine.scale.copy(mesh.scale);
    edgeLine.userData.partId = partId;
    edgeLine.visible = machineEdges;
    mesh.parent?.add(edgeLine);
    _machineEdgeLines.push(edgeLine);
  }
  if (token === _edgeBuildToken) _edgesBuilt = true;
}

/** Toggle CAD-like edge outline mode for machine STLs. */
function setMachineEdges(on: boolean) {
  machineEdges = on;
  if (on && !_edgesBuilt) {
    buildEdgesLazy();
  } else {
    for (const e of _machineEdgeLines) e.visible = on;
  }
}

function setToolColors(toolColor: string | null, cutterColor: string | null) {
  if (toolColor) MAT.tool.color.set(toolColor);
  if (cutterColor) MAT.cutter.color.set(cutterColor);
}

defineExpose({
  resetBackplot,
  setView,
  setLayerVisible,
  setPathAlwaysOnTop,
  setTrackingMode,
  switchProjection,
  isOrtho,
  setMachinePartColor,
  setMachineEdges,
  setToolColors,
});


</script>

<template>
  <div class="viewerWrapper">
    <div ref="host" class="viewerHost" />

    <!-- HUD Overlay -->
    <div v-show="hudVisible" class="hud" :style="{ opacity: viewerDefaults.opacities.hud ?? 1 }">
      <div class="hudSection">
        <div class="label">Work Position ({{ props.g5xLabel || '-' }})</div>
        <div class="hudCoords">
          <div class="hudCol">
            <div v-for="a in hudPrimary" :key="'w'+a.letter" class="hudCoord">
              <span class="hudAxis">{{ a.letter }}</span> {{ formatCoord(vst?.work_pos?.[a.index], a.letter) }}
            </div>
          </div>
          <div v-if="hudAbc.length" class="hudCol">
            <div v-for="a in hudAbc" :key="'w'+a.letter" class="hudCoord">
              <span class="hudAxis">{{ a.letter }}</span> {{ formatCoord(vst?.work_pos?.[a.index], a.letter) }}
            </div>
          </div>
          <div v-if="hudUvw.length" class="hudCol">
            <div v-for="a in hudUvw" :key="'w'+a.letter" class="hudCoord">
              <span class="hudAxis">{{ a.letter }}</span> {{ formatCoord(vst?.work_pos?.[a.index], a.letter) }}
            </div>
          </div>
        </div>
      </div>

      <div class="hudSection">
        <div class="label">Machine Position</div>
        <div class="hudCoords">
          <div class="hudCol">
            <div v-for="a in hudPrimary" :key="'m'+a.letter" class="hudCoord">
              <span class="hudAxis">{{ a.letter }}</span> {{ formatCoord(vst?.machine_pos?.[a.index], a.letter) }}
            </div>
          </div>
          <div v-if="hudAbc.length" class="hudCol">
            <div v-for="a in hudAbc" :key="'m'+a.letter" class="hudCoord">
              <span class="hudAxis">{{ a.letter }}</span> {{ formatCoord(vst?.machine_pos?.[a.index], a.letter) }}
            </div>
          </div>
          <div v-if="hudUvw.length" class="hudCol">
            <div v-for="a in hudUvw" :key="'m'+a.letter" class="hudCoord">
              <span class="hudAxis">{{ a.letter }}</span> {{ formatCoord(vst?.machine_pos?.[a.index], a.letter) }}
            </div>
          </div>
        </div>
      </div>

      <div class="hudSection">
        <div class="label">Tool</div>
        <div class="hudCoords">
          <div class="hudCoord"><span class="hudAxis">T</span> {{ vst?.tool_number ?? '-' }}</div>
          <div class="hudCoord"><span class="hudAxis">Ø</span> {{ formatCoord(vst?.tool_diameter) }}</div>
          <div class="hudCoord"><span class="hudAxis">L</span> {{ formatCoord(vst?.tool_length) }}</div>
        </div>
      </div>

      <div class="hudSection">
        <div class="label">Feed</div>
        <div class="hudValue">{{ vst?.current_vel != null ? (vst.current_vel * 60).toFixed(1) : '---' }}/min</div>
      </div>

      <div class="hudSection">
        <div class="label">Spindle</div>
        <div class="hudValue">{{ formatCoord(vst?.spindle_speed_actual) }} RPM</div>
        <div v-if="vst?.spindle_load != null" class="hudValue">Load {{ Math.round(vst.spindle_load) }}%</div>
      </div>

      <div v-if="vst?.eoffset_enabled" class="hudSection hudWarn">
        <div class="label">Compensation</div>
        <div class="hudValue">Z {{ vst.eoffset_z != null ? vst.eoffset_z.toFixed(3) : '---' }}</div>
      </div>

      <div v-if="vst?.rotation_xy" class="hudSection hudWarn">
        <div class="label">Rotation</div>
        <div class="hudValue">{{ vst.rotation_xy.toFixed(1) }}°</div>
      </div>

      <div v-if="toolpathOverflow" class="hudSection hudWarn">
        <div class="label">Toolpath</div>
        <div class="hudValue">Exceeds bounds</div>
      </div>
    </div>

    <!-- HUD toggle buttons (top-left) -->
    <div class="hudOverlay">
      <div class="hudBtnRow">
        <button class="hudBtn" :class="{ active: activeHudPanel === 'jog' }" @click="toggleHud('jog')">Jog</button>
        <button class="hudBtn" :class="{ active: activeHudPanel === 'gcode' }" @click="toggleHud('gcode')">Program</button>
        <button class="hudBtn" :class="{ active: activeHudPanel === 'setup' }" @click="toggleHud('setup')">Setup</button>
      </div>

      <div v-show="activeHudPanel === 'jog'">
        <JogHUD
          :axes="props.axes"
          :jogVel="props.jogVel ?? 10"
          :angularJogVel="props.angularJogVel ?? 10"
          :linearUnit="props.linearUnit ?? 'mm'"
          :maxJogVel="props.maxJogVel ?? 100"
          :maxAngularJogVel="props.maxAngularJogVel ?? 60"
          :minAngularJogVel="props.minAngularJogVel ?? 0.1"
          :jogIncrement="props.jogIncrement ?? 0"
          :minJogVel="props.minJogVel ?? 0.1"
          :iniIncrements="props.iniIncrements ?? null"
          :isTeleop="props.isTeleop ?? false"
          :isHomed="props.isHomed ?? false"
          @update:jogVel="emit('update:jogVel', $event)"
          @update:angularJogVel="emit('update:angularJogVel', $event)"
          @update:jogIncrement="emit('update:jogIncrement', $event)"
          @toggleTeleop="emit('toggleTeleop')"
        />
      </div>

      <div v-show="activeHudPanel === 'gcode'">
        <GcodeHUD
          :gcodeContent="props.gcodeContent ?? null"
          :currentLine="props.currentLine ?? null"
          :isPaused="props.isPaused ?? false"
          :elapsed="props.elapsed ?? '00:00'"
          :optionalStop="props.optionalStop ?? false"
          :blockDelete="props.blockDelete ?? false"
          @cycleStart="emit('cycleStart')"
          @cycleStep="emit('cycleStep')"
          @cyclePause="emit('cyclePause')"
          @cycleResume="emit('cycleResume')"
          @abort="emit('abort')"
          @toggleOptionalStop="emit('toggleOptionalStop')"
          @toggleBlockDelete="emit('toggleBlockDelete')"
        />
      </div>

      <div v-show="activeHudPanel === 'setup'">
        <SetupHUD
          :axes="props.axes"
          :homed="props.isHomed ?? false"
          :touchoff="props.touchoff ?? []"
          @update:touchoff="emit('update:touchoff', $event)"
          @homeAll="emit('homeAll')"
          @unhomeAll="emit('unhomeAll')"
          @setAxis="(axis: number, val: number) => emit('setAxis', axis, val)"
          @setAll="(vals: number[]) => emit('setAll', vals)"
          @goToG30="emit('goToG30')"
          @goToHome="emit('goToHome')"
          @goToZero="emit('goToZero')"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.hudOverlay {
  position: absolute;
  z-index: 1;
  top: 12px;
  left: 12px;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  min-width: 240px;
  max-height: calc(100% - 24px);
  overflow-y: auto;
}

.hudBtnRow {
  display: flex;
  gap: var(--gap-tight);
}

.hudBtn {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  padding: 5px 10px;
  opacity: var(--opacity-muted);
}

.hudBtn:hover {
  opacity: 1;
}

.hudBtn.active {
  opacity: 1;
  background: var(--hl-selected);
  border-color: color-mix(in oklab, var(--fg) 30%, var(--border));
}

.hudBtn.warn {
  opacity: 1;
  border-color: color-mix(in srgb, var(--warn) 50%, transparent);
  animation: flash-btn-warn 1.2s ease-in-out infinite;
}

@keyframes flash-btn-warn {
  0%, 100% { background: color-mix(in oklab, var(--warn) 25%, var(--button-bg)); }
  50% { background: color-mix(in oklab, var(--warn) 10%, var(--button-bg)); }
}

.viewerWrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.viewerHost {
  position: relative;
  z-index: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-2xl);
  overflow: hidden;
  border: 1px solid var(--border);
  background: color-mix(in oklab, var(--panel) 70%, transparent);
}

.hud {
  position: absolute;
  z-index: 1;
  top: 12px;
  right: 12px;
  display: flex;
  flex-direction: column;
  gap: var(--gap-controls);
  pointer-events: none;
  user-select: none;
}

.hudSection {
  background: color-mix(in oklab, var(--panel) 85%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 8px 12px;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  line-height: 1.4;
}

.label {
  margin-bottom: var(--gap-tight);
}

.hudValue {
  color: var(--fg);
  font-weight: var(--fw-medium);
}

.hudCoords {
  display: flex;
  gap: var(--gap-section);
}
.hudCol {
  display: flex;
  flex-direction: column;
  gap: var(--gap-micro);
}
.hudCoord {
  color: var(--fg);
  font-weight: var(--fw-medium);
  white-space: nowrap;
}
.hudAxis {
  color: var(--fg);
  opacity: var(--opacity-muted);
  margin-right: 4px;
}
.hudWarn .hudLabel,
.hudWarn .hudValue {
  color: var(--warn, #f5a623);
}

</style>

