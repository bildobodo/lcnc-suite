<script setup lang="ts">
// The Setup section's actions — Zero All | Home All, the three Go to and,
// on a TWP machine, the plane trio — as ONE block in a six-track grid: each
// button spans the share of a row setupLayout gave it (6 alone, 3 two to a
// row, 2 three to a row). SetupStrip places the block: under the last axis
// column, in a column of its own, or in rows under all axes. One markup for
// every arrangement — the titles, reasons and gates live here once.
import MachineBtn from "./MachineBtn.vue";
import SetupIcon from "./SetupIcon.vue";
import type { SetupAction, SetupLayout } from "./setupLayout";

const props = defineProps<{
  span: SetupLayout["span"];
  zeroAllLabel: string;
  /** Switchable kins: Zero All names the linear axes only. */
  linearOnly: boolean;
  isHomed: boolean;
  /** The rows form lets a label wrap (portrait's narrow column: "Go to /
   *  G30"); the other forms size their column to the labels instead. */
  wrapLabels: boolean;
  twpDefined?: boolean | null;
  twpStale?: boolean;
  twpOriented?: boolean;
  kinsMode?: number | null;
}>();

const emit = defineEmits<{
  (e: "zeroAll"): void;
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "goToG30"): void;
  (e: "goToHome"): void;
  (e: "goToZero"): void;
  (e: "twpCapture"): void;
  (e: "twpOrient"): void;
  (e: "twpClear"): void;
}>();

const SPAN_CLASS = { 6: "spanRow", 3: "spanHalf", 2: "spanThird" } as const;
function at(a: SetupAction): string {
  return SPAN_CLASS[props.span[a] ?? 6];
}
</script>

<template>
  <div class="setupActions" :class="{ wrapLabels }">
    <!-- The same symbols beside the words: the row the axis symbols are
         read from -->
    <MachineBtn :class="at('zero')" type="zero" @click="emit('zeroAll')" :title="linearOnly ? 'Zero the linear axes only' : undefined"><SetupIcon kind="zero" />{{ zeroAllLabel }}</MachineBtn>
    <MachineBtn :class="at('home')" :type="isHomed ? 'unhome' : 'home'" @click="isHomed ? emit('unhomeAll') : emit('homeAll')"><SetupIcon :kind="isHomed ? 'unhome' : 'home'" /><span class="stable-width"><span :class="{ alt: isHomed }">Home All</span><span :class="{ alt: !isHomed }">Unhome All</span></span></MachineBtn>
    <!-- Labels name the DESTINATION with a motion verb (review 2026-09-14
         D-02): an arrow said nothing about moving, "Home" read as reference
         homing. MCS/WCS = machine / work coordinate system, the WCS
         selector's own term. -->
    <MachineBtn :class="at('g30')" type="goTo" @click="emit('goToG30')" title="Hold to move to the G30 position">Go to G30</MachineBtn>
    <MachineBtn :class="at('mcs')" type="goTo" @click="emit('goToHome')" title="Hold to move to machine zero">Go to MCS 0</MachineBtn>
    <MachineBtn :class="at('wcs')" type="goZero" @click="emit('goToZero')" title="Hold to move to work zero">Go to WCS 0</MachineBtn>
    <template v-if="span.capture">
      <!-- Capture plane: the one-button manual definition — align the
           spindle normal to the face (TCP jog), tip on the datum point,
           press. The backend gate (twp_capture_check) dims it with the
           reason — plane already defined, not G54, offsets in effect. -->
      <MachineBtn :class="at('capture')" type="twpCapture" @click="emit('twpCapture')"
                  :title="twpDefined
                    ? 'A plane is already defined — press Clear plane first (no silent discard).'
                    : 'Capture the plane at the tool tip: orient the spindle normal to the face, touch the datum point, press. Defines the plane from the live spindle direction, sets the workpiece datum (G54) at the tip through the plane, and enters the Plane frame with the DRO reading 0 — nothing moves.'">Capture plane</MachineBtn>
      <!-- Orient: works from a DEFINED plane (first orient) and
           re-orients after a table move. Hold-to-fire: the rotaries MOVE. -->
      <MachineBtn :class="at('orient')" type="twpReorient" :disabled="!twpDefined" @click="emit('twpOrient')"
                  :reason="!twpDefined ? 'No plane defined — capture one first' : undefined"
                  :title="!twpDefined
                    ? 'Define a plane first (Capture plane, G68.2 / G68.3)'
                    : twpStale
                      ? 'Re-solve the head at the current table pose — the tool becomes normal to the plane again. The rotaries MOVE.'
                      : twpOriented
                        ? 'Re-solve the head at the current table pose. The orientation is current, so this should move very little.'
                        : 'Orient the head into the defined plane (G53.1 equivalent). The rotaries MOVE.'">Orient</MachineBtn>
      <!-- Clear plane: plain G69 — idempotent, restores identity kins +
           G54, moves nothing. Also the TOOL-kins-limbo recovery. -->
      <MachineBtn :class="at('clear')" type="twpClear" :disabled="!twpDefined && kinsMode !== 2"
                  :reason="!twpDefined && kinsMode !== 2 ? 'No plane defined — nothing to clear' : undefined"
                  @click="emit('twpClear')"
                  :title="twpDefined
                    ? 'Discard the tilted work plane (G69): back to identity kinematics and G54.'
                    : kinsMode === 2
                      ? 'TOOL kinematics without a plane — G69 restores identity kinematics and G54.'
                      : 'No plane defined — nothing to clear.'">Clear plane</MachineBtn>
    </template>
  </div>
</template>

<style scoped>
/* Six tracks: two to a row span 3, three span 2 — the same cells as the two
   and three equal columns the action rows had (gap 8 between buttons, 4
   between rows: the axis rows' rhythm, the six-row height budget). */
.setupActions { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: var(--gap-tight) var(--gap-controls); align-content: start; }
.spanRow { grid-column: span 6; }
.spanHalf { grid-column: span 3; }
.spanThird { grid-column: span 2; }
/* Portrait has less width: destination labels wrap instead of clipping or
   changing the track sizes when a disabled-reason wrapper appears. */
.wrapLabels :deep(button) { white-space: normal; }
</style>
