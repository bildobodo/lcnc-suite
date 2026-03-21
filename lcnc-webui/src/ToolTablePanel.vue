<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { send, lastReply, connected } from "./lcncWs";
import { usePermissions } from "./permissions";
import { loadMachineDefaults, STEP_DEFAULT, type ToolChangeMode } from "./defaults";
import { Pencil, Trash2 } from "lucide-vue-next";
import Btn from "./Btn.vue";

const FETCH_DELAY_MS = 500;
const REFETCH_AFTER_SAVE_MS = 400;
const REFETCH_AFTER_DELETE_MS = 300;
const TOOL_RENUMBER_DELAY_MS = 200;

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
  body_length: number | null;
  shaft_diameter: number | null;
  taper_angle: number | null;
  point_angle: number | null;
  tip_diameter: number | null;
  material: string | null;
  holder: string | null;
  unit: string;
}

const tools = ref<Tool[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const filterType = ref("");
const searchText = ref("");
const sortKey = ref<"T" | "D" | "Z">("T");
const sortAsc = ref(true);

const TOOL_TYPES = [
  "endmill", "ball", "bullnose", "drill", "chamfer", "countersink",
  "dovetail", "facemill", "lollipop", "slotmill", "threadmill",
  "formmill", "radiusmill", "tapered", "probe", "tap", "engraver", "other",
];

const typeLabels: Record<string, string> = {
  endmill: "End Mill",
  ball: "Ball",
  bullnose: "Bull Nose",
  drill: "Drill",
  chamfer: "Chamfer",
  countersink: "C/Sink",
  dovetail: "Dovetail",
  facemill: "Face Mill",
  lollipop: "Lollipop",
  slotmill: "Slot Mill",
  threadmill: "Thread Mill",
  formmill: "Form Mill",
  radiusmill: "Radius Mill",
  tapered: "Tapered",
  probe: "Probe",
  tap: "Tap",
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
  const q = searchText.value.trim().toLowerCase();
  if (q) {
    list = list.filter(t =>
      `T${t.T}`.toLowerCase().includes(q) ||
      (t.description || "").toLowerCase().includes(q) ||
      (t.remark || "").toLowerCase().includes(q) ||
      typeLabel(t.type).toLowerCase().includes(q) ||
      (t.material || "").toLowerCase().includes(q)
    );
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
  if (!reply || !loading.value) return;
  if (Array.isArray(reply.tools) && reply.ok) {
    tools.value = reply.tools;
    loading.value = false;
  } else if (reply.ok === false && reply.error) {
    error.value = reply.error;
    loading.value = false;
  }
});

// Fetch on mount and when connection re-establishes
onMounted(fetchTools);
watch(connected, (val) => {
  if (val) setTimeout(fetchTools, FETCH_DELAY_MS);
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
  oal: null as number | null,
  flute_length: null as number | null,
  corner_radius: null as number | null,
  body_length: null as number | null,
  shaft_diameter: null as number | null,
  taper_angle: null as number | null,
  point_angle: null as number | null,
  tip_diameter: null as number | null,
  material: "",
  holder: "",
});
const isNewTool = ref(false);
const showGeometry = ref(false);

function openEdit(tool: Tool) {
  editTool.value = tool;
  editForm.value = {
    T: tool.T,
    type: tool.type || "",
    description: tool.description || tool.remark || "",
    D: tool.D,
    Z: tool.Z,
    flutes: tool.flutes,
    oal: tool.oal,
    flute_length: tool.flute_length,
    corner_radius: tool.corner_radius,
    body_length: tool.body_length,
    shaft_diameter: tool.shaft_diameter,
    taper_angle: tool.taper_angle,
    point_angle: tool.point_angle,
    tip_diameter: tool.tip_diameter,
    material: tool.material || "",
    holder: tool.holder || "",
  };
  isNewTool.value = false;
  // Show geometry section if any geometry field is populated
  showGeometry.value = !!(tool.oal || tool.flute_length || tool.corner_radius ||
    tool.body_length || tool.shaft_diameter || tool.taper_angle ||
    tool.point_angle || tool.tip_diameter || tool.material || tool.holder);
}

function openAdd() {
  const maxT = tools.value.reduce((m, t) => Math.max(m, t.T), 0);
  editTool.value = { T: 0, P: 0, Z: 0, D: 0, remark: "", type: "", description: "",
    flutes: null, oal: null, flute_length: null, corner_radius: null,
    body_length: null, shaft_diameter: null, taper_angle: null, point_angle: null,
    tip_diameter: null, material: null, holder: null, unit: "" };
  editForm.value = {
    T: maxT + 1, type: "", description: "", D: 0, Z: 0,
    flutes: null, oal: null, flute_length: null, corner_radius: null,
    body_length: null, shaft_diameter: null, taper_angle: null, point_angle: null,
    tip_diameter: null, material: "", holder: "",
  };
  isNewTool.value = true;
  showGeometry.value = false;
}

function buildToolMsg(form: typeof editForm.value) {
  return {
    tool_number: form.T,
    diameter: form.D,
    z_offset: form.Z,
    remark: form.description,
    description: form.description,
    type: form.type,
    flutes: form.flutes,
    oal: form.oal,
    flute_length: form.flute_length,
    corner_radius: form.corner_radius,
    body_length: form.body_length,
    shaft_diameter: form.shaft_diameter,
    taper_angle: form.taper_angle,
    point_angle: form.point_angle,
    tip_diameter: form.tip_diameter,
    material: form.material || null,
    holder: form.holder || null,
  };
}

function saveEdit() {
  if (!editTool.value) return;
  const orig = editTool.value;
  const form = editForm.value;

  if (isNewTool.value) {
    send({ cmd: "add_tool", ...buildToolMsg(form) } as any);
  } else if (form.T !== orig.T) {
    send({ cmd: "delete_tool", tool_number: orig.T });
    setTimeout(() => {
      send({ cmd: "add_tool", ...buildToolMsg(form) } as any);
    }, TOOL_RENUMBER_DELAY_MS);
  } else {
    send({ cmd: "save_tool", ...buildToolMsg(form) } as any);
  }

  editTool.value = null;
  setTimeout(fetchTools, REFETCH_AFTER_SAVE_MS);
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
  setTimeout(fetchTools, REFETCH_AFTER_DELETE_MS);
}

function cancelDelete() {
  deletingTool.value = null;
}

// ---- Import ----
interface ImportTool {
  T: number;
  D: number;
  type: string;
  description: string;
  flutes: number | null;
  oal: number | null;
  exists: boolean;
  fusion_type: string;
  [key: string]: any;
}

const importPreview = ref<ImportTool[] | null>(null);
const importExistingCount = ref(0);
const importBusy = ref(false);
const importResult = ref<{ added: number } | null>(null);
const importFile = ref<File | null>(null);

async function onImportFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  importFile.value = file;
  importBusy.value = true;
  importResult.value = null;
  try {
    const form = new FormData();
    form.append("file", file);
    const resp = await fetch("/import-tool-library", { method: "POST", body: form });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    importPreview.value = data.tools;
    importExistingCount.value = data.existing_count ?? 0;
  } catch (err: any) {
    error.value = err.message || "Import failed";
    importPreview.value = null;
  } finally {
    importBusy.value = false;
  }
}

async function confirmImport() {
  if (!importFile.value) return;
  importBusy.value = true;
  try {
    const form = new FormData();
    form.append("file", importFile.value);
    const resp = await fetch("/import-tool-library/apply", { method: "POST", body: form });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    importResult.value = { added: data.added };
    importPreview.value = null;
    importFile.value = null;
    setTimeout(fetchTools, REFETCH_AFTER_DELETE_MS);
  } catch (err: any) {
    error.value = err.message || "Import failed";
  } finally {
    importBusy.value = false;
  }
}

function cancelImport() {
  importPreview.value = null;
  importFile.value = null;
  importResult.value = null;
}

function fmtNum(n: any, decimals = 4) {
  if (n == null || n === "") return "-";
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(decimals) : "-";
}

const importInputRef = ref<HTMLInputElement | null>(null);
function triggerImport() {
  importInputRef.value?.click();
}

defineExpose({ openAdd, fetchTools, triggerImport });
</script>

<template>
  <div class="container" :class="{ inactive: !can.idle }">
    <!-- Hidden file input for import (works via triggerImport / header button) -->
    <input ref="importInputRef" type="file" accept=".json" @change="onImportFileSelect" hidden />

    <!-- Header -->
    <div v-if="!hideHeader" class="header">
      <div class="sub">Tool Table</div>
      <div class="actions">
        <Btn @click="openAdd" :disabled="!can.idle">+ Add</Btn>
        <Btn @click="triggerImport" :disabled="!can.idle">Import</Btn>
        <Btn @click="fetchTools" :disabled="loading || !can.idle">Refresh</Btn>
      </div>
    </div>

    <input
      type="text"
      v-model="searchText"
      placeholder="Search tools…"
      class="toolSearch"
      :disabled="!can.idle"
    />

    <!-- Error banner -->
    <div v-if="error" class="errorBanner">{{ error }}</div>

    <!-- Import result banner -->
    <div v-if="importResult" class="importBanner">
      Imported {{ importResult.added }} tools (all Z offsets set to 0)
      <Btn icon @click="importResult = null">&times;</Btn>
    </div>

    <!-- Delete confirm dialog -->
    <Teleport to="body">
      <div v-if="deletingTool != null" class="dialogOverlay" @click.self="cancelDelete">
        <div class="dialog">
          <div class="dialogTitle danger">Delete Tool</div>
          <div class="dialogBody">
            Remove tool <strong>T{{ deletingTool }}</strong> from the tool table?
          </div>
          <div class="dialogActions">
            <Btn @click="cancelDelete">Cancel</Btn>
            <Btn variant="danger" @click="confirmDelete">Delete</Btn>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Edit / Add modal -->
    <Teleport to="body">
      <div v-if="editTool" class="dialogOverlay" @click.self="cancelEditModal">
        <div class="dialog editDialog">
          <div class="dialogTitle">{{ isNewTool ? "Add Tool" : `Edit Tool T${editTool.T}` }}</div>
          <div class="stack-controls editFields">
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
              <input class="editInput editInputNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.D" />
            </label>
            <label class="editLabel">
              <span class="editLabelText">Z Offset</span>
              <input class="editInput editInputNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.Z" />
            </label>
            <label class="editLabel">
              <span class="editLabelText">Flutes</span>
              <input class="editInput editInputNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.flutes" />
            </label>

            <!-- Geometry section (collapsible) -->
            <button class="geomToggle" @click="showGeometry = !showGeometry">
              {{ showGeometry ? '▾' : '▸' }} Geometry
            </button>
            <template v-if="showGeometry">
              <label class="editLabel">
                <span class="editLabelText">OAL</span>
                <input class="editInput editInputNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.oal" placeholder="mm" />
              </label>
              <label class="editLabel">
                <span class="editLabelText">Flute Len</span>
                <input class="editInput editInputNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.flute_length" placeholder="mm" />
              </label>
              <label class="editLabel">
                <span class="editLabelText">Body Len</span>
                <input class="editInput editInputNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.body_length" placeholder="mm" />
              </label>
              <label class="editLabel">
                <span class="editLabelText">Shaft Ø</span>
                <input class="editInput editInputNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.shaft_diameter" placeholder="mm" />
              </label>
              <label class="editLabel">
                <span class="editLabelText">Corner R</span>
                <input class="editInput editInputNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.corner_radius" placeholder="mm" />
              </label>
              <label class="editLabel">
                <span class="editLabelText">Tip Ø</span>
                <input class="editInput editInputNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.tip_diameter" placeholder="mm" />
              </label>
              <label class="editLabel">
                <span class="editLabelText">Taper °</span>
                <input class="editInput editInputNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.taper_angle" placeholder="deg" />
              </label>
              <label class="editLabel">
                <span class="editLabelText">Point °</span>
                <input class="editInput editInputNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.point_angle" placeholder="deg" />
              </label>
              <label class="editLabel">
                <span class="editLabelText">Material</span>
                <input class="editInput" v-model="editForm.material" placeholder="hss, carbide..." />
              </label>
              <label class="editLabel">
                <span class="editLabelText">Holder</span>
                <input class="editInput" v-model="editForm.holder" placeholder="Holder name" />
              </label>
            </template>
          </div>
          <div class="dialogActions">
            <Btn @click="cancelEditModal">Cancel</Btn>
            <Btn variant="primary" @click="saveEdit">{{ isNewTool ? "Add" : "Save" }}</Btn>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Import preview dialog -->
    <Teleport to="body">
      <div v-if="importPreview" class="dialogOverlay" @click.self="cancelImport">
        <div class="dialog importDialog">
          <div class="dialogTitle">Import Tool Library</div>
          <div class="dialogBody">
            <div class="importStats">
              {{ importPreview.length }} tools to import.
              <template v-if="importExistingCount">
                Will replace {{ importExistingCount }} existing tools.
              </template>
              Z offsets will use Fusion gauge lengths (measure to replace with actual values).
            </div>
            <div class="importList scroll-thin">
              <div v-for="t in importPreview" :key="t.T" class="importRow">
                <span class="importT mono">T{{ t.T }}</span>
                <span class="importType">{{ typeLabel(t.type) }}</span>
                <span class="importDia mono">Ø{{ fmtNum(t.D, 2) }}</span>
                <span class="importDesc">{{ t.description || '-' }}</span>
              </div>
            </div>
          </div>
          <div class="dialogActions">
            <Btn @click="cancelImport">Cancel</Btn>
            <Btn variant="primary" @click="confirmImport" :disabled="importBusy">
              {{ importBusy ? 'Importing...' : 'Import' }}
            </Btn>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Table -->
    <div class="tableWrap dataTable scroll-thin">
      <table>
        <thead>
          <tr>
            <th class="colT"><button class="sortHeader" :disabled="!can.idle" @click="toggleSort('T')">T# {{ sortKey === 'T' ? (sortAsc ? '▲' : '▼') : '' }}</button></th>
            <th class="colNum"><button class="sortHeader" :disabled="!can.idle" @click="toggleSort('D')">Ø {{ sortKey === 'D' ? (sortAsc ? '▲' : '▼') : '' }}</button></th>
            <th class="colNum"><button class="sortHeader" :disabled="!can.idle" @click="toggleSort('Z')">Z Offset {{ sortKey === 'Z' ? (sortAsc ? '▲' : '▼') : '' }}</button></th>
            <th class="colType">
              <select class="filterSelect" v-model="filterType">
                <option value="">Type</option>
                <option v-for="tt in TOOL_TYPES" :key="tt" :value="tt">{{ typeLabel(tt) }}</option>
              </select>
            </th>
            <th class="colSm">Flutes</th>
            <th class="colDesc">Description</th>
            <th class="colAction"></th>
            <th class="colAction"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="tool in filteredTools"
            :key="tool.T"
            :class="{ activeTool: tool.T === currentTool }"
          >
            <td class="colT">
              <Btn :disabled="!can.ready" @click="requestToolChange(tool.T)">T{{ tool.T }}</Btn>
            </td>
            <td class="colNum mono">{{ fmtNum(tool.D) }}</td>
            <td class="colNum mono">{{ fmtNum(tool.Z, 6) }}</td>
            <td class="colType">{{ typeLabel(tool.type) }}</td>
            <td class="colSm mono">{{ tool.flutes ?? "-" }}</td>
            <td class="colDesc" :title="tool.description">{{ tool.description || tool.remark || "-" }}</td>
            <td class="colAction">
              <Btn :disabled="!can.idle" @click="openEdit(tool)" title="Edit tool"><Pencil :size="14" /></Btn>
            </td>
            <td class="colAction">
              <Btn
                v-if="tool.T !== currentTool"
                variant="danger"
                @click.stop="requestDelete(tool.T)"
                :disabled="!can.idle"
                title="Delete tool"
              ><Trash2 :size="14" /></Btn>
            </td>
          </tr>
          <tr v-if="!loading && filteredTools.length === 0">
            <td colspan="8" class="emptyState">No tools loaded. Add tools manually or import a Fusion 360 library.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  padding: var(--gap-section) 14px 14px;
  gap: var(--gap-controls);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.actions {
  display: flex;
  gap: var(--gap-tight);
}

.errorBanner {
  background: color-mix(in oklab, var(--danger) 30%, var(--bg));
  color: var(--danger);
  padding: 6px 10px;
  border-radius: var(--radius-xl);
  font-size: var(--fs-base);
  margin-bottom: var(--gap-tight);
  flex-shrink: 0;
}

.importBanner {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  background: color-mix(in oklab, var(--ok) 20%, var(--bg));
  color: var(--ok);
  padding: 6px 10px;
  border-radius: var(--radius-xl);
  font-size: var(--fs-base);
  margin-bottom: var(--gap-tight);
  flex-shrink: 0;
}

/* ---- Dialogs ---- */
.editDialog {
  min-width: 300px;
  max-width: 360px;
  text-align: left;
  max-height: 80vh;
  overflow-y: auto;
}

.editFields {
  margin-top: var(--gap-section);
}

.editLabel {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
}

.editLabelText {
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
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

.geomToggle {
  background: none;
  border: none;
  border-radius: 0;
  color: color-mix(in oklab, var(--fg) 60%, transparent);
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  cursor: pointer;
  padding: 4px 0;
  text-align: left;
}
.geomToggle:hover {
  background: none;
  color: var(--fg);
}

/* ---- Import dialog ---- */
.importDialog {
  min-width: 400px;
  max-width: 600px;
  text-align: left;
}

.importStats {
  font-size: var(--fs-base);
  opacity: var(--opacity-muted);
  margin-bottom: var(--gap-controls);
}

.importOption {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  font-size: var(--fs-base);
  margin-bottom: var(--gap-controls);
  cursor: pointer;
}

.importList {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.importRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  padding: 4px 8px;
  font-size: var(--fs-base);
  border-bottom: 1px solid color-mix(in oklab, var(--border) 30%, transparent);
}
.importRow:last-child { border-bottom: none; }

.importExists {
  opacity: var(--opacity-muted);
}

.importT { min-width: 40px; font-weight: var(--fw-semibold); }
.importType { min-width: 70px; }
.importDia { min-width: 55px; }
.importDesc {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.importTag {
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
  font-style: italic;
}

/* ---- Table ---- */
.tableWrap {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.toolSearch {
  width: 100%;
  flex-shrink: 0;
}

.activeTool {
  background: color-mix(in oklab, var(--active-tool) 12%, transparent);
}
.activeTool:hover {
  background: color-mix(in oklab, var(--active-tool) 18%, transparent);
}

.colT {
  width: 50px;
  white-space: nowrap;
  font-weight: var(--fw-semibold);
  font-family: var(--font-mono);
}

.colNum {
  width: 90px;
  white-space: nowrap;
}

.colSm {
  width: 55px;
}

.colType { width: 80px; }

.colDesc {
  min-width: 200px;
}

.colAction {
  width: 42px;
  text-align: center;
}

.mono {
  font-family: var(--font-mono);
}

.emptyState {
  padding: 24px;
  text-align: center;
  opacity: var(--opacity-muted);
  font-size: var(--fs-md);
}
</style>
