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
import { sampleTrack, jointsForSample, type ScrubSample } from "./viewer/scrubTrack";
import type { CollisionResult } from "./viewer/collision";
import { limitViolationText } from "./ws/bulkData";
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
}>();

const emit = defineEmits<{
  // joints: per-JOINT machine values (null entry = keep live joint), or null
  // to return the model to the live pose. line: source line at the sample.
  (e: "pose", joints: (number | null)[] | null, line: number | null): void;
  (e: "check"): void;
  (e: "cancel-check"): void;
}>();

const st = computed<Record<string, any>>(() => status.value?.data ?? {});
const track = computed(() => viewerGcode.value?.scrubTrack ?? null);
const running = computed(() => (st.value.interp_state ?? INTERP_IDLE) !== INTERP_IDLE);
const machineOff = computed(() => !st.value.is_enabled);
const visible = computed(() => !!track.value && !running.value);

const sPos = ref(0);          // scrub parameter (track cum units)
const playing = ref(false);
const mult = ref(1);
const MULTS = [1, 4, 16, 64];
const BASE_MM_S = 30;         // ×1 playback rate (distance-proportional, v1)

const cumMax = computed(() => {
  const t = track.value;
  return t ? t.cum[t.count - 1]! : 0;
});
const curLine = ref(0);
const curRapid = ref(false);
const pct = computed(() => (cumMax.value > 0 ? Math.round((sPos.value / cumMax.value) * 100) : 0));

// Reused per-frame scratch — the sPos watcher runs at animation rate.
const _sample: ScrubSample = { px: 0, py: 0, pz: 0, pa: 0, pb: 0, pc: 0, line: 0, rapid: false, index: 0 };
const _joints: (number | null)[] = [];

function applyPos() {
  const t = track.value;
  if (!t || !simMode.value) return;
  sampleTrack(t, sPos.value, _sample);
  curLine.value = _sample.line;
  curRapid.value = _sample.rapid;
  const d = st.value;
  jointsForSample(
    _sample,
    { g5x: d.g5x_offset ?? [], g92: d.g92_offset ?? [], rotationDeg: d.rotation_xy ?? 0 },
    viewerInit.value?.axes ?? [],
    _joints,
  );
  emit("pose", _joints.slice(), _sample.line);
}

/** ---------- explicit mode entry / exit ---------- */
// Live-joint baseline at entry: real machine motion while simulating (only
// possible from outside this tab — its own controls are gated) exits the
// mode. 0.05 units/degrees: above servo dither, below any deliberate move.
let _baseJoints: number[] = [];
const MOTION_EXIT_THRESHOLD = 0.05;

function enterSim(): boolean {
  if (simMode.value) return true;
  if (!track.value || running.value || !machineOff.value) return false;
  simMode.value = true;
  const jp = st.value.joint_pos;
  _baseJoints = Array.isArray(jp) ? [...jp] : [];
  applyPos();  // pose immediately — the mode announces itself
  return true;
}

function exitSim() {
  playing.value = false;
  if (!simMode.value) return;
  simMode.value = false;
  emit("pose", null, null);
}

// Pose-only watcher: programmatic sPos writes never change the mode.
watch(sPos, () => {
  if (simMode.value) applyPos();
});

// The pose depends on the live WCS — touch-off from another client while
// simulating must move the posed model. Keyed on values so idle status
// ticks don't re-emit (render-on-demand stays effective).
const _wcsKey = computed(() => {
  const d = st.value;
  return `${(d.g5x_offset ?? []).join()},${(d.g92_offset ?? []).join()},${d.rotation_xy ?? 0}`;
});
watch(_wcsKey, () => applyPos());

// Auto-exits: execution starts, program changes, machine powered on
// (another client — this tab's Machine On is gated), or real joint motion.
watch(running, (r) => { if (r) exitSim(); });
watch(track, () => { exitSim(); sPos.value = 0; });
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
  sPos.value = Math.min(cumMax.value, sPos.value + BASE_MM_S * mult.value * dt);
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

function cycleSpeed() {
  mult.value = MULTS[(MULTS.indexOf(mult.value) + 1) % MULTS.length]!;
}

/** ---------- collision results (stage 3) ---------- */
const hits = computed(() => props.collisionResult?.hits ?? []);
const hitIdx = ref(0);
watch(() => props.collisionResult, () => { hitIdx.value = 0; });
const nextHit = computed(() => (hits.value.length ? hits.value[hitIdx.value % hits.value.length]! : null));

// Scrub straight to the clash — entering simulation if eligible (an
// inspection click is a purposeful entry; the banner announces the mode).
function jumpToHit() {
  const h = nextHit.value;
  if (!h || !enterSim()) return;
  playing.value = false;
  sPos.value = Math.min(cumMax.value, Math.max(0, h.cum));
  applyPos();
  hitIdx.value++;
}

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
const vIdx = ref(0);
watch(violations, () => { vIdx.value = 0; });
const nextViolation = computed(() => {
  const list = violations.value ?? [];
  return list.length ? list[vIdx.value % list.length]! : null;
});
const violationsTitle = computed(() => {
  const list = violations.value ?? [];
  if (!list.length) return "";
  const shown = list.slice(0, 8).map(v => `L${v.line}: ${limitViolationText(v, linearUnit.value)}`).join("\n");
  const more = violationsTotal.value > 8 ? `\n… ${violationsTotal.value - 8} more` : "";
  return `Soft-limit violations — click to simulate the next one\n${shown}${more}`;
});

// Scrub to the next violating line (entering sim when eligible, like the
// clash button). Lines the track doesn't know are skipped in the cycle.
function jumpToViolation() {
  const list = violations.value ?? [];
  const t = track.value;
  if (!list.length || !t || !enterSim()) return;
  for (let tries = 0; tries < list.length; tries++) {
    const v = list[vIdx.value % list.length]!;
    vIdx.value++;
    const cum = t.lineCum.get(v.line);
    if (cum !== undefined) {
      playing.value = false;
      sPos.value = Math.min(cumMax.value, Math.max(0, cum));
      applyPos();
      return;
    }
  }
}

// Timeline positions of the hits, as track percentages.
const hitMarks = computed(() =>
  cumMax.value > 0
    ? hits.value.map(h => ({ pct: Math.min(100, (h.cum / cumMax.value) * 100), rapid: h.rapid }))
    : [],
);

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
  exitSim();
});
</script>

<template>
  <div v-if="visible" class="scrubBar bordered-panel row-controls">
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
      <!-- Timeline markers, non-interactive (the clash / banner buttons
           navigate): warn = soft-limit violation, danger = collision hit
           (full-height = rapid contact). -->
      <div v-for="(pct, i) in violationMarks" :key="'v' + i" class="scrubMark limit"
           :style="{ left: pct + '%' }"></div>
      <div v-for="(m, i) in hitMarks" :key="'c' + i" class="scrubMark"
           :class="{ rapid: m.rapid }" :style="{ left: m.pct + '%' }"></div>
    </div>
    <MachineBtn type="scrub" :disabled="!simMode" title="Playback speed" @click="cycleSpeed">&times;{{ mult }}</MachineBtn>
    <span class="scrubStatus val-status mono" :class="{ muted: !simMode }">
      {{ simMode ? `L${curLine}${curRapid ? " →" : ""} ${pct}%` : "live" }}
    </span>

    <div class="sep-v"></div>

    <!-- Findings, centralized: yellow = soft limits (stage 1), red =
         collision clashes (stage 3). Wrappers carry the tooltips (WebKit
         doesn't hover disabled buttons). -->
    <span v-if="violations && violations.length" class="btnTip" :title="violationsTitle">
      <MachineBtn type="scrub" variant="warn" :disabled="!simMode && !machineOff"
                  @click="jumpToViolation">
        {{ violationsTotal }} limit{{ violationsTotal === 1 ? "" : "s" }}<template v-if="nextViolation"> &rarr; L{{ nextViolation.line }}</template>
      </MachineBtn>
    </span>

    <MachineBtn v-if="!collisionBusy" type="scrub"
                title="Sweep the machine model through the program and check body-pair clearance"
                @click="emit('check')">{{ checkLabel }}</MachineBtn>
    <MachineBtn v-else type="scrub" title="Cancel the collision check"
                @click="emit('cancel-check')">{{ checkLabel }} &times;</MachineBtn>
    <template v-if="collisionResult && !collisionBusy">
      <span v-if="collisionResult.pairCount === 0" class="val-status muted" title="No body pair moves relative to another — nothing to check">no moving pairs</span>
      <span v-else-if="!hits.length" class="val-status ok" :title="`${collisionResult.samples} samples, ${collisionResult.pairCount} pairs${collisionResult.coarsened ? ', coarsened to fit the sample budget' : ''}${collisionResult.staticContacts.length ? `; in contact from the start (excluded): ${collisionResult.staticContacts.map(c => c.a + '/' + c.b).join(', ')}` : ''}`">
        clear{{ collisionResult.coarsened ? "*" : "" }}
      </span>
      <span v-else class="btnTip"
            :title="`Collision hits — click to simulate the next one${!simMode && !machineOff ? ' (turn the machine OFF first)' : ''}${collisionResult.staticContacts.length ? `\nIn contact from the start (excluded): ${collisionResult.staticContacts.map(c => c.a + '/' + c.b).join(', ')}` : ''}`">
        <MachineBtn type="scrub" variant="danger" :disabled="!simMode && !machineOff"
                    @click="jumpToHit">
          {{ hits.length }} clash{{ hits.length === 1 ? "" : "es" }} &rarr; L{{ nextHit!.line }}{{ nextHit!.rapid ? " (rapid)" : "" }}
        </MachineBtn>
      </span>
    </template>
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
  align-items: center;
  padding: var(--gap-tight) var(--gap-controls);
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
   hits span full height, feed contacts are the shorter center band. */
.scrubMark {
  position: absolute;
  top: 25%;
  bottom: 25%;
  width: 2px;
  transform: translateX(-50%);
  background: var(--danger);
  pointer-events: none;
}
.scrubMark.rapid {
  top: 0;
  bottom: 0;
}
.scrubMark.limit {
  background: var(--warn);
}
.scrubStatus {
  white-space: nowrap;
  min-width: 9ch;
}
/* Tooltip wrapper for a disabled button — layout-neutral flex item. */
.btnTip {
  display: inline-flex;
}
</style>
