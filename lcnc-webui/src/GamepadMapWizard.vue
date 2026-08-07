<script setup lang="ts">
// Controller mapping wizard — captures a raw binding per logical control by
// prompting the operator through each one. Works on the RAW gamepad state
// (injected from useGamepad), so it functions regardless of what layout the
// browser assumed for the device. Flow per step: wait for all controls to
// settle at rest (baseline), then bind the first decisive movement; the
// operator still holding the captured control is absorbed by the next
// step's settle phase.
import { computed, inject, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import {
  detectBinding, detectStickBinding, bindingEquals,
  type GamepadProfile, type LogicalButton, type LogicalStick,
  type RawBinding, type StickBinding, type RawSample,
} from "./gamepadProfile";
import MachineBtn from "./MachineBtn.vue";

const props = defineProps<{ gamepadName: string }>();
const emit = defineEmits<{
  (e: "save", profile: GamepadProfile): void;
  (e: "cancel"): void;
}>();

const rawAxes = inject<Ref<number[]>>("gamepadAxes", ref([]));
const rawButtons = inject<Ref<boolean[]>>("gamepadButtons", ref([]));

type Step =
  | { kind: "button"; key: LogicalButton; label: string }
  | { kind: "stick"; key: LogicalStick; label: string };

const STEPS: Step[] = [
  { kind: "button", key: "btn_a", label: "A — bottom face button (Cross)" },
  { kind: "button", key: "btn_b", label: "B — right face button (Circle)" },
  { kind: "button", key: "btn_x", label: "X — left face button (Square)" },
  { kind: "button", key: "btn_y", label: "Y — top face button (Triangle)" },
  { kind: "button", key: "btn_lb", label: "LB / L1 — left bumper" },
  { kind: "button", key: "btn_rb", label: "RB / R1 — right bumper" },
  { kind: "button", key: "btn_lt", label: "LT / L2 — left trigger (pull fully)" },
  { kind: "button", key: "btn_rt", label: "RT / R2 — right trigger (pull fully)" },
  { kind: "button", key: "btn_back", label: "Back / Select / Share" },
  { kind: "button", key: "btn_start", label: "Start / Options / Menu" },
  { kind: "button", key: "btn_ls", label: "L3 — press the left stick down" },
  { kind: "button", key: "btn_rs", label: "R3 — press the right stick down" },
  { kind: "button", key: "dpad_up", label: "D-pad UP" },
  { kind: "button", key: "dpad_down", label: "D-pad DOWN" },
  { kind: "button", key: "dpad_left", label: "D-pad LEFT" },
  { kind: "button", key: "dpad_right", label: "D-pad RIGHT" },
  { kind: "stick", key: "lx", label: "left stick fully RIGHT, then release" },
  { kind: "stick", key: "ly", label: "left stick fully UP, then release" },
  { kind: "stick", key: "rz", label: "right stick fully UP, then release" },
];

// Consecutive stable 50ms samples required before freezing the rest baseline
const SETTLE_SAMPLES = 5;
const SETTLE_AXIS_JITTER = 0.08;

const idx = ref(0);
const phase = ref<"settle" | "listen" | "done">("settle");
const notice = ref("");
const lastCapture = ref("");

const capButtons = ref<Partial<Record<LogicalButton, RawBinding>>>({});
const capSticks = ref<Partial<Record<LogicalStick, StickBinding>>>({});

const current = computed<Step>(() => STEPS[Math.min(idx.value, STEPS.length - 1)] as Step);
const capturedCount = computed(
  () => Object.keys(capButtons.value).length + Object.keys(capSticks.value).length,
);
const skippedLabels = computed(() =>
  STEPS.filter(s => s.kind === "button"
    ? !capButtons.value[s.key as LogicalButton]
    : !capSticks.value[s.key as LogicalStick])
    .map(s => s.label.split(" — ")[0]),
);

let timer = 0;
let settleCount = 0;
let prevSample: RawSample | null = null;
let baseline: RawSample | null = null;

function snapshot(): RawSample {
  return { axes: [...rawAxes.value], buttons: [...rawButtons.value] };
}

function isQuiet(curr: RawSample, prev: RawSample): boolean {
  if (curr.buttons.some(Boolean)) return false;
  const n = Math.max(curr.axes.length, prev.axes.length);
  for (let i = 0; i < n; i++) {
    if (Math.abs((curr.axes[i] ?? 0) - (prev.axes[i] ?? 0)) > SETTLE_AXIS_JITTER) return false;
  }
  return true;
}

function fmtBinding(b: RawBinding): string {
  switch (b.type) {
    case "button": return `button ${b.index}`;
    case "axisDir": return `axis ${b.index} ${b.sign > 0 ? "+" : "−"}`;
    case "axisValue": return `axis ${b.index} @ ${b.value.toFixed(2)}`;
  }
}

function isDuplicateButton(b: RawBinding): boolean {
  return Object.values(capButtons.value).some(e => e && bindingEquals(e, b));
}

function stickAxisTaken(index: number): boolean {
  if (Object.values(capSticks.value).some(s => s && s.index === index)) return true;
  // A button already bound to this analog axis (trigger/hat) also collides
  return Object.values(capButtons.value).some(e => e && e.type !== "button" && e.index === index);
}

function advance() {
  notice.value = "";
  settleCount = 0;
  prevSample = null;
  baseline = null;
  if (idx.value + 1 >= STEPS.length) {
    phase.value = "done";
  } else {
    idx.value += 1;
    phase.value = "settle";
  }
}

function tick() {
  if (phase.value === "done") return;
  const curr = snapshot();

  if (phase.value === "settle") {
    settleCount = prevSample && isQuiet(curr, prevSample) ? settleCount + 1 : 0;
    prevSample = curr;
    if (settleCount >= SETTLE_SAMPLES) {
      baseline = curr;
      phase.value = "listen";
    }
    return;
  }

  if (!baseline) return;
  const step = current.value;

  if (step.kind === "button") {
    const b = detectBinding(baseline, curr);
    if (!b) return;
    if (isDuplicateButton(b)) {
      notice.value = `${fmtBinding(b)} is already assigned — release it and press a different control`;
      phase.value = "settle";
      settleCount = 0;
      return;
    }
    capButtons.value = { ...capButtons.value, [step.key]: b };
    lastCapture.value = `${step.label.split(" — ")[0]} ← ${fmtBinding(b)}`;
    advance();
    return;
  }

  // Stick step: only a centered-rest axis qualifies
  const sb = detectStickBinding(baseline, curr);
  if (!sb) {
    // A button press here means the user misunderstood — hint instead of bind
    if (detectBinding(baseline, curr)) {
      notice.value = "That registered as a button — move the stick itself";
      phase.value = "settle";
      settleCount = 0;
    }
    return;
  }
  if (stickAxisTaken(sb.index)) {
    notice.value = `axis ${sb.index} is already assigned — move the other stick/direction`;
    phase.value = "settle";
    settleCount = 0;
    return;
  }
  capSticks.value = { ...capSticks.value, [step.key]: sb };
  lastCapture.value = `${step.key.toUpperCase()} ← axis ${sb.index} ${sb.sign > 0 ? "+" : "−"}`;
  advance();
}

function skip() {
  lastCapture.value = "";
  advance();
}

function restart() {
  capButtons.value = {};
  capSticks.value = {};
  idx.value = 0;
  phase.value = "settle";
  notice.value = "";
  lastCapture.value = "";
  settleCount = 0;
  prevSample = null;
  baseline = null;
}

function save() {
  emit("save", {
    id: props.gamepadName,
    buttons: { ...capButtons.value },
    sticks: { ...capSticks.value },
  });
}

onMounted(() => { timer = window.setInterval(tick, 50); });
onBeforeUnmount(() => { window.clearInterval(timer); });
</script>

<template>
  <div class="dialogOverlay">
    <div class="dialog gpWizard">
      <div class="dialogTitle">Map Controller</div>
      <div class="dialogBody stack-controls">
        <div class="mono gpWizId">{{ gamepadName }}</div>
        <template v-if="phase !== 'done'">
          <div class="label-muted">Step {{ idx + 1 }} of {{ STEPS.length }} — captured {{ capturedCount }}</div>
          <div class="sub">{{ current.kind === "button" ? "Press" : "Move" }}: {{ current.label }}</div>
          <div class="label-muted">
            <span class="statusDot" :class="{ probing: phase === 'listen' }"></span>
            {{ phase === "settle" ? "Release all controls…" : "Waiting for input…" }}
          </div>
          <div v-if="notice">{{ notice }}</div>
          <div v-if="lastCapture" class="mono">{{ lastCapture }}</div>
        </template>
        <template v-else>
          <div>Captured {{ capturedCount }} of {{ STEPS.length }} controls for this controller.</div>
          <div v-if="skippedLabels.length" class="label-muted">Skipped: {{ skippedLabels.join(", ") }}</div>
        </template>
      </div>
      <div class="dialogActions">
        <MachineBtn type="dialogCancel" @click="emit('cancel')">Cancel</MachineBtn>
        <MachineBtn v-if="capturedCount > 0" type="inlineMd" @click="restart">Restart</MachineBtn>
        <MachineBtn v-if="phase !== 'done'" type="inlineMd" @click="skip">Skip</MachineBtn>
        <MachineBtn v-if="phase === 'done'" type="dialogConfirm" @click="save">Save Profile</MachineBtn>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Layout only: fixed width so the dialog doesn't resize between steps */
.gpWizard {
  width: min(440px, 90vw);
}
.gpWizId {
  overflow-wrap: anywhere;
}
</style>
