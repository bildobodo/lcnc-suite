<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { send, lastReply, connected } from "./lcncWs";
import { usePermissions } from "./permissions";
import { loadMachineDefaults, type ToolChangeMode } from "./defaults";

const props = defineProps<{
  currentTool: number | null;
  iniFilename: string | null;
  hideHeader?: boolean;
}>();

const can = usePermissions();
const toolChangeMode = ref<ToolChangeMode>(loadMachineDefaults().toolChangeMode);

interface Tool {
  T: number;
  P: number;
  Z: number;
  D: number;
  remark: string;
  type: string;
  description: string;
  flutes: number | null;
  oal: number | null;
  flute_length: number | null;
  corner_radius: number | null;
  unit: string;
}

const tools = ref<Tool[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const filterType = ref("");
const sortKey = ref<"T" | "D" | "Z">("T");
const sortAsc = ref(true);

const TOOL_TYPES = ["endmill", "ball", "drill", "chamfer", "tap", "facemill", "engraver", "other"];

const typeLabels: Record<string, string> = {
  endmill: "End Mill",
  ball: "Ball",
  drill: "Drill",
  chamfer: "Chamfer",
  tap: "Tap",
  facemill: "Face Mill",
  engraver: "Engraver",
  other: "Other",
};

function typeLabel(t: string) {
  return typeLabels[t] || t || "-";
}

const filteredTools = computed(() => {
  let list = tools.value;
  if (filterType.value) {
    list = list.filter(t => t.type === filterType.value);
  }
  const key = sortKey.value;
  const dir = sortAsc.value ? 1 : -1;
  return [...list].sort((a, b) => {
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    return (av - bv) * dir;
  });
});

function toggleSort(key: "T" | "D" | "Z") {
  if (sortKey.value === key) sortAsc.value = !sortAsc.value;
  else { sortKey.value = key; sortAsc.value = true; }
}

// Fetch tool table from gateway
function fetchTools() {
  loading.value = true;
  error.value = null;
  send({ cmd: "get_tool_table" });
}

// Handle replies from gateway
watch(lastReply, (reply) => {
  if (!reply) return;
  if (reply.tools !== undefined && reply.ok) {
    tools.value = reply.tools;
    loading.value = false;
  }
  if (reply.ok === false && reply.error && loading.value) {
    error.value = reply.error;
    loading.value = false;
  }
});

// Fetch on mount and when connection re-establishes
onMounted(fetchTools);
watch(connected, (val) => {
  if (val) setTimeout(fetchTools, 500);
});

// Re-fetch when LinuxCNC config changes (INI switch or reconnect)
watch(() => props.iniFilename, (newIni, oldIni) => {
  if (newIni && newIni !== oldIni) fetchTools();
});

// ---- Edit modal ----
const editTool = ref<Tool | null>(null);
const editForm = ref({
  T: 0,
  type: "",
  description: "",
  D: 0,
  Z: 0,
  flutes: null as number | null,
});
const isNewTool = ref(false);

function openEdit(tool: Tool) {
  editTool.value = tool;
  editForm.value = {
    T: tool.T,
    type: tool.type || "",
    description: tool.description || tool.remark || "",
    D: tool.D,
    Z: tool.Z,
    flutes: tool.flutes,
  };
  isNewTool.value = false;
}

function openAdd() {
  const maxT = tools.value.reduce((m, t) => Math.max(m, t.T), 0);
  editTool.value = { T: 0, P: 0, Z: 0, D: 0, remark: "", type: "", description: "", flutes: null, oal: null, flute_length: null, corner_radius: null, unit: "" };
  editForm.value = {
    T: maxT + 1,
    type: "",
    description: "",
    D: 0,
    Z: 0,
    flutes: null,
  };
  isNewTool.value = true;
}

function saveEdit() {
  if (!editTool.value) return;
  const orig = editTool.value;
  const form = editForm.value;

  if (isNewTool.value) {
    send({
      cmd: "add_tool",
      tool_number: form.T,
      diameter: form.D,
      remark: form.description,
      description: form.description,
      type: form.type,
      flutes: form.flutes,
      z_offset: form.Z,
    } as any);
  } else if (form.T !== orig.T) {
    // T# changed: delete old, add new with all data
    send({ cmd: "delete_tool", tool_number: orig.T });
    setTimeout(() => {
      send({
        cmd: "add_tool",
        tool_number: form.T,
        diameter: form.D,
        remark: form.description,
        description: form.description,
        type: form.type,
        flutes: form.flutes,
        z_offset: form.Z,
      } as any);
    }, 200);
  } else {
    // Same T#: send save_tool with all fields
    send({
      cmd: "save_tool",
      tool_number: form.T,
      z_offset: form.Z,
      diameter: form.D,
      remark: form.description,
      description: form.description,
      type: form.type,
      flutes: form.flutes,
    } as any);
  }

  editTool.value = null;
  setTimeout(fetchTools, 400);
}

function cancelEditModal() {
  editTool.value = null;
}

// ---- Tool change ----
function requestToolChange(toolNum: number) {
  toolChangeMode.value = loadMachineDefaults().toolChangeMode;
  if (toolChangeMode.value === "m600") {
    send({ cmd: "mdi", text: `T${toolNum} M600` });
  } else {
    send({ cmd: "tool_change", tool_number: toolNum });
  }
}

// ---- Delete ----
const deletingTool = ref<number | null>(null);

function requestDelete(toolNum: number) {
  deletingTool.value = toolNum;
}

function confirmDelete() {
  if (deletingTool.value == null) return;
  send({ cmd: "delete_tool", tool_number: deletingTool.value });
  deletingTool.value = null;
  setTimeout(fetchTools, 300);
}

function cancelDelete() {
  deletingTool.value = null;
}

function fmtNum(n: any, decimals = 4) {
  if (n == null || n === "") return "-";
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(decimals) : "-";
}

defineExpose({ openAdd, fetchTools });
</script>

<template>
  <div class="container">
    <!-- Header -->
    <div v-if="!hideHeader" class="header">
      <div class="sub">Tool Table</div>
      <div class="actions">
        <button class="btn" @click="openAdd" :disabled="!can.idle">+ Add</button>
        <button class="btn" @click="fetchTools" :disabled="loading || !can.idle">Refresh</button>
      </div>
    </div>

    <!-- Error banner -->
    <div v-if="error" class="errorBanner">{{ error }}</div>


    <!-- Delete confirm dialog (teleported to escape tool dialog stacking context) -->
    <Teleport to="body">
      <div v-if="deletingTool != null" class="dialogOverlay" @click.self="cancelDelete">
        <div class="dialog">
          <div class="dialogTitle danger">Delete Tool</div>
          <div class="dialogBody">
            Remove tool <strong>T{{ deletingTool }}</strong> from the tool table?
          </div>
          <div class="dialogActions">
            <button class="btn" @click="cancelDelete">Cancel</button>
            <button class="btn danger" @click="confirmDelete">Delete</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Edit / Add modal (teleported to escape tool dialog stacking context) -->
    <Teleport to="body">
      <div v-if="editTool" class="dialogOverlay" @click.self="cancelEditModal">
        <div class="dialog editDialog">
          <div class="dialogTitle">{{ isNewTool ? "Add Tool" : `Edit Tool T${editTool.T}` }}</div>
          <div class="editFields">
            <label class="editLabel">
              <span class="editLabelText">Tool #</span>
              <input class="editInput editInputNum" type="number" v-model.number="editForm.T" min="1" />
            </label>
            <label class="editLabel">
              <span class="editLabelText">Type</span>
              <select class="editInput" v-model="editForm.type">
                <option value="">-</option>
                <option v-for="tt in TOOL_TYPES" :key="tt" :value="tt">{{ typeLabel(tt) }}</option>
              </select>
            </label>
            <label class="editLabel">
              <span class="editLabelText">Description</span>
              <input class="editInput" v-model="editForm.description" />
            </label>
            <label class="editLabel">
              <span class="editLabelText">Diameter</span>
              <input class="editInput editInputNum" type="number" step="0.001" v-model.number="editForm.D" />
            </label>
            <label class="editLabel">
              <span class="editLabelText">Z Offset</span>
              <input class="editInput editInputNum" type="number" step="0.0001" v-model.number="editForm.Z" />
            </label>
            <label class="editLabel">
              <span class="editLabelText">Flutes</span>
              <input class="editInput editInputNum" type="number" step="1" v-model.number="editForm.flutes" />
            </label>
          </div>
          <div class="dialogActions">
            <button class="btn" @click="cancelEditModal">Cancel</button>
            <button class="btn primary" @click="saveEdit">{{ isNewTool ? "Add" : "Save" }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Table -->
    <div class="tableWrap scroll-thin">
      <!-- Table header -->
      <div class="trow theader">
        <button class="tcell tcellT sortHeader" @click="toggleSort('T')">
          T# {{ sortKey === 'T' ? (sortAsc ? '▲' : '▼') : '' }}
        </button>
        <button class="tcell tcellNum sortHeader" @click="toggleSort('D')">
          Ø {{ sortKey === 'D' ? (sortAsc ? '▲' : '▼') : '' }}
        </button>
        <button class="tcell tcellNum sortHeader" @click="toggleSort('Z')">
          Z Offset {{ sortKey === 'Z' ? (sortAsc ? '▲' : '▼') : '' }}
        </button>
        <div class="tcell tcellType">
          <select class="filterSelect" v-model="filterType">
            <option value="">Type</option>
            <option v-for="tt in TOOL_TYPES" :key="tt" :value="tt">{{ typeLabel(tt) }}</option>
          </select>
        </div>
        <div class="tcell tcellSm">Flutes</div>
        <div class="tcell tcellDesc">Description</div>
        <div class="tcell tcellAction"></div>
        <div class="tcell tcellAction"></div>
      </div>

      <!-- Tool rows -->
      <div
        v-for="tool in filteredTools"
        :key="tool.T"
        class="trow"
        :class="{ activeTool: tool.T === currentTool }"
      >
        <!-- T# (click to load) -->
        <div class="tcell tcellT">
          <button class="btn" :disabled="!can.ready" @click="requestToolChange(tool.T)">
            T{{ tool.T }}
          </button>
        </div>

        <!-- Diameter -->
        <div class="tcell tcellNum">
          <span class="cellText mono">{{ fmtNum(tool.D) }}</span>
        </div>

        <!-- Z Offset -->
        <div class="tcell tcellNum">
          <span class="cellText mono">{{ fmtNum(tool.Z, 6) }}</span>
        </div>

        <!-- Type -->
        <div class="tcell tcellType">
          <span class="cellText">{{ typeLabel(tool.type) }}</span>
        </div>

        <!-- Flutes -->
        <div class="tcell tcellSm">
          <span class="cellText mono">{{ tool.flutes ?? "-" }}</span>
        </div>

        <!-- Description -->
        <div class="tcell tcellDesc">
          <span class="cellText cellDesc" :title="tool.description">{{ tool.description || tool.remark || "-" }}</span>
        </div>

        <!-- Edit -->
        <div class="tcell tcellAction">
          <button class="btn" :disabled="!can.idle" @click="openEdit(tool)" title="Edit tool">✎</button>
        </div>

        <!-- Delete -->
        <div class="tcell tcellAction">
          <button
            v-if="tool.T !== currentTool"
            class="btn danger"
            @click.stop="requestDelete(tool.T)"
            :disabled="!can.idle"
            title="Delete tool"
          >&#128465;</button>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!loading && filteredTools.length === 0" class="emptyState">
        No tools loaded. Add tools manually.
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.actions {
  display: flex;
  gap: 6px;
}

.errorBanner {
  background: color-mix(in oklab, var(--danger) 30%, var(--bg));
  color: var(--danger);
  padding: 6px 10px;
  border-radius: var(--radius-xl);
  font-size: var(--fs-base);
  margin-bottom: 6px;
  flex-shrink: 0;
}

/* ---- Dialogs ---- */
.editDialog {
  min-width: 300px;
  max-width: 360px;
  text-align: left;
}

.dialogHint {
  font-size: var(--fs-base);
  opacity: 0.5;
  font-family: var(--font-mono);
  margin-bottom: 8px;
}

.editFields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.editLabel {
  display: flex;
  align-items: center;
  gap: 8px;
}

.editLabelText {
  font-size: var(--fs-base);
  font-weight: 600;
  min-width: 75px;
  flex-shrink: 0;
}

.editInput {
  flex: 1;
  padding: 6px 10px;
  font-size: var(--fs-base);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg);
  font-family: inherit;
  box-sizing: border-box;
}

.editInputNum {
  font-family: var(--font-mono);
  text-align: right;
}

/* ---- Table ---- */
.tableWrap {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  min-height: 0;
}

.trow {
  display: flex;
  align-items: center;
  min-height: 34px;
  min-width: 560px;
  border-bottom: 1px solid color-mix(in oklab, var(--border) 30%, transparent);
}

.trow:hover:not(.theader) {
  background: color-mix(in oklab, var(--fg) 4%, transparent);
}

.theader {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--panel);
  font-size: var(--fs-sm);
  font-weight: 600;
  color: color-mix(in oklab, var(--fg) 60%, transparent);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  border-bottom: 1px solid var(--border);
}

.activeTool {
  background: color-mix(in oklab, #ffdd00 12%, transparent);
}
.activeTool:hover {
  background: color-mix(in oklab, #ffdd00 18%, transparent);
}

.tcell {
  padding: 4px 6px;
  font-size: var(--fs-base);
  flex-shrink: 0;
  min-width: 0;
  border-right: 1px solid color-mix(in oklab, var(--border) 30%, transparent);
}

.tcell:last-child {
  border-right: none;
}

.tcellT {
  width: 50px;
  font-weight: 600;
  font-family: var(--font-mono);
}

.sortHeader {
  background: none;
  border: none;
  border-right: 1px solid color-mix(in oklab, var(--border) 30%, transparent);
  border-radius: 0;
  color: inherit;
  font: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  cursor: pointer;
  user-select: none;
  padding: 4px 6px;
}
.sortHeader:hover {
  opacity: 1;
  background: none;
}

.filterSelect {
  padding: 0;
  font-size: inherit;
  font-weight: inherit;
  text-transform: inherit;
  letter-spacing: inherit;
  border: none;
  background: var(--panel);
  color: inherit;
  font-family: inherit;
  cursor: pointer;
  outline: none;
}

.tcellType { width: 80px; }

.tcellDesc {
  flex: 1;
  min-width: 120px;
  overflow: hidden;
}

.tcellNum {
  width: 90px;
  text-align: right;
}

.tcellSm {
  width: 55px;
  text-align: right;
}

.tcellAction {
  width: 42px;
  text-align: center;
}

.cellText {
  display: block;
  padding: 2px 4px;
}

.cellDesc {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mono {
  font-family: var(--font-mono);
}

.dim { opacity: 0.5; }

.emptyState {
  padding: 24px;
  text-align: center;
  opacity: 0.5;
  font-size: var(--fs-md);
}
</style>
