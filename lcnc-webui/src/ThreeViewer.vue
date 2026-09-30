<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, reactive, ref, shallowRef, toRaw, watch, type Ref, nextTick } from "vue";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Text } from "troika-three-text";
import { LABEL_FONT_URL } from "./viewer/labelFont";
import { resolveViewerPalette, type ViewerPalette } from "./viewer/viewerPalette";
import { makeBoxEdges, makeTwoToneSegments, MACHINE_BOX_PX, MACHINE_BOX_DASH_PX, REACH_PX, REACH_DASH_PX, type BoxEdges, type TwoToneLines } from "./viewer/boxLines";
import { buildToolGeometries, type ToolMeta } from "./toolGeometry";
import { toolUnitsPerMillimeter } from "./toolUnits";
import { AXIS_HEX, AXIS_CSS } from "./axisColors";
import {
  failedParts, loadMachineAssets, getCachedGeometry, getCollisionGeometry, getToolMeta, setToolMeta, machineReady,
} from "./viewer/machineAssetCache";

import { viewerInit, viewerGcode, status, emitTelemetry, previewRefresh, previewRefreshElapsedMs, previewRefreshLabel, previewRefreshPct, previewTableStale, type ViewerInit, type ViewerGcode } from "./lcncWs";
import { loadViewerDefaults, loadCameraDefaults, saveCameraDefaults, ALL_LAYERS, settingsVersion, type Vec3, type Layer } from "./defaults";
import { confirmedToolsetter } from "./toolsetterVars";
import { buildToolsetterMarker, toolsetterPlacement } from "./viewer/toolsetterMarker";
import { INTERP_IDLE } from "./lcnc";
import { fmtCoord, fmtProgressTimes, fmtRpm, fmtNum, fmtPct, NO_VALUE } from "./format";
import { framePose as defaultFramePose, DEFAULT_FRAME_DIR, orthoEyeDistance } from "./viewer/cameraFraming";
import { useAxes, DEFAULT_AXES } from "./useAxes";
import { recordApply, recordRafTick, recordRender, setViewerPerfContext, setViewerPerfGl } from "./viewerPerf";
import { disposeObject } from "./viewer/disposal";
import { normalizeKinematics, type KinRuntime } from "./viewer/kinematics";
import { lineDistances, tipWcs, wcsTerms, type PartFrameMachine, type PartFrameWcs, anchorTerms, type AnchorTerms } from "./viewer/partFrame";
import type { ReachInfo } from "./viewer/reachEnvelope";
import type { LineIndex } from "./viewer/lineIndex";
import { MACHINE_PALETTE, defaultPartHex } from "./viewer/palette";
import { toolDimsFor } from "./viewer/tloEvents";
import { boundsOf, epochTermsFor, previewWcsStaleFor, rebasePositions, usedWcsRowsKey, type WcsTableRow } from "./viewer/wcsEpochs";
import { specFromWire, worldModeForSpec, semanticKinsMode } from "./viewer/kins";
import { workMarkers, markerInputsChanged, newMarkerInputsPrev, G5X_NAMES, chainRotaryLetters, type ProgramZeroPose } from "./viewer/programZero";
import { roomEndOf, sliceTrack } from "./viewer/scrubTrack";
import { boundsFromJointLimits, sameBox, type JointLimits, type MachineBox } from "./viewer/machineBounds";
import { displayDecision } from "./viewer/displayPipeline";
import type { CollisionBody, CollisionResult, CollisionLineMark } from "./viewer/collision";
import { partCollides } from "./viewer/collision";
import { mergeEntryResult } from "./viewer/sweepMerge";
import { planEntryCheck } from "./viewer/sweepEntry";
import { previewSchemaMismatch, parseTloMismatch, type ScrubTrack } from "./ws/bulkData";
import { createBackplotController } from "./viewer/backplotController";
import { createSurfaceController } from "./viewer/surfaceController";
import { createToolpathController, type ToolpathCtx } from "./viewer/toolpathController";
import type { ViewerCtx } from "./viewer/viewerContext";
import { createMachineLighting, MACHINE_SURFACE, createGroundGrid, updateGroundGridColors, createMachineEdgeMaterial } from "./viewer/sceneAppearance";
import HelpIcon from "./HelpIcon.vue";
import ViewCube from "./ViewCube.vue";
import MachineBtn from "./MachineBtn.vue";
import CameraPip from "./CameraPip.vue";
import ScrubBar from "./ScrubBar.vue";
import { simMode } from "./simMode";
import { pathReveal, revealFor, revealText, sectionOf } from "./viewer/pathReveal";
import { twpPoseStale, twpDatumStale, kinsModeChip, fixtureOffDatum, stampAForFixture, poseAbcOf } from "./twpPose";
import { planeView, type PlaneView } from "./viewer/planeView";
import { Camera, Settings, ChevronDown, ChevronUp } from "lucide-vue-next";
import { createAbDriver } from "./viewer/abDriver";
import { abRunLine, cancelAbRun, registerAbDriver, startAbRun } from "./viewer/abRunBus";
import { cssZoomOf } from "./helpPlacement";
import { gcodeTextSource } from "./ws/bulkData";

const themeMode = inject<Ref<string>>("themeMode", ref("auto"));

// Deep-reactive so template bindings (e.g. HUD opacity) update when the
// settingsVersion watcher refreshes the values from the server.
const viewerDefaults = reactive(loadViewerDefaults());
// The palette as drawn (design wave D8c, UI-K08): the theme's --viewer-*
// roles, the operator's colours over them in Custom mode — ONE resolver
// (viewer/viewerPalette.ts), re-resolved on a theme switch and on every
// settings change (refreshPalette). Nothing here keeps a colour of its own.
const readRootToken = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name);
let palette: ViewerPalette = resolveViewerPalette(readRootToken, viewerDefaults);

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
  /** The spindle tool's table Z offset, SIGNED (tool_length is its magnitude); null: no table row. */
  tool_table_z?: number | null;
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
  twp_pose_b?: number | null;
  twp_pose_c?: number | null;
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
}>();

// HUD data (read from status for template)
const vst = computed(() => status.value?.data ?? null);
// HUD mode line: the kins/TWP mode is otherwise visible only in the strip
// radios and the tiny fixture labels (operator-caught). ONE derivation with
// SetupStrip's chip (kinsModeChip) so the two can never disagree.
const hudMode = computed(() => {
  const d = vst.value;
  if (!d || d.kins_type == null) return null;
  // The FRAME the raw pin means on this family (R-01) — the strip chip is
  // derived the same way, so the HUD and the strip cannot disagree.
  const mode = semanticKinsMode(d.kins_type, viewerInit.value?.kins);
  return kinsModeChip({
    kinsType: mode,
    twpActive: d.twp_active,
    twpStale: twpPoseStale(poseAbcOf(d), d.rotary_abc, d.twp_defined),
    twpDatumMoved: twpDatumStale(d.wcs_table?.[0], d.twp_datum, d.twp_defined, d.wcs_prov_a?.[0]),
    offDatum: fixtureOffDatum(mode, stampAForFixture(d.wcs_prov_a, d.g5x_index), d.rotary_abc?.[0]),
    g5xIndex: d.g5x_index,
  });
});
// The drawn plane's one display decision (viewer/planeView.ts, viewer
// contrast plan V4): its colour, its label on the object and this word.
const planeViewState = shallowRef<PlaneView | null>(null);
const hudPlaneWord = computed(() => planeViewState.value?.hudWord ?? null);

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
  if (k == null) return null;
  // Which FRAME that raw type is depends on the kins family (R-01): on a trt
  // without `sparm=identityfirst` raw 0 is the world kins, so "0 means
  // identity, nothing to restore" was exactly backwards there.
  const m = semanticKinsMode(k, viewerInit.value?.kins);
  if (m === 0) return null;
  const mode = m === 1 ? "TCP" : m === 2 ? "TOOL (plane)" : `an unsupported (type ${k})`;
  return {
    text: `Program ends in ${mode} kinematics — ${m === 2 ? "add G69" : "restore the Machine frame"} before M2`,
    title: "M2 keeps this kinematics mode — Cycle Start stays refused until the Machine frame is selected.",
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
// gateway re-parses: when idle, and during a run too (the mid-run tool-table
// edge, operator 2026-09-29) with the program's start state pinned; this
// chip covers the seconds until the new payload lands.
const previewTloStale = computed(() =>
  parseTloMismatch(viewerGcode.value, vst.value?.tool_number, vst.value?.tool_length));

// Preview parsed against offsets that are no longer live — a touch-off after
// the file was loaded. Per FIXTURE on an epoch-aware payload (previewWcsStaleFor):
// the old active-vs-active comparison lit during every TWP run because the
// program itself switches G54→G59 at G53.x. The gateway's WCS-offset drift
// edge re-parses once idle and settled; the chip only reports the window.
const previewWcsStale = computed(() => {
  const g = viewerGcode.value;
  const s = vst.value;
  if (!g || !s) return false;
  return previewWcsStaleFor(
    g.wcsEvents, g.wcs_basis, s.wcs_table as WcsTableRow[] | undefined,
    { g5x: s.g5x_offset, g92: s.g92_offset, rotationDeg: s.rotation_xy });
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
// Baked-toolpath anchor: sibling of workOrigin, posed ONLY by toolpath.apply
// from the terms the drawn vertices were baked with (viewer/partFrame.ts
// anchorTerms). workOrigin keeps following the LIVE offsets for stock,
// surface map and axes; the toolpath must not, or it jumps ahead of its
// own re-bake (2026-09-03, operator-caught during a TWP run).
let pathAnchor: THREE.Group | null = null;
let pathRot: THREE.Group | null = null;
// The MACHINE frame node (the machine-bounds clip planes and the chunked
// path's overlay gate live in it): the work group's frame with every rotary
// DOF of the work chain at zero — machine coordinates by the machine.json
// convention (each model's chains carry the frame: joints-at-zero puts the
// tool tip on the work group's origin). A child of the PARENT of the work
// chain's topmost rotary node, so it follows table travel but never table
// rotation. 2026-09-11: the bounds box used to ride _workGrp and rotated
// with A — physically wrong on a rotary work chain (machine limits are
// joint limits, fixed in the room). Without a rotary on the work chain it
// IS _workGrp (3-axis and head-rotary-only machines: unchanged).
let machineFrameGrp: THREE.Group | null = null;
// Room-fixed toolpath parents under machineFrameGrp (2026-09-11), mirroring
// the table side one-to-one: roomOrigin/roomRotGroup follow the LIVE
// offsets (the programmed path), roomAnchor/roomRot are posed only by
// toolpath.apply from a bake's own terms. null when the work chain has no
// rotary (machineFrameGrp IS _workGrp — nothing to decouple).
let roomOrigin: THREE.Group | null = null;
let roomRotGroup: THREE.Group | null = null;
let roomAnchor: THREE.Group | null = null;
let roomRot: THREE.Group | null = null;
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
/** The physical tip offset of the last live pose — a change lifts the backplot's pen. */
let _bpTipOfs: [number, number, number] | null = null;

// Visual objects
let toolMarker: THREE.Group | null = null;
let toolCutterMesh: THREE.Mesh | null = null;
let toolBodyMesh: THREE.Mesh | null = null;
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
const toolpathOverflowCount = ref(0);   // the validator's violation count behind the flag

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
// renderer.info of the last main render (perf probe context).
let _glCalls = 0;
let _glLines = 0;
let _glTriangles = 0;
// The A/B measurement (viewer/abDriver.ts; temporary, Codex R39 VP39-03):
// its per-frame hook runs at the top of animate(), its notifier on a camera
// touched by hand.
let _abFrameHook: ((now: number) => void) | null = null;
let _abInteract: (() => void) | null = null;
let _abDriver: ReturnType<typeof createAbDriver> | null = null;
const scrubBarRef = ref<InstanceType<typeof ScrubBar> | null>(null);

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
  toolNum: number | null; toolDiam: number | null; toolLen: number | null; toolTableZ: number | null;
  toolMeta: unknown; rotationXy: number | null;
  /** Live fixture table (value-keyed — rows are re-copied each publish).
   *  A WCS-epoch preview re-adds per-fixture rows, so table edits must
   *  refresh the preview exactly like the active-fixture terms do. */
  wcsTableKey: string; wcsTable: WcsTableRow[] | null;
} = {
  jointPos: null, machinePos: null, g5x: null, g92: null, toolOffset: null,
  toolNum: NaN as unknown as number, toolDiam: NaN, toolLen: NaN, toolTableZ: NaN,
  toolMeta: undefined, rotationXy: NaN,
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
// The plane's OPAQUE outline (viewer contrast plan, V4 / VK-03): the fill
// (12 %) and the inner grid (35 %) stay translucent, the edge carries the
// contrast (R2 on its drawn colour) and the state's pattern (dashed = stale).
let twpEdgeMat: THREE.LineDashedMaterial | null = null;
let _twpLayerOn = true;
// The plane's colours are the viewer palette's plane roles (viewer contrast
// plan, V4): --viewer-plane-active / -defined / -stale per theme.

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

let machineBoundsMesh: BoxEdges | null = null;
// The tool setter puck (viewer/toolsetterMarker.ts): placed from the
// server-confirmed tool setter section, shown when it is set up and the
// "toolsetter" layer is on; re-placed on every settings change.
let toolsetterMarker: THREE.Group | null = null;
let _toolsetterLayerOn = true;
function applyToolsetterMarker() {
  if (!toolsetterMarker) return;
  const at = toolsetterPlacement(confirmedToolsetter());
  if (at) toolsetterMarker.position.set(at.x, at.y, at.topZ);
  toolsetterMarker.visible = !!at && _toolsetterLayerOn;
  requestRender();
}
watch(settingsVersion, applyToolsetterMarker);
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
  colors: () => palette,
  axisCss: AXIS_CSS,
  overflow: toolpathOverflow,
  overflowCount: toolpathOverflowCount,
  // Stale-path opacity from the design token (never a bare number here).
  staleOpacity: () => {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--opacity-disabled"));
    return Number.isFinite(v) ? v : 0.4;
  },
  // The stale grey = background lifted toward the foreground by the token,
  // OPAQUE — see ToolpathDeps.staleOpacity.
  sceneBackground: () => (scene?.background instanceof THREE.Color ? scene.background : sceneBgFromTheme()),
  sceneForeground: () => cssColor("--fg", "#e6edf3"),
});
// A stale drawn path is muted (2026-09-05): while the gateway re-parses,
// or while the payload's fixture offsets / tool length are known to
// differ from the live ones, the operator sees "not current" on the
// geometry itself, not only in a chip.
const pathStaleNow = computed(() => !!previewRefresh.value || previewWcsStale.value || !!previewTloStale.value
  || !!previewTableStale.value);
watch(pathStaleNow, (stale) => { toolpath.setStale(stale); requestRender(); }, { immediate: true });
// Machine bounds from the LIVE joint limits (status `joint_limits`, joint
// order → letters via viewer_init.axes), else the INI-derived viewer_init
// box. Memoized by value so the watcher fires only on a real change.
let _lastLiveBounds: MachineBox | null = null;
const liveMachineBounds = computed<MachineBox | null>(() => {
  const b = boundsFromJointLimits(vst.value?.joint_limits as JointLimits | null | undefined, viewerInit.value?.axes ?? []);
  if (sameBox(b, _lastLiveBounds)) return _lastLiveBounds;
  _lastLiveBounds = b;
  return b;
});
const effectiveBounds = computed<{ origin: Vec3; size: Vec3 } | undefined>(() => {
  const live = liveMachineBounds.value;
  if (live) return { origin: live.origin as Vec3, size: live.size as Vec3 };
  const mb = viewerInit.value?.machine_bounds;
  return (mb?.origin && mb?.size) ? { origin: mb.origin as Vec3, size: mb.size as Vec3 } : undefined;
});
watch(effectiveBounds, (mb) => {
  if (!machineBoundsMesh) return;   // buildFromInit applies the first box itself
  applyMachineBounds(mb);
  requestRender();
});
// Reused ctx object: a fresh object per call is avoidable gen-0 churn (GC
// pauses here are object-count driven). Safe to mutate in place —
// controllers read ctx fields synchronously and never retain it (contract in
// viewerContext.ts).
const _toolpathCtx: ToolpathCtx = {
  scene: null, workOrigin: null, workRotGroup: null, pathAnchor: null, pathRot: null,
  roomOrigin: null, roomRotGroup: null, roomAnchor: null, roomRot: null,
  pathAlwaysOnTop: false, units: undefined,
};
function toolpathCtx(): ToolpathCtx {
  _toolpathCtx.scene = scene;
  _toolpathCtx.workOrigin = workOrigin;
  _toolpathCtx.workRotGroup = workRotGroup;
  _toolpathCtx.pathAnchor = pathAnchor;
  _toolpathCtx.pathRot = pathRot;
  _toolpathCtx.roomOrigin = roomOrigin;
  _toolpathCtx.roomRotGroup = roomRotGroup;
  _toolpathCtx.roomAnchor = roomAnchor;
  _toolpathCtx.roomRot = roomRot;
  _toolpathCtx.pathAlwaysOnTop = pathAlwaysOnTop;
  _toolpathCtx.units = viewerInit.value?.units;
  return _toolpathCtx;
}
let _machineEdgeLines: THREE.LineSegments[] = [];
let machineEdges = false;
let groundGrid: THREE.GridHelper | null = null;
let themeMedia: MediaQueryList | null = null;
let _groupDirMap: Record<string, string | null> = {};  // group → direction (x/y/z/null)
let _partGroupMap: Record<string, string | null> = {};  // partId → group

function mkTextLabel(text: string, color: string, fontSize: number): Text {
  const t = new Text();
  t.font = LABEL_FONT_URL;
  t.text = text;
  t.fontSize = fontSize;
  t.color = color;
  t.anchorX = "center";
  t.anchorY = "middle";
  t.outlineWidth = "4%";
  t.outlineColor = "#000000";
  t.depthWrite = false;
  // A label lays out in troika's worker AFTER the frame that added it, and
  // the viewer renders on demand: without a render request when the sync
  // completes, the glyphs appeared only with the next unrelated frame (a
  // camera move) — found by the offline viewer spec's flake 2026-09-26.
  // Every sync here passes it (the fixture label's text change too).
  t.sync(requestRender);
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

// ── Default framing (WP5, review C) ──
// The radius of the machine MODEL (every non-stock mesh's world AABB
// corners) about a point — measured after scene.updateMatrixWorld(true),
// at the pose the scene is in. The travel box alone framed the XYZAC sim's
// 0.4 m envelope 0.94 m away while its 2.2 m base lay under the eye.
const _corner = new THREE.Vector3();
function _modelRadiusAbout(center: THREE.Vector3): number {
  if (!scene) return 0;
  scene.updateMatrixWorld(true);
  let r = 0;
  for (const mesh of machineMeshes) {
    if (mesh.userData.stock) continue;
    const geom = mesh.geometry;
    if (!geom.boundingBox) geom.computeBoundingBox();
    const bb = geom.boundingBox!;
    for (let i = 0; i < 8; i++) {
      _corner.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
      _corner.applyMatrix4(mesh.matrixWorld);
      r = Math.max(r, _corner.distanceTo(center));
    }
  }
  return r;
}

/** World AABB per non-stock part — the e2e camera gate's "outside every
 *  part" oracle (window.__viewerDiag.getPartBounds). */
function _partWorldBounds(): { id: string; min: number[]; max: number[] }[] {
  if (!scene) return [];
  scene.updateMatrixWorld(true);
  const out: { id: string; min: number[]; max: number[] }[] = [];
  const box = new THREE.Box3();
  for (const mesh of machineMeshes) {
    if (mesh.userData.stock) continue;
    box.setFromObject(mesh);
    out.push({ id: String(mesh.userData.partId), min: box.min.toArray(), max: box.max.toArray() });
  }
  return out;
}

/** The ONE default pose for a travel box: target = its centre, eye along
 *  the default direction at max(travel rule, model sphere + near), near/far
 *  and the orbit floor from cameraFraming.ts — for both projections. */
function _framePose(box: THREE.Box3) {
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  const radius = _modelRadiusAbout(center);
  const pose = defaultFramePose([center.x, center.y, center.z], maxDim, radius);
  return { center, maxDim, radius, pose, position: new THREE.Vector3(...pose.position) };
}

// The parallel eye stays OUTSIDE the whole scene — the ground grid, the
// machine, the drawn path (cameraFraming.orthoEyeDistance; operator
// 2026-09-30: the grid was cut off while orbiting — its far half passed
// behind the eye, which sat just outside the MODEL sphere). Pushed back
// along its own line of sight, never forward: the image does not change.
// Run for every rendered frame, so every way the eye moves (orbit, pan,
// view presets, Reset, a projection switch, tracking) is covered.
const _sceneBox = new THREE.Box3();
const _sceneSph = new THREE.Sphere();
const _eyeOff = new THREE.Vector3();
function _orthoEyeOutsideScene() {
  if (!(camera instanceof THREE.OrthographicCamera) || !controls) return;
  _sceneBox.makeEmpty();
  if (groundGrid) _sceneBox.expandByObject(groundGrid);
  for (const m of machineMeshes) _sceneBox.expandByObject(m);
  const pb = toolpath.pathWorldBox();
  if (pb) _sceneBox.union(pb);
  if (_sceneBox.isEmpty()) return;
  _sceneBox.getBoundingSphere(_sceneSph);
  const toCenter = controls.target.distanceTo(_sceneSph.center);
  const need = orthoEyeDistance(toCenter, _sceneSph.radius, camera.near);
  _eyeOff.subVectors(camera.position, controls.target);
  const d = _eyeOff.length();
  if (d > 0 && d < need) camera.position.copy(controls.target).addScaledVector(_eyeOff, need / d);
  const reach = Math.max(d, need) + toCenter + _sceneSph.radius;
  if (camera.far < reach) { camera.far = 2 * reach; camera.updateProjectionMatrix(); }
}

function _applyFrameLimits(near: number, far: number, minDistance: number) {
  if (!camera || !controls) return;
  camera.near = near;
  camera.far = far;
  controls.minDistance = minDistance;
}

// Frame camera to show the given bounding box.
// Handles both PerspectiveCamera (moves camera) and OrthographicCamera (sets frustum).
function frameToBounds(box: THREE.Box3) {
  if (!camera || !controls || box.isEmpty()) return;
  const { center, maxDim, pose, position } = _framePose(box);

  controls.target.copy(center);
  camera.up.set(0, 0, 1);
  _applyFrameLimits(pose.near, pose.far, pose.minDistance);

  if (camera instanceof THREE.OrthographicCamera) {
    const aspect = host.value ? (host.value.clientWidth / host.value.clientHeight) || 1 : 1;
    const halfH  = maxDim * 1.2;
    camera.top    =  halfH;  camera.bottom = -halfH;
    camera.right  =  halfH * aspect; camera.left = -halfH * aspect;
    camera.zoom   = 1;
  }
  camera.position.copy(position);

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
  const { center, maxDim, pose, position } = _framePose(box);

  // near/far don't need lerping — they only affect culling planes. Set immediately.
  // The ENDPOINT is the default pose (outside the model); the linear path
  // between the current eye and it is not certified — see cameraFraming.ts.
  _applyFrameLimits(pose.near, pose.far, pose.minDistance);

  const tgtEnd = center.clone();
  const upEnd = new THREE.Vector3(0, 0, 1);
  const posEnd: THREE.Vector3 = position;
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
    const b = _boundsWorldBox();
    if (!b) return;
    tweenFrameToBounds(b);
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

// A test seam (__viewerDiag.simulatePlane): the plane a simulation would draw,
// without the scrub chain that derives it from the program (kins spec,
// frames, WCS epochs) — undefined = no such override.
let _diagSimulatedPlane: number[] | null | undefined = undefined;
function _twpRefresh() {
  const d: any = status.value?.data;
  if (simMode.value || _scrubJoints || _diagSimulatedPlane !== undefined) {
    // Simulating: the model shows the PROGRAM, so the overlay must too.
    // No plane data for this point means the program has not established
    // one there — HIDE it. Falling through to live status would put a
    // machine fact on screen beside a simulated machine, which is the
    // incoherence this exists to remove. Staleness is a claim about the
    // live setup and is meaningless here, so it is never applied in sim.
    const plane = _diagSimulatedPlane !== undefined ? _diagSimulatedPlane : _scrubPlane;
    updateTwpPlane(plane, plane != null, planeView({ simulated: true, active: true, headMoved: false, datumMoved: false }));
    return;
  }
  const k = d?.kins_type == null ? -1 : Math.round(Number(d.kins_type));
  updateTwpPlane(d?.twp_plane, !!d?.twp_defined, planeView({
    simulated: false,
    // In effect = the helper's is-active AND the plane kinematics (the two
    // agree in operation; either missing is "defined", the cautious word).
    active: !!d?.twp_active && k === 2,
    headMoved: twpPoseStale(poseAbcOf(d), d?.rotary_abc, d?.twp_defined),
    datumMoved: twpDatumStale(d?.wcs_table?.[0], d?.twp_datum, d?.twp_defined, d?.wcs_prov_a?.[0]),
  }));
}

function updateTwpPlane(plane: unknown, defined: boolean, view: PlaneView) {
  const shown = defined ? view : null;
  if (planeViewState.value?.hudWord !== shown?.hudWord) planeViewState.value = shown;
  if (!twpPlaneGroup) return;
  const ok = defined && Array.isArray(plane) && plane.length === 9 &&
    (plane as unknown[]).every((v) => Number.isFinite(Number(v)));
  // The state joins the signature or the tint would never repaint — a few
  // words, so live A jitter under the eps costs nothing.
  const sig = ok
    ? `${(plane as number[]).map((v) => Number(v).toFixed(4)).join(",")}|${view.role}|${view.label}|${view.arrowStale}|${_twpLayerOn}|${simMode.value}`
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
  // Colour, label, edge pattern and arrow from ONE decision (planeView):
  // the label names the state at the object, a stale plane's edge is dashed,
  // and the arrow — the tool-normal claim — turns only for the head.
  const color = palette[view.role];
  if (twpNormalArrow) {
    (twpNormalArrow.line.material as THREE.LineBasicMaterial).color
      .set(view.arrowStale ? palette.planeStale : AXIS_HEX.z);
    (twpNormalArrow.cone.material as THREE.MeshBasicMaterial).color
      .set(view.arrowStale ? palette.planeStale : AXIS_HEX.z);
  }
  if (twpPlaneMat) twpPlaneMat.color.set(color);
  if (twpGridMat) twpGridMat.color.set(color);
  if (twpEdgeMat) {
    twpEdgeMat.color.set(color);
    twpEdgeMat.userData.role = view.role;
    twpEdgeMat.gapSize = view.dashed ? twpEdgeMat.dashSize * 0.6 : 0;
  }
  if (twpPlaneLabel) {
    twpPlaneLabel.text = view.label;
    twpPlaneLabel.color = color;
    twpPlaneLabel.sync(requestRender);
  }
  twpPlaneGroup.visible = true;
  requestRender();
}

// The stored toolpath and Rapids layers, and the SECTION of a finding
// navigated to on a hidden one (fixed palette P3, viewer/pathReveal.ts;
// Codex R31 VP-I03: the finding's move, never the whole hidden layer) —
// the stored choice is never rewritten.
const _pathLayers = { toolpath: true, rapids: true };
function applyPathLayers() {
  toolpath.setVisible(_pathLayers.toolpath);
  toolpath.setRapidsVisible(_pathLayers.rapids);
  toolpath.setReveal(sectionOf(pathReveal.value));
  requestRender();
}
watch(pathReveal, applyPathLayers);
// A finding's temporary view ends with the simulation and with the program.
watch(simMode, (on) => { if (!on) pathReveal.value = null; });
watch(viewerGcode, () => { pathReveal.value = null; });
function onFinding(onRapid: boolean, run: [number, number] | null) {
  pathReveal.value = revealFor(onRapid, _pathLayers, run);
}
function endPathReveal() { pathReveal.value = null; }
const pathRevealText = computed(() => revealText(pathReveal.value));

function setLayerVisible(layer: Layer, on: boolean) {
  if (pendingLayers) {
    pendingLayers.set(layer, on);
  }
  switch (layer) {
    case "backplot":
      backplot.setVisible(on);
      break;
    case "toolpath":
    case "rapids":
      // A CHANGED choice of either layer — here or from another client —
      // ends a finding's temporary view: the layer is the operator's. Every
      // settings refresh re-applies every layer (applyViewerDefaults), so an
      // unchanged value — a theme switch, another section saved — keeps it
      // (Codex R31 VP-I01).
      if (_pathLayers[layer] !== on) pathReveal.value = null;
      _pathLayers[layer] = on;
      applyPathLayers();
      break;
    case "machine":
      for (const m of machineMeshes) m.visible = on;
      for (const e of _machineEdgeLines) e.visible = on && machineEdges;
      break;
    case "groundGrid":
      if (groundGrid) groundGrid.visible = on;
      break;
    case "bounds":
      if (machineBoundsMesh) machineBoundsMesh.visible = on;
      break;
    case "toolsetter":
      _toolsetterLayerOn = on;
      applyToolsetterMarker();
      break;
    case "toolpathBounds":
      toolpath.setBoundsVisible(on);
      break;
    case "reachRoom":
      _reachRoomOn = on;
      if (reachRoomMesh) reachRoomMesh.visible = on;
      if (on) _reachRequest();
      break;
    case "reachPart":
      _reachPartOn = on;
      if (reachPartMesh) reachPartMesh.visible = on;
      if (on) _reachRequest();
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
  frame: new THREE.MeshStandardMaterial(MACHINE_SURFACE),
  axisX: new THREE.MeshStandardMaterial(MACHINE_SURFACE),
  axisY: new THREE.MeshStandardMaterial(MACHINE_SURFACE),
  axisZ: new THREE.MeshStandardMaterial(MACHINE_SURFACE),
};

// Machine-part defaults come from viewer/palette.ts (one table for the
// scene build, the live recolor and the settings pickers).
MAT.frame.color.setHex(MACHINE_PALETTE.frame);
MAT.axisX.color.setHex(MACHINE_PALETTE.x);
MAT.axisY.color.setHex(MACHINE_PALETTE.y);
MAT.axisZ.color.setHex(MACHINE_PALETTE.z);
MAT.tool.color.set(palette.tool);      // shaft
MAT.cutter.color.set(palette.cutter);  // cutter

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
  groundGrid = null;
  if (!scene) return;
  while (scene.children.length) {
    const c = scene.children.pop()!;
    disposeObject(c);
  }
}

/** The box the viewer currently draws and clips against (live joint limits
 *  or the INI fallback) — what toolpathCtx hands the overlay gate. */
let _effectiveBounds: { origin: Vec3; size: Vec3 } | undefined;

/** Apply a machine-bounds box: the wireframe mesh, the six outward clip
 *  planes (rebuilt IN PLACE — the toolpath materials hold these arrays by
 *  reference), the camera's reframe box and the overlay gate's box. All in
 *  machine coordinates under machineFrameGrp. */
function applyMachineBounds(mb: { origin: Vec3; size: Vec3 } | undefined) {
  _effectiveBounds = mb;
  if (!machineBoundsMesh || !mb?.size || !mb?.origin) {
    if (!mb) console.warn("No machine bounds (live joint limits or viewer_init); bounds box will remain default");
    return;
  }
  const [sx, sy, sz] = mb.size, [ox, oy, oz] = mb.origin;
  machineBoundsMesh.setSize(sx, sy, sz);
  machineBoundsMesh.position.set(ox + sx / 2, oy + sy / 2, oz + sz / 2);
  // Clipping planes for the outside-bounds overlay (normals point outward),
  // stored in MACHINE-frame local space and transformed to world space each
  // rendered frame in animate().
  const [bx, by, bz] = mb.origin;
  const [bsx, bsy, bsz] = mb.size;
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
  if (_iniBox) {
    _iniBox.set(new THREE.Vector3(bx, by, bz), new THREE.Vector3(bx + bsx, by + bsy, bz + bsz));
  }
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
  reachRoomMesh = reachPartMesh = null;   // disposed with the scene; rebuilt from _reachData
  twpNormalArrow = null;
  twpEdgeMat = null;
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

  // Machine frame (see the declaration comment): parent = the parent of the
  // topmost rotary node on the work chain; static offset = the base
  // translates from the work group up to that rotary node (rotations are
  // zero there, so the composition is a plain sum). Linear DOFs BELOW the
  // topmost rotary (a slide riding a rotary table) are not tracked — none
  // of the shipped models has one.
  {
    const workId = init.workGroup ?? grpDefs[0]?.id ?? "root";
    const parentOf: Record<string, string> = {};
    for (const g of grpDefs) parentOf[g.id] = g.parent;
    const rotGroups = new Set(normalizeKinematicsCached(init.kinematics).filter(k => k.rotate).map(k => k.group));
    let topRot: string | null = null;
    for (let id: string | undefined = workId; id && id !== "root" && groups[id]; id = parentOf[id]) {
      if (rotGroups.has(id)) topRot = id;
    }
    if (topRot) {
      const linId = parentOf[topRot];
      const linGrp = (linId && linId !== "root" && groups[linId]) ? groups[linId]! : groups.root!;
      machineFrameGrp = new THREE.Group();
      for (let id: string | undefined = workId; id && id !== "root" && groups[id]; id = parentOf[id]) {
        machineFrameGrp.position.add(_groupBase[id] ?? groups[id]!.position);
        if (id === topRot) break;
      }
      linGrp.add(machineFrameGrp);
    } else {
      machineFrameGrp = _workGrp;
    }
  }
  roomOrigin = roomRotGroup = roomAnchor = roomRot = null;
  if (machineFrameGrp && machineFrameGrp !== _workGrp) {
    roomOrigin = new THREE.Group();
    machineFrameGrp.add(roomOrigin);
    roomRotGroup = new THREE.Group();
    roomOrigin.add(roomRotGroup);
    roomAnchor = new THREE.Group();
    machineFrameGrp.add(roomAnchor);
    roomRot = new THREE.Group();
    roomAnchor.add(roomRot);
  }

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
      color: palette.planeActive, transparent: true, opacity: 0.12,
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
        color: palette.planeActive, transparent: true, opacity: 0.35, depthWrite: false,
      });
      twpPlaneGroup.add(new THREE.LineSegments(g, twpGridMat));
      // The opaque outline (VK-03): four edges, dashed while stale.
      const e = [[-half, -half], [half, -half], [half, half], [-half, half]];
      const ep: number[] = [];
      for (let i = 0; i < 4; i++) ep.push(e[i]![0]!, e[i]![1]!, 0, e[(i + 1) % 4]![0]!, e[(i + 1) % 4]![1]!, 0);
      const eg = new THREE.BufferGeometry();
      eg.setAttribute("position", new THREE.Float32BufferAttribute(ep, 3));
      twpEdgeMat = new THREE.LineDashedMaterial({ color: palette.planeActive, dashSize: 12 * _unitScale, gapSize: 0, depthWrite: false });
      twpEdgeMat.userData.role = "planeActive";
      const edge = new THREE.LineSegments(eg, twpEdgeMat);
      edge.computeLineDistances();
      twpPlaneGroup.add(edge);
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
    twpPlaneLabel = mkTextLabel("Plane", palette.planeActive, _tl * 0.45);
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
  backplot.build(_workGrp!, palette.backplot, !pathAlwaysOnTop);

  // Default tool until the next viewer_state tick rebuilds the real one
  // (_currentToolNum was reset above, so a loaded tool re-triggers needsRebuild).
  if (_currentToolNum == null) {
    replaceToolMarker(buildToolGroup(6 * _unitScale, 60 * _unitScale, null));
  }



  // --- Machine bounds box — wireframe edges only, two-tone (a dark line
  // with light dashes, long ones — operator 2026-09-29): it reads on every
  // background and on every grey of the model. Built at its real size by
  // applyMachineBounds, never scaled (a scale would stretch the dashes) ---
  {
    machineBoundsMesh = makeBoxEdges([1, 1, 1], { color: palette.bounds, alt: palette.boundsAlt,
      width: MACHINE_BOX_PX, dashPx: MACHINE_BOX_DASH_PX, role: "bounds" });
    // MACHINE frame, never the rotating work group: the clip planes that
    // decide the yellow outside-bounds overlay live there (7a04909), and the
    // box that stayed under _workGrp swung with A while the clipping did not
    // — "yellow while inside the box" (operator, 2026-09-12). On rotary-free
    // work chains machineFrameGrp IS _workGrp.
    (machineFrameGrp ?? _workGrp)!.add(machineBoundsMesh);
  }
  // The tool setter (operator 2026-09-29): a puck in the MACHINE frame at the
  // set-up tool setter position, its top face at the contact Z.
  toolsetterMarker = buildToolsetterMarker(_unitScale, MACHINE_SURFACE);
  (machineFrameGrp ?? _workGrp)!.add(toolsetterMarker);
  applyToolsetterMarker();
  // Reach envelope layer (2026-09-12): the cached solids re-hang under the
  // rebuilt frame groups; a new machine model recomputes (inputs key).
  if (_reachRoomOn || _reachPartOn) _reachRequest();

  // Apply tool colors
  MAT.tool.color.set(palette.tool);
  MAT.cutter.color.set(palette.cutter);
}

/**
 * Single owner of the tool marker (H3). Both the default-marker site
 * (ensureCoreGroups) and the live tool-change site (applyState) route through
 * here, so _toolGrp can never accumulate two markers: any prior one is removed
 * from its actual parent and disposed before the new one is added. Without this,
 * a tool-change landing during buildFromInit's async loadMachineAssets gap could
 * add a second marker, orphaning the first (its buildToolGeometry leaked).
 * disposeObject skips the shared MAT.tool/cutter; only the per-marker
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

/** Build the physical tool. Imported holders are nominal library assemblies;
 * live placement requires an independently calibrated spindle gauge reference.
 * The tool group continues to use the signed active LinuxCNC tool offset. */
function buildToolGroup(diam: number, len: number, meta: ToolMeta | null): THREE.Group {
  const grp = new THREE.Group();
  const { cutter, shaft } = buildToolGeometries(diam, len, meta, _unitScale);

  toolCutterMesh = null;
  if (cutter) {
    toolCutterMesh = new THREE.Mesh(cutter, MAT.cutter);
    grp.add(toolCutterMesh);
  }
  toolBodyMesh = null;
  if (shaft) {
    toolBodyMesh = new THREE.Mesh(shaft, MAT.tool);
    grp.add(toolBodyMesh);
  }

  return grp;
}

/** A theme colour token (`--bg`, `--fg`, `--danger`, …) as a THREE colour.
 *  The tokens are plain hex per theme — THREE cannot parse color-mix(). */
function cssColor(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}
function sceneBgFromTheme(): THREE.Color { return cssColor("--bg", "#0b0f14"); }

async function buildFromInit(init: ViewerInit) {
  if (!scene) return;

  buildToken++;
  const myToken = buildToken;

  clearScene();
  window.__viewerDiag = { ready: false };

  try {
    _unitScale = toolUnitsPerMillimeter(init.units);

    scene.background = sceneBgFromTheme();

    scene.add(createMachineLighting());

    ensureCoreGroups(init);
    // Capture the static assembly before the async load: live status can move
    // groups during that await. Grid placement must not depend on axis pose.
    scene.updateMatrixWorld(true);
    const baseFrames = new Map(Object.entries(groups).map(([id, group]) => [id, group.matrixWorld.clone()]));
    const modelBounds = new THREE.Box3();
    // Program-zero markers evaluate the same chain the part-frame worker
    // gets; one instance per build so the memoized chain stays warm.
    _markerMachine = _pfMachine(init);
    _markerDirty = true;
    // Machine bounds: the LIVE joint limits when the status carries them
    // (the TWP sim's Z window follows the kins mode through a HAL mux), else
    // the INI-derived viewer_init box. Re-applied by the watcher on change.
    applyMachineBounds(effectiveBounds.value);

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
      mesh.userData.stock = !!p.stock;  // excluded from the default-framing model sphere
      const t = p.translate ?? p.t;
      if (t) mesh.position.set(t[0] * _unitScale, t[1] * _unitScale, t[2] * _unitScale);
      const r = p.rotate ?? p.r;
      if (r) mesh.rotation.set(r[0], r[1], r[2]);
      mesh.scale.setScalar(_unitScale);  // convert mm STL geometry → machine-unit world

      const parent = (grp ? groups[grp] : groups.root) ?? groups.root!;
      parent.add(mesh);
      machineMeshes.push(mesh);
      if (!p.stock) {
        mesh.updateMatrix();
        if (!geom.boundingBox) geom.computeBoundingBox();
        const base = baseFrames.get(grp ?? "root") ?? baseFrames.get("root")!;
        const assembled = base.clone().multiply(mesh.matrix);
        modelBounds.union(geom.boundingBox!.clone().applyMatrix4(assembled));
      }
    }

    // Auto-frame to machine work envelope — use raw INI data (not setFromObject) so
    // the frame is immune to axis movement that may have shifted axis groups above.
    // Falls back to STL mesh world bounds if no bounds data present.
    {
      let autoBox = new THREE.Box3();
      const mb = _effectiveBounds ?? init.machine_bounds;
      if (mb?.size && mb?.origin) {
        const [ox, oy, oz] = mb.origin as [number, number, number];
        const [sx, sy, sz] = mb.size as [number, number, number];
        autoBox.set(new THREE.Vector3(ox, oy, oz),
                    new THREE.Vector3(ox + sx, oy + sy, oz + sz));
      } else if (machineMeshes.length > 0) {
        for (const m of machineMeshes) autoBox.expandByObject(m);
      }
      groundGrid = createGroundGrid(modelBounds.isEmpty() ? autoBox : modelBounds, _unitScale);
      if (groundGrid) scene.add(groundGrid);
      updateSceneTheme();
      _iniBox = autoBox.clone();
      frameToBounds(autoBox);
      _needsReframe = true;

      window.__viewerDiag = {
        ready: true,
        meshCount: machineMeshes.length,
        boundsValid: !autoBox.isEmpty(),
        timestamp: Date.now(),
        // Camera gate (WP5): where the eye is, where the parts are, and the
        // same view entry points the ViewCube / presets use.
        getCamera: () => camera && controls ? {
          position: camera.position.toArray(), target: controls.target.toArray(),
          near: camera.near, far: camera.far, ortho: camera instanceof THREE.OrthographicCamera,
          minDistance: controls.minDistance,
        } : null,
        getPartBounds: _partWorldBounds,
        /** The ground grid's nearest and farthest point along the line of
         *  sight (view-space depth) against the camera's near and far. */
        getGroundGridDepth: () => {
          if (!camera || !groundGrid) return null;
          camera.updateMatrixWorld();
          groundGrid.updateMatrixWorld();
          const pos = groundGrid.geometry.getAttribute("position");
          const v = new THREE.Vector3();
          let min = Infinity, max = -Infinity;
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(groundGrid.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
            min = Math.min(min, -v.z); max = Math.max(max, -v.z);
          }
          return { min, max, near: camera.near, far: camera.far };
        },
        getFrameBox: () => { const b = _boundsWorldBox(); return b ? { min: b.min.toArray(), max: b.max.toArray() } : null; },
        setView: (p: string) => setView(p as ViewPreset),
        setViewDirection: (dir: number[], distance?: number) => {
          if (!camera || !controls) return;
          if (distance != null) {
            const d = new THREE.Vector3(dir[0]!, dir[1]!, dir[2]!).normalize();
            camera.position.copy(controls.target).addScaledVector(d, distance);
            controls.update();
            requestRender();
            return;
          }
          applyViewDirection(new THREE.Vector3(dir[0]!, dir[1]!, dir[2]!), new THREE.Vector3(0, 0, 1), false);
        },
        switchProjection,
        defaultFrameDir: [...DEFAULT_FRAME_DIR],
        // The palette as resolved and as DRAWN (design wave D8c): per role
        // the colour of the first material carrying that role in the scene
        // (materials are tagged userData.role), the tool's shared MATs and
        // the emissive of a tinted (collision) mesh.
        getPalette: () => {
          const drawn: Record<string, string> = {};
          scene?.traverse(o => {
            const m = (o as THREE.Mesh).material as (THREE.Material & { color?: THREE.Color }) | undefined;
            const role = m?.userData?.role as string | undefined;
            if (role && m?.color && !(role in drawn)) drawn[role] = "#" + m.color.getHexString();
          });
          drawn.tool = "#" + MAT.tool.color.getHexString();
          drawn.cutter = "#" + MAT.cutter.color.getHexString();
          const tinted = [...machineMeshes, toolCutterMesh, toolBodyMesh].find(mm => mm?.userData._clashOn);
          if (tinted) drawn.collision = "#" + (tinted.material as THREE.MeshStandardMaterial).emissive.getHexString();
          return { resolved: { ...palette }, drawn, mode: viewerDefaults.paletteMode };
        },
        // Put a part under the collision tint (or take it off) without a
        // sweep — the palette spec checks the tint follows a theme switch.
        // Every troika label in the scenes and how many have laid out (a
        // glyph layout exists) — the offline spec asks this directly; a
        // texture count compared with a moment before raced the gizmo's
        // labels, which build the shared glyph atlas first.
        // Every role-tagged material as DRAWN (viewer contrast plan, R1/R2):
        // its kind — `fat` a screen-space line with its CSS-px width (every
        // path line's 2, part B), `dashed` / `basic` a GL line of one device
        // pixel — `dashed` the pair table's form cue on either, and its
        // opacity whether the colour needs compositing.
        // The part-B memory ledger (Codex R39 VP39-01): bytes by owner, CPU
        // per unique ArrayBuffer, GPU per buffer actually uploaded.
        getPathMemory: () => toolpath.pathMemory(),
        // The drawn path's world box, and an explicit camera pose (Codex R39:
        // a segment through the near plane, e2e/fatpaths.viewer.spec.ts).
        getPathBox: () => { const b = toolpath.pathWorldBox(); return b ? { min: b.min.toArray(), max: b.max.toArray() } : null; },
        setCameraPose: (position: number[], target: number[]) => {
          if (!camera || !controls) return;
          camera.up.set(0, 0, 1);
          camera.position.set(position[0]!, position[1]!, position[2]!);
          controls.target.set(target[0]!, target[1]!, target[2]!);
          controls.update();
          requestRender();
        },
        // The A/B run with short phases (the e2e; the operator's run is the
        // Debug tab's button with the full durations).
        runAbMeasurement: (durations?: Record<string, number>) => startAbRun({ durations }),
        cancelAbMeasurement: () => cancelAbRun(),
        getRoleMaterials: () => {
          const out: { role: string; kind: string; widthPx: number | null; dashed: boolean; opacity: number; transparent: boolean }[] = [];
          const seen = new Set<string>();
          scene?.traverse(o => {
            const m = (o as THREE.Mesh).material as (THREE.Material & { linewidth?: number }) | undefined;
            const role = m && !Array.isArray(m) ? m.userData?.role as string | undefined : undefined;
            if (!role) return;
            const kind = (m as any).isLineMaterial ? "fat" : (m as any).isLineDashedMaterial ? "dashed"
              : (m as any).isLineBasicMaterial ? "basic" : "other";
            if (seen.has(`${role}|${kind}`)) return;
            seen.add(`${role}|${kind}`);
            out.push({ role, kind, widthPx: kind === "fat" ? m!.linewidth ?? null : kind === "other" ? null : 1,
              dashed: kind === "dashed" || (kind === "fat" && !!(m as { dashed?: boolean }).dashed),
              opacity: m!.opacity, transparent: m!.transparent });
          });
          return out;
        },
        // The longest visible segment of a role on screen (CSS px, page
        // coordinates): its midpoint and unit direction — the viewer specs
        // sample the rendered pixels across it to measure the drawn width.
        projectRole: (role: string) => {
          let best: { x: number; y: number; dx: number; dy: number; length: number } | null = null;
          _projectRoleSegments(role, s => { if (s.length > (best?.length ?? 0)) best = s; });
          return best;
        },
        // Every visible segment of a role on screen (Codex R44 VP-I10: the
        // box dashes measured along each edge, not only the longest).
        projectRoleSegments: (role: string) => {
          const out: { x: number; y: number; dx: number; dy: number; length: number }[] = [];
          _projectRoleSegments(role, s => out.push(s));
          return out;
        },
        // The tool setter puck (operator 2026-09-29): shown (incl. every
        // parent), its top centre in the machine frame, and its screen point.
        // The drawn tool tip in the machine frame (the puck's frame) and the
        // backplot's size (Codex R44 ST-I03: G49 never moves the drawn tool).
        getToolTip: () => {
          if (!toolMarker) return null;
          const w = toolMarker.getWorldPosition(new THREE.Vector3());
          const frame = machineFrameGrp ?? _workGrp;
          if (frame) { frame.updateWorldMatrix(true, false); frame.worldToLocal(w); }
          return w.toArray();
        },
        getBackplot: () => ({ points: backplot.count, segments: backplot.segments }),
        getToolsetter: () => {
          if (!toolsetterMarker) return null;
          let shown = toolsetterMarker.visible;
          for (let p = toolsetterMarker.parent; p; p = p.parent) shown &&= p.visible;
          let screen: { x: number; y: number } | null = null;
          if (camera && renderer) {
            const rect = renderer.domElement.getBoundingClientRect();
            const w = toolsetterMarker.getWorldPosition(new THREE.Vector3()).project(camera);
            screen = { x: rect.left + (w.x + 1) / 2 * rect.width, y: rect.top + (1 - w.y) / 2 * rect.height };
          }
          return { visible: shown, top: toolsetterMarker.position.toArray(), screen };
        },
        // The tilted work plane as drawn (viewer contrast plan, V4): the label
        // on the object, the edge's role, pattern and opacity, the arrow's
        // claim and the HUD's word — one decision behind all of them.
        getPlane: () => {
          if (!twpPlaneGroup) return null;
          let shown = twpPlaneGroup.visible;
          for (let p = twpPlaneGroup.parent; p; p = p.parent) shown &&= p.visible;
          const arrow = twpNormalArrow ? "#" + (twpNormalArrow.line.material as THREE.LineBasicMaterial).color.getHexString() : null;
          return {
            visible: shown, label: twpPlaneLabel ? String(twpPlaneLabel.text) : null,
            role: (twpEdgeMat?.userData.role as string | undefined) ?? null, dashed: (twpEdgeMat?.gapSize ?? 0) > 0,
            edge: twpEdgeMat ? { color: "#" + twpEdgeMat.color.getHexString(), opacity: twpEdgeMat.opacity, transparent: twpEdgeMat.transparent } : null,
            arrowStale: arrow === palette.planeStale, hudWord: planeViewState.value?.hudWord ?? null,
          };
        },
        // Draw a plane as a simulation would (null = sim with no plane there,
        // undefined = back to live) — the seam past the scrub chain.
        simulatePlane: (plane: number[] | null | undefined) => { _diagSimulatedPlane = plane; _twpSig = ""; _twpRefresh(); },
        getLabels: () => {
          let total = 0, laidOut = 0;
          for (const sc of [scene, _gizmoScene]) sc?.traverse(o => {
            if (o instanceof Text) { total++; if ((o as any).textRenderInfo) laidOut++; }
          });
          return { total, laidOut };
        },
        tintPart: (id: string, on: boolean) => { for (const m of _clashMeshes(id)) _tintMesh(m, on); requestRender(); },
        // Collision findings on the swept track without a model that collides
        // (`frac` = a place on the track's axis): the layout spec measures the
        // findings row with them (review round 7, UI-DI15). Needs a finished
        // sweep; a program change drops them with the result.
        setCollisionHits: (hits: { line: number; frac: number; rapid?: boolean }[]) => {
          const r = collisionResult.value, t = collisionTrack.value;
          if (!r || !t || !t.count) return false;
          const end = t.cum[t.count - 1]!;
          // A model without moving pairs (the layout mock's) reads "No moving
          // pairs" whatever the hits say — a collision implies a pair.
          collisionResult.value = { ...r, pairCount: Math.max(1, r.pairCount), hits: hits.map(h => ({ line: h.line, cum: h.frac * end, cumEnd: h.frac * end,
            intervals: [[h.frac * end, h.frac * end] as [number, number]], a: "tool", b: "table", dist: 0, rapid: !!h.rapid })) };
          // The code panel's marks, as a finished sweep sends them.
          emit("collision-lines", hits.map(h => ({ line: h.line })));
          return true;
        },
        getAppearance: () => ({
          grid: groundGrid ? {
            visible: groundGrid.visible,
            position: groundGrid.position.toArray(),
            color: Array.from(groundGrid.geometry.getAttribute("color").array).slice(0, 3),
          } : null,
          outlinedParts: _machineEdgeLines.filter(e => e.visible).length,
          parts: machineMeshes.map(mesh => ({
            id: mesh.userData.partId as string,
            normalsVersion: mesh.geometry.userData.machineNormalsVersion as number,
            position: mesh.getWorldPosition(new THREE.Vector3()).toArray(),
            color: (mesh.material as THREE.MeshStandardMaterial).color.getHexString(),
          })),
        }),
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
      // What else was running when the window closed — a busy worker is
      // off the main thread but not off the machine (2026-09-09: the GPU
      // trailed 3–4 frames after every publish with the sweep re-running).
      sweep_busy: collisionBusy.value,
      sweep_pct: collisionBusy.value ? Math.round(collisionProgress.value * 100) : null,
      pf_pending: _pfPending,
      path_stale: pathStaleNow.value,
      // Chunked draw (2026-09-11): what the GPU was actually handed —
      // segments at the current draw ranges, chunk count, chunks inside the
      // frustum and outside-bounds overlays drawn (both from the last
      // updateCulling), draw calls / line primitives of the last main
      // render, and which display path built the lines.
      draw_segs: toolpath.drawSegs,
      room_segs: toolpath.roomSegs,
      lod_min: toolpath.lodMin,
      lod_max: toolpath.lodMax,
      lod_ms: toolpath.lodMs,
      chunks: toolpath.chunks,
      chunks_visible: toolpath.chunksVisible,
      overlay_chunks: toolpath.overlayChunks,
      frame_mixed: toolpath.frameMixed,
      gl_calls: _glCalls,
      gl_lines: _glLines,
      display_mode: _pfAppliedMode,
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

  // Phase 3 — the tool TIP: shift the tool group by the tool's offset
  // relative to its (base or DOF-composed) position. Under a scrub pose the
  // SAMPLE's offset is what its joints were lifted with (schema 8) — live
  // tool_offset would put the tip a tool-length delta off the path after an
  // in-program G43 (the fresh-boot 22.000 class); a G49 segment of the
  // program still poses its tip at the control point (named limit, R45).
  // LIVE the drawn tool is the PHYSICAL one (Codex R44 ST-I03): its Z is the
  // spindle tool's TABLE offset WITH ITS SIGN (status tool_table_z — never
  // tool_length, a magnitude: a negative table offset drawn from it put the
  // tip 2 × L off, R45 ST-I04). G49 during a tool measurement zeroes the
  // active offset, and the drawn tip used to jump a tool length up while the
  // tool stayed where it was; under G43 with the spindle tool's own offset
  // both are the same. Without a table row no physical length is known: the
  // active (signed) offset, as before. X/Y stay the active offset's.
  let tipOk = false;
  if (_scrubJoints && _scrubTlo) {
    if (_scrubTlo.length >= 3) { _tofsVec.set(_scrubTlo[0] ?? 0, _scrubTlo[1] ?? 0, _scrubTlo[2] ?? 0); tipOk = true; }
  } else {
    const t = st.tool_offset;
    const len = st.tool_table_z ?? (t && t.length >= 3 ? t[2] : null);
    if (len != null) { _tofsVec.set(t?.[0] ?? 0, t?.[1] ?? 0, len); tipOk = true; }
  }
  if (tipOk) _toolGrp.position.sub(_tofsVec);
  // The trail follows the machine, never a length: a changed physical offset
  // moves the drawn tip with no motion — lift the pen (no stroke to it).
  if (!_scrubJoints) {
    const lx = tipOk ? _tofsVec.x : 0, ly = tipOk ? _tofsVec.y : 0, lz = tipOk ? _tofsVec.z : 0;
    if (_bpTipOfs && (Math.abs(_bpTipOfs[0] - lx) > 1e-6 || Math.abs(_bpTipOfs[1] - ly) > 1e-6 || Math.abs(_bpTipOfs[2] - lz) > 1e-6)) backplot.lift();
    _bpTipOfs = [lx, ly, lz];
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
    if (roomOrigin) roomOrigin.position.set(_liveAnchor.ox, _liveAnchor.oy, _liveAnchor.oz);
  }
  if (workRotGroup) {
    workRotGroup.rotation.z = _liveAnchor.thetaDeg * Math.PI / 180;
    if (roomRotGroup) roomRotGroup.rotation.z = _liveAnchor.thetaDeg * Math.PI / 180;
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
        const r = diam * 0.5;
        const prev = (visMesh.userData.toolVis as any) || {};
        return Math.abs((prev.r ?? 0) - r) > 0.01 * _unitScale
            || Math.abs((prev.L ?? 0) - visLen) > 0.5 * _unitScale;
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

  // Render-on-demand: detect whether anything visually changed since the last
  // applied state. Status broadcasts arrive at ~30 Hz; without this diff we'd
  // render every status arrival even when joints are still. motion_line is not
  // a visual input: the current line is not drawn in 3D (operator 2026-09-28). Fields checked cover everything applyState mutates visually.
  // Cheap field-wise compare (no per-tick allocation) replaces JSON.stringify.
  const toolNum = st.tool_number ?? null;
  const toolDiam = st.tool_diameter ?? null;
  const toolLen = st.tool_length ?? null;
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
  if ((st.tool_table_z ?? null) !== _pv.toolTableZ) { _pv.toolTableZ = st.tool_table_z ?? null; changed = true; }
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
    workAxesLabel.sync(requestRender);
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
let _pfPending = false;   // a part-frame transform is in flight (perf-probe context)
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
      const m = ev.data as { id: number; error?: string; needPayload?: number; feedPos?: Float32Array; feedLines?: Uint32Array; feedLineIndex?: LineIndex; rapidPos?: Float32Array; rapidDist?: Float32Array; feedBreaks?: Uint32Array; rapidBreaks?: Uint32Array; feedSrc?: Uint32Array; rapidSrc?: Uint32Array; feedRoom?: Uint8Array; rapidRoom?: Uint8Array; frameFlips?: number; feedOutside?: Uint8Array; rapidOutside?: Uint8Array; feedLod?: Uint32Array[]; rapidLod?: Uint32Array[]; lodTols?: number[]; lodMs?: number };
      if (m.id !== _pfReqId) return;  // superseded
      _pfPending = false;
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
        // Source track index per baked vertex (subdivided samples share
        // their segment's): the finding's section addresses both streams.
        feedSrc: m.feedSrc, rapidSrc: m.rapidSrc,
        // Room split (2026-09-11): per drawn vertex, baked room-fixed or on
        // the part; absent when the transform had no boundary to apply.
        feedRoom: m.feedRoom, rapidRoom: m.rapidRoom,
        // The validator's outside-limits flag carried per baked sample (2026-09-12).
        feedOutside: m.feedOutside, rapidOutside: m.rapidOutside,
        // Display LOD levels cut over the BAKED vertices (the payload's own
        // levels address the programmed vertices, a different space).
        feedLod: m.feedLod, rapidLod: m.rapidLod, lodTols: m.lodTols, lodMs: m.lodMs,
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
let _colStartedAt = 0;   // performance.now() of the running sweep's post (telemetry)
// The AUTO sweep runs on load and on WCS/tool changes and must never own
// the machine for long: a 1.18 M-point program ran ~2 h per sweep, restarted
// on every touch-off, and starved the operator's GPU the whole time
// (2026-09-10). The sweep PAUSES while the camera moves and its budget
// counts active time only, so a pause never costs the sweep anything.
// Sweeps are OPEN-ENDED (2026-09-13, operator decision): the 300 s budget of
// the certificate-fix era and the ❚❚ / ▶ / ↻ button are gone — camera
// interaction and a hidden tab PAUSE the worker, a rotary jog PARKS it (and
// a settled pose resumes it), and the iterator's 4 M-sample backstop is the
// only hard limit, reported as `truncated`. A program in permanent contact
// sweeps for minutes; that is its cost, off the main thread.
// The modelKey the worker holds a resident BVH model for (bodies are sent
// only when it changes); null after a worker (re)creation or a failure.
let _colModelSent: string | null = null;
let _colNeedBodiesRetried = false;
// Parked sweep (a rotary jog): the worker holds the suspended generator;
// `collisionResult` carries the sweep-so-far (truncated) so its marks show.
const collisionStopped = ref<{ covered: number; reason: "motion" } | null>(null);
const collisionResumable = ref(false);
let _colStopPending = false;   // a stop is on its way to the worker's next checkpoint
// Live findings (2026-09-13): the worker's UNREFINED sweep-so-far, posted
// with its progress at most every half second while the record count
// changes — ticks, bands, the tint and the code-panel marks show clashes as
// the sweep finds them; the refined result replaces it when the sweep ends
// or parks. Keyed on the track it is being swept on.
const collisionPartial = shallowRef<CollisionResult | null>(null);
const collisionPartialTrack = shallowRef<ScrubTrack | null>(null);
// Entry-segment OVERLAY (sim entry, 2026-09-12 second attempt): the SIDE
// sweep's result for an entry track built on `base`, merged with the base
// result at display time (collisionEntryResult). The base result keeps its
// own identity, so a sim entry never cancels the program's sweep and a
// re-entry never re-sweeps it (viewer/sweepEntry.ts pins the plan).
const collisionEntry = shallowRef<{ track: ScrubTrack; base: ScrubTrack; result: CollisionResult; shift: number } | null>(null);
let _colSide: { id: number; entry: ScrubTrack; base: ScrubTrack; slice: ScrubTrack; shift: number; retried: boolean; startedAt: number } | null = null;
let _colSideSeq = 0;   // side ids are NEGATIVE — their own space beside _colReqId
// Rotary pose at the start of the current leg / as last seen: a rotary jog
// parks the sweep (its track is about to be re-parsed); a settled pose with
// an unchanged preview resumes it. Linear jogs never touch it — the program's
// track does not depend on where X/Y/Z sit.
const ROTARY_STOP_DEG = 0.05;
const ROTARY_SETTLE_MS = 4_500;   // > the gateway's 2 s debounce × 2 settled checks
let _colRotaryAtStart: number[] | null = null;
let _colRotaryLast: number[] | null = null;
let _colSettleTimer: ReturnType<typeof setTimeout> | undefined;
const collisionBusy = ref(false);
const collisionProgress = ref(0);
const collisionResult = ref<CollisionResult | null>(null);
// The exact track the current result was swept on — hit cums are only
// meaningful against it (shallowRef: tracks hold Maps + typed arrays).
const collisionTrack = shallowRef<ScrubTrack | null>(null);
let _colPendingTrack: ScrubTrack | null = null;
/** The entry track's result: the overlay merged onto the base result (cums
 *  shifted by the entry length, two baselines reported). Null until both
 *  exist — a base sweep still running shows as running, not as "no result". */
/** The base result on display: the refined one, else the live partial. */
function _colBaseFor(trk: ScrubTrack): CollisionResult | null {
  if (collisionResult.value && collisionTrack.value === trk) return collisionResult.value;
  if (collisionPartial.value && collisionPartialTrack.value === trk) return collisionPartial.value;
  return null;
}
const collisionEntryResult = computed<{ track: ScrubTrack; result: CollisionResult } | null>(() => {
  const e = collisionEntry.value;
  const b = e ? _colBaseFor(e.base) : null;
  if (!e || !b) return null;
  return { track: e.track, result: mergeEntryResult(e.result, b, e.shift, e.base.cum[e.base.count - 1]!) };
});
/** The result swept on exactly `trk` (base or entry-overlaid), else null. */
function _colResultFor(trk: ScrubTrack | null): CollisionResult | null {
  if (!trk) return null;
  const b = _colBaseFor(trk);
  if (b) return b;
  const e = collisionEntryResult.value;
  return e && e.track === trk ? e.result : null;
}

function _colGetWorker(): Worker {
  if (!_colWorker) {
    _colWorker = new Worker(new URL("./viewer/collisionWorker.ts", import.meta.url), { type: "module" });
    _colModelSent = null;   // a fresh worker holds no model
    _colWorker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { id: number; progress?: number; partial?: CollisionResult; error?: string; result?: CollisionResult; needBodies?: boolean; cancelled?: boolean; stopped?: boolean };
      if (_colSide && m.id === _colSide.id) { _colOnSideMessage(m); return; }
      if (m.id !== _colReqId) return;  // superseded
      if (m.cancelled) return;         // our own cancel, acknowledged
      if (m.needBodies) {
        // The worker holds no model for the key we assumed it had: re-send
        // the bodies once. A second ask in a row is a bug, not a retry.
        if (_colNeedBodiesRetried) {
          console.error("[collision] worker asked for bodies twice — sweep not run");
          emitTelemetry("collision.sweep_failed", { msg: "worker asked for bodies twice" });
          _colFail();
          return;
        }
        _colNeedBodiesRetried = true;
        _colModelSent = null;
        collisionBusy.value = false;   // runCollisionCheck early-returns on busy
        runCollisionCheck(_colPendingTrack ?? undefined);
        return;
      }
      if (m.progress != null && !m.result) {
        collisionProgress.value = m.progress;
        if (m.partial) {
          collisionPartial.value = m.partial;
          collisionPartialTrack.value = _colPendingTrack;
          emit("collision-lines", m.partial.hits.map(h => ({ line: h.line, continuation: h.continuation })));
          _colRetint();
        }
        return;
      }
      if (m.stopped) {
        // Parked (a rotary jog): the sweep-so-far is the result on display,
        // and the worker still holds the generator.
        collisionBusy.value = false;
        _colStopPending = false;
        collisionResult.value = m.result!;
        collisionTrack.value = _colPendingTrack;
        collisionPartial.value = null;
        collisionResumable.value = true;
        collisionStopped.value = { covered: m.result!.truncated?.covered ?? 0, reason: "motion" };
        emitTelemetry("collision.sweep_stopped", {
          reason: "motion", covered: m.result!.truncated?.covered ?? 0, hits: m.result!.hits.length,
          ms: Math.round(performance.now() - _colStartedAt),
        });
        emit("collision-lines", m.result!.hits.map(h => ({ line: h.line, continuation: h.continuation })));
        _colRetint();
        return;
      }
      collisionBusy.value = false;
      _colStopPending = false;
      collisionPartial.value = null;
      if (m.error) {
        console.error("[collision] sweep failed:", m.error);
        emitTelemetry("collision.sweep_failed", { msg: m.error });
        collisionResult.value = null;
        collisionTrack.value = null;
        emit("collision-lines", null);
        return;
      }
      const result = m.result!;
      collisionResult.value = result;
      collisionTrack.value = _colPendingTrack;
      collisionResumable.value = false;
      collisionStopped.value = null;
      _colNeedBodiesRetried = false;
      // Off-thread but not free: a sweep is a busy worker for its whole
      // duration — the viewer perf probe's `sweep_busy` context field says
      // whether one overlapped a slow window; this row says how long it ran.
      emitTelemetry("collision.sweep_done", {
        ms: Math.round(performance.now() - _colStartedAt),
        bvh_ms: Math.round(result.bvhMs), sweep_ms: Math.round(result.sweepMs),
        samples: result.samples, coarsened: result.coarsened,
        uncertified: result.uncertified != null,
        truncated: result.truncated?.reason ?? null,
        covered: result.truncated?.covered ?? 1,
        hits: result.hits.length, pairs: result.pairCount, pairs_prescreened: result.pairsPrescreened,
        points: _colPendingTrack?.count ?? null,
      });
      emit("collision-lines", result.hits.map(h => ({ line: h.line, continuation: h.continuation })));
      _colRetint();
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
  _colStopPending = false;
  collisionProgress.value = 0;
  collisionResult.value = null;
  collisionTrack.value = null;
  collisionPartial.value = null;
  collisionResumable.value = false;
  collisionStopped.value = null;
  _colDropEntry();
  emit("collision-lines", null);
}

function cancelCollisionCheck() {
  // The sweep is synchronous inside the worker — a cancel message would sit
  // unread until it finished. Terminate + lazy recreate is the honest cancel.
  if (collisionBusy.value) {
    emitTelemetry("collision.sweep_cancelled", {
      ran_ms: Math.round(performance.now() - _colStartedAt), progress: collisionProgress.value,
    });
  }
  // The worker drives the sweep in slices (sweepPump) and reads a cancel
  // between them: no terminate, so the resident BVH model survives for the
  // next sweep (it used to be terminated + recreated + rebuilt per cancel).
  if (_colWorker && (collisionBusy.value || collisionResumable.value)) _colWorker.postMessage({ cancel: _colReqId });
  _colReqId++;
  collisionBusy.value = false;
  _colStopPending = false;
  collisionProgress.value = 0;
  collisionPartial.value = null;
  collisionResumable.value = false;
  collisionStopped.value = null;
  clearTimeout(_colSettleTimer);
}

/** Park the running sweep at its next checkpoint (a rotary jog — its track
 *  is about to be re-parsed); the worker keeps it resident. The iterator
 *  yields on time (8 ms) and the refinement is memoized, so the park reply
 *  is bounded (2026-09-12: it used to be seconds away). */
function stopCollisionCheck() {
  if (!_colWorker || !collisionBusy.value || _colStopPending) return;
  _colStopPending = true;
  _colWorker.postMessage({ stop: _colReqId });
}

/** Resume the parked sweep where it stopped. */
function continueCollisionCheck() {
  if (!_colWorker || collisionBusy.value || !collisionResumable.value) return;
  collisionBusy.value = true;
  collisionResumable.value = false;
  collisionStopped.value = null;
  _colStartedAt = performance.now();
  _colRotaryAtStart = _rotaryNow();
  _colWorker.postMessage({ continue: _colReqId });
  _colApplyPauses();
}

function _rotaryNow(): number[] | null {
  const a = vst.value?.rotary_abc;
  return Array.isArray(a) ? a.slice() : null;
}

/** Sim entry (2026-09-12). The entry-extended track differs from the base
 *  by ONE segment (live position → first point). With a complete base
 *  result on hand, only that segment is swept and merged; with the machine
 *  already at the first point (identical track) nothing runs at all. A base
 *  sweep still running or parked falls back to the full entry-track sweep
 *  (the worker holds one sweep). */
function runEntryCheck(entry: ScrubTrack, base: ScrubTrack | null) {
  // The program's own sweep is never cancelled for a sim entry; the entry
  // segment runs BESIDE it as a side sweep (viewer/sweepEntry.ts).
  const plan = planEntryCheck({
    entry, base,
    mainTrack: collisionTrack.value, hasMainResult: !!collisionResult.value,
    mainBusy: collisionBusy.value, mainResumable: collisionResumable.value,
    pendingTrack: _colPendingTrack,
    overlayTrack: collisionEntry.value?.track ?? null, sideTrack: _colSide?.entry ?? null,
  });
  if (!base) return;
  if (plan.runBase) { cancelCollisionCheck(); runCollisionCheck(base); }
  if (plan.runSide && entry.count >= 2) _colPostSide(sliceTrack(entry, 0, 2), entry, base, entry.cum[1]!);
}

/** Drop the entry overlay (and a side sweep in flight): a touch-off, a new
 *  program or a failure makes it stale; ScrubBar re-asks on the next entry. */
function _colDropEntry() {
  if (_colSide && _colWorker) _colWorker.postMessage({ cancel: _colSide.id });
  _colSide = null;
  collisionEntry.value = null;
}

/** ScrubBar's own input edge while simulating (WCS rows it re-adds): nothing
 *  is current — the base result, the overlay, the marks. */
function _colInvalidate() {
  cancelCollisionCheck();
  collisionResult.value = null;
  collisionTrack.value = null;
  _colDropEntry();
  emit("collision-lines", null);
  _updateClashTint(null, null);
}

function _colOnSideMessage(m: { id: number; progress?: number; error?: string; result?: CollisionResult; needBodies?: boolean; cancelled?: boolean }) {
  const side = _colSide!;
  if (m.progress != null && !m.result) return;
  if (m.cancelled) { _colSide = null; return; }
  if (m.needBodies) {
    if (side.retried) {
      console.error("[collision] worker asked for bodies twice — entry sweep not run");
      emitTelemetry("collision.entry_failed", { msg: "worker asked for bodies twice" });
      _colSide = null;
      return;
    }
    _colModelSent = null;
    _colPostSide(side.slice, side.entry, side.base, side.shift, true);
    return;
  }
  _colSide = null;
  if (m.error) {
    console.error("[collision] entry sweep failed:", m.error);
    emitTelemetry("collision.entry_failed", { msg: m.error });
    return;
  }
  const result = m.result!;
  collisionEntry.value = { track: side.entry, base: side.base, result, shift: side.shift };
  emitTelemetry("collision.entry_done", {
    ms: Math.round(performance.now() - side.startedAt), hits: result.hits.length,
    static: result.staticContacts.length, samples: result.samples,
  });
  _colRetint();
}

/** Re-apply the clash tint at the current scrub position after a result
 *  lands (the pose watcher only runs on scrub moves). */
function _colRetint() {
  _updateClashTint(_scrubLineNo, _scrubCum);
}

// A rotary jog parks the running sweep (its track is about to be re-parsed);
// once the pose has held still and no re-parse is in flight, it resumes.
// A re-parse that does land drops the parked sweep and starts a fresh one
// (the viewerGcode watcher). Keyed on VALUES: full status frames re-send an
// unchanged pose as a new array.
watch(() => vst.value?.rotary_abc as number[] | null | undefined, (abc) => {
  if (!Array.isArray(abc)) return;
  const changed = !_colRotaryLast || abc.some((v, i) => Math.abs(v - (_colRotaryLast![i] ?? v)) > ROTARY_STOP_DEG);
  _colRotaryLast = abc.slice();
  if (!changed) return;
  if (collisionBusy.value && _colRotaryAtStart
      && abc.some((v, i) => Math.abs(v - (_colRotaryAtStart![i] ?? v)) > ROTARY_STOP_DEG)) {
    stopCollisionCheck();
  }
  clearTimeout(_colSettleTimer);
  _colSettleTimer = setTimeout(_colOnRotarySettled, ROTARY_SETTLE_MS);
});
function _colOnRotarySettled() {
  if (collisionStopped.value?.reason !== "motion" || !collisionResumable.value || collisionBusy.value) return;
  if (previewRefresh.value) return;   // its payload drops this sweep and starts a fresh one
  continueCollisionCheck();
}

// Pauses (2026-09-13): camera interaction in progress (OrbitControls
// start→end — a busy worker starves the GPU side of the browser) and a
// HIDDEN tab (a sweep must not burn a core behind another window). A sweep
// posted while either holds starts paused; a running one is paused/resumed
// by the events. Two independent holds in the worker, both must release.
let _camMoving = false;
function _colSetPaused(why: "camera" | "hidden", on: boolean) {
  if (!_colWorker || !collisionBusy.value) return;
  _colWorker.postMessage(on ? { pause: _colReqId, why } : { resume: _colReqId, why });
}
function _colApplyPauses() {
  if (_camMoving) _colSetPaused("camera", true);
  if (document.hidden) _colSetPaused("hidden", true);
}
function _colOnVisibility() {
  _colSetPaused("hidden", document.hidden);
}

// Identity of the collision model the worker keeps resident: the loaded
// parts (id, file, group, placement, stock flag), the unit scale and the
// tool body dims. Bodies are re-sent only when it changes.
function _colModelKey(init: ViewerInit): string {
  const parts = (init.parts ?? [])
    .filter(p => partCollides(p) && !!getCachedGeometry(p.id))
    .map(p => [p.id, p.file, p.collision ?? null, p.group ?? "root", p.translate ?? null, (p as any).rotate ?? null, p.stock ? 1 : 0]);
  return JSON.stringify([parts, _unitScale, _toolVisual(_pv.toolDiam, _pv.toolLen)]);
}

/** The worker request for one sweep of `track`. Bodies (copies of every
 *  machine STL) go over only when the worker does not already hold this
 *  model — a touch-off used to re-post + rebuild the BVHs every time. Null
 *  when nothing can be posted (no viewer init). */
function _colBuildRequest(track: ScrubTrack, id: number, side: boolean) {
  const init = viewerInit.value;
  if (!init) return null;
  const modelKey = _colModelKey(init);
  const sendBodies = !_colWorker || _colModelSent !== modelKey;
  const bodies: CollisionBody[] = [];
  let skipped = 0;
  if (sendBodies) for (const p of (init.parts ?? [])) {
    if (!partCollides(p)) continue;   // decorative by declaration (machine.json collide: false)
    // Collision PROXY (machine.json `collision`): the coarser superset mesh
    // the sweep checks instead of the display mesh. A declared proxy that
    // did not load is reported — never silently swapped — and the display
    // mesh stands in: sound, just slow.
    const proxy = p.collision ? getCollisionGeometry(p.id) : undefined;
    if (p.collision && !proxy) {
      console.error(`[collision] proxy mesh for ${p.id} not loaded — checking its display mesh instead`);
      emitTelemetry("collision.proxy_missing", { part: p.id });
    }
    const attr = (proxy ?? getCachedGeometry(p.id))?.getAttribute("position");
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
  const msg = {
    id,
    machine: _pfMachine(init),           // same shape as CollisionMachine
    bodies: sendBodies ? bodies : undefined,
    modelKey,
    // The DISPLAYED marker dims — same visual-length formula as the marker
    // build (min length + shank sink into the holder). Using the raw tool
    // length made the collision body SHORTER than the tool on screen: the
    // model visibly touched while the sweep saw clearance.
    tool: _toolVisual(_pv.toolDiam, _pv.toolLen),
    track: trackCopy,
    wcs: _pfWcs(),
    side: side || undefined,   // beside the main sweep (entry segment)
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
  };
  return { msg, transfer, modelKey, bodies: bodies.length };
}

function runCollisionCheck(trackOverride?: ScrubTrack) {
  // The MAIN sweep always runs the program's own (base) track; the sim
  // entry segment is a side sweep (runEntryCheck).
  // toRaw: structured clone refuses Vue Proxies. The gcode payload is
  // markRaw'd on arrival, but a track that ever passed through a deep ref
  // arrives with its nested arrays proxied — unwrap at the boundary so the
  // post below cannot throw on a caller's reactivity choice.
  const track = toRaw(trackOverride ?? viewerGcode.value?.scrubTrack ?? null) as ScrubTrack | null;
  if (!track || collisionBusy.value) return;
  const id = ++_colReqId;
  const req = _colBuildRequest(track, id, false);
  if (!req) return;
  _colPendingTrack = track;
  collisionBusy.value = true;
  _colStopPending = false;
  collisionProgress.value = 0;
  collisionResult.value = null;
  collisionPartial.value = null;
  collisionResumable.value = false;
  collisionStopped.value = null;
  _colRotaryAtStart = _rotaryNow();
  _colStartedAt = performance.now();
  emitTelemetry("collision.sweep_start", { points: track.count, bodies: req.bodies });
  try {
    _colGetWorker().postMessage(req.msg, req.transfer);
    _colModelSent = req.modelKey;   // the worker now holds (or is building) this model
    _colApplyPauses();
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

/** Side sweep of the ENTRY SEGMENT (sim entry): runs beside the main sweep
 *  in the worker — milliseconds for a two-point slice — and its result
 *  becomes the overlay merged at display time. Never touches the busy flag
 *  or the main run's state. */
function _colPostSide(slice: ScrubTrack, entry: ScrubTrack, base: ScrubTrack, shift: number, retried = false) {
  const id = -(++_colSideSeq);
  const req = _colBuildRequest(toRaw(slice) as ScrubTrack, id, true);
  if (!req) return;
  if (_colSide && _colWorker) _colWorker.postMessage({ cancel: _colSide.id });
  _colSide = { id, entry, base, slice, shift, retried, startedAt: performance.now() };
  emitTelemetry("collision.entry_start", { bodies: req.bodies, shift });
  try {
    _colGetWorker().postMessage(req.msg, req.transfer);
    _colModelSent = req.modelKey;
  } catch (err) {
    console.error("[collision] entry sweep post failed:", err);
    emitTelemetry("collision.entry_failed", { msg: String(err) });
    _colSide = null;
  }
}

// The sweep keeps itself current — no manual trigger. Auto-runs: on
// program load (base track — marks appear before sim is ever entered), on
// sim entry (ScrubBar re-checks with the entry track), and on WCS/tool
// changes while idle (results reflect check-time inputs; a change makes
// them stale, so they clear and the sweep re-runs).
let _colAutoTimer: ReturnType<typeof setTimeout> | undefined;
// A check a RUN held off (the interpreter was busy when the timer fired —
// a mid-run re-parse publishes during AUTO): it starts once the interpreter
// is idle again, whether or not another parse follows (Codex R40 MR-I03).
let _colHeldByRun = false;
function _colScheduleAuto() {
  clearTimeout(_colAutoTimer);
  _colAutoTimer = setTimeout(() => {
    if (simMode.value) return;               // ScrubBar re-checks with the entry track
    if (!machineReady.value) return;         // geometry loading — machineReady watcher retries
    if ((status.value?.data?.interp_state ?? INTERP_IDLE) !== INTERP_IDLE) { _colHeldByRun = true; return; }
    _colHeldByRun = false;
    if (!viewerGcode.value?.scrubTrack) return;
    if (collisionBusy.value || collisionResumable.value) cancelCollisionCheck();
    runCollisionCheck();
  }, 400);
}
watch(() => status.value?.data?.interp_state, (st) => {
  if (st === INTERP_IDLE && _colHeldByRun) _colScheduleAuto();
});

// Live WCS or tool dims changed: current results are stale — clear them
// honestly and re-run (debounced; touch-off sequences change several
// values in quick succession).
function _colOnInputChange() {
  if (!collisionResult.value && !collisionBusy.value && !collisionEntry.value && !_colSide) return;
  cancelCollisionCheck();
  collisionResult.value = null;
  collisionTrack.value = null;
  _colDropEntry();
  emit("collision-lines", null);
  _updateClashTint(null, null);
  _colScheduleAuto();
}

// A new program (or unload) invalidates results — never show stale clashes.
watch(viewerGcode, () => {
  cancelCollisionCheck();
  collisionResult.value = null;
  collisionTrack.value = null;
  _colDropEntry();
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
/** Leading track points that draw ROOM-FIXED (scrubTrack.roomEndOf): the
 *  inherited prefix over the WORK chain's rotary letters and `unknown`.
 *  0 without a boundary, a track, or a work-chain rotary. */
function _roomEnd(g: ViewerGcode): number {
  const m = _markerMachine;
  if (!m || !g.scrubTrack) return 0;
  return roomEndOf(g.scrubTrack, chainRotaryLetters(m).work);
}

/** Programmed-path room masks (2026-09-11): the drawn vertex order is the
 *  track's, so `src < roomEnd` and an identity-kins segment ⇒ room. In
 *  programmed mode a world-labelled segment only exists when the operator
 *  forced "Programmed XYZ" on a TCP program (already not path-on-part);
 *  it rides, as before. */
function _programmedRoomMask(src: Uint32Array | undefined, mode: Uint8Array | undefined, roomEnd: number): Uint8Array | undefined {
  if (roomEnd <= 0 || !src) return undefined;
  const spec = specFromWire(viewerInit.value?.kins);
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) {
    out[i] = (src[i]! < roomEnd && !worldModeForSpec(mode?.[i], spec)) ? 1 : 0;
  }
  return out;
}

function _applyProgrammed(g: ViewerGcode) {
  const roomEnd = _roomEnd(g);
  const feedRoom = _programmedRoomMask(g.feedSrc, g.feedMode, roomEnd);
  const rapidRoom = _programmedRoomMask(g.rapidSrc, g.rapidMode, roomEnd);
  let out: ViewerGcode = (feedRoom || rapidRoom) ? { ...g, feedRoom, rapidRoom } : g;
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
              bounds, motion_bounds: motion, feedRoom, rapidRoom };
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
    _pfPending = true;
    // The terms the worker peels against — the reply hangs under THIS
    // anchor, not under whatever the live origin is by then.
    _pfAnchorFor = { id, anchor: anchorTerms(_pfWcs()) };
    try {
      const w = _pfGetWorker();
      _pfEnsureLoaded(w, g);
      w.postMessage({
        op: "transform", id, payloadId: _pfPayloadId,
        machine: _pfMachine(viewerInit.value!), wcs: _pfWcs(),
        // Epochs (review P2): events + the live table let the worker build
        // per-epoch re-add terms next to the per-vertex `wcs` indices.
        wcsEvents: g.wcsEvents,
        wcsTable: _pv.wcsTable ?? undefined,
        // Per-segment TLO/tool events (schema 8) for the `tlo` indices.
        tloEvents: g.tloEvents,
        // Room split (2026-09-11): how many leading track points inherit
        // every work-chain rotary — those identity vertices bake room-fixed.
        roomEnd: _roomEnd(g),
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
  _pfPending = false;
  // Owned by toolpathController; pass a fresh ctx with the reassigned
  // scene-graph pointers + per-program units.
  _applyProgrammed(g);
}

/** Ship the streams to the worker ONCE per program (or per recreated
 *  worker). Copies: the transfer must not detach viewerGcode's raw buffers —
 *  they are still read by the programmed-mode path and the sweep. */
function _pfEnsureLoaded(w: Worker, g: ViewerGcode) {
  if (_pfLoadedFor === g) return;
  const fp = g.feedPos ?? new Float32Array(0);
  const fa = g.feedAbc && g.feedAbc.length === fp.length ? g.feedAbc : new Float32Array(fp.length);
  const fl = g.feed_lines instanceof Uint32Array ? g.feed_lines : undefined;
  const rp = g.rapidPos ?? new Float32Array(0);
  const ra = g.rapidAbc && g.rapidAbc.length === rp.length ? g.rapidAbc : new Float32Array(rp.length);
  const feed = { pos: fp.slice(), abc: fa.slice(), lines: fl?.slice(), breaks: g.feedBreaks?.slice(),
                 mode: g.feedMode?.slice(), frame: g.feedFrame?.slice(), frames: g.kinsFrames,
                 wcs: g.feedWcs?.slice(), src: g.feedSrc?.slice(), tlo: g.feedTlo?.slice(),
                 outside: g.feedOutside?.slice() };
  const rapid = { pos: rp.slice(), abc: ra.slice(), breaks: g.rapidBreaks?.slice(),
                  mode: g.rapidMode?.slice(), frame: g.rapidFrame?.slice(), frames: g.kinsFrames,
                  wcs: g.rapidWcs?.slice(), src: g.rapidSrc?.slice(), tlo: g.rapidTlo?.slice(),
                  outside: g.rapidOutside?.slice() };
  const transfer: ArrayBuffer[] = [
    feed.pos.buffer as ArrayBuffer, feed.abc.buffer as ArrayBuffer,
    rapid.pos.buffer as ArrayBuffer, rapid.abc.buffer as ArrayBuffer,
  ];
  for (const a of [feed.lines, feed.breaks, rapid.breaks, feed.mode, rapid.mode, feed.frame, rapid.frame,
                   feed.wcs, rapid.wcs, feed.src, rapid.src, feed.tlo, rapid.tlo, feed.outside, rapid.outside]) {
    if (a) transfer.push(a.buffer as ArrayBuffer);
  }
  _pfPayloadId++;
  w.postMessage({ op: "load", payloadId: _pfPayloadId, streams: { feed, rapid } }, transfer);
  _pfLoadedFor = g;
}

/** The live per-joint limits as plain arrays (structured clone refuses Vue
 *  proxies); null when the status carries none — the worker then emits no
 *  verdict and the overlay stays empty (unchecked ≠ clean). */
function _jointLimitsPlain(): (number[] | null)[] | null {
  const jl = vst.value?.joint_limits as unknown;
  if (!Array.isArray(jl)) return null;
  return jl.map(p => (Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number")
    ? [p[0], p[1]] : null);
}


// Part-frame vertices depend on the pivot position relative to the live work
// origin, so a WCS change (touch-off, G10, G92, rotation) re-transforms —
// debounced, these change rarely and never mid-cut at speed.
function _pfScheduleWcsRefresh() {
  _reachSchedule();   // the envelope follows the tool length (and the limits, below)
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
// Joint limits arriving or changing (rare: connect, a runtime window change)
// resize the reach envelope; the outside-limits flags follow through the
// gateway's own limits drift edge (a reparse), never a client re-derivation.
watch(() => JSON.stringify(_jointLimitsPlain()), (cur, prev) => {
  if (prev === undefined || cur === prev) return;
  _reachSchedule();
});

// ---- Reach envelope (2026-09-12) ----
// Two OUTLINES from the live joint limits, the machine.json chain and the
// live tool length (viewer/reachEnvelope.ts, computed in reachWorker.ts):
// where the tool tip can be in the machine frame (layer "reachRoom", under
// machineFrameGrp like the bounds box) and where it can be relative to
// the part — the room solid swept through every work-chain rotary (layer
// "reachPart", rides _workGrp). Lines only (operator, 2026-09-12: no fills);
// never a certificate; both off by default; computed once for both and
// recomputed only when the inputs change while either is on.
let _reachWorker: Worker | null = null;
let _reachReqId = 0;
let _reachRoomOn = false;
let _reachPartOn = false;
let _reachKey = "";                       // inputs the cached data was computed from
let _reachPendingKey = "";
let _reachData: { roomLines: Float32Array; partLines: Float32Array | null; info: ReachInfo } | null = null;
let reachRoomMesh: TwoToneLines | null = null;
let reachPartMesh: TwoToneLines | null = null;
let _reachTimer: ReturnType<typeof setTimeout> | undefined;

function _reachInputsKey(): string | null {
  const init = viewerInit.value;
  const lim = _jointLimitsPlain();
  if (!init || !lim) return null;
  return JSON.stringify({ l: lim, t: _pv.toolOffset ?? [], m: _pfMachine(init) });
}

function _reachGetWorker(): Worker {
  if (!_reachWorker) {
    _reachWorker = new Worker(new URL("./viewer/reachWorker.ts", import.meta.url), { type: "module" });
    _reachWorker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { id: number; error?: string; roomLines?: Float32Array; partLines?: Float32Array | null; info?: ReachInfo };
      if (m.id !== _reachReqId) return;   // superseded
      if (m.error || !m.roomLines || !m.info) {
        console.error("[reach] envelope not computed:", m.error ?? "empty reply");
        _reachData = null; _reachKey = "";
        _reachBuildMeshes();
        return;
      }
      _reachData = { roomLines: m.roomLines, partLines: m.partLines ?? null, info: m.info };
      _reachKey = _reachPendingKey;
      console.info(`[reach] envelope: ${m.info.samples} tilt samples × ${m.info.corners} corners, ${m.info.hullFaces} hull faces, part sweep ${m.partLines ? "yes" : "no"}, ${m.info.ms} ms`
        + (m.info.notes.length ? ` — notes: ${m.info.notes.join("; ")}` : ""));
      _reachBuildMeshes();
      requestRender();
    };
    _reachWorker.onerror = (ev) => { console.error("[reach] worker error:", ev.message); };
  }
  return _reachWorker;
}

function _reachSchedule() {
  if (!_reachRoomOn && !_reachPartOn) return;
  clearTimeout(_reachTimer);
  _reachTimer = setTimeout(_reachRequest, 500);
}

/** Compute (or re-hang the cached) envelope for the current inputs. */
function _reachRequest() {
  if (!_reachRoomOn && !_reachPartOn) return;
  const key = _reachInputsKey();
  if (!key) {
    // No limits yet (or no model): nothing honest to draw. Says so once per
    // distinct situation through the empty scene, not a stale shape.
    if (_reachData) { _reachData = null; _reachKey = ""; _reachBuildMeshes(); }
    return;
  }
  if (key === _reachKey && _reachData) { _reachBuildMeshes(); return; }
  if (key === _reachPendingKey && _reachReqId > 0 && !_reachData) return;   // already in flight
  const init = viewerInit.value!;
  const id = ++_reachReqId;
  _reachPendingKey = key;
  try {
    _reachGetWorker().postMessage({ id, machine: _pfMachine(init), jointLimits: _jointLimitsPlain(), tlo: [...(_pv.toolOffset ?? [])] });
  } catch (err) {
    console.error("[reach] request failed:", err);
  }
}

function _reachDispose(g: THREE.Group | null) {
  if (!g) return;
  g.parent?.remove(g);
  g.traverse(o => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose?.();
    (mesh.material as THREE.Material | undefined)?.dispose?.();
  });
}

/** One outline as a line-segment soup the worker built (hull creases or
 *  the swept solid's cage): TWO-TONE like the boxes (operator 2026-09-29 —
 *  a mid grey vanished on the grey-ladder model), 1 px and dotted so the
 *  boxes stay the stronger lines; opaque like every role line. */
function _reachSolidGroup(lines: Float32Array): TwoToneLines {
  return makeTwoToneSegments(lines, { color: palette.reach, alt: palette.boundsAlt,
    width: REACH_PX, dashPx: REACH_DASH_PX, role: "reach", renderOrder: 3, tones: true });
}

/** (Re)build the scene objects from the cached solids under the current
 *  frame groups; clears them when there is nothing to show. */
function _reachBuildMeshes() {
  _reachDispose(reachRoomMesh); _reachDispose(reachPartMesh);
  reachRoomMesh = reachPartMesh = null;
  const d = _reachData;
  const roomParent = machineFrameGrp ?? _workGrp;
  if (!d || !roomParent) { requestRender(); return; }
  reachRoomMesh = _reachSolidGroup(d.roomLines);
  reachRoomMesh.visible = _reachRoomOn;
  roomParent.add(reachRoomMesh);
  if (d.partLines && _workGrp && _workGrp !== roomParent) {
    reachPartMesh = _reachSolidGroup(d.partLines);
    reachPartMesh.visible = _reachPartOn;
    _workGrp.add(reachPartMesh);
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
  _scrubCum = joints ? cum : null;
  _updateClashTint(_scrubLineNo, _scrubCum);
  if (_lastState && !pendingState) pendingState = _lastState;
  requestRender();
}
let _scrubTrackRef: ScrubTrack | null = null;
let _scrubCum: number | null = null;

// ---- Clash-pair tint: while the scrub sits on a line with a reported
// collision, the involved bodies glow in the collision role (emissive add —
// works on any base/vertex color). Shared materials (MAT.*, auto part
// materials) are clone-swapped per mesh and restored on clear, so nothing
// leaks into other parts and user color overrides stay untouched. The tint
// is the palette's, re-read on a theme switch (it used to be cached once:
// the first theme's --danger for the rest of the session). ----
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
    mat.emissive.set(palette.collision);
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
  const res = _colResultFor(_scrubTrackRef);
  if (line != null && cum != null && res) {
    // A line with records of its own decides by its refined intervals; a
    // line WITHOUT one (past the MAX_HITS cap of a contact that never
    // separates) glows while the cum sits inside an onset's SPAN — the
    // contact has provably not cleared there (2026-09-12).
    const lineHasRecord = res.hits.some(h => h.line === line && h.dist <= CONTACT_TINT_EPS);
    for (const h of res.hits) {
      if (h.dist > CONTACT_TINT_EPS) continue;
      if (h.line === line) {
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
      } else if (!lineHasRecord && h.continuation === undefined && h.spanCumEnd != null
                 && cum > h.cumEnd && cum <= h.spanCumEnd + CONTACT_TINT_EPS) {
        want.add(h.a);
        want.add(h.b);
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
/** The machine-bounds box in WORLD space: `_iniBox` is machine coordinates,
 *  which live in machineFrameGrp's frame (the table's travel node with the
 *  work-chain rotaries zeroed) — the node the box mesh and the clip planes
 *  hang under. `_workGrp.position` was that group's LOCAL offset: 1700 mm
 *  off in +X on the TWP machine and turning with A (2026-09-12). */
function _boundsWorldBox(): THREE.Box3 | null {
  const g = machineFrameGrp ?? _workGrp;
  if (!_iniBox || !g) return null;
  g.updateWorldMatrix(true, false);
  return _iniBox.clone().applyMatrix4(g.matrixWorld);
}

/** Each visible segment of a palette role, projected to the page (CSS px):
 *  centre, unit direction, length. The diagnostics' scene reader. */
function _projectRoleSegments(role: string, each: (s: { x: number; y: number; dx: number; dy: number; length: number }) => void) {
  if (!camera || !renderer) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const consider = (o: THREE.Object3D) => {
    a.applyMatrix4(o.matrixWorld).project(camera!);
    b.applyMatrix4(o.matrixWorld).project(camera!);
    const ax = rect.left + (a.x + 1) / 2 * rect.width, ay = rect.top + (1 - a.y) / 2 * rect.height;
    const bx = rect.left + (b.x + 1) / 2 * rect.width, by = rect.top + (1 - b.y) / 2 * rect.height;
    const length = Math.hypot(bx - ax, by - ay);
    if (length > 0) each({ x: (ax + bx) / 2, y: (ay + by) / 2, dx: (bx - ax) / length, dy: (by - ay) / length, length });
  };
  scene?.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (!m || Array.isArray(m) || m.userData?.role !== role) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry;
    if ((o as any).isLineSegments2) {
      const d = (g.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute).data;
      const arr = d.array as Float32Array, n = Math.min((g as THREE.InstancedBufferGeometry).instanceCount, 20000);
      for (let i = 0; i < n; i++) { a.fromArray(arr, i * 6); b.fromArray(arr, i * 6 + 3); consider(o); }
      return;
    }
    if (!(o as any).isLineSegments) return;
    const pos = g.getAttribute("position");
    const idx = g.index, start = g.drawRange.start;
    const end = Math.min(idx ? idx.count : pos.count, start + g.drawRange.count, start + 40000);
    for (let i = start; i + 1 < end; i += 2) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1;
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); consider(o);
    }
  });
}

function animate() {
  if (props.active === false) return; // paused — don't schedule next frame
  raf = requestAnimationFrame(animate);
  recordRafTick();   // render-loop cadence + GPU fence poll (viewerPerf)
  _abFrameHook?.(performance.now());

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
    if (_needsReframe && _iniBox) {
      _needsReframe = false;
      const box = _boundsWorldBox();
      if (box) frameToBounds(box);
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

  // Update overflow clipping planes to track the MACHINE frame's world
  // transform (table travel, never table rotation — see machineFrameGrp).
  // Only runs when we're actually rendering — C4 lazy clip planes.
  if (_localBoundsPlanes.length > 0 && _localBoundsPlanes.length === boundsClipPlanes.length && machineFrameGrp) {
    machineFrameGrp.updateWorldMatrix(true, false);  // ancestors too — the table's travel this frame
    for (let i = 0; i < _localBoundsPlanes.length; i++) {
      boundsClipPlanes[i]!.copy(_localBoundsPlanes[i]!);
      boundsClipPlanes[i]!.applyMatrix4(machineFrameGrp.matrixWorld);
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
  _orthoEyeOutsideScene();
  // Per-chunk overlay gate + frustum count (viewer/lineChunks.ts): decides
  // which outside-bounds overlays are drawn this frame at the current pose.
  if (camera) toolpath.updateCulling(toolpathCtx(), camera, renderer?.domElement.height ?? 1000);
  const _tRender = performance.now();
  renderer?.render(scene!, camera!);
  recordRender(performance.now() - _tRender);
  // Draw-call counts of the MAIN pass (info auto-resets per render(), and the
  // gizmo pass below would zero them) — read here for the perf probe.
  _glCalls = renderer?.info.render.calls ?? 0;
  _glLines = renderer?.info.render.lines ?? 0;
  _glTriangles = renderer?.info.render.triangles ?? 0;

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

function sceneForegroundFromTheme(): THREE.Color {
  return new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue("--fg").trim());
}

function updateSceneTheme() {
  const background = sceneBgFromTheme();
  const foreground = sceneForegroundFromTheme();
  if (scene) scene.background = background;
  if (groundGrid) updateGroundGridColors(groundGrid, background, foreground);
  for (const edge of _machineEdgeLines) (edge.material as THREE.LineBasicMaterial).color.copy(foreground);
  refreshPalette();                         // Automatic follows the theme; the finding roles always
  toolpath.setStale(pathStaleNow.value);   // the muted mix follows the background
  requestRender();
}

watch(themeMode, updateSceneTheme, { flush: "post" });

onMounted(() => {
  document.addEventListener("visibilitychange", _colOnVisibility);
  themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  themeMedia.addEventListener("change", updateSceneTheme);
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
  // A running collision sweep pauses while the camera moves — the busy
  // worker starved the GPU side of the browser (2026-09-10); its budget
  // counts active time only, so the pause costs the sweep nothing.
  controls.addEventListener("start", () => { _camMoving = true; _colSetPaused("camera", true); _abInteract?.(); });
  controls.addEventListener("end", () => { _camMoving = false; _colSetPaused("camera", false); });

  // Pause RAF when the document is hidden (browser tab switch / system sleep).
  // Independent of props.active, which gates Vue tab visibility within the SPA.
  document.addEventListener("visibilitychange", _onVisibilityChange);

  resizeObs = new ResizeObserver(() => resize());
  resizeObs.observe(host.value!);
  // The DRO card fits the pane (fitHud): the pane, the bottom column and
  // the card itself (its content changes) — a fit that changes nothing
  // settles, so the card's own resize cannot loop.
  _hudFitObs = new ResizeObserver(() => fitHud());
  for (const el of [wrapEl.value, bottomEl.value, hudEl.value]) if (el) _hudFitObs.observe(el);

  buildGizmo();

  _abDriver = createAbDriver({
    camera: () => camera,
    controls: () => controls,
    toolpath,
    toolpathCtx,
    requestRender,
    setFrameHook: fn => { _abFrameHook = fn; },
    root: () => wrapEl.value,
    timeline: () => scrubBarRef.value?.abTimeline ?? null,
    rapidsLayer: on => { if (on !== undefined) setLayerVisible("rapids", on); return _pathLayers.rapids; },
    pathLayer: on => { if (on !== undefined) setLayerVisible("toolpath", on); return _pathLayers.toolpath; },
    simActive: () => simMode.value,
    sweepBusy: () => collisionBusy.value,
    interpIdle: () => (status.value?.data?.interp_state ?? INTERP_IDLE) === INTERP_IDLE,
    renderInfo: () => ({ calls: _glCalls, triangles: _glTriangles, lines: _glLines,
      geometries: renderer?.info.memory.geometries ?? 0, textures: renderer?.info.memory.textures ?? 0 }),
    meta: () => {
      const el = renderer?.domElement;
      return {
        commit: typeof __APP_COMMIT__ !== "undefined" ? __APP_COMMIT__ : "unknown",
        build: import.meta.env.MODE,
        ua: navigator.userAgent,
        viewport: el ? [el.clientWidth, el.clientHeight] : null,
        pixel_ratio: renderer?.getPixelRatio() ?? null,
        device_pixel_ratio: window.devicePixelRatio,
        zoom: el ? +cssZoomOf(el).toFixed(3) : null,
        file: props.activeFile ?? null,
        source: gcodeTextSource.value || null,
        feed_segs: toolpath.feedSegs,
        rapid_segs: toolpath.rapidSegs,
        chunks: toolpath.chunks,
        overlays: toolpath.hasOverlays,
        backplot_pts: backplot.count,
        backplot_full: backplot.isFull,
        path_on_top: pathAlwaysOnTop,
        projection: camera instanceof THREE.OrthographicCamera ? "parallel" : "perspective",
        theme: document.documentElement.dataset.theme ?? "auto",
        sim: simMode.value,
      };
    },
    onInteract: fn => { _abInteract = fn; },
  });
  registerAbDriver(_abDriver);

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

  // The palette (mode, custom colours) — onto the live lines and the shared
  // MAT instances (they used to apply only at line-creation time, so a
  // colour change needed a program reload).
  refreshPalette();

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
  registerAbDriver(null);
  _abDriver?.dispose();
  _abDriver = null;
  document.removeEventListener("visibilitychange", _colOnVisibility);
  themeMedia?.removeEventListener("change", updateSceneTheme);
  document.removeEventListener("visibilitychange", _onVisibilityChange);
  setViewerPerfContext(null);
  setViewerPerfGl(null);
  clearTimeout(_pfWcsTimer);
  clearTimeout(_colAutoTimer);
  _pfWorker?.terminate();
  _pfWorker = null;
  _reachWorker?.terminate();
  _reachWorker = null;
  _pfLoadedFor = null;
  _colWorker?.terminate();
  _colWorker = null;
  resizeObs?.disconnect();
  resizeObs = null;
  _hudFitObs?.disconnect();
  _hudFitObs = null;
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

const hudAxes = computed(() => props.axes ?? [...DEFAULT_AXES]);
// One grid row per axis in machine order — primary/abc/uvw grouping is not
// needed in the tabular HUD, entries already carry letter + status index.
const { entries: hudEntries } = useAxes(hudAxes);
const hudCfg = computed(() => viewerDefaults.hud);

// ─── HUD fits its pane (design wave D9) ─────────────────────────
// The DRO card never leaves the viewer pane and never covers the ViewCube
// column: in a short or narrow pane (150 % portrait, 1024 × 768) it steps
// its scale DOWN from the operator's setting (the ceiling, never raised),
// then drops the Machine column (the operator's own toggle, applied
// automatically) — measured, never clipped (the pane used to clip the
// card and a warning vanished) and never transform-scaled. The findings
// (mode chip, warnings, a failed model part) live in their own card at the
// bottom edge, whose height the DRO card leaves free. A narrow pane
// (< NARROW_VIEWER_PX) draws the ViewCube and its quick grid smaller.
// If the smallest form still does not fit, that is a named limit (a
// 9-axis DRO in a 150 % landscape pane), not a clip.
// The operator's scales, and below them `xs` and `xxs` — the fit's own last
// resort (never offered in Settings): the smallest forms that still show
// every axis value (6 axes at 150 % portrait with a program's timeline and a
// sweep verdict wrapping the scrub bar's second row, UI-DI12). xxs draws the
// values at 12 CSS px (the UI's base size; 18 device px at 150 %).
const HUD_SCALES = ["xxs", "xs", "sm", "md", "lg", "xl"] as const;
const NARROW_VIEWER_PX = 440;
// fold: 0 none, 1 the Machine column, 2 + the F / S rows, 3 + the tool line
// — each an operator toggle already (Settings › HUD), applied by the fit.
// notesCompact: the last step — the findings card folds to ONE summary line
// with an explicit "show" toggle (review round 6, UI-DI12: with the scrub
// bar up, the fully folded DRO card and the findings still overlapped).
const hudFit = reactive({ scale: viewerDefaults.hud.scale as (typeof HUD_SCALES)[number], fold: 0, notesCompact: false, narrow: false, overflow: false });
/** The operator opened the folded findings (a deliberate tap: the card may
 *  then cover the DRO until it is folded again). */
const notesOpen = ref(false);
/** The warning lines the findings card holds (the mode chip aside). */
/** The A/B measurement's line while it runs (temporary, viewer/abRunBus.ts). */
const abLine = computed(() => abRunLine());
const hudWarnCount = computed(() => [vst.value?.eoffset_enabled, vst.value?.rotation_xy, foreignWcs.value.length,
  rewrittenWcs.value.length, kinsEndWarn.value, previewSchemaStale.value, previewRefresh.value,
  !previewRefresh.value && previewWcsStale.value, previewTloStale.value, previewTableStale.value, toolpathOverflow.value,
  failedParts.value.length, abLine.value].filter(Boolean).length);
/** The folded card's one line: the mode and how many warnings wait behind it. */
/** The mode line: the chip, the fixture, the plane's word — each said once.
 *  A wrong-fixture chip names its fixture already ("TWP · G54"), and the
 *  plane's word names a moved datum the chip also carries (viewer contrast
 *  plan, V4: the word follows the drawn plane). */
function hudModeLine(withPlane: boolean): string {
  const m = hudMode.value;
  if (!m) return "";
  const word = withPlane ? hudPlaneWord.value : null;
  const segs = m.text.split(" · ").filter(s => !(word?.includes("datum moved") && s === "datum moved"));
  const fx = props.g5xLabel || NO_VALUE;
  if (!segs.includes(fx)) segs.push(fx);
  if (word) segs.push(word);
  return segs.join(" · ");
}
const hudNotesSummary = computed(() => [hudModeLine(false),
  hudWarnCount.value ? `${hudWarnCount.value} warning${hudWarnCount.value === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · "));
/** Anything for the findings card: the mode chip or a warning line — read
 *  from the ONE list of warning lines (hudWarnCount). A second list of its
 *  own left the mid-run tool-table line out: on a machine with no mode chip
 *  the card never rendered and the muted path went unexplained (Codex R42). */
const hasHudNotes = computed(() => !!hudMode.value || hudWarnCount.value > 0);
const wrapEl = ref<HTMLDivElement | null>(null);
const hudEl = ref<HTMLDivElement | null>(null);
const bottomEl = ref<HTMLDivElement | null>(null);
const simBannerEl = ref<HTMLDivElement | null>(null);
let _hudFitObs: ResizeObserver | null = null;

function fitHud() {
  const wrap = wrapEl.value;
  if (!wrap) return;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W || !H) return;
  // The SHARED viewer geometry — the narrow flag (the banner's short form,
  // the smaller cube) and the bottom column's cap below — holds whether or
  // not the DRO card shows (Settings → Layers → HUD off left both stale
  // after a resize, review round 9, UI-DI16); only the DRO's size pick
  // needs the card.
  const narrow = W < NARROW_VIEWER_PX;
  wrap.classList.toggle("narrowViewer", narrow);
  const cs = getComputedStyle(wrap);
  const gap = parseFloat(cs.getPropertyValue("--gap-section")) || 12;
  // Between the DRO card and the bottom column two cards meet: the tight
  // gap, not the viewer's own margin.
  const between = parseFloat(cs.getPropertyValue("--gap-tight")) || 4;
  const notes = wrap.querySelector<HTMLElement>(".hudNotes");
  const card = hudEl.value;
  if (card && card.offsetParent !== null) fitDro(wrap, card, notes, W, H, gap, between, narrow);
  else {
    // No DRO to make room for: the findings card (then only a failed model
    // part) never folds.
    Object.assign(hudFit, { notesCompact: false, narrow, overflow: false });
    notesOpen.value = false;
  }
  // An opened detail view grows the bottom column upward over the DRO — by
  // the operator's choice — but never over the simulation banner nor out of
  // the viewer: the column is capped there and its detail bodies scroll
  // under their pinned heads (the toggles are the way back; round 8,
  // UI-DI16/17).
  const bannerNow = simBannerEl.value?.offsetHeight ?? 0;
  wrap.style.setProperty("--viewer-bottom-max", `${Math.max(0, H - 2 * gap - (bannerNow ? bannerNow + between : 0))}px`);
  // A body the cap cuts scrolls — by touch too, so it takes the pointer.
  const body = notes?.querySelector<HTMLElement>(".hudNotesBody");
  body?.classList.toggle("scrolls", body.scrollHeight > body.clientHeight + 1);
}
/** The DRO card's size pick (fitHud with the card shown). */
function fitDro(wrap: HTMLElement, card: HTMLElement, notes: HTMLElement | null, W: number, H: number,
                gap: number, between: number, narrow: boolean) {
  const cube = parseFloat(getComputedStyle(wrap).getPropertyValue("--viewcube-size")) || 140;
  const availW = W - 3 * gap - cube;
  const top = HUD_SCALES.indexOf(hudCfg.value.scale);
  // Order: the DRO steps down and folds its extras first; the findings fold
  // to one line only when even the smallest DRO does not fit beside them.
  // Folds: 1 the Machine column, 2 F / S, 3 the tool line, 4 the column
  // head ("Work · G54" — the folded findings line names the fixture too).
  const tries: { scale: (typeof HUD_SCALES)[number]; fold: number; notesCompact: boolean }[] = [];
  for (const notesCompact of notes ? [false, true] : [false]) {
    for (let fold = 0; fold <= (notesCompact ? 4 : 3); fold++) {
      for (let i = top; i >= 2; i--) tries.push({ scale: HUD_SCALES[i]!, fold, notesCompact });
    }
  }
  tries.push({ scale: "xs", fold: 4, notesCompact: !!notes }, { scale: "xxs", fold: 4, notesCompact: !!notes });
  // Measure each candidate WHOLE on the live cards — the DRO card and the
  // findings card at the candidate's scale and folds, the bottom column's
  // real height with the scrub bar — classes set directly, one synchronous
  // layout each, then restored. The pick depends only on the pane and the
  // content, never on the state the cards are in now: measuring the bottom
  // at the CURRENT scale let the next pick change it and the fit swung
  // between two sizes forever (review round 6, UI-DI13). An OPENED detail
  // view — the warnings card, the scrub bar's More — is measured folded: the
  // operator asked for it over the DRO, and the DRO keeps its form (opening
  // More used to shrink it a step for an overlap it could not avoid).
  const scrub = wrap.querySelector<HTMLElement>(".scrubBar");
  const wasCard = card.className, wasNotes = notes?.className ?? "", wasScrub = scrub?.className ?? "";
  // The bottom column's cap (below) off while measuring: the candidates see
  // its natural folded height.
  wrap.style.removeProperty("--viewer-bottom-max");
  let pick = tries[tries.length - 1]!, fits = false;
  for (const t of tries) {
    for (const sc of HUD_SCALES) {
      card.classList.toggle(`hudScale-${sc}`, sc === t.scale);
      notes?.classList.toggle(`hudScale-${sc}`, sc === t.scale);
    }
    card.classList.toggle("hudFoldMach", t.fold >= 1);
    card.classList.toggle("hudFoldFS", t.fold >= 2);
    card.classList.toggle("hudFoldTool", t.fold >= 3);
    card.classList.toggle("hudFoldHead", t.fold >= 4);
    notes?.classList.toggle("needsCompact", t.notesCompact);
    notes?.classList.remove("notesOpen");
    scrub?.classList.remove("moreOpen");
    const bottom = bottomEl.value?.offsetHeight ?? 0;
    const banner = simBannerEl.value?.offsetHeight ?? 0;
    const availH = H - 2 * gap - (bottom ? bottom + between : 0) - (banner ? banner + between : 0);
    if (card.offsetHeight <= availH && card.offsetWidth <= availW) { pick = t; fits = true; break; }
  }
  card.className = wasCard;
  if (notes) notes.className = wasNotes;
  if (scrub) scrub.className = wasScrub;
  Object.assign(hudFit, { scale: pick.scale, fold: pick.fold, notesCompact: pick.notesCompact, narrow, overflow: !fits });
  if (!pick.notesCompact) notesOpen.value = false;
}
// The sim banner mounts with the sim mode: observe it while it exists (its
// height is part of the fit, UI-DI16).
watch(simBannerEl, (el, old) => {
  if (old) _hudFitObs?.unobserve(old);
  if (el) _hudFitObs?.observe(el);
  nextTick(fitHud);
});
// The operator's scale / machine column are the ceiling: a change there
// re-fits (the card's own size has not moved yet, so no observer fires).
watch(() => [hudCfg.value.scale, hudCfg.value.showMachine], () => nextTick(fitHud));

// Feed/spindle grid-row values (current_vel is units/s → units/min)
const hudFeed = computed(() =>
  vst.value?.current_vel != null ? (vst.value.current_vel * 60).toFixed(1) : NO_VALUE,
);
const hudLoad = computed(() =>
  vst.value?.spindle_load != null ? fmtPct(vst.value.spindle_load / 100) : "",
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
    const edgeMat = createMachineEdgeMaterial(sceneForegroundFromTheme());
    const edgeLine = new THREE.LineSegments(edgesGeom, edgeMat);
    edgeLine.position.copy(mesh.position);
    edgeLine.rotation.copy(mesh.rotation);
    edgeLine.scale.copy(mesh.scale);
    edgeLine.userData.partId = partId;
    edgeLine.visible = machineEdges && mesh.visible;
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
    for (const e of _machineEdgeLines) e.visible = on && machineMeshes.some(m => m.userData.partId === e.userData.partId && m.visible);
  }
  requestRender();
}

/** Re-resolve the palette (theme tokens, mode, custom colours) and put it
 *  on every live object: the toolpath streams, the limit overlay and the
 *  selected segment (toolpath controller), the backplot, both bounds boxes,
 *  the reach outlines, the tool materials and a collision tint on screen.
 *  Objects built later read `palette` at creation. */
function refreshPalette() {
  palette = resolveViewerPalette(readRootToken, viewerDefaults);
  toolpath.setColors(palette);
  backplot.setColor(palette.backplot);
  machineBoundsMesh?.setColors(palette.bounds, palette.boundsAlt);
  for (const g of [reachRoomMesh, reachPartMesh]) g?.setColors(palette.reach, palette.boundsAlt);
  MAT.tool.color.set(palette.tool);
  MAT.cutter.color.set(palette.cutter);
  for (const mesh of [...machineMeshes, toolCutterMesh, toolBodyMesh]) {
    if (mesh?.userData._clashOn) (mesh.material as THREE.MeshStandardMaterial).emissive.set(palette.collision);
  }
  _twpSig = "";   // the plane's role colours changed with the theme
  _twpRefresh();
  requestRender();
}

/** Settings changed a colour or the palette mode: the saved section is in
 *  the settings cache already (saveSection writes it before the debounce),
 *  the server's echo re-applies it once more. */
function applyPaletteFromSettings() {
  Object.assign(viewerDefaults, loadViewerDefaults());
  refreshPalette();
}

/** The palette as drawn (Settings' legend and its first switch to Custom). */
function currentPalette(): ViewerPalette { return { ...palette }; }

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
  applyPaletteFromSettings,
  currentPalette,
});


</script>

<template>
  <div ref="wrapEl" class="viewerWrapper" :class="{ narrowViewer: hudFit.narrow }">
    <div ref="host" class="viewerHost bordered-panel" />

    <!-- HUD Overlay — one card, one visual language: every live value is a
         grid row (muted letter label | right-aligned value), so feed and
         spindle read exactly like the axis rows. Tool is static context and
         stays a smaller single line. All text sizes scale with --hud-scale
         (settings: HUD scale). -->
    <!-- The top-left column (design wave D9, review round 7 UI-DI16): the
         SIMULATION banner above the DRO card, both in the left zone (never
         under the ViewCube column); fitHud leaves the banner's height free.
         The banner is unmissable: the model is posed along the program, NOT
         the machine, and motion controls are locked. In a narrow viewer it
         says SIMULATION and its "?" the rest (the whole sentence ran past
         both edges and over the DRO). -->
    <div class="viewerTop stack-tight">
    <div v-if="simMode" ref="simBannerEl" class="simBanner overlay-card warn">
      SIMULATION<template v-if="!hudFit.narrow"> &mdash; model shows the program, not the machine</template><HelpIcon v-else label="Simulation">The model shows the program, not the machine; machine controls stay locked until you exit.</HelpIcon>
    </div>
    <div v-show="hudVisible" ref="hudEl" class="hud hudCard overlay-card stack-tight"
         :class="[`hudScale-${hudFit.scale}`, { hudFoldMach: hudFit.fold >= 1, hudFoldFS: hudFit.fold >= 2, hudFoldTool: hudFit.fold >= 3, hudFoldHead: hudFit.fold >= 4 }]"
         :data-hud-fit="hudFit.overflow ? 'overflow' : 'fits'">
      <div class="hudGrid" :class="{ noMach: !hudCfg.showMachine }">
        <span class="hudHead"></span>
        <span class="hudHead">Work · {{ props.g5xLabel || NO_VALUE }}</span>
        <span v-if="hudCfg.showMachine" class="hudHead hudMachCell">Machine</span>
        <template v-for="a in hudEntries" :key="a.letter">
          <span class="hudAxis">{{ a.letter }}</span>
          <span class="hudWork">{{ fmtCoord(vst?.work_pos?.[a.index], a.letter) }}</span>
          <span v-if="hudCfg.showMachine" class="hudMach hudMachCell">{{ fmtCoord(vst?.machine_pos?.[a.index], a.letter) }}</span>
        </template>
        <template v-if="hudCfg.showFeedSpindle">
          <div class="sep hudFS"></div>
          <span class="hudAxis hudFS">F</span>
          <span class="hudWork hudFS">{{ hudFeed }}</span>
          <span v-if="hudCfg.showMachine" class="hudMach hudMachCell hudFS"></span>
          <span class="hudAxis hudFS">S</span>
          <span class="hudWork hudFS">{{ fmtRpm(vst?.spindle_speed_actual ?? null) }}<span v-if="!hudCfg.showMachine && hudLoad" class="hudLoadInline"> {{ hudLoad }}</span></span>
          <span v-if="hudCfg.showMachine" class="hudMach hudMachCell hudFS">{{ hudLoad }}</span>
        </template>
      </div>

      <template v-if="hudCfg.showTool">
        <div class="sep hudTool"></div>
        <div class="hudCtx hudTool">
          <span>T{{ vst?.tool_number ?? NO_VALUE }}</span><span>Ø{{ fmtCoord(vst?.tool_diameter) }}</span><span>L{{ fmtCoord(vst?.tool_length) }}</span>
        </div>
      </template>
      <div v-if="hudCfg.showLoadBar && vst?.spindle_load != null" class="loadBar" :class="spindleLoadZone">
        <div class="loadBarFill" :style="{ width: spindleLoadFillPct + '%' }"></div>
      </div>

    </div>
    </div>

    <!-- View navigation cube (top-right) -->
    <ViewCube
      :get-camera-quaternion="getMainCameraQuaternion"
      @view-change="applyViewDirection"
    />

    <!-- Quick-access grid under the ViewCube: Reset, Clear, PIP, Settings -->
    <div class="viewerQuickGrid">
      <MachineBtn type="viewPreset" aria-label="Reset view" title="Reset view" @click="setView('reset')">Reset</MachineBtn>
      <MachineBtn type="viewPreset" aria-label="Clear backplot" title="Clear backplot" @click="resetBackplot">Clear</MachineBtn>
      <MachineBtn type="viewerQuickToggle" :selected="pipVisible" @click="togglePip" :aria-label="pipVisible ? 'Hide camera' : 'Show camera'" :title="pipVisible ? 'Hide camera' : 'Show camera'">
        <Camera :size="14" />
      </MachineBtn>
      <MachineBtn type="viewerQuickToggle" @click="emit('open-settings', 'viewer')" aria-label="3D Viewer settings" title="3D Viewer settings">
        <Settings :size="14" />
      </MachineBtn>
    </div>

    <!-- Camera PIP overlay -->
    <CameraPip :visible="pipVisible" @close="closePip" />


    <!-- The bottom edge (design wave D9): the findings card — the mode chip
         and the warnings ("what to know", kept together — operator
         2026-09-12) and a failed model part — above the program-scrub bar.
         One column, bottom-aligned; the DRO card above leaves its height
         free (fitHud). A finding is a .hudWarn line in this ONE card, never
         a chip of its own (UI-N102). -->
    <div ref="bottomEl" class="viewerBottom stack-tight">
    <div v-if="(hudVisible && hasHudNotes) || failedParts.length || pathRevealText" class="hudNotes overlay-card stack-tight"
         :class="[`hudScale-${hudFit.scale}`, { needsCompact: hudFit.notesCompact, notesOpen }]">
      <!-- Folded (fitHud's last step): one line, the rest behind a toggle. -->
      <div class="hudNotesSummary">
        <span>{{ hudNotesSummary }}</span>
        <MachineBtn type="windowToggle" class="notesToggle" :aria-expanded="notesOpen"
                    :aria-label="notesOpen ? 'Hide viewer warnings' : 'Show viewer warnings'"
                    :title="notesOpen ? 'Hide viewer warnings' : 'Show viewer warnings'"
                    @click="notesOpen = !notesOpen"><ChevronDown v-if="notesOpen" :size="14" /><ChevronUp v-else :size="14" /></MachineBtn>
      </div>
      <!-- The lines: opened in a short viewer they scroll under the pinned
           summary (the bottom column is capped, review round 8, UI-DI17). -->
      <div class="hudNotesBody stack-tight scroll-thin">
      <template v-if="hudVisible">
        <!-- The mode/datum chip leads the warnings (operator, 2026-09-12: the
             readout, the tool line and the load bar are the readout; the chip
             and the warnings are the "what to know" block — keep them together). -->
        <div v-if="hudMode" class="hudMode val-status" :class="hudMode.cls" :title="hudMode.title">
          {{ hudModeLine(true) }}<HelpIcon v-if="hudMode.help" label="Kinematics state">{{ hudMode.help }}</HelpIcon>
        </div>

        <div v-if="vst?.eoffset_enabled" class="hudWarn">Comp Z {{ fmtNum(vst.eoffset_z, 3) }}</div>
        <div v-if="vst?.rotation_xy" class="hudWarn">Rotation {{ fmtNum(vst.rotation_xy, 1) }}°</div>
        <div v-if="foreignWcs.length" class="hudWarn">Program cuts in {{ foreignWcs.join(', ') }} — {{ props.g5xLabel }} active</div>
        <div v-if="rewrittenWcs.length" class="hudWarn">Program writes {{ rewrittenWcs.join(', ') }} — its preview ignores live edits there</div>
        <!-- A HUD warning's "why" is a HelpIcon beside it (design wave D1,
             UI-N32): the HUD ignores the pointer, so a title never showed on a
             touchscreen; the icon alone takes taps (.hudWarn .helpIcon). -->
        <div v-if="kinsEndWarn" class="hudWarn">{{ kinsEndWarn.text }}<HelpIcon label="Program ends in kinematics">{{ kinsEndWarn.title }}</HelpIcon></div>
        <!-- Stale-preview chips are REPORTS, not actions (operator, 2026-09-12:
             "what still clickable warnings do we have? is it needed?"). The
             gateway owns every re-parse decision — the schema edge once per
             file, the offset / tool-length drift edges when idle — so a click
             here could only race an edge about to fire, or repeat a schema
             parse that already failed. One source decides; the HUD says so. -->
        <div v-if="previewSchemaStale" class="hudWarn">Preview from a different suite version — re-parsing; if it stays, restart the suite<HelpIcon label="Preview version">The preview comes from another suite version. It re-parses once; if this stays, restart the suite.</HelpIcon></div>
        <!-- Same bar as the status banner (one fraction, previewRefreshPct):
             a fixed-width track under the chip, numbers in the tooltip. -->
        <template v-if="previewRefresh">
          <div class="hudWarn">Preview re-parsing · {{ previewRefreshLabel(previewRefresh.reason) }}<HelpIcon label="Preview re-parsing">Path, limit marks and simulation update when it lands — {{ fmtProgressTimes(previewRefreshElapsedMs, previewRefresh.expected_ms) }}.</HelpIcon></div>
          <div class="progressTrack" :title="fmtProgressTimes(previewRefreshElapsedMs, previewRefresh.expected_ms)"><div class="progressFill" :style="{ width: previewRefreshPct + '%' }"></div></div>
        </template>
        <div v-else-if="previewWcsStale" class="hudWarn">Preview uses older offsets — re-parses when idle<HelpIcon label="Preview offsets">A work offset changed after parsing — re-parses once the machine is idle.</HelpIcon></div>
        <div v-if="previewTloStale" class="hudWarn">Preview parsed with a different T{{ previewTloStale.tool }} length — re-parse follows<HelpIcon label="Preview tool length">T{{ previewTloStale.tool }} was {{ fmtNum(previewTloStale.parsed, 3) }} when parsed, now {{ fmtNum(previewTloStale.live, 3) }} — the preview re-parses with it, during a run too.</HelpIcon></div>
        <div v-if="previewTableStale" class="hudWarn" data-table-stale>Tool table changed — preview updates after the run<HelpIcon label="Preview tool table">{{ previewTableStale.why === "unsupported"
          ? "This machine's random tool changer cannot be re-parsed during a run; the preview re-parses once idle."
          : "The preview's start state is not known for this program; it re-parses once the machine is idle." }}</HelpIcon></div>
        <div v-if="abLine" class="hudWarn" data-ab-run>{{ abLine }}</div>
        <div v-if="toolpathOverflow" class="hudWarn">{{ toolpathOverflowCount }} limit violation{{ toolpathOverflowCount === 1 ? '' : 's' }}</div>
      </template>
      <div v-if="failedParts.length" class="hudWarn">{{ failedParts.length }} machine part{{ failedParts.length === 1 ? '' : 's' }} failed to load — check the model files<HelpIcon label="Model parts">Not loaded: {{ failedParts.join(', ') }}.</HelpIcon></div>
      </div>
      <!-- A finding's view of a hidden layer is PINNED (Codex R31 VP-I02):
           shown with the HUD off and in the folded card too — a layer the
           operator switched off never comes back unexplained, nor only as a
           "warning" in the count. -->
      <div v-if="pathRevealText" class="hudWarn hudPinned" data-path-reveal>{{ pathRevealText }}</div>
    </div>

    <!-- Program-scrub timeline (stage 2) + collision check (stage 3) -->
    <ScrubBar
      ref="scrubBarRef"
      :collisionBusy="collisionBusy"
      :collisionProgress="collisionProgress"
      :sweepTool="{ num: vst?.tool_number ?? null, diam: vst?.tool_diameter ?? null, programTools }"
      :collisionResult="collisionResult"
      :collisionTrack="collisionTrack"
      :collisionStopped="collisionStopped"
      :collisionResumable="collisionResumable"
      :collisionPartial="collisionPartial"
      :collisionPartialTrack="collisionPartialTrack"
      :collisionEntryResult="collisionEntryResult"
      @check-entry="runEntryCheck"
      @pose="onScrubPose"
      @finding="onFinding"
      @manual-scrub="endPathReveal"
      @cancel-check="_colInvalidate"
      :notesOpen="notesOpen"
      @more-open="notesOpen = false"
    />
    </div>

  </div>
</template>

<style scoped>
.viewerWrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

/* Quick-access 2×2 grid under the ViewCube: the cube sits --gap-section
   from the top and is --viewcube-size tall (one token, ViewCube.vue reads
   the same one), the grid starts --gap-tight below its bottom edge. */
.viewerQuickGrid {
  position: absolute;
  z-index: var(--z-raised);
  top: calc(var(--gap-section) + var(--viewcube-size) + var(--gap-tight));
  right: var(--gap-section);
  width: var(--viewcube-size);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap-tight);
}


.viewerHost {
  position: relative;
  z-index: var(--z-base);
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

/* Every overlay on the viewer sits --gap-section (12px) from its frame —
   the HUD, the quick grid, the STL chip, the sim bar and banner alike. */
/* The top-left column: the sim banner above the DRO card, in the left zone
   (never under the ViewCube column); the column ignores the pointer. */
.viewerTop {
  position: absolute;
  /* The bottom column (later in the DOM, same layer) paints above it: the
     fit keeps them apart, so they meet only when the operator opened a
     detail view (the findings, the scrub bar's More) — which then shows
     whole. */
  z-index: var(--z-float);
  top: var(--gap-section);
  left: var(--gap-section);
  max-width: calc(100% - 3 * var(--gap-section) - var(--viewcube-size));
  align-items: flex-start;
  pointer-events: none;
}
.hud {
  max-width: 100%;
  pointer-events: none;
  user-select: none;
}
.simBanner :deep(.helpIcon) { pointer-events: auto; }

/* Single HUD card (chrome from the global .overlay-card, shared with the
   sim bar). Every font-size below multiplies a --fs-* token by --hud-scale
   so the whole card scales coherently from one setting. */
.hudCard {
  --hud-scale: 1;
  padding: var(--gap-controls) var(--gap-section);
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}
/* The findings card scales with the DRO card (fitHud's pick); md = 1. */
.hudNotes { --hud-scale: 1; }
.hudScale-xxs { --hud-scale: 0.6; }  /* fitHud's last resorts, not settings */
.hudScale-xs { --hud-scale: 0.7; }
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
/* The fit's folds (fitHud): hidden by class, so each candidate is measured
   on the live card; the operator's own toggles stay v-if. */
.hudFoldMach .hudGrid { grid-template-columns: auto auto; }
.hudFoldMach .hudMachCell,
.hudFoldFS .hudFS,
.hudFoldTool .hudTool,
.hudFoldHead .hudHead { display: none; }
/* Divider row between axis block and F/S rows (layout-only override of
   the global .sep divider so it spans the whole grid). */
.hudGrid > .sep { grid-column: 1 / -1; align-self: center; }

.hudHead {
  font-size: calc(var(--fs-sm) * var(--hud-scale));
  color: var(--fg-muted);
  text-align: right;
  white-space: nowrap;
}
.hudAxis {
  font-size: calc(var(--fs-lg) * var(--hud-scale));
  color: var(--fg-muted);
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
  color: var(--fg-muted);
  text-align: right;
  white-space: nowrap;
  min-width: 8ch;
}
/* Spindle load riding inside the S value cell when the machine column
   (its usual home) is hidden — machine-column styling, inline. */
.hudLoadInline {
  font-size: calc(var(--fs-lg) * var(--hud-scale));
  color: var(--fg-muted);
}

/* Tool context line: T · Ø · L in G-code notation — no word labels. */
/* Mode line: colour semantics come from the global .val-status.ok/warn/bad/
   muted classes; only layout is local (the HUD's width-0/min-width trick so
   a long text cannot widen the card). */
.hudMode {
  font-size: calc(var(--fs-md) * var(--hud-scale));
  text-align: left;
  /* text + "?" one centred row (the icon never drops onto a line of its own) */
  display: flex;
  align-items: center;
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

/* The HUD ignores the pointer (the camera works through it); the one thing
   in it that takes a tap is a warning's help icon (design wave D1). */
.hudWarn :deep(.helpIcon), .hudMode :deep(.helpIcon) { pointer-events: auto; }
.hudWarn {
  font-size: calc(var(--fs-md) * var(--hud-scale));
  font-weight: var(--fw-medium);
  display: flex;
  align-items: center;
  color: var(--warn-text);
  white-space: normal;
}

/* The re-parse bar rides the card as a row. The global track is flex:1 for
   its row-layout home (GcodePanel); in this column that would zero its
   height — pin it to its own height, stretched to the card's width. */
.hudNotesBody > .progressTrack {
  flex: none;
}
/* The bottom edge: the findings card above the scrub bar, one column. The
   column ignores the pointer (the camera works through it); the scrub bar
   and a finding's "?" take it. */
.viewerBottom {
  position: absolute;
  z-index: var(--z-float);
  left: var(--gap-section);
  right: var(--gap-section);
  bottom: var(--gap-section);
  /* fitHud's cap: an opened detail view never reaches the banner or leaves
     the viewer (UI-DI16/17); the cards shrink, their bodies scroll. */
  max-height: var(--viewer-bottom-max, none);
  align-items: flex-start;
  pointer-events: none;
}
.viewerBottom > .hudNotes,
.viewerBottom > .scrubBar {
  flex: 0 1 auto;
  min-height: 0;
}
.viewerBottom > .scrubBar {
  align-self: stretch;
  pointer-events: auto;
}
/* The folded findings card (fitHud's last step, UI-DI12): the summary line
   stands in for every line until the operator opens it. */
.hudNotesSummary {
  display: none;
  flex: none;
  align-items: center;
  gap: var(--gap-tight);
  font-size: calc(var(--fs-md) * var(--hud-scale));
  font-weight: var(--fw-medium);
  color: var(--warn-text);
}
.hudNotes.needsCompact > .hudNotesSummary { display: flex; }
.hudNotes.needsCompact:not(.notesOpen) > :not(.hudNotesSummary):not(.hudPinned) { display: none; }
/* A pinned line stays whole under the column's cap (the body scrolls). */
.hudPinned { flex: none; }
.hudNotesSummary > .notesToggle { pointer-events: auto; }
/* Pinned summary (flex: none above), scrolling lines: a capped column
   shrinks the body. Opened — or cut by the cap (fitHud's .scrolls) — the
   lines take the pointer: a touch must scroll them. */
.hudNotesBody {
  min-height: 0;
  overflow-y: auto;
  /* A line's "?" reaches past its glyph by its invisible hit area
     (--help-hit, style.css .helpIcon::before): in this scroller that reach
     was overflow — a scrollbar under the off-datum chip, the card 10 px
     taller, an uncut body that took the pointer (operator, 2026-09-27) —
     and the scroller clipped the target. The padding holds the reach (at the
     top no more than the gap above: the summary's toggle stays whole), the
     negative margin gives the room back: the card keeps its size. */
  --help-reach: calc((var(--help-hit) - var(--help-icon-size)) / 2);
  --help-reach-top: min(var(--help-reach), var(--gap-tight));
  padding: var(--help-reach-top) var(--help-reach) var(--help-reach) 0;
  margin: calc(-1 * var(--help-reach-top)) calc(-1 * var(--help-reach)) calc(-1 * var(--help-reach)) 0;
}
.hudNotes.notesOpen > .hudNotesBody,
.hudNotesBody.scrolls { pointer-events: auto; }
.hudNotes {
  /* the left zone, like the DRO card: never under the ViewCube column */
  max-width: calc(100% - var(--gap-section) - var(--viewcube-size));
  overflow: hidden;
  padding: var(--gap-tight) var(--gap-section);
  line-height: 1.3;
}
/* A narrow pane (fitHud: < NARROW_VIEWER_PX) draws the ViewCube and its
   quick grid smaller — beside a DRO card a 140 px cube left the card no
   width at 150 % portrait. The cube reads the token for its CSS size. */
.viewerWrapper.narrowViewer { --viewcube-size: 96px; }

</style>
