<script setup lang="ts">
// Shows LOGICAL (post-mapping) state — what jog/actions will actually see —
// so a wrong profile is visible here even when the raw device "works".
import { inject, ref, type Ref } from "vue";
import { LOGICAL_BUTTONS, type LogicalButton, type LogicalStick } from "./gamepadProfile";

defineProps<{ deadZone?: number }>();

const NO_BUTTONS = Object.fromEntries(LOGICAL_BUTTONS.map(k => [k, false])) as Record<LogicalButton, boolean>;

const buttons = inject<Ref<Record<LogicalButton, boolean>>>(
  "gamepadLogicalButtons", ref({ ...NO_BUTTONS }));
const sticks = inject<Ref<Record<LogicalStick, number>>>(
  "gamepadLogicalSticks", ref({ lx: 0, ly: 0, rz: 0 }));

const BTN_LABELS: Record<LogicalButton, string> = {
  btn_a: "A", btn_b: "B", btn_x: "X", btn_y: "Y",
  btn_lb: "LB", btn_rb: "RB", btn_lt: "LT", btn_rt: "RT",
  btn_back: "Back", btn_start: "Start", btn_ls: "LS", btn_rs: "RS",
  dpad_up: "▲", dpad_down: "▼", dpad_left: "◄", dpad_right: "►",
};
</script>

<template>
  <div class="gpLive">
    <div class="gpStick stack-tight">
      <div class="gpStickLabel">Left Stick (XY)</div>
      <div class="gpStickBox">
        <div class="gpDeadZone" :style="{ width: `${(deadZone ?? 0.15) * 80}%`, height: `${(deadZone ?? 0.15) * 80}%` }"></div>
        <div class="gpDot"
          :class="{ inside: Math.hypot(sticks.lx, sticks.ly) < (deadZone ?? 0.15) }"
          :style="{ left: `${50 + sticks.lx * 40}%`, top: `${50 - sticks.ly * 40}%` }"></div>
      </div>
    </div>
    <div class="gpStick stack-tight">
      <div class="gpStickLabel">Right Stick (Z)</div>
      <div class="gpStickBox">
        <div class="gpDeadZone" :style="{ width: `${(deadZone ?? 0.15) * 80}%`, height: `${(deadZone ?? 0.15) * 80}%` }"></div>
        <div class="gpDot"
          :class="{ inside: Math.abs(sticks.rz) < (deadZone ?? 0.15) }"
          :style="{ left: '50%', top: `${50 - sticks.rz * 40}%` }"></div>
      </div>
    </div>
    <div class="gpButtons">
      <div class="gpStickLabel">Buttons</div>
      <div class="gpBtnGrid">
        <span v-for="key in LOGICAL_BUTTONS" :key="key"
          class="gpBtn" :class="{ active: buttons[key] }">{{ BTN_LABELS[key] }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gpLive {
  display: flex;
  gap: var(--gap-panel);
  flex-wrap: wrap;
}

.gpStick {
  align-items: center;
}

.gpStickLabel {
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  opacity: var(--opacity-muted);
}

.gpStickBox {
  width: 80px;
  height: 80px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--button-bg);
  position: relative;
}

.gpDeadZone {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border-radius: var(--radius-round);
  border: 1px dashed color-mix(in oklab, var(--fg) 25%, transparent);
  pointer-events: none;
}

.gpDot {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: var(--radius-round);
  background: var(--ok);
  transform: translate(-50%, -50%);
  transition: left 0.05s, top 0.05s;
}

.gpDot.inside {
  opacity: var(--opacity-subtle);
}

.gpBtnGrid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--gap-micro);
}

.gpBtn {
  padding: 2px 4px;
  font-size: var(--fs-xs);
  text-align: center;
  border-radius: var(--radius-sm);
  background: var(--button-bg);
  border: 1px solid var(--border);
  opacity: var(--opacity-muted);
}

.gpBtn.active {
  background: color-mix(in oklab, var(--ok) 25%, var(--button-bg));
  border-color: color-mix(in srgb, var(--ok) 50%, transparent);
  opacity: 1;
}
</style>
