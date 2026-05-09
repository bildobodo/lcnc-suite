<script lang="ts">
import { ref as _ref } from "vue";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { buildToolProfile, splitProfileAt, buildToolGeometry, buildHolderGeometry, type ToolMeta } from "./toolGeometry";
import { loadGeometryFromIDB, storeGeometryInIDB, pruneStaleVersions } from "./geometryCache";


// ---- Central caches (shared across ALL ThreeViewer instances) ----
const _geometryCache = new Map<string, THREE.BufferGeometry>();
const _toolMetaCache = new Map<number, ToolMeta>();  // tool_number → ToolMeta, populated on first sight
let _loadPromise: Promise<void> | null = null;
let _loadedInitJson: string | null = null;
export const machineReady = _ref(false);
export const failedParts = _ref<string[]>([]);

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
  failedParts.value = [];

  _loadPromise = (async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new DOMException("STL fetch timed out after 120s", "TimeoutError")), 120_000);
    try {
      const base = init.stl_base_url;
      const parts = init.parts ?? [];
      const urlFor = (file: string) => base.endsWith("/") ? `${base}${file}` : `${base}/${file}`;
      const toFetch = parts.filter((p: any) => !_geometryCache.has(p.id));

      // Drop IndexedDB entries whose ?v= no longer matches the active set.
      // Bounds the cache as users update STLs (?v=mtime changes → new key).
      pruneStaleVersions(new Set(parts.map((p: any) => urlFor(p.file)))).catch(() => {});

      if (toFetch.length === 0) {
        onProgress?.("All STLs already cached");
      }

      const results = await Promise.allSettled(toFetch.map(async (p: any) => {
        const url = urlFor(p.file);
        const t0 = performance.now();
        // L2: parsed geometry from IndexedDB. Same-version key (?v=mtime)
        // means no re-fetch + no re-parse on reconnect / reload.
        let geom = await loadGeometryFromIDB(url);
        if (geom) {
          onProgress?.(`✓ ${p.id} (cache, ${((performance.now() - t0) / 1000).toFixed(2)}s)`);
        } else {
          onProgress?.(`Fetching ${p.id}…`);
          geom = await fetchAndParseStl(url, abort.signal);
          geom.computeVertexNormals();
          // Fire-and-forget: don't block first paint on the IDB write.
          storeGeometryInIDB(url, geom).catch(e => console.warn("[idb] store", e));
          onProgress?.(`✓ ${p.id} (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
        }
        geom.userData._shared = true;
        _geometryCache.set(p.id, geom);
      }));

      const failed: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          const id = toFetch[i].id;
          failed.push(id);
          console.error(`[STL] failed to load ${id}:`, r.reason);
        }
      });
      failedParts.value = failed;

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
import { computed, inject, onMounted, onUnmounted, reactive, ref, watch, type Ref } from "vue";

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Text } from "troika-three-text";

import { viewerInit, viewerGcode, gcodeContent, status, type ViewerInit, type ViewerGcode } from "./lcncWs";
import { loadViewerDefaults, loadCameraDefaults, saveCameraDefaults, ALL_LAYERS, settingsVersion, type Vec3, type Layer } from "./defaults";
import { fmtCoord } from "./format";
import ViewCube from "./ViewCube.vue";
import MachineBtn from "./MachineBtn.vue";
import CameraPip from "./CameraPip.vue";
import { Camera, Settings } from "lucide-vue-next";

const themeMode = inject<Ref<string>>("themeMode", ref("auto"));

// Deep-reactive so template bindings (e.g. HUD opacity) update when the
// settingsVersion watcher refreshes the values from the server.
const viewerDefaults = reactive(loadViewerDefaults());

// ─── Camera PIP visibility ───────────────────────────────────────
const pipVisible = ref(loadCameraDefaults().pipVisible);
let _pipSkipNext = 0;

function togglePip() {
  pipVisible.value = !pipVisible.value;
  _pipSkipNext++;
  const cur = loadCameraDefaults();
  saveCameraDefaults({ ...cur, pipVisible: pipVisible.value });
}

function closePip() {
  pipVisible.value = false;
  _pipSkipNext++;
  const cur = loadCameraDefaults();
  saveCameraDefaults({ ...cur, pipVisible: false });
}

// ViewerInit and ViewerGcode imported from lcncWs.ts — shared with App.vue
// so the ref types and consumer types are in lockstep.

type ViewPreset = "top" | "bottom" | "left" | "right" | "front" | "back" | "iso" | "dimetric" | "reset";


type ViewerState = {
  ts?: number;

  machine_pos?: number[];
  joint_pos?: number[];
  tool_offset?: number[];

  g5x_offset?: number[];
  g92_offset?: number[];
  rotation_xy?: number;

  active_file?: string;
  motion_line?: number;

  tool_number?: number | null;
  tool_diameter?: number | null;
  tool_length?: number | null;
  // Folded in by the status watcher from the envelope top level — gateway
  // sends `status_msg["tool_meta"]` (sibling of `data`), not inside `data`.
  tool_meta?: ToolMeta | null;

  work_pos?: Vec3;

  current_vel?: number | null;
  spindle_speed?: number | null;
  spindle_direction?: number | null;
};



const props = defineProps<{
  g5xLabel?: string;
  linearUnit?: string;
  active?: boolean;
  activeFile?: string | null;
  spindleSpeed?: number | null;
  spindleActual?: number | null;
  spindleDirection?: number | null;
  surfacePoints?: [number, number, number][] | null;
  compGrid?: { x: number[]; y: number[]; zi: number[][]; method: number } | null;
  axes?: string[];
}>();

const emit = defineEmits<{
  (e: "open-settings", tab: string): void;
}>();

// HUD data (read from status for template)
const vst = computed(() => status.value?.data ?? null);

// First WCS word the loaded file pins (G54..G59.3). CAM preambles almost
// always emit one on line ~15, so its rotation is what the preview parser
// ends up applying — regardless of the active WCS. Surface a HUD hint when
// this differs from the operator's active selection so rotation edits on
// the non-pinned WCS don't look silently ignored.
const filePinnedWcs = computed(() => {
  const src = gcodeContent.value;
  if (!src) return null;
  const head = src.length > 8192 ? src.slice(0, 8192) : src;
  const m = head.match(/\bG5[4-9](?:\.[1-3])?\b/i);
  return m ? m[0].toUpperCase() : null;
});

// ---------- DOM ----------
const host = ref<HTMLDivElement | null>(null);
const hudVisible = ref(true);

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
let workRotGroup: THREE.Group | null = null;  // rotated sub-group for stock/axes (WCS rotation)
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
// Shared BufferGeometries — one per channel — so feed/overflow/highlight don't
// each carry their own copy of the position buffer. Disposed explicitly in
// applyGcode (disposeObject skips _shared geometries).
let feedSharedGeom: THREE.BufferGeometry | null = null;
let rapidSharedGeom: THREE.BufferGeometry | null = null;
let highlightGeom: THREE.BufferGeometry | null = null;
let workAxes: THREE.Group | null = null;
let surfaceGroup: THREE.Group | null = null;

// Map g-code line number → { start, end } point-index range in feed arrays
let feedLineMap: Map<number, { start: number; end: number }> = new Map();

// Pending layer visibility: stores calls made before scene objects exist
let pendingLayers: Map<Layer, boolean> | null = new Map();
let toolpathVisible = true;
let surfaceVisible = true;
const toolpathOverflow = ref(false);
// Toolpath bounding box in work coordinates (set by applyGcode, used by updateOverflowCheck)
let toolpathBBox: { min: [number, number, number]; max: [number, number, number] } | null = null;

// ---- Camera tracking ----
let trackingMode: "none" | "tool" | "wcs" = "none";

// ---- Render-on-demand ----
// _needsRender is set by anything that changes visible scene state (camera move,
// joint motion via applyState signature diff, layer toggle, theme change, etc.).
// animate() skips renderer.render() (and the prep work that feeds it — clipping
// plane transforms, billboard quaternion updates) when no flag set. Tween in
// flight and tracking mode force every frame.
let _needsRender = true;
function requestRender() { _needsRender = true; }
let _lastStateSig = "";

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

let machineBoundsMesh: THREE.LineSegments | null = null;
let toolpathBoundsBox: THREE.LineSegments | null = null;
let toolpathBoundsLabels: THREE.Group | null = null;
let toolpathOverflowEdges: THREE.LineSegments | null = null;
let toolpathBoundsVisible = false;
const _billboardLabels: Text[] = [];
const _bbQ = new THREE.Quaternion();  // reused for billboard parent compensation
const boundsClipPlanes: THREE.Plane[] = [];
const insideBoundsClipPlanes: THREE.Plane[] = [];
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

// Generic view-direction setter — places the camera along `dir` from the orbit
// target at the current distance, with the given `up` vector. Used by both the
// named-preset setView() wrapper and the ViewCube overlay, which passes
// arbitrary directions for edges and corners.
//
// Pole nudge: when `dir` is parallel to `up` (e.g. top/bottom view with up=+Z),
// camera.lookAt() inside controls.update() is degenerate — and OrbitControls
// also can't compute azimuth, so subsequent dragging snaps. Tilting the
// position by ~0.06° off-pole sidesteps both issues without visible offset.
const TWEEN_MS = 300;
const _qStart = new THREE.Quaternion();
const _qEnd = new THREE.Quaternion();
const _qNow = new THREE.Quaternion();
const _backUnit = new THREE.Vector3(0, 0, 1); // camera local +Z (back direction)
let _tweenRaf = 0;
let _tweenStart = 0;
let _tweenDist = 0;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function applyViewDirection(dir: THREE.Vector3, up: THREE.Vector3, animate = true) {
  if (!camera || !controls) return;
  const target = controls.target;
  const dist = camera.position.distanceTo(target);
  const dirN = dir.clone().normalize();
  const upN = up.clone().normalize();
  if (Math.abs(dirN.dot(upN)) > 0.9999) {
    const perpSeed = Math.abs(upN.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const perp = perpSeed.cross(upN).normalize();
    dirN.addScaledVector(perp, 0.001).normalize();
  }
  if (!animate) {
    camera.position.copy(target).addScaledVector(dirN, dist);
    camera.up.copy(upN);
    camera.updateProjectionMatrix();
    controls.update();
    return;
  }
  // Snap up immediately so OrbitControls' polar axis is consistent during the
  // tween. Capturing _qStart from the live camera quaternion lets a new tween
  // pick up smoothly from wherever the in-flight tween currently sits.
  camera.up.copy(upN);
  _qStart.copy(camera.quaternion);
  const endPos = target.clone().addScaledVector(dirN, dist);
  _qEnd.setFromRotationMatrix(new THREE.Matrix4().lookAt(endPos, target, upN));
  _tweenStart = performance.now();
  _tweenDist = dist;
  controls.enabled = false;
  if (_tweenRaf) cancelAnimationFrame(_tweenRaf);
  _tweenRaf = requestAnimationFrame(_tweenStep);
}

function _tweenStep() {
  if (!camera || !controls) {
    _tweenRaf = 0;
    return;
  }
  const t = Math.min(1, (performance.now() - _tweenStart) / TWEEN_MS);
  _qNow.copy(_qStart).slerp(_qEnd, easeInOutCubic(t));
  // Position derived from orientation around the orbit target: camera local +Z
  // (rotated by qNow) is the world-space "back" direction; the camera sits one
  // distance back from the target.
  const back = _backUnit.clone().applyQuaternion(_qNow);
  camera.position.copy(controls.target).addScaledVector(back, _tweenDist);
  camera.quaternion.copy(_qNow);
  if (t < 1) {
    _tweenRaf = requestAnimationFrame(_tweenStep);
  } else {
    _tweenRaf = 0;
    controls.enabled = true;
    controls.update();
  }
}

// Frame-fit tween: lerps camera position, orbit target, up vector, and (for
// ortho) frustum bounds + zoom over TWEEN_MS. Used by setView('reset') so the
// viewer eases back to the auto-frame instead of snapping. Shares _tweenRaf
// with the orientation tween so a new view request cancels any in-flight one.
type FrameTween = {
  posStart: THREE.Vector3; posEnd: THREE.Vector3;
  tgtStart: THREE.Vector3; tgtEnd: THREE.Vector3;
  upStart: THREE.Vector3;  upEnd: THREE.Vector3;
  ortho: null | {
    topStart: number;    topEnd: number;
    bottomStart: number; bottomEnd: number;
    leftStart: number;   leftEnd: number;
    rightStart: number;  rightEnd: number;
    zoomStart: number;   zoomEnd: number;
  };
};
let _frameTween: FrameTween | null = null;

function tweenFrameToBounds(box: THREE.Box3) {
  if (!camera || !controls || box.isEmpty()) return;
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);

  // near/far don't need lerping — they only affect culling planes. Set immediately.
  camera.near = Math.max(0.1, maxDim / 1000);
  camera.far  = Math.max(200000, maxDim * 20);

  const tgtEnd = center.clone();
  const upEnd = new THREE.Vector3(0, 0, 1);
  let posEnd: THREE.Vector3;
  let ortho: FrameTween["ortho"] = null;

  if (camera instanceof THREE.OrthographicCamera) {
    const aspect = host.value ? (host.value.clientWidth / host.value.clientHeight) || 1 : 1;
    const halfH = maxDim * 1.2;
    ortho = {
      topStart: camera.top, topEnd: halfH,
      bottomStart: camera.bottom, bottomEnd: -halfH,
      rightStart: camera.right, rightEnd: halfH * aspect,
      leftStart: camera.left, leftEnd: -halfH * aspect,
      zoomStart: camera.zoom, zoomEnd: 1,
    };
    posEnd = new THREE.Vector3(center.x + maxDim, center.y - maxDim, center.z + maxDim);
  } else {
    posEnd = new THREE.Vector3(center.x + maxDim * 1.5, center.y - maxDim * 1.5, center.z + maxDim);
  }

  _frameTween = {
    posStart: camera.position.clone(), posEnd,
    tgtStart: controls.target.clone(), tgtEnd,
    upStart: camera.up.clone(), upEnd,
    ortho,
  };
  _tweenStart = performance.now();
  controls.enabled = false;
  if (_tweenRaf) cancelAnimationFrame(_tweenRaf);
  _tweenRaf = requestAnimationFrame(_frameTweenStep);
}

function _frameTweenStep() {
  if (!camera || !controls || !_frameTween) {
    _tweenRaf = 0;
    return;
  }
  const f = _frameTween;
  const t = Math.min(1, (performance.now() - _tweenStart) / TWEEN_MS);
  const e = easeInOutCubic(t);
  camera.position.lerpVectors(f.posStart, f.posEnd, e);
  controls.target.lerpVectors(f.tgtStart, f.tgtEnd, e);
  camera.up.lerpVectors(f.upStart, f.upEnd, e).normalize();
  camera.lookAt(controls.target);
  if (f.ortho && camera instanceof THREE.OrthographicCamera) {
    camera.top    = f.ortho.topStart    + (f.ortho.topEnd    - f.ortho.topStart)    * e;
    camera.bottom = f.ortho.bottomStart + (f.ortho.bottomEnd - f.ortho.bottomStart) * e;
    camera.right  = f.ortho.rightStart  + (f.ortho.rightEnd  - f.ortho.rightStart)  * e;
    camera.left   = f.ortho.leftStart   + (f.ortho.leftEnd   - f.ortho.leftStart)   * e;
    camera.zoom   = f.ortho.zoomStart   + (f.ortho.zoomEnd   - f.ortho.zoomStart)   * e;
  }
  camera.updateProjectionMatrix();
  if (t < 1) {
    _tweenRaf = requestAnimationFrame(_frameTweenStep);
  } else {
    _tweenRaf = 0;
    _frameTween = null;
    controls.enabled = true;
    controls.update();
  }
}

function setView(p: ViewPreset) {
  if (!camera || !controls) return;

  if (p === "reset") {
    if (!_iniBox || !_workGrp) return;
    tweenFrameToBounds(_iniBox.clone().translate(_workGrp.position));
    return;
  }

  const dir = new THREE.Vector3();
  const up = new THREE.Vector3(0, 0, 1);

  switch (p) {
    case "top":      dir.set(0, 0, 1);      break;
    case "bottom":   dir.set(0, 0, -1);     break;
    case "front":    dir.set(1, 0, 0);      break;
    case "back":     dir.set(-1, 0, 0);     break;
    case "left":     dir.set(0, -1, 0);     break;
    case "right":    dir.set(0, 1, 0);      break;
    case "iso":      dir.set(1, -1, 0.8);   break;
    case "dimetric": dir.set(0.7, -0.7, 1); break;
  }

  applyViewDirection(dir, up);
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
    case "bounds":
      if (machineBoundsMesh) machineBoundsMesh.visible = on;
      break;
    case "toolpathBounds":
      toolpathBoundsVisible = on;
      if (toolpathBoundsBox) toolpathBoundsBox.visible = on;
      if (toolpathBoundsLabels) toolpathBoundsLabels.visible = on;
      if (toolpathOverflowEdges) toolpathOverflowEdges.visible = on;
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
      surfaceVisible = on;
      if (surfaceGroup) surfaceGroup.visible = on;
      break;
  }
  requestRender();
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
    m.depthWrite = false;
    m.needsUpdate = true;
  }
  if (rapidLine) {
    const m = rapidLine.material as THREE.LineDashedMaterial;
    m.depthTest = dt;
    m.depthWrite = false;
    m.needsUpdate = true;
  }
  for (const ol of [feedOverflow, rapidOverflow]) {
    if (ol) {
      const m = ol.material as THREE.LineDashedMaterial;
      m.depthTest = dt;
      m.depthWrite = false;
      m.needsUpdate = true;
    }
  }
  if (highlightLine) {
    const m = highlightLine.material as THREE.LineBasicMaterial;
    m.depthTest = dt;
    m.depthWrite = false;
    m.needsUpdate = true;
  }
  requestRender();
}

function setTrackingMode(mode: "none" | "tool" | "wcs") {
  trackingMode = mode;
  requestRender();
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

function applyBox(mesh: THREE.Object3D, size: Vec3, origin: Vec3) {
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
  // Shared with overflow (and position-attr shared with highlight).
  // Disposal is owned by applyGcode; disposeObject() skips _shared geometries.
  geom.userData._shared = true;
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
    mat.depthWrite = false;
  } else {
    mat = new THREE.LineBasicMaterial({ color: colorHex, transparent: opacity < 1, opacity });
    mat.depthTest = !pathAlwaysOnTop;
    mat.depthWrite = false;
  }

  const line = new THREE.Line(geom, mat);
  line.renderOrder = 10;

  // Important: prevent disappearing when workOrigin shifts / bounds get odd
  line.frustumCulled = false;

  if (dashed) (line as any).computeLineDistances?.();
  return line;
}

/** Yellow dashed overlay sharing geometry with a toolpath line, clipped to show only outside machine bounds. */
function makeOverflowLine(geom: THREE.BufferGeometry): THREE.Line | null {
  if (boundsClipPlanes.length === 0) return null;
  const mat = new THREE.LineDashedMaterial({
    color: 0xffcc00,
    dashSize: 3,
    gapSize: 2,
    transparent: true,
    opacity: 0.9,
    depthTest: !pathAlwaysOnTop,
    depthWrite: false,
    clipIntersection: true,
    clippingPlanes: boundsClipPlanes,
  });
  const line = new THREE.Line(geom, mat);
  line.renderOrder = 10;
  line.frustumCulled = false;
  // Idempotent: rapid channel already has lineDistance from rapidLine; feed channel doesn't.
  if (!geom.attributes.lineDistance) line.computeLineDistances();
  return line;
}


function ensureCoreGroups(init: ViewerInit) {
  if (!scene) return;

  // reset pointers
  for (const lbl of _billboardLabels) lbl.dispose();
  _billboardLabels.length = 0;
  workOrigin = null;
  workRotGroup = null;
  workAxes = null;
  machineBoundsMesh = null;
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

  // Rotated sub-group: stock, axes, overflow, surface, toolpath all rotate
  // with the live WCS R value. Worker un-rotates vertices at parse time so
  // the toolpath is in raw program coords — rotation is applied here.
  workRotGroup = new THREE.Group();
  workOrigin.add(workRotGroup);

  // Work zero XYZ arrows (color identifies axis — no text labels)
  workAxes = new THREE.Group();
  const _al = 60 * _unitScale;
  const _ah = _al * 0.15, _aw = _al * 0.08;
  workAxes.add(new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(), _al, 0xff4444, _ah, _aw));
  workAxes.add(new THREE.ArrowHelper(new THREE.Vector3(0,1,0), new THREE.Vector3(), _al, 0x44ff44, _ah, _aw));
  workAxes.add(new THREE.ArrowHelper(new THREE.Vector3(0,0,1), new THREE.Vector3(), _al, 0x4488ff, _ah, _aw));

  workRotGroup.add(workAxes);

  // ---- Backplot line (tool history in WORK coordinates) ----
{
  backplotGeom = new THREE.BufferGeometry();
  backplotPos = new Float32Array(BACKPLOT_MAX * 3);
  backplotGeom.setAttribute("position", new THREE.BufferAttribute(backplotPos, 3));
  backplotGeom.setDrawRange(0, 0);

  const bpColor = viewerDefaults.colors.backplot ?? "#ff00ff";
  const mat = new THREE.LineBasicMaterial({
    color: bpColor,
    depthTest: !pathAlwaysOnTop,
    depthWrite: false,
  });

  backplotLine = new THREE.Line(backplotGeom, mat);
  backplotLine.renderOrder = 11;
  backplotLine.frustumCulled = false;   // ✅ prevents disappearing when origin is off-screen
  _workGrp!.add(backplotLine);

resetBackplot();


}

  // Default tool until viewer_state arrives — but skip if applyState already
  // built the real tool during the async gap (loadMachineAssets yield).
  if (_currentToolNum == null) {
    toolMarker = buildToolGroup(6 * _unitScale, 60 * _unitScale, null);
    _toolGrp?.add(toolMarker);
  }



  // --- Machine bounds box — wireframe edges only ---
  {
    const boundsColor = viewerDefaults.colors.bounds ?? "#ffffff";
    const boxGeom = new THREE.BoxGeometry(1, 1, 1);
    const edgeGeom = new THREE.EdgesGeometry(boxGeom);
    boxGeom.dispose();
    machineBoundsMesh = new THREE.LineSegments(
      edgeGeom,
      new THREE.LineBasicMaterial({ color: boundsColor })
    );
    _workGrp!.add(machineBoundsMesh);
  }

  // Apply tool colors
  MAT.tool.color.set(viewerDefaults.colors.tool ?? "#c0c0c0");
  MAT.cutter.color.set(viewerDefaults.colors.cutter ?? "#ffdd00");
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
  window.__viewerDiag = { ready: false };

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
        insideBoundsClipPlanes.length = 0;
        for (const p of _localBoundsPlanes) {
          boundsClipPlanes.push(p.clone());
          insideBoundsClipPlanes.push(p.clone().negate());
        }
      }

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

      window.__viewerDiag = {
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

    // Re-apply saved layer visibility (objects just created default to visible)
    const _freshVd = loadViewerDefaults();
    for (const layer of ALL_LAYERS) setLayerVisible(layer, _freshVd.layers[layer]);

    // Re-attach surface mesh: ensureCoreGroups() orphans the old surfaceGroup
    // (it lived under the previous workRotGroup), and the prop watcher only
    // fires on prop change — not on viewer rebuilds. Also covers the race
    // where surface_points arrived before scene/workOrigin existed.
    if (props.surfacePoints?.length) buildSurfaceLayer(props.surfacePoints);

  } catch (err) {
    console.error("buildFromInit failed:", err);
    window.__viewerDiag = { ready: false, error: (err as Error).message };
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
  if (workRotGroup) {
    workRotGroup.rotation.z = (st.rotation_xy ?? 0) * Math.PI / 180;
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

    // Determine if we need a rebuild
    const needsRebuild = (toolNum !== _currentToolNum && _toolGrp)
      || (meta && JSON.stringify(meta) !== JSON.stringify(_lastToolMeta))
      || (() => {
        // Same tool, same meta — check if diam/length changed
        const visMesh = toolBodyMesh ?? toolCutterMesh;
        if (!visMesh) return false;
        const r = Math.max(0.2, diam * 0.5);
        const prev = (visMesh.userData.toolVis as any) || {};
        return Math.abs((prev.r ?? 0) - r) > 0.01
            || Math.abs((prev.L ?? 0) - visLen) > 0.5;
      })();

    if (needsRebuild) {
      if (toolNum !== _currentToolNum) {
        _currentToolNum = toolNum;
      }
      if (meta) {
        _lastToolMeta = meta;
        if (toolNum != null) _toolMetaCache.set(toolNum, meta);
      } else if (toolNum != null) {
        _lastToolMeta = _toolMetaCache.get(toolNum) ?? null;
      }

      const newGroup = buildToolGroup(diam, visLen, _lastToolMeta);
      if (toolMarker && _toolGrp) {
        _toolGrp.remove(toolMarker);
        disposeObject(toolMarker);
      }
      toolMarker = newGroup;
      _toolGrp?.add(toolMarker);
      const visMesh = toolBodyMesh ?? toolCutterMesh;
      if (visMesh) visMesh.userData.toolVis = { r: diam * 0.5, L: visLen };
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

  // Render-on-demand: detect whether anything visually changed since the last
  // applied state. Status broadcasts arrive at ~30 Hz; without this diff we'd
  // render every status arrival even when joints are still and motion_line is
  // unchanged. Fields included cover everything applyState mutates visually.
  const sig = JSON.stringify([
    st.joint_pos,
    st.machine_pos,
    st.g5x_offset,
    st.g92_offset,
    st.tool_offset,
    st.tool_number,
    st.tool_diameter,
    st.tool_length,
    st.tool_meta,
    st.motion_line,
    st.rotation_xy,
  ]);
  if (sig !== _lastStateSig) {
    _lastStateSig = sig;
    _needsRender = true;
  }
}

/** Check if stored toolpath bbox exceeds machine bounds (in current WCS). */
function updateOverflowCheck() {
  toolpathOverflow.value = false;
  if (!toolpathBBox || !workOrigin) return;
  const mb = viewerInit.value?.machine_bounds;
  if (!mb) return;
  const wo = workOrigin.position;
  // Machine bounds converted to work coordinates
  const bMin0 = mb.origin[0] - wo.x, bMin1 = mb.origin[1] - wo.y, bMin2 = mb.origin[2] - wo.z;
  const bMax0 = bMin0 + mb.size[0], bMax1 = bMin1 + mb.size[1], bMax2 = bMin2 + mb.size[2];
  // toolpathBBox is in pre-rotation work coords; rotate the 4 XY corners by
  // workRotGroup.rotation.z to get the rendered AABB. Z is unaffected.
  const theta = workRotGroup?.rotation.z ?? 0;
  const ca = Math.cos(theta), sa = Math.sin(theta);
  let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
  for (const x of [toolpathBBox.min[0], toolpathBBox.max[0]]) {
    for (const y of [toolpathBBox.min[1], toolpathBBox.max[1]]) {
      const rx = x * ca - y * sa;
      const ry = x * sa + y * ca;
      if (rx < mnX) mnX = rx; if (rx > mxX) mxX = rx;
      if (ry < mnY) mnY = ry; if (ry > mxY) mxY = ry;
    }
  }
  toolpathOverflow.value =
    mnX < bMin0 || mxX > bMax0 ||
    mnY < bMin1 || mxY > bMax1 ||
    toolpathBBox.min[2] < bMin2 || toolpathBBox.max[2] > bMax2;
}

function rebuildToolpathBounds() {
  if (toolpathBoundsBox) {
    workRotGroup?.remove(toolpathBoundsBox);
    disposeObject(toolpathBoundsBox);
    toolpathBoundsBox = null;
  }
  if (toolpathBoundsLabels) {
    toolpathBoundsLabels.traverse((c: any) => {
      if (c.dispose) {
        c.dispose();
        const i = _billboardLabels.indexOf(c);
        if (i >= 0) _billboardLabels.splice(i, 1);
      }
    });
    workRotGroup?.remove(toolpathBoundsLabels);
    toolpathBoundsLabels = null;
  }
  if (toolpathOverflowEdges) {
    workRotGroup?.remove(toolpathOverflowEdges);
    disposeObject(toolpathOverflowEdges);
    toolpathOverflowEdges = null;
  }
  if (!toolpathBBox || !workRotGroup) return;

  const sx = toolpathBBox.max[0] - toolpathBBox.min[0];
  const sy = toolpathBBox.max[1] - toolpathBBox.min[1];
  const sz = toolpathBBox.max[2] - toolpathBBox.min[2];
  if (sx <= 0 && sy <= 0 && sz <= 0) return;

  const cx = (toolpathBBox.min[0] + toolpathBBox.max[0]) / 2;
  const cy = (toolpathBBox.min[1] + toolpathBBox.max[1]) / 2;
  const cz = (toolpathBBox.min[2] + toolpathBBox.max[2]) / 2;

  const color = viewerDefaults.colors.toolpathBounds ?? "#f5a623";
  const boxGeom = new THREE.BoxGeometry(Math.max(sx, 0.001), Math.max(sy, 0.001), Math.max(sz, 0.001));
  const edgeGeom = new THREE.EdgesGeometry(boxGeom);
  boxGeom.dispose();
  toolpathBoundsBox = new THREE.LineSegments(
    edgeGeom,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      clippingPlanes: insideBoundsClipPlanes,
    })
  );
  toolpathBoundsBox.position.set(cx, cy, cz);
  toolpathBoundsBox.visible = toolpathBoundsVisible;
  workRotGroup.add(toolpathBoundsBox);

  toolpathOverflowEdges = rebuildOverflowEdges(
    [sx, sy, sz],
    [toolpathBBox.min[0], toolpathBBox.min[1], toolpathBBox.min[2]],
  );
  if (toolpathOverflowEdges) {
    toolpathOverflowEdges.visible = toolpathBoundsVisible;
    workRotGroup.add(toolpathOverflowEdges);
  }

  toolpathBoundsLabels = new THREE.Group();
  const fs = Math.max(sx, sy, sz) * 0.05;
  const unit = viewerInit.value?.units === "in" ||
               viewerInit.value?.units === "inch" ? "in" : "mm";
  const ox = toolpathBBox.min[0], oy = toolpathBBox.min[1], oz = toolpathBBox.min[2];
  const axes: [string, number, THREE.Vector3, string][] = [
    ["X", sx, new THREE.Vector3(ox + sx / 2, oy, oz), "#ff4444"],
    ["Y", sy, new THREE.Vector3(ox, oy + sy / 2, oz), "#44ff44"],
    ["Z", sz, new THREE.Vector3(ox, oy, oz + sz / 2), "#4488ff"],
  ];
  for (const [name, size, pos, c] of axes) {
    const lbl = mkTextLabel(`${name}: ${size.toFixed(0)} ${unit}`, c, fs);
    lbl.position.copy(pos);
    toolpathBoundsLabels.add(lbl);
    _billboardLabels.push(lbl);
  }
  toolpathBoundsLabels.visible = toolpathBoundsVisible;
  workRotGroup.add(toolpathBoundsLabels);
}

function applyGcode(g: ViewerGcode) {
  if (!scene || !workOrigin) return;

  // Remove old lines from scene graph
  for (const old of [feedLine, rapidLine, feedOverflow, rapidOverflow, highlightLine]) {
    if (old) workRotGroup?.remove(old);
  }
  // Dispose shared geometries explicitly (disposeObject skips _shared)
  if (feedSharedGeom) feedSharedGeom.dispose();
  if (rapidSharedGeom) rapidSharedGeom.dispose();
  if (highlightGeom) highlightGeom.dispose();
  feedLine = rapidLine = feedOverflow = rapidOverflow = highlightLine = null;
  feedSharedGeom = rapidSharedGeom = highlightGeom = null;
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

  // Feed + Rapid toolpath lines — geometry is shared with the overflow overlay.
  const feedColor = viewerDefaults.colors.feed ?? "#22b8cf";
  const rapidColor = viewerDefaults.colors.rapid ?? "#f5a623";
  if (feedPts.length >= 2) {
    feedLine = makeLine(feedPts, feedColor, false);
    feedSharedGeom = feedLine.geometry as THREE.BufferGeometry;
    workRotGroup!.add(feedLine);
    feedOverflow = makeOverflowLine(feedSharedGeom);
    if (feedOverflow) workRotGroup!.add(feedOverflow);
  }
  if (rapidPts.length >= 2) {
    rapidLine = makeLine(rapidPts, rapidColor, true);
    rapidSharedGeom = rapidLine.geometry as THREE.BufferGeometry;
    workRotGroup!.add(rapidLine);
    rapidOverflow = makeOverflowLine(rapidSharedGeom);
    if (rapidOverflow) workRotGroup!.add(rapidOverflow);
  }

  // Highlight line — shares feed's position attribute; independent drawRange.
  if (feedSharedGeom) {
    highlightGeom = new THREE.BufferGeometry();
    highlightGeom.userData._shared = true;
    highlightGeom.setAttribute("position", feedSharedGeom.attributes.position!);
    highlightGeom.setDrawRange(0, 0); // hidden until motion_line updates
    const hlMat = new THREE.LineBasicMaterial({ color: 0xff3333 });
    hlMat.depthTest = !pathAlwaysOnTop;
    hlMat.depthWrite = false;
    highlightLine = new THREE.Line(highlightGeom, hlMat);
    highlightLine.renderOrder = 12;
    highlightLine.frustumCulled = false;
    workRotGroup!.add(highlightLine);
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
  rebuildToolpathBounds();

  // Apply stored toolpath visibility (may have been set before lines existed)
  if (!toolpathVisible) {
    if (feedLine) feedLine.visible = false;
    if (rapidLine) rapidLine.visible = false;
    if (feedOverflow) feedOverflow.visible = false;
    if (rapidOverflow) rapidOverflow.visible = false;
    if (highlightLine) highlightLine.visible = false;
  }

  requestRender();
}

// ---------- lifecycle ----------
let resizeObs: ResizeObserver | null = null;

// Pause RAF while the document is hidden; resume on focus. Independent of
// props.active (Vue tab). Cancel inside the handler so we don't leak frames
// while the OS deprioritizes the tab.
function _onVisibilityChange() {
  if (document.hidden) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  } else if (props.active !== false && raf === 0) {
    requestRender();
    animate();
  }
}

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
  requestRender();
}

let pendingState: any = null;
let _needsReframe = false;
let _iniBox: THREE.Box3 | null = null;

function animate() {
  if (props.active === false) return; // paused — don't schedule next frame
  raf = requestAnimationFrame(animate);

  // Apply pending state before render (natural frame dropping —
  // if multiple status updates arrive between frames, only the latest is used).
  // applyState diffs key fields and sets _needsRender only when the visible
  // state changes — so a steady 30 Hz status flood with no joint motion does
  // not force a render.
  if (pendingState && viewerInit.value) {
    applyState(viewerInit.value, pendingState as ViewerState);
    pendingState = null;

    // Re-frame after first status update so camera accounts for actual axis positions
    if (_needsReframe && _iniBox && _workGrp) {
      _needsReframe = false;
      const box = _iniBox.clone().translate(_workGrp.position);
      frameToBounds(box);
    }
  }

  // Camera tracking — move both target and camera to maintain viewing angle.
  // While tracking is active every frame is rendered; the tracking calculation
  // mutates camera state so flag a render explicitly.
  if (trackingMode !== "none" && controls && camera) {
    const target = new THREE.Vector3();
    if (trackingMode === "tool" && toolMarker) {
      toolMarker.getWorldPosition(target);
    } else if (trackingMode === "wcs" && workOrigin) {
      workOrigin.getWorldPosition(target);
    }
    const delta = target.sub(controls.target);
    controls.target.add(delta);
    camera.position.add(delta);
    _needsRender = true;
  }

  // Render-on-demand gate. Tween in flight (`_tweenRaf`) and active tracking
  // mode force a render every frame; otherwise we wait for an explicit
  // requestRender() (controls 'change', state diff, layer toggle, etc.).
  if (!_needsRender && !_tweenRaf && trackingMode === "none") return;

  // Update overflow clipping planes to track _workGrp world transform
  // (only runs when we're actually rendering — C4 lazy clip planes).
  if (_localBoundsPlanes.length > 0 && _localBoundsPlanes.length === boundsClipPlanes.length && _workGrp) {
    _workGrp.updateMatrixWorld();
    for (let i = 0; i < _localBoundsPlanes.length; i++) {
      boundsClipPlanes[i]!.copy(_localBoundsPlanes[i]!);
      boundsClipPlanes[i]!.applyMatrix4(_workGrp.matrixWorld);
      insideBoundsClipPlanes[i]!.copy(boundsClipPlanes[i]!).negate();
    }
  }

  // Billboard text labels — face camera each frame
  // Labels may be children of rotated groups (e.g. workOrigin with WCS rotation),
  // so we compensate by applying the inverse parent world quaternion first.
  if (camera) {
    for (const lbl of _billboardLabels) {
      if (lbl.parent) {
        lbl.parent.getWorldQuaternion(_bbQ);
        _bbQ.invert().multiply(camera.quaternion);
        lbl.quaternion.copy(_bbQ);
      } else {
        lbl.quaternion.copy(camera.quaternion);
      }
    }
  }

  // Skip controls.update() while the view tween is in flight: it calls
  // spherical.makeSafe() which clamps the polar angle, freezing the vertical
  // component of the rotation before the azimuth finishes — visible at top/
  // bottom transitions. The tween writes camera.position/quaternion directly
  // each frame; controls.update() runs once at tween completion to re-sync.
  if (!_tweenRaf) controls?.update();
  renderer?.render(scene!, camera!);

  // Orientation gizmo — always ortho, render into bottom-right viewport
  // (top-left is the HUD, top-right is the ViewCube + quick-grid).
  if (renderer && _gizmoScene && _gizmoCam && camera) {
    _gizmoCam.position.set(0, 0, 200).applyQuaternion(camera.quaternion);
    _gizmoCam.quaternion.copy(camera.quaternion);

    // Billboard gizmo labels
    _gizmoScene.traverse((c: any) => { if (c instanceof Text) c.quaternion.copy(_gizmoCam!.quaternion); });

    const el = renderer.domElement;
    const px = renderer.getPixelRatio();
    const gs = GIZMO_SIZE * px;
    const gx = el.width - gs - 8 * px, gy = 8 * px;
    renderer.setViewport(gx, gy, gs, gs);
    renderer.setScissor(gx, gy, gs, gs);
    renderer.setScissorTest(true);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(_gizmoScene, _gizmoCam);
    renderer.setScissorTest(false);
    renderer.autoClear = true;
    renderer.setViewport(0, 0, el.width, el.height);
  }

  _needsRender = false;
}

watch(themeMode, () => {
  if (scene) scene.background = sceneBgFromTheme();
  requestRender();
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

  // Render-on-demand: any user-initiated camera move flags a render.
  controls.addEventListener("change", requestRender);

  // Pause RAF when the document is hidden (browser tab switch / system sleep).
  // Independent of props.active, which gates Vue tab visibility within the SPA.
  document.addEventListener("visibilitychange", _onVisibilityChange);

  resizeObs = new ResizeObserver(() => resize());
  resizeObs.observe(host.value!);

  buildGizmo();

  resize();
  animate();

  // viewerInit / viewerGcode may already be set before this component mounted
  // (e.g. dynamically-added panels after WebSocket connected).
  // The immediate watcher fires during setup (before scene exists) and bails,
  // so we must call buildFromInit here now that scene is ready.
  if (viewerInit.value) buildFromInit(viewerInit.value);
  if (viewerGcode.value) applyGcode(viewerGcode.value);

  // Apply saved defaults (self-contained — no external wiring needed)
  applyViewerDefaults({ initialMount: true });
});

// Idempotent re-apply of viewer defaults — called on mount and from the
// settingsVersion watcher when server settings arrive or another tab edits them.
function applyViewerDefaults(opts: { initialMount?: boolean } = {}) {
  // Layer visibility, tracking, path-on-top, machine edges
  for (const layer of ALL_LAYERS) setLayerVisible(layer, viewerDefaults.layers[layer]);
  setTrackingMode(viewerDefaults.trackingMode);
  setPathAlwaysOnTop(viewerDefaults.pathOnTop);
  machineEdges = viewerDefaults.machineEdges;

  // Projection: only toggle on initial mount (to honor persisted setting).
  // On subsequent setting changes we leave the current projection alone — the
  // user can still toggle manually and we avoid fighting their active view.
  if (opts.initialMount && viewerDefaults.projection === "parallel") switchProjection();

  // Live-updatable materials: colors on shared MAT instances propagate immediately.
  MAT.tool.color.set(viewerDefaults.colors.tool ?? "#c0c0c0");
  MAT.cutter.color.set(viewerDefaults.colors.cutter ?? "#ffdd00");

  // Per-part color overrides — re-apply to any existing machine meshes.
  // Meshes built after this point pick up the new values from viewerDefaults
  // directly during buildFromInit (line 1007).
  for (const mesh of machineMeshes) {
    const partId = mesh.userData.partId as string | undefined;
    if (!partId) continue;
    const customColor = viewerDefaults.machineColors[partId];
    if (!customColor) continue;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat?.color) mat.color.set(customColor);
  }
}

onUnmounted(() => {
  document.removeEventListener("visibilitychange", _onVisibilityChange);
  resizeObs?.disconnect();
  resizeObs = null;
  cancelAnimationFrame(raf);
  if (_tweenRaf) cancelAnimationFrame(_tweenRaf);
  _tweenRaf = 0;

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
  () => viewerInit.value,
  (init) => {
    if (!init) return;
    const json = JSON.stringify(init);
    if (json === _lastInitJson) return;
    _lastInitJson = json;
    buildFromInit(init);
  },
  { immediate: true }
);

// Re-apply viewer defaults when server settings arrive or another client changes them.
// Refresh the reactive state in place (Object.assign triggers template updates),
// then push colors/opacities/layers into live scene objects.
watch(settingsVersion, () => {
  Object.assign(viewerDefaults, loadViewerDefaults());
  applyViewerDefaults();
  if (_pipSkipNext > 0) { _pipSkipNext--; }
  else { pipVisible.value = loadCameraDefaults().pipVisible; }
});

// Pause/resume RAF loop when active prop changes
// flush: 'post' ensures DOM (v-show) has updated before we resize
watch(() => props.active, (now) => {
  if (now !== false && renderer) {
    requestRender(); // force one render on resume
    resize();
    animate();
  } else {
    cancelAnimationFrame(raf);
  }
}, { flush: 'post' });

// Buffer latest status for rAF consumption (frame dropping)
// Always buffer even when hidden so state is ready when viewer becomes active.
// tool_meta lives at the envelope top level (sibling of data) — fold it into
// pendingState so applyState's `st.tool_meta` read just works. Also cache it
// in the shared map; gateway sends it only once per tool change, so we must
// grab it here before pendingState gets overwritten.
watch(
  () => status.value,
  (msg) => {
    if (!msg?.data) return;
    const tm: ToolMeta | null = msg.tool_meta ?? null;
    pendingState = tm ? { ...msg.data, tool_meta: tm } : msg.data;
    if (tm && msg.data.tool_number != null) {
      _toolMetaCache.set(msg.data.tool_number, tm);
    }
  },
);

// Apply gcode preview when it arrives
watch(
  () => viewerGcode.value,
  (g) => {
    if (g) applyGcode(g);
  },
);


// Format coordinate for HUD display
// formatCoord → fmtCoord imported from format.ts

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

const spindleLoadZone = computed(() => {
  const v = vst.value?.spindle_load;
  if (v == null) return "";
  if (v <= 100) return "zone-ok";
  if (v <= 200) return "zone-warn";
  return "zone-danger";
});
const spindleLoadFillPct = computed(() => {
  const v = vst.value?.spindle_load;
  if (v == null) return 0;
  return Math.max(0, Math.min(100, (v / 300) * 100));
});

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


function buildSurfaceLayer(pts: [number, number, number][]) {
  if (!scene || !workOrigin) return;

  // Remove previous
  if (surfaceGroup) {
    surfaceGroup.parent?.remove(surfaceGroup);
    surfaceGroup.traverse((o: any) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    surfaceGroup = null;
  }

  // Atomic render: both surface points AND scipy comp grid required, or nothing
  const grid = props.compGrid;
  if (!pts || pts.length < 3) return;
  if (!grid || grid.x.length < 2 || grid.y.length < 2) return;

  surfaceGroup = new THREE.Group();

  // Z-bounds for color mapping (taken from raw points)
  let zMin = Infinity, zMax = -Infinity;
  for (const p of pts) {
    if (p[2] < zMin) zMin = p[2]; if (p[2] > zMax) zMax = p[2];
  }
  const zRange = zMax - zMin || 0.001;

  // Build mesh from scipy-interpolated grid at 1:1 WCS scale
  const nx = grid.x.length, ny = grid.y.length;
  const gxRange = grid.x[nx - 1]! - grid.x[0]!;
  const gyRange = grid.y[ny - 1]! - grid.y[0]!;
  const geom = new THREE.PlaneGeometry(gxRange || 1, gyRange || 1, nx - 1, ny - 1);
  const posArr = geom.attributes.position!;
  const colors: number[] = [];

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const vi = iy * nx + ix;
      const gx = grid.x[ix]!, gy = grid.y[iy]!;
      let z = grid.zi[ix]?.[iy];
      if (z == null || !isFinite(z)) {
        // Outside convex hull — nearest raw point
        let bestD2 = Infinity, bestZ = 0;
        for (const p of pts) {
          const d2 = (gx - p[0]) ** 2 + (gy - p[1]) ** 2;
          if (d2 < bestD2) { bestD2 = d2; bestZ = p[2]; }
        }
        z = bestZ;
      }
      posArr.setX(vi, gx);
      posArr.setY(vi, gy);
      posArr.setZ(vi, z);
      const t = (z - zMin) / zRange;
      const [r, g, b] = viridis(t);
      colors.push(r / 255, g / 255, b / 255);
    }
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
  const dotR = Math.min(gxRange || 1, gyRange || 1) * 0.012;
  const dotGeom = new THREE.SphereGeometry(dotR, 8, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
  for (const p of pts) {
    const dot = new THREE.Mesh(dotGeom, dotMat);
    dot.position.set(p[0], p[1], p[2]);
    surfaceGroup.add(dot);
  }

  workRotGroup!.add(surfaceGroup);
  surfaceGroup.visible = surfaceVisible;
  requestRender();
}

watch(() => props.surfacePoints, (pts) => {
  buildSurfaceLayer(pts ?? []);
});

watch(() => props.compGrid, () => {
  if (props.surfacePoints?.length) buildSurfaceLayer(props.surfacePoints);
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
  requestRender();
}

/** Toggle CAD-like edge outline mode for machine STLs. */
function setMachineEdges(on: boolean) {
  machineEdges = on;
  if (on && !_edgesBuilt) {
    buildEdgesLazy();
  } else {
    for (const e of _machineEdgeLines) e.visible = on;
  }
  requestRender();
}

function setToolColors(toolColor: string | null, cutterColor: string | null) {
  if (toolColor) MAT.tool.color.set(toolColor);
  if (cutterColor) MAT.cutter.color.set(cutterColor);
  requestRender();
}

// Getter passed to ViewCube — runs every frame so it tracks camera replacement
// (perspective ↔ ortho swap re-binds the local `camera` variable).
function getMainCameraQuaternion(): THREE.Quaternion | null {
  return camera?.quaternion ?? null;
}

defineExpose({
  resetBackplot,
  setView,
  applyViewDirection,
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
    <div ref="host" class="viewerHost bordered-panel" />

    <!-- HUD Overlay -->
    <div v-show="hudVisible" class="hud">
      <div class="hudSection">
        <div class="label">Work Position ({{ props.g5xLabel || '-' }})</div>
        <div class="row-sections">
          <div class="stack-micro">
            <div v-for="a in hudPrimary" :key="'w'+a.letter" class="hudCoord">
              <span class="hudAxis">{{ a.letter }}</span> {{ fmtCoord(vst?.work_pos?.[a.index], a.letter) }}
            </div>
          </div>
          <div v-if="hudAbc.length" class="stack-micro">
            <div v-for="a in hudAbc" :key="'w'+a.letter" class="hudCoord">
              <span class="hudAxis">{{ a.letter }}</span> {{ fmtCoord(vst?.work_pos?.[a.index], a.letter) }}
            </div>
          </div>
          <div v-if="hudUvw.length" class="stack-micro">
            <div v-for="a in hudUvw" :key="'w'+a.letter" class="hudCoord">
              <span class="hudAxis">{{ a.letter }}</span> {{ fmtCoord(vst?.work_pos?.[a.index], a.letter) }}
            </div>
          </div>
        </div>
      </div>

      <div class="hudSection">
        <div class="label">Machine Position</div>
        <div class="row-sections">
          <div class="stack-micro">
            <div v-for="a in hudPrimary" :key="'m'+a.letter" class="hudCoord">
              <span class="hudAxis">{{ a.letter }}</span> {{ fmtCoord(vst?.machine_pos?.[a.index], a.letter) }}
            </div>
          </div>
          <div v-if="hudAbc.length" class="stack-micro">
            <div v-for="a in hudAbc" :key="'m'+a.letter" class="hudCoord">
              <span class="hudAxis">{{ a.letter }}</span> {{ fmtCoord(vst?.machine_pos?.[a.index], a.letter) }}
            </div>
          </div>
          <div v-if="hudUvw.length" class="stack-micro">
            <div v-for="a in hudUvw" :key="'m'+a.letter" class="hudCoord">
              <span class="hudAxis">{{ a.letter }}</span> {{ fmtCoord(vst?.machine_pos?.[a.index], a.letter) }}
            </div>
          </div>
        </div>
      </div>

      <div class="hudSection">
        <div class="label">Tool</div>
        <div class="row-sections">
          <div class="hudCoord"><span class="hudAxis">T</span> {{ vst?.tool_number ?? '-' }}</div>
          <div class="hudCoord"><span class="hudAxis">Ø</span> {{ fmtCoord(vst?.tool_diameter) }}</div>
          <div class="hudCoord"><span class="hudAxis">L</span> {{ fmtCoord(vst?.tool_length) }}</div>
        </div>
      </div>

      <div class="hudSection">
        <div class="label">Feed</div>
        <div class="hudValue">{{ vst?.current_vel != null ? (vst.current_vel * 60).toFixed(1) : '---' }}/min</div>
      </div>

      <div class="hudSection">
        <div class="label">Spindle</div>
        <div class="hudValue">{{ fmtCoord(vst?.spindle_speed_actual) }} RPM</div>
        <div v-if="vst?.spindle_load != null" class="hudValue">Load {{ Math.round(vst.spindle_load) }}%</div>
        <div v-if="vst?.spindle_load != null" class="loadBar" :class="spindleLoadZone">
          <div class="loadBarFill" :style="{ width: spindleLoadFillPct + '%' }"></div>
        </div>
      </div>

      <div v-if="vst?.eoffset_enabled" class="hudSection hudWarn">
        <div class="label">Compensation</div>
        <div class="hudValue">Z {{ vst.eoffset_z != null ? vst.eoffset_z.toFixed(3) : '---' }}</div>
      </div>

      <div v-if="vst?.rotation_xy" class="hudSection hudWarn">
        <div class="label">Rotation</div>
        <div class="hudValue">{{ vst.rotation_xy.toFixed(1) }}°</div>
      </div>

      <div v-if="filePinnedWcs && filePinnedWcs !== props.g5xLabel" class="hudSection hudWarn">
        <div class="label">File WCS</div>
        <div class="hudValue">WARNING: {{ props.g5xLabel }} currently active</div>
        <div class="hudValue">Program contains {{ filePinnedWcs }}</div>
      </div>

      <div v-if="toolpathOverflow" class="hudSection hudWarn">
        <div class="label">Toolpath</div>
        <div class="hudValue">Exceeds bounds</div>
      </div>
    </div>

    <!-- View navigation cube (top-right) -->
    <ViewCube
      :get-camera-quaternion="getMainCameraQuaternion"
      @view-change="applyViewDirection"
    />

    <!-- Quick-access grid under the ViewCube: Reset, Clear, PIP, Settings -->
    <div class="viewerQuickGrid">
      <MachineBtn type="viewPreset" @click="setView('reset')">Reset</MachineBtn>
      <MachineBtn type="viewPreset" @click="resetBackplot">Clear</MachineBtn>
      <MachineBtn type="viewerQuickToggle" :selected="pipVisible" @click="togglePip" title="Show/hide camera">
        <Camera :size="14" />
      </MachineBtn>
      <MachineBtn type="viewerQuickToggle" @click="emit('open-settings', 'viewer')" title="3D Viewer settings">
        <Settings :size="14" />
      </MachineBtn>
    </div>

    <!-- Camera PIP overlay -->
    <CameraPip :visible="pipVisible" @close="closePip" />

    <!-- STL load failure chip (bottom-left, never blocks render) -->
    <div v-if="failedParts.length" class="stlFailedChip" :title="failedParts.join(', ')">
      {{ failedParts.length }} machine part{{ failedParts.length === 1 ? '' : 's' }} failed to load (see console)
    </div>

  </div>
</template>

<style scoped>
.viewerWrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

/* Quick-access 2×2 grid under the ViewCube (cube bottom edge ≈ 152px). */
.viewerQuickGrid {
  position: absolute;
  z-index: 1;
  top: 156px;
  right: 12px;
  width: 140px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap-tight);
}

.stlFailedChip {
  position: absolute;
  z-index: 1;
  bottom: 12px;
  left: 12px;
  padding: var(--gap-tight) var(--gap-controls);
  border-radius: var(--radius-xl);
  background: color-mix(in oklab, var(--warn) 20%, var(--panel));
  border: 1px solid var(--warn);
  color: var(--warn);
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  pointer-events: auto;
}

.viewerHost {
  position: relative;
  z-index: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-container);
  background: color-mix(in oklab, var(--panel) 70%, transparent);
}

.hud {
  position: absolute;
  z-index: 1;
  top: 12px;
  left: 12px;
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
  padding: var(--gap-controls) var(--gap-section);
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

/* .hudCoords — replaced by row-sections utility (same shape) */
/* .hudCol — replaced by stack-micro utility (same shape) */
.hudCoord {
  color: var(--fg);
  font-weight: var(--fw-medium);
  white-space: nowrap;
}
.hudAxis {
  color: var(--fg);
  opacity: var(--opacity-muted);
  margin-right: var(--gap-tight);
}
.hudWarn .hudLabel,
.hudWarn .hudValue {
  color: var(--warn, #f5a623);
}

</style>

