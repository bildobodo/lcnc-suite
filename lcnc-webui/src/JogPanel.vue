<script setup lang="ts">
import JogButton from "./JogButton.vue";

const props = defineProps<{
  jogVel: number;
  canJog: boolean;
  isTeleop: boolean;
  isHomed: boolean;
  armed: boolean;
  linearUnit: string;
  maxJogVel: number;
}>();

const emit = defineEmits<{
  (e: "update:jogVel", vel: number): void;
  (e: "toggleTeleop"): void;
}>();

function onInput(ev: Event) {
  const val = parseFloat((ev.target as HTMLInputElement).value);
  if (Number.isFinite(val)) emit("update:jogVel", val);
}
</script>

<template>
  <div>
    <div class="sub">Jogging</div>

    <div class="modeRow">
      <button
        class="modePill"
        :class="isTeleop ? 'teleop' : 'joint'"
        :disabled="!armed || !isHomed"
        @click="emit('toggleTeleop')"
        :title="isTeleop ? 'Switch to Joint mode' : (isHomed ? 'Switch to World mode' : 'Home all axes first')"
      >
        {{ isTeleop ? "World" : "Joint" }}
      </button>
      <span class="modeHint" v-if="!isHomed">Home to enable World mode</span>
    </div>

    <div class="btnrow" style="margin-bottom: 10px">
      <div class="k" style="min-width: 90px">Speed</div>

      <input
        class="inp"
        type="range"
        min="0.1"
        :max="maxJogVel"
        step="0.1"
        :value="jogVel"
        @input="onInput"
        :disabled="!canJog"
      />
      <div class="pill">{{ (jogVel * 60).toFixed(0) }} {{ linearUnit }}/min</div>
    </div>

    <div class="joggrid">
      <!-- XY with diagonals -->
      <JogButton :axis="0" :dir="-1" :axis2="1" :dir2="1" label="X-Y+" :vel="jogVel" :disabled="!canJog" direction="up-left" />
      <JogButton :axis="1" :dir="1" label="Y+" :vel="jogVel" :disabled="!canJog" direction="up" />
      <JogButton :axis="0" :dir="1" :axis2="1" :dir2="1" label="X+Y+" :vel="jogVel" :disabled="!canJog" direction="up-right" />

      <JogButton :axis="0" :dir="-1" label="X-" :vel="jogVel" :disabled="!canJog" direction="left" />
      <div class="center">XY</div>
      <JogButton :axis="0" :dir="1" label="X+" :vel="jogVel" :disabled="!canJog" direction="right" />

      <JogButton :axis="0" :dir="-1" :axis2="1" :dir2="-1" label="X-Y-" :vel="jogVel" :disabled="!canJog" direction="down-left" />
      <JogButton :axis="1" :dir="-1" label="Y-" :vel="jogVel" :disabled="!canJog" direction="down" />
      <JogButton :axis="0" :dir="1" :axis2="1" :dir2="-1" label="X+Y-" :vel="jogVel" :disabled="!canJog" direction="down-right" />

      <!-- Z -->
      <div class="zcol">
        <JogButton :axis="2" :dir="1" label="Z+" :vel="jogVel" :disabled="!canJog" direction="up" />
        <JogButton :axis="2" :dir="-1" label="Z-" :vel="jogVel" :disabled="!canJog" direction="down" />
      </div>
    </div>

    <div class="hint">
      Press and hold to jog. {{ isTeleop ? 'World mode: coordinated Cartesian movement.' : 'Joint mode: individual axis control.' }}
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
  flex: 1;
  min-width: 0;
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
  grid-template-columns: repeat(3, minmax(50px, 80px));
  grid-template-rows: repeat(3, minmax(50px, 80px));
  gap: 6px;
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
  gap: 20px;
  margin-left: 18px;
  align-items: center;
}

.zcol :deep(button) {
  width: 80px;
  height: 80px;
}

.modeRow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.modePill {
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--fg);
}

.modePill.teleop {
  background: color-mix(in oklab, #0a7a0a 15%, var(--panel));
  border-color: #0a7a0a40;
}

.modePill.joint {
  background: color-mix(in oklab, var(--panel) 80%, transparent);
}

.modePill:hover:not(:disabled) {
  opacity: 0.8;
}

.modePill:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.modeHint {
  font-size: 11px;
  opacity: 0.5;
}

</style>
