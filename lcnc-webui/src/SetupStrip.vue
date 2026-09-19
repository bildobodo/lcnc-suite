<script setup lang="ts">
import { computed, inject, ref, watch, type Ref } from "vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineRadio from "./MachineRadio.vue";
import { useAxes, isRotaryAxis } from "./useAxes";
import { kinsModeChip, type OffDatum } from "./twpPose";
import { touchoffTargetLabel, type TouchoffExpect } from "./useTouchoffMath";
import { keypadState, closeKeypad } from "./useNumberKeypad";
import { usePermissions, explainKeydown } from "./permissions";
import { pushMessage } from "./lcncWs";
import { OPERATOR_DISPLAY, OPERATOR_ERROR } from "./lcnc";

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
  // RAW switchkins pin (the touch-off `expect` payload's field — the
  // gateway compares it against its own pin) and the FRAME it means on this
  // family, which is what the operator is shown (R-01).
  kinsType?: number | null;
  kinsMode?: number | null;
  // The TWP remap stack exists (App twpCapable, twin of gateway
  // _twp_capable): the Capture/Orient/Clear row and the reserved G59 rows
  // are TWP facts; switchability alone (kinsType) is not (TWP-08b).
  twpCapable?: boolean;
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
  // Active fixture 1..9: under Plane kinematics anything but G59 is the
  // stranded post-M2 state the chip must call out (twpPose.ts).
  g5xIndex?: number | null;
}>();

const emit = defineEmits<{
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "homeAxis", joint: number): void;
  (e: "unhomeAxis", joint: number): void;
  (e: "setAxis", axis: number, value: number, expect: TouchoffExpect): void;
  (e: "setAll", letters: string[], expect: TouchoffExpect): void;
  (e: "setG5x", gcode: string): void;
  (e: "goToG30"): void;
  (e: "goToHome"): void;
  (e: "goToZero"): void;
  (e: "twpOrient"): void;
  (e: "twpCapture"): void;
  (e: "twpClear"): void;
}>();

const { entries } = useAxes(computed(() => props.axes));
const can = usePermissions();
const rootEl = ref<HTMLElement | null>(null);

// Touch-off target (U-03, review 2026-09-14): the keypad's heading names the
// axis, the frame and the datum the value will write ("Touch off Z · Plane ·
// updates G54"), and the request carries the mode × fixture the operator
// saw, which the gateway verifies at confirm time.
function targetLabel(letter: string): string {
  return touchoffTargetLabel(letter, { kinsType: props.kinsMode, g5xLabel: props.g5xLabel, twpActive: props.twpActive });
}
function expectNow(): TouchoffExpect {
  return { kins_type: props.kinsType ?? null, g5x_index: props.g5xIndex ?? null };
}
// A keypad opened on one of THIS strip's inputs targets the route it was
// opened under. If that route changes while the operator types — a program's
// M2 flipping the fixture, another client switching the frame, the gate
// closing — the value must not land on a different target: cancel and say so.
const touchoffContextKey = computed(() =>
  `${props.kinsType ?? "-"}|${props.g5xLabel}|${props.twpActive ? 1 : 0}|${can.value.touchoff ? 1 : 0}|${can.value.touchoffRotary ? 1 : 0}`);
watch(touchoffContextKey, () => {
  if (!keypadState.open || !keypadState.trigger || !rootEl.value?.contains(keypadState.trigger)) return;
  const label = keypadState.label;
  closeKeypad();
  pushMessage(OPERATOR_ERROR, `Touch-off cancelled — the target changed while you were entering (${label}). Re-enter the value.`);
});
// Keep axes above a fixed action footer: XYZ | AC on the trunnion and
// XYZ | ABC on the gantry. Three axis rows leave room for the aggregate,
// travel and optional plane rows within the strip's six-row budget.
// Portrait uses one axis list; its strip scrolls vertically.
const isPortrait = inject<Ref<boolean>>("isPortrait", ref(false));
// Switchable kins at all (kins_type sampled): Zero All stays linear-only
// there — rotary touch-off is identity + G54 only on EVERY switchable
// machine. TWP-capable: the remap stack, which owns G59..G59.3 and gives
// Capture/Orient/Clear their meaning — a TCP trunnion used to get both
// surfaces just for being switchable (TWP-08b).
const isSwitchable = computed(() => props.kinsType != null);
const isTwpMachine = computed(() => props.twpCapable === true);
const axisChunks = computed(() => {
  const e = entries.value;
  if (isPortrait.value) return [e];
  const out: (typeof e)[] = [];
  for (let i = 0; i < e.length; i += 3) out.push(e.slice(i, i + 3));
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
  kinsType: props.kinsMode, twpActive: props.twpActive,
  twpStale: props.twpStale, twpDatumMoved: props.twpDatumMoved,
  offDatum: props.twpOffDatum, g5xIndex: props.g5xIndex,
}));

// The TWP action buttons (Capture plane / Orient / Clear plane) live here as
// one equal-width action row — the same structure as the goto row. (Orient
// had moved to the Jog strip on 2026-08-30 "so you actually find it"; the
// operator asked for them back in this grid on 2026-09-01: "3 side by side
// like go home / go G30 / go zero, not some weird different size".)

// Zero All names LINEAR axes only on a switchable machine: a rotary work offset
// displaces the orient move (the remap issues its head move in machine
// coordinates now, but a G54 A/B/C row still blocks plane definition), and
// zeroing A/B/C is never what "zero the part" means there. Per-axis rotary
// zero stays available under its own (identity + G54) gate.
const zeroAllLetters = computed(() =>
  isSwitchable.value ? props.axes.filter((l) => !isRotaryAxis(l)) : [...props.axes]);
// The button names its actual axis set (review 2026-09-14 D-02): "Zero
// XYZ" where the rotaries are excluded, "Zero All" only where it is all.
const zeroAllLabel = computed(() => {
  if (!isSwitchable.value) return "Zero All";
  const l = zeroAllLetters.value;
  return l.length <= 3 ? `Zero ${l.join("")}` : "Zero linear";
});
function zeroAll() {
  emit("setAll", zeroAllLetters.value, expectNow());
}
</script>

<template>
  <div class="stripSection" ref="rootEl">
    <div class="sub">Setup</div>
    <div class="setupContent row-sections">
      <div class="setupControls stack-tight">
        <div class="axisGrids row-controls">
          <div v-for="(chunk, ci) in axisChunks" :key="ci" class="setupGrid">
            <template v-for="a in chunk" :key="a.letter">
              <MachineInput :gate="isRotaryAxis(a.letter) ? 'touchoffRotary' : 'touchoff'" type="number" :label="targetLabel(a.letter)" :value="fmtAxisInput(workPos[a.index], a.letter)" @input="emit('setAxis', a.index, +($event.target as HTMLInputElement).value, expectNow())" class="setupInput" />
              <MachineBtn :type="isRotaryAxis(a.letter) ? 'zeroRotary' : 'zero'" @click="emit('setAxis', a.index, 0, expectNow())">Zero {{ a.letter }}</MachineBtn>
              <MachineBtn :type="homedJoints[a.index] ? 'unhome' : 'home'" @click="homedJoints[a.index] ? emit('unhomeAxis', a.index) : emit('homeAxis', a.index)"><span class="stable-width"><span :class="{ alt: homedJoints[a.index] }">Home {{ a.letter }}</span><span :class="{ alt: !homedJoints[a.index] }">Unhome {{ a.letter }}</span></span></MachineBtn>
            </template>
          </div>
        </div>
        <div class="actionRow aggregateRow">
          <MachineBtn type="zero" @click="zeroAll()" :title="isSwitchable ? 'Zero the LINEAR axes only (rotary offsets are set per axis, Machine frame + G54 only)' : undefined">{{ zeroAllLabel }}</MachineBtn>
          <MachineBtn :type="isHomed ? 'unhome' : 'home'" @click="isHomed ? emit('unhomeAll') : emit('homeAll')"><span class="stable-width"><span :class="{ alt: isHomed }">Home All</span><span :class="{ alt: !isHomed }">Unhome All</span></span></MachineBtn>
        </div>
        <!-- Action rows: three EQUAL cells spanning the grid (never one
             button per 80px/1fr/1fr track — the G30 button used to sit in
             the 80px column). Labels name the DESTINATION with a motion
             verb (review 2026-09-14 D-02): an arrow said nothing about
             moving, "Home" read as reference homing. MCS/WCS = machine /
             work coordinate system, the WCS selector's own term. -->
        <div class="actionRow">
          <MachineBtn type="goTo" @click="emit('goToG30')" title="MOVES to the G30 position: Z up to machine top first (never lowered), then X/Y, then Z. X/Y/Z only — rotaries untouched. Machine frame only.">Go to G30</MachineBtn>
          <MachineBtn type="goTo" @click="emit('goToHome')" title="MOVES to MACHINE ZERO (G53 X0 Y0 Z0, rotaries to 0; Z up first, never lowered) — the machine coordinate origin, not reference homing and not the INI home positions. Machine frame only.">Go to MCS 0</MachineBtn>
          <MachineBtn type="goZero" @click="emit('goToZero')" title="MOVES to WORK ZERO. Machine frame: Z to machine top (G53 Z0 — skipped when Z is already at or above it, never lowered), table back to the fixture's touch-off angle, then X/Y to work zero. Plane frame: retract along the tool axis to a clearance (never lowered), then X0 Y0 in the plane, rotaries untouched. TCP: not available.">Go to WCS 0</MachineBtn>
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
          <MachineBtn type="twpClear" :disabled="!twpDefined && kinsMode !== 2"
                      @click="emit('twpClear')"
                      :title="twpDefined
                        ? 'Discard the tilted work plane (G69): back to identity kinematics and G54.'
                        : kinsMode === 2
                          ? 'TOOL kinematics without a plane — G69 restores identity kinematics and G54.'
                          : 'No plane defined — nothing to clear.'">Clear plane</MachineBtn>
        </div>
      </div>

      <div class="wcsCol stack-tight strip-radio-group">
        <span class="label-muted">WCS</span>
        <span v-if="kinsChip" class="val-status kinsChip" :class="kinsChip.cls"
              :title="kinsChip.title">{{ kinsChip.text }}</span>
        <div class="strip-radio-options wcsOptions">
          <label v-for="g in g5xOptions" :key="g" class="radio-label" :title="wcsReserved(g) ? RESERVED_TITLE : undefined"
                 :tabindex="wcsReserved(g) ? 0 : undefined" :role="wcsReserved(g) ? 'button' : undefined"
                 :aria-label="wcsReserved(g) ? `Why is ${g} unavailable? ${RESERVED_TITLE}` : undefined"
                 @click="wcsReserved(g) && pushMessage(OPERATOR_DISPLAY, RESERVED_TITLE)"
                 @keydown="(e: KeyboardEvent) => wcsReserved(g) && explainKeydown(e, () => pushMessage(OPERATOR_DISPLAY, RESERVED_TITLE))">
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
.axisGrids { align-items: start; }
.setupGrid {
  flex: 1;
  display: grid;
  grid-template-columns: 80px 1fr 1fr;
  /* Columns get --gap-controls: Zero X and Home X are consequential
     neighbors (fat-finger slip = unplanned homing move). Rows stay
     --gap-tight — axes and action footer share the six-row height budget. */
  gap: var(--gap-tight) var(--gap-controls);
  align-content: start;
}
/* Uniform rows: the touchoff input is catalog size 'sm' (machineControls),
   so the md buttons define the 32px track and the input stretches to it —
   axis rows and the action rows in the neighbouring column now match. */
.setupInput { width: 100%; }
/* Three equal cells across the whole grid (layout only): the goto row and
   the TWP action row are structurally identical. */
.actionRow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gap-controls); }
.aggregateRow { grid-template-columns: repeat(2, minmax(0, 1fr)); }
/* Portrait has less width: destination labels wrap instead of clipping or
   changing the track sizes when a disabled-reason wrapper appears. */
.actionRow :deep(button) { white-space: normal; }
.wcsCol { justify-content: flex-start; }
/* Chip inherits .val-status visuals; only the alignment is local (the
   column reads left-to-right, not right-aligned like status rows). */
.kinsChip { text-align: left; }

@media (orientation: landscape) {
  /* Nine fixtures plus the mode chip exceed the strip height on touch.
     Keep every choice reachable, with G54–G58 in the first column. */
  .wcsOptions {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(5, auto);
    column-gap: var(--gap-controls);
  }
}

@media (orientation: portrait) {
  .setupContent { flex-direction: column; }
  /* Narrow input column to fit 280px strip width */
  .setupGrid { grid-template-columns: 70px 1fr 1fr; }
}
</style>
