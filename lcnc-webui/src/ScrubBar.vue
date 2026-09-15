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
import { computed, markRaw, onUnmounted, ref, shallowRef, watch } from "vue";
import { lineCumOf, lineRange } from "./viewer/lineIndex";
import { status, viewerGcode, viewerInit, gcodeContent, emitTelemetry } from "./lcncWs";
import { INTERP_IDLE } from "./lcnc";
import { simMode } from "./simMode";
import {
  sampleTrack, jointsForSample, buildEntryTrack,
  machineFromJoints, lineRunAround, displayLineForPoint, atTrackEnd,
  programEndLine,
  type ScrubSample,
} from "./viewer/scrubTrack";
import { createRunWatcher } from "./viewer/runWatcher";
import { trackHighlightRange, runLineState, subExecState } from "./trackHighlight";
import { specFromWire } from "./viewer/kins";
import { epochTermsFor, epochWcsList, usedWcsRowsKey, type WcsTableRow } from "./viewer/wcsEpochs";
import { twpPlaneForSample } from "./viewer/twpPlaneFrame";
import { clashTargets } from "./viewer/clashTargets";
import { toolChangeLinesFromText } from "./viewer/toolChangeScan";
import type { WcsTerms } from "./viewer/partFrame";
import type { ScrubTrack } from "./ws/bulkData";
import type { CollisionResult } from "./viewer/collision";
import { EVENT_NONE } from "./viewer/eventIndex";
import { mergedSweptFraction } from "./viewer/sweepMerge";
import { limitViolationText } from "./ws/bulkData";
import { fmtElapsed } from "./format";
import { Play, Pause, X, Triangle, Circle } from "lucide-vue-next";
import MachineBtn from "./MachineBtn.vue";
import MachineSlider from "./MachineSlider.vue";
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
  // `line` is the RAW sample line (clash tint + 3D line highlight key —
  // sub-relative numbers are self-consistent within the drawn data);
  // `displayLine` is the per-point-trust-GATED line for the text panel
  // (W3 P4) — null = suppress (untrusted / entry / end), never raw.
  // `tlo`/`tool`: the sample's tool offset + tool number (schema 8) —
  // ThreeViewer's phase 3 subtracts the offset the joints were lifted
  // with, and the marker follows the tool; null = live.
  (e: "pose", joints: (number | null)[] | null, line: number | null, cum: number | null, trk: ScrubTrack | null, displayLine: number | null, plane: number[] | null, tlo: number[] | null, tool: number | null): void;
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
// Visible whenever a track exists — during a real run the bar is a
// READ-ONLY display (all controls are dead via the existing gating): live
// playhead on the estimate axis, findings/tool marks as look-ahead.
const visible = computed(() => !!track.value);

const sPos = ref(0);          // scrub parameter (seconds on a time-based track)
const playing = ref(false);
// Continuous log-scale playback speed, ×0.1 … ×100 (Fusion-style). On a
// time-based track ×1 is REAL TIME; on the distance fallback the base pace
// is BASE_MM_S.
const speedLog = ref(0);
const speed = computed(() => Math.pow(10, speedLog.value));
const speedLabel = computed(() => {
  const s = speed.value;
  return s >= 10 ? s.toFixed(0) : s >= 1 ? s.toFixed(1) : s.toFixed(2);
});
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
  // Positional 3D highlight (review P3): address the path by track index —
  // the sample's line number may be sub/remap-relative and collide.
  trackHighlightRange.value = lineRunAround(t, _sample.index);
}

/** ---------- explicit mode entry / exit ---------- */
// Live-joint baseline at entry: real machine motion while simulating (only
// possible from outside this tab — its own controls are gated) exits the
// mode. 0.05 units/degrees: above servo dither, below any deliberate move.
let _baseJoints: number[] = [];
const MOTION_EXIT_THRESHOLD = 0.05;

function _wcs() {
  const d = st.value;
  // tool_offset is the LIVE applied offset — since schema 8 the fallback
  // for segments before the program's first G43/M6 row (jointsForSample /
  // the entry inverse resolve each segment's own offset from the track's
  // tloEvents through it), so derived joints stay TRUE joint-space.
  return {
    g5x: d.g5x_offset ?? [], g92: d.g92_offset ?? [],
    rotationDeg: d.rotation_xy ?? 0, tool: d.tool_offset ?? [],
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
  trackHighlightRange.value = null;
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
  return `${(d.g5x_offset ?? []).join()},${(d.g92_offset ?? []).join()},${d.rotation_xy ?? 0},${(d.tool_offset ?? []).join()},${table}`;
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
  trackHighlightRange.value = null;
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
  return `${pct.value}%`;
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
    // Frozen playhead, no highlight — the machine is somewhere the program
    // never goes (toolchange park); pretending otherwise is the old bug.
    // The published state is SUPPRESS, never null: null would let App.vue
    // fall back to motion_line's colliding sub numbers.
    trackHighlightRange.value = null;
    // offPath (W5) lets resolveCurrentLine apply the text-trusted
    // motion_line rescue (the approach executing a real main line).
    runLineState.value = { line: 0, trusted: false, subName: null, offPath: true };
    subExecState.value = null;
    return;
  }
  if (out.cum == null) return;
  sPos.value = out.cum;
  // Positional 3D highlight: the contiguous same-line run around the
  // matched segment — contiguity disambiguates colliding line numbers.
  trackHighlightRange.value = lineRunAround(t, out.index!);
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
  if (!r && !simMode.value) { trackHighlightRange.value = null; subExecState.value = null; }
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
const lineSlotCh = computed(() => {
  const maxLine = Math.max(track.value?.lineIndex.maxLine ?? 0, 1);
  return Math.max(5, 1 + String(maxLine).length + 2);
});

/** ---------- collision results (stage 3) ---------- */
// Loaded-tool note for the sweep (see the row-2 comment). Dims are the
// DISPLAYED marker dims ThreeViewer feeds the sweep (props from _pv).
const sweepToolText = computed(() => {
  const pt = props.sweepTool?.programTools;
  if (pt?.length) {
    return "sweep: program tools " + pt.map(t => `T${t.num} Ø${t.diam.toFixed(1)}`).join(" · ");
  }
  const n = props.sweepTool?.num;
  if (n == null || n <= 0) return "sweep: no tool loaded — 6 mm stub";
  const d = props.sweepTool?.diam;
  return `sweep: T${n}${d != null && d > 0 ? ` Ø${d.toFixed(1)}` : ""}`;
});
const sweepToolTitle = computed(() => {
  if (props.sweepTool?.programTools?.length) {
    return "The collision sweep poses each segment with the tool the program has active there (dims from the parse-time tool table); segments before the first M6 use the loaded tool";
  }
  const n = props.sweepTool?.num;
  return (n == null || n <= 0)
    ? "The collision sweep checks a 6 mm × 60 mm stub cylinder because no tool is loaded — load the program's tool for a real check (the program's T sequence is not consulted yet)"
    : "The collision sweep checks the LOADED tool's table dimensions for the whole program — the program's own tool changes are not consulted yet";
});
// Sweep progress is drawn ON THE TIMELINE (the swept band, sweptFrac below)
// so a scrub shows which section is already checked, and the clashes found
// so far show as the sweep finds them (collisionPartial). There is no
// button (2026-09-13): sweeps are open-ended, pause on camera interaction
// and hidden tabs, park on a rotary jog and resume by themselves; a sweep is
// only dropped by a superseding change (program, touch-off, tool).
const stoppedTitle = computed(() => {
  const st = props.collisionStopped;
  if (!st) return "";
  return `The collision check is parked at ${pctOf(st.covered)} of the program — a rotary axis moved. It continues by itself once the pose settles and the preview is unchanged; the rest is UNCHECKED until then.`;
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
const violationsTotal = computed(() => viewerGcode.value?.violations_total ?? 0);
const linearUnit = computed(() => (viewerGcode.value?.stats?.unit as string) ?? "mm");
const violationsTitle = computed(() => {
  const list = violations.value ?? [];
  if (!list.length) return "";
  const shown = list.slice(0, 8).map(v => `L${v.line}: ${limitViolationText(v, linearUnit.value)}`).join("\n");
  const more = violationsTotal.value > 8 ? `\n… ${violationsTotal.value - 8} more` : "";
  // The violations are real either way — only their L-numbers index a
  // called file when the attribution is untrusted, and the reader must
  // know that before chasing the wrong line.
  const caveat = viewerGcode.value?.lines_untrusted
    ? "\n(line numbers index a called sub/remap file, not this program)" : "";
  return `Soft-limit violations\n${shown}${more}${caveat}`;
});

/** ---------- position-aware finding navigation ---------- */
// Targets are timeline positions; prev/next are relative to the CURRENT
// scrub position, so scrubbing anywhere re-anchors the navigation. Both
// wrap around at the ends.
interface FindingTarget { cum: number; line: number; rapid?: boolean; dist?: number; spanEndLine?: number; reentry?: boolean }
const NAV_EPS = 0.01;

const violationTargets = computed<FindingTarget[]>(() => {
  const t = track.value;
  if (!t) return [];
  const seen = new Set<number>();
  const out: FindingTarget[] = [];
  for (const v of violations.value ?? []) {
    if (seen.has(v.line)) continue;
    seen.add(v.line);
    const cum = lineCumOf(t.lineIndex, v.line);
    if (cum !== undefined) out.push({ cum, line: v.line });
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
const hitTargets = computed<FindingTarget[]>(() => clashTargets(hits.value));

function targetAfter(list: FindingTarget[], s: number): FindingTarget | null {
  if (!list.length) return null;
  return list.find(f => f.cum > s + NAV_EPS) ?? list[0]!;   // wrap to first
}
function targetBefore(list: FindingTarget[], s: number): FindingTarget | null {
  if (!list.length) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.cum < s - NAV_EPS) return list[i]!;
  }
  return list[list.length - 1]!;                             // wrap to last
}

const nextViolationT = computed(() => targetAfter(violationTargets.value, sPos.value));
const nextHitT = computed(() => targetAfter(hitTargets.value, sPos.value));

function jumpTo(target: FindingTarget | null) {
  if (!target || !enterSim()) return;
  playing.value = false;
  // Nudge a hair PAST the target: a cum sitting exactly on a segment
  // boundary samples the previous segment's line label, which would show
  // the wrong line and suppress the contact tint right at the jump point.
  sPos.value = Math.min(cumMax.value, Math.max(0, target.cum + 1e-3));
  applyPos();
}

// Tool-change events on the timeline + the next-tool countdown (ahead of
// the current position, NON-wrapping — a past change is not "next").
// Canon M6 events from the wire PLUS the text's M6 / M600 / M601 lines: a
// preview-skipped remap contributes no canon event ("T13 M600" had no mark
// — operator-caught on perfmatrix). Union by line, the wire's tool wins.
// The scan is per program text (cached), not per track.
const textToolLines = computed(() => toolChangeLinesFromText(gcodeContent.value));
// A tool-change line has no motion of its own: its timeline position is the
// first point of the next line that has one.
function cumAtOrAfterLine(t: ScrubTrack, line: number): number | undefined {
  for (let l = line; l <= t.lineIndex.maxLine; l++) {
    const c = lineCumOf(t.lineIndex, l);
    if (c !== undefined) return c;
  }
  return undefined;
}
const toolTargets = computed(() => {
  const t = track.value;
  const out: Array<{ cum: number; line: number; tool: number }> = [];
  if (!t) return out;
  const byLine = new Map<number, number>();
  for (const [line, tool] of viewerGcode.value?.tool_change_lines ?? []) byLine.set(line, tool);
  for (const [line, tool] of textToolLines.value) if (!byLine.has(line)) byLine.set(line, tool);
  for (const [line, tool] of byLine) {
    const cum = cumAtOrAfterLine(t, line);
    if (cum !== undefined) out.push({ cum, line, tool });
  }
  return out.sort((a, b) => a.cum - b.cum);
});
const nextTool = computed(() =>
  toolTargets.value.find(x => x.cum > sPos.value + NAV_EPS) ?? null,
);
const nextToolLabel = computed(() => {
  const nt = nextTool.value;
  if (!nt) return "";
  const dist = track.value?.timeBased
    ? `in ${fmtElapsed(Math.floor(nt.cum - sPos.value))}`
    : `L${nt.line}`;
  return `T${nt.tool || "?"} ${dist}`;   // 0 = no T word found (text-scanned line)
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
  const t = track.value, max = cumMax.value;
  const spans: Array<[number, number]> = [];
  if (!t || max <= 0) return spans;
  const seen = new Set<number>();
  for (const v of violations.value ?? []) {
    if (seen.has(v.line)) continue;
    seen.add(v.line);
    const start = lineCumOf(t.lineIndex, v.line);
    const range = lineRange(t.lineIndex, v.line);
    if (start === undefined || !range) continue;
    const end = t.cum[range.end] ?? start;
    if (end > start) spans.push([(start / max) * 100, (end / max) * 100]);
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
</script>

<template>
  <div v-if="visible" class="scrubBar overlay-card stack-tight">
    <!-- Row 1 — timeline + play/pause + the position readouts -->
    <div class="row-controls scrubRow">
      <!-- Sim mode toggle — same switch as settings/coolant toggles. The
           parent-authoritative model snaps it back if entry is refused. -->
      <MachineToggle gate="simToggle" v-model="simToggleModel" label="Sim"
                     :disabled="!simMode && !machineOff"
                     help="Simulation poses the 3D model along the program instead of the live machine. Requires the machine to be OFF; while active, all machine controls are locked until you switch back." />

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
        <!-- Timeline overlays, non-interactive (row 2 navigates). ONE
             coordinate system — the thumb-centre travel: the thumb's centre
             runs from half its diameter to width − half (--range-thumb,
             16px / 20px on touch — read the token, never a literal), and
             every overlay maps cum
             onto that span: ticks at the thumb's centre for their cum, bands
             from the centre for their start to the centre for their end, and
             the visible TRACK itself. The native track is transparent here
             (.rangeOverlayTrack, style.css) because it spans the input's
             full width, half a thumb past the travel at each end — against it a
             band either stopped short of the track's ends or began before
             its own tick (both operator-caught, 2026-09-12/13). Now a clash's
             red starts exactly at its × and an extent to program end reaches
             the track's end. Paint order: track, swept band, limit extents
             (warn), clash extents (danger, on top), the ticks with their
             glyphs (× clash, ▲ soft limit, ● tool change), and the input's
             thumb above them all. -->
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
      <MachineSlider gate="simSpeed" class="speedSlider" :min="-1" :max="2" :step="0.01"
                     v-model="speedLog" :disabled="!simMode"
                     :title="`Playback speed ×0.1–×100${track?.timeBased ? ' of real time' : ''}`" />
      <MachineBtn type="scrub" class="speedVal" :disabled="!simMode"
                  title="Reset playback speed to ×1" @click="speedLog = 0">
        &times;{{ speedLabel }}
      </MachineBtn>
      <!-- Fixed slots sized per program (see lineSlotCh / posSlotCh): line /
           sub readout, then the timer. "off path" during a run lives in the
           line slot, warn-tinted. -->
      <span class="val-slot lineSlot val-status mono" :class="{ muted: !simMode && !running, warn: lineOffPath }"
            :style="{ '--slot-w': lineSlotCh + 'ch' }" :title="lineTitle">{{ lineText }}</span>
      <span class="val-slot posSlot val-status mono" :class="{ muted: !simMode && !running }"
            :style="{ '--slot-w': posSlotCh + 'ch' }">{{ posText }}</span>
    </div>

    <!-- Row 2 — findings navigation (prev/next, anchored to the CURRENT
         timeline position). Buttons keep CONSTANT labels and every
         variable-width readout sits AFTER the last button of its group, so
         click positions never shift while stepping through or while a sweep
         changes state. Wrappers carry tooltips (WebKit doesn't hover
         disabled buttons). The sweep itself has no control here (2026-09-13):
         its progress is the timeline's swept band. -->
    <div class="row-controls scrubRow">
      <template v-if="violations && violations.length">
        <span class="btnTip" title="Previous soft-limit violation (from the current timeline position)">
          <MachineBtn type="scrub" variant="warn" :disabled="!violationTargets.length || (!simMode && !machineOff)"
                      @click="jumpTo(targetBefore(violationTargets, sPos))">&#9664;</MachineBtn>
        </span>
        <span class="btnTip" :title="violationsTitle">
          <MachineBtn type="scrub" variant="warn" :disabled="!violationTargets.length || (!simMode && !machineOff)"
                      @click="jumpTo(nextViolationT)">
            {{ violationsTotal }} limit{{ violationsTotal === 1 ? "" : "s" }}
          </MachineBtn>
        </span>
        <span class="btnTip" title="Next soft-limit violation">
          <MachineBtn type="scrub" variant="warn" :disabled="!violationTargets.length || (!simMode && !machineOff)"
                      @click="jumpTo(targetAfter(violationTargets, sPos))">&#9654;</MachineBtn>
        </span>
        <span class="navTarget val-status mono">{{ nextViolationT ? "→ L" + nextViolationT.line : "" }}</span>
        <div class="sep-v"></div>
      </template>

      <!-- Verdict (2026-09-12): the timeline band says how much was swept;
           this says what it found — LIVE while the sweep runs ("so far",
           from the unrefined partial). Parked/truncated with no hits is "no
           clash in N % swept" — never "clear" for a part-swept program. -->
      <template v-if="shownResult">
        <span v-if="shownResult.pairCount === 0" class="val-status muted" title="No body pair moves relative to another — nothing to check">no moving pairs</span>
        <template v-else-if="hits.length">
          <span class="btnTip" title="Previous collision (from the current timeline position)">
            <MachineBtn type="scrub" variant="danger" :disabled="!simMode && !machineOff"
                        @click="jumpTo(targetBefore(hitTargets, sPos))">&#9664;</MachineBtn>
          </span>
          <span class="btnTip"
                :title="`Collision hits — click to simulate the next one${!simMode && !machineOff ? ' (turn the machine OFF first)' : ''}${shownResult.staticContacts.length ? `\nIn contact from the start (excluded): ${shownResult.staticContacts.map(c => c.a + '/' + c.b).join(', ')}` : ''}`">
            <MachineBtn type="scrub" variant="danger" :disabled="!simMode && !machineOff"
                        @click="jumpTo(nextHitT)">
              {{ hitTargets.length }} clash{{ hitTargets.length === 1 ? "" : "es" }}
            </MachineBtn>
          </span>
          <span class="btnTip" title="Next collision">
            <MachineBtn type="scrub" variant="danger" :disabled="!simMode && !machineOff"
                        @click="jumpTo(targetAfter(hitTargets, sPos))">&#9654;</MachineBtn>
          </span>
          <span class="navTarget val-status mono">{{ nextHitT ? "→ " + (nextHitT.line ? "L" + nextHitT.line : "entry") + (nextHitT.reentry ? " (re-entry)" : "") + (nextHitT.rapid ? " (rapid)" : "") + ((nextHitT.dist ?? 0) > 0.001 ? ` ~${nextHitT.dist!.toFixed(1)}mm` : "") + ((nextHitT.spanEndLine ?? nextHitT.line) > nextHitT.line ? ` … through L${nextHitT.spanEndLine}` : "") : "" }}</span>
          <span v-if="collisionBusy" class="val-status muted" title="The collision check is still running — positions refine when it ends">so far</span>
          <span v-else-if="collisionStopped && collisionResumable" class="val-status warn" :title="stoppedTitle">in {{ pctOf(collisionStopped.covered) }} swept</span>
        </template>
        <span v-else-if="collisionBusy" class="val-status muted" title="The collision check is still running">no clash so far</span>
        <span v-else-if="collisionStopped && collisionResumable" class="val-status warn" :title="stoppedTitle">
          no clash in {{ pctOf(collisionStopped.covered) }} swept
        </span>
        <span v-else-if="shownResult.truncated" class="val-status warn"
              :title="`No clash in the ${pctOf(shownResult.truncated.covered)} of the ${routeWord} swept (${shownResult.truncated.reason === 'samples' ? 'sample backstop' : shownResult.truncated.reason}) — the rest is UNCHECKED (${shownResult.samples} samples, ${shownResult.pairCount} pairs)`">
          no clash in {{ pctOf(shownResult.truncated.covered) }} swept
        </span>
        <span v-else class="val-status ok" :title="`${shownResult.samples} samples, ${shownResult.pairCount} pairs${shownResult.staticContacts.length ? `; in contact from the start (excluded): ${shownResult.staticContacts.map(c => c.a + '/' + c.b).join(', ')}` : ''}`">
          clear
        </span>
        <!-- Shown on BOTH branches: a sweep that found clashes is no more
             certified than one that found none, so the caveat cannot live
             only next to "clear". -->
        <span v-if="sweepCaveat" class="val-status warn" :title="sweepCaveat">*</span>
      </template>

      <template v-if="nextTool">
        <div class="sep-v"></div>
        <span class="val-status mono toolNext"
              :title="`Next tool change ahead of the ${running ? 'machine' : 'scrub'} position (estimate axis)`">
          {{ nextToolLabel }}
        </span>
      </template>
      <!-- What the sweep is checking WITH (user decision 2026-08-30): the
           LOADED tool's table row, or a stub when nothing is loaded. Per-line
           tool dims from the program's T sequence are on the schema-8 TLO
           ledger — until then this is said, not implied. -->
      <span class="val-status muted sweepTool" :title="sweepToolTitle">{{ sweepToolText }}</span>
    </div>
  </div>
</template>

<style scoped>
/* Layout only — chrome comes from the global .overlay-card (shared with the
   viewer HUD) / .row-controls. --gap-section is the one offset every viewer
   overlay keeps from the frame. */
.scrubBar {
  position: absolute;
  left: var(--gap-section);
  right: var(--gap-section);
  bottom: var(--gap-section);
  z-index: 10;
  padding: var(--gap-tight) var(--gap-controls);
}
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
  z-index: 1;
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
.scrubBand.swept { background: color-mix(in oklab, var(--info) 40%, transparent); }
.scrubBand.limit { background: color-mix(in oklab, var(--warn) 45%, transparent); }
.scrubBand.clash { background: color-mix(in oklab, var(--danger) 55%, transparent); }
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
.scrubTick.tool  { background: var(--info);   color: var(--info); }
.scrubTick.limit { background: var(--warn);   color: var(--warn); }
.scrubTick.clash { background: var(--danger); color: var(--danger); }
.scrubTick.near  { opacity: var(--opacity-muted); }   /* clearance warning, never touches */
.scrubGlyph {
  position: absolute;
  top: calc(100% + 1px);
  left: 50%;
  transform: translateX(-50%);
  line-height: 0;
}
.speedSlider {
  width: 72px;
  flex-shrink: 0;
}
.speedVal {
  width: 6ch;   /* fixed: ×0.1 … ×100 all fit; a min-width still let it grow */
  white-space: nowrap;
}
.toolNext {
  white-space: nowrap;
  color: var(--info);
}
/* Row-1 fixed slots (--slot-w is the global .val-slot width var, bound
   inline PER PROGRAM — lineSlotCh / posSlotCh). Every content-sized sibling
   of the timeline gets a fixed slot, so the slider — the one flex:1 item —
   keeps its edges while text changes. FIXED, not min-width (2026-09-12): a
   floor let "L1234 (sub_name) →" grow the slot and the ellipsis never
   engaged — every extra character came out of the timeline. */
.lineSlot, .posSlot {
  flex: 0 0 var(--slot-w);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sweepTool { white-space: nowrap; margin-left: auto; }
/* Row 2 keeps its height whether or not it has findings: the bar is
   bottom-anchored, so a row that came and went with each auto-sweep pushed
   the timeline up and down. */
.scrubRow + .scrubRow { min-height: var(--touch-target-compact); }
/* Moving next-target readout — fixed floor so row width stays stable. */
.navTarget {
  white-space: nowrap;
  min-width: 9ch;
  text-align: left;
}
/* .btnTip (tooltip wrapper for a disabled button) is global now — style.css (U-06). */
</style>
