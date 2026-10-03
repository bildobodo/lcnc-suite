<script setup lang="ts">
import { computed } from "vue";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import { Lock, LockOpen, TriangleAlert, Power, BookOpen } from "lucide-vue-next";
import { activeKind } from "./inputSession";
import { useMediaMql } from "./useMediaMql";
import { NO_VALUE } from "./format";
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
  (e: "openActiveCodes"): void;
}>();

const modeLabel = computed(() => {
  switch (props.taskMode) {
    case TASK_MODE_MANUAL: return "MANUAL";
    case TASK_MODE_AUTO: return "AUTO";
    case TASK_MODE_MDI: return "MDI";
    default: return NO_VALUE;
  }
});

const interpLabel = computed(() => {
  switch (props.interpState) {
    case INTERP_IDLE: return "IDLE";
    case INTERP_READING: return "RUNNING";
    case INTERP_PAUSED: return "PAUSED";
    case INTERP_WAITING: return "WAITING";
    default: return NO_VALUE;
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
  <div class="safetyStrip stripSection stripFixed">
    <div class="sub">Safety</div>
    <div class="safetyBtns row-controls">
      <div class="btnGate">
        <!-- Gateway rejects arm while a safety trip is unacknowledged; mirror
             that here so the greyed button points at the recovery path
             (Acknowledge) instead of a rejected click. Disarm stays allowed.
             The label is the NEXT ACTION (Arm / Disarm), like E-Stop / Reset
             — the state stays visible in the variant, the header pill and
             the status rows (UX-10, operator decision 2026-09-21). -->
        <MachineBtn
          type="arm"
          :active="armed"
          :disabled="busy || (!armed && tripUnacked)"
          :reason="!armed && tripUnacked ? 'Acknowledge the safety trip first' : undefined"
          @click="emit('arm', !armed)"
          class="safetyBtn"
          block
        >
          <component :is="armed ? LockOpen : Lock" :size="18" />
          <span class="btn-label-sm stable-width"><span :class="{ alt: armed }">Arm</span><span :class="{ alt: !armed }">Disarm</span></span>
        </MachineBtn>
      </div>

      <div class="btnGate">
        <MachineBtn
          type="estop"
          :flashing="isEstop"
          :disabled="!(isEstop ? canResetEstop : canEstop)"
          :aria-label="isEstop ? 'Reset E-Stop' : undefined"
          :title="isEstop ? 'Reset E-Stop' : undefined"
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
          :active="isEnabled"
          @click="isEnabled ? emit('machineOff') : emit('machineOn')"
          class="safetyBtn"
          block
        >
          <Power :size="18" />
          <span class="btn-label-sm stable-width"><span :class="{ alt: isEnabled }">Power on</span><span :class="{ alt: !isEnabled }">Power off</span></span>
        </MachineBtn>
      </Gate>
    </div>

    <!-- Machine Status Detail — state WORDS, the banner's vocabulary (ACTIVE/CLEAR,
         ON/OFF, HOMED/UNHOMED), never TRUE/FALSE (design wave D0, UI-N06) -->
    <div v-if="!compact" class="statusDetail inset-panel scroll-thin">
      <div class="statusCols">
        <div class="statusCol stack-tight">
          <div class="statusRow"><span class="label-muted md">E-Stop</span><span class="val-status md" :class="isEstop ? 'bad' : 'ok'"><span class="stable-width"><span :class="{ alt: !isEstop }">ACTIVE</span><span :class="{ alt: isEstop }">CLEAR</span></span></span></div>
          <div class="statusRow"><span class="label-muted md">Power</span><span class="val-status md" :class="isEnabled ? 'ok' : 'muted'"><span class="stable-width"><span :class="{ alt: !isEnabled }">ON</span><span :class="{ alt: isEnabled }">OFF</span></span></span></div>
          <div class="statusRow"><span class="label-muted md">Axes</span><span class="val-status md" :class="isHomed ? 'ok' : 'bad'"><span class="stable-width"><span :class="{ alt: !isHomed }">HOMED</span><span :class="{ alt: isHomed }">UNHOMED</span></span></span></div>
          <div class="statusRow"><span class="label-muted md">Overrides</span><span class="val-status md" :class="overridesActive ? 'warn' : ''"><span class="stable-width"><span :class="{ alt: !overridesActive }">ACTIVE</span><span :class="{ alt: overridesActive }">NONE</span></span></span></div>
        </div>
        <div class="statusCol stack-tight">
          <div class="statusRow"><span class="label-muted md">Mode</span><span class="val-status md"><span class="stable-width"><span :class="{ alt: modeLabel !== 'MANUAL' }">MANUAL</span><span :class="{ alt: modeLabel !== 'AUTO' }">AUTO</span><span :class="{ alt: modeLabel !== 'MDI' }">MDI</span><span :class="{ alt: modeLabel !== NO_VALUE }">{{ NO_VALUE }}</span></span></span></div>
          <div class="statusRow"><span class="label-muted md">Interp</span><span class="val-status md"><span class="stable-width"><span :class="{ alt: interpLabel !== 'IDLE' }">IDLE</span><span :class="{ alt: interpLabel !== 'RUNNING' }">RUNNING</span><span :class="{ alt: interpLabel !== 'PAUSED' }">PAUSED</span><span :class="{ alt: interpLabel !== 'WAITING' }">WAITING</span><span :class="{ alt: interpLabel !== NO_VALUE }">{{ NO_VALUE }}</span></span></span></div>
          <div class="statusRow"><span class="label-muted md">Motion</span><span class="val-status md"><span class="stable-width"><span :class="{ alt: !isTeleop }">WORLD</span><span :class="{ alt: isTeleop }">JOINT</span></span></span></div>
          <div class="statusRow"><span class="label-muted md">Elapsed</span><span class="val-status md mono">{{ elapsed }}</span></div>
        </div>
      </div>
      <div class="sep"></div>
      <!-- One tap opens the G-code reference on "Active now" (operator
           2026-10-03, variant B: one big target, the strip unchanged). -->
      <MachineBtn type="activeCodes" class="codesRow"
                  :aria-label="`Active codes ${gcodes} ${mcodes} — open in the G-code reference`"
                  title="Open the active codes in the G-code reference"
                  @click="emit('openActiveCodes')">
        <span class="codesStack stack-micro">
          <span class="codesHead"><span class="codes-value">{{ gcodes }}</span><BookOpen :size="14" class="codesIcon" aria-hidden="true" /></span>
          <span class="sep"></span>
          <span class="codes-value">{{ mcodes }}</span>
        </span>
      </MachineBtn>
    </div>
  </div>
</template>

<style scoped>


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
  /* Three buttons share the sticky section: the action words (POWER OFF,
     DISARM — UX-10) need the width the size's 12 px side padding took
     (89 px of content in an 83 px box, layout gate). Layout only. */
  padding-left: var(--gap-tight);
  padding-right: var(--gap-tight);
}
/* Portrait: the 280 px column gives each button ~74 px — POWER OFF (78 px)
   wraps onto two lines instead of clipping; the row grows for all three
   (block buttons stretch), which the 150 % portrait budget test measures. */
@media (orientation: portrait) {
  .safetyBtn .btn-label-sm { white-space: normal; text-align: center; }
}
/* ── Status detail ── */
.statusDetail {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
}
/* Portrait: the status columns need 240 px of the 280 px column's 236–246
   (see .statusCols in style.css); the side padding gives 8 of them back.
   Layout only — the inset panel keeps its look. */
@media (orientation: portrait) {
  .statusDetail { padding-inline: var(--gap-tight); }
}
.codesRow {
  /* Prevent codes from widening the strip — wrap within status column width.
     The button reaches into the detail's side padding, so its text lines up
     with the rows above and its tint has room. */
  width: 0;
  min-width: calc(100% + 2 * var(--gap-tight));
  margin-inline: calc(-1 * var(--gap-tight));
}
.codesStack .sep { display: block; }   /* a span inside the button */
.codesHead { display: flex; align-items: flex-start; gap: var(--gap-tight); }
.codesHead .codes-value { flex: 1; min-width: 0; }
.codesIcon { flex: none; color: var(--fg-muted); }
.codes-value {
  word-break: keep-all;
  overflow-wrap: normal;
}
</style>
