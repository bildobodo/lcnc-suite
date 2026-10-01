<script setup lang="ts">
import { toolOffsetWord, type ToolOffsetState } from "./viewer/toolOffsetState";
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
  /** viewer/toolOffsetState.ts — one decision with the viewer's pin. */
  offsetState: ToolOffsetState;
}>();
const offsetWarn = computed(() => props.offsetState.kind === "off" || props.offsetState.kind === "other");
const offsetWord = computed(() => props.offsetState.kind === "applied" ? "G43" : toolOffsetWord(props.offsetState));

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
  <div class="toolStrip stripFixed">
    <div class="stripSection">
      <div class="sub">Tool</div>
      <MachineBtn type="nav" @click="emit('openToolTable')" block>Tool Table</MachineBtn>
      <!-- the tool table's read failure looks and acts like it does in the
           Tools tab: an error note with a re-read (design wave D1, UI-N28) -->
      <div v-if="tableError" class="statusNote error" role="alert">
        <span>Tool table: {{ tableError }}</span>
        <MachineBtn type="retry" @click="fetchTools">Retry</MachineBtn>
      </div>

      <div v-if="currentTool > 0" class="toolInfo inset-panel stack-tight">
        <div class="statusRow"><span class="label-muted md">Tool</span><span class="val-status md mono">T{{ currentTool }}</span></div>
        <div class="statusRow"><span class="label-muted md">Pocket</span><span class="val-status md mono">{{ currentToolData?.P ?? NO_VALUE }}</span></div>
        <div class="statusRow"><span class="label-muted md">Diameter</span><span class="val-status md mono">{{ fmtQty(toolDiameter, linearUnit) }}</span></div>
        <!-- The table length AND whether it is in effect (operator
             2026-10-01: under G49 the DRO and zeroing refer to the spindle
             nose, though the drawn tool sticks out): "· G43" while the
             spindle tool's own offset applies, a warn word when not. -->
        <div class="statusRow"><span class="label-muted md">Z Offset</span>
          <span class="val-status md"><span class="mono">{{ fmtQty(toolLength, linearUnit) }}</span>
            <span v-if="offsetWord" data-tool-offset class="val-status md" :class="{ warn: offsetWarn }"> · {{ offsetWord }}</span></span></div>
        <div class="statusRow"><span class="label-muted md">Type</span><span class="val-status md">{{ currentToolData ? toolTypeLabel(currentToolData.type) : NO_VALUE }}</span></div>
        <div class="statusRow"><span class="label-muted md">Description</span><span class="val-status md toolDesc">{{ currentToolData?.description || NO_VALUE }}</span></div>
      </div>
      <div v-else class="emptyState">No tool loaded</div>
    </div>
  </div>
</template>

<style scoped>

.toolDesc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}
</style>
