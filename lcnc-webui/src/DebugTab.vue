<script setup lang="ts">
import { ref, useId } from "vue";
import { timingStats, resetTimingStats, getTimingCsv, send, status, lastReply, type TimingComponentStats } from "./lcncWs";
import MachineBtn from "./MachineBtn.vue";
import MachineRadio from "./MachineRadio.vue";
import { fmtUnit } from "./format";
import { AB_LABELS, type AbVariant } from "./viewer/abRun";
import { abRunLine, abState, cancelAbRun, setAbLineMode, startAbRun } from "./viewer/abRunBus";

// Part B's A/B measurement (Codex R39 VP39-03) — TEMPORARY: the switch and
// the previous GL line are removed after the acceptance.
const abName = `abLine${useId()}`;
const abModes: AbVariant[] = ["gl", "fat"];

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

const timingComponents: { key: keyof Omit<import("./lcncWs").TimingStats, "count">; label: string; unit?: string }[] = [
  { key: "rt",        label: "RT (total)" },
  { key: "network",   label: "\u2003Network" },
  { key: "server",    label: "\u2003Server" },
  { key: "cycle",     label: "Cycle" },
  { key: "poll",      label: "\u2003Poll" },
  { key: "errors",    label: "\u2003Errors" },
  { key: "parse",     label: "\u2003Parse" },
  { key: "overhead",  label: "\u2003Overhead" },
  { key: "encode",       label: "Encode (server)" },
  { key: "sharedEncode", label: " Shared" },
  { key: "decode",       label: "Decode (client)" },
  { key: "ws_bytes",     label: "WS bytes",      unit: "" },
];
</script>

<template>
  <div class="scrollContent scroll-thin fade-scroll">
    <div class="stack-controls" data-ab-measure>
      <div class="sub">Path Lines (A/B, temporary)</div>
      <div class="settingDesc">Compares the previous GL line with the 2 CSS px line. Run moves the view by itself for about 8 min once Settings is closed; results go to the trace (scripts/viewer_ab_report.py).</div>
      <div class="radioGroup inline">
        <label v-for="m in abModes" :key="m"><MachineRadio gate="viewerSetting" :name="abName" :modelValue="abState.mode" :value="m"
          :disabled="!abState.available || abState.running" @update:modelValue="setAbLineMode(m)" /> {{ AB_LABELS[m] }}</label>
      </div>
      <div class="row-controls">
        <!-- Refused starts say why in the status line (abBlocker reads the
             drawn path, which is not reactive). -->
        <MachineBtn type="inline" :disabled="!abState.available || abState.running" @click="startAbRun()">Run A/B measurement</MachineBtn>
        <MachineBtn type="inline" :disabled="!abState.running" @click="cancelAbRun">Cancel measurement</MachineBtn>
      </div>
      <div class="settingDesc" role="status" aria-live="polite">{{ abState.running ? abRunLine() : abState.last }}</div>
    </div>
    <div class="stack-controls">
      <div class="sub">Latency Breakdown <span v-if="timingStats" class="text-muted">({{ timingStats.count }} samples)</span></div>
      <div v-if="timingStats" class="timingTable">
        <div class="timingRow timingHeader">
          <span>Component</span><span>Last</span><span>Min</span><span>Max</span><span>Mean</span><span>Std</span>
        </div>
        <template v-for="comp in timingComponents" :key="comp.key">
        <!-- Group break between the RT and the cycle totals: the global
             divider, not a border rule on the row. -->
        <div v-if="comp.key === 'cycle'" class="sep"></div>
        <div class="timingRow" :class="{ timingTotal: comp.key === 'rt' || comp.key === 'cycle' }">
          <span>{{ comp.label }}</span>
          <span>{{ fmtUnit((timingStats[comp.key] as TimingComponentStats).last, comp.unit ?? 'ms') }}</span>
          <span>{{ fmtUnit((timingStats[comp.key] as TimingComponentStats).min, comp.unit ?? 'ms') }}</span>
          <span>{{ fmtUnit((timingStats[comp.key] as TimingComponentStats).max, comp.unit ?? 'ms') }}</span>
          <span>{{ fmtUnit((timingStats[comp.key] as TimingComponentStats).mean, comp.unit ?? 'ms') }}</span>
          <span>{{ fmtUnit((timingStats[comp.key] as TimingComponentStats).std, comp.unit ?? 'ms') }}</span>
        </div>
        </template>
      </div>
      <div v-else class="emptyState loading">Waiting for data…</div>
      <div class="row-controls debugActions">
          <MachineBtn type="inline" @click="toggleTimingLog">{{ timingLogActive ? 'Stop Log' : 'Start Log' }}</MachineBtn>
          <MachineBtn type="inline" @click="resetTimingStats">Reset</MachineBtn>
          <MachineBtn type="inline" @click="downloadTimingCsv" :disabled="!timingStats">Download CSV</MachineBtn>
      </div>
    </div>
    <div class="stack-controls">
      <div class="sub">Last reply</div>
      <pre class="debugPre">{{ lastReply }}</pre>
    </div>
    <div class="stack-controls">
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
  padding: var(--gap-micro) 0;
}

.timingRow span {
  text-align: right;
}

.timingRow span:first-child {
  text-align: left;
}

.timingHeader {
  color: var(--fg-muted);
  font-weight: var(--fw-semibold);
  border-bottom: 1px solid currentColor;  /* audit-ok: table header rule, not a section separator */
  padding-bottom: var(--gap-micro);
  margin-bottom: var(--gap-micro);
}

.timingTotal {
  border-bottom: 1px solid currentColor;  /* audit-ok: totals underline (table rule) */
  padding-bottom: var(--gap-tight);
  margin-bottom: var(--gap-micro);
  font-weight: var(--fw-semibold);
}

.timingTable > .sep {
  margin: var(--gap-controls) 0 var(--gap-tight);
}

.debugActions {
  margin-top: var(--gap-section);
}
.debugPre {
  font-size: var(--fs-sm);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow: auto;
  margin: 0;
  padding: var(--gap-tight);
  background: color-mix(in oklab, var(--fg) 5%, var(--bg));
  border-radius: var(--radius-md);
}
</style>
