<script setup lang="ts">
import { computed } from "vue";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import { Lock, LockOpen, TriangleAlert, Power } from "lucide-vue-next";
import { activeKind } from "./inputSession";
import { useMediaMql } from "./useMediaMql";
import {
  INTERP_IDLE, INTERP_READING, INTERP_PAUSED, INTERP_WAITING,
  TASK_MODE_MANUAL, TASK_MODE_AUTO, TASK_MODE_MDI,
} from "./lcnc";

const props = defineProps<{
  armed: boolean;
  busy: boolean;
  tripUnacked: boolean;
  isEstop: boolean;
  isEnabled: boolean;
  isHomed: boolean;
  canEstop: boolean;
  canResetEstop: boolean;
  // Status detail
  isTeleop: boolean;
  taskMode: number;
  interpState: number;
  feedOverride: number | null;
  spindleOverride: number | null;
  rapidOverride: number | null;
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
  (props.feedOverride != null && Math.round(props.feedOverride * 100) !== 100)
  || (props.spindleOverride != null && Math.round(props.spindleOverride * 100) !== 100)
  || (props.rapidOverride != null && Math.round(props.rapidOverride * 100) !== 100)
);

// Portrait with an input helper open: the status detail folds away and the
// section is its title and the three safety buttons. The detail (172 CSS
// px) is what left the portrait keyboard 97 px below the fold at 150 % on
// 900 × 1200 (implementation review UI-I08); a four-row form was measured
// too and misses by 11 px whenever the header wraps one line more (its
// wrap count at 600 CSS px follows the pill texts — it flipped between two
// measurements), so the fold is the form with margin (≥ 47 px).
// What the detail said stays readable: the banner above names the machine
// state (IDLE / RUNNING / NOT HOMED / E-STOP / OFF), E-Stop and power are
// the buttons' own labels; Motion, Elapsed, overrides and the active codes
// return when the helper closes. The safety buttons never move (WP4 pinned
// controls); landscape is unchanged (fixed section height).
const isPortrait = useMediaMql("(orientation: portrait)");
const compact = computed(() => isPortrait.value && activeKind.value !== null);
</script>

<template>
  <div class="safetyStrip stripSection">
    <div class="sub">Safety</div>
    <div class="safetyBtns row-controls">
      <div class="btnGate">
        <!-- Gateway rejects arm while a safety trip is unacknowledged; mirror
             that here so the greyed button points at the recovery path
             (Acknowledge) instead of a rejected click. Disarm stays allowed. -->
        <MachineBtn
          type="arm"
          :variant="armed ? 'ok' : 'default'"
          :disabled="busy || (!armed && tripUnacked)"
          :title="armed ? 'Disarm' : (tripUnacked ? 'Acknowledge the safety trip first' : 'Arm')"
          @click="emit('arm', !armed)"
          class="safetyBtn"
          block
        >
          <component :is="armed ? LockOpen : Lock" :size="18" />
          <span class="btn-label-sm stable-width"><span :class="{ alt: !armed }">Armed</span><span :class="{ alt: armed }">Arm</span></span>
        </MachineBtn>
      </div>

      <div class="btnGate">
        <MachineBtn
          type="estop"
          :flashing="isEstop"
          :disabled="!(isEstop ? canResetEstop : canEstop)"
          @click="isEstop ? emit('estopReset') : emit('estop')"
          class="safetyBtn"
          block
        >
          <TriangleAlert :size="18" />
          <span class="btn-label-sm stable-width"><span :class="{ alt: isEstop }">E-Stop</span><span :class="{ alt: !isEstop }">Reset</span></span>
        </MachineBtn>
      </div>

      <Gate gate="safety" class="btnGate">
        <MachineBtn
          type="machineOn"
          :variant="isEnabled ? 'ok' : 'default'"
          @click="isEnabled ? emit('machineOff') : emit('machineOn')"
          class="safetyBtn"
          block
        >
          <Power :size="18" />
          <span class="btn-label-sm stable-width"><span :class="{ alt: !isEnabled }">On</span><span :class="{ alt: isEnabled }">Off</span></span>
        </MachineBtn>
      </Gate>
    </div>

    <!-- Machine Status Detail -->
    <div v-if="!compact" class="statusDetail inset-panel scroll-thin">
      <div class="statusCols">
        <div class="statusCol stack-tight">
          <div class="statusRow"><span class="label-muted md">E-Stop</span><span class="val-status md" :class="isEstop ? 'bad' : 'ok'"><span class="stable-width"><span :class="{ alt: !isEstop }">TRUE</span><span :class="{ alt: isEstop }">FALSE</span></span></span></div>
          <div class="statusRow"><span class="label-muted md">Enabled</span><span class="val-status md" :class="isEnabled ? 'ok' : 'muted'"><span class="stable-width"><span :class="{ alt: !isEnabled }">TRUE</span><span :class="{ alt: isEnabled }">FALSE</span></span></span></div>
          <div class="statusRow"><span class="label-muted md">Homed</span><span class="val-status md" :class="isHomed ? 'ok' : 'bad'"><span class="stable-width"><span :class="{ alt: !isHomed }">TRUE</span><span :class="{ alt: isHomed }">FALSE</span></span></span></div>
          <div class="statusRow"><span class="label-muted md">Overrides</span><span class="val-status md" :class="overridesActive ? 'warn' : ''"><span class="stable-width"><span :class="{ alt: !overridesActive }">ACTIVE</span><span :class="{ alt: overridesActive }">---</span></span></span></div>
        </div>
        <div class="statusCol stack-tight">
          <div class="statusRow"><span class="label-muted md">Mode</span><span class="val-status md"><span class="stable-width"><span :class="{ alt: modeLabel !== 'MANUAL' }">MANUAL</span><span :class="{ alt: modeLabel !== 'AUTO' }">AUTO</span><span :class="{ alt: modeLabel !== 'MDI' }">MDI</span><span :class="{ alt: modeLabel !== '---' }">---</span></span></span></div>
          <div class="statusRow"><span class="label-muted md">Interp</span><span class="val-status md"><span class="stable-width"><span :class="{ alt: interpLabel !== 'IDLE' }">IDLE</span><span :class="{ alt: interpLabel !== 'RUNNING' }">RUNNING</span><span :class="{ alt: interpLabel !== 'PAUSED' }">PAUSED</span><span :class="{ alt: interpLabel !== 'WAITING' }">WAITING</span><span :class="{ alt: interpLabel !== '---' }">---</span></span></span></div>
          <div class="statusRow"><span class="label-muted md">Motion</span><span class="val-status md"><span class="stable-width"><span :class="{ alt: !isTeleop }">WORLD</span><span :class="{ alt: isTeleop }">JOINT</span></span></span></div>
          <div class="statusRow"><span class="label-muted md">Elapsed</span><span class="val-status md mono">{{ elapsed }}</span></div>
        </div>
      </div>
      <div class="sep"></div>
      <div class="codesRow stack-micro">
        <span class="codes-value">{{ gcodes }}</span>
        <div class="sep"></div>
        <span class="codes-value">{{ mcodes }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.safetyStrip {
  width: 280px;
  flex-shrink: 0;
}

@media (orientation: portrait) {
  .safetyStrip { width: 100%; }
}

.safetyBtns {
  flex-shrink: 0;
}
.btnGate {
  flex: 1;
  display: flex;
  min-width: 0;
}
/* Deliberate stack-tight reimpl: this class lands on a MachineBtn root,
   where Btn.vue's scoped .b (display: inline-flex, higher specificity than
   a global utility class) would beat .stack-tight. */
/* audit-ok: utility class would lose to Btn.vue's scoped .b display */
.safetyBtn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-tight);
  flex: 1;
}
/* ── Status detail ── */
.statusDetail {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
}
.codesRow {
  /* Prevent codes from widening the strip — wrap within status column width */
  width: 0;
  min-width: 100%;
}
.codes-value {
  word-break: keep-all;
  overflow-wrap: normal;
}
</style>
