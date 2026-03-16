<script setup lang="ts">
import { ref } from "vue";
import { timingStats, resetTimingStats, getTimingCsv, send, status, lastReply, type TimingComponentStats } from "./lcncWs";

const timingLogActive = ref(false);

function toggleTimingLog() {
  timingLogActive.value = !timingLogActive.value;
  send({ cmd: "timing_log", enable: timingLogActive.value });
}

function downloadTimingCsv() {
  const csv = getTimingCsv();
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lcnc-latency.csv";
  a.click();
  URL.revokeObjectURL(url);
}

const timingComponents: { key: keyof Omit<import("./lcncWs").TimingStats, "count">; label: string }[] = [
  { key: "rt",        label: "RT (total)" },
  { key: "network",   label: "\u2003Network" },
  { key: "server",    label: "\u2003Server" },
  { key: "cycle",     label: "Cycle" },
  { key: "poll",      label: "\u2003Poll" },
  { key: "errors",    label: "\u2003Errors" },
  { key: "parse",     label: "\u2003Parse" },
  { key: "overhead",  label: "\u2003Overhead" },
];
</script>

<template>
  <div class="scrollContent scroll-thin">
    <div class="section">
      <div class="sub">Latency Breakdown <span v-if="timingStats" class="muted">({{ timingStats.count }} samples)</span></div>
      <div v-if="timingStats" class="timingTable">
        <div class="timingRow timingHeader">
          <span>Component</span><span>Last</span><span>Min</span><span>Max</span><span>Mean</span><span>Std</span>
        </div>
        <div v-for="comp in timingComponents" :key="comp.key" class="timingRow" :class="{ timingTotal: comp.key === 'rt' || comp.key === 'cycle' }">
          <span>{{ comp.label }}</span>
          <span>{{ (timingStats[comp.key] as TimingComponentStats).last }}ms</span>
          <span>{{ (timingStats[comp.key] as TimingComponentStats).min }}ms</span>
          <span>{{ (timingStats[comp.key] as TimingComponentStats).max }}ms</span>
          <span>{{ (timingStats[comp.key] as TimingComponentStats).mean }}ms</span>
          <span>{{ (timingStats[comp.key] as TimingComponentStats).std }}ms</span>
        </div>
      </div>
      <div v-else class="muted">Waiting for data…</div>
      <div class="row" style="gap: var(--gap-controls); margin-top: var(--gap-section)">
        <button @click="toggleTimingLog">{{ timingLogActive ? 'Stop Log' : 'Start Log' }}</button>
        <button @click="resetTimingStats">Reset</button>
        <button @click="downloadTimingCsv" :disabled="!timingStats">Download CSV</button>
      </div>
    </div>
    <div class="section">
      <div class="sub">Last reply</div>
      <pre class="debugPre">{{ lastReply }}</pre>
    </div>
    <div class="section">
      <div class="sub">Raw status</div>
      <pre class="debugPre">{{ status }}</pre>
    </div>
  </div>
</template>

<style scoped>
.timingTable {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
}

.timingRow {
  display: grid;
  grid-template-columns: 100px repeat(5, 1fr);
  gap: var(--gap-tight);
  padding: 2px 0;
}

.timingRow span {
  text-align: right;
}

.timingRow span:first-child {
  text-align: left;
}

.timingHeader {
  opacity: var(--opacity-muted);
  font-weight: var(--fw-semibold);
  border-bottom: 1px solid currentColor;
  padding-bottom: 2px;
  margin-bottom: 2px;
}

.timingTotal {
  border-bottom: 1px solid currentColor;
  padding-bottom: 4px;
  margin-bottom: 2px;
  font-weight: var(--fw-semibold);
}

.timingTotal + .timingRow:not(.timingTotal) ~ .timingTotal {
  border-top: 1px solid currentColor;
  padding-top: 4px;
  margin-top: var(--gap-controls);
}

.muted {
  opacity: var(--opacity-muted);
}
.debugPre {
  font-size: var(--fs-sm);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow: auto;
  margin: 0;
  padding: 6px;
  background: color-mix(in oklab, var(--fg) 5%, var(--bg));
  border-radius: var(--radius-md);
}
</style>
