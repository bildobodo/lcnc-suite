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
    <div class="safetyHeader">
      <Power :size="14" class="headerIcon" />
      <span class="headerLabel">Safety &amp; Power</span>
    </div>

    <Gate gate="always" class="safetyBtnsGate">
      <div class="safetyBtns">
        <MachineBtn
          type="arm"
          :variant="armed ? 'ok' : 'default'"
          :disabled="busy"
          :title="armed ? 'Disarm' : 'Arm'"
          @click="emit('arm', !armed)"
          class="safetyBtn"
          block
        >
          <component :is="armed ? LockOpen : Lock" :size="20" />
          <span class="btnLabel">{{ armed ? 'Armed' : 'Arm System' }}</span>
        </MachineBtn>

        <MachineBtn
          type="estop"
          :flashing="isEstop"
          :disabled="!(isEstop ? canResetEstop : canEstop)"
          @click="isEstop ? emit('estopReset') : emit('estop')"
          class="safetyBtn"
          block
        >
          <TriangleAlert :size="20" />
          <span class="btnLabel">{{ estopLabel }}</span>
        </MachineBtn>
      </div>
    </Gate>

    <div class="statusBar">
      <div class="statusDots">
        <div class="statusItem">
          <span class="statusDot" :class="{ on: !isEstop }"></span>
          <span class="statusLabel">READY</span>
        </div>
        <div class="statusItem">
          <span class="statusDot" :class="{ on: isHomed }"></span>
          <span class="statusLabel">HOMED</span>
        </div>
        <div class="statusItem">
          <span class="statusDot" :class="{ on: isEnabled }"></span>
          <span class="statusLabel">ENABLED</span>
        </div>
      </div>
      <Gate gate="safety" class="machOnGate">
        <div class="machOnBtns">
          <MachineBtn
            type="machineOn"
            :variant="!isEnabled ? 'default' : 'default'"
            :disabled="isEnabled"
            @click="emit('machineOff')"
            class="machOnBtn"
          >OFF</MachineBtn>
          <MachineBtn
            type="machineOn"
            :variant="isEnabled ? 'ok' : 'default'"
            :disabled="!isEnabled && false"
            @click="emit('machineOn')"
            class="machOnBtn"
          >ON</MachineBtn>
        </div>
      </Gate>
    </div>
  </div>
</template>

<style scoped>
.safetyStrip {
  display: flex;
  flex-direction: column;
  gap: var(--gap-controls);
  padding: var(--gap-controls);
  height: 100%;
}

.safetyHeader {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}
.headerIcon {
  opacity: var(--opacity-muted);
}
.headerLabel {
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: var(--fw-bold);
  opacity: var(--opacity-muted);
}

.safetyBtnsGate {
  flex: 1;
}
.safetyBtns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap-controls);
  height: 100%;
}
.safetyBtn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-tight);
  min-height: 80px;
}
.btnLabel {
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
}

.statusBar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--gap-controls);
  border-radius: var(--radius-lg);
  background: color-mix(in oklab, var(--bg) 80%, transparent);
}
.statusDots {
  display: flex;
  gap: var(--gap-section);
}
.statusItem {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}
.statusDot {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-pill);
  background: color-mix(in oklab, var(--fg) 20%, transparent);
  border: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
}
.statusDot.on {
  background: var(--ok);
  border-color: transparent;
  box-shadow: 0 0 8px color-mix(in oklab, var(--ok) 50%, transparent);
}
.statusLabel {
  font-size: var(--fs-2xs);
  font-family: var(--font-mono);
  opacity: var(--opacity-muted);
}

.machOnGate {
  flex-shrink: 0;
}
.machOnBtns {
  display: flex;
  gap: 1px;
}
.machOnBtn {
  font-size: var(--fs-2xs);
  font-weight: var(--fw-bold);
}
</style>
