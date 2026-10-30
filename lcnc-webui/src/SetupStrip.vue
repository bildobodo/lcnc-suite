<script setup lang="ts">
import { computed, inject, ref, watch, type Ref } from "vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import ChoiceGroup from "./ChoiceGroup.vue";
import type { ChoiceOption } from "./choiceGroup";
import SetupIcon from "./SetupIcon.vue";
import SetupActions from "./SetupActions.vue";
import { setupLayout } from "./setupLayout";
import HelpIcon from "./HelpIcon.vue";
import { useAxes, isRotaryAxis } from "./useAxes";
import { kinsModeChip, type OffDatum } from "./twpPose";
import { touchoffTargetLabel, type TouchoffExpect } from "./useTouchoffMath";
import { keypadState, closeKeypad } from "./useNumberKeypad";
import { usePermissions } from "./permissions";
import { pushMessage } from "./lcncWs";
import { OPERATOR_ERROR } from "./lcnc";
import { G5X_LABELS, RESERVED_WCS } from "./wcs";
import { fmtAxisValue } from "./format";

// Match HUD precision (3 decimals linear, 2 rotary) without the unit suffix
// so the keypad parser still receives a clean numeric string — format.ts
// fmtAxisValue (deliberately NOT fmtCoord: no ° suffix here).
const fmtAxisInput = fmtAxisValue;

const props = defineProps<{
  /** Send a work-offset choice ("G55"); its req_id (fire()) — the group
   *  correlates the reply with its option (Codex R25 OP-I04). */
  wcsAct: (gcode: string) => string | null;
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
  // The number keypad is open for one of this section's fields: in portrait
  // the section keeps only its axis rows (design wave D7) — the keypad and
  // the field it edits must share the strip column at 150 %.
  entryOpen?: boolean;
}>();

const emit = defineEmits<{
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "homeAxis", joint: number): void;
  (e: "unhomeAxis", joint: number): void;
  (e: "setAxis", axis: number, value: number, expect: TouchoffExpect): void;
  (e: "setAll", letters: string[], expect: TouchoffExpect): void;
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
// The arrangement by axis count (setupLayout.ts, operator 2026-10-29/30,
// Codex R233/R234): landscape fills six rows and pays for width — the axes
// in columns of up to six, the actions under the last column, in a column
// of their own or (TWP up to six axes) in rows under all axes. Portrait
// keeps one axis list with the action rows under it; its strip scrolls
// vertically.
const isPortrait = inject<Ref<boolean>>("isPortrait", ref(false));
// Switchable kins at all (kins_type sampled): Zero All stays linear-only
// there — rotary touch-off is identity + G54 only on EVERY switchable
// machine. TWP-capable: the remap stack, which owns G59..G59.3 and gives
// Capture/Orient/Clear their meaning — a TCP trunnion used to get both
// surfaces just for being switchable (TWP-08b).
const isSwitchable = computed(() => props.kinsType != null);
const isTwpMachine = computed(() => props.twpCapable === true);
const layout = computed(() => setupLayout(entries.value.length, isTwpMachine.value, isPortrait.value));
const axisChunks = computed(() => {
  const e = entries.value, out: (typeof e)[] = [];
  let at = 0;
  for (const n of layout.value.columns) { out.push(e.slice(at, at + n)); at += n; }
  return out;
});

const g5xOptions = G5X_LABELS;
// G59..G59.3 are the TWP remap's scratch rows — g53x_core rewrites them at
// every orient, and a touch-off into them evaporates (XYZ) or poisons the
// next orient (A/B/C). On a TWP machine (switchable kins present) they are
// not an operator choice; the Plane jog frame selects G59 itself.
// (RESERVED_WCS lives in wcs.ts — one source with the labels.)
function wcsReserved(g: string): boolean {
  return isTwpMachine.value && RESERVED_WCS.has(g);
}
const RESERVED_TITLE = "Reserved for the tilted work plane — use G54–G58";
const wcsChoices = computed<ChoiceOption<string>[]>(() => g5xOptions.map(g => ({
  value: g, label: g, gate: "wcsSelect" as const,
  disabled: wcsReserved(g), reason: wcsReserved(g) ? RESERVED_TITLE : undefined,
})));

// Kins-mode chip (P3 operator surface): the silent-mode-traversal trap —
// the TWP demo parks the machine in TOOL kins (M2 restores G54, not the
// kins type) with zero indication anywhere. ONE derivation (twpPose.ts
// kinsModeChip) shared with the viewer HUD; "datum moved" rides in it.
const kinsChip = computed(() => kinsModeChip({
  kinsType: props.kinsMode, twpActive: props.twpActive,
  twpStale: props.twpStale, twpDatumMoved: props.twpDatumMoved,
  offDatum: props.twpOffDatum, g5xIndex: props.g5xIndex,
}));

// The TWP action buttons (Capture plane / Orient / Clear plane) live in the
// action block (SetupActions.vue) as one equal-width row in every
// arrangement — the same structure as the goto row. (Orient
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
// The action block's inputs and events — one object for the block wherever
// the arrangement puts it (under the last axis column or after the axes).
const actionProps = computed(() => ({
  span: layout.value.span, zeroAllLabel: zeroAllLabel.value, linearOnly: isSwitchable.value,
  isHomed: props.isHomed, wrapLabels: layout.value.form === "rows",
  twpDefined: props.twpDefined, twpStale: props.twpStale, twpOriented: props.twpOriented, kinsMode: props.kinsMode,
}));
const actionEvents = {
  zeroAll, homeAll: () => emit("homeAll"), unhomeAll: () => emit("unhomeAll"),
  goToG30: () => emit("goToG30"), goToHome: () => emit("goToHome"), goToZero: () => emit("goToZero"),
  twpCapture: () => emit("twpCapture"), twpOrient: () => emit("twpOrient"), twpClear: () => emit("twpClear"),
};
</script>

<template>
  <div class="stripSection" :class="{ entryOpen }" ref="rootEl">
    <!-- One grid for the section: the title line carries "Setup" over the
         controls and "WCS" with the frame chip over the fixtures (operator
         2026-10-30); in portrait the four stack. DOM order = Tab order:
         the axis rows, the actions, then the WCS title and its group. -->
    <div class="setupContent">
      <!-- The Go-to destinations are explained by a tap-friendly help on the
           section title (UX-11): the buttons keep SHORT hover names — the
           explanation lives here once (design wave D1, UI-N33). -->
      <div class="sub sectionHelp setupTitle">Setup <HelpIcon label="Go to positions"><strong>G30</strong> — the tool-change position<br><strong>MCS 0</strong> — machine zero<br><strong>WCS 0</strong> — program zero<br>Z always goes up first, never down.</HelpIcon></div>
      <div class="setupControls" :class="layout.form === 'column' ? 'row-sections' : 'stack-tight'">
        <div class="axisGrids row-controls">
          <div v-for="(chunk, ci) in axisChunks" :key="ci" class="setupGrid" :class="{ natural: layout.form !== 'rows' }">
            <template v-for="a in chunk" :key="a.letter">
              <MachineInput :gate="isRotaryAxis(a.letter) ? 'touchoffRotary' : 'touchoff'" type="number" :label="targetLabel(a.letter)" :value="fmtAxisInput(workPos[a.index], a.letter)" @input="emit('setAxis', a.index, +($event.target as HTMLInputElement).value, expectNow())" class="setupInput" />
              <!-- A symbol and the axis letter (operator 2026-10-01: the words
                   took the strip's width); the name and the hover title say
                   the action. The two houses are one size: no width jump. -->
              <MachineBtn :type="isRotaryAxis(a.letter) ? 'zeroRotary' : 'zero'"
                          :aria-label="`Zero ${a.letter}`" :title="`Hold to zero ${a.letter}`"
                          @click="emit('setAxis', a.index, 0, expectNow())"><SetupIcon kind="zero" />{{ a.letter }}</MachineBtn>
              <MachineBtn :type="homedJoints[a.index] ? 'unhome' : 'home'"
                          :aria-label="`${homedJoints[a.index] ? 'Unhome' : 'Home'} ${a.letter}`"
                          :title="`Hold to ${homedJoints[a.index] ? 'unhome' : 'home'} ${a.letter}`"
                          @click="homedJoints[a.index] ? emit('unhomeAxis', a.index) : emit('homeAxis', a.index)"><SetupIcon :kind="homedJoints[a.index] ? 'unhome' : 'home'" />{{ a.letter }}</MachineBtn>
            </template>
            <!-- The actions in the free rows under the last axis column. -->
            <SetupActions v-if="layout.form === 'under' && ci === axisChunks.length - 1" class="actionsUnder foldOnEntry"
                          v-bind="actionProps" v-on="actionEvents" />
          </div>
        </div>
        <!-- Rows under all axes, or a column of their own. Folded in portrait
             while the keypad edits an axis field (D7): none of these acts on
             a value being typed, and at 150 % the column could not hold the
             edited field above the keypad. -->
        <SetupActions v-if="layout.form !== 'under'" class="foldOnEntry" v-bind="actionProps" v-on="actionEvents" />
      </div>

      <!-- The title takes no width of its own: the fixtures size the column,
           and a long frame chip ("MACHINE · off datum · datum moved") runs
           out to the LEFT over the empty title line — the section never
           widens when the state changes (everything right of Setup would
           move under a hand), and in portrait the fixtures never move. -->
      <div class="wcsTitle foldOnEntry">
        <div class="wcsTitleInner row-tight">
          <span class="sub">WCS</span>
          <!-- Fixed slot on switchable-kins machines: the chip appearing must
               not change the title line (P2). -->
          <span v-if="isSwitchable" class="val-status kinsChip" :class="kinsChip?.cls"
                :title="kinsChip?.title">{{ kinsChip?.text ?? '\u00a0' }}<HelpIcon v-if="kinsChip?.help" label="Kinematics state">{{ kinsChip.help }}</HelpIcon></span>
        </div>
      </div>
      <div class="wcsCol foldOnEntry">
        <!-- The work offsets — operator point P7: a machine command, radios
             in a toolbar, manual activation, the checked cell the confirmed
             fixture; a reserved row explains itself where pressed.
             Landscape 2 × 5 by column (G54–G58 level with the axis rows, then
             G59–G59.3). Portrait two rows of five under the title (operator
             2026-10-30): G54–G58, then G59–G59.3 — on a TWP machine exactly
             the reserved row. -->
        <ChoiceGroup class="wcsOptions" label="Work offset" :rows="isPortrait ? undefined : 5"
                     :columns="isPortrait ? 5 : undefined" :fill="isPortrait" :options="wcsChoices" :modelValue="g5xLabel"
                     :act="v => wcsAct(String(v))" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The section's grid: the title line ("Setup" over the controls, "WCS" and
   the frame chip over the fixtures), then the controls and the fixtures;
   the row gap is the strip sections' heading gap. */
.setupContent {
  display: grid;
  grid-template-columns: max-content max-content;
  grid-template-areas: "title wcshead" "controls wcs";
  gap: var(--gap-controls) var(--gap-section);
  align-content: start;
}
/* The "?" right after the word: the rest of the line is where a long chip
   runs out to. */
.setupTitle { grid-area: title; justify-self: start; }
.setupControls { grid-area: controls; }
.wcsTitle { grid-area: wcshead; width: 0; min-width: 100%; display: flex; justify-content: flex-end; }
.wcsTitleInner { flex: none; min-width: 100%; align-items: center; white-space: nowrap; }
.wcsCol { grid-area: wcs; }
/* Portrait with the keypad on an axis field: the axis rows and the keypad
   (next in the column) — the field being edited stays in view at 150 %
   (design wave D7: the Zero All / Go-to / WCS rows pushed it under the
   sticky Safety section while the column showed the whole keypad). */
@media (orientation: portrait) {
  .entryOpen .foldOnEntry { display: none; }
}
.axisGrids { align-items: start; }
.setupGrid {
  flex: 1;
  display: grid;
  grid-template-columns: 80px 1fr 1fr;
  /* Columns get --gap-controls: Zero X and Home X are consequential
     neighbors (fat-finger slip = unplanned homing move). Rows stay
     --gap-tight — axes and actions share the six-row height budget. */
  gap: var(--gap-tight) var(--gap-controls);
  align-content: start;
}
/* Under and beside the axes the columns take their content's width (an
   action pair under U/V/W widens its column, never the first one); the
   rows form stretches the axis groups over the action rows' width. */
.setupGrid.natural { flex: 0 0 auto; grid-template-columns: 80px auto auto; }
.actionsUnder { grid-column: 1 / -1; }
/* Uniform rows: the touchoff input is catalog size 'sm' (machineControls),
   so the md buttons define the 32px track and the input stretches to it —
   axis rows and the action rows now match. */
.setupInput { width: 100%; }
/* Chip inherits .val-status visuals; only the alignment is local (the
   line reads left-to-right, not right-aligned like status rows). */
/* text + "?" one centred row: the icon never drops onto a line of its own */
.kinsChip { text-align: left; display: flex; align-items: center; }

@media (orientation: portrait) {
  .setupContent { grid-template-columns: minmax(0, 1fr); grid-template-areas: "title" "controls" "wcshead" "wcs"; }
  /* The section rhythm between the controls and the WCS block (12 = the
     row gap 8 + 4); the title spans the column ("?" at its end, as before). */
  .setupTitle { justify-self: stretch; }
  .wcsTitle { margin-top: var(--gap-tight); width: auto; justify-content: flex-start; }
  .wcsTitleInner { flex: 1 1 auto; min-width: 0; flex-wrap: wrap; white-space: normal; }
  /* Narrow input column to fit the 280 px strip column: 280 − 2 × 8 padding
     − border − the reserved scrollbar band (~14 px, WP4) ≈ 248 px inside;
     "Unhome X" needs 84 px, so the input column and the grid gap give way
     (--gap-tight is the minimum between clickables): (248 − 64 − 8) / 2 = 88. */
  .setupGrid { grid-template-columns: 64px 1fr 1fr; gap: var(--gap-tight); }
  /* The fixtures as two rows of their own, each the full width: G54–G58
     five to a row, G59–G59.3 four (twenty tracks: span 4 and span 5). Five
     columns sized by their widest option were 254 px — 2 px past the
     252 px section a classic scrollbar leaves. Up/Down still step by five. */
  .wcsOptions :deep(.choiceRow.grid) { grid-template-columns: repeat(20, minmax(0, 1fr)); }
  .wcsOptions :deep(.choice:nth-child(-n + 5)) { grid-column: span 4; }
  .wcsOptions :deep(.choice:nth-child(n + 6)) { grid-column: span 5; }
}
</style>
