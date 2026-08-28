<script setup lang="ts">
import { computed, inject, ref, type Ref } from "vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineRadio from "./MachineRadio.vue";
import { useAxes, isRotaryAxis } from "./useAxes";

// Match HUD precision (3 decimals linear, 2 rotary) without the unit suffix
// so the keypad parser still receives a clean numeric string. (Deliberately
// NOT fmtCoord: no ° suffix here.)
function fmtAxisInput(val: number | undefined, letter: string): string {
  if (val == null || !Number.isFinite(val)) return "";
  return isRotaryAxis(letter) ? val.toFixed(2) : val.toFixed(3);
}

const props = defineProps<{
  axes: string[];
  workPos: number[];
  homedJoints: boolean[];
  isHomed: boolean;
  g5xLabel: string;
  // Live switchkins mode (null = machine has no switchable kins — chip
  // hidden). The industry convention (Heidenhain 3D-ROT, Siemens WCS/MCS)
  // is that the active jog/work frame is ALWAYS visibly indicated.
  kinsType?: number | null;
  twpActive?: boolean | null;
  // The plane's assumed table pose no longer matches the live one — the
  // stored frame and the physical face disagree (see twpPose.ts).
  twpStale?: boolean;
}>();

const emit = defineEmits<{
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "homeAxis", joint: number): void;
  (e: "unhomeAxis", joint: number): void;
  (e: "setAxis", axis: number, value: number): void;
  (e: "setAll", values: number[]): void;
  (e: "setG5x", gcode: string): void;
  (e: "goToG30"): void;
  (e: "goToHome"): void;
  (e: "goToZero"): void;
}>();

const { entries } = useAxes(computed(() => props.axes));
// The strip's height fits 6 grid rows. Pack each column FULL (6 axis rows)
// before starting the next; the 3 action rows (Zero All / Home All / goto)
// ride the last column when ≤3 axis rows remain there, else get their own.
// 3-axis: XYZ+actions in one column (pixel-identical to the classic
// layout); 9-axis: XYZABC | UVW+actions.
// Portrait stacks the grids vertically, where a column split just reads as
// an odd gap mid-list — so portrait renders ONE grid with all axes and the
// actions at its tail (vertical space is plentiful there; width is the
// constraint, and one grid keeps a single uniform rhythm).
const isPortrait = inject<Ref<boolean>>("isPortrait", ref(false));
interface SetupChunk { axes: typeof entries.value; actions: boolean }
const axisChunks = computed<SetupChunk[]>(() => {
  const e = entries.value;
  if (isPortrait.value) return [{ axes: e, actions: true }];
  const out: SetupChunk[] = [];
  for (let i = 0; i < e.length; i += 6) out.push({ axes: e.slice(i, i + 6), actions: false });
  const last = out[out.length - 1];
  if (last && last.axes.length <= 3) last.actions = true;
  else out.push({ axes: [], actions: true }); // no axes yet, or a full last column
  return out;
});

const g5xOptions = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"];

// Kins-mode chip (P3 operator surface): the silent-mode-traversal trap —
// the TWP demo parks the machine in TOOL kins (M2 restores G54, not the
// kins type) with zero indication anywhere.
const kinsChip = computed(() => {
  const k = props.kinsType;
  if (k == null) return null;
  if (k === 1) return {
    text: "TCP", cls: "ok",
    title: "Tool-center-point kinematics active — programmed XYZ is the tool tip",
  };
  if (k === 2) {
    // Stale wins over the normal tint: the frame is not just tilted, it is
    // tilted relative to where the workpiece USED to be.
    if (props.twpStale) return {
      text: props.twpActive ? "TWP" : "TOOL", cls: "bad",
      title: "Plane frame STALE — the A table has moved since this plane was oriented, so the frame no longer matches the workpiece. Re-run G53.x to re-orient (M430 alone does not recompose).",
    };
    return props.twpActive
      ? { text: "TWP", cls: "warn",
          title: "Tilted work plane ACTIVE — X/Y/Z jogs move in the tilted plane (Z along the tool axis). G69 cancels." }
      : { text: "TOOL", cls: "warn",
          title: "TOOL kinematics active without an active plane — X/Y/Z jogs move along the last plane frame, not machine axes. G69 restores machine kinematics." };
  }
  return {
    text: "MACHINE", cls: "muted",
    title: "Identity kinematics — X/Y/Z jogs move along machine axes",
  };
});

function zeroAll() {
  emit("setAll", new Array(props.axes.length).fill(0));
}
</script>

<template>
  <div class="stripSection">
    <div class="sub">Setup</div>
    <div class="setupContent row-sections">
      <!-- Axis grids: 6 axis rows per column (machine order); actions fill the tail -->
      <div v-for="(chunk, ci) in axisChunks" :key="ci" class="setupGrid">
        <template v-for="a in chunk.axes" :key="a.letter">
          <MachineInput gate="touchoff" type="number" :label="a.letter" :value="fmtAxisInput(workPos[a.index], a.letter)" @input="emit('setAxis', a.index, +($event.target as HTMLInputElement).value)" class="setupInput" />
          <MachineBtn type="zero" @click="emit('setAxis', a.index, 0)">Zero {{ a.letter }}</MachineBtn>
          <MachineBtn :type="homedJoints[a.index] ? 'unhome' : 'home'" @click="homedJoints[a.index] ? emit('unhomeAxis', a.index) : emit('homeAxis', a.index)"><span class="stable-width"><span :class="{ alt: homedJoints[a.index] }">Home {{ a.letter }}</span><span :class="{ alt: !homedJoints[a.index] }">Unhome {{ a.letter }}</span></span></MachineBtn>
        </template>
        <template v-if="chunk.actions">
          <MachineBtn type="zero" class="spanAll" @click="zeroAll()">Zero All</MachineBtn>
          <MachineBtn :type="isHomed ? 'unhome' : 'home'" class="spanAll" @click="isHomed ? emit('unhomeAll') : emit('homeAll')"><span class="stable-width"><span :class="{ alt: isHomed }">Home All</span><span :class="{ alt: !isHomed }">Unhome All</span></span></MachineBtn>
          <MachineBtn type="goTo" @click="emit('goToG30')">→ G30</MachineBtn>
          <MachineBtn type="goTo" @click="emit('goToHome')">→ Home</MachineBtn>
          <MachineBtn type="goTo" @click="emit('goToZero')">→ Zero</MachineBtn>
        </template>
      </div>

      <div class="wcsCol stack-tight strip-radio-group">
        <span class="label-muted">WCS</span>
        <span v-if="kinsChip" class="val-status kinsChip" :class="kinsChip.cls"
              :title="kinsChip.title">{{ kinsChip.text }}</span>
        <div class="strip-radio-options">
          <label v-for="g in g5xOptions" :key="g" class="radio-label">
            <MachineRadio gate="touchoff" name="wcs" :value="g" :modelValue="g5xLabel" @update:modelValue="(v: string | number | undefined) => { if (v != null) emit('setG5x', String(v)) }" />
            <span>{{ g }}</span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setupContent > * { flex-shrink: 0; }
.setupGrid {
  display: grid;
  grid-template-columns: 80px 1fr 1fr;
  /* Columns get --gap-controls: Zero X and Home X are consequential
     neighbors (fat-finger slip = unplanned homing move). Rows stay
     --gap-tight — 6 axis rows at touch min-height already fill the
     280px strip; 8px row gaps would overflow it. */
  gap: var(--gap-tight) var(--gap-controls);
  align-content: start;
}
/* Uniform rows: the touchoff input is catalog size 'sm' (machineControls),
   so the md buttons define the 32px track and the input stretches to it —
   axis rows and the action rows in the neighbouring column now match. */
.setupInput { width: 100%; }
.spanAll { grid-column: 1 / -1; }
.wcsCol { justify-content: flex-start; }
/* Chip inherits .val-status visuals; only the alignment is local (the
   column reads left-to-right, not right-aligned like status rows). */
.kinsChip { text-align: left; }

@media (orientation: portrait) {
  .setupContent { flex-direction: column; }
  /* Narrow input column to fit 280px strip width */
  .setupGrid { grid-template-columns: 70px 1fr 1fr; }
}
</style>
