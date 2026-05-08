<script setup lang="ts">
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineToggle from "./MachineToggle.vue";
import { RotateCw, RotateCcw, Square, Plus, Minus } from "lucide-vue-next";
import { STEP_RPM } from "./defaults";

const props = defineProps<{
  isForward: boolean;
  isReverse: boolean;
  isSpinning: boolean;
  isRunning: boolean;
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
    <div class="sub">Spindle</div>
    <Gate gate="ready" class="spnBlock stack-controls">
      <div class="spDirRow row-tight">
        <MachineBtn type="spindleRev" :active="isReverse" @click="emit('spindleRev', rpmInput)">
          <span class="btn-label"><RotateCcw :size="14" /> Rev</span>
        </MachineBtn>
        <MachineBtn type="spindleStop" :active="isSpinning" :disabled="!isSpinning" @click="emit('spindleStop')">
          <span class="btn-label"><Square :size="14" /> Stop</span>
        </MachineBtn>
        <MachineBtn type="spindleFwd" :active="isForward" @click="emit('spindleFwd', rpmInput)">
          <span class="btn-label"><RotateCw :size="14" /> Fwd</span>
        </MachineBtn>
      </div>

      <div class="spRpmRow row-tight">
        <MachineBtn type="spindleDecrease" @click="emit('spindleDecrease')">
          <Minus :size="14" />
        </MachineBtn>
        <MachineInput gate="stripInput" type="number" class="spRpmInput" :value="rpmInput" :disabled="isSpinning || isRunning" @input="emit('update:rpmInput', +($event.target as HTMLInputElement).value)" :min="minSpindleSpeed" :max="maxSpindleSpeed" :step="STEP_RPM" />
        <MachineBtn type="spindleIncrease" @click="emit('spindleIncrease')">
          <Plus :size="14" />
        </MachineBtn>
      </div>

    </Gate>

    <div class="sep"></div>

    <div class="coolBlock">
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
.coolBlock {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  flex-shrink: 0;
}
/* .coolToggles — replaced by row-sections utility (same shape) */

@media (orientation: portrait) {
  .spDirRow > * { flex: 1; }
}
</style>
