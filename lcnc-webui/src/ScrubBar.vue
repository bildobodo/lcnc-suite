<script setup lang="ts">
// Program-scrub timeline (offline dry run, stage 2). Overlaid along the
// bottom of the 3D viewer: drag (or play) to pose the articulated machine
// model at any point of the loaded program WITHOUT running it. Display-only
// — it never emits machine commands, so it is deliberately usable while
// disarmed or in E-Stop (gate 'always'); it hides while a program executes
// and the live pose always wins the moment one starts.
import { computed, onUnmounted, ref, watch } from "vue";
import { status, viewerGcode, viewerInit } from "./lcncWs";
import { INTERP_IDLE } from "./lcnc";
import { sampleTrack, jointsForSample, type ScrubSample } from "./viewer/scrubTrack";
import { Play, Pause } from "lucide-vue-next";
import MachineBtn from "./MachineBtn.vue";
import MachineSlider from "./MachineSlider.vue";

const emit = defineEmits<{
  // joints: per-JOINT machine values (null entry = keep live joint), or null
  // to return the model to the live pose. line: source line at the sample.
  (e: "pose", joints: (number | null)[] | null, line: number | null): void;
}>();

const st = computed<Record<string, any>>(() => status.value?.data ?? {});
const track = computed(() => viewerGcode.value?.scrubTrack ?? null);
const running = computed(() => (st.value.interp_state ?? INTERP_IDLE) !== INTERP_IDLE);
const visible = computed(() => !!track.value && !running.value);

const sPos = ref(0);          // scrub parameter (track cum units)
const engaged = ref(false);   // false = model follows live machine
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
  if (!t || !engaged.value) return;
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

watch(sPos, () => {
  if (!engaged.value) engaged.value = true;
  applyPos();
});

// The pose depends on the live WCS — touch-off while scrubbing must move the
// posed model. Keyed on the actual offset values so idle status ticks don't
// re-emit (render-on-demand stays effective).
const _wcsKey = computed(() => {
  const d = st.value;
  return `${(d.g5x_offset ?? []).join()},${(d.g92_offset ?? []).join()},${d.rotation_xy ?? 0}`;
});
watch(_wcsKey, () => applyPos());

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
  engaged.value = true;
  if (sPos.value >= cumMax.value) sPos.value = 0;
  applyPos();  // engage even if sPos was already 0 (watcher won't fire on no-change)
  playing.value = true;
  lastT = performance.now();
  raf = requestAnimationFrame(tick);
}

function cycleSpeed() {
  mult.value = MULTS[(MULTS.indexOf(mult.value) + 1) % MULTS.length]!;
}

function exit() {
  playing.value = false;
  if (!engaged.value) return;
  engaged.value = false;
  emit("pose", null, null);
}

// A program starting to execute always wins; a new/unloaded program resets.
watch(running, (r) => { if (r) exit(); });
watch(track, () => { exit(); sPos.value = 0; });

onUnmounted(() => {
  cancelAnimationFrame(raf);
  exit();
});
</script>

<template>
  <div v-if="visible" class="scrubBar bordered-panel row-controls">
    <MachineBtn type="scrub" :title="playing ? 'Pause playback' : 'Play program through the machine model'" @click="togglePlay">
      <Pause v-if="playing" :size="14" />
      <Play v-else :size="14" />
    </MachineBtn>
    <MachineSlider gate="scrubPos" class="scrubSlider" :min="0" :max="cumMax"
                   :step="cumMax / 2000 || 1" v-model="sPos"
                   title="Scrub the program — poses the machine model, nothing moves" />
    <MachineBtn type="scrub" title="Playback speed" @click="cycleSpeed">&times;{{ mult }}</MachineBtn>
    <span class="scrubStatus val-status mono" :class="{ muted: !engaged }">
      {{ engaged ? `L${curLine}${curRapid ? " →" : ""} ${pct}%` : "live" }}
    </span>
    <MachineBtn type="scrub" :disabled="!engaged" title="Return the model to the live machine pose" @click="exit">Live</MachineBtn>
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
.scrubSlider {
  flex: 1;
  min-width: 0;
}
.scrubStatus {
  white-space: nowrap;
  min-width: 9ch;
}
</style>
