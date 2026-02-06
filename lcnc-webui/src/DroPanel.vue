<script setup lang="ts">
defineProps<{
  pos: number[];
  coordMode: "work" | "machine";
}>();

const emit = defineEmits<{
  (e: "update:coordMode", mode: "work" | "machine"): void;
}>();

function fmt(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(3) : "-";
}
</script>

<template>
  <div>
    <div class="sub">Position ({{ coordMode }})</div>

    <div class="dro">
      <div class="axis"><span>X</span><b>{{ fmt(pos[0]) }}</b></div>
      <div class="axis"><span>Y</span><b>{{ fmt(pos[1]) }}</b></div>
      <div class="axis"><span>Z</span><b>{{ fmt(pos[2]) }}</b></div>
    </div>

    <div class="btnrow" style="margin-top: 10px">
      <button class="btn" @click="emit('update:coordMode', 'work')" :disabled="coordMode === 'work'">
        Work
      </button>
      <button class="btn" @click="emit('update:coordMode', 'machine')" :disabled="coordMode === 'machine'">
        Machine
      </button>
    </div>
  </div>
</template>

<style scoped>
.sub {
  font-size: 12px;
  opacity: 0.65;
  margin-bottom: 8px;
}

.dro {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
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

.btnrow {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.btn {
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
