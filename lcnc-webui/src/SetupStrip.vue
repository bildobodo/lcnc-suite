<script setup lang="ts">
import { computed, inject, ref, type Ref } from "vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineRadio from "./MachineRadio.vue";
import { useAxes, isRotaryAxis } from "./useAxes";
import { kinsModeChip, type OffDatum } from "./twpPose";

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
  twpDefined?: boolean | null;
  // The A table has moved since G53.x oriented the head, so the TOOL is no
  // longer normal to the plane. The plane itself is stored table-relative
  // and rides the workpiece, so it cannot go stale (see twpPose.ts).
  twpStale?: boolean;
  // A head solve exists (the Plane frame is offered) — Orient's title case.
  twpOriented?: boolean;
  // Live G54 has left the datum snapshot the plane was defined against.
  twpDatumMoved?: boolean;
  // Identity kins with the table away from the active fixture's stamp pose:
  // the fixture is a fixed point in the room, no longer on the part.
  twpOffDatum?: OffDatum | null;
}>();

const emit = defineEmits<{
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "homeAxis", joint: number): void;
  (e: "unhomeAxis", joint: number): void;
  (e: "setAxis", axis: number, value: number): void;
  (e: "setAll", letters: string[]): void;
  (e: "setG5x", gcode: string): void;
  (e: "goToG30"): void;
  (e: "goToHome"): void;
  (e: "goToZero"): void;
  (e: "twpOrient"): void;
  (e: "twpCapture"): void;
  (e: "twpClear"): void;
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
const isTwpMachine = computed(() => props.kinsType != null);
interface SetupChunk { axes: typeof entries.value; actions: boolean }
const axisChunks = computed<SetupChunk[]>(() => {
  const e = entries.value;
  if (isPortrait.value) return [{ axes: e, actions: true }];
  const out: SetupChunk[] = [];
  for (let i = 0; i < e.length; i += 6) out.push({ axes: e.slice(i, i + 6), actions: false });
  const last = out[out.length - 1];
  const actionRows = isTwpMachine.value ? 4 : 3;  // + the TWP action row
  if (last && last.axes.length <= 6 - actionRows) last.actions = true;
  else out.push({ axes: [], actions: true }); // no axes yet, or a full last column
  return out;
});

const g5xOptions = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"];
// G59..G59.3 are the TWP remap's scratch rows — g53x_core rewrites them at
// every orient, and a touch-off into them evaporates (XYZ) or poisons the
// next orient (A/B/C). On a TWP machine (switchable kins present) they are
// not an operator choice; the Plane jog frame selects G59 itself.
const RESERVED_WCS = new Set(["G59", "G59.1", "G59.2", "G59.3"]);
function wcsReserved(g: string): boolean {
  return isTwpMachine.value && RESERVED_WCS.has(g);
}
const RESERVED_TITLE = "Reserved for the tilted-work-plane remap — rewritten by every orient. Touch off into G54–G58; the Plane jog frame selects G59 itself.";

// Kins-mode chip (P3 operator surface): the silent-mode-traversal trap —
// the TWP demo parks the machine in TOOL kins (M2 restores G54, not the
// kins type) with zero indication anywhere. ONE derivation (twpPose.ts
// kinsModeChip) shared with the viewer HUD; "datum moved" rides in it.
const kinsChip = computed(() => kinsModeChip({
  kinsType: props.kinsType, twpActive: props.twpActive,
  twpStale: props.twpStale, twpDatumMoved: props.twpDatumMoved,
  offDatum: props.twpOffDatum,
}));

// The TWP action buttons (Capture plane / Orient / Clear plane) live here as
// one equal-width action row — the same structure as the goto row. (Orient
// had moved to the Jog strip on 2026-08-30 "so you actually find it"; the
// operator asked for them back in this grid on 2026-09-01: "3 side by side
// like go home / go G30 / go zero, not some weird different size".)

// Zero All names LINEAR axes only on a TWP machine: a rotary work offset
// displaces the orient move (the remap issues its head move in machine
// coordinates now, but a G54 A/B/C row still blocks plane definition), and
// zeroing A/B/C is never what "zero the part" means there. Per-axis rotary
// zero stays available under its own (identity + G54) gate.
const zeroAllLetters = computed(() =>
  isTwpMachine.value ? props.axes.filter((l) => !isRotaryAxis(l)) : [...props.axes]);
function zeroAll() {
  emit("setAll", zeroAllLetters.value);
}
</script>

<template>
  <div class="stripSection">
    <div class="sub">Setup</div>
    <div class="setupContent row-sections">
      <!-- Axis grids: 6 axis rows per column (machine order); actions fill the tail -->
      <div v-for="(chunk, ci) in axisChunks" :key="ci" class="setupGrid">
        <template v-for="a in chunk.axes" :key="a.letter">
          <MachineInput :gate="isRotaryAxis(a.letter) ? 'touchoffRotary' : 'touchoff'" type="number" :label="a.letter" :value="fmtAxisInput(workPos[a.index], a.letter)" @input="emit('setAxis', a.index, +($event.target as HTMLInputElement).value)" class="setupInput" />
          <MachineBtn :type="isRotaryAxis(a.letter) ? 'zeroRotary' : 'zero'" @click="emit('setAxis', a.index, 0)">Zero {{ a.letter }}</MachineBtn>
          <MachineBtn :type="homedJoints[a.index] ? 'unhome' : 'home'" @click="homedJoints[a.index] ? emit('unhomeAxis', a.index) : emit('homeAxis', a.index)"><span class="stable-width"><span :class="{ alt: homedJoints[a.index] }">Home {{ a.letter }}</span><span :class="{ alt: !homedJoints[a.index] }">Unhome {{ a.letter }}</span></span></MachineBtn>
        </template>
        <template v-if="chunk.actions">
          <MachineBtn type="zero" class="spanAll" @click="zeroAll()" :title="isTwpMachine ? 'Zero the linear axes (rotary offsets are set per axis, Machine frame + G54 only)' : undefined">Zero All</MachineBtn>
          <MachineBtn :type="isHomed ? 'unhome' : 'home'" class="spanAll" @click="isHomed ? emit('unhomeAll') : emit('homeAll')"><span class="stable-width"><span :class="{ alt: isHomed }">Home All</span><span :class="{ alt: !isHomed }">Unhome All</span></span></MachineBtn>
          <!-- Action rows: three EQUAL cells spanning the grid (never one
               button per 80px/1fr/1fr track — "→ G30" used to sit in the
               80px column). -->
          <div class="actionRow">
            <MachineBtn type="goTo" @click="emit('goToG30')">→ G30</MachineBtn>
            <MachineBtn type="goTo" @click="emit('goToHome')">→ Home</MachineBtn>
            <MachineBtn type="goTo" @click="emit('goToZero')">→ Zero</MachineBtn>
          </div>
          <div v-if="isTwpMachine" class="actionRow">
            <!-- Capture plane: the one-button manual definition — align the
                 spindle normal to the face (TCP jog), tip on the datum point,
                 press. The backend gate (twp_capture_check) dims it with the
                 reason — plane already defined, not G54, offsets in effect. -->
            <MachineBtn type="twpCapture" @click="emit('twpCapture')"
                        :title="twpDefined
                          ? 'A plane is already defined — press Clear plane first (no silent discard).'
                          : 'Capture the plane at the tool tip: orient the spindle normal to the face, touch the datum point, press. Defines the plane from the live spindle direction, sets the workpiece datum (G54) at the tip through the plane, and enters the Plane frame with the DRO reading 0 — nothing moves.'">Capture plane</MachineBtn>
            <!-- Orient: works from a DEFINED plane (first orient) and
                 re-orients after a table move. Hold-to-fire: the rotaries MOVE. -->
            <MachineBtn type="twpReorient" :disabled="!twpDefined" @click="emit('twpOrient')"
                        :title="!twpDefined
                          ? 'Define a plane first (Capture plane, G68.2 / G68.3)'
                          : twpStale
                            ? 'Re-solve the head at the current table pose — the tool becomes normal to the plane again. The rotaries MOVE.'
                            : twpOriented
                              ? 'Re-solve the head at the current table pose. The orientation is current, so this should move very little.'
                              : 'Orient the head into the defined plane (G53.1 equivalent). The rotaries MOVE.'">Orient</MachineBtn>
            <!-- Clear plane: plain G69 — idempotent, restores identity kins +
                 G54, moves nothing. Also the TOOL-kins-limbo recovery. -->
            <MachineBtn type="twpClear" :disabled="!twpDefined && kinsType !== 2"
                        @click="emit('twpClear')"
                        :title="twpDefined
                          ? 'Discard the tilted work plane (G69): back to identity kinematics and G54.'
                          : kinsType === 2
                            ? 'TOOL kinematics without a plane — G69 restores identity kinematics and G54.'
                            : 'No plane defined — nothing to clear.'">Clear plane</MachineBtn>
          </div>
        </template>
      </div>

      <div class="wcsCol stack-tight strip-radio-group">
        <span class="label-muted">WCS</span>
        <span v-if="kinsChip" class="val-status kinsChip" :class="kinsChip.cls"
              :title="kinsChip.title">{{ kinsChip.text }}</span>
        <div class="strip-radio-options">
          <label v-for="g in g5xOptions" :key="g" class="radio-label" :title="wcsReserved(g) ? RESERVED_TITLE : undefined">
            <MachineRadio gate="wcsSelect" name="wcs" :value="g" :modelValue="g5xLabel" :disabled="wcsReserved(g)" @update:modelValue="(v: string | number | undefined) => { if (v != null) emit('setG5x', String(v)) }" />
            <span :class="{ muted: wcsReserved(g) }">{{ g }}</span>
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
/* Three equal cells across the whole grid (layout only): the goto row and
   the TWP action row are structurally identical. */
.actionRow { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gap-controls); }
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
