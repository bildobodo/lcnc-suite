<script setup lang="ts">
import { toolOffsetWord, type ToolOffsetState } from "./viewer/toolOffsetState";
import { ref, computed, watch, onMounted } from "vue";
import { request, connected, toolTableVersion } from "./lcncWs";
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
const offsetWord = computed(() => toolOffsetWord(props.offsetState));

const emit = defineEmits<{
  (e: "openToolTable"): void;
}>();

const tools = ref<ToolEntry[]>([]);
const tableError = ref<string | null>(null);

// ITS reply (req_id) within a time limit, the newest read only — the same
// read as the Tools tab (operator 2026-10-04: a lost reply left the table
// "Loading tools…" until a refresh). A failed read is shown, never rendered
// as NO_VALUE placeholders; a reconnect reads again.
let readSeq = 0;
async function fetchTools() {
  const seq = ++readSeq;
  const reply = await request({ cmd: "get_tool_table" }, 60_000);
  if (seq !== readSeq) return;
  if (reply?.ok && Array.isArray(reply.tools)) {
    tools.value = reply.tools;
    tableError.value = null;
  } else if (reply === null) {
    if (connected.value) tableError.value = "no reply from the gateway";   // disconnected: the banner says it
  } else {
    tableError.value = reply.error ?? "Tool table unavailable";
  }
}

onMounted(fetchTools);
watch(connected, (val) => { if (val) setTimeout(fetchTools, 300); });
watch(() => props.currentTool, fetchTools);
// the table changed on the server (any client): read it again — the strip
// used to take the Tools tab's reply along, which correlation ends
watch(toolTableVersion, () => fetchTools());

const currentToolData = computed(() =>
  tools.value.find(t => t.T === props.currentTool) ?? null
);
</script>

<template>
  <div class="toolStrip stripFixed">
    <div class="stripSection">
      <div class="sub">Tool</div>
      <MachineBtn type="nav" @click="emit('openToolTable')" block>Tool Table</MachineBtn>
      <!-- The body under the fixed head scrolls as ONE area (plan
           leiste-tastatur S4a, Codex R405 LT405-01): a long read failure
           pushed the tool rows out of the fixed section — now the note, its
           Retry and every row are reached by scrolling, and nothing in it
           widens the strip. -->
      <div class="toolBody stack-controls scroll-thin">
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
          <!-- The table length, and on its own row whether it is in effect
               (operator 2026-10-01: under G49 the DRO and zeroing refer to
               the spindle nose, though the drawn tool sticks out): the mode
               while the spindle tool's own offset applies, a warn word when
               not, "—" without a claim. Its own row since plan
               leiste-tastatur S4 (variant A): behind the length it made the
               widest row and held the section at 280 px. -->
          <div class="statusRow"><span class="label-muted md">Z Offset</span><span class="val-status md mono">{{ fmtQty(toolLength, linearUnit) }}</span></div>
          <div class="statusRow"><span class="label-muted md">In effect</span><span data-tool-offset class="val-status md" :class="{ warn: offsetWarn }">{{ offsetWord ?? NO_VALUE }}</span></div>
          <div class="statusRow"><span class="label-muted md">Type</span><span class="val-status md">{{ currentToolData ? toolTypeLabel(currentToolData.type) : NO_VALUE }}</span></div>
          <div class="statusRow"><span class="label-muted md">Description</span><span class="val-status md toolDesc">{{ currentToolData?.description || NO_VALUE }}</span></div>
        </div>
        <div v-else class="emptyState">No tool loaded</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The body: the section's last child takes the rest of the fixed height
   (.stripSection > :last-child) and scrolls vertically. Its own last child
   (the tool card, or "No tool loaded") reaches the body's bottom like every
   other section's last card — and grows past it under a note, which then
   scrolls (operator 2026-11-19: the card ending after "Description" looked
   shrunk). */
.toolBody { overflow-y: auto; }
.toolBody > :last-child { flex: 1 0 auto; }
/* Landscape: at least the section's own width (--strip-tool-w), and the
   rest of the row: the strip ends at the same distance from its right edge
   as Safety starts from its left (operator 2026-11-19, "symmetrisch"). The
   room Tool has above its minimum is the strip's reserve — a wider font
   takes it from Tool alone; the strip scrolls only once Tool is back at its
   minimum. Portrait keeps the column's width (.stripFixed). */
@media (orientation: landscape) {
  .toolStrip { width: var(--strip-tool-w); flex-grow: 1; }
}

/* The description takes the room its row leaves (a wider Tool shows more
   of it) and ends in an ellipsis. */
.toolDesc {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
