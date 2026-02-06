<script setup lang="ts">
import JogButton from "./JogButton.vue";

const props = defineProps<{
  jogVel: number;
  canJog: boolean;
}>();

const emit = defineEmits<{
  (e: "update:jogVel", vel: number): void;
}>();

function onInput(ev: Event) {
  const val = parseFloat((ev.target as HTMLInputElement).value);
  if (Number.isFinite(val)) emit("update:jogVel", val);
}
</script>

<template>
  <div>
    <div class="sub">Jogging</div>

    <div class="btnrow" style="margin-bottom: 10px">
      <div class="k" style="min-width: 90px">Speed</div>

      <input
        class="inp"
        style="min-width: 220px"
        type="range"
        min="0.1"
        max="50"
        step="0.1"
        :value="jogVel"
        @input="onInput"
        :disabled="!canJog"
      />
      <div class="pill">{{ jogVel.toFixed(1) }} u/s</div>
    </div>

    <div class="joggrid">
      <!-- XY -->
      <div></div>
      <JogButton :axis="1" :dir="1" label="Y+" :vel="jogVel" :disabled="!canJog" />
      <div></div>

      <JogButton :axis="0" :dir="-1" label="X-" :vel="jogVel" :disabled="!canJog" />
      <div class="center">XY</div>
      <JogButton :axis="0" :dir="1" label="X+" :vel="jogVel" :disabled="!canJog" />

      <div></div>
      <JogButton :axis="1" :dir="-1" label="Y-" :vel="jogVel" :disabled="!canJog" />
      <div></div>

      <!-- Z -->
      <div class="zcol">
        <JogButton :axis="2" :dir="1" label="Z+" :vel="jogVel" :disabled="!canJog" />
        <JogButton :axis="2" :dir="-1" label="Z-" :vel="jogVel" :disabled="!canJog" />
      </div>
    </div>

    <div class="hint">
      Press and hold to jog. Requires: armed + enabled + not in E-stop.
    </div>
  </div>
</template>

<style scoped>
.sub {
  font-size: 12px;
  opacity: 0.65;
  margin-bottom: 8px;
}

.btnrow {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.k {
  font-size: 12px;
  opacity: 0.7;
}

.pill {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid var(--border);
  user-select: none;
  background: color-mix(in oklab, var(--panel) 80%, transparent);
  color: var(--fg);
}

.inp {
  min-width: 220px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #0002;
}

.hint {
  margin-top: 10px;
  font-size: 12px;
  opacity: 0.65;
}

.joggrid {
  display: grid;
  grid-template-columns: 90px 90px 90px;
  grid-template-rows: 56px 56px 56px;
  gap: 10px;
  align-items: center;
  justify-content: start;
}

.center {
  text-align: center;
  opacity: 0.6;
  font-size: 12px;
  user-select: none;
}

.zcol {
  grid-column: 4;
  grid-row: 1 / span 3;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-left: 18px;
}

.joggrid :deep(button) {
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
}

.joggrid :deep(button:hover) {
  border-color: #646cff;
}

.joggrid :deep(button:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
