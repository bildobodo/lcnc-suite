<script setup lang="ts">
// Program-scrub / SIMULATION bar (offline dry run, stages 2+3). Overlaid
// along the bottom of the 3D viewer.
//
// Simulation is an EXPLICIT mode (simMode.ts): while active, the model poses
// along the loaded program instead of the live machine — an intentionally
// wrong display — so every machine-action gate is closed (permissions.ts
// SIM_GATES), including Machine On. Entry requires the machine to be OFF and
// the interpreter idle; exit is the Exit button or one of the auto-exits
// (program run start, program change, machine powered on elsewhere, real
// joint motion as a backstop). ThreeViewer shows the .simBanner while active.
import { computed, markRaw, onUnmounted, ref, shallowRef, watch, watchEffect } from "vue";
import { lineRange } from "./viewer/lineIndex";
import { status, viewerGcode, viewerInit, gcodeContent, emitTelemetry } from "./lcncWs";
import { INTERP_IDLE } from "./lcnc";
import { simMode } from "./simMode";
import {
  sampleTrack, jointsForSample, buildEntryTrack,
  machineFromJoints, displayLineForPoint, atTrackEnd, lineRunAround, lineSpanCum, lineFirstMoveCum,
  programEndLine,
  type ScrubSample,
} from "./viewer/scrubTrack";
import { createRunWatcher } from "./viewer/runWatcher";
import { runLineState, subExecState } from "./trackHighlight";
import { specFromWire } from "./viewer/kins";
import { epochTermsFor, epochWcsList, usedWcsRowsKey, type WcsTableRow } from "./viewer/wcsEpochs";
import { twpPlaneForSample } from "./viewer/twpPlaneFrame";
import { clashTargets } from "./viewer/clashTargets";
import { mapAcrossEntry, sampleCum, targetAfter, targetBefore, type NavSelection } from "./viewer/findingNav";
import { toolChangeLinesFromText } from "./viewer/toolChangeScan";
import type { WcsTerms } from "./viewer/partFrame";
import type { ScrubTrack } from "./ws/bulkData";
import type { CollisionResult } from "./viewer/collision";
import { EVENT_NONE } from "./viewer/eventIndex";
import { mergedSweptFraction } from "./viewer/sweepMerge";
import { fmtElapsed } from "./format";
import { Play, Pause, X, Triangle, Circle } from "lucide-vue-next";
import MachineBtn from "./MachineBtn.vue";
import MachineSlider from "./MachineSlider.vue";
import { buildSimRows, nextRowKey, simRowOrder, type SimRowKind } from "./viewer/simRows";
import { simRows, simView, registerSimActions, type SimSweepView } from "./simPanelStore";
import MachineToggle from "./MachineToggle.vue";

const props = defineProps<{
  // Collision sweep state, owned by ThreeViewer (it holds the machine def
  // and geometries); this bar is the control surface + scrub-to-hit.
  collisionBusy: boolean;
  collisionProgress: number;
  /** Loaded tool the sweep checks with (null num = nothing loaded). */
  sweepTool?: { num: number | null; diam: number | null;
                /** Program tools the sweep poses per segment (schema 8);
                 *  null = channel absent (loaded tool / stub throughout). */
                programTools?: Array<{ num: number; diam: number }> | null } | null;
  /** The program's own (base) sweep result — see collisionTrack. */
  collisionResult: CollisionResult | null;
  // The exact track `collisionResult` was swept on (the base track). Hit
  // cums only mean anything on THAT track — entering sim swaps in the
  // entry-extended track (every cum shifts by the entry duration), whose
  // result is `collisionEntryResult` (the entry segment's side sweep merged
  // onto the base result, 2026-09-12). The clash UI shows the result swept
  // on exactly the displayed track, else nothing.
  collisionTrack: ScrubTrack | null;
  /** The LIVE sweep-so-far while the base sweep runs (2026-09-13): unrefined
   *  hits at their discovering samples, replaced by `collisionResult` when
   *  the sweep ends or parks. Shown on `collisionPartialTrack`. */
  collisionPartial: CollisionResult | null;
  collisionPartialTrack: ScrubTrack | null;
  collisionEntryResult: { track: ScrubTrack; result: CollisionResult } | null;
  /** The sweep is PARKED by a rotary jog (its track is about to be re-parsed)
   *  — with the covered fraction. The partial result is in `collisionResult`
   *  (marks show); `collisionResumable` says the worker still holds it, and
   *  it continues by itself once the pose settles. */
  collisionStopped: { covered: number; reason: "motion" } | null;
  collisionResumable: boolean;
}>();

const emit = defineEmits<{
  // joints: per-JOINT machine values (null entry = keep live joint), or null
  // to return the model to the live pose. line/cum: sample position; trk:
  // the track the cum lives on (ThreeViewer gates the clash tint on it).
  // `line` is the RAW sample line (the clash tint's key — sub-relative
  // numbers are self-consistent within the drawn data);
  // `displayLine` is the per-point-trust-GATED line for the text panel
  // (W3 P4) — null = suppress (untrusted / entry / end), never raw.
  // `tlo`/`tool`: the sample's tool offset + tool number (schema 8) —
  // ThreeViewer's phase 3 subtracts the offset the joints were lifted
  // with, and the marker follows the tool; null = live.
  (e: "pose", joints: (number | null)[] | null, line: number | null, cum: number | null, trk: ScrubTrack | null, displayLine: number | null, plane: number[] | null, tlo: number[] | null, tool: number | null): void;
  /** A finding navigated to (limit or collision); `onRapid`: its sample is
   *  a rapid, `run`: its section in BASE-track segments (null = on the
   *  entry move) — the viewer shows that section of a hidden layer
   *  (viewer/pathReveal.ts). */
  (e: "finding", onRapid: boolean, run: [number, number] | null): void;
  /** A finding's temporary view ends: the operator moved the timeline by
   *  hand, or a jump went to a tool change (a place, not a finding). */
  (e: "manual-scrub"): void;
  /** Sim entry: the entry-extended track + the base it was built from —
   *  ThreeViewer sweeps only the ENTRY SEGMENT when the base result is
   *  current, and nothing at all when the machine sits at the first point. */
  (e: "check-entry", track: ScrubTrack, base: ScrubTrack | null): void;
  /** A sim-time input edge (the WCS rows this track re-adds): nothing is
   *  current — followed by check-entry with the rebuilt entry track. */
  (e: "cancel-check"): void;
}>();

const st = computed<Record<string, any>>(() => status.value?.data ?? {});
const baseTrack = computed(() => viewerGcode.value?.scrubTrack ?? null);
// Base track + the ENTRY MOVE (live machine position → program first point),
// captured at sim entry — run-time-only motion no parse can know. Kept after
// exit so marks/results stay consistent; rebuilt on each entry.
// shallowRef + markRaw: a deep `ref` re-wrapped the track's nested arrays
// (frames, wcsEvents, subNames) in Vue Proxies; the collision worker post
// then threw DataCloneError ("Proxy object could not be cloned") AFTER the
// busy flag was set, pinning the Check chip at 0% for the whole sim session
// (trace: browser.error.console ×8 over two days). Nothing watches the
// track deeply — consumers react to the ref reassignment only.
const entryTrack = shallowRef<ScrubTrack | null>(null);
const track = computed(() => entryTrack.value ?? baseTrack.value);
const running = computed(() => (st.value.interp_state ?? INTERP_IDLE) !== INTERP_IDLE);
const machineOff = computed(() => !st.value.is_enabled);
// Why a findings stop is unavailable — told at the button through the one
// explain path (design wave D1, UI-N32), not a hover title on a wrapper.
const SIM_OFF_REASON = "Machine on — power off to simulate";
const hitNavReason = computed(() => (!simMode.value && !machineOff.value ? SIM_OFF_REASON : undefined));
// Visible whenever a track exists — during a real run the bar is a
// READ-ONLY display (all controls are dead via the existing gating): live
// playhead on the estimate axis, findings/tool marks as look-ahead.
const visible = computed(() => !!track.value);

const sPos = ref(0);          // scrub parameter (seconds on a time-based track)
const playing = ref(false);
// Playback speed, ×0.1 … ×100 in fixed steps — set in the Simulation tab
// (simPanelStore). On a time-based track ×1 is REAL TIME; on the distance
// fallback the base pace is BASE_MM_S.
const speed = computed(() => simView.speed);
const BASE_MM_S = 30;

const cumMax = computed(() => {
  const t = track.value;
  return t ? t.cum[t.count - 1]! : 0;
});
const curLine = ref(0);
const curRapid = ref(false);
// Per-point line trust + marked-sub name at the scrub position (W2 P6);
// null trust = legacy track → fall back to the wholesale flag.
const curLineOk = ref<boolean | null>(null);
const curSubName = ref<string | null>(null);
// W4: the displayed line is the sub's CALL/trigger line (readout shows
// both, e.g. "L9 (square)").
const curViaCall = ref(false);
const curDispLine = ref<number | null>(null);
const curAtEnd = ref(false);
// W5: the unique program-end line (M2/M30 text scan) — what the playhead
// displays when pinned at the track's terminal vertex.
const endLine = computed(() => programEndLine(gcodeContent.value));
// W5: marked-span execution state for GcodePanel's inline indent view —
// published from both the sim scrub and the run playhead; only spans with
// an attributed call line anchor an expansion.
function publishSubExec(t: ScrubTrack, i: number, subName: string | null) {
  const cl = t.cline?.[i] ?? 0;
  const raw = t.lines[i] ?? 0;
  subExecState.value = (subName && cl > 0 && raw > 0)
    ? { name: subName, subLine: raw, callLine: cl } : null;
}
const pct = computed(() => (cumMax.value > 0 ? Math.round((sPos.value / cumMax.value) * 100) : 0));

// Reused per-frame scratch — the sPos watcher runs at animation rate.
const _sample: ScrubSample = { px: 0, py: 0, pz: 0, pa: 0, pb: 0, pc: 0, line: 0, rapid: false, kinstype: null, frame: null, wcsEpoch: null, tlo: null, index: 0 };
const _joints: (number | null)[] = [];
// Wire kins declaration → spec, cached: specFromWire allocates, and this
// feeds the per-frame pose path — recompute only when viewer_init changes.
const _kinsSpec = computed(() => specFromWire(viewerInit.value?.kins));

/** Per-epoch WCS re-add terms (review P2): the pose, the entry inverse and
 *  the run playhead all convert program coords through the segment's OWN
 *  epoch basis (live table row / rewritten snapshot). undefined = legacy
 *  single-basis track. */
// Per-epoch raw offsets. The plane's ORIGIN is a workpiece feature, so it
// needs the epoch's g5x/g92 — NOT wcsTerms, which folds the tool offset in.
const _epochWcs = computed(() => {
  const evs = track.value?.wcsEvents;
  if (!evs?.length) return undefined;
  return epochWcsList(evs, _wcs(), st.value.wcs_table as WcsTableRow[] | undefined);
});
const _aIndex = computed(() => (viewerInit.value?.axes ?? []).indexOf("A"));

const _epochTerms = computed<WcsTerms[] | undefined>(() => {
  const evs = track.value?.wcsEvents;
  if (!evs?.length) return undefined;
  return epochTermsFor(evs, _wcs(), st.value.wcs_table as WcsTableRow[] | undefined);
});

function applyPos() {
  const t = track.value;
  if (!t || !simMode.value) return;
  sampleTrack(t, sPos.value, _sample);
  curLine.value = _sample.line;
  curRapid.value = _sample.rapid;
  curAtEnd.value = atTrackEnd(t, sPos.value);
  // Per-point trust + sub name for the sim readout (W2 P6): the sample's
  // upper track index addresses the wire trust channels directly.
  curLineOk.value = t.lineOk ? t.lineOk[_sample.index] === 1 : null;
  // Text-panel line: the ONE shared gating rule (W3 P4) — the raw sample
  // line still rides the emit for the clash tint, but GcodePanel only
  // ever sees the gated value (blank main-file lines stopped lighting,
  // scrollToLine(remap lineno) stopped firing). End state suppresses too.
  const disp = displayLineForPoint(t, _sample.index,
                                   !viewerGcode.value?.lines_untrusted);
  curSubName.value = disp.subName;
  curViaCall.value = disp.viaCall;
  curDispLine.value = disp.line;
  if (curAtEnd.value) subExecState.value = null;   // end state collapses the indent
  else publishSubExec(t, _sample.index, disp.subName);
  jointsForSample(_sample, _wcs(), viewerInit.value?.axes ?? [], _joints,
                  _kinsSpec.value, _epochTerms.value);
  // The PROGRAM's tilted plane at this sample (null unless this segment
  // establishes one). Simulation must not fall through to live machine
  // state: the model shows the program, so the overlay has to as well.
  const _ew = _sample.wcsEpoch != null ? _epochWcs.value?.[_sample.wcsEpoch] : undefined;
  const _ai = _aIndex.value;
  const _plane = (_ew && _ai >= 0 && _joints[_ai] != null)
    ? twpPlaneForSample({
        spec: _kinsSpec.value, kinstype: _sample.kinstype, frame: _sample.frame,
        g5x: _ew.g5x, g92: _ew.g92, rotationDeg: _ew.rotationDeg,
        a: _joints[_ai] as number })
    : null;
  emit("pose", _joints.slice(), _sample.line, sPos.value, t,
       curAtEnd.value ? (endLine.value ?? null) : disp.line, _plane,
       _sample.tlo ? [..._sample.tlo.xyz] : null, _sample.tlo?.tool ?? null);
}

/** ---------- explicit mode entry / exit ---------- */
// Live-joint baseline at entry: real machine motion while simulating (only
// possible from outside this tab — its own controls are gated) exits the
// mode. 0.05 units/degrees: above servo dither, below any deliberate move.
let _baseJoints: number[] = [];
const MOTION_EXIT_THRESHOLD = 0.05;

function _wcs() {
  const d = st.value;
  // tool: the fallback for segments before the program's first G43/M6 row
  // (jointsForSample / the entry inverse resolve each segment's own offset
  // from the track's tloEvents through it) — the payload's TOOL BASIS
  // (VP-I20: previewWorker normalised those points to it), else, for a
  // payload without a known start, the LIVE applied offset as before.
  return {
    g5x: d.g5x_offset ?? [], g92: d.g92_offset ?? [],
    rotationDeg: d.rotation_xy ?? 0, tool: viewerGcode.value?.toolBasis ?? d.tool_offset ?? [],
  };
}

/** The TWP plane frame the MACHINE is actually holding, from the kins pins
 *  (sampled only on xyzacb-trsrn configs). Null when not sampled.
 *
 *  Used by the RUN playhead's forward kins, where the machine's ACTUAL
 *  switchkins state is the authority for the joints being projected. The
 *  ENTRY conversion no longer uses it (W3 P3): naming the live pose in the
 *  track's coordinates is a labeling question, answered by the track's own
 *  first-segment mode/frame — mixing the live state in put the entry start
 *  ~900 mm off whenever parked labeling ≠ track labeling.
 *
 *  Units are the pins' own, including upstream's asymmetry (pre-rot radians,
 *  the two angles degrees) — the same triplet convention the parse markers
 *  use, so both paths feed kinsForSegment unconverted. */
function liveKinsFrame(): [number, number, number] | null {
  const d = st.value;
  const p = d.kins_pre_rot, t1 = d.kins_primary_angle, t2 = d.kins_secondary_angle;
  if (typeof p !== "number" || typeof t1 !== "number" || typeof t2 !== "number") return null;
  return [p, t1, t2];
}

function _buildEntryTrack() {
  const base = baseTrack.value;
  if (!base || !_baseJoints.length) {
    entryTrack.value = null;
    return;
  }
  // Entry labeling (W3 P3) lives in scrubTrack.buildEntryTrack — ONE
  // implementation shared with the sim-vs-actual gate harness (W6 P1).
  const g = viewerGcode.value;
  const built = buildEntryTrack(
    base, _baseJoints, viewerInit.value?.axes ?? [], _wcs(), _kinsSpec.value,
    _epochTerms.value, st.value.kins_type ?? null,
    { linear: g?.rapid_rate, rotary: g?.rot_rapid_rate });
  entryTrack.value = built ? markRaw(built) : null;
}

function enterSim(): boolean {
  if (simMode.value) return true;
  if (!baseTrack.value || running.value || !machineOff.value) return false;
  simMode.value = true;
  const jp = st.value.joint_pos;
  _baseJoints = Array.isArray(jp) ? [...jp] : [];
  _buildEntryTrack();
  sPos.value = 0;   // 0 = the machine's live position (entry-move start)
  applyPos();       // pose immediately — the mode announces itself
  // The entry move is the only new motion: ThreeViewer sweeps just that
  // segment against the current base result (or nothing, when the machine
  // already sits at the first point) — no full re-sweep on entry.
  if (track.value) emit("check-entry", track.value, baseTrack.value);
  return true;
}

function exitSim() {
  playing.value = false;
  if (!simMode.value) return;
  simMode.value = false;
  // The entry track STAYS after exit: the entry move is the rapid the next
  // cycle start will actually make from where the machine sits, and its
  // verdict (operator-caught 2026-09-12: a clash in sim, "clear" on exit)
  // must not vanish with the mode. It is dropped when a run starts or the
  // program changes, and REBUILT from the new pose when the machine moves
  // (the joint watcher below) — the base result keeps its own identity, so
  // keeping the entry track no longer costs a re-sweep on re-entry.
  emit("pose", null, null, null, null, null, null, null, null);
  subExecState.value = null;
}

// Pose-only watcher: programmatic sPos writes never change the mode.
watch(sPos, () => {
  if (simMode.value) applyPos();
});

// The pose depends on the live WCS — touch-off from another client while
// simulating must move the posed model. tool_offset is a pose input too
// (joint-space transform is G43-inclusive): a tool change / G43 while
// simulating must re-pose and re-check. Keyed on values so idle status
// ticks don't re-emit (render-on-demand stays effective).
const _wcsKey = computed(() => {
  const d = st.value;
  // Fixture rows are a pose input on an epoch-aware track — but ONLY the
  // rows its non-rewritten epochs actually re-add (W2 P5: the whole-table
  // stringify fired on every idle table publish and, with wcs_frames on
  // every modern payload, its epoch-aware guard was always open).
  const table = usedWcsRowsKey(track.value?.wcsEvents,
                               d.wcs_table as WcsTableRow[] | undefined);
  return `${(d.g5x_offset ?? []).join()},${(d.g92_offset ?? []).join()},${d.rotation_xy ?? 0},${(viewerGcode.value?.toolBasis ?? d.tool_offset ?? []).join()},${table}`;
});
// The pose (and the entry move's program coords) depend on the live WCS.
// While simulating, a WCS change also re-runs the sweep with the rebuilt
// entry track (outside sim, ThreeViewer's input watcher handles it).
let _wcsCheckTimer: ReturnType<typeof setTimeout> | undefined;
watch(_wcsKey, () => {
  if (entryTrack.value) _buildEntryTrack();
  applyPos();
  clearTimeout(_wcsCheckTimer);
  if (simMode.value) {
    _wcsCheckTimer = setTimeout(() => {
      if (simMode.value && track.value) {
        emit("cancel-check");
        emit("check-entry", track.value, baseTrack.value);
      }
    }, 500);
  }
});

// Auto-exits: execution starts, program changes, machine powered on
// (another client — this tab's Machine On is gated), or real joint motion.
// Keyed on the BASE track — entering sim swaps in the entry track, which
// must not itself trigger an exit.
watch(running, (r) => {
  if (!r) return;
  exitSim();
  entryTrack.value = null;   // the run's approach is real motion, followed positionally
});
watch(baseTrack, () => {
  exitSim(); entryTrack.value = null; sPos.value = 0;
  _runWatcher.reset(); runOffPath.value = false; runLineState.value = null;
  subExecState.value = null;
});
watch(machineOff, (off) => { if (!off) exitSim(); });
// Outside sim a kept entry track built from ANOTHER pose is stale: once the
// machine has held its new pose this long, rebuild the entry move from it and
// re-check the segment (milliseconds — ThreeViewer's side sweep). Not per
// status tick: a rebuild copies the whole track.
const ENTRY_SETTLE_MS = 500;
let _entrySettleTimer: ReturnType<typeof setTimeout> | undefined;
function _movedFromEntryPose(jp: unknown): jp is number[] {
  if (!Array.isArray(jp) || !_baseJoints.length) return false;
  for (let i = 0; i < jp.length; i++) {
    const base = _baseJoints[i];
    if (base != null && Math.abs((jp[i] ?? 0) - base) > MOTION_EXIT_THRESHOLD) return true;
  }
  return false;
}
watch(st, (d) => {
  const jp = d.joint_pos;
  if (simMode.value) {
    if (_movedFromEntryPose(jp)) exitSim();
    return;
  }
  if (!entryTrack.value || !_movedFromEntryPose(jp)) return;
  clearTimeout(_entrySettleTimer);
  _entrySettleTimer = setTimeout(() => {
    const now = st.value.joint_pos;
    if (simMode.value || running.value || !entryTrack.value || !Array.isArray(now)) return;
    _baseJoints = [...now];
    _buildEntryTrack();
    if (track.value) emit("check-entry", track.value, baseTrack.value);
  }, ENTRY_SETTLE_MS);
});

/** ---------- playback (distance-proportional, v1) ---------- */
let raf = 0;
let lastT = 0;
function tick(t: number) {
  if (!playing.value) return;
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  const rate = track.value?.timeBased ? speed.value : speed.value * BASE_MM_S;
  sPos.value = Math.min(cumMax.value, sPos.value + rate * dt);
  if (sPos.value >= cumMax.value) {
    playing.value = false;
    return;
  }
  raf = requestAnimationFrame(tick);
}

function togglePlay() {
  if (playing.value) {
    playing.value = false;
    return;
  }
  if (!enterSim()) return;
  if (sPos.value >= cumMax.value) sPos.value = 0;
  navSel.value = null;   // playback moves the position: no finding is shown
  applyPos();
  playing.value = true;
  lastT = performance.now();
  raf = requestAnimationFrame(tick);
}

/** A drag on the timeline PAUSES playback (operator, 2026-09-12: it used to
 *  resume from the new position the moment the drag ended). The native
 *  `input` event fires for USER changes only — the playback loop's
 *  programmatic writes never reach here. Play resumes from the scrubbed
 *  position. */
function onScrubInput() {
  navSel.value = null;   // the operator took the position over
  emit("manual-scrub");
  if (!playing.value) return;
  playing.value = false;
  cancelAnimationFrame(raf);
}

// Position readout: elapsed/total time on a time-based track, percent on
// the distance fallback.
const posLabel = computed(() => {
  if (track.value?.timeBased) {
    return `${fmtElapsed(Math.floor(sPos.value))}/${fmtElapsed(Math.floor(cumMax.value))}`;
  }
  return `${pct.value} %`;
});

/** ---------- run-time display (unified timeline phase 2 + review P3) ---------- */
// During a real run the playhead follows the LIVE POSITION: the machine
// pose is projected onto the track POSITIONALLY (projectOntoTrack — a
// cum-monotonic forward-biased window around the previous playhead, with a
// full-track rescue). motion_line is a HINT only, and only while the
// payload's line attribution is trusted — sub/remap-relative numbers
// collide with the main file's, which is what parked the old highlight on
// wrong lines. Display only: the machine drives sPos, never the reverse.
const motionLine = computed(() => st.value.motion_line as number | null | undefined);
// The watcher itself is a pure state machine (viewer/runWatcher.ts):
// ATTACHED = windowed projection per frame (+ trusted-line hint competing
// on residual); a miss pays exactly ONE full-track scan (the attach /
// run-from-line path) and then latches OFF-PATH — playhead frozen,
// highlight cleared, chip shown, ≤1 Hz strided re-probe, ZERO per-frame
// work. Wave 1 instead full-scanned 99k segments on EVERY status frame
// while the machine sat at the toolchange park (gap_p50 33 → 319 ms) and
// accepted the rescue's match however far away it was.
const _runWatcher = createRunWatcher();
const runOffPath = ref(false);
// ui.playhead_slow telemetry: the watcher self-times; anything past the
// budget is worth a trace row, rate-limited so a bad state can't flood.
const PLAYHEAD_SLOW_MS = 30;
let _lastSlowEmit = 0;
watch(st, (d) => {
  if (!running.value || simMode.value) return;
  const t = track.value;
  const jp = d.joint_pos;
  if (!t || !Array.isArray(jp)) return;
  const trusted = !viewerGcode.value?.lines_untrusted;
  const line = trusted ? motionLine.value : null;
  const span = line ? lineRange(t.lineIndex, line) : undefined;
  // Forward kins for the live joints: the machine's ACTUAL switchkins pin
  // and plane frame when sampled — same authority as the joints being
  // inverted; the hint span's (or track-start) segment mode stands in.
  const ktLive = d.kins_type;
  const ktNow = ktLive != null ? ktLive : (t.mode?.[span?.end ?? 0] ?? null);
  const fN = t.frame?.[span?.end ?? 0];
  const frameNow = liveKinsFrame()
    ?? ((fN != null && fN !== EVENT_NONE && t.frames) ? t.frames[fN] ?? null : null);
  const m = machineFromJoints(jp, viewerInit.value?.axes ?? [], _wcs(),
                              _kinsSpec.value, ktNow, frameNow);
  const out = _runWatcher.update({
    track: t, machine: m, wcs: _wcs(), epochTerms: _epochTerms.value,
    hintSpan: span ?? null, nowMs: performance.now(),
  });
  runOffPath.value = out.phase === "offPath";
  if (out.costMs > PLAYHEAD_SLOW_MS && performance.now() - _lastSlowEmit > 10_000) {
    _lastSlowEmit = performance.now();
    emitTelemetry("ui.playhead_slow", {
      cost_ms: Math.round(out.costMs), probed: out.probed,
      points: t.count, phase: out.phase,
    });
  }
  if (out.phase === "offPath") {
    // Frozen playhead — the machine is somewhere the program never goes
    // (toolchange park); pretending otherwise is the old bug. The
    // published state is SUPPRESS, never null: null would let App.vue fall
    // back to motion_line's colliding sub numbers.
    // offPath (W5) lets resolveCurrentLine apply the text-trusted
    // motion_line rescue (the approach executing a real main line).
    runLineState.value = { line: 0, trusted: false, subName: null, offPath: true };
    subExecState.value = null;
    return;
  }
  if (out.cum == null) return;
  sPos.value = out.cum;
  // End state (W3 P4): the playhead pinned at the terminal vertex has
  // nothing further to attribute — trailing non-motion lines (M2) are
  // unknowable, so present "end" instead of freezing on the last line.
  const i = out.index!;
  if (i === t.count - 1 && atTrackEnd(t, out.cum)) {
    // W5: the unique text-scanned program-end line displays here — the
    // track cannot know what follows the last move, the text can.
    runLineState.value = { line: endLine.value ?? 0,
                           trusted: endLine.value != null,
                           subName: null, atEnd: true };
    subExecState.value = null;
    return;
  }
  // Text-panel line state (W2 P6): the ONE shared gating rule (W3 P4) —
  // per-point trust from the wire when the track carries it; legacy
  // tracks fall back to the wholesale flag. The published line is the
  // GATED display line (W4: inside an attributed sub span that is the
  // CALL/trigger line, viaCall) — never the raw colliding sub number.
  const disp = displayLineForPoint(t, i, trusted);
  runLineState.value = {
    line: disp.line ?? 0,
    trusted: disp.line != null,
    subName: disp.subName,
    viaCall: disp.viaCall,
    subLine: disp.subName ? t.lines[i] ?? null : null,
  };
  publishSubExec(t, i, disp.subName);
});
watch(running, (r) => {
  _runWatcher.reset();
  runOffPath.value = false;
  if (!r) runLineState.value = null;
  if (!r && !simMode.value) subExecState.value = null;
});

// Row-1 readouts live in FIXED slots (E: the timeline is the only flexible
// item, so every content-sized sibling used to steal its width — a longer
// "L14 (g544remap)" chip or RUNNING appearing shifted the slider edge).
const lineText = computed(() => {
  // Per-point trust (W2 P6) labels the readout; a point inside a marked
  // sub shows the sub's NAME instead of a colliding line number. Legacy
  // tracks (no per-point channel) fall back to the wholesale flag.
  const trusted = !viewerGcode.value?.lines_untrusted;
  if (simMode.value) {
    const ok = curLineOk.value ?? trusted;
    // "end" mirrors "entry" (W3 P4): the terminal vertex is where the
    // track's knowledge stops — never a guessed M2 highlight. Inside an
    // attributed sub span (W4) the readout names the CALL line and the
    // sub: "L9 (square)".
    const label = curAtEnd.value ? "end"
      : !curLine.value ? "entry"
      : ok ? `L${curLine.value}`
      : curViaCall.value && curDispLine.value
        ? `L${curDispLine.value}${curSubName.value ? ` (${curSubName.value})` : ""}`
      : curSubName.value ? `(${curSubName.value})` : "···";
    return `${label}${curRapid.value ? " →" : ""}`;
  }
  // "~": the run readout is the ESTIMATE clock (parse-time feeds/rapids) —
  // feed override, accel and dwells make real elapsed differ (GcodePanel
  // shows the wall clock).
  if (running.value) {
    // Off path (a toolchange park): the playhead is frozen — say so in the
    // line slot instead of a line number (the mode chip that used to say it
    // was an 8ch slot empty outside a run).
    if (runOffPath.value) return "off path";
    const rls = runLineState.value;
    const label = rls
      ? (rls.atEnd ? "end"
        : rls.trusted ? (rls.viaCall && rls.subName
          ? `L${rls.line} (${rls.subName})` : `L${rls.line}`)
        : rls.subName ? `(${rls.subName})` : "···")
      : trusted ? `L${motionLine.value ?? 0}` : "···";
    return label;
  }
  return "";
});
const lineOffPath = computed(() => running.value && runOffPath.value);
const lineTitle = computed(() => lineOffPath.value
  ? "The machine is somewhere the program's path never goes (e.g. a toolchange park) — the playhead is frozen until it returns"
  : lineText.value);
// Position readout: ALWAYS the timer — the scrub position over the total
// ("00:00/45:00" at idle, where the scrub sits at 0; "~" marks the run
// ESTIMATE axis; the distance fallback shows a percentage). "live" used to
// sit right-aligned in a slot sized for two timestamps (operator,
// 2026-09-12: "why live and not always the timer?").
const posText = computed(() => (running.value ? `~${posLabel.value}` : posLabel.value));
// Both readout slots are sized PER PROGRAM, so they change only on load and
// the timeline never moves while scrubbing. Time: "mm:ss/mm:ss" plus the
// run "~" (5ch holds the distance axis's "100%"). Line: "L" + the digits of
// the last line + " →" (the rapid marker), 5ch floor for "entry"/"end";
// sub names ellipsize with the full text in the title.
const posSlotCh = computed(() =>
  track.value?.timeBased ? fmtElapsed(Math.floor(cumMax.value)).length * 2 + 2 : 5);

// Sweep progress is drawn ON THE TIMELINE (the swept band, sweptFrac below)
// so a scrub shows which section is already checked, and the clashes found
// so far show as the sweep finds them (collisionPartial). There is no
// button (2026-09-13): sweeps are open-ended, pause on camera interaction
// and hidden tabs, park on a rotary jog and resume by themselves; a sweep is
// only dropped by a superseding change (program, touch-off, tool).
const stoppedTitle = computed(() => {
  const st = props.collisionStopped;
  if (!st) return "";
  return `Paused at ${pctOf(st.covered)} — a rotary moved. Continues once it settles; the rest is unchecked.`;
});

// Sim toggle v-model: the parent-authoritative MachineToggle resets its DOM
// checkbox when the model doesn't change — so a refused entry (machine on)
// simply snaps the switch back.
const simToggleModel = computed({
  get: () => simMode.value,
  set: (on: boolean) => { if (on) enterSim(); else exitSim(); },
});

/** ---------- soft-limit violations (stage 1) in the bar ---------- */
const violations = computed(() => viewerGcode.value?.violations ?? null);
const linearUnit = computed(() => (viewerGcode.value?.stats?.unit as string) ?? "mm");
/** ---------- position-aware finding navigation ---------- */
// Targets are timeline extents [cum, cumEnd] named by a key; prev/next go
// from the finding a jump showed (by its key, while the timeline still
// stands there) or else from the CURRENT scrub position, so scrubbing
// anywhere re-anchors the navigation; both wrap around at the ends. A jump
// samples INSIDE the finding's extent — no fixed window decides whether a
// short move or a close finding is reachable (viewer/findingNav.ts, Codex
// R32 VP-I06).
interface FindingTarget { cum: number; cumEnd: number; key: string; line: number; rapid?: boolean; dist?: number; spanEndLine?: number; reentry?: boolean; entry?: boolean }
/** The finding the last jump showed and where it left the timeline. */
const navSel = shallowRef<NavSelection | null>(null);
// Its identity lives only until the timeline leaves the jump's position
// (Codex R33 VP-I08): ANY other position ends it for good — coming back to
// the same value by hand is a position, not the finding. Sync: a jump writes
// the position, then its own selection, in one task. Another displayed track
// (sim entry, a rebuilt entry move, another program) is a new binding; a
// jump sets its selection after the entry it caused. A collision result
// arriving (the entry's side sweep) changes neither and keeps it.
watch(sPos, p => { if (navSel.value && p !== navSel.value.pos) navSel.value = null; }, { flush: "sync" });
watch(track, () => { navSel.value = null; }, { flush: "sync" });


const violationTargets = computed<FindingTarget[]>(() => {
  const t = track.value, b = baseTrack.value;
  if (!t || !b) return [];
  const seen = new Set<number>();
  const out: FindingTarget[] = [];
  for (const v of violations.value ?? []) {
    if (seen.has(v.line)) continue;
    seen.add(v.line);
    // The line's first move (lineFirstMoveCum): it STARTS where the previous
    // move ends — the line's first point is where it ends, and the jump
    // landed in the next line's move. Found on the BASE track, read on the
    // displayed one (Codex R33 VP-I05): the entry move ends at the program's
    // first point and carries its line, so by line number the entry move
    // was the first line's finding.
    const move = lineFirstMoveCum(b, v.line, t);
    if (move) out.push({ cum: move[0], cumEnd: move[1], key: `L${v.line}`, line: v.line });
  }
  return out.sort((a, b) => a.cum - b.cum);
});

// The result swept on exactly the DISPLAYED track (see the collisionTrack
// prop): the base result on the base track, the entry-overlaid one on the
// entry track, nothing otherwise. Hits are cum-sorted by the sweep.
const shownResult = computed<CollisionResult | null>(() => {
  const t = track.value;
  if (!t) return null;
  if (props.collisionResult && props.collisionTrack === t) return props.collisionResult;
  if (props.collisionPartial && props.collisionPartialTrack === t) return props.collisionPartial;
  const e = props.collisionEntryResult;
  return e && e.track === t ? e.result : null;
});
const hits = computed(() => shownResult.value?.hits ?? []);
// What the displayed track IS, for the coverage wording: on the entry track
// a merged result's fraction covers the whole route (TWP-12), never "the
// program" alone.
const routeWord = computed(() =>
  baseTrack.value && track.value !== baseTrack.value ? "route (entry move + program)" : "program");
// The verdict's "why" in ONE help (design wave D1, UI-N32): how much was
// checked, what stopped it, which contacts were excluded and whether the
// guarantee holds — it used to ride four long hover titles, invisible on a
// touchscreen. The verdict words stay short.
const verdictDetail = computed<string>(() => {
  const r = shownResult.value;
  if (!r) return "";
  // Short and precise (operator, D1 live look: "nobody reads an abstract").
  const parts: string[] = [];
  const stopped = props.collisionStopped;
  if (props.collisionBusy) parts.push("Still checking — positions refine when it ends.");
  else if (stopped && props.collisionResumable) parts.push(stoppedTitle.value);
  else if (r.truncated) parts.push(`${pctOf(r.truncated.covered)} checked — the rest is unchecked.`);
  if (r.pairCount === 0) parts.push("No parts move against each other — nothing to check.");
  if (hits.value.length) parts.push("A stop shows the first contact (machine off).");
  if (r.staticContacts.length) parts.push(`${r.staticContacts.length} contact${r.staticContacts.length === 1 ? "" : "s"} at the start ignored.`);
  if (sweepCaveat.value) parts.push(`Not certified: ${sweepCaveat.value}.`);
  return parts.join(" ") || "Tool and machine parts checked against each other along the whole program.";
});

// Reasons this sweep's no-missed-crossing guarantee does NOT hold. Null when
// it does. Both cases mean the same thing to an operator — the result is a
// sample, not a proof — so they share one marker rather than hiding one of
// them next to a green "clear".
const sweepCaveat = computed<string | null>(() => {
  const r = shownResult.value;
  if (!r || props.collisionBusy) return null;   // a live partial claims nothing yet
  const why: string[] = [];
  if (r.uncertified) why.push(r.uncertified);
  if (r.coarsened) why.push("coarsened to fit the sample budget");
  if (r.truncated && r.truncated.reason !== "running" && !props.collisionResumable) {
    why.push(`stopped at ${pctOf(r.truncated.covered)} of the ${routeWord.value} (${r.truncated.reason === "samples" ? "sample backstop" : r.truncated.reason}) — the rest is unchecked`);
  }
  return why.length ? `Clearance guarantee not certified for this sweep: ${why.join("; ")}` : null;
});
/** Covered fraction for the operator: never a rounded "0 %" for a sweep
 *  that did run — that would read as "nothing", not "very little". */
function pctOf(f: number): string {
  return f < 0.01 ? "<1 %" : `${Math.round(f * 100)} %`;
}
/** Swept fraction of the DISPLAYED track's axis — the timeline's swept band:
 *  the running progress, the parked/truncated covered part, 1 when done.
 *  Sweep values are BASE-relative (progress and the parked `covered` are
 *  base-track fractions since 2026-09-12) and are re-based past the entry
 *  segment on the entry track — EXCEPT a merged result's `truncated`, which
 *  mergeEntryResult already expresses on the merged axis (TWP-12). */
const sweptFrac = computed(() => {
  const t = track.value, b = baseTrack.value;
  if (!t || cumMax.value <= 0) return 0;
  let f: number;
  let merged = false;
  if (props.collisionBusy) f = props.collisionProgress;
  else {
    const r = shownResult.value;
    if (!r) return 0;
    if (props.collisionStopped && props.collisionResumable) f = props.collisionStopped.covered;
    else if (r.truncated) { f = r.truncated.covered; merged = !!(b && t !== b); }
    else f = 1;
  }
  if (b && t !== b && t.count > 1) return mergedSweptFraction(f, merged, t.cum[1]!, b.cum[b.count - 1]!, cumMax.value);
  return Math.min(1, Math.max(0, f));
});

// One navigation target per contact ONSET: an intermittent-contact line
// (enter → exit → re-enter) yields a target per interval, so the re-entry
// is a real "next clash" stop, not folded invisibly into the first.
// Continuation records (the same contact carried across line boundaries)
// are NOT clashes of their own; the tint and the G-code marks still show
// the whole extent. The COUNT, the timeline marks and prev/next all read
// THIS list (viewer/clashTargets.ts) — they used to disagree (count per
// record, marks per interval: "1 clash, 2 marks").
const hitTargets = computed(() => clashTargets(hits.value));


/** The entry move's length on a track built from the base (0 = the base). */
function entryLenOf(x: ScrubTrack): number {
  const b = baseTrack.value;
  if (!b || x === b || x.count < 1 || b.count < 1) return 0;
  return x.cum[x.count - 1]! - b.cum[b.count - 1]!;
}

function jumpTo(pick: FindingTarget | null, kind: SimRowKind) {
  if (!pick) return;
  const from = track.value;
  if (!enterSim()) return;
  playing.value = false;
  // The CHOSEN finding on the DISPLAYED track (Codex R32 VP-I05): entering
  // the simulation puts the entry move in front, and the pick's cum was on
  // the track before — by its key when the list already has it, else
  // re-expressed across the entry move (a finding on the entry move stays
  // on it). Never "next" again: that could pick another finding.
  const t = track.value;
  let target = pick;
  if (t && from && t !== from) {
    target = targetsOf(kind).find(f => f.key === pick.key)
      ?? mapAcrossEntry(pick, entryLenOf(from), entryLenOf(t));
  }
  // Inside the finding's extent: its start cum is the previous move's end,
  // whose sample names the previous line and misses the contact tint.
  sPos.value = Math.min(cumMax.value, Math.max(0, sampleCum(target)));
  navSel.value = { key: target.key, pos: sPos.value };
  applyPos();
  // A tool change is a place on the timeline, not a finding: nothing of a
  // hidden layer to reveal — and the previous finding's reveal ends with the
  // jump (Codex R78 VP-I39: its move and its line stayed shown at the tool
  // change), the stored layers untouched.
  if (kind === "tool") { emit("manual-scrub"); return; }
  // The finding's SECTION (Codex R31 VP-I03): the run of its move around the
  // jumped-to segment, in BASE-track indices — the drawn streams' source
  // map addresses the base track, the entry track prepends its points. A
  // finding on the entry move itself is on nothing drawn: null.
  const b = baseTrack.value;
  let run: [number, number] | null = null;
  if (t && b) {
    const off = t.count - b.count;
    const [ra, rb] = lineRunAround(t, _sample.index);
    if (rb - off >= 1) run = [Math.max(1, ra - off), rb - off];
  }
  emit("finding", _sample.rapid, run);
}

// Tool-change events on the timeline + the next-tool countdown (ahead of
// the current position, NON-wrapping — a past change is not "next").
// Canon M6 events from the wire PLUS the text's M6 / M600 / M601 lines: a
// preview-skipped remap contributes no canon event ("T13 M600" had no mark
// — operator-caught on perfmatrix). Union by line, the wire's tool wins.
// The scan is per program text (cached), not per track.
const textToolLines = computed(() => toolChangeLinesFromText(gcodeContent.value));
// A tool-change line has no motion of its own: its timeline position is
// where the next line that has one STARTS moving (lineSpanCum — its first
// point is where that move already ended). Read on the DISPLAYED track: a
// change before the first motion runs before the entry move, at its start.
function spanAtOrAfterLine(t: ScrubTrack, line: number): [number, number] | undefined {
  for (let l = line; l <= t.lineIndex.maxLine; l++) {
    const span = lineSpanCum(t, l);
    if (span) return span;
  }
  return undefined;
}
// A target like a finding (key T<line>, the extent of the move it starts):
// the Simulation tab lists it and a tap shows it.
const toolTargets = computed(() => {
  const t = track.value;
  const out: Array<FindingTarget & { tool: number }> = [];
  if (!t) return out;
  const byLine = new Map<number, number>();
  for (const [line, tool] of viewerGcode.value?.tool_change_lines ?? []) byLine.set(line, tool);
  for (const [line, tool] of textToolLines.value) if (!byLine.has(line)) byLine.set(line, tool);
  for (const [line, tool] of byLine) {
    const span = spanAtOrAfterLine(t, line);
    if (span) out.push({ cum: span[0], cumEnd: span[1], key: `T${line}`, line, tool });
  }
  return out.sort((a, b) => a.cum - b.cum);
});

/** ---------- timeline marks + extents (2026-09-12) ---------- */
// Every mark is the same tick, told apart by colour AND a glyph under the
// track — × clash, ▲ soft limit, ● tool change (operator: the dark theme's
// red and amber were hard to tell apart, and the old height tiers carried
// no meaning; "rapid" stays in the readout and the tooltip). `near` = within
// the margin but never touching. Clash last = paints on top. A violating line
// the track doesn't know (comment-line attribution edge) simply has no mark;
// the GcodePanel banner still lists it.
type MarkKind = "tool" | "limit" | "clash";
const marks = computed(() => {
  const max = cumMax.value;
  const out: Array<{ pct: number; kind: MarkKind; near: boolean }> = [];
  if (max <= 0) return out;
  const pctOfCum = (c: number) => Math.min(100, (c / max) * 100);
  for (const x of toolTargets.value) out.push({ pct: pctOfCum(x.cum), kind: "tool", near: false });
  for (const x of violationTargets.value) out.push({ pct: pctOfCum(x.cum), kind: "limit", near: false });
  for (const x of hitTargets.value) out.push({ pct: pctOfCum(x.cum), kind: "clash", near: (x.dist ?? 0) > 1e-3 });
  return out;
});
// Extent bands (timeline percentages): where a soft-limit line runs (warn)
// and where contact persists (danger — every record's refined intervals,
// continuations included, so the whole extent paints; red after yellow in
// DOM order = red wins). Near-misses have no extent. Merged per kind so
// overlapping records don't stack their tint.
function mergeSpans(spans: Array<[number, number]>): Array<[number, number]> {
  spans.sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const sp of spans) {
    const last = out[out.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else out.push([sp[0], sp[1]]);
  }
  return out;
}
const limitBands = computed(() => {
  const t = track.value, b = baseTrack.value, max = cumMax.value;
  const spans: Array<[number, number]> = [];
  if (!t || !b || max <= 0) return spans;
  const seen = new Set<number>();
  for (const v of violations.value ?? []) {
    if (seen.has(v.line)) continue;
    seen.add(v.line);
    // a one-move line had no band; the program's line, never the entry move
    const span = lineSpanCum(b, v.line, t);
    if (span && span[1] > span[0]) spans.push([(span[0] / max) * 100, (span[1] / max) * 100]);
  }
  return mergeSpans(spans);
});
const clashBands = computed(() => {
  const max = cumMax.value;
  const spans: Array<[number, number]> = [];
  if (max <= 0) return spans;
  for (const h of hits.value) {
    if (h.dist > 1e-3) continue;
    const ivs = h.intervals ?? (h.cumEnd > h.cum ? [[h.cum, h.cumEnd] as [number, number]] : []);
    for (const [a, b] of ivs) if (b > a) spans.push([(a / max) * 100, (b / max) * 100]);
    // An onset whose contact persists past its own line paints to where it
    // finally ends (spanCumEnd — over ALL records, past the report cap).
    if (h.continuation === undefined && h.spanCumEnd != null && h.spanCumEnd > h.cumEnd) {
      spans.push([(h.cumEnd / max) * 100, (h.spanCumEnd / max) * 100]);
    }
  }
  return mergeSpans(spans);
});

onUnmounted(() => {
  cancelAnimationFrame(raf);
  clearTimeout(_wcsCheckTimer);
  clearTimeout(_entrySettleTimer);
  exitSim();
});

// ─── The Simulation tab (operator 2026-10-05) ───────────────────────────
// The bar keeps Sim, play, the timeline and the time; the findings, the
// collision check and the speed live in the side pane's Simulation tab. Its
// list is built from THIS component's targets and its actions are this
// component's jumps (simPanelStore.ts), so the marks, the list and prev/next
// are one navigation. The bar has no compact form any more: nothing in it
// changes its width with the content.
function targetsOf(kind: SimRowKind): FindingTarget[] {
  return kind === "limit" ? violationTargets.value : kind === "clash" ? hitTargets.value : toolTargets.value;
}
const rowsNow = computed(() => buildSimRows({
  clash: hitTargets.value, limit: violationTargets.value, tool: toolTargets.value,
  violations: violations.value ?? [], unit: linearUnit.value,
  timeBased: !!track.value?.timeBased, axisEnd: cumMax.value,
}));
watch(rowsNow, r => { simRows.value = r; }, { immediate: true });
// Per frame while playing, but it only CHANGES where the playhead passes a
// row — the tab re-renders then, not per frame.
const nextKeyNow = computed(() => nextRowKey(rowsNow.value, sPos.value));
/** What the collision check has done, in the tab's words. */
const sweepView = computed<SimSweepView | null>(() => {
  const r = shownResult.value;
  if (!r && !props.collisionBusy) return null;
  const n = hitTargets.value.length;
  const found = `${n} collision${n === 1 ? "" : "s"}`;
  const tools = sweepToolSentence.value;
  const detail = (r ? verdictDetail.value + " " : "") + tools;
  if (r && r.pairCount === 0) return { state: "nopairs", frac: 0, verdict: "No moving pairs", tone: "muted", caveat: false, detail };
  const caveat = !!sweepCaveat.value;
  if (props.collisionBusy) {
    return { state: "checking", frac: sweptFrac.value, verdict: n ? `${found} so far` : "No collision so far",
      tone: n ? "danger" : "muted", caveat: false, detail };
  }
  const covered = props.collisionStopped && props.collisionResumable ? props.collisionStopped.covered
    : r?.truncated ? r.truncated.covered : null;
  if (covered != null) {
    return { state: props.collisionStopped && props.collisionResumable ? "paused" : "partial", frac: sweptFrac.value,
      verdict: n ? `${found} in ${pctOf(covered)} swept` : `No collision in ${pctOf(covered)} swept`,
      tone: n ? "danger" : "warn", caveat, detail };
  }
  return { state: "done", frac: 1, verdict: n ? found : "Clear", tone: n ? "danger" : "ok", caveat, detail };
});
/** Which tools the check poses — said in the check's "?", not on the bar. */
const sweepToolSentence = computed(() => {
  const pt = props.sweepTool?.programTools;
  if (pt?.length) return "Checked with the program's tools " + pt.map(t => `T${t.num} Ø${t.diam.toFixed(1)}`).join(", ") + ".";
  const n = props.sweepTool?.num;
  if (n == null || !Number.isFinite(n) || n <= 0) return "No tool loaded: checked with a 6 mm stub.";
  const d = props.sweepTool?.diam;
  return `Checked with the loaded T${n}${d != null && d > 0 ? ` Ø${d.toFixed(1)}` : ""} throughout.`;
});
watchEffect(() => {
  simView.available = visible.value;
  simView.shownKey = navSel.value?.key ?? null;
  simView.nextKey = nextKeyNow.value;
  simView.line = lineText.value;
  simView.lineOffPath = lineOffPath.value;
  simView.lineTitle = lineTitle.value;
  simView.time = posText.value;
  simView.sweep = sweepView.value;
  simView.jumpReason = hitNavReason.value;
});
registerSimActions({
  jump(key: string) {
    for (const kind of ["clash", "limit", "tool"] as const) {
      const t = targetsOf(kind).find(x => x.key === key);
      if (t) { jumpTo(t, kind); return; }
    }
  },
  step(kinds, dir) {
    // the list's own order (simRowOrder), ties included — Codex R78 VP-I38
    const list = kinds.flatMap(k => targetsOf(k).map(t => ({ ...t, kind: k }))).sort(simRowOrder);
    const t = dir > 0 ? targetAfter(list, sPos.value, navSel.value) : targetBefore(list, sPos.value, navSel.value);
    if (t) jumpTo(t, t.kind);
  },
});
onUnmounted(() => {
  registerSimActions(null);
  simView.available = false;
  simRows.value = [];
});
</script>

<template>
  <!-- ONE row (operator 2026-10-05): Sim, play, the timeline with its marks,
       the time. Nothing here changes its width with the content, so the bar
       never folds; the findings, the collision check and the speed are in
       the side pane's Simulation tab. A narrow viewer gives the timeline a
       row of its own — by the viewer's width, never by content. -->
  <div v-if="visible" class="scrubBar overlay-card">
    <div class="row-controls scrubRow">
      <!-- Sim mode toggle — same switch as settings/coolant toggles. The
           parent-authoritative model snaps it back if entry is refused. -->
      <MachineToggle gate="simToggle" v-model="simToggleModel" label="Sim"
                     :disabled="!simMode && !machineOff"
                     help="Poses the 3D model along the program. Machine must be OFF; machine controls lock until you exit." />

      <MachineBtn type="scrub" :disabled="!simMode && !machineOff"
                  :title="playing ? 'Pause playback' : 'Play the program through the machine model'"
                  @click="togglePlay">
        <Pause v-if="playing" :size="14" />
        <Play v-else :size="14" />
      </MachineBtn>
      <div class="sliderWrap">
        <MachineSlider gate="scrubPos" class="sliderInput rangeOverlayTrack" :min="0" :max="cumMax"
                       :step="cumMax / 2000 || 1" v-model="sPos" :disabled="!simMode"
                       title="Scrub the program — poses the machine model, nothing moves"
                       @input="onScrubInput" />
        <!-- Timeline overlays, non-interactive (the Simulation tab
             navigates). ONE coordinate system — the thumb-centre travel: the
             thumb's centre runs from half its diameter to width − half
             (--range-thumb, 16px / 20px on touch — read the token, never a
             literal), and every overlay maps cum onto that span: ticks at the
             thumb's centre for their cum, bands from the centre for their
             start to the centre for their end, and the visible TRACK itself.
             The native track is transparent here (.rangeOverlayTrack,
             style.css) because it spans the input's full width, half a thumb
             past the travel at each end — against it a band either stopped
             short of the track's ends or began before its own tick (both
             operator-caught, 2026-09-12/13). Paint order: track, swept band,
             limit extents (warn), clash extents (danger, on top), the ticks
             with their glyphs (× clash, ▲ soft limit, ● tool change), and the
             input's thumb above them all. -->
        <div class="scrubBand track" :class="{ dim: !simMode }"></div>
        <div class="scrubBand swept" :style="{ left: 'calc(var(--range-thumb) / 2)', width: `calc((100% - var(--range-thumb)) * ${sweptFrac})` }"></div>
        <div v-for="(b, i) in limitBands" :key="'lb' + i" class="scrubBand limit"
             :style="{ left: `calc(var(--range-thumb) / 2 + (100% - var(--range-thumb)) * ${b[0] / 100})`, width: `calc((100% - var(--range-thumb)) * ${(b[1] - b[0]) / 100})` }"></div>
        <div v-for="(b, i) in clashBands" :key="'cb' + i" class="scrubBand clash"
             :style="{ left: `calc(var(--range-thumb) / 2 + (100% - var(--range-thumb)) * ${b[0] / 100})`, width: `calc((100% - var(--range-thumb)) * ${(b[1] - b[0]) / 100})` }"></div>
        <div v-for="(m, i) in marks" :key="m.kind + i" class="scrubTick" :class="[m.kind, { near: m.near }]"
             :style="{ left: `calc(var(--range-thumb) / 2 + (100% - var(--range-thumb)) * ${m.pct / 100})` }">
          <span class="scrubGlyph">
            <X v-if="m.kind === 'clash'" :size="9" :stroke-width="3" />
            <Triangle v-else-if="m.kind === 'limit'" :size="9" fill="currentColor" />
            <Circle v-else :size="9" fill="currentColor" />
          </span>
        </div>
      </div>
      <!-- The time in a FIXED slot sized per program (posSlotCh): the
           timeline is the one flexible item, so it never moves. -->
      <span class="val-slot posSlot val-status mono" :class="{ muted: !simMode && !running }"
            :style="{ '--slot-w': posSlotCh + 'ch' }">{{ posText }}</span>
    </div>
  </div>
</template>

<style scoped>
/* Layout only — chrome comes from the global .overlay-card (shared with the
   viewer HUD) / .row-controls. --gap-section is the one offset every viewer
   overlay keeps from the frame. */
.scrubBar {
  /* Placed by ThreeViewer's bottom column (.viewerBottom: the findings card
     above it, the viewer's --gap-section around it). */
  position: relative;
  padding: var(--gap-tight) var(--gap-controls);
}
/* A narrow viewer: the timeline takes a row of its own (the viewer's width
   decides — fitHud's .narrowViewer —, never the content). */
.narrowViewer .scrubRow { flex-wrap: wrap; row-gap: var(--gap-tight); }
.narrowViewer .sliderWrap { order: 1; flex: 1 1 100%; }
.narrowViewer .posSlot { margin-left: auto; }
.scrubRow {
  align-items: center;
}
.sliderWrap {
  flex: 1;
  min-width: 0;
  position: relative;
  display: flex;
  align-items: center;
}
.sliderInput {
  width: 100%;
  /* The overlays map cum onto THIS input's box, so its box must be the
     wrapper's box. Browsers give every range input a 2px UA margin (Firefox
     forms.css and Chrome html.css alike); in the flex wrapper that shrank
     the slider 4px and shifted it 2px right, so the thumb's centre travelled
     10px .. width−10px against ticks at 8px .. width−8px — a tool-change
     mark at the program start sat 2px left of anywhere the thumb could go
     (operator-caught, 2026-09-13). Ranges carry no padding or border. */
  margin: 0;
  /* Above the overlays: the thumb covers the tick/band under it (it IS at
     that position) and nothing paints across the thumb. */
  position: relative;
  z-index: var(--z-raised);
}
/* Timeline overlays, all non-interactive, every one on the thumb-centre
   travel (half --range-thumb .. width − half; inline left/width — see the
   template). `track`
   is the slider's visible track (the native one is transparent on this
   slider; --range-track keeps the colour shared with every other range).
   Semantic tokens only: info = tool change / swept, warn = soft limit,
   danger = clash. */
.scrubBand {
  position: absolute;
  left: 0;
  top: 50%;
  height: 6px;                 /* the global input[type=range] track */
  transform: translateY(-50%);
  border-radius: var(--radius-sm);
  pointer-events: none;
}
.scrubBand.track { left: calc(var(--range-thumb) / 2); width: calc(100% - var(--range-thumb)); background: var(--range-track); }
.scrubBand.track.dim { opacity: var(--opacity-disabled); }   /* mirrors the disabled slider */
.scrubBand.swept { background: color-mix(in oklab, var(--info) var(--tint-heavy), transparent); }
.scrubBand.limit { background: color-mix(in oklab, var(--warn) var(--tint-heavy), transparent); }
.scrubBand.clash { background: color-mix(in oklab, var(--danger) var(--tint-edge), transparent); }
/* One tick for every mark kind (full track height); the glyph under it is
   what tells the kinds apart when the colours don't (dark theme). */
.scrubTick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-50%);
  pointer-events: none;
  /* Hairline bg-colored edge: separates adjacent ticks (time axis fuses
     rapid-crash clusters) and crisps every tick against the track. */
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--bg) 90%, transparent);
}
.scrubTick.tool  { background: var(--info);   color: var(--info-text); }
.scrubTick.limit { background: var(--warn);   color: var(--warn-text); }
.scrubTick.clash { background: var(--danger); color: var(--danger-text); }
.scrubTick.near  { opacity: var(--opacity-muted); }   /* clearance warning, never touches */
.scrubGlyph {
  position: absolute;
  top: calc(100% + 1px);
  left: 50%;
  transform: translateX(-50%);
  line-height: 0;
}
/* The time's fixed slot (--slot-w is the global .val-slot width var, bound
   inline PER PROGRAM — posSlotCh): FIXED, not min-width (2026-09-12), so
   the timeline — the one flex:1 item — keeps its edges while text changes. */
.posSlot {
  flex: 0 0 var(--slot-w);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
