<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { send, lastReply, connected } from "./lcncWs";
import { toolTypeLabel } from "./toolTypes";
import { fmtQty, NO_VALUE } from "./format";
import MachineBtn from "./MachineBtn.vue";

interface ToolEntry {
  T: number;
  P: number;
  D: number;
  Z: number;
  type: string;
  description: string;
}

const props = defineProps<{
  currentTool: number;
  toolDiameter: number | null;
  toolLength: number | null;
  linearUnit: string;
}>();

const emit = defineEmits<{
  (e: "openToolTable"): void;
}>();

const tools = ref<ToolEntry[]>([]);
const tableError = ref<string | null>(null);

function fetchTools() { send({ cmd: "get_tool_table" }); }

// Only OUR command's reply (the gateway echoes cmd): an unrelated failed
// command must not touch this strip, and a failed table read is shown,
// not rendered as NO_VALUE placeholders.
watch(lastReply, (reply) => {
  if (!reply || reply.cmd !== "get_tool_table") return;
  if (reply.ok && Array.isArray(reply.tools)) {
    tools.value = reply.tools;
    tableError.value = null;
  } else if (reply.ok === false) {
    tableError.value = reply.error ?? "Tool table unavailable";
  }
});

onMounted(fetchTools);
watch(connected, (val) => { if (val) setTimeout(fetchTools, 300); });
watch(() => props.currentTool, fetchTools);

const currentToolData = computed(() =>
  tools.value.find(t => t.T === props.currentTool) ?? null
);
</script>

<template>
  <div class="toolStrip">
    <div class="stripSection">
      <div class="sub">Tool</div>
      <MachineBtn type="nav" @click="emit('openToolTable')" block>Tool Table</MachineBtn>
      <div v-if="tableError" class="noteWarn" role="alert">Tool table: {{ tableError }}</div>

      <div v-if="currentTool > 0" class="toolInfo inset-panel stack-tight">
        <div class="statusRow"><span class="label-muted md">Tool</span><span class="val-status md mono">T{{ currentTool }}</span></div>
        <div class="statusRow"><span class="label-muted md">Pocket</span><span class="val-status md mono">{{ currentToolData?.P ?? NO_VALUE }}</span></div>
        <div class="statusRow"><span class="label-muted md">Diameter</span><span class="val-status md mono">{{ fmtQty(toolDiameter, linearUnit) }}</span></div>
        <div class="statusRow"><span class="label-muted md">Z Offset</span><span class="val-status md mono">{{ fmtQty(toolLength, linearUnit) }}</span></div>
        <div class="statusRow"><span class="label-muted md">Type</span><span class="val-status md">{{ currentToolData ? toolTypeLabel(currentToolData.type) : NO_VALUE }}</span></div>
        <div class="statusRow"><span class="label-muted md">Description</span><span class="val-status md toolDesc">{{ currentToolData?.description || NO_VALUE }}</span></div>
      </div>
      <div v-else class="emptyState">No tool loaded</div>
    </div>
  </div>
</template>

<style scoped>
.toolStrip {
  width: 280px;
  flex-shrink: 0;
}

@media (orientation: portrait) {
  .toolStrip { width: 100%; }
}

.toolDesc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}
</style>
