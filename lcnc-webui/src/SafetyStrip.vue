<script setup lang="ts">
import { computed } from "vue";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import { Lock, LockOpen, TriangleAlert, Power } from "lucide-vue-next";
import {
  TRAJ_MODE_TELEOP,
  INTERP_IDLE, INTERP_READING, INTERP_PAUSED, INTERP_WAITING,
  TASK_MODE_MANUAL, TASK_MODE_AUTO, TASK_MODE_MDI,
} from "./lcnc";

const props = defineProps<{
  armed: boolean;
  busy: boolean;
  isEstop: boolean;
  isEnabled: boolean;
  isHomed: boolean;
  canEstop: boolean;
  canResetEstop: boolean;
  // Status detail
  isTeleop: boolean;
  taskMode: number;
  interpState: number;
  feedOverride: number;
  spindleOverride: number;
  rapidOverride: number;
  gcodes: string;
  mcodes: string;
  elapsed: string;
}>();

const emit = defineEmits<{
  (e: "arm", value: boolean): void;
  (e: "estop"): void;
  (e: "estopReset"): void;
  (e: "machineOn"): void;
  (e: "machineOff"): void;
}>();

const estopLabel = computed(() => props.isEstop ? "Reset" : "E-Stop");

const modeLabel = computed(() => {
  switch (props.taskMode) {
    case TASK_MODE_MANUAL: return "MANUAL";
    case TASK_MODE_AUTO: return "AUTO";
    case TASK_MODE_MDI: return "MDI";
    default: return "---";
  }
});

const interpLabel = computed(() => {
  switch (props.interpState) {
    case INTERP_IDLE: return "IDLE";
    case INTERP_READING: return "RUNNING";
    case INTERP_PAUSED: return "PAUSED";
    case INTERP_WAITING: return "WAITING";
    default: return "---";
  }
});

const overridesActive = computed(() =>
  Math.round(props.feedOverride * 100) !== 100
  || Math.round(props.spindleOverride * 100) !== 100
  || Math.round(props.rapidOverride * 100) !== 100
);
</script>

<template>
  <div class="safetyStrip">
    <div class="safetyBtns">
      <Gate gate="always" class="btnGate">
        <MachineBtn
          type="arm"
          :variant="armed ? 'ok' : 'default'"
          :disabled="busy"
          :title="armed ? 'Disarm' : 'Arm'"
          @click="emit('arm', !armed)"
          class="safetyBtn"
          block
        >
          <component :is="armed ? LockOpen : Lock" :size="18" />
          <span class="btnLabel">{{ armed ? 'Armed' : 'Arm' }}</span>
        </MachineBtn>
      </Gate>

      <Gate gate="always" class="btnGate">
        <MachineBtn
          type="estop"
          :flashing="isEstop"
          :disabled="!(isEstop ? canResetEstop : canEstop)"
          @click="isEstop ? emit('estopReset') : emit('estop')"
          class="safetyBtn"
          block
        >
          <TriangleAlert :size="18" />
          <span class="btnLabel">{{ estopLabel }}</span>
        </MachineBtn>
      </Gate>

      <Gate gate="safety" class="btnGate">
        <MachineBtn
          type="machineOn"
          :variant="isEnabled ? 'ok' : 'default'"
          @click="isEnabled ? emit('machineOff') : emit('machineOn')"
          class="safetyBtn"
          block
        >
          <Power :size="18" />
          <span class="btnLabel">{{ isEnabled ? 'On' : 'Off' }}</span>
        </MachineBtn>
      </Gate>
    </div>

    <!-- Machine Status Detail -->
    <div class="statusDetail">
      <div class="statusCols">
        <div class="statusCol">
          <div class="statusRow"><span class="k">E-Stop</span><span class="v" :class="isEstop ? 'bad' : 'ok'">{{ isEstop ? 'TRUE' : 'FALSE' }}</span></div>
          <div class="statusRow"><span class="k">Enabled</span><span class="v" :class="isEnabled ? 'ok' : 'muted'">{{ isEnabled ? 'TRUE' : 'FALSE' }}</span></div>
          <div class="statusRow"><span class="k">Homed</span><span class="v" :class="isHomed ? 'ok' : 'bad'">{{ isHomed ? 'TRUE' : 'FALSE' }}</span></div>
          <div class="statusRow"><span class="k">Overrides</span><span class="v" :class="overridesActive ? 'warn' : ''">{{ overridesActive ? 'ACTIVE' : '---' }}</span></div>
        </div>
        <div class="statusCol">
          <div class="statusRow"><span class="k">Mode</span><span class="v">{{ modeLabel }}</span></div>
          <div class="statusRow"><span class="k">Interp</span><span class="v">{{ interpLabel }}</span></div>
          <div class="statusRow"><span class="k">Motion</span><span class="v">{{ isTeleop ? 'WORLD' : 'JOINT' }}</span></div>
          <div class="statusRow"><span class="k">Elapsed</span><span class="v mono">{{ elapsed }}</span></div>
        </div>
      </div>
      <div class="codesRow">
        <span class="codesValue">{{ gcodes }}</span>
        <span class="codesValue">{{ mcodes }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.safetyStrip {
  display: flex;
  flex-direction: column;
  gap: var(--gap-controls);
  height: 100%;
  overflow: hidden;
}

.safetyBtns {
  display: flex;
  gap: var(--gap-controls);
  flex-shrink: 0;
  flex-shrink: 0;
}
.btnGate {
  flex: 1;
  display: flex;
  min-width: 0;
}
.safetyBtn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-tight);
  flex: 1;
}
.btnLabel {
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
}

/* ── Status detail ── */
.statusDetail {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: color-mix(in oklab, var(--bg) 80%, transparent);
  border-radius: var(--radius-lg);
  padding: var(--gap-tight) var(--gap-controls);
}
.statusCols {
  display: flex;
  gap: 0;
}
.statusCol {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
}
.statusCol + .statusCol {
  border-left: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
  padding-left: var(--gap-controls);
  margin-left: var(--gap-controls);
}
.statusRow {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--gap-controls);
}
.k {
  font-size: var(--fs-base);
  opacity: var(--opacity-muted);
  white-space: nowrap;
}
.v {
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  text-align: right;
}
.v.ok { color: var(--ok); }
.v.bad { color: var(--danger); }
.v.warn { color: var(--warn); }
.v.muted { opacity: var(--opacity-muted); }
.v.mono { font-family: var(--font-mono); }

.codesRow {
  display: flex;
  flex-direction: column;
  gap: var(--gap-micro);
  margin-top: var(--gap-tight);
  padding-top: var(--gap-tight);
  border-top: 1px solid color-mix(in oklab, var(--border) 30%, transparent);
}
.codesValue {
  font-size: var(--fs-base);
  font-family: var(--font-mono);
  opacity: var(--opacity-muted);
  word-break: break-all;
  line-height: 1.4;
}
</style>
