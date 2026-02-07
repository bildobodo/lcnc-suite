<script setup lang="ts">
defineProps<{
  workPos: number[];
  machinePos: number[];
  dtg: number[];
  armed: boolean;
  busy: boolean;
  homed: boolean;
}>();

const emit = defineEmits<{
  (e: "zeroAxis", axis: number): void;
  (e: "zeroAll"): void;
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
}>();

function fmt(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(3) : "-";
}
</script>

<template>
  <div class="container">
    <div class="section">
      <div class="sub">Work Position</div>
      <div class="grid">
        <div class="axis"><span>X</span><b>{{ fmt(workPos[0]) }}</b></div>
        <div class="dtg"><span>DTG</span>{{ fmt(dtg[0]) }}</div>
        <button class="zeroBtn" @click="emit('zeroAxis', 0)" :disabled="!armed || busy">Zero X</button>
        <button class="homeBtn spanBtn" style="grid-column: 4" @click="emit('zeroAll')" :disabled="!armed || busy">Zero All</button>
        <div class="axis"><span>Y</span><b>{{ fmt(workPos[1]) }}</b></div>
        <div class="dtg"><span>DTG</span>{{ fmt(dtg[1]) }}</div>
        <button class="zeroBtn" @click="emit('zeroAxis', 1)" :disabled="!armed || busy">Zero Y</button>
        <div class="axis"><span>Z</span><b>{{ fmt(workPos[2]) }}</b></div>
        <div class="dtg"><span>DTG</span>{{ fmt(dtg[2]) }}</div>
        <button class="zeroBtn" @click="emit('zeroAxis', 2)" :disabled="!armed || busy">Zero Z</button>
      </div>
    </div>

    <div class="separator"></div>

    <div class="section">
      <div class="sub">Machine Position</div>
      <div class="grid machineGrid">
        <div class="axis"><span>X</span><b>{{ fmt(machinePos[0]) }}</b></div>
        <div class="axis"><span>Y</span><b>{{ fmt(machinePos[1]) }}</b></div>
        <div class="axis"><span>Z</span><b>{{ fmt(machinePos[2]) }}</b></div>
        <button class="homeBtn spanBtn" style="grid-column: 3" @click="emit('homeAll')" :disabled="!armed || busy || homed">Home All</button>
        <button class="homeBtn spanBtn" style="grid-column: 4" @click="emit('unhomeAll')" :disabled="!armed || busy || !homed">Unhome</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sub {
  font-size: 12px;
  opacity: 0.65;
  margin-bottom: 8px;
}

.grid {
  display: grid;
  grid-template-columns: 180px 30px 110px 110px;
  column-gap: 16px;
  row-gap: 12px;
  align-items: center;
}

.spanBtn {
  grid-row: 1 / 4;
  align-self: stretch;
}

.machineGrid .axis {
  grid-column: 1;
}

.dtg {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 14px;
  opacity: 0.45;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  justify-content: flex-end;
}

.dtg span {
  font-size: 10px;
  opacity: 0.7;
}

.axis {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 24px;
}

.axis span {
  font-size: 12px;
  opacity: 0.7;
  width: 14px;
}

.zeroBtn {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.zeroBtn:hover {
  background: color-mix(in oklab, var(--button-bg) 85%, var(--fg));
}

.zeroBtn:active:not(:disabled) {
  transform: scale(0.98);
}

.zeroBtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.homeBtn {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.homeBtn:hover {
  background: color-mix(in oklab, var(--button-bg) 85%, var(--fg));
}

.homeBtn:active:not(:disabled) {
  transform: scale(0.98);
}

.homeBtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.separator {
  height: 1px;
  background: var(--border);
  opacity: 0.3;
}
</style>
