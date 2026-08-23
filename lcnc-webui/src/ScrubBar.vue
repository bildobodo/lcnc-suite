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
import { computed, onUnmounted, ref, watch } from "vue";
import { status, viewerGcode, viewerInit, emitTelemetry } from "./lcncWs";
import { INTERP_IDLE } from "./lcnc";
import { simMode } from "./simMode";
import {
  sampleTrack, jointsForSample, machineJointsToProgram, prependEntry,
  machineFromJoints, lineRunAround,
  type ScrubSample,
} from "./viewer/scrubTrack";
import { createRunWatcher } from "./viewer/runWatcher";
import { trackHighlightRange, runLineState } from "./trackHighlight";
import { specFromWire } from "./viewer/kins";
import { epochTermsFor, usedWcsRowsKey, type WcsTableRow } from "./viewer/wcsEpochs";
import type { WcsTerms } from "./viewer/partFrame";
import type { ScrubTrack } from "./ws/bulkData";
import type { CollisionResult } from "./viewer/collision";
import { limitViolationText } from "./ws/bulkData";
import { fmtElapsed } from "./format";
import { Play, Pause } from "lucide-vue-next";
import MachineBtn from "./MachineBtn.vue";
import MachineSlider from "./MachineSlider.vue";
import MachineToggle from "./MachineToggle.vue";

const props = defineProps<{
  // Collision sweep state, owned by ThreeViewer (it holds the machine def
  // and geometries); this bar is the control surface + scrub-to-hit.
  collisionBusy: boolean;
  collisionProgress: number;
  collisionResult: CollisionResult | null;
  // The exact track the current result was swept on. Hit cums only mean
  // anything on THAT track — entering sim swaps in the entry-extended track
  // (every cum shifts by the entry duration), so the clash UI trusts results
  // only when this matches the displayed track (auto re-check covers the gap).
  collisionTrack: ScrubTrack | null;
}>();

const emit = defineEmits<{
  // joints: per-JOINT machine values (null entry = keep live joint), or null
  // to return the model to the live pose. line/cum: sample position; trk:
  // the track the cum lives on (ThreeViewer gates the clash tint on it).
  (e: "pose", joints: (number | null)[] | null, line: number | null, cum: number | null, trk: ScrubTrack | null): void;
  // The track to sweep — includes the entry move when one is known.
  (e: "check", track: ScrubTrack): void;
  (e: "cancel-check"): void;
}>();

const st = computed<Record<string, any>>(() => status.value?.data ?? {});
const baseTrack = computed(() => viewerGcode.value?.scrubTrack ?? null);
// Base track + the ENTRY MOVE (live machine position → program first point),
// captured at sim entry — run-time-only motion no parse can know. Kept after
// exit so marks/results stay consistent; rebuilt on each entry.
const entryTrack = ref<ScrubTrack | null>(null);
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
const pct = computed(() => (cumMax.value > 0 ? Math.round((sPos.value / cumMax.value) * 100) : 0));

// Reused per-frame scratch — the sPos watcher runs at animation rate.
const _sample: ScrubSample = { px: 0, py: 0, pz: 0, pa: 0, pb: 0, pc: 0, line: 0, rapid: false, kinstype: null, frame: null, wcsEpoch: null, index: 0 };
const _joints: (number | null)[] = [];
// Wire kins declaration → spec, cached: specFromWire allocates, and this
// feeds the per-frame pose path — recompute only when viewer_init changes.
const _kinsSpec = computed(() => specFromWire(viewerInit.value?.kins));

/** Per-epoch WCS re-add terms (review P2): the pose, the entry inverse and
 *  the run playhead all convert program coords through the segment's OWN
 *  epoch basis (live table row / rewritten snapshot). undefined = legacy
 *  single-basis track. */
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
  // Per-point trust + sub name for the sim readout (W2 P6): the sample's
  // upper track index addresses the wire trust channels directly.
  curLineOk.value = t.lineOk ? t.lineOk[_sample.index] === 1 : null;
  const _sb = t.sub?.[_sample.index];
  curSubName.value = (_sb != null && _sb !== 0xff && t.subNames)
    ? t.subNames[_sb] ?? null : null;
  jointsForSample(_sample, _wcs(), viewerInit.value?.axes ?? [], _joints,
                  _kinsSpec.value, _epochTerms.value);
  emit("pose", _joints.slice(), _sample.line, sPos.value, t);
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
  // tool_offset makes the derived joints TRUE joint-space (G43-inclusive)
  // — required so applyState phase 3's marker shift lands the tip on the
  // path, and so entry capture inverts TLO-inclusive live joints.
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
  // Entry labeling (W3 P3): the entry converts the live JOINTS into the
  // frame of the track's FIRST SEGMENT — its mode, its TWP frame, its
  // epoch-0 terms — one consistent triple. Joints are the physical
  // invariant; kins maps are labelings: forwarding the joints under the
  // track's own labeling names the live pose in exactly the coordinates
  // vertex 0 uses, so `jointsForSample(entry)` round-trips to the live
  // joints BY CONSTRUCTION (matching the mode[0]/frame[0]/wcsEpoch[0]
  // stamps prependEntry writes on the entry segment). The previous code
  // mixed the LIVE kins pin + live plane pins with epoch-0 terms: parked
  // in identity after g69 on a TWP program, the live-identity forward +
  // plane-frame peel landed the entry start ~(G59−G54) ≈ 900 mm off.
  // The machine's parked STATE is irrelevant to naming its pose — a
  // machine parked in type 2 converts correctly under the track's
  // labeling too. Live pin only as legacy fallback (track without mode
  // data); no pin AND no mode = untracked → identity, never guessed.
  const ktEntry = base.mode?.[0] ?? st.value.kins_type ?? null;
  const f0 = base.frame?.[0];
  const frameEntry =
    (f0 != null && f0 !== 0xff && base.frames) ? base.frames[f0] ?? null : null;
  // Epoch-0 terms (review P2): the entry lands on the track's FIRST point,
  // whose coords live in epoch 0's frame — not necessarily the live active
  // fixture's (a TWP program's first point is already in the plane frame).
  const entryTerms = _epochTerms.value?.[base.wcsEpoch?.[0] ?? 0];
  const entry = machineJointsToProgram(_baseJoints, viewerInit.value?.axes ?? [], _wcs(),
                                       _kinsSpec.value, ktEntry, frameEntry, entryTerms);
  const g = viewerGcode.value;
  const t = prependEntry(base, entry, { linear: g?.rapid_rate, rotary: g?.rot_rapid_rate });
  entryTrack.value = t === base ? null : t;
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
  // Fresh entry position → fresh baseline: cancel any in-flight sweep (its
  // result would be for the WRONG track) and re-run on the entry track.
  if (track.value) {
    emit("cancel-check");
    emit("check", track.value);
  }
  return true;
}

function exitSim() {
  playing.value = false;
  if (!simMode.value) return;
  simMode.value = false;
  emit("pose", null, null, null, null);
  trackHighlightRange.value = null;
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
        emit("check", track.value);
      }
    }, 500);
  }
});

// Auto-exits: execution starts, program changes, machine powered on
// (another client — this tab's Machine On is gated), or real joint motion.
// Keyed on the BASE track — entering sim swaps in the entry track, which
// must not itself trigger an exit.
watch(running, (r) => { if (r) exitSim(); });
watch(baseTrack, () => {
  exitSim(); entryTrack.value = null; sPos.value = 0;
  _runWatcher.reset(); runOffPath.value = false; runLineState.value = null;
  trackHighlightRange.value = null;
});
watch(machineOff, (off) => { if (!off) exitSim(); });
watch(st, (d) => {
  if (!simMode.value) return;
  const jp = d.joint_pos;
  if (!Array.isArray(jp)) return;
  for (let i = 0; i < jp.length; i++) {
    const base = _baseJoints[i];
    if (base != null && Math.abs((jp[i] ?? 0) - base) > MOTION_EXIT_THRESHOLD) {
      exitSim();
      return;
    }
  }
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
  const span = line ? t.lineSpan.get(line) : undefined;
  // Forward kins for the live joints: the machine's ACTUAL switchkins pin
  // and plane frame when sampled — same authority as the joints being
  // inverted; the hint span's (or track-start) segment mode stands in.
  const ktLive = d.kins_type;
  const ktNow = ktLive != null ? ktLive : (t.mode?.[span?.end ?? 0] ?? null);
  const fN = t.frame?.[span?.end ?? 0];
  const frameNow = liveKinsFrame()
    ?? ((fN != null && fN !== 0xff && t.frames) ? t.frames[fN] ?? null : null);
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
    runLineState.value = { line: 0, trusted: false, subName: null };
    return;
  }
  if (out.cum == null) return;
  sPos.value = out.cum;
  // Positional 3D highlight: the contiguous same-line run around the
  // matched segment — contiguity disambiguates colliding line numbers.
  trackHighlightRange.value = lineRunAround(t, out.index!);
  // Text-panel line state (W2 P6): per-point trust from the wire when the
  // track carries it; legacy tracks fall back to the wholesale flag.
  const i = out.index!;
  const pointTrusted = t.lineOk ? t.lineOk[i] === 1 : trusted;
  const sb = t.sub?.[i];
  runLineState.value = {
    line: t.lines[i]!,
    trusted: pointTrusted && t.lines[i]! > 0,
    subName: (sb != null && sb !== 0xff && t.subNames) ? t.subNames[sb] ?? null : null,
  };
});
watch(running, (r) => {
  _runWatcher.reset();
  runOffPath.value = false;
  if (!r) runLineState.value = null;
  if (!r && !simMode.value) trackHighlightRange.value = null;
});

const statusText = computed(() => {
  // Per-point trust (W2 P6) labels the readout; a point inside a marked
  // sub shows the sub's NAME instead of a colliding line number. Legacy
  // tracks (no per-point channel) fall back to the wholesale flag.
  const trusted = !viewerGcode.value?.lines_untrusted;
  if (simMode.value) {
    const ok = curLineOk.value ?? trusted;
    const label = !curLine.value ? "entry"
      : ok ? `L${curLine.value}`
      : curSubName.value ? `(${curSubName.value})` : "···";
    return `${label}${curRapid.value ? " →" : ""} ${posLabel.value}`;
  }
  // "~": the run readout is the ESTIMATE clock (parse-time feeds/rapids) —
  // feed override, accel and dwells make real elapsed differ (GcodePanel
  // shows the wall clock).
  if (running.value) {
    const rls = runLineState.value;
    const label = rls
      ? (rls.trusted ? `L${rls.line}`
        : rls.subName ? `(${rls.subName})` : "···")
      : trusted ? `L${motionLine.value ?? 0}` : "···";
    return `${label} ~${posLabel.value}`;
  }
  return "live";
});

/** ---------- collision results (stage 3) ---------- */
const checkLabel = computed(() => {
  if (props.collisionBusy) return `${Math.round(props.collisionProgress * 100)}%`;
  return "Check";
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
interface FindingTarget { cum: number; line: number; rapid?: boolean; dist?: number }
const NAV_EPS = 0.01;

const violationTargets = computed<FindingTarget[]>(() => {
  const t = track.value;
  if (!t) return [];
  const seen = new Set<number>();
  const out: FindingTarget[] = [];
  for (const v of violations.value ?? []) {
    if (seen.has(v.line)) continue;
    seen.add(v.line);
    const cum = t.lineCum.get(v.line);
    if (cum !== undefined) out.push({ cum, line: v.line });
  }
  return out.sort((a, b) => a.cum - b.cum);
});

// Hits are already cum-sorted by the sweep — but only trusted when they
// were swept on the DISPLAYED track (see collisionTrack prop).
const resultCurrent = computed(() => props.collisionTrack === track.value);
const hits = computed(() => (resultCurrent.value ? props.collisionResult?.hits ?? [] : []));
// Reasons this sweep's no-missed-crossing guarantee does NOT hold. Null when
// it does. Both cases mean the same thing to an operator — the result is a
// sample, not a proof — so they share one marker rather than hiding one of
// them next to a green "clear".
const sweepCaveat = computed<string | null>(() => {
  const r = resultCurrent.value ? props.collisionResult : null;
  if (!r) return null;
  const why: string[] = [];
  if (r.uncertified) why.push(r.uncertified);
  if (r.coarsened) why.push("coarsened to fit the sample budget");
  return why.length ? `Clearance guarantee not certified for this sweep: ${why.join("; ")}` : null;
});
// One navigation target per contact ONSET: an intermittent-contact line
// (enter → exit → re-enter) yields a target per interval, so the re-entry
// is a real "next clash" stop, not folded invisibly into the first.
const hitTargets = computed<FindingTarget[]>(() =>
  hits.value
    .flatMap(h => (h.intervals ?? [[h.cum, h.cumEnd] as [number, number]])
      .map(iv => ({ cum: iv[0], line: h.line, rapid: h.rapid, dist: h.dist })))
    .sort((a, b) => a.cum - b.cum));

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

// Timeline positions of the hits, as track percentages. `near` = within the
// margin but never touching (clearance warning, not a contact).
const hitMarks = computed(() =>
  cumMax.value > 0
    ? hitTargets.value.map(t => ({ pct: Math.min(100, (t.cum / cumMax.value) * 100), rapid: t.rapid ?? false, near: (t.dist ?? 0) > 1e-3 }))
    : [],
);

// Tool-change events on the timeline + the next-tool countdown (ahead of
// the current position, NON-wrapping — a past change is not "next").
const toolTargets = computed(() => {
  const t = track.value;
  if (!t) return [] as Array<{ cum: number; line: number; tool: number }>;
  const out: Array<{ cum: number; line: number; tool: number }> = [];
  for (const [line, tool] of viewerGcode.value?.tool_change_lines ?? []) {
    const cum = t.lineCum.get(line);
    if (cum !== undefined) out.push({ cum, line, tool });
  }
  return out.sort((a, b) => a.cum - b.cum);
});
const toolChangeMarks = computed(() =>
  cumMax.value > 0 ? toolTargets.value.map(x => Math.min(100, (x.cum / cumMax.value) * 100)) : [],
);
const nextTool = computed(() =>
  toolTargets.value.find(x => x.cum > sPos.value + NAV_EPS) ?? null,
);
const nextToolLabel = computed(() => {
  const nt = nextTool.value;
  if (!nt) return "";
  const dist = track.value?.timeBased
    ? `in ${fmtElapsed(Math.floor(nt.cum - sPos.value))}`
    : `L${nt.line}`;
  return `T${nt.tool} ${dist}`;
});

// Soft-limit violations (stage 1) on the same timeline, warn-tinted —
// line-anchored via the track's lineCum map. A violating line the track
// doesn't know (comment-line attribution edge) simply has no mark; the
// GcodePanel banner still lists it.
const violationMarks = computed(() => {
  const t = track.value;
  if (!t || cumMax.value <= 0) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of viewerGcode.value?.violations ?? []) {
    if (seen.has(v.line)) continue;
    seen.add(v.line);
    const cum = t.lineCum.get(v.line);
    if (cum !== undefined) out.push(Math.min(100, (cum / cumMax.value) * 100));
  }
  return out;
});

onUnmounted(() => {
  cancelAnimationFrame(raf);
  clearTimeout(_wcsCheckTimer);
  exitSim();
});
</script>

<template>
  <div v-if="visible" class="scrubBar bordered-panel stack-tight">
    <!-- Row 1 — timeline + playback -->
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
        <MachineSlider gate="scrubPos" class="sliderInput" :min="0" :max="cumMax"
                       :step="cumMax / 2000 || 1" v-model="sPos" :disabled="!simMode"
                       title="Scrub the program — poses the machine model, nothing moves" />
        <!-- Timeline markers, non-interactive (row 2 navigates): info =
             tool change, warn = soft-limit violation, danger = collision
             hit (full-height = rapid contact). -->
        <!-- Marks live in the THUMB-TRAVEL span (input width − 16px thumb,
             inset 8px each side) so ticks align with where the thumb can
             actually sit — full-width percentages drift near the ends. -->
        <div v-for="(p, i) in toolChangeMarks" :key="'t' + i" class="scrubMark tool"
             :style="{ left: `calc(8px + (100% - 16px) * ${p / 100})` }"></div>
        <div v-for="(p, i) in violationMarks" :key="'v' + i" class="scrubMark limit"
             :style="{ left: `calc(8px + (100% - 16px) * ${p / 100})` }"></div>
        <div v-for="(m, i) in hitMarks" :key="'c' + i" class="scrubMark"
             :class="{ rapid: m.rapid, near: m.near }" :style="{ left: `calc(8px + (100% - 16px) * ${m.pct / 100})` }"></div>
      </div>
      <MachineSlider gate="simSpeed" class="speedSlider" :min="-1" :max="2" :step="0.01"
                     v-model="speedLog" :disabled="!simMode"
                     :title="`Playback speed ×0.1–×100${track?.timeBased ? ' of real time' : ''}`" />
      <MachineBtn type="scrub" class="speedVal" :disabled="!simMode"
                  title="Reset playback speed to ×1" @click="speedLog = 0">
        &times;{{ speedLabel }}
      </MachineBtn>
      <!-- Mode identity chip (redundant with banner/gating — text channel). -->
      <span v-if="running" class="val-status ok" title="Program executing — the playhead follows the machine; timeline controls are locked">RUNNING</span>
      <span v-if="running && runOffPath" class="val-status warn"
        title="The machine is somewhere the program's path never goes (e.g. a toolchange park) — the playhead is frozen until it returns">off path</span>
      <span class="scrubStatus val-status mono" :class="{ muted: !simMode && !running }">
        {{ statusText }}
      </span>
    </div>

    <!-- Row 2 — findings navigation (prev/next, anchored to the CURRENT
         timeline position). Buttons keep CONSTANT labels — the moving
         target readout sits outside the button group so click positions
         never shift while stepping through. Wrappers carry tooltips
         (WebKit doesn't hover disabled buttons). -->
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

      <MachineBtn v-if="collisionBusy" type="scrub" title="Collision check running — click to cancel"
                  @click="emit('cancel-check')">{{ checkLabel }} &times;</MachineBtn>
      <template v-if="collisionResult && !collisionBusy && resultCurrent">
        <span v-if="collisionResult.pairCount === 0" class="val-status muted" title="No body pair moves relative to another — nothing to check">no moving pairs</span>
        <span v-else-if="!hits.length" class="val-status ok" :title="`${collisionResult.samples} samples, ${collisionResult.pairCount} pairs${collisionResult.staticContacts.length ? `; in contact from the start (excluded): ${collisionResult.staticContacts.map(c => c.a + '/' + c.b).join(', ')}` : ''}`">
          clear
        </span>
        <template v-else>
          <span class="btnTip" title="Previous collision (from the current timeline position)">
            <MachineBtn type="scrub" variant="danger" :disabled="!simMode && !machineOff"
                        @click="jumpTo(targetBefore(hitTargets, sPos))">&#9664;</MachineBtn>
          </span>
          <span class="btnTip"
                :title="`Collision hits — click to simulate the next one${!simMode && !machineOff ? ' (turn the machine OFF first)' : ''}${collisionResult.staticContacts.length ? `\nIn contact from the start (excluded): ${collisionResult.staticContacts.map(c => c.a + '/' + c.b).join(', ')}` : ''}`">
            <MachineBtn type="scrub" variant="danger" :disabled="!simMode && !machineOff"
                        @click="jumpTo(nextHitT)">
              {{ hits.length }} clash{{ hits.length === 1 ? "" : "es" }}
            </MachineBtn>
          </span>
          <span class="btnTip" title="Next collision">
            <MachineBtn type="scrub" variant="danger" :disabled="!simMode && !machineOff"
                        @click="jumpTo(targetAfter(hitTargets, sPos))">&#9654;</MachineBtn>
          </span>
          <span class="navTarget val-status mono">{{ nextHitT ? "→ " + (nextHitT.line ? "L" + nextHitT.line : "entry") + (nextHitT.rapid ? " (rapid)" : "") + ((nextHitT.dist ?? 0) > 0.001 ? ` ~${nextHitT.dist!.toFixed(1)}mm` : "") : "" }}</span>
        </template>
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
    </div>
  </div>
</template>

<style scoped>
/* Layout only — chrome comes from the global .bordered-panel / .row-controls. */
.scrubBar {
  position: absolute;
  left: var(--gap-controls);
  right: var(--gap-controls);
  bottom: var(--gap-controls);
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
}
/* Collision hit marker on the timeline — semantic danger red; rapid-contact
   hits span full height, feed contacts are the shorter center band.
   Positioned in the THUMB-TRAVEL span, not the full input width: a range
   thumb (16px) travels width−16px inset 8px each side, so un-inset marks
   drift up to 8px off the thumb toward the ends. */
.scrubMark {
  position: absolute;
  top: 25%;
  bottom: 25%;
  width: 2px;
  transform: translateX(-50%);
  background: var(--danger);
  pointer-events: none;
  /* Hairline bg-colored edge: separates adjacent ticks (time axis fuses
     rapid-crash clusters) and crisps every tick against the track. */
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--bg) 90%, transparent);
}
.scrubMark.rapid {
  top: 0;
  bottom: 0;
}
.scrubMark.limit {
  /* Full-strength warn: the hairline bg edge (above) carries the contrast
     against bright backgrounds, so the tick keeps the bright yellow. */
  background: var(--warn);
}
.scrubMark.near {
  /* Clearance warning (never touches) — muted vs a real contact tick. */
  opacity: var(--opacity-muted);
}
.scrubMark.tool {
  background: var(--info);
  top: 35%;
  bottom: 35%;
}
.speedSlider {
  width: 72px;
  flex-shrink: 0;
}
.speedVal {
  min-width: 6ch;
  white-space: nowrap;
}
.toolNext {
  white-space: nowrap;
  color: var(--info);
}
.scrubStatus {
  white-space: nowrap;
  min-width: 9ch;
}
/* Moving next-target readout — fixed floor so row width stays stable. */
.navTarget {
  white-space: nowrap;
  min-width: 9ch;
  text-align: left;
}
/* Tooltip wrapper for a disabled button — layout-neutral flex item. */
.btnTip {
  display: inline-flex;
}
</style>
