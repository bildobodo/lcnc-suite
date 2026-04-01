<script setup lang="ts">
import { computed } from "vue";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import { Lock, LockOpen, TriangleAlert, Power } from "lucide-vue-next";

const props = defineProps<{
  armed: boolean;
  busy: boolean;
  isEstop: boolean;
  isEnabled: boolean;
  isHomed: boolean;
  canEstop: boolean;
  canResetEstop: boolean;
}>();

const emit = defineEmits<{
  (e: "arm", value: boolean): void;
  (e: "estop"): void;
  (e: "estopReset"): void;
  (e: "machineOn"): void;
  (e: "machineOff"): void;
}>();

const estopLabel = computed(() => props.isEstop ? "Reset" : "E-Stop");
</script>

<template>
  <div class="safetyStrip">
    <Gate gate="always">
      <div class="safetyBtns">
        <MachineBtn
          type="arm"
          :variant="armed ? 'ok' : 'default'"
          :disabled="busy"
          :title="armed ? 'Disarm' : 'Arm'"
          @click="emit('arm', !armed)"
          block
        >
          <component :is="armed ? LockOpen : Lock" class="safetyIcon" />
          <span class="safetyLabel">{{ armed ? 'Armed' : 'Disarmed' }}</span>
        </MachineBtn>

        <MachineBtn
          type="estop"
          :flashing="isEstop"
          :disabled="!(isEstop ? canResetEstop : canEstop)"
          @click="isEstop ? emit('estopReset') : emit('estop')"
          block
        >
          <TriangleAlert class="safetyIcon" />
          <span class="safetyLabel">{{ estopLabel }}</span>
        </MachineBtn>
      </div>
    </Gate>

    <Gate gate="safety">
      <MachineBtn
        type="machineOn"
        :variant="isEnabled ? 'ok' : 'default'"
        @click="isEnabled ? emit('machineOff') : emit('machineOn')"
        block
      >
        <Power class="safetyIcon" />
        <span class="safetyLabel">{{ isEnabled ? "On" : "Off" }}</span>
      </MachineBtn>
    </Gate>

    <div class="stripStatus">
      <span class="statusDot" :class="{ on: !isEstop }" title="E-Stop"></span>
      <span class="statusDot" :class="{ on: isEnabled }" title="Enabled"></span>
      <span class="statusDot" :class="{ on: isHomed }" title="Homed"></span>
    </div>
  </div>
</template>

<style scoped>
.safetyStrip {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  align-items: stretch;
  width: 90px;
  flex-shrink: 0;
}
.safetyBtns {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  flex: 1;
}
.safetyIcon {
  width: var(--fs-xl);
  height: var(--fs-xl);
}
.safetyLabel {
  font-size: var(--fs-2xs);
}
.stripStatus {
  display: flex;
  gap: var(--gap-controls);
  justify-content: center;
  padding-top: var(--gap-tight);
  border-top: 1px solid var(--border);
}
.statusDot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  background: var(--danger);
}
.statusDot.on {
  background: var(--ok);
}
</style>
