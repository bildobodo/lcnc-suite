<script setup lang="ts">
import { computed } from "vue";
import { fmtDist } from "./format";
import type { GcodeStats } from "./GcodePanel.vue";

/**
 * Distance-breakdown donut (rapid / linear / arc) + legend, used by the
 * Program Stats dialog.
 */
const props = defineProps<{ stats: GcodeStats | null }>();

const DONUT_R = 40;
const DONUT_C = 2 * Math.PI * DONUT_R;

const segments = computed(() => {
  const s = props.stats;
  if (!s) return [];
  const total = s.rapidDist + s.linearDist + s.arcDist;
  if (total <= 0) return [];
  const segs: { color: string; label: string; value: number; pct: number; dasharray: string; dashoffset: number }[] = [];
  let offset = 0;
  const items = [
    { color: "var(--warn)", label: "Rapid", value: s.rapidDist },
    { color: "var(--info)", label: "Linear", value: s.linearDist },
    { color: "var(--ok)", label: "Arc", value: s.arcDist },
  ];
  for (const item of items) {
    if (item.value <= 0) continue;
    const pct = item.value / total;
    const len = pct * DONUT_C;
    segs.push({
      color: item.color,
      label: item.label,
      value: item.value,
      pct: Math.round(pct * 100),
      dasharray: `${len} ${DONUT_C - len}`,
      dashoffset: -offset,
    });
    offset += len;
  }
  return segs;
});
</script>

<template>
  <div v-if="segments.length > 0" class="row-sections">
    <svg class="donut" viewBox="0 0 100 100">
      <circle class="donutBg" cx="50" cy="50" r="40" />
      <circle v-for="(seg, i) in segments" :key="i"
        cx="50" cy="50" r="40"
        fill="none"
        :stroke="seg.color"
        stroke-width="12"
        :stroke-dasharray="seg.dasharray"
        :stroke-dashoffset="seg.dashoffset"
        transform="rotate(-90 50 50)"
      >
        <title>{{ seg.label }} — {{ stats ? fmtDist(seg.value, stats.unit) : '' }} ({{ seg.pct }}%)</title>
      </circle>
    </svg>
    <div class="donutLegend stack-tight">
      <div v-for="seg in segments" :key="seg.label" class="row-tight">
        <span class="legendDot" :style="{ background: seg.color }"></span>
        <span>{{ seg.label }}</span>
        <span class="legendPct mono">{{ seg.pct }}%</span>
      </div>
    </div>
  </div>
</template>
