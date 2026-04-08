<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { send, lastReply, connected } from "./lcncWs";
import { toolTypeLabel } from "./toolTypes";
import { fmtCell } from "./format";
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
}>();

const emit = defineEmits<{
  (e: "openToolTable"): void;
}>();

const tools = ref<ToolEntry[]>([]);

function fetchTools() { send({ cmd: "get_tool_table" }); }

watch(lastReply, (reply) => {
  if (reply?.ok && Array.isArray(reply.tools)) {
    tools.value = reply.tools;
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

      <div v-if="currentTool > 0" class="toolInfo inset-panel stack-tight">
        <div class="statusRow"><span class="label-muted md">Tool</span><span class="val-status md mono">T{{ currentTool }}</span></div>
        <div class="statusRow"><span class="label-muted md">Pocket</span><span class="val-status md mono">{{ currentToolData?.P ?? '---' }}</span></div>
        <div class="statusRow"><span class="label-muted md">Diameter</span><span class="val-status md mono">{{ toolDiameter != null ? fmtCell(toolDiameter) : '---' }}</span></div>
        <div class="statusRow"><span class="label-muted md">Z Offset</span><span class="val-status md mono">{{ toolLength != null ? fmtCell(toolLength) : '---' }}</span></div>
        <div class="statusRow"><span class="label-muted md">Type</span><span class="val-status md">{{ currentToolData ? toolTypeLabel(currentToolData.type) : '---' }}</span></div>
        <div class="statusRow"><span class="label-muted md">Description</span><span class="val-status md toolDesc">{{ currentToolData?.description || '---' }}</span></div>
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

.statusRow {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--gap-controls);
}

.toolDesc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}
</style>
