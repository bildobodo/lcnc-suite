<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, reactive, ref, watch, type Ref } from "vue";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Text } from "troika-three-text";
import { buildToolProfile, splitProfileAt, buildToolGeometry, buildHolderGeometry, type ToolMeta } from "./toolGeometry";
import { AXIS_HEX, AXIS_CSS } from "./axisColors";
import {
  failedParts, loadMachineAssets, getCachedGeometry, getToolMeta, setToolMeta,
} from "./viewer/machineAssetCache";

import { viewerInit, viewerGcode, gcodeContent, status, type ViewerInit, type ViewerGcode } from "./lcncWs";
import { loadViewerDefaults, loadCameraDefaults, saveCameraDefaults, ALL_LAYERS, settingsVersion, type Vec3, type Layer } from "./defaults";
import { fmtCoord } from "./format";
import { recordApply, recordRender, setViewerPerfContext } from "./viewerPerf";
import { disposeObject } from "./viewer/disposal";
import { createBackplotController } from "./viewer/backplotController";
import { createSurfaceController } from "./viewer/surfaceController";
import { createToolpathController, type ToolpathCtx } from "./viewer/toolpathController";
import type { ViewerCtx } from "./viewer/viewerContext";
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

// applyState() runs per animate frame; the legacy object-form path above allocated
// a fresh array every call (P4.3). init.kinematics is stable across frames, so cache
// the normalized result by source identity and recompute only when init changes.
let _kinCacheSrc: ViewerInit["kinematics"] | null = null;
let _kinCacheVal: KinEntry[] = [];
function normalizeKinematicsCached(kin: ViewerInit["kinematics"]): KinEntry[] {
  if (kin === _kinCacheSrc) return _kinCacheVal;
  _kinCacheSrc = kin;
  _kinCacheVal = normalizeKinematics(kin);
  return _kinCacheVal;
}

// Visual objects
let toolMarker: THREE.Group | null = null;
let toolCutterMesh: THREE.Mesh | null = null;
let toolBodyMesh: THREE.Mesh | null = null;
let holderMesh: THREE.Mesh | null = null;
let _currentToolNum: number | null = null;
let _lastToolMeta: ToolMeta | null = null;
let workAxes: THREE.Group | null = null;
// Surface map (probe heightmap) — owned by surfaceController.
const surface = createSurfaceController();
// Toolpath preview (feed/rapid/highlight lines, bounds box/labels/overflow) —
// owned by toolpathController. The HUD overflow flag stays here for the template.
const toolpathOverflow = ref(false);

// Pending layer visibility: stores calls made before scene objects exist
let pendingLayers: Map<Layer, boolean> | null = new Map();

// ---- Camera tracking ----
let trackingMode: "none" | "tool" | "wcs" = "none";

// ---- Render-on-demand ----
// _needsRender is set by anything that changes visible scene state (camera move,
// joint motion via applyState signature diff, layer toggle, theme change, etc.).
// animate() skips renderer.render() (and the prep work that feeds it — clipping
// plane transforms, billboard quaternion updates) when no flag set. Tween in
// flight and a non-zero tracking delta force a frame.
let _needsRender = true;
function requestRender() { _needsRender = true; }

// Fresh per-call snapshot of the reassigned scene-graph pointers for the viewer
// controllers (they must never cache these — see viewer/viewerContext.ts).
function viewerCtx(): ViewerCtx {
  return { scene, workRotGroup, workOrigin, requestRender };
}

// Render-on-demand change detection. Replaces a per-tick JSON.stringify of all
// visually-relevant fields (~30 Hz) with cheap field-wise comparison against
// the last applied values. Arrays are copied only when they actually change.
const _pv: {
  jointPos: number[] | null; machinePos: number[] | null;
  g5x: number[] | null; g92: number[] | null; toolOffset: number[] | null;
  toolNum: number | null; toolDiam: number | null; toolLen: number | null;
  toolMeta: unknown; motionLine: number | null; rotationXy: number | null;
} = {
  jointPos: null, machinePos: null, g5x: null, g92: null, toolOffset: null,
  toolNum: NaN as unknown as number, toolDiam: NaN, toolLen: NaN,
  toolMeta: undefined, motionLine: NaN, rotationXy: NaN,
};
// Returns true if `next` differs from `prev`; when it differs, writes a fresh
// copy back into the owner so subsequent ticks compare against the new value.
function _numArrChanged(prev: number[] | null, next: unknown): boolean {
  const arr = Array.isArray(next) ? (next as number[]) : null;
  if (arr === null) return prev !== null;
  if (prev === null || prev.length !== arr.length) return true;
  for (let i = 0; i < arr.length; i++) if (prev[i] !== arr[i]) return true;
  return false;
}

// ---- Path rendering ----
let pathAlwaysOnTop = true; // default; overridden by setPathAlwaysOnTop()

// ---- Unit scale ----
// 1 for mm machines, 1/25.4 for inch machines. Set in buildFromInit() from viewer_init.units.
let _unitScale = 1;

// ---- Backplot (live toolpath history) — owned by backplotController ----
const backplot = createBackplotController(requestRender);
// Reused scratch vectors for the per-tick backplot append — avoids allocating
// two Vector3 every status tick (GC churn → motion-animation hiccups). The
// tool-tip world→work-local conversion (toolMarker/_workGrp) stays here in the
// orchestrator; only the ring-buffer push moved to the controller.
const _bpWorld = new THREE.Vector3();
const _bpLocal = new THREE.Vector3();
// Reused scratch for camera tracking — runs every rAF frame while tracking.
const _trackTarget = new THREE.Vector3();

let machineBoundsMesh: THREE.LineSegments | null = null;
const _billboardLabels: Text[] = [];
const _bbQ = new THREE.Quaternion();  // reused for billboard parent compensation
const boundsClipPlanes: THREE.Plane[] = [];
const insideBoundsClipPlanes: THREE.Plane[] = [];
const _localBoundsPlanes: THREE.Plane[] = [];
let machineMeshes: THREE.Mesh[] = [];

// Toolpath preview controller. Stable deps (clip-plane arrays mutated in place,
// the billboard registry, mkTextLabel, disposeObject, the live colour getter,
// the HUD overflow ref) are bound once; apply()/updateOverflow() take a fresh
// ToolpathCtx with the reassigned scene-graph pointers (never cached).
const toolpath = createToolpathController({
  requestRender,
  boundsClipPlanes,
  insideBoundsClipPlanes,
  billboardLabels: _billboardLabels,
  makeLabel: mkTextLabel,
  disposeObject,
  colors: () => viewerDefaults.colors,
  axisCss: AXIS_CSS,
  overflow: toolpathOverflow,
});
// Reused ctx object: applyState calls updateOverflow(toolpathCtx()) on every
// status tick (≤30 Hz), and a fresh 6-field object per tick is avoidable gen-0
// churn (GC pauses here are object-count driven). Safe to mutate in place —
// controllers read ctx fields synchronously and never retain it (contract in
// viewerContext.ts).
const _toolpathCtx: ToolpathCtx = {
  scene: null, workOrigin: null, workRotGroup: null,
  pathAlwaysOnTop: false, machineBounds: undefined, units: undefined,
};
function toolpathCtx(): ToolpathCtx {
  _toolpathCtx.scene = scene;
  _toolpathCtx.workOrigin = workOrigin;
  _toolpathCtx.workRotGroup = workRotGroup;
  _toolpathCtx.pathAlwaysOnTop = pathAlwaysOnTop;
  _toolpathCtx.machineBounds = viewerInit.value?.machine_bounds;
  _toolpathCtx.units = viewerInit.value?.units;
  return _toolpathCtx;
}
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
  _gizmoScene.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), al, AXIS_HEX.x, ah, aw));
  _gizmoScene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), al, AXIS_HEX.y, ah, aw));
  _gizmoScene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), al, AXIS_HEX.z, ah, aw));

  const fs = al * 0.35;
  const lblOff = al * 1.15;
  for (const [text, color, pos] of [
    ["X", AXIS_CSS.x, [lblOff, 0, 0]],
    ["Y", AXIS_CSS.y, [0, lblOff, 0]],
    ["Z", AXIS_CSS.z, [0, 0, lblOff]],
  ] as [string, string, number[]][]) {
    const lbl = mkTextLabel(text, color, fs);
    lbl.position.set(pos[0]!, pos[1]!, pos[2]!);
    _gizmoScene.add(lbl);
  }

  _gizmoCam = new THREE.OrthographicCamera(-80, 80, 80, -80, 1, 500);
  _gizmoCam.up.set(0, 0, 1);
}

function resetBackplot() {
  backplot.reset();
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
      backplot.setVisible(on);
      break;
    case "toolpath":
      toolpath.setVisible(on);
      break;
    case "machine":
      for (const m of machineMeshes) m.visible = on;
      for (const e of _machineEdgeLines) e.visible = on && machineEdges;
      break;
    case "bounds":
      if (machineBoundsMesh) machineBoundsMesh.visible = on;
      break;
    case "toolpathBounds":
      toolpath.setBoundsVisible(on);
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
      surface.setVisible(on);
      break;
  }
  requestRender();
}

function setPathAlwaysOnTop(on: boolean) {
  pathAlwaysOnTop = on;
  const dt = !on; // depthTest: false = always on top
  backplot.setDepthTest(dt);
  toolpath.setAlwaysOnTop(on);
  requestRender();
}

function setTrackingMode(mode: "none" | "tool" | "wcs") {
  trackingMode = mode;
  requestRender();
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

// Mark every shared MAT.* instance so disposeObject (viewer/disposal.ts) never
// frees them: one instance is reused across every rebuild and across machine
// part groups (groupMat/dirMat reference these), so disposing one on scene
// teardown would black out the next scene. Private clones (per-part color
// overrides, settings clones) are NOT marked and ARE disposed.
for (const m of Object.values(MAT)) m.userData._shared = true;

// ---------- helpers ----------
// disposeObject lives in viewer/disposal.ts (A2): it disposes private geometry
// AND private materials, skipping anything marked userData._shared (the STL
// cache geometries + the MAT.* materials, both reused across rebuilds). The
// old in-file version never disposed materials, so per-program/per-part
// materials leaked on every reconnect rebuild.

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
  // clearScene (run by buildFromInit before this) already disposed the old
  // tool marker and surface group via the scene graph; drop the dangling refs
  // so replaceToolMarker / surface.build don't operate on freed objects
  // (H3/H6 — a stale group would otherwise be double-disposed and a stale
  // toolMarker removed from the wrong parent).
  toolMarker = null;
  // Also drop the tool change-detection anchors: with them kept, needsRebuild
  // never fires for an unchanged tool, so after a mid-session rebuild the
  // (freed) marker was never recreated — invisible tool + dead backplot gate
  // until a real tool change. Nulling _currentToolNum builds the default
  // marker below; the next applyState tick rebuilds the real one from
  // status + the ToolMeta cache.
  _currentToolNum = null;
  _lastToolMeta = null;
  surface.forgetAfterSceneClear();
  toolpath.forgetAfterSceneClear();

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
  workAxes.add(new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(), _al, AXIS_HEX.x, _ah, _aw));
  workAxes.add(new THREE.ArrowHelper(new THREE.Vector3(0,1,0), new THREE.Vector3(), _al, AXIS_HEX.y, _ah, _aw));
  workAxes.add(new THREE.ArrowHelper(new THREE.Vector3(0,0,1), new THREE.Vector3(), _al, AXIS_HEX.z, _ah, _aw));

  workRotGroup.add(workAxes);

  // ---- Backplot line (tool history in WORK coordinates) ----
  // Rebuild under the fresh _workGrp (reassigned each rebuild); the controller
  // replaces its prior line (clearScene already disposed the old one).
  backplot.build(_workGrp!, viewerDefaults.colors.backplot ?? "#ff00ff", !pathAlwaysOnTop);

  // Default tool until the next viewer_state tick rebuilds the real one
  // (_currentToolNum was reset above, so a loaded tool re-triggers needsRebuild).
  if (_currentToolNum == null) {
    replaceToolMarker(buildToolGroup(6 * _unitScale, 60 * _unitScale, null));
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

/**
 * Single owner of the tool marker (H3). Both the default-marker site
 * (ensureCoreGroups) and the live tool-change site (applyState) route through
 * here, so _toolGrp can never accumulate two markers: any prior one is removed
 * from its actual parent and disposed before the new one is added. Without this,
 * a tool-change landing during buildFromInit's async loadMachineAssets gap could
 * add a second marker, orphaning the first (its buildToolGeometry leaked).
 * disposeObject skips the shared MAT.tool/cutter/holder; only the per-marker
 * geometry is freed.
 */
function replaceToolMarker(newGroup: THREE.Group) {
  if (toolMarker) {
    toolMarker.parent?.remove(toolMarker);
    disposeObject(toolMarker);
  }
  toolMarker = newGroup;
  _toolGrp?.add(toolMarker);
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
    const kinEntries = normalizeKinematicsCached(init.kinematics);
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
        // clone() deep-copies userData, so this inherited the shared MAT.*'s
        // _shared=true — clear it: this is a PRIVATE per-part clone that
        // disposeObject must free on teardown (else it leaks per rebuild).
        mat.userData._shared = false;
        // Tag like setMachinePartColor's clones so its revert/reuse paths
        // treat this clone identically (null → revert to default colour).
        mat.userData._clonedFor = p.id;
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
        getRenderInfo: () => {
          if (!renderer) return null;
          const m = renderer.info.memory;
          const r = renderer.info.render;
          return {
            geometries: m.geometries,
            textures: m.textures,
            programs: renderer.info.programs?.length ?? 0,
            calls: r.calls,
            triangles: r.triangles,
          };
        },
      };
    }

    // Per-emit context for the frame-timing probe (viewerPerf). Closes over
    // module-level state so it always reads live values; invoked once per
    // summary window, not per frame. Lets the trace correlate hiccups with
    // toolpath size and the backplot-ring-full memmove regime.
    setViewerPerfContext(() => ({
      feed_segs: toolpath.feedSegs,
      rapid_segs: toolpath.rapidSegs,
      backplot_pts: backplot.count,
      backplot_full: backplot.isFull,
      // Three.js resource counts — monotonic growth over a long run is a
      // geometry/texture leak (the "~1 hr in" stutter suspect). Ride the 3 s
      // probe so leak detection shares one event line with heap + gap.
      geometries: renderer?.info.memory.geometries ?? 0,
      textures: renderer?.info.memory.textures ?? 0,
    }));

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

    // Re-attach surface mesh: ensureCoreGroups() orphans the old surface group
    // (it lived under the previous workRotGroup), and the prop watcher only
    // fires on prop change — not on viewer rebuilds. Also covers the race
    // where surface_points arrived before scene/workOrigin existed.
    if (props.surfacePoints?.length) surface.build(viewerCtx(), props.surfacePoints, props.compGrid);

    // Re-apply the current program for the same reason: ensureCoreGroups reset
    // the toolpath controller (its lines lived under the previous workRotGroup)
    // and the viewerGcode watcher only fires on ref change — bulkData version-
    // dedupes, so a reconnect with an unchanged program never reassigns the ref.
    if (viewerGcode.value) applyGcode(viewerGcode.value);

    // Pre-compile every material's shader now that all geometry is in the
    // scene. Without this, the FIRST interactive frame does the compilation
    // for each material lazily — visible as a hitch right when the user
    // starts dragging the camera. Sync, runs inside the existing buildFromInit
    // loading window so users don't notice it.
    if (renderer && camera) renderer.compile(scene, camera);

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

  const kinEntries = normalizeKinematicsCached(init.kinematics);
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
    toolpath.updateOverflow(toolpathCtx());
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
      // Reference compare, not JSON.stringify×2 per status (P4.3): lcncWs carries
      // over the SAME meta object while unchanged and produces a NEW one on an
      // actual tool/library change, so identity is the exact change signal.
      || (meta != null && meta !== _lastToolMeta)
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
        if (toolNum != null) setToolMeta(toolNum, meta);
      } else if (toolNum != null) {
        _lastToolMeta = getToolMeta(toolNum) ?? null;
      }

      // buildToolGroup sets the toolCutterMesh/toolBodyMesh module refs as a
      // side effect, so build BEFORE swapping in (replaceToolMarker disposes
      // the prior marker — never the shared MAT.*).
      replaceToolMarker(buildToolGroup(diam, visLen, _lastToolMeta));
      const visMesh = toolBodyMesh ?? toolCutterMesh;
      if (visMesh) visMesh.userData.toolVis = { r: diam * 0.5, L: visLen };
    }
  }


  
  // ---- Backplot update (use WORK tool-tip position directly) ----
  const curLine = typeof st.motion_line === "number" ? st.motion_line : null;

  // Append the actual rendered tool tip position, expressed in work group local space.
  // This guarantees the backplot starts exactly at the tooltip (independent of joint_pos vs machine_pos nuances).
  if (toolMarker && _workGrp) {
    toolMarker.getWorldPosition(_bpWorld);
    // worldToLocal mutates its argument in place, so convert a copy.
    _bpLocal.copy(_bpWorld);
    _workGrp.worldToLocal(_bpLocal);
    backplot.push(_bpLocal.x, _bpLocal.y, _bpLocal.z);
  }

  // ---- Highlight current motion line in toolpath ----
  toolpath.setHighlight(curLine);

  // Render-on-demand: detect whether anything visually changed since the last
  // applied state. Status broadcasts arrive at ~30 Hz; without this diff we'd
  // render every status arrival even when joints are still and motion_line is
  // unchanged. Fields checked cover everything applyState mutates visually.
  // Cheap field-wise compare (no per-tick allocation) replaces JSON.stringify.
  const toolNum = st.tool_number ?? null;
  const toolDiam = st.tool_diameter ?? null;
  const toolLen = st.tool_length ?? null;
  const motionLine = st.motion_line ?? null;
  const rotationXy = st.rotation_xy ?? null;
  const toolMeta = st.tool_meta ?? null;
  let changed = false;
  if (_numArrChanged(_pv.jointPos, st.joint_pos)) { _pv.jointPos = st.joint_pos ? [...st.joint_pos] : null; changed = true; }
  if (_numArrChanged(_pv.machinePos, st.machine_pos)) { _pv.machinePos = st.machine_pos ? [...st.machine_pos] : null; changed = true; }
  if (_numArrChanged(_pv.g5x, st.g5x_offset)) { _pv.g5x = st.g5x_offset ? [...st.g5x_offset] : null; changed = true; }
  if (_numArrChanged(_pv.g92, st.g92_offset)) { _pv.g92 = st.g92_offset ? [...st.g92_offset] : null; changed = true; }
  if (_numArrChanged(_pv.toolOffset, st.tool_offset)) { _pv.toolOffset = st.tool_offset ? [...st.tool_offset] : null; changed = true; }
  if (toolNum !== _pv.toolNum) { _pv.toolNum = toolNum; changed = true; }
  if (toolDiam !== _pv.toolDiam) { _pv.toolDiam = toolDiam; changed = true; }
  if (toolLen !== _pv.toolLen) { _pv.toolLen = toolLen; changed = true; }
  if (motionLine !== _pv.motionLine) { _pv.motionLine = motionLine; changed = true; }
  if (rotationXy !== _pv.rotationXy) { _pv.rotationXy = rotationXy; changed = true; }
  // tool_meta is null on the vast majority of ticks; the gateway sends a fresh
  // object only on a real change, so a reference compare is sufficient + cheap.
  if (toolMeta !== _pv.toolMeta) { _pv.toolMeta = toolMeta; changed = true; }
  if (changed) _needsRender = true;
}

function applyGcode(g: ViewerGcode) {
  // Owned by toolpathController; pass a fresh ctx with the reassigned
  // scene-graph pointers + per-program machine bounds/units.
  toolpath.apply(toolpathCtx(), g);
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
    const _tApply = performance.now();
    applyState(viewerInit.value, pendingState as ViewerState);
    recordApply(performance.now() - _tApply);
    pendingState = null;

    // Re-frame after first status update so camera accounts for actual axis positions
    if (_needsReframe && _iniBox && _workGrp) {
      _needsReframe = false;
      const box = _iniBox.clone().translate(_workGrp.position);
      frameToBounds(box);
    }
  }

  // Camera tracking — move both target and camera to maintain viewing angle.
  // Only flags a render if the tracked point actually moved this tick;
  // otherwise tracking-mode would force every frame even at machine idle.
  if (trackingMode !== "none" && controls && camera) {
    // getWorldPosition overwrites _trackTarget each frame; .sub() then turns it
    // into the delta in place — safe because we re-fetch before every use.
    // Reset first so a non-matching mode falls back to origin (as the old
    // fresh-Vector3 did) rather than reusing last frame's stale delta.
    _trackTarget.set(0, 0, 0);
    if (trackingMode === "tool" && toolMarker) {
      toolMarker.getWorldPosition(_trackTarget);
    } else if (trackingMode === "wcs" && workOrigin) {
      workOrigin.getWorldPosition(_trackTarget);
    }
    const delta = _trackTarget.sub(controls.target);
    if (delta.lengthSq() > 1e-12) {
      controls.target.add(delta);
      camera.position.add(delta);
      _needsRender = true;
    }
  }

  // Render-on-demand gate. Skip the prep-and-render block unless something
  // explicitly requested a render (state diff, controls 'change', layer
  // toggle, tracking delta, …) or a tween is in flight.
  if (!_needsRender && !_tweenRaf) return;

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
  const _tRender = performance.now();
  renderer?.render(scene!, camera!);
  recordRender(performance.now() - _tRender);

  // Orientation gizmo — always ortho, render into bottom-right viewport
  // (top-left is the HUD, top-right is the ViewCube + quick-grid).
  if (renderer && _gizmoScene && _gizmoCam && camera) {
    _gizmoCam.position.set(0, 0, 200).applyQuaternion(camera.quaternion);
    _gizmoCam.quaternion.copy(camera.quaternion);

    // Billboard gizmo labels
    _gizmoScene.traverse((c: any) => { if (c instanceof Text) c.quaternion.copy(_gizmoCam!.quaternion); });

    // setViewport/setScissor take CSS pixels — three.js multiplies by pixelRatio
    // internally. Passing framebuffer pixels (el.width) double-multiplies on
    // Retina (DPR=2), pushing the scene off the upper-right corner.
    const el = renderer.domElement;
    const w = el.clientWidth, h = el.clientHeight;
    const gs = GIZMO_SIZE;
    const gx = w - gs - 8, gy = 8;
    renderer.setViewport(gx, gy, gs, gs);
    renderer.setScissor(gx, gy, gs, gs);
    renderer.setScissorTest(true);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(_gizmoScene, _gizmoCam);
    renderer.setScissorTest(false);
    renderer.autoClear = true;
    renderer.setViewport(0, 0, w, h);
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

  // Leak probe (A2): live renderer resource counts for e2e/viewer.spec.ts.
  // Read straight off renderer.info so it reflects actual GPU-tracked
  // geometries/textures/programs at the moment of the call.
  window.__viewerLeakProbe = () => {
    if (!renderer) return null;
    return {
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      programs: renderer.info.programs?.length ?? 0,
    };
  };

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
  applyViewerDefaults();
});

// Idempotent re-apply of viewer defaults — called on mount and from the
// settingsVersion watcher when server settings arrive or another tab edits them.
function applyViewerDefaults() {
  // Machine edges FIRST: setMachineEdges (not a bare flag write — that never
  // built/hid the actual edge lines on a settings echo), and before the layer
  // loop because setLayerVisible('machine') reads the machineEdges flag.
  setMachineEdges(viewerDefaults.machineEdges);
  // Layer visibility, tracking, path-on-top
  for (const layer of ALL_LAYERS) setLayerVisible(layer, viewerDefaults.layers[layer]);
  setTrackingMode(viewerDefaults.trackingMode);
  setPathAlwaysOnTop(viewerDefaults.pathOnTop);

  // Projection: sync to the persisted value on EVERY apply (mount, settings
  // change, reset) — absolute set, not a blind toggle. Manual changes are
  // already persisted (SettingsPanel.onProjectionChange saves), so this can't
  // fight the user: when they match it's a no-op; on a reset it restores the
  // default. (Previously initialMount-gated, so a reset-to-parallel never took
  // until a browser reload.)
  const wantOrtho = viewerDefaults.projection === "parallel";
  if (isOrtho.value !== wantOrtho) switchProjection();

  // Live-updatable materials: colors on shared MAT instances propagate immediately.
  MAT.tool.color.set(viewerDefaults.colors.tool ?? "#c0c0c0");
  MAT.cutter.color.set(viewerDefaults.colors.cutter ?? "#ffdd00");
  // Toolpath/backplot/bounds line colors live too (they used to apply only at
  // line-creation time, so a colour change needed a program reload).
  applyPathColors(viewerDefaults.colors);

  // Per-part color overrides — re-apply via setMachinePartColor, which clones
  // on write (a direct mat.color.set here tinted the shared MAT.axis*/frame
  // instances session-permanently — no restore path exists for those). Passing
  // null reverts parts whose override was cleared in another tab. Meshes built
  // later read viewerDefaults directly during buildFromInit (clone-safe there).
  const _seenParts = new Set<string>();
  for (const mesh of machineMeshes) {
    const partId = mesh.userData.partId as string | undefined;
    if (!partId || _seenParts.has(partId)) continue;
    _seenParts.add(partId);
    setMachinePartColor(partId, viewerDefaults.machineColors[partId] ?? null);
  }
}

onUnmounted(() => {
  document.removeEventListener("visibilitychange", _onVisibilityChange);
  setViewerPerfContext(null);
  resizeObs?.disconnect();
  resizeObs = null;
  cancelAnimationFrame(raf);
  if (_tweenRaf) cancelAnimationFrame(_tweenRaf);
  _tweenRaf = 0;

  controls?.dispose();

  window.__viewerLeakProbe = undefined;
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
      setToolMeta(msg.data.tool_number, tm);
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

watch(() => props.surfacePoints, (pts) => {
  surface.build(viewerCtx(), pts ?? [], props.compGrid);
});

watch(() => props.compGrid, () => {
  if (props.surfacePoints?.length) surface.build(viewerCtx(), props.surfacePoints, props.compGrid);
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
        // Private clone — clear the _shared inherited from MAT.* via clone()
        // so teardown frees it (H4); tag it so a repeat colour reuses it.
        cloned.userData._shared = false;
        cloned.userData._clonedFor = partId;
        // Free the material we're replacing IF it was private (a prior
        // settings/colour clone). The base shared MAT.* (groupMat/MAT.frame) is
        // still used by other meshes — never dispose it (H4 leak: the replaced
        // private clone was orphaned and never freed).
        const prev = mesh.material as THREE.Material;
        mesh.material = cloned;
        cloned.color.set(color);
        if (prev !== cloned && prev.userData._shared !== true) prev.dispose();
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

// Live-update the per-program toolpath/backplot/bounds line colors on whatever
// lines currently exist (null-guarded; lines built later read the saved value
// at creation). Overflow/highlight lines keep their fixed warning colors.
type PathColors = { feed?: string; rapid?: string; backplot?: string; bounds?: string; toolpathBounds?: string };
function applyPathColors(c: PathColors) {
  toolpath.setColors({ feed: c.feed, rapid: c.rapid, toolpathBounds: c.toolpathBounds });
  if (c.backplot) backplot.setColor(c.backplot);
  if (machineBoundsMesh && c.bounds) (machineBoundsMesh.material as THREE.LineBasicMaterial).color.set(c.bounds);
}

/** Exposed instant path-colour update (parity with setToolColors). */
function setPathColors(c: PathColors) {
  applyPathColors(c);
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
  setPathColors,
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
  font-variant-numeric: tabular-nums;
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

