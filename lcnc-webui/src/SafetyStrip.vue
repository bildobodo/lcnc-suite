<script setup lang="ts">
import { computed } from "vue";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import { Lock, LockOpen, TriangleAlert, Power, BookOpen } from "lucide-vue-next";
import { NO_VALUE } from "./format";
import { usePermissions, usePermissionReasons } from "./permissions";
import {
  INTERP_IDLE, INTERP_READING, INTERP_PAUSED, INTERP_WAITING,
  TASK_MODE_MANUAL, TASK_MODE_AUTO, TASK_MODE_MDI,
} from "./lcnc";

const props = defineProps<{
  /** Portrait with an input helper the column cannot hold with the machine
   *  info: the info folds away (App measures it, safetyFold.ts). */
  compact: boolean;
  armed: boolean;
  busy: boolean;
  isEstop: boolean;
  isEnabled: boolean;
  isHomed: boolean;
  canEstop: boolean;
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

// The recovery order (button gates BG-11): arming waits for the trip's
// acknowledgement (armEnable — disarming never waits), E-Stop Reset needs arm
// and the acknowledgement (estopReset). The backend judges both; the dimmed
// button says why.
const can = usePermissions();
const reasons = usePermissionReasons();

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

// Portrait with an input helper open: the status detail stays wherever the
// column holds the helper with it and folds only where it would not
// (operator 2026-10-29; App measures, safetyFold.ts). Folded, the section is
// its title and the three safety buttons: at 150 % on 900 × 1200 the
// detail (172 CSS px) left the keyboard below the fold (implementation
// review UI-I08), and a four-row form missed by 11 px whenever the header
// wrapped one line more. What the detail said stays readable meanwhile:
// the banner above names the machine state (IDLE / RUNNING / NOT HOMED /
// E-STOP / OFF), E-Stop and power are the buttons' own labels; Motion,
// Elapsed, overrides and the active codes return when the helper closes.
// The safety buttons never move (WP4 pinned controls) — the detail sits
// below them; landscape never folds (fixed section height).
// the block's name carries the codes it shows (WCAG 2.5.3), none before a status
// ── The E-Stop acts on the PRESS (operator, machine day 2026-11-21, P1a) ──
// Chromium on the touch panel turns a long press into a long-press gesture
// and dispatches no click: the UI E-Stop did nothing on a long press (F12).
// Every other control acts on its release, however long the press
// (releaseClick.ts); the E-Stop alone fires at pointerdown — any pointer,
// any finger, a second finger while the first holds a jog included.
//
// Each press is its OWN gesture, kept per pointer (Codex R420 MT-I01): its
// action is decided at its press — "estop" when the button reads E-Stop, sent
// at once; "reset" when it reads Reset — and its click (a tap, a mouse) ends
// exactly that gesture. A press that stopped the machine never becomes a
// Reset, however late its click and whatever another pointer does meanwhile;
// a Reset needs a press that BEGAN on Reset; a new press of the same pointer
// replaces what its last one left (a cancelled stylus press included). While
// it reads E-Stop the button owns its press (`data-press-owned`); as Reset it
// is a release control like any other. Keyboard / assistive activation
// (detail 0) has no pointer gesture: it acts on the state it finds; a held
// key's repeats do nothing (a repeat after the stop would be a Reset).
const estopGestures = new Map<number, { action: "estop" | "reset"; seq: number }>();
let estopGestureSeq = 0;
const ESTOP_GESTURE_KEEP_MS = 2000;   // a gesture whose click never came (the panel's long press) is forgotten
function onEstopPointerDown(e: PointerEvent) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const action = props.isEstop ? "reset" : "estop";
  const g = { action, seq: ++estopGestureSeq } as const;
  estopGestures.set(e.pointerId, g);
  const pid = e.pointerId;
  const end = (u: PointerEvent) => {
    if (u.pointerId !== pid) return;
    window.removeEventListener("pointerup", end, true);
    window.removeEventListener("pointercancel", end, true);
    // keep the gesture for its click; drop it once no click of it can come
    setTimeout(() => { if (estopGestures.get(pid) === g) estopGestures.delete(pid); }, ESTOP_GESTURE_KEEP_MS);
  };
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);
  if (action === "estop" && props.canEstop) emit("estop");
}
function onEstopClick(e: MouseEvent) {
  if (e.detail === 0) {                       // a keyboard or assistive activation
    if (props.isEstop) emit("estopReset"); else emit("estop");
    return;
  }
  const pid = (e as PointerEvent).pointerId;
  // a click that names no pointer (a browser without PointerEvent clicks):
  // only when exactly one gesture is open can it be that one's
  const key = typeof pid === "number" ? pid : estopGestures.size === 1 ? [...estopGestures.keys()][0]! : undefined;
  const g = key !== undefined ? estopGestures.get(key) : undefined;
  if (g === undefined) return;                // no press of this pointer began here: nothing
  estopGestures.delete(key!);
  if (g.action === "reset" && props.isEstop) emit("estopReset");
  // an "estop" gesture acted at its press: its click is consumed
}
function onEstopKeydown(e: KeyboardEvent) {
  if (e.repeat && (e.key === "Enter" || e.key === " ")) e.preventDefault();
}

const codesLabel = computed(() =>
  ["Active codes", props.gcodes, props.mcodes].filter(Boolean).join(" ") + " — open in the G-code reference");
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
          :disabled="busy || (!armed && !can.armEnable)"
          :reason="!armed && !can.armEnable ? reasons.armEnable : undefined"
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
          :disabled="isEstop ? !can.estopReset : !canEstop"
          :reason="isEstop && !can.estopReset ? reasons.estopReset : undefined"
          :aria-label="isEstop ? 'Reset E-Stop' : undefined"
          :title="isEstop ? 'Reset E-Stop' : undefined"
          :data-press-owned="isEstop ? undefined : ''"
          @pointerdown="onEstopPointerDown"
          @click="onEstopClick"
          @keydown="onEstopKeydown"
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
      <MachineBtn type="activeCodes" class="codesRow" :aria-label="codesLabel"
                  title="Open the active codes in the G-code reference"
                  @click="emit('openActiveCodes')">
        <!-- G over M by a gap: a .sep is a SECTION rule, never inside a control -->
        <span class="stack-tight">
          <span class="codesHead"><span class="codes-value">{{ gcodes }}</span><BookOpen :size="14" class="codesIcon" aria-hidden="true" /></span>
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
/* A dimmed safety button with a reason is wrapped in .btnTip (BG-16: Power
   in E-Stop explains with the safety Gate's reason, Arm during a trip): the
   wrapper takes .safetyBtn and only PLACES — its button keeps the stacked
   interior, so the dimmed footprint is the enabled one. Layout only. */
.safetyBtn.btnTip {
  flex-direction: row;
  align-items: stretch;
  padding-left: 0;
  padding-right: 0;
}
/* audit-ok: the wrapped button is Btn.vue's root — no utility class reaches it */
.safetyBtn.btnTip > :deep(button) {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-tight);
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
.codesHead { display: flex; align-items: flex-start; gap: var(--gap-tight); }
.codesHead .codes-value { flex: 1; min-width: 0; }
.codesIcon { flex: none; color: var(--fg-muted); }
.codes-value {
  word-break: keep-all;
  overflow-wrap: normal;
}
</style>
