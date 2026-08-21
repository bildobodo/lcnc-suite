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
import { status, viewerGcode, viewerInit } from "./lcncWs";
import { INTERP_IDLE } from "./lcnc";
import { simMode } from "./simMode";
import {
  sampleTrack, jointsForSample, machineJointsToProgram, prependEntry,
  type ScrubSample,
} from "./viewer/scrubTrack";
import { specFromWire } from "./viewer/kins";
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
const pct = computed(() => (cumMax.value > 0 ? Math.round((sPos.value / cumMax.value) * 100) : 0));

// Reused per-frame scratch — the sPos watcher runs at animation rate.
const _sample: ScrubSample = { px: 0, py: 0, pz: 0, pa: 0, pb: 0, pc: 0, line: 0, rapid: false, kinstype: null, frame: null, index: 0 };
const _joints: (number | null)[] = [];
// Wire kins declaration → spec, cached: specFromWire allocates, and this
// feeds the per-frame pose path — recompute only when viewer_init changes.
const _kinsSpec = computed(() => specFromWire(viewerInit.value?.kins));

function applyPos() {
  const t = track.value;
  if (!t || !simMode.value) return;
  sampleTrack(t, sPos.value, _sample);
  curLine.value = _sample.line;
  curRapid.value = _sample.rapid;
  jointsForSample(_sample, _wcs(), viewerInit.value?.axes ?? [], _joints,
                  _kinsSpec.value);
  emit("pose", _joints.slice(), _sample.line, sPos.value, t);
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

function _buildEntryTrack() {
  const base = baseTrack.value;
  if (!base || !_baseJoints.length) {
    entryTrack.value = null;
    return;
  }
  // Entry inverse mode: prefer the LIVE switchkins pin (status kins_type,
  // sampled only on switchable-kins configs) — the machine may be parked
  // in world mode from a previous run while THIS program's preamble hasn't
  // executed yet, so the program's initial mode can be wrong for the live
  // joints. Fallback when the pin isn't sampled: base.mode[0].
  const kt = st.value.kins_type;
  // Entry inverse raw kinstype: prefer the LIVE switchkins pin, else the
  // track's first segment. No pin AND no mode data = untracked → identity,
  // never guessed (0 is the WORLD type on plain-sparm trt). TWP frame for
  // a type-2 entry: the kins' frame pins aren't sampled, so the track's
  // first governing frame stands in (the parked-in-TWP machine normally
  // holds the program's own frame; frameless → loud trivkins fallback in
  // kinsForSegment).
  const ktEntry = kt != null ? kt : (base.mode?.[0] ?? null);
  const f0 = base.frame?.[0];
  const frameEntry = (f0 != null && f0 !== 0xff && base.frames) ? base.frames[f0] ?? null : null;
  const entry = machineJointsToProgram(_baseJoints, viewerInit.value?.axes ?? [], _wcs(),
                                       _kinsSpec.value, ktEntry, frameEntry);
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
  return `${(d.g5x_offset ?? []).join()},${(d.g92_offset ?? []).join()},${d.rotation_xy ?? 0},${(d.tool_offset ?? []).join()}`;
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
watch(baseTrack, () => { exitSim(); entryTrack.value = null; sPos.value = 0; });
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

/** ---------- run-time display (unified timeline phase 2) ---------- */
// During a real run the playhead follows the LIVE POSITION on the estimate
// axis: the machine's program-space point is projected onto the current
// motion line's track span (6D, 1° ≙ 1 unit), so the playhead moves
// continuously through a line instead of jumping when the line completes.
// Display only: the machine drives sPos, never the reverse.
const motionLine = computed(() => st.value.motion_line as number | null | undefined);
watch(st, (d) => {
  if (!running.value || simMode.value) return;
  const t = track.value;
  const line = motionLine.value;
  if (!t || !line) return;
  const span = t.lineSpan.get(line);
  const jp = d.joint_pos;
  if (!span || !Array.isArray(jp)) {
    const c = t.lineCum.get(line);
    if (c !== undefined) sPos.value = c;
    return;
  }
  // Run-display playhead: invert live joints under the machine's ACTUAL
  // kins mode (live switchkins pin) when sampled — same authority as the
  // joints being inverted; fall back to the current line's segment mode.
  const ktLive = d.kins_type;
  const ktNow = ktLive != null ? ktLive : (t.mode?.[span.end] ?? null);
  const fN = t.frame?.[span.end];
  const frameNow = (fN != null && fN !== 0xff && t.frames) ? t.frames[fN] ?? null : null;
  const p = machineJointsToProgram(jp, viewerInit.value?.axes ?? [], _wcs(),
                                   _kinsSpec.value, ktNow, frameNow);
  let bestCum = t.cum[span.start]!;
  let bestD = Infinity;
  for (let i = Math.max(1, span.start); i <= span.end; i++) {
    const j = i * 3, k = j - 3;
    const ax = t.pos[k]!, ay = t.pos[k + 1]!, az = t.pos[k + 2]!;
    const aa = t.abc[k]!, ab = t.abc[k + 1]!, ac = t.abc[k + 2]!;
    const dx = t.pos[j]! - ax, dy = t.pos[j + 1]! - ay, dz = t.pos[j + 2]! - az;
    const da = t.abc[j]! - aa, db = t.abc[j + 1]! - ab, dc = t.abc[j + 2]! - ac;
    const len2 = dx * dx + dy * dy + dz * dz + da * da + db * db + dc * dc;
    const rx = p[0] - ax, ry = p[1] - ay, rz = p[2] - az;
    const ra = p[3] - aa, rb = p[4] - ab, rc = p[5] - ac;
    const u = len2 > 0 ? Math.min(1, Math.max(0, (rx * dx + ry * dy + rz * dz + ra * da + rb * db + rc * dc) / len2)) : 0;
    const ex = rx - u * dx, ey = ry - u * dy, ez = rz - u * dz;
    const ea = ra - u * da, eb = rb - u * db, ec = rc - u * dc;
    const d2 = ex * ex + ey * ey + ez * ez + ea * ea + eb * eb + ec * ec;
    if (d2 < bestD) {
      bestD = d2;
      bestCum = t.cum[i - 1]! + u * (t.cum[i]! - t.cum[i - 1]!);
    }
  }
  sPos.value = bestCum;
});

const statusText = computed(() => {
  if (simMode.value) return `${curLine.value ? "L" + curLine.value : "entry"}${curRapid.value ? " →" : ""} ${posLabel.value}`;
  // "~": the run readout is the ESTIMATE clock (parse-time feeds/rapids) —
  // feed override, accel and dwells make real elapsed differ (GcodePanel
  // shows the wall clock).
  if (running.value) return `L${motionLine.value ?? 0} ~${posLabel.value}`;
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
  return `Soft-limit violations\n${shown}${more}`;
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
