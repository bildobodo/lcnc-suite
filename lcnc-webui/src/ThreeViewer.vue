<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, reactive, ref, shallowRef, toRaw, watch, type Ref } from "vue";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Text } from "troika-three-text";
import { buildToolProfile, splitProfileAt, buildToolGeometry, buildHolderGeometry, type ToolMeta } from "./toolGeometry";
import { AXIS_HEX, AXIS_CSS } from "./axisColors";
import {
  failedParts, loadMachineAssets, getCachedGeometry, getToolMeta, setToolMeta, machineReady,
} from "./viewer/machineAssetCache";

import { viewerInit, viewerGcode, status, emitTelemetry, previewRefresh, previewRefreshElapsedMs, previewRefreshLabel, type ViewerInit, type ViewerGcode } from "./lcncWs";
import { loadViewerDefaults, loadCameraDefaults, saveCameraDefaults, ALL_LAYERS, settingsVersion, type Vec3, type Layer } from "./defaults";
import { INTERP_IDLE } from "./lcnc";
import { fmtCoord, fmtRpm } from "./format";
import { useAxes } from "./useAxes";
import { recordApply, recordRafTick, recordRender, setViewerPerfContext, setViewerPerfGl } from "./viewerPerf";
import { disposeObject } from "./viewer/disposal";
import { normalizeKinematics, type KinRuntime } from "./viewer/kinematics";
import { lineDistances, tipWcs, wcsTerms, type PartFrameMachine, type PartFrameWcs, anchorTerms, type AnchorTerms } from "./viewer/partFrame";
import type { LineIndex } from "./viewer/lineIndex";
import { MACHINE_PALETTE, defaultPartHex } from "./viewer/palette";
import { toolDimsFor } from "./viewer/tloEvents";
import { boundsOf, epochTermsFor, previewWcsStaleFor, rebasePositions, usedWcsRowsKey, type WcsTableRow } from "./viewer/wcsEpochs";
import { specFromWire } from "./viewer/kins";
import { workMarkers, markerInputsChanged, newMarkerInputsPrev, G5X_NAMES, type ProgramZeroPose } from "./viewer/programZero";
import { displayDecision } from "./viewer/displayPipeline";
import { trackHighlightRange } from "./trackHighlight";
import type { CollisionBody, CollisionResult, CollisionLineMark } from "./viewer/collision";
import { previewSchemaMismatch, parseTloMismatch, EXPECTED_PREVIEW_SCHEMA, type ScrubTrack } from "./ws/bulkData";
import { createBackplotController } from "./viewer/backplotController";
import { createSurfaceController } from "./viewer/surfaceController";
import { createToolpathController, type ToolpathCtx } from "./viewer/toolpathController";
import type { ViewerCtx } from "./viewer/viewerContext";
import ViewCube from "./ViewCube.vue";
import MachineBtn from "./MachineBtn.vue";
import CameraPip from "./CameraPip.vue";
import ScrubBar from "./ScrubBar.vue";
import { simMode } from "./simMode";
import { twpPoseStale, twpDatumStale, kinsModeChip, fixtureOffDatum, stampAForFixture } from "./twpPose";
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
  /** All nine fixture rows (lowercase axis letters + "r") — the per-epoch
   *  re-add source for multi-fixture previews (review P2). */
  wcs_table?: WcsTableRow[];

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

  // Kinematics-mode inputs for the active-fixture triad (2026-08-30): the
  // fixture's numbers are table-frame on identity/TCP but TOOL-frame under
  // kins 2 with a reserved fixture (G59..G59.3) active. All ride the same
  // status `data` object _twpRefresh already reads untyped.
  kins_type?: number | null;
  g5x_index?: number | null;
  kins_pre_rot?: number | null;
  kins_primary_angle?: number | null;
  kins_secondary_angle?: number | null;
  rotary_abc?: number[] | null;
  twp_defined?: boolean | null;
  /** The datum the plane rides on (the remap's G54), TABLE frame. */
  twp_datum?: number[] | null;
  twp_active?: boolean | null;
  twp_pose_a?: number | null;
  wcs_prov_a?: (number | null)[] | null;
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
  // Source line at the current scrub position (null = not scrubbing) — App
  // forwards it to GcodePanel for the code-view highlight.
  (e: "scrub-line", line: number | null): void;
  // Source lines with collision hits after a sweep (null = no/stale results,
  // [] = checked clean) — App forwards to GcodePanel for line markers.
  (e: "collision-lines", lines: CollisionLineMark[] | null): void;
  // The preview was parsed against offsets that are no longer live (touch-off
  // after load) — App re-parses it against current ones.
  (e: "reparse"): void;
}>();

// HUD data (read from status for template)
const vst = computed(() => status.value?.data ?? null);
// HUD mode line: the kins/TWP mode is otherwise visible only in the strip
// radios and the tiny fixture labels (operator-caught). ONE derivation with
// SetupStrip's chip (kinsModeChip) so the two can never disagree.
const hudMode = computed(() => {
  const d = vst.value;
  if (!d || d.kins_type == null) return null;
  return kinsModeChip({
    kinsType: d.kins_type,
    twpActive: d.twp_active,
    twpStale: twpPoseStale(d.twp_pose_a, d.rotary_abc?.[0], d.twp_defined),
    twpDatumMoved: twpDatumStale(d.wcs_table?.[0], d.twp_datum, d.twp_defined, d.wcs_prov_a?.[0]),
    offDatum: fixtureOffDatum(d.kins_type, stampAForFixture(d.wcs_prov_a, d.g5x_index), d.rotary_abc?.[0]),
    g5xIndex: d.g5x_index,
  });
});
const hudPlaneWord = computed(() => {
  const d = vst.value;
  if (!d?.twp_defined) return null;
  if (twpPoseStale(d.twp_pose_a, d.rotary_abc?.[0], d.twp_defined)) return "plane stale";
  return d.twp_active ? "plane active" : "plane defined";
});

// g5x index (1..9) -> label, matching the gateway's _G5X_MAP.
const WCS_LABELS = G5X_NAMES;
const wcsLabel = (idx: number) => WCS_LABELS[idx - 1] ?? `G5x#${idx}`;

// Fixtures the program actually CUTS IN that are not the active one.
//
// Straight from the parse: the canon samples the work system at every emitted
// segment, so M2's reset to G54 never counts and a mid-program switch cannot
// be missed. This replaced a regex over the first 8 KB of source that took the
// FIRST WCS word — which saw a preamble and nothing after it, so a program
// starting in G54 and later switching to G55 produced no hint at all.
//
// The hint is real and worth saying: such a program cuts THERE, not where the
// operator's DRO reads. It is NOT a statement about correctness — since the
// basis fix the preview is parsed against the ACTIVE WCS and the shipped
// points are right relative to it, whatever the program selects internally.
const foreignWcs = computed<string[]>(() => {
  const g = viewerGcode.value;
  // Epoch-aware payload (review P2): fixtures other than the active one are
  // TRACKED — every section renders against its own basis, so a foreign
  // fixture is normal operation, not a warning. The hint stays only for
  // legacy payloads whose sections would render displaced.
  if (g?.wcsEvents?.length) return [];
  const used: number[] | undefined = g?.wcs_used;
  const basis: number | null | undefined = g?.wcs_basis_index;
  if (!used?.length || basis == null) return [];
  return used.filter((i) => i !== basis).map(wcsLabel);
});

// Program-rewritten fixtures (review P2): the preview pins these epochs to
// the parse snapshot — live edits to that fixture's row do NOT move those
// sections (the program overwrites the row at run time anyway). Said in the
// HUD so a touch-off that "does nothing" is explained, not mysterious.
const rewrittenWcs = computed<string[]>(() => {
  const evs = viewerGcode.value?.wcsEvents;
  if (!evs?.length) return [];
  const idxs = [...new Set(evs.filter(e => e.rewritten && e.idx >= 1).map(e => e.idx))];
  return idxs.map(wcsLabel);
});

// Load-time lint (2026-09-03): the program switches kinematics and its last
// marker is not identity — M2 restores G54 but not the kins pin, so the run
// strands the machine in that frame and the NEXT program runs there too.
const kinsEndWarn = computed<{ text: string; title: string } | null>(() => {
  const k = viewerGcode.value?.kins_end_type;
  if (k == null || k === 0) return null;
  const mode = k === 1 ? "TCP" : "TOOL (plane)";
  const fix = k === 1 ? "M428" : "G69 (or M428)";
  return {
    text: `Program ends in ${mode} kinematics — add ${fix} before M2`,
    title: `The program's last kinematics switch leaves type ${k} in effect. M2 restores G54 but not the kinematics pin, so after the run the machine stays in the ${mode} frame and Cycle Start is refused until the Machine frame is restored.`,
  };
});

// Preview payload from a different wire-format generation than this client
// build (P1) — a gateway that outlived a code upgrade keeps serving its
// cached payload (keyed on file+mtime only), and a hot-reloaded client would
// otherwise mis-read or silently degrade on it. `got: null` = legacy
// unstamped payload. Reparse spawns a fresh worker from the code on disk,
// which republishes with the current stamp.
const previewSchemaStale = computed(() => previewSchemaMismatch(viewerGcode.value));

// Preview parsed with a different tool length than the live table now holds
// for the spindle tool (W2 P4) — the per-line limit flags are stale. The
// gateway auto-reparses when idle; this is the honest in-run signal.
const previewTloStale = computed(() =>
  parseTloMismatch(viewerGcode.value, vst.value?.tool_number, vst.value?.tool_length));

// Preview parsed against offsets that are no longer live — a touch-off after
// the file was loaded. Per FIXTURE on an epoch-aware payload (previewWcsStaleFor):
// the old active-vs-active comparison lit during every TWP run because the
// program itself switches G54→G59 at G53.x. `reparse_preview` makes them
// agree again — but it is idle-gated, so the chip is not offered as an action
// while the interpreter is busy.
const previewWcsStale = computed(() => {
  const g = viewerGcode.value;
  const s = vst.value;
  if (!g || !s) return false;
  return previewWcsStaleFor(
    g.wcsEvents, g.wcs_basis, s.wcs_table as WcsTableRow[] | undefined,
    { g5x: s.g5x_offset, g92: s.g92_offset, rotationDeg: s.rotation_xy });
});
const interpBusy = computed(() =>
  (vst.value?.interp_state ?? INTERP_IDLE) !== INTERP_IDLE);

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
// Baked-toolpath anchor: sibling of workOrigin, posed ONLY by toolpath.apply
// from the terms the drawn vertices were baked with (viewer/partFrame.ts
// anchorTerms). workOrigin keeps following the LIVE offsets for stock,
// surface map and axes; the toolpath must not, or it jumps ahead of its
// own re-bake (2026-09-03, operator-caught during a TWP run).
let pathAnchor: THREE.Group | null = null;
let pathRot: THREE.Group | null = null;
let _workGrp: THREE.Group | null = null;   // resolved from init.workGroup
let _toolGrp: THREE.Group | null = null;   // resolved from init.toolGroup

// Kinematics normalization lives in viewer/kinematics.ts — shared with the
// part-frame preview transform so both interpret machine.json identically.
// applyState() runs per animate frame; init.kinematics is stable across frames,
// so cache the normalized result by source identity and recompute only when
// init changes.
let _kinCacheSrc: ViewerInit["kinematics"] | null = null;
let _kinCacheVal: KinRuntime[] = [];
function normalizeKinematicsCached(kin: ViewerInit["kinematics"]): KinRuntime[] {
  if (kin === _kinCacheSrc) return _kinCacheVal;
  _kinCacheSrc = kin;
  _kinCacheVal = normalizeKinematics(kin);
  return _kinCacheVal;
}

// Static base position per group (the machine.json `translate`, unit-scaled),
// captured at scene build. applyState resets driven groups to these bases and
// composes DOFs on top, so a group can carry a static pivot offset AND any
// number of translate/rotate DOFs without them overwriting each other.
let _groupBase: Record<string, THREE.Vector3> = {};
const _toolBase = new THREE.Vector3();
// Reusable scratch — applyState is on the rAF hot path, keep it allocation-free.
const _kinQuat = new THREE.Quaternion();
const _tofsVec = new THREE.Vector3();

// Visual objects
let toolMarker: THREE.Group | null = null;
let toolCutterMesh: THREE.Mesh | null = null;
let toolBodyMesh: THREE.Mesh | null = null;
let holderMesh: THREE.Mesh | null = null;
let _currentToolNum: number | null = null;
let _lastToolMeta: ToolMeta | null = null;
let workAxes: THREE.Group | null = null;
// The active-fixture triad's OWN group under _workGrp (table frame). It used
// to hang under workRotGroup ← workOrigin, i.e. at the raw fixture numbers —
// wrong under TOOL kinematics with G59 active (TOOL-frame numbers drawn as
// table coordinates: "the work origin hangs in space"). workOrigin itself
// stays at the raw numbers on purpose: the toolpath is right there by
// cancellation (partFrame peels the same offset). See activeFixtureFrame.ts.
let workAxesGroup: THREE.Group | null = null;
// The muted "program zero (machine)" marker: under identity kins, while the
// table sits away from the active fixture's touch-off angle, the room-fixed
// spot identity kins will send the tool to at program zero — the OTHER
// answer to "where is zero" (viewer/programZero.ts). Same shape as the
// triad: arrows in `ghostAxes` (the workzero layer toggles them), posed
// through `ghostGroup`.
let ghostAxes: THREE.Group | null = null;
let ghostGroup: THREE.Group | null = null;
// Marker labels (billboarded troika text, registered in _billboardLabels):
// three near-identical unlabeled triads were genuinely ambiguous
// (operator-caught) — each marker now says what it is. The active-fixture
// label is dynamic (fixture name from g5x_index, "· machine" when the
// stamp cannot place it on the part).
let workAxesLabel: Text | null = null;
let ghostLabel: Text | null = null;
let twpPlaneLabel: Text | null = null;
// Program-zero marker inputs: the part-frame machine (built once per
// viewer_init — _pfMachine JSON-copies, and programZero memoizes the chain
// by object identity) and the marker-only repaint diff.
let _markerMachine: PartFrameMachine | null = null;
let _markerDirty = true;
const _pvMarker = newMarkerInputsPrev();
const _markerScratch: { primary: ProgramZeroPose; ghost: ProgramZeroPose } = {
  primary: { pos: [0, 0, 0], x: [0, 0, 0], y: [0, 0, 0], z: [0, 0, 0] },
  ghost: { pos: [0, 0, 0], x: [0, 0, 0], y: [0, 0, 0], z: [0, 0, 0] },
};
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
  /** Live fixture table (value-keyed — rows are re-copied each publish).
   *  A WCS-epoch preview re-adds per-fixture rows, so table edits must
   *  refresh the preview exactly like the active-fixture terms do. */
  wcsTableKey: string; wcsTable: WcsTableRow[] | null;
} = {
  jointPos: null, machinePos: null, g5x: null, g92: null, toolOffset: null,
  toolNum: NaN as unknown as number, toolDiam: NaN, toolLen: NaN,
  toolMeta: undefined, motionLine: NaN, rotationXy: NaN,
  wcsTableKey: "", wcsTable: null,
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

// ---- TWP plane visualization (P3.4) ----
// The live tilted-work-plane, drawn from the twp-helper comp's plane pins
// (status twp_plane: [ox,oy,oz, zx,zy,zz, xx,xy,xz], TABLE frame — the
// frame in which a table-fixed feature has constant coordinates, datum'd
// to coincide with machine coords at A=0; see status_runtime
// assemble_twp_plane and remap.py gui_update_twp).
// The group is attached under _workGrp (the A table's work group), whose
// local frame IS the table frame — applyState rotates it by the live A, so
// the plane rides the workpiece and is exact at EVERY table angle. The
// earlier MACHINE-frame pins drawn in this same rotating group double-
// counted A (wrong by the table angle, cancelling only at A=0); the
// table-frame storage is what removed that, not a change here. Not the
// scene root either: model chains carry static base translates (trsrn head
// chain at (-1000,1000,2000)), so a scene-root attach lands the plane a
// frame-offset away from the machine (operator-caught: invisible below the
// floor). Same attach rule as machineBoundsMesh. Heidenhain's simulation
// and the upstream TWP VTK GUI both draw this; the marker comments only
// ever carried it as numbers. Info-blue while TOOL kins is active;
// warn-amber when a plane is defined but the kins is back to identity
// (defined-but-inactive — the parked-in-TWP trap made visible). During
// simulation the PROGRAM's plane (viewer/twpPlaneFrame.ts) replaces it.
let twpPlaneGroup: THREE.Group | null = null;
let twpNormalArrow: THREE.ArrowHelper | null = null;
let twpPlaneMat: THREE.MeshBasicMaterial | null = null;
let twpGridMat: THREE.LineBasicMaterial | null = null;
let _twpLayerOn = true;
const _TWP_ACTIVE_HEX = 0x4aa3ff;   // matches the info-blue family
const _TWP_INACTIVE_HEX = 0xffb347; // matches the warn-amber family
const _TWP_STALE_HEX = 0xcc3333;    // matches the danger family

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
// the HUD overflow ref) are bound once; apply() takes a fresh ToolpathCtx
// with the reassigned scene-graph pointers (never cached). The overflow ref
// is set from the per-line VALIDATOR at apply time — one source of truth
// with the marked lines (the old per-tick geometric box is gone).
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
  // Stale-path opacity from the design token (never a bare number here).
  staleOpacity: () => {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--opacity-disabled"));
    return Number.isFinite(v) ? v : 0.4;
  },
  // The mute mixes toward this, OPAQUE — see ToolpathDeps.staleOpacity.
  sceneBackground: () => (scene?.background instanceof THREE.Color ? scene.background : sceneBgFromTheme()),
});
// A stale drawn path is muted (2026-09-05): while the gateway re-parses,
// or while the payload's fixture offsets / tool length are known to
// differ from the live ones, the operator sees "not current" on the
// geometry itself, not only in a chip.
const pathStaleNow = computed(() => !!previewRefresh.value || previewWcsStale.value || !!previewTloStale.value);
watch(pathStaleNow, (stale) => { toolpath.setStale(stale); requestRender(); }, { immediate: true });
// Reused ctx object: a fresh object per call is avoidable gen-0 churn (GC
// pauses here are object-count driven). Safe to mutate in place —
// controllers read ctx fields synchronously and never retain it (contract in
// viewerContext.ts).
const _toolpathCtx: ToolpathCtx = {
  scene: null, workOrigin: null, workRotGroup: null, pathAnchor: null, pathRot: null,
  pathAlwaysOnTop: false, machineBounds: undefined, units: undefined,
};
function toolpathCtx(): ToolpathCtx {
  _toolpathCtx.scene = scene;
  _toolpathCtx.workOrigin = workOrigin;
  _toolpathCtx.workRotGroup = workRotGroup;
  _toolpathCtx.pathAnchor = pathAnchor;
  _toolpathCtx.pathRot = pathRot;
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

// TWP plane pose/tint update (P3.4). Signature-gated: the status watcher
// calls this every tick, but pose math + re-render run only when the plane
// values, kins type, or layer toggle actually changed.
let _twpSig = "";
const _fixM = new THREE.Matrix4(), _fixX = new THREE.Vector3(), _fixY = new THREE.Vector3(), _fixZ = new THREE.Vector3();
const _twpZ = new THREE.Vector3();
const _twpX = new THREE.Vector3();
const _twpY = new THREE.Vector3();
const _twpM = new THREE.Matrix4();

// The PROGRAM's plane while simulating (from ScrubBar), null otherwise.
let _scrubPlane: number[] | null = null;

function _twpRefresh() {
  const d: any = status.value?.data;
  if (simMode.value || _scrubJoints) {
    // Simulating: the model shows the PROGRAM, so the overlay must too.
    // No plane data for this point means the program has not established
    // one there — HIDE it. Falling through to live status would put a
    // machine fact on screen beside a simulated machine, which is the
    // incoherence this exists to remove. Staleness is a claim about the
    // live setup and is meaningless here, so it is never applied in sim.
    updateTwpPlane(_scrubPlane, _scrubPlane != null, 2, false, false);
    return;
  }
  updateTwpPlane(d?.twp_plane, !!d?.twp_defined, d?.kins_type,
    twpPoseStale(d?.twp_pose_a, d?.rotary_abc?.[0], d?.twp_defined),
    twpDatumStale(d?.wcs_table?.[0], d?.twp_datum, d?.twp_defined, d?.wcs_prov_a?.[0]));
}

function updateTwpPlane(plane: unknown, defined: boolean, ktype: unknown, stale: boolean, datumStale = false) {
  if (!twpPlaneGroup) return;
  const ok = defined && Array.isArray(plane) && plane.length === 9 &&
    (plane as unknown[]).every((v) => Number.isFinite(Number(v)));
  const k = ktype == null ? -1 : Math.round(Number(ktype));
  // `stale` joins the signature or the tint would never repaint — a boolean,
  // so live A jitter under the eps costs nothing.
  const sig = ok
    ? `${(plane as number[]).map((v) => Number(v).toFixed(4)).join(",")}|${k}|${_twpLayerOn}|${stale}|${datumStale}|${simMode.value}`
    : `off|${simMode.value}`;
  if (sig === _twpSig) return;
  _twpSig = sig;
  if (!ok || !_twpLayerOn) {
    if (twpPlaneGroup.visible) { twpPlaneGroup.visible = false; requestRender(); }
    return;
  }
  const p = (plane as number[]).map(Number);
  _twpZ.set(p[3]!, p[4]!, p[5]!);
  if (_twpZ.lengthSq() < 1e-9) {
    // A defined plane with a zero normal is not drawable — hide, honestly.
    if (twpPlaneGroup.visible) { twpPlaneGroup.visible = false; requestRender(); }
    return;
  }
  _twpZ.normalize();
  _twpX.set(p[6]!, p[7]!, p[8]!);
  _twpX.addScaledVector(_twpZ, -_twpX.dot(_twpZ));
  if (_twpX.lengthSq() < 1e-9) {
    // Degenerate X (parallel to the normal): any in-plane X will do for
    // drawing — derive one from the least-aligned world axis.
    _twpX.set(1, 0, 0);
    if (Math.abs(_twpZ.x) > 0.9) _twpX.set(0, 1, 0);
    _twpX.addScaledVector(_twpZ, -_twpX.dot(_twpZ));
  }
  _twpX.normalize();
  _twpY.crossVectors(_twpZ, _twpX);
  _twpM.makeBasis(_twpX, _twpY, _twpZ);
  twpPlaneGroup.quaternion.setFromRotationMatrix(_twpM);
  twpPlaneGroup.position.set(p[0]!, p[1]!, p[2]!);   // machine units = world units
  // The tint is an ATTENTION signal, not a claim: the plane itself still
  // rides the workpiece when the head solve goes stale, and the CHIP title
  // says which claim it is (head off-normal vs. a datum G54 has since
  // left). 2026-08-31 moved head-stale onto the 48 mm +Z arrow alone on the
  // "plane is not the stale thing" argument — semantically right, visually
  // invisible beside a 300 mm quad (operator: "why does a stale plane not
  // become red anymore?"). Either claim paints quad + grid; the arrow keeps
  // the head-stale tint as the pointer to WHAT is off.
  const hex = (stale || datumStale) ? _TWP_STALE_HEX : k === 2 ? _TWP_ACTIVE_HEX : _TWP_INACTIVE_HEX;
  if (twpNormalArrow) {
    (twpNormalArrow.line.material as THREE.LineBasicMaterial).color
      .setHex(stale ? _TWP_STALE_HEX : AXIS_HEX.z);
    (twpNormalArrow.cone.material as THREE.MeshBasicMaterial).color
      .setHex(stale ? _TWP_STALE_HEX : AXIS_HEX.z);
  }
  if (twpPlaneMat) twpPlaneMat.color.setHex(hex);
  if (twpGridMat) twpGridMat.color.setHex(hex);
  twpPlaneGroup.visible = true;
  requestRender();
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
      // One layer for both "where is zero" markers: the active triad and
      // the muted "program zero (machine)" ghost (a tenth toggle for a
      // second marker of the same question would be toggle sprawl).
      if (workAxes) workAxes.visible = on;
      if (ghostAxes) ghostAxes.visible = on;
      break;
    case "workplane":
      _twpLayerOn = on;
      _twpSig = "";   // force the next refresh to re-evaluate visibility
      _twpRefresh();
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

// Machine-part defaults come from viewer/palette.ts (one table for the
// scene build, the live recolor and the settings pickers).
MAT.frame.color.setHex(MACHINE_PALETTE.frame);
MAT.axisX.color.setHex(MACHINE_PALETTE.x);
MAT.axisY.color.setHex(MACHINE_PALETTE.y);
MAT.axisZ.color.setHex(MACHINE_PALETTE.z);
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
  workAxesGroup = null;
  ghostAxes = null;
  ghostGroup = null;
  machineBoundsMesh = null;
  twpNormalArrow = null;
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

  // Capture each group's static base position (unit-scaled translate).
  // applyState resets kinematics-driven groups to these and composes DOFs on
  // top — static pivots survive translate DOFs on the same axis.
  _groupBase = {};
  for (const [id, g] of Object.entries(groups)) _groupBase[id] = g.position.clone();

  // Resolve work/tool group references
  _workGrp = groups[init.workGroup ?? grpDefs[0]?.id ?? "root"] ?? groups.root;
  _toolGrp = groups[init.toolGroup ?? "tool"] ?? groups.root;
  _toolBase.copy(_toolGrp.position);

  // Work origin (DRO zero frame) — attached to the work/table group
  workOrigin = new THREE.Group();
  _workGrp.add(workOrigin);

  // Rotated sub-group: stock, axes, overflow, surface, toolpath all rotate
  // with the live WCS R value. Worker un-rotates vertices at parse time so
  // the toolpath is in raw program coords — rotation is applied here.
  workRotGroup = new THREE.Group();
  workOrigin.add(workRotGroup);

  // Baked-toolpath anchor (see the declaration comment): same parent as
  // workOrigin, posed by toolpath.apply only.
  pathAnchor = new THREE.Group();
  _workGrp.add(pathAnchor);
  pathRot = new THREE.Group();
  pathAnchor.add(pathRot);

  // Work zero XYZ arrows (color identifies axis — no text labels)
  workAxes = new THREE.Group();
  const _al = 60 * _unitScale;
  const _ah = _al * 0.15, _aw = _al * 0.08;
  workAxes.add(new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(), _al, AXIS_HEX.x, _ah, _aw));
  workAxes.add(new THREE.ArrowHelper(new THREE.Vector3(0,1,0), new THREE.Vector3(), _al, AXIS_HEX.y, _ah, _aw));
  workAxes.add(new THREE.ArrowHelper(new THREE.Vector3(0,0,1), new THREE.Vector3(), _al, AXIS_HEX.z, _ah, _aw));

  // Posed by placeWorkMarkers (NOT under workOrigin — see the declaration
  // comment).
  workAxesGroup = new THREE.Group();
  workAxesGroup.add(workAxes);
  workAxesLabel = mkTextLabel("", "#" + AXIS_HEX.z.toString(16).padStart(6, "0"), _al * 0.28);
  workAxesLabel.position.set(0, 0, _al * 1.35);
  workAxesGroup.add(workAxesLabel);
  _billboardLabels.push(workAxesLabel);
  _workGrp.add(workAxesGroup);

  // The muted "program zero (machine)" marker — the same arrows at 0.6× and
  // half opacity, its own posed group; viewer/programZero.ts decides when.
  ghostAxes = new THREE.Group();
  const _dl = _al * 0.6;
  for (const [dir, hex] of [[[1, 0, 0], AXIS_HEX.x], [[0, 1, 0], AXIS_HEX.y], [[0, 0, 1], AXIS_HEX.z]] as const) {
    const ah = new THREE.ArrowHelper(new THREE.Vector3(...dir), new THREE.Vector3(), _dl, hex, _dl * 0.15, _dl * 0.08);
    (ah.line.material as THREE.LineBasicMaterial).transparent = true;
    (ah.line.material as THREE.LineBasicMaterial).opacity = 0.5;
    (ah.cone.material as THREE.MeshBasicMaterial).transparent = true;
    (ah.cone.material as THREE.MeshBasicMaterial).opacity = 0.5;
    ghostAxes.add(ah);
  }
  ghostLabel = mkTextLabel("program zero (machine)", "#" + AXIS_HEX.z.toString(16).padStart(6, "0"), _dl * 0.35);
  (ghostLabel as unknown as { fillOpacity: number }).fillOpacity = 0.6;
  ghostLabel.position.set(0, 0, _dl * 1.4);
  ghostAxes.add(ghostLabel);
  _billboardLabels.push(ghostLabel);
  ghostGroup = new THREE.Group();
  ghostGroup.add(ghostAxes);
  ghostGroup.visible = false;
  _workGrp.add(ghostGroup);

  // ---- TWP plane (P3.4) — machine frame, hidden until a plane is defined ----
  {
    twpPlaneGroup = new THREE.Group();
    twpPlaneGroup.visible = false;
    const _ps = 300 * _unitScale;   // 300 mm-equivalent square
    twpPlaneMat = new THREE.MeshBasicMaterial({
      color: _TWP_ACTIVE_HEX, transparent: true, opacity: 0.12,
      side: THREE.DoubleSide, depthWrite: false,
    });
    twpPlaneGroup.add(new THREE.Mesh(new THREE.PlaneGeometry(_ps, _ps), twpPlaneMat));
    // Grid: hand-built LineSegments (GridHelper bakes vertex colors, which
    // would defeat the active/inactive tint swap).
    {
      const div = 10, half = _ps / 2, pos: number[] = [];
      for (let i = 0; i <= div; i++) {
        const c = -half + (i * _ps) / div;
        pos.push(c, -half, 0, c, half, 0, -half, c, 0, half, c, 0);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      twpGridMat = new THREE.LineBasicMaterial({
        color: _TWP_ACTIVE_HEX, transparent: true, opacity: 0.35, depthWrite: false,
      });
      twpPlaneGroup.add(new THREE.LineSegments(g, twpGridMat));
    }
    // Origin triad in the PLANE's frame — Z is the plane normal (= tool
    // axis when TOOL kins is active).
    // 48 (was 80): the ACTIVE triad (60) is the DRO's truth and must
    // dominate — the plane's dominant cue is the 300 mm quad, not its triad.
    const _tl = 48 * _unitScale, _th = _tl * 0.15, _tw = _tl * 0.08;
    twpPlaneGroup.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), _tl, AXIS_HEX.x, _th, _tw));
    twpPlaneGroup.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), _tl, AXIS_HEX.y, _th, _tw));
    // +Z is the TOOL-NORMAL claim, so it is the element that carries the
    // stale warning (see updateTwpPlane) — keep a handle on it.
    twpNormalArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), _tl, AXIS_HEX.z, _th, _tw);
    twpPlaneGroup.add(twpNormalArrow);
    twpPlaneLabel = mkTextLabel("Plane", "#" + _TWP_ACTIVE_HEX.toString(16).padStart(6, "0"), _tl * 0.45);
    twpPlaneLabel.position.set(0, 0, _tl * 1.5);
    twpPlaneGroup.add(twpPlaneLabel);
    _billboardLabels.push(twpPlaneLabel);
    // _workGrp local frame = machine coordinates (see header comment) — and
    // the fresh group starts hidden, so the stale signature must be cleared
    // or an unchanged status would skip re-showing it after a rebuild.
    _workGrp!.add(twpPlaneGroup);
    _twpSig = "";
    _twpRefresh();
  }

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
    // Program-zero markers evaluate the same chain the part-frame worker
    // gets; one instance per build so the memoized chain stays warm.
    _markerMachine = _pfMachine(init);
    _markerDirty = true;
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

    // Build group → material map from kinematics direction. Axis colors mark
    // LINEAR axes; rotary groups keep the frame material (machine.json part
    // colors are the intended way to distinguish rotary assemblies).
    const kinEntries = normalizeKinematicsCached(init.kinematics);
    const dirMat: Record<string, THREE.MeshStandardMaterial> = { x: MAT.axisX, y: MAT.axisY, z: MAT.axisZ };
    const groupMat: Record<string, THREE.MeshStandardMaterial> = {};
    _groupDirMap = {};
    _partGroupMap = {};
    for (const k of kinEntries) {
      const lindir = !k.rotate ? k.direction : null;
      groupMat[k.group] = (lindir ? dirMat[lindir] : null) ?? MAT.frame;
      _groupDirMap[k.group] = lindir;
    }

    const parts = init.parts ?? [];
    for (const p of parts) {
      const geom = getCachedGeometry(p.id);
      if (!geom) { console.warn(`No cached geometry for ${p.id}`); continue; }

      const grp = p.group ?? p.parent ?? null;  // support both new and legacy field names
      _partGroupMap[p.id] = grp;
      let mat: THREE.MeshStandardMaterial = (grp ? groupMat[grp] : null) ?? MAT.frame;

      // Per-part color override from settings; falls back to the optional
      // machine.json default color ([r,g,b] 0–1) when no override is set.
      const customColor = viewerDefaults.machineColors[p.id];
      if (customColor || p.color) {
        mat = mat.clone();
        // clone() deep-copies userData, so this inherited the shared MAT.*'s
        // _shared=true — clear it: this is a PRIVATE per-part clone that
        // disposeObject must free on teardown (else it leaks per rebuild).
        mat.userData._shared = false;
        // Tag like setMachinePartColor's clones so its revert/reuse paths
        // treat this clone identically (null → revert to default colour).
        mat.userData._clonedFor = p.id;
        if (customColor) mat.color.set(customColor);
        else mat.color.setRGB(p.color![0], p.color![1], p.color![2], THREE.SRGBColorSpace);
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
    emitTelemetry("viewer.build_failed", { error: String(err) });
    window.__viewerDiag = { ready: false, error: (err as Error).message };
  }
}

function applyState(init: ViewerInit, st: ViewerState) {
  // Drive machine axes from JOINT positions (spindle nose / carriage reference)
  const jp = st.joint_pos;
  if (!jp) return;

  if (!_workGrp || !_toolGrp) return;
  _lastState = st;

  const kinEntries = normalizeKinematicsCached(init.kinematics);
  // Scrub pose override: a non-null scrub value substitutes for the live
  // joint; null entries (UVW) and out-of-range indices fall back to live.
  const sj = _scrubJoints;
  const ax = (idx: number) => {
    if (sj && idx >= 0 && idx < sj.length) {
      const v = sj[idx];
      if (v != null) return v;
    }
    return idx >= 0 && idx < jp.length ? jp[idx]! : 0;
  };

  // Apply kinematics in three phases so transforms COMPOSE instead of
  // overwrite — a group may carry a static pivot translate plus any number of
  // translate/rotate DOFs (compound slides, trunnions), in any machine layout.
  //
  // Phase 1 — reset every driven group (and the tool group, which phase 3
  // composes onto) to its static base from machine.json.
  _toolGrp.position.copy(_toolBase);
  for (const k of kinEntries) {
    const g = groups[k.group];
    if (!g) continue;
    const base = _groupBase[k.group];
    if (base) g.position.copy(base);
    else g.position.set(0, 0, 0);
    g.quaternion.identity();
  }

  // Phase 2 — compose DOFs in machine.json order: translations accumulate
  // along their (precomputed unit) axes, rotations right-multiply, so multiple
  // entries per group are well-defined.
  for (const k of kinEntries) {
    const g = groups[k.group];
    if (!g) continue;
    const val = ax(k.joint) * k.sign;
    if (k.rotate) {
      _kinQuat.setFromAxisAngle(k.axisVec, THREE.MathUtils.degToRad(val));
      g.quaternion.multiply(_kinQuat);
    } else {
      g.position.addScaledVector(k.axisVec, val);
    }
  }

  // Phase 3 — tool spatial compensation: put the tool TIP at TCP by shifting
  // the tool group by -tool_offset relative to its (base or DOF-composed)
  // position. Under a scrub pose the SAMPLE's offset is what its joints were
  // lifted with (schema 8) — live tool_offset would put the tip a tool-length
  // delta off the path after an in-program G43 (the fresh-boot 22.000 class).
  const tofs = (_scrubJoints && _scrubTlo) ? _scrubTlo : st.tool_offset;
  if (tofs && tofs.length >= 3) {
    _toolGrp.position.sub(_tofsVec.set(tofs[0] ?? 0, tofs[1] ?? 0, tofs[2] ?? 0));
  }

  // Work origin offset: place DRO/work zero in machine space. RS274 order
  // (rotate_and_translate): machine = g5x + Rz(θ)·(program + g92), so the
  // effective origin is g5x + Rz(θ)·g92 — workRotGroup (child) applies the
  // rotation to program coords AND the g92 vector's share lives here. A
  // plain g5x+g92 sum deviates whenever G92 and G10 R are both active.
  // ONE formula with the baked-toolpath anchor (anchorTerms) so the live
  // origin and a baked path's anchor can never disagree; scratch objects
  // keep the per-frame loop allocation-free.
  _liveWcs.g5x = st.g5x_offset ?? _EMPTY_NUMS;
  _liveWcs.g92 = st.g92_offset ?? _EMPTY_NUMS;
  _liveWcs.rotationDeg = st.rotation_xy ?? 0;
  anchorTerms(_liveWcs, _liveAnchor);
  if (workOrigin) {
    workOrigin.position.set(_liveAnchor.ox, _liveAnchor.oy, _liveAnchor.oz);
  }
  if (workRotGroup) {
    workRotGroup.rotation.z = _liveAnchor.thetaDeg * Math.PI / 180;
  }
  // The active-fixture triad and the machine ghost are posed by
  // placeWorkMarkers at the tail of this function (after the render diff).

  // ---- Tool visual: parametric profile (TIP stays at local z=0) ----
  {
    const liveToolNum = st.tool_number ?? null;
    // While scrubbing, the marker wears the SAMPLE's tool (schema 8): dims
    // from the parse-time table row, meta only if that tool was ever loaded
    // this session (getToolMeta) — never the loaded tool's meta on another
    // tool's dims. Leaving sim restores the loaded tool.
    const scrubTool = (_scrubJoints && _scrubTool != null && _scrubTool > 0 && _scrubTool !== liveToolNum)
      ? _scrubTool : null;
    const toolNum = scrubTool ?? liveToolNum;
    const meta: ToolMeta | null = scrubTool != null
      ? (getToolMeta(scrubTool) ?? null) : (st.tool_meta ?? null);
    let diamRaw: number | null | undefined = st.tool_diameter;
    let lenRaw: number | null | undefined = st.tool_length;
    if (scrubTool != null) {
      const d = toolDimsFor(scrubTool, viewerGcode.value?.parse_tlos, _unitScale, { diam: null, len: null });
      diamRaw = d.diam; lenRaw = d.len;
    }
    const { diam, len: visLen } = _toolVisual(diamRaw, lenRaw);

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
        if (toolNum != null && scrubTool == null) setToolMeta(toolNum, meta);
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
  // Never while scrubbing — the scrub pose is display-only and must not
  // fabricate machine motion history in the backplot.
  if (toolMarker && _workGrp && !_scrubJoints) {
    toolMarker.getWorldPosition(_bpWorld);
    // worldToLocal mutates its argument in place, so convert a copy. Refresh
    // the work group's world matrix through its ANCESTORS first: the tool
    // chain was just walked by getWorldPosition, but the table chain was
    // not, and a stale a_table rotation put backplot points one frame off.
    _workGrp.updateWorldMatrix(true, false);
    _bpLocal.copy(_bpWorld);
    _workGrp.worldToLocal(_bpLocal);
    backplot.push(_bpLocal.x, _bpLocal.y, _bpLocal.z);
  }

  // ---- Highlight current motion line in toolpath ----
  // Positional first (review P3): the track-index range from the playhead /
  // scrub sample addresses the path directly — line numbers cannot once a
  // called sub's numbering collides with the main file's. Fall back to the
  // line-number path only on legacy tracks, and suppress it entirely when
  // the payload's line attribution is untrusted (a confidently wrong
  // highlight is worse than none).
  const hlRange = trackHighlightRange.value;
  if (hlRange) {
    toolpath.setHighlightTrackRange(hlRange);
  } else if (viewerGcode.value?.lines_untrusted) {
    toolpath.setHighlight(null);
  } else {
    toolpath.setHighlight(_scrubJoints ? _scrubLineNo : curLine);
  }

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
  if (_numArrChanged(_pv.g5x, st.g5x_offset)) { _pv.g5x = st.g5x_offset ? [...st.g5x_offset] : null; changed = true; _markerDirty = true; _pfScheduleWcsRefresh(); _colOnInputChange(); }
  if (_numArrChanged(_pv.g92, st.g92_offset)) { _pv.g92 = st.g92_offset ? [...st.g92_offset] : null; changed = true; _markerDirty = true; _pfScheduleWcsRefresh(); _colOnInputChange(); }
  // tool_offset is a transform input (joint-space math is G43-inclusive):
  // refresh the part-frame preview and re-run the sweep like any WCS change.
  if (_numArrChanged(_pv.toolOffset, st.tool_offset)) { _pv.toolOffset = st.tool_offset ? [...st.tool_offset] : null; changed = true; _markerDirty = true; _pfScheduleWcsRefresh(); _colOnInputChange(); }
  if (toolNum !== _pv.toolNum) { _pv.toolNum = toolNum; changed = true; }
  if (toolDiam !== _pv.toolDiam) { _pv.toolDiam = toolDiam; changed = true; _colOnInputChange(); }
  if (toolLen !== _pv.toolLen) { _pv.toolLen = toolLen; changed = true; _colOnInputChange(); }
  if (motionLine !== _pv.motionLine) { _pv.motionLine = motionLine; changed = true; }
  if (rotationXy !== _pv.rotationXy) { _pv.rotationXy = rotationXy; changed = true; _markerDirty = true; _pfScheduleWcsRefresh(); _colOnInputChange(); }
  // Fixture-table edits (review P2): only the rows the payload's
  // non-rewritten epochs actually RE-ADD participate in the change key
  // (W2 P5 — wcs_frames ships on every modern payload, so keying on the
  // whole stringified table made every idle table publish a change).
  if (viewerGcode.value?.wcsEvents?.length) {
    const tk = usedWcsRowsKey(viewerGcode.value.wcsEvents,
                              st.wcs_table as WcsTableRow[] | undefined);
    if (tk !== _pv.wcsTableKey) {
      _pv.wcsTableKey = tk;
      _pv.wcsTable = (st.wcs_table as WcsTableRow[] | undefined) ?? null;
      changed = true;
      _pfScheduleWcsRefresh(); _colOnInputChange();
    }
  }
  // tool_meta is null on the vast majority of ticks; the gateway sends a fresh
  // object only on a real change, so a reference compare is sufficient + cheap.
  if (toolMeta !== _pv.toolMeta) { _pv.toolMeta = toolMeta; changed = true; }
  // Program-zero markers: their inputs (kins type, fixture index, plane
  // pins, table pose, stamps, scrub) were never in this diff, so an M428
  // re-posed the triad without a repaint until the next jog (operator-
  // caught). Placed AFTER the diff so _pfWcs() reads the refreshed terms.
  if (markerInputsChanged(_pvMarker, st, !!_scrubJoints)) _markerDirty = true;
  if (_markerDirty) { _markerDirty = false; placeWorkMarkers(st); changed = true; }
  if (changed) _needsRender = true;
}

/** Pose the active-fixture triad and the machine ghost from the rule table
 *  in viewer/programZero.ts (pure — the scene only draws its answer). The
 *  groups hang under _workGrp, so a part-riding pose rides the table and
 *  the ghost's table-local coordinates hold it still in the room. */
function placeWorkMarkers(st: ViewerState) {
  if (!_markerMachine || !workAxesGroup || !ghostGroup) return;
  const trio = (typeof st.kins_pre_rot === "number" && typeof st.kins_primary_angle === "number"
    && typeof st.kins_secondary_angle === "number")
    ? [st.kins_pre_rot, st.kins_primary_angle, st.kins_secondary_angle] : null;
  const m = workMarkers({
    machine: _markerMachine, wcs: _pfWcs(), kinsType: st.kins_type, g5xIndex: st.g5x_index,
    frame: trio, rotaryAbc: st.rotary_abc, provA: st.wcs_prov_a, scrub: !!_scrubJoints,
  }, _markerScratch);
  _poseMarker(workAxesGroup, m.primary?.pose ?? null);
  if (m.primary && workAxesLabel && workAxesLabel.text !== m.primary.label) {
    workAxesLabel.text = m.primary.label;
    workAxesLabel.sync();
  }
  _poseMarker(ghostGroup, m.ghost);
}
function _poseMarker(g: THREE.Group, p: ProgramZeroPose | null) {
  if (!p) { g.visible = false; return; }
  g.position.set(p.pos[0], p.pos[1], p.pos[2]);
  _fixM.makeBasis(_fixX.set(...p.x), _fixY.set(...p.y), _fixZ.set(...p.z));
  g.quaternion.setFromRotationMatrix(_fixM);
  g.visible = true;
}

// ---- Part-frame ("path on part") preview — rotary-aware toolpath ----
// When the program sweeps a rotary axis (viewerGcode carries feedAbc/rapidAbc)
// and the machine's work/tool chain has a rotary DOF, the programmed XYZ
// polyline is not the tool-versus-workpiece path. partFrameWorker resamples
// and transforms it through the machine.json chain (same kinematic truth as
// the live scene) so the preview overlays the backplot. The controller is
// mode-blind: it just receives a derived ViewerGcode. Bounds/overflow stay in
// programmed (machine) space — that is the correct space for machine limits.
let _pfWorker: Worker | null = null;
let _pfReqId = 0;
// Resident-payload bookkeeping (item 7, 2026-09-05): which ViewerGcode the
// worker currently holds, and its id on the wire. A transform request
// carries only the terms; the streams cross once per program.
let _pfLoadedFor: ViewerGcode | null = null;
let _pfPayloadId = 0;
let _pfAppliedMode: "part" | "programmed" | null = null;
// The anchor the in-flight part-frame request was baked against — applied
// together with its reply (never from live status).
let _pfAnchorFor: { id: number; anchor: AnchorTerms } | null = null;
const _EMPTY_NUMS: number[] = [];
const _liveWcs: PartFrameWcs = { g5x: _EMPTY_NUMS, g92: _EMPTY_NUMS, rotationDeg: 0 };
const _liveAnchor: AnchorTerms = { ox: 0, oy: 0, oz: 0, thetaDeg: 0 };
let _pfWcsTimer: ReturnType<typeof setTimeout> | undefined;

function _pfGetWorker(): Worker {
  if (!_pfWorker) {
    _pfWorker = new Worker(new URL("./viewer/partFrameWorker.ts", import.meta.url), { type: "module" });
    _pfWorker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { id: number; error?: string; needPayload?: number; feedPos?: Float32Array; feedLines?: Uint32Array; feedLineIndex?: LineIndex; rapidPos?: Float32Array; rapidDist?: Float32Array; feedBreaks?: Uint32Array; rapidBreaks?: Uint32Array; feedSrc?: Uint32Array };
      if (m.id !== _pfReqId) return;  // superseded
      const g = viewerGcode.value;
      if (!g) return;
      if (m.needPayload != null) {
        // The worker does not hold this program (recreated, or a transform
        // that raced a program change): re-send the streams and retry once.
        _pfLoadedFor = null;
        applyGcode(g);
        return;
      }
      if (m.error) {
        console.error("[partFrame] transform failed — programmed preview used:", m.error);
        _applyProgrammed(g);
        requestRender();
        return;
      }
      const out: ViewerGcode = {
        ...g,
        feedPos: m.feedPos, feed_lines: m.feedLines, feedLineIndex: m.feedLineIndex,
        rapidPos: m.rapidPos, rapidDist: m.rapidDist,
        feedBreaks: m.feedBreaks, rapidBreaks: m.rapidBreaks,
        feedSrc: m.feedSrc,
      };
      if ((g.wcsEvents?.length ?? 0) > 1) {
        // Multi-epoch payload: the shipped bounds boxes mix frames. The
        // part-frame output is already in the live active frame (per-epoch
        // terms on the input side, single peel on the output) — recompute
        // the boxes from it so the overflow tint tests real geometry.
        const fb = m.feedPos ? boundsOf(m.feedPos) : null;
        const rb = m.rapidPos ? boundsOf(m.rapidPos) : null;
        out.motion_bounds = fb && rb
          ? { min: fb.min.map((v, i) => Math.min(v, rb.min[i]!)),
              max: fb.max.map((v, i) => Math.max(v, rb.max[i]!)) }
          : (fb ?? rb);
        out.bounds = fb
          ? (rb
            ? { min: [Math.min(fb.min[0]!, rb.min[0]!), Math.min(fb.min[1]!, rb.min[1]!), fb.min[2]!],
                max: [Math.max(fb.max[0]!, rb.max[0]!), Math.max(fb.max[1]!, rb.max[1]!), fb.max[2]!] }
            : fb)
          : null;
      }
      if (!_pfAnchorFor || _pfAnchorFor.id !== m.id) {
        // Cannot happen (the anchor is stored with the request id) — but a
        // baked path under the live origin is the exact bug this guards.
        console.error("[partFrame] reply without its anchor — programmed preview used");
        _applyProgrammed(g);
        requestRender();
        return;
      }
      toolpath.apply(toolpathCtx(), out, _pfAnchorFor.anchor);
      requestRender();
    };
    _pfWorker.onerror = (ev) => {
      console.error("[partFrame] worker error — programmed preview used:", ev.message);
      if (viewerGcode.value) _applyProgrammed(viewerGcode.value);
    };
  }
  return _pfWorker;
}

function _pfMachine(init: ViewerInit): PartFrameMachine {
  // JSON round-trip: viewerInit is a deep-reactive Vue ref, and structured
  // clone REFUSES Proxy objects (postMessage throws DataCloneError → no
  // toolpath at all). The ctx is tiny; a plain deep copy is the robust fix.
  return JSON.parse(JSON.stringify({
    groups: init.groups ?? [],
    kinematics: init.kinematics,
    workGroup: init.workGroup ?? "",
    toolGroup: init.toolGroup ?? "",
    unitScale: _unitScale,
    axes: init.axes ?? [],
    // World-kins declaration (phase 2): consumers apply it ONLY to
    // segments the track/stream mode flags mark as world.
    kins: specFromWire(init.kins),
  }));
}

/** The DISPLAYED tool dims — ONE formula for the marker and the collision
 *  body (they must agree: the body used to be shorter than the drawn tool).
 *  Design default: absent dims draw a generic 6×60 placeholder — a position
 *  cue, not a claim about the real tool. `||`, not `??`: a 0 length means
 *  "unknown", and a 0-length marker collapses to the 40 mm minimum — 15 mm
 *  short of the raised spindle nose, leaving the tool floating detached.
 *  Visual length = raw + the shank's sink into the holder, floored. */
function _toolVisual(diamRaw: number | null | undefined, lenRaw: number | null | undefined): { diam: number; len: number } {
  const diam = diamRaw || 6.0 * _unitScale;
  const rawLen = lenRaw || 60.0 * _unitScale;
  return { diam, len: Math.max(40 * _unitScale, rawLen + 20 * _unitScale) };
}

/** Per-program-tool dims for the sweep (schema 8): every tool a tlo_events
 *  row names that has a parse-time table row. Absent channel → undefined
 *  (the sweep keeps the loaded tool / stub body throughout, and the bar
 *  says so). */
function _programToolDims(): Record<number, { diam: number; len: number }> | undefined {
  const g = viewerGcode.value;
  if (!g?.tloEvents?.length || !g.parse_tlos?.length) return undefined;
  const out: Record<number, { diam: number; len: number }> = {};
  for (const ev of g.tloEvents) {
    if (ev.tool == null || ev.tool <= 0 || out[ev.tool]) continue;
    const d = toolDimsFor(ev.tool, g.parse_tlos, _unitScale, { diam: null, len: null });
    if (d.known) out[ev.tool] = _toolVisual(d.diam, d.len);
  }
  return Object.keys(out).length ? out : undefined;
}
const programTools = computed<Array<{ num: number; diam: number }> | null>(() => {
  const dims = _programToolDims();
  if (!dims) return null;
  return Object.entries(dims).map(([n, d]) => ({ num: Number(n), diam: d.diam }))
    .sort((a, b) => a.num - b.num);
});

function _pfWcs(): PartFrameWcs {
  // tool: live TCP offset — makes the transform joint-space-exact (G43).
  // The part-frame tip peel and the collision worker's tool-body shift
  // both subtract it back, so the drawn curve is unchanged; the posed
  // BODIES (spindle housing at joint height) are what it corrects.
  return {
    g5x: _pv.g5x ?? [], g92: _pv.g92 ?? [],
    rotationDeg: _pv.rotationXy ?? 0, tool: _pv.toolOffset ?? [],
  };
}

// ---- Collision sweep (offline dry run, stage 3) ----
// Sweeps the machine model through the scrub track off-thread and reports
// tool-side vs work-side body pairs inside the clearance margin. Owned here
// (not ScrubBar) because this component holds the machine def, the cached
// STL geometries, and the live tool dims. Results reflect the CHECK-TIME
// WCS and tool — a new program invalidates them; re-check after touch-off.
const COLLISION_MARGIN_MM = 2;
let _colWorker: Worker | null = null;
let _colReqId = 0;
const collisionBusy = ref(false);
const collisionProgress = ref(0);
const collisionResult = ref<CollisionResult | null>(null);
// The exact track the current result was swept on — hit cums are only
// meaningful against it (shallowRef: tracks hold Maps + typed arrays).
const collisionTrack = shallowRef<ScrubTrack | null>(null);
let _colPendingTrack: ScrubTrack | null = null;

function _colGetWorker(): Worker {
  if (!_colWorker) {
    _colWorker = new Worker(new URL("./viewer/collisionWorker.ts", import.meta.url), { type: "module" });
    _colWorker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { id: number; progress?: number; error?: string; result?: CollisionResult };
      if (m.id !== _colReqId) return;  // superseded
      if (m.progress != null && !m.result) {
        collisionProgress.value = m.progress;
        return;
      }
      collisionBusy.value = false;
      if (m.error) {
        console.error("[collision] sweep failed:", m.error);
        emitTelemetry("collision.sweep_failed", { msg: m.error });
        collisionResult.value = null;
        collisionTrack.value = null;
        emit("collision-lines", null);
        return;
      }
      collisionResult.value = m.result!;
      collisionTrack.value = _colPendingTrack;
      emit("collision-lines", m.result!.hits.map(h => ({ line: h.line, continuation: h.continuation })));
    };
    // A worker-level failure (module load, OOM, uncaught throw) never
    // replies — without this the busy flag stayed set and the Check chip
    // read 0% until a program change (the part-frame worker already had it).
    _colWorker.onerror = (ev: ErrorEvent) => {
      console.error("[collision] worker error:", ev.message);
      emitTelemetry("collision.sweep_failed", { msg: `worker error: ${ev.message}` });
      _colFail();
    };
  }
  return _colWorker;
}

// Reset every sweep state the busy flag guards — the one place a failed
// sweep unwinds to, so no failure path can leave `collisionBusy` pinned
// (runCollisionCheck early-returns on it, and every auto-run goes through
// runCollisionCheck).
function _colFail() {
  collisionBusy.value = false;
  collisionProgress.value = 0;
  collisionResult.value = null;
  collisionTrack.value = null;
  emit("collision-lines", null);
}

function cancelCollisionCheck() {
  // The sweep is synchronous inside the worker — a cancel message would sit
  // unread until it finished. Terminate + lazy recreate is the honest cancel.
  if (_colWorker) {
    _colWorker.terminate();
    _colWorker = null;
  }
  _colReqId++;
  collisionBusy.value = false;
  collisionProgress.value = 0;
}

function runCollisionCheck(trackOverride?: ScrubTrack) {
  const init = viewerInit.value;
  // ScrubBar passes its active track (base + entry move captured at sim
  // entry); the bare-Check fallback sweeps the parse-time track.
  // toRaw: structured clone refuses Vue Proxies. The gcode payload is
  // markRaw'd on arrival, but a track that ever passed through a deep ref
  // arrives with its nested arrays proxied — unwrap at the boundary so the
  // post below cannot throw on a caller's reactivity choice.
  const track = toRaw(trackOverride ?? viewerGcode.value?.scrubTrack ?? null) as ScrubTrack | null;
  if (!init || !track || collisionBusy.value) return;
  const bodies: CollisionBody[] = [];
  let skipped = 0;
  for (const p of (init.parts ?? [])) {
    const attr = getCachedGeometry(p.id)?.getAttribute("position");
    if (!attr) { skipped++; continue; }  // unloaded geometry
    bodies.push({
      id: p.id,
      // Ungrouped parts are static frame bodies (column, base, spindle
      // housing) — root-attached, and very much collidable-with.
      group: p.group ?? "root",
      positions: new Float32Array(attr.array as Float32Array),  // copy → transferable
      translate: p.translate ? [...p.translate] : undefined,
      rotate: (p as any).rotate ? [...(p as any).rotate] : undefined,
      // stock: true = cuttable (feed contact is machining, rapid-onset is a
      // gouge). Absent on machine parts — any tool contact there is a crash.
      stock: p.stock || undefined,
    });
  }
  if (skipped) console.warn(`[collision] ${skipped} machine part(s) not loaded — checked without them`);
  const id = ++_colReqId;
  _colPendingTrack = track;
  collisionBusy.value = true;
  collisionProgress.value = 0;
  collisionResult.value = null;
  // Track arrays are copied — transferring the originals would detach the
  // buffers viewerGcode (and the scrub bar) still read.
  const trackCopy = {
    pos: track.pos.slice(), abc: track.abc.slice(), lines: track.lines.slice(),
    rapid: track.rapid.slice(), cum: track.cum.slice(), count: track.count,
    mode: track.mode?.slice(),  // raw switchkins types — the sweep poses per segment
    frame: track.frame?.slice(),  // TWP frame indices (+ triplets below)
    frames: track.frames,         // small list — structured-cloned, not transferred
    brk: track.brk?.slice(),      // kins-flip relabel flags — excluded from the sweep
    wcs: track.wcsEpoch?.slice(), // per-segment WCS epoch (terms in options below)
    tlo: track.tlo?.slice(),      // per-segment TLO/tool event (events in options below)
  };
  // ArrayBuffer[] (not Transferable[]): every entry is a buffer, and the
  // TS-only Transferable name trips eslint's no-undef in SFC scripts.
  const transfer: ArrayBuffer[] = [
    ...bodies.map(b => b.positions.buffer as ArrayBuffer),
    trackCopy.pos.buffer as ArrayBuffer, trackCopy.abc.buffer as ArrayBuffer,
    trackCopy.lines.buffer as ArrayBuffer, trackCopy.rapid.buffer as ArrayBuffer,
    trackCopy.cum.buffer as ArrayBuffer,
  ];
  try {
    _colGetWorker().postMessage({
    id,
    machine: _pfMachine(init),           // same shape as CollisionMachine
    bodies,
    // The DISPLAYED marker dims — same visual-length formula as the marker
    // build (min length + shank sink into the holder). Using the raw tool
    // length made the collision body SHORTER than the tool on screen: the
    // model visibly touched while the sweep saw clearance.
    tool: _toolVisual(_pv.toolDiam, _pv.toolLen),
    track: trackCopy,
    wcs: _pfWcs(),
    options: {
      margin: COLLISION_MARGIN_MM * _unitScale,
      // Per-epoch re-add terms (review P2) — the sweep converts each
      // segment's program coords through ITS epoch's basis. Built here
      // (live status is main-thread state); plain JSON, clones fine.
      epochTerms: track.wcsEvents?.length
        ? epochTermsFor(track.wcsEvents, _pfWcs(), _pv.wcsTable ?? undefined)
        : undefined,
      tloEvents: track.tloEvents,
      // Per-program-tool bodies (schema 8): the sweep swaps the tool
      // cylinder to each segment's tool; the live tool is the pre-first-M6
      // fallback.
      toolDims: _programToolDims(),
      liveTool: _pv.toolNum,
    },
    }, transfer);
  } catch (err) {
    // postMessage throws SYNCHRONOUSLY on an uncloneable payload
    // (DataCloneError — a Vue Proxy in the track was the live case). The
    // busy flag was already set above; a throw here used to pin the Check
    // chip at 0% and short-circuit every later sweep. Unwind and say so.
    console.error("[collision] postMessage failed — sweep not run:", err);
    emitTelemetry("collision.post_failed", { msg: String(err) });
    _colFail();
  }
}

// The sweep keeps itself current — no manual trigger. Auto-runs: on
// program load (base track — marks appear before sim is ever entered), on
// sim entry (ScrubBar re-checks with the entry track), and on WCS/tool
// changes while idle (results reflect check-time inputs; a change makes
// them stale, so they clear and the sweep re-runs).
let _colAutoTimer: ReturnType<typeof setTimeout> | undefined;
function _colScheduleAuto() {
  clearTimeout(_colAutoTimer);
  _colAutoTimer = setTimeout(() => {
    if (simMode.value) return;               // ScrubBar re-checks with the entry track
    if (!machineReady.value) return;         // geometry loading — machineReady watcher retries
    if ((status.value?.data?.interp_state ?? INTERP_IDLE) !== INTERP_IDLE) return;
    if (!viewerGcode.value?.scrubTrack) return;
    if (collisionBusy.value) cancelCollisionCheck();
    runCollisionCheck();
  }, 400);
}

// Live WCS or tool dims changed: current results are stale — clear them
// honestly and re-run (debounced; touch-off sequences change several
// values in quick succession).
function _colOnInputChange() {
  if (!collisionResult.value && !collisionBusy.value) return;
  cancelCollisionCheck();
  collisionResult.value = null;
  collisionTrack.value = null;
  emit("collision-lines", null);
  _updateClashTint(null, null);
  _colScheduleAuto();
}

// A new program (or unload) invalidates results — never show stale clashes.
watch(viewerGcode, () => {
  cancelCollisionCheck();
  collisionResult.value = null;
  collisionTrack.value = null;
  emit("collision-lines", null);
  _updateClashTint(null, null);
  _colScheduleAuto();
});
watch(machineReady, (ready) => {
  if (ready && !collisionResult.value) _colScheduleAuto();
});

function _partFrameEligible(g: ViewerGcode): boolean {
  const init = viewerInit.value;
  if (!init) return false;
  // Pure decision in viewer/displayPipeline.ts (W2 P8.4 — headless
  // display-oracle tests assert it directly; this wrapper only feeds it
  // the live refs). "part" = non-identity switchkins segments exist (the
  // kins routing is what poses them — belt), or the abc pose channel
  // shipped and the machine has a rotary DOF to pose it through.
  return displayDecision(
    g, _pfMachine(init), init.kins,
    viewerDefaults.previewMode === "programmed" ? "programmed" : "part",
  ) === "part";
}

/** Programmed-path apply, epoch-aware (review P2): a multi-epoch payload's
 *  sections each carry their own frame, but the rendered polyline hangs
 *  under the single workOrigin group (the live ACTIVE fixture) — so vertices
 *  are re-based per epoch into the display frame first, and the bounds boxes
 *  (frame-mixed as shipped) are recomputed from the re-based vertices — this
 *  is also what retires the false "outside travel" tint on TWP programs.
 *  Single-epoch payloads take the zero-copy fast path inside
 *  rebasePositions. */
function _applyProgrammed(g: ViewerGcode) {
  let out = g;
  let anchor: AnchorTerms | null = null;
  if (g.wcsEvents?.length && (g.feedWcs || g.rapidWcs) && (g.feedPos || g.rapidPos)) {
    const live = _pfWcs();
    const terms = epochTermsFor(g.wcsEvents, live, _pv.wcsTable ?? undefined);
    const active = wcsTerms(tipWcs(live));   // tip-space like the epoch terms (schema 8)
    const fp = g.feedPos ? rebasePositions(g.feedPos, g.feedWcs, terms, active) : g.feedPos;
    const rp = g.rapidPos ? rebasePositions(g.rapidPos, g.rapidWcs, terms, active) : g.rapidPos;
    if (fp !== g.feedPos || rp !== g.rapidPos) {
      const fb = fp ? boundsOf(fp) : null;
      const rb = rp ? boundsOf(rp) : null;
      // Same shapes the worker ships: bounds = cut envelope (X/Y over
      // feed+rapid, Z over feed only), motion_bounds = full envelope.
      const motion = fb && rb
        ? { min: fb.min.map((v, i) => Math.min(v, rb.min[i]!)),
            max: fb.max.map((v, i) => Math.max(v, rb.max[i]!)) }
        : (fb ?? rb);
      const bounds = fb
        ? (rb
          ? { min: [Math.min(fb.min[0]!, rb.min[0]!), Math.min(fb.min[1]!, rb.min[1]!), fb.min[2]!],
              max: [Math.max(fb.max[0]!, rb.max[0]!), Math.max(fb.max[1]!, rb.max[1]!), fb.max[2]!] }
          : fb)
        : null;
      out = { ...g, feedPos: fp, rapidPos: rp,
              rapidDist: rp ? lineDistances(rp) : g.rapidDist,
              bounds, motion_bounds: motion };
      // Rebased against `live` — anchor the lines to those terms, not to
      // the live origin (same invariant as the part-frame reply).
      anchor = anchorTerms(live);
    }
  }
  toolpath.apply(toolpathCtx(), out, anchor);
}

function applyGcode(g: ViewerGcode) {
  if (_partFrameEligible(g)) {
    _pfAppliedMode = "part";
    const id = ++_pfReqId;
    // The terms the worker peels against — the reply hangs under THIS
    // anchor, not under whatever the live origin is by then.
    _pfAnchorFor = { id, anchor: anchorTerms(_pfWcs()) };
    try {
      const w = _pfGetWorker();
      if (_pfLoadedFor !== g) {
        // New program (or a recreated worker): ship the streams ONCE.
        // Copies: the transfer must not detach viewerGcode's raw buffers —
        // they are still read by the programmed-mode path and the sweep.
        const fp = g.feedPos ?? new Float32Array(0);
        const fa = g.feedAbc && g.feedAbc.length === fp.length ? g.feedAbc : new Float32Array(fp.length);
        const fl = g.feed_lines instanceof Uint32Array ? g.feed_lines : undefined;
        const rp = g.rapidPos ?? new Float32Array(0);
        const ra = g.rapidAbc && g.rapidAbc.length === rp.length ? g.rapidAbc : new Float32Array(rp.length);
        const feed = { pos: fp.slice(), abc: fa.slice(), lines: fl?.slice(), breaks: g.feedBreaks?.slice(),
                       mode: g.feedMode?.slice(), frame: g.feedFrame?.slice(), frames: g.kinsFrames,
                       wcs: g.feedWcs?.slice(), src: g.feedSrc?.slice(), tlo: g.feedTlo?.slice() };
        const rapid = { pos: rp.slice(), abc: ra.slice(), breaks: g.rapidBreaks?.slice(),
                        mode: g.rapidMode?.slice(), frame: g.rapidFrame?.slice(), frames: g.kinsFrames,
                        wcs: g.rapidWcs?.slice(), tlo: g.rapidTlo?.slice() };
        const transfer: ArrayBuffer[] = [
          feed.pos.buffer as ArrayBuffer, feed.abc.buffer as ArrayBuffer,
          rapid.pos.buffer as ArrayBuffer, rapid.abc.buffer as ArrayBuffer,
        ];
        for (const a of [feed.lines, feed.breaks, rapid.breaks, feed.mode, rapid.mode, feed.frame, rapid.frame,
                         feed.wcs, rapid.wcs, feed.src, feed.tlo, rapid.tlo]) {
          if (a) transfer.push(a.buffer as ArrayBuffer);
        }
        _pfPayloadId++;
        w.postMessage({ op: "load", payloadId: _pfPayloadId, streams: { feed, rapid } }, transfer);
        _pfLoadedFor = g;
      }
      w.postMessage({
        op: "transform", id, payloadId: _pfPayloadId,
        machine: _pfMachine(viewerInit.value!), wcs: _pfWcs(),
        // Epochs (review P2): events + the live table let the worker build
        // per-epoch re-add terms next to the per-vertex `wcs` indices.
        wcsEvents: g.wcsEvents,
        wcsTable: _pv.wcsTable ?? undefined,
        // Per-segment TLO/tool events (schema 8) for the `tlo` indices.
        tloEvents: g.tloEvents,
      });
    } catch (err) {
      // A failed post must NEVER leave the viewer with no toolpath — fall
      // back to the programmed preview and say so.
      console.error("[partFrame] postMessage failed — programmed preview used:", err);
      _pfAppliedMode = "programmed";
      _applyProgrammed(g);
    }
    return;
  }
  _pfAppliedMode = "programmed";
  ++_pfReqId;  // invalidate any in-flight part-frame reply
  // Owned by toolpathController; pass a fresh ctx with the reassigned
  // scene-graph pointers + per-program machine bounds/units.
  _applyProgrammed(g);
}

// Part-frame vertices depend on the pivot position relative to the live work
// origin, so a WCS change (touch-off, G10, G92, rotation) re-transforms —
// debounced, these change rarely and never mid-cut at speed.
function _pfScheduleWcsRefresh() {
  // Epoch-aware programmed payloads (review P2) also re-apply on WCS/table
  // changes — but ONLY when the display rebase can differ from identity:
  // more than one epoch, a program-rewritten epoch 0, or an epoch-0
  // fixture other than the ACTIVE one (workOrigin carries the active
  // fixture live, so an identity rebase needs no geometry rebuild). W2 P5
  // gate fix: wcs_frames ships ≥1 row on every modern payload, so the old
  // bare length check re-ran a full rebuild of a 99k-point program on
  // every G43 the toolchange sub issued.
  if (_pfAppliedMode !== "part") {
    const evs = viewerGcode.value?.wcsEvents;
    if (!evs?.length) return;
    if (evs.length === 1 && !evs[0]!.rewritten
        && evs[0]!.idx === (vst.value?.g5x_index ?? 0)) return;
  }
  clearTimeout(_pfWcsTimer);
  _pfWcsTimer = setTimeout(() => {
    if (viewerGcode.value) applyGcode(viewerGcode.value);
  }, 300);
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

// ---- Program scrub (offline dry run, stage 2) ----
// ScrubBar (hosted in this component's overlay) emits per-JOINT machine
// values; applyState substitutes them for live joint_pos so the pose runs
// through the exact same compose path as live motion — no second kinematics
// implementation. null entries (UVW/unknown letters) keep the live joint.
let _scrubJoints: (number | null)[] | null = null;
// The scrub sample's tool offset + tool number (schema 8): applyState phase
// 3 subtracts THIS offset while a scrub pose is shown (the sample's joints
// were lifted with it), and the marker wears the sample's tool. null = live.
let _scrubTlo: number[] | null = null;
let _scrubTool: number | null = null;
let _scrubLineNo: number | null = null;
// Last full status applied — requeued when the scrub pose changes so the
// model re-poses immediately instead of waiting for the next status tick.
let _lastState: ViewerState | null = null;

function onScrubPose(joints: (number | null)[] | null, line: number | null, cum: number | null, trk: ScrubTrack | null, displayLine: number | null = null, plane: number[] | null = null, tlo: number[] | null = null, tool: number | null = null) {
  _scrubJoints = joints;
  _scrubTlo = joints ? tlo : null;
  _scrubTool = joints ? tool : null;
  _scrubPlane = plane;
  _twpRefresh();
  // RAW sample line: keys the clash tint and the 3D path highlight, whose
  // data (collision hits, drawn feed_lines) carries the same sub-relative
  // numbering — self-consistent. The TEXT panel gets only the per-point-
  // trust-GATED displayLine (W3 P4): raw numbers lit blank main-file
  // lines and scrolled to remap linenos past the end of the file.
  _scrubLineNo = joints ? line : null;
  _scrubTrackRef = joints ? trk : null;
  emit("scrub-line", joints ? displayLine : null);
  _updateClashTint(_scrubLineNo, joints ? cum : null);
  if (_lastState && !pendingState) pendingState = _lastState;
  requestRender();
}
let _scrubTrackRef: ScrubTrack | null = null;

// ---- Clash-pair tint: while the scrub sits on a line with a reported
// collision, the involved bodies glow danger-red (emissive add — works on
// any base/vertex color). Shared materials (MAT.*, auto part materials)
// are clone-swapped per mesh and restored on clear, so nothing leaks into
// other parts and user color overrides stay untouched. ----
let _dangerHex: number | null = null;
const _clashOnIds = new Set<string>();

function _clashMeshes(id: string): THREE.Mesh[] {
  if (id === "tool") {
    return [toolCutterMesh, toolBodyMesh].filter((m): m is THREE.Mesh => !!m);
  }
  return machineMeshes.filter(m => m.userData.partId === id);
}

function _tintMesh(mesh: THREE.Mesh, on: boolean) {
  let mat = mesh.material as THREE.MeshStandardMaterial;
  if (on) {
    if (mesh.userData._clashOn) return;
    if (mat.userData._shared) {
      const clone = mat.clone();
      clone.userData._shared = false;
      clone.userData._clashClone = true;
      mesh.userData._preClashMat = mat;
      mesh.material = mat = clone;
    } else {
      mesh.userData._preClashEmissive = mat.emissive.getHex();
    }
    if (_dangerHex == null) {
      const v = getComputedStyle(document.documentElement).getPropertyValue("--danger").trim();
      _dangerHex = v ? new THREE.Color(v).getHex() : 0xcc3333;
    }
    mat.emissive.setHex(_dangerHex);
    mesh.userData._clashOn = true;
  } else {
    if (!mesh.userData._clashOn) return;
    if (mesh.userData._preClashMat) {
      const clone = mesh.material as THREE.MeshStandardMaterial;
      mesh.material = mesh.userData._preClashMat;
      if (clone.userData._clashClone) clone.dispose();
      delete mesh.userData._preClashMat;
    } else {
      (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(mesh.userData._preClashEmissive ?? 0);
      delete mesh.userData._preClashEmissive;
    }
    mesh.userData._clashOn = false;
  }
}

// Contact-gated: the pair glows only from FIRST TOUCH (the refined contact
// cum) onward on the flagged line, and only for genuinely penetrating hits
// (dist ≈ 0 — near-misses never touch, so they never glow). The glow is the
// visual proof the detection fired where the metal meets. Hit cums are only
// meaningful on the track they were swept on — stale results never tint.
const CONTACT_TINT_EPS = 1e-3;
function _updateClashTint(line: number | null, cum: number | null) {
  const want = new Set<string>();
  if (line != null && cum != null && _scrubTrackRef && _scrubTrackRef === collisionTrack.value) {
    for (const h of collisionResult.value?.hits ?? []) {
      if (h.line !== line || h.dist > CONTACT_TINT_EPS) continue;
      // Contact within a line can be intermittent — glow only INSIDE a
      // refined interval, never across the verified-clear gaps between.
      const ivs = h.intervals ?? [[h.cum, h.cumEnd] as [number, number]];
      for (const [en, ex] of ivs) {
        if (cum >= en - CONTACT_TINT_EPS && cum <= ex + CONTACT_TINT_EPS) {
          want.add(h.a);
          want.add(h.b);
          break;
        }
      }
    }
  }
  let changed = false;
  for (const id of _clashOnIds) {
    if (!want.has(id)) {
      for (const m of _clashMeshes(id)) _tintMesh(m, false);
      _clashOnIds.delete(id);
      changed = true;
    }
  }
  for (const id of want) {
    if (!_clashOnIds.has(id)) {
      for (const m of _clashMeshes(id)) _tintMesh(m, true);
      _clashOnIds.add(id);
      changed = true;
    }
  }
  if (changed) requestRender();
}
let _needsReframe = false;
let _iniBox: THREE.Box3 | null = null;

function animate() {
  if (props.active === false) return; // paused — don't schedule next frame
  raf = requestAnimationFrame(animate);
  recordRafTick();   // render-loop cadence + GPU fence poll (viewerPerf)

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
    } else if (trackingMode === "wcs" && (workAxesGroup ?? workOrigin)) {
      (workAxesGroup ?? workOrigin)!.getWorldPosition(_trackTarget);
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
    _workGrp.updateWorldMatrix(true, false);  // ancestors too — a_table's rotation this frame
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
  toolpath.setStale(pathStaleNow.value);   // the muted mix follows the background
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
  setViewerPerfGl(renderer.getContext());   // GPU completion fences (WebGL2 only)

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
  setViewerPerfGl(null);
  clearTimeout(_pfWcsTimer);
  clearTimeout(_colAutoTimer);
  _pfWorker?.terminate();
  _pfWorker = null;
  _pfLoadedFor = null;
  _colWorker?.terminate();
  _colWorker = null;
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
  // Preview-mode change (this tab's Settings or another client's) rebuilds
  // the toolpath in the newly selected frame.
  const g = viewerGcode.value;
  if (g && _pfAppliedMode) {
    const desired = _partFrameEligible(g) ? "part" : "programmed";
    if (desired !== _pfAppliedMode) applyGcode(g);
  }
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
    _twpRefresh();
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
// One grid row per axis in machine order — primary/abc/uvw grouping is not
// needed in the tabular HUD, entries already carry letter + status index.
const { entries: hudEntries } = useAxes(hudAxes);
const hudCfg = computed(() => viewerDefaults.hud);

// Feed/spindle grid-row values (current_vel is units/s → units/min)
const hudFeed = computed(() =>
  vst.value?.current_vel != null ? (vst.value.current_vel * 60).toFixed(1) : "---",
);
const hudLoad = computed(() =>
  vst.value?.spindle_load != null ? `${Math.round(vst.value.spindle_load)}%` : "",
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
  const grp = _partGroupMap[partId];
  const dir = grp ? _groupDirMap[grp] : null;
  const defaultHex = defaultPartHex(dir);
  // machine.json default color (if any) beats the direction-derived fallback
  const partColor = viewerInit.value?.parts?.find((p) => p.id === partId)?.color;

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
      if (partColor) mat.color.setRGB(partColor[0], partColor[1], partColor[2], THREE.SRGBColorSpace);
      else mat.color.setHex(defaultHex);
    }
  }
  // Sync edge line colors
  for (const edge of _machineEdgeLines) {
    if (edge.userData.partId !== partId) continue;
    (edge.material as THREE.LineBasicMaterial).color.set(color ?? defaultHex);
  }
  // Render-on-demand: an idle machine produces no status-diff renders, so the
  // color change must request its own frame or it stays invisible until the
  // camera moves.
  requestRender();
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
  return new Promise((resolve, reject) => {
    const worker = getEdgeWorker();
    const handler = (e: MessageEvent) => {
      if (e.data.id === partId) {
        worker.removeEventListener("message", handler);
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(new Float32Array(e.data.positions));
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
  // No meshes yet → nothing to build, and CRITICALLY do not mark _edgesBuilt:
  // applyViewerDefaults calls setMachineEdges during buildFromInit's STL-await
  // window (onMounted + settings echoes), when machineMeshes is still empty.
  // An empty run completing synchronously here poisoned the flag, so the real
  // build at the end of buildFromInit early-returned — no outlines until the
  // next scene rebuild, and toggle/reset couldn't recover (empty line array).
  if (machineMeshes.length === 0) return;
  const token = ++_edgeBuildToken;

  // Sweep partial output of an aborted prior run (the token bump above kills
  // it; its post-await token check means it adds nothing after this point).
  // Without this, a second call mid-build duplicated already-built edge lines.
  for (const e of _machineEdgeLines) {
    e.parent?.remove(e);
    disposeObject(e);
  }
  _machineEdgeLines = [];

  for (const mesh of machineMeshes) {
    if (token !== _edgeBuildToken) return;
    const partId = mesh.userData.partId as string;

    let edgePositions: Float32Array;
    try {
      edgePositions = await computeEdgesOffThread(mesh.geometry, partId);
    } catch (err) {
      // One malformed part must not kill outlines for every other part.
      console.warn(`edge build failed for part ${partId}:`, err);
      emitTelemetry("viewer.edge_build_failed", { part: partId, error: String(err) });
      continue;
    }
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

    <!-- HUD Overlay — one card, one visual language: every live value is a
         grid row (muted letter label | right-aligned value), so feed and
         spindle read exactly like the axis rows. Tool is static context and
         stays a smaller single line. All text sizes scale with --hud-scale
         (settings: HUD scale). -->
    <div v-show="hudVisible" class="hud hudCard stack-tight" :class="`hudScale-${hudCfg.scale}`">
      <div class="hudGrid" :class="{ noMach: !hudCfg.showMachine }">
        <span class="hudHead"></span>
        <span class="hudHead">Work · {{ props.g5xLabel || '-' }}</span>
        <span v-if="hudCfg.showMachine" class="hudHead">Machine</span>
        <template v-for="a in hudEntries" :key="a.letter">
          <span class="hudAxis">{{ a.letter }}</span>
          <span class="hudWork">{{ fmtCoord(vst?.work_pos?.[a.index], a.letter) }}</span>
          <span v-if="hudCfg.showMachine" class="hudMach">{{ fmtCoord(vst?.machine_pos?.[a.index], a.letter) }}</span>
        </template>
        <template v-if="hudCfg.showFeedSpindle">
          <div class="sep"></div>
          <span class="hudAxis">F</span>
          <span class="hudWork">{{ hudFeed }}</span>
          <span v-if="hudCfg.showMachine" class="hudMach"></span>
          <span class="hudAxis">S</span>
          <span class="hudWork">{{ fmtRpm(vst?.spindle_speed_actual ?? null) }}<span v-if="!hudCfg.showMachine && hudLoad" class="hudLoadInline"> {{ hudLoad }}</span></span>
          <span v-if="hudCfg.showMachine" class="hudMach">{{ hudLoad }}</span>
        </template>
      </div>

      <div v-if="hudMode" class="hudMode val-status" :class="hudMode.cls" :title="hudMode.title">
        {{ hudMode.text }} · {{ props.g5xLabel || '-' }}<template v-if="hudPlaneWord"> · {{ hudPlaneWord }}</template>
      </div>

      <template v-if="hudCfg.showTool">
        <div class="sep"></div>
        <div class="hudCtx">
          <span>T{{ vst?.tool_number ?? '–' }}</span><span>Ø{{ fmtCoord(vst?.tool_diameter) }}</span><span>L{{ fmtCoord(vst?.tool_length) }}</span>
        </div>
      </template>
      <div v-if="hudCfg.showLoadBar && vst?.spindle_load != null" class="loadBar" :class="spindleLoadZone">
        <div class="loadBarFill" :style="{ width: spindleLoadFillPct + '%' }"></div>
      </div>

      <div v-if="vst?.eoffset_enabled" class="hudWarn">Comp Z {{ vst.eoffset_z != null ? vst.eoffset_z.toFixed(3) : '---' }}</div>
      <div v-if="vst?.rotation_xy" class="hudWarn">Rotation {{ vst.rotation_xy.toFixed(1) }}°</div>
      <div v-if="foreignWcs.length" class="hudWarn">Program cuts in {{ foreignWcs.join(', ') }} — {{ props.g5xLabel }} active</div>
      <div v-if="rewrittenWcs.length" class="hudWarn">Program writes {{ rewrittenWcs.join(', ') }} — its preview ignores live edits there</div>
      <div v-if="kinsEndWarn" class="hudWarn" :title="kinsEndWarn.title">{{ kinsEndWarn.text }}</div>
      <div v-if="previewSchemaStale" class="hudWarn hudAction"
        :title="`Payload format ${previewSchemaStale.got ?? 'unstamped (older gateway)'}; this UI expects ${EXPECTED_PREVIEW_SCHEMA}. Reparse rebuilds it with the installed code.`"
        @click="emit('reparse')">Preview from a different suite version — Reparse</div>
      <div v-if="previewRefresh" class="hudWarn"
        :title="'The gateway is re-parsing the program (' + previewRefresh.reason + '). The drawn path, soft-limit marks and simulation are stale until it lands.'">Preview re-parsing after {{ previewRefreshLabel(previewRefresh.reason) }} · {{ Math.floor(previewRefreshElapsedMs / 1000) }} s{{ previewRefresh.expected_ms ? ' of ~' + Math.max(1, Math.round(previewRefresh.expected_ms / 1000)) + ' s' : '' }}</div>
      <div v-else-if="previewWcsStale" class="hudWarn" :class="{ hudAction: !interpBusy }"
        :title="interpBusy ? 'A fixture this program uses was touched off after it was parsed — it re-parses when the run ends' : 'A fixture this program uses was touched off after it was parsed — click to re-parse'"
        @click="!interpBusy && emit('reparse')">Preview uses older offsets{{ interpBusy ? '' : ' — Refresh' }}</div>
      <div v-if="previewTloStale" class="hudWarn hudAction"
        :title="`Parsed with T${previewTloStale.tool} length ${previewTloStale.parsed.toFixed(3)}, table now ${previewTloStale.live.toFixed(3)} — line limit flags are stale`"
        @click="emit('reparse')">Preview parsed with a different T{{ previewTloStale.tool }} length — Reparse</div>
      <div v-if="toolpathOverflow" class="hudWarn" :class="{ hudAction: !interpBusy }"
        :title="'The per-line soft-limit validator flagged moves outside the machine\'s travel — the same source of truth as the marked code lines and the scrub bar\'s findings' + (interpBusy ? '' : '. Click to re-parse against the current pose and offsets')"
        @click="!interpBusy && emit('reparse')">Toolpath exceeds soft limits</div>
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

    <!-- SIMULATION mode banner — unmissable: the model is posed along the
         program, NOT the machine, and motion controls are locked. -->
    <div v-if="simMode" class="simBanner">
      SIMULATION &mdash; model shows the program, not the machine
    </div>

    <!-- Program-scrub timeline (stage 2) + collision check (stage 3) -->
    <ScrubBar
      :collisionBusy="collisionBusy"
      :collisionProgress="collisionProgress"
      :sweepTool="{ num: _pv.toolNum, diam: _pv.toolDiam, programTools }"
      :collisionResult="collisionResult"
      :collisionTrack="collisionTrack"
      @pose="onScrubPose"
      @check="runCollisionCheck"
      @cancel-check="cancelCollisionCheck"
    />

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
  /* The WebGL canvas lives on its own GPU compositor layer, and some
     browsers drop the overflow:hidden rounded clip for composited
     children — the border paints rounded while the canvas escapes
     square. clip-path is applied in the compositor and always holds
     (same workaround as the codeViewer scrollbar clip in style.css). */
  clip-path: inset(0 round var(--radius-container));
  background: color-mix(in oklab, var(--panel) 70%, transparent);
}

.hud {
  position: absolute;
  z-index: 1;
  top: 12px;
  left: 12px;
  max-width: calc(100% - 24px);
  pointer-events: none;
  user-select: none;
}

/* Single HUD card. Every font-size below multiplies a --fs-* token by
   --hud-scale so the whole card scales coherently from one setting. */
.hudCard {
  --hud-scale: 1;
  background: color-mix(in oklab, var(--panel) 85%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: var(--gap-controls) var(--gap-section);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}
.hudScale-sm { --hud-scale: 0.85; }
.hudScale-lg { --hud-scale: 1.25; }
.hudScale-xl { --hud-scale: 1.55; }

/* Position table: axis | work | machine. Work is the distance-readable
   hero; machine rides along smaller and muted. Baseline alignment keeps
   the mixed sizes on one visual line per row. */
.hudGrid {
  display: grid;
  grid-template-columns: auto auto auto;
  column-gap: calc(var(--gap-section) * var(--hud-scale));
  row-gap: var(--gap-micro);
  align-items: baseline;
}
.hudGrid.noMach { grid-template-columns: auto auto; }
/* Divider row between axis block and F/S rows (layout-only override of
   the global .sep divider so it spans the whole grid). */
.hudGrid > .sep { grid-column: 1 / -1; align-self: center; }

.hudHead {
  font-size: calc(var(--fs-sm) * var(--hud-scale));
  opacity: var(--opacity-muted);
  text-align: right;
  white-space: nowrap;
}
.hudAxis {
  font-size: calc(var(--fs-lg) * var(--hud-scale));
  opacity: var(--opacity-muted);
}
.hudWork {
  font-size: calc(var(--fs-2xl) * var(--hud-scale));
  font-weight: var(--fw-semibold);
  text-align: right;
  white-space: nowrap;
  /* Fixed floor ("-999.999" = 8ch) so sign flips and digit growth don't
     resize the grid column — the card keeps constant width while moving.
     Machines with >1m travel grow the column once, then it's stable. */
  min-width: 8ch;
}
.hudMach {
  font-size: calc(var(--fs-lg) * var(--hud-scale));
  opacity: var(--opacity-muted);
  text-align: right;
  white-space: nowrap;
  min-width: 8ch;
}
/* Spindle load riding inside the S value cell when the machine column
   (its usual home) is hidden — machine-column styling, inline. */
.hudLoadInline {
  font-size: calc(var(--fs-lg) * var(--hud-scale));
  opacity: var(--opacity-muted);
}

/* Tool context line: T · Ø · L in G-code notation — no word labels. */
/* Mode line: colour semantics come from the global .val-status.ok/warn/bad/
   muted classes; only layout is local (the HUD's width-0/min-width trick so
   a long text cannot widen the card). */
.hudMode {
  font-size: calc(var(--fs-md) * var(--hud-scale));
  text-align: left;
  width: 0;
  min-width: 100%;
  white-space: normal;
}
.hudCtx {
  font-size: calc(var(--fs-md) * var(--hud-scale));
  font-weight: var(--fw-medium);
  white-space: nowrap;
}
.hudCtx > span + span::before {
  content: " · ";
  opacity: var(--opacity-subtle);
}

.hudWarn {
  font-size: calc(var(--fs-md) * var(--hud-scale));
  font-weight: var(--fw-medium);
  color: var(--warn);
  /* The card is shrink-to-fit, so a long single-line chip used to set the
     card's width (the DRO grid followed it out to the viewer edge). A
     flex-column child with width:0 contributes nothing to the card's
     intrinsic width, then stretches to the width the grid set and wraps. */
  width: 0;
  min-width: 100%;
  white-space: normal;
}

/* A HUD warning that is also the fix for what it warns about. The HUD is
   pointer-events:none so it never eats viewer drags — re-enable for this one. */
.hudWarn.hudAction {
  pointer-events: auto;
  cursor: pointer;
  text-decoration: underline;
}

</style>

