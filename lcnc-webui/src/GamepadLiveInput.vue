<script setup lang="ts">
import { inject, ref, type Ref } from "vue";

defineProps<{ deadZone?: number }>();

const axes = inject<Ref<number[]>>("gamepadAxes", ref([]));
const buttons = inject<Ref<boolean[]>>("gamepadButtons", ref([]));
</script>

<template>
  <div class="gpLive">
    <div class="gpStick">
      <div class="gpStickLabel">Left Stick (XY)</div>
      <div class="gpStickBox">
        <div class="gpDeadZone" :style="{ width: `${(deadZone ?? 0.15) * 80}%`, height: `${(deadZone ?? 0.15) * 80}%` }"></div>
        <div class="gpDot"
          :class="{ inside: Math.hypot(axes[0] ?? 0, axes[1] ?? 0) < (deadZone ?? 0.15) }"
          :style="{ left: `${50 + (axes[0] ?? 0) * 40}%`, top: `${50 + (axes[1] ?? 0) * 40}%` }"></div>
      </div>
    </div>
    <div class="gpStick">
      <div class="gpStickLabel">Right Stick (Z)</div>
      <div class="gpStickBox">
        <div class="gpDeadZone" :style="{ width: `${(deadZone ?? 0.15) * 80}%`, height: `${(deadZone ?? 0.15) * 80}%` }"></div>
        <div class="gpDot"
          :class="{ inside: Math.abs(axes[3] ?? 0) < (deadZone ?? 0.15) }"
          :style="{ left: '50%', top: `${50 + (axes[3] ?? 0) * 40}%` }"></div>
      </div>
    </div>
    <div class="gpButtons">
      <div class="gpStickLabel">Buttons</div>
      <div class="gpBtnGrid">
        <span v-for="(label, i) in ['A','B','X','Y','LB','RB','LT','RT','Back','Start','LS','RS','▲','▼','◄','►']" :key="i"
          class="gpBtn" :class="{ active: buttons[i] }">{{ label }}</span>
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
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-tight);
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
  border-radius: 50%;
  border: 1px dashed color-mix(in oklab, var(--fg) 25%, transparent);
  pointer-events: none;
}

.gpDot {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ok);
  transform: translate(-50%, -50%);
  transition: left 0.05s, top 0.05s;
}

.gpDot.inside {
  opacity: 0.35;
}

.gpBtnGrid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--gap-micro);
}

.gpBtn {
  padding: 2px 4px;
  font-size: var(--fs-xs);
  font-family: var(--font-mono);
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
