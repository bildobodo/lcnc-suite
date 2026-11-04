<script setup lang="ts">
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineToggle from "./MachineToggle.vue";
import { RotateCw, RotateCcw, Square, Plus, Minus } from "lucide-vue-next";
import { STEP_RPM } from "./defaults";
import { fmtRpm } from "./format";

const props = defineProps<{
  isForward: boolean;
  isReverse: boolean;
  isSpinning: boolean;
  /** The commanded speed (STAT), shown in the head while the spindle turns. */
  commandedRpm: number | null;
  rpmInput: number;
  minSpindleSpeed: number;
  maxSpindleSpeed: number;
  floodOn: boolean;
  mistOn: boolean;
}>();

const emit = defineEmits<{
  (e: "spindleFwd", speed: number): void;
  (e: "spindleRev", speed: number): void;
  (e: "spindleStop"): void;
  (e: "spindleIncrease"): void;
  (e: "spindleDecrease"): void;
  (e: "update:rpmInput", v: number): void;
  (e: "toggleFlood"): void;
  (e: "toggleMist"): void;
}>();
</script>

<template>
  <div class="stripSection">
    <!-- The head carries the commanded speed while the spindle turns: the
         field below is the PRESELECTION and may hold a value not yet sent
         (Codex R213 BG-27). In the head's own line — appearing, it moves
         nothing. -->
    <div class="sub spHead">Spindle<span v-if="isSpinning" class="spNow mono" title="Commanded speed"> · {{ fmtRpm(commandedRpm) }} rpm</span></div>
    <!-- Every button self-gates from the catalog: the stop at idle needs no
         homing and no arm (button gates BG-18), Rev / Fwd / ± keep `ready`;
         the RPM is a preselection for the next Fwd / Rev (BG-05), free in
         every state — running, turning, disarmed. -->
    <div class="spnBlock stack-controls">
      <div class="spDirRow row-controls">
        <MachineBtn type="spindleRev" :active="isReverse" @click="emit('spindleRev', rpmInput)">
          <span class="btn-label"><RotateCcw :size="14" /> Rev</span>
        </MachineBtn>
        <MachineBtn type="spindleStop" :active="isSpinning" :disabled="!isSpinning"
                    :reason="!isSpinning ? 'Spindle is already stopped' : undefined" @click="emit('spindleStop')">
          <span class="btn-label"><Square :size="14" /> Stop</span>
        </MachineBtn>
        <MachineBtn type="spindleFwd" :active="isForward" @click="emit('spindleFwd', rpmInput)">
          <span class="btn-label"><RotateCw :size="14" /> Fwd</span>
        </MachineBtn>
      </div>

      <div class="spRpmRow row-controls">
        <!-- a glyph names nothing: the name says the action -->
        <MachineBtn type="spindleDecrease" aria-label="Decrease spindle speed" title="Decrease spindle speed" @click="emit('spindleDecrease')">
          <Minus :size="14" />
        </MachineBtn>
        <MachineInput gate="stripInput" type="number" class="spRpmInput" label="Spindle speed" context="Spindle speed · RPM" :value="rpmInput" @input="emit('update:rpmInput', +($event.target as HTMLInputElement).value)" :min="minSpindleSpeed" :max="maxSpindleSpeed" :step="STEP_RPM" />
        <MachineBtn type="spindleIncrease" aria-label="Increase spindle speed" title="Increase spindle speed" @click="emit('spindleIncrease')">
          <Plus :size="14" />
        </MachineBtn>
      </div>

    </div>

    <div class="sep"></div>

    <div class="coolBlock stack-tight">
      <div class="sub">Coolant</div>
      <div class="row-sections">
        <MachineToggle gate="coolant" :modelValue="floodOn" @update:modelValue="emit('toggleFlood')" label="Flood" />
        <MachineToggle gate="coolant" :modelValue="mistOn" @update:modelValue="emit('toggleMist')" label="Mist" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.spnBlock {
  flex: 1;
}
.spRpmRow {
  align-items: stretch;
}
.spRpmInput { flex: 1; min-width: 0; width: 0; }
.spHead { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.coolBlock {
  flex-shrink: 0;
}
/* .coolToggles — replaced by row-sections utility (same shape) */

@media (orientation: portrait) {
  /* Three equal columns. Not `> * { flex: 1 }`: a flex share is added to
     each item's padding+border, so a disabled button's reason wrapper (a
     padding-less span) came out 11 px narrower than its neighbours and the
     row re-flowed on every spindle state change (layout gate, 2026-09-20). */
  .spDirRow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
