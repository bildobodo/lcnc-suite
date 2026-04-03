<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { send, lastReply, connected } from "./lcncWs";
import { loadMachineDefaults, STEP_DEFAULT, type ToolChangeMode } from "./defaults";
import { TOOL_TYPE_LABELS, toolTypeLabel } from "./toolTypes";
import { fmtCell } from "./format";
import { Pencil, Trash2 } from "lucide-vue-next";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineSelect from "./MachineSelect.vue";
import ToolPreview from "./ToolPreview.vue";

const FETCH_DELAY_MS = 500;
const REFETCH_AFTER_SAVE_MS = 400;
const REFETCH_AFTER_DELETE_MS = 300;
const TOOL_RENUMBER_DELAY_MS = 200;

const props = defineProps<{
  currentTool: number | null;
  iniFilename: string | null;
  hideHeader?: boolean;
}>();

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

const TOOL_TYPES = Object.keys(TOOL_TYPE_LABELS);

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
      toolTypeLabel(t.type).toLowerCase().includes(q) ||
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
  P: 0,
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

function openEdit(tool: Tool) {
  editTool.value = tool;
  editForm.value = {
    T: tool.T,
    P: tool.P,
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
}

function openAdd() {
  const maxT = tools.value.reduce((m, t) => Math.max(m, t.T), 0);
  editTool.value = { T: 0, P: 0, Z: 0, D: 0, remark: "", type: "", description: "",
    flutes: null, oal: null, flute_length: null, corner_radius: null,
    body_length: null, shaft_diameter: null, taper_angle: null, point_angle: null,
    tip_diameter: null, material: null, holder: null, unit: "" };
  editForm.value = {
    T: maxT + 1, P: maxT + 1, type: "", description: "", D: 0, Z: 0,
    flutes: null, oal: null, flute_length: null, corner_radius: null,
    body_length: null, shaft_diameter: null, taper_angle: null, point_angle: null,
    tip_diameter: null, material: "", holder: "",
  };
  isNewTool.value = true;
}

function buildToolMsg(form: typeof editForm.value) {
  return {
    tool_number: form.T,
    pocket: form.P,
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
const importSkipped = ref<ImportTool[]>([]);
const importExistingCount = ref(0);
const importBusy = ref(false);
const importResult = ref<{ added: number; skipped?: number } | null>(null);
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
    importSkipped.value = data.skipped_duplicates ?? [];
    importExistingCount.value = data.existing_count ?? 0;
  } catch (err: any) {
    error.value = err.message || "Import failed";
    importPreview.value = null;
    importSkipped.value = [];
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
    importResult.value = { added: data.added, skipped: data.skipped };
    importPreview.value = null;
    importSkipped.value = [];
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
  importSkipped.value = [];
  importFile.value = null;
  importResult.value = null;
}

// fmtNum → fmtCell imported from format.ts

const importInputRef = ref<HTMLInputElement | null>(null);
function triggerImport() {
  importInputRef.value?.click();
}

// ---- Hover preview ----
const hoverTool = ref<Tool | null>(null);
const hoverPos = ref({ x: 0, y: 0 });
let hoverTimer = 0;

function onToolEnter(tool: Tool, e: MouseEvent) {
  clearTimeout(hoverTimer);
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  hoverTimer = window.setTimeout(() => {
    hoverPos.value = { x: rect.right + 8, y: rect.top };
    hoverTool.value = tool;
  }, 300);
}

function onToolLeave() {
  clearTimeout(hoverTimer);
  hoverTool.value = null;
}

defineExpose({ openAdd, fetchTools, triggerImport });
</script>

<template>
  <div class="container stack-controls">
    <!-- Hidden file input for import (works via triggerImport / header button) -->
    <input ref="importInputRef" type="file" accept=".json" @change="onImportFileSelect" hidden />

    <!-- Header -->
    <div v-if="!hideHeader" class="header">
      <div class="sub">Tool Table</div>
      <div class="actions">
        <MachineBtn type="manage" @click="openAdd">+ Add</MachineBtn>
        <MachineBtn type="manage" @click="triggerImport">Import</MachineBtn>
        <MachineBtn type="manage" @click="fetchTools" :disabled="loading">Refresh</MachineBtn>
      </div>
    </div>

    <MachineInput
      gate="toolSearch"
      type="text"
      v-model="searchText"
      placeholder="Search tools…"
      class="toolSearch"
    />

    <!-- Error banner -->
    <div v-if="error" class="errorBanner">{{ error }}</div>

    <!-- Import result banner -->
    <div v-if="importResult" class="importBanner">
      Imported {{ importResult.added }} tools (all Z offsets set to 0)
      <MachineBtn type="close" @click="importResult = null">&times;</MachineBtn>
    </div>

    <!-- Delete confirm dialog -->
      <div v-if="deletingTool != null" class="dialogOverlay" @click.self="cancelDelete">
        <div class="dialog">
          <div class="dialogTitle danger">Delete Tool</div>
          <div class="dialogBody">
            Remove tool <strong>T{{ deletingTool }}</strong> from the tool table?
          </div>
          <Gate gate="idle" class="dialogActions">
            <MachineBtn type="dialogCancel" @click="cancelDelete">Cancel</MachineBtn>
            <MachineBtn type="reset" @click="confirmDelete">Delete</MachineBtn>
          </Gate>
        </div>
      </div>

    <!-- Edit / Add modal -->
      <div v-if="editTool" class="dialogOverlay" @click.self="cancelEditModal">
        <div class="dialog lg editDialog">
          <!-- Header -->
          <div class="dialogHeader">
            <span class="dialogTitle">{{ isNewTool ? "Add Tool" : `Edit Tool T${editTool.T}` }}</span>
            <MachineBtn type="close" @click="cancelEditModal">&times;</MachineBtn>
          </div>

          <!-- Body: two columns -->
          <div class="editBody scroll-thin">
            <!-- Left column: form fields -->
            <div class="editFields">
              <div class="editGrid">
                <div class="sub">General</div>
                <label>Tool #</label>
                <MachineInput gate="toolEditNum" type="number" v-model.number="editForm.T" min="1" />
                <label>Pocket</label>
                <MachineInput gate="toolEditNum" type="number" v-model.number="editForm.P" min="0" />
                <label>Type</label>
                <MachineSelect gate="toolEdit" v-model="editForm.type">
                  <option value="">-</option>
                  <option v-for="tt in TOOL_TYPES" :key="tt" :value="tt">{{ toolTypeLabel(tt) }}</option>
                </MachineSelect>
                <label>Description</label>
                <MachineInput gate="toolEdit" type="text" v-model="editForm.description" />
                <label>Diameter</label>
                <MachineInput gate="toolEditNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.D" />
                <label>Z Offset</label>
                <MachineInput gate="toolEditNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.Z" />
                <label>Flutes</label>
                <MachineInput gate="toolEditNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.flutes" />
                <label>Material</label>
                <MachineInput gate="toolEdit" type="text" v-model="editForm.material" placeholder="hss, carbide..." />

                <div class="sub">Dimensions</div>
                <label>Total Length</label>
                <MachineInput gate="toolEditNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.oal" placeholder="mm" />
                <label>Shoulder Len</label>
                <MachineInput gate="toolEditNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.body_length" placeholder="mm" />
                <label>Flute Len</label>
                <MachineInput gate="toolEditNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.flute_length" placeholder="mm" />
                <label>Shaft Ø</label>
                <MachineInput gate="toolEditNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.shaft_diameter" placeholder="mm" />
                <label>Corner R</label>
                <MachineInput gate="toolEditNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.corner_radius" placeholder="mm" />
                <label>Tip Ø</label>
                <MachineInput gate="toolEditNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.tip_diameter" placeholder="mm" />
                <label>Taper °</label>
                <MachineInput gate="toolEditNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.taper_angle" placeholder="deg" />
                <label>Point °</label>
                <MachineInput gate="toolEditNum" type="number" :step="STEP_DEFAULT" v-model.number="editForm.point_angle" placeholder="deg" />
                <label>Holder</label>
                <MachineInput gate="toolEdit" type="text" v-model="editForm.holder" placeholder="Holder name" />
              </div>
            </div>

            <!-- Right column: parametric preview -->
            <div class="editPreviewCol">
              <div class="editPreviewCanvas">
                <ToolPreview
                  :diameter="editForm.D || 6"
                  :length="editForm.oal || Math.abs(editForm.Z) || 50"
                  :flute-length="editForm.flute_length || (editForm.oal || 50) * 0.6"
                  :shaft-diameter="editForm.shaft_diameter ?? undefined"
                  :tool-type="editForm.type || 'other'"
                  :corner-radius="editForm.corner_radius ?? undefined"
                  :taper-angle="editForm.taper_angle ?? undefined"
                  :point-angle="editForm.point_angle ?? undefined"
                  :tip-diameter="editForm.tip_diameter ?? undefined"
                  :body-length="editForm.body_length ?? undefined"
                  :width="160"
                  :height="280"
                />
              </div>
            </div>
          </div>

          <!-- Footer -->
          <Gate gate="idle" class="editFooter">
            <MachineBtn type="dialogCancel" @click="cancelEditModal">Cancel</MachineBtn>
            <MachineBtn type="fileSave" @click="saveEdit">{{ isNewTool ? "Add" : "Save" }}</MachineBtn>
          </Gate>
        </div>
      </div>

    <!-- Import preview dialog -->
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
            <div v-if="importSkipped.length" class="importWarn">
              {{ importSkipped.length }} tools skipped — duplicate tool numbers
              (T{{ [...new Set(importSkipped.map(s => s.T))].join(', T') }}).
              Fix numbering in Fusion 360 and re-export.
            </div>
            <div class="importList scroll-thin">
              <div v-for="t in importPreview" :key="t.T" class="importRow">
                <span class="importT mono">T{{ t.T }}</span>
                <span class="importType">{{ toolTypeLabel(t.type) }}</span>
                <span class="importDia mono">Ø{{ fmtCell(t.D, 2) }}</span>
                <span class="importDesc">{{ t.description || '-' }}</span>
              </div>
            </div>
          </div>
          <Gate gate="idle" class="dialogActions">
            <MachineBtn type="dialogCancel" @click="cancelImport">Cancel</MachineBtn>
            <MachineBtn type="fileSave" @click="confirmImport" :disabled="importBusy">
              {{ importBusy ? 'Importing...' : 'Import' }}
            </MachineBtn>
          </Gate>
        </div>
      </div>

    <!-- Table -->
    <div class="tableWrap dataTable scroll-thin">
      <table>
        <thead>
          <tr>
            <th class="colT"><button class="sortHeader" @click="toggleSort('T')">T# {{ sortKey === 'T' ? (sortAsc ? '▲' : '▼') : '' }}</button></th>
            <th class="colSm">P#</th>
            <th class="colNum"><button class="sortHeader" @click="toggleSort('D')">Ø {{ sortKey === 'D' ? (sortAsc ? '▲' : '▼') : '' }}</button></th>
            <th class="colNum"><button class="sortHeader" @click="toggleSort('Z')">Z Offset {{ sortKey === 'Z' ? (sortAsc ? '▲' : '▼') : '' }}</button></th>
            <th class="colType">
              <MachineSelect gate="toolSearch" class="filterSelect" v-model="filterType">
                <option value="">Type</option>
                <option v-for="tt in TOOL_TYPES" :key="tt" :value="tt">{{ toolTypeLabel(tt) }}</option>
              </MachineSelect>
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
            <td class="colT"
                @mouseenter="onToolEnter(tool, $event)"
                @mouseleave="onToolLeave">
              <MachineBtn type="toolLoad" @click="requestToolChange(tool.T)">T{{ tool.T }}</MachineBtn>
            </td>
            <td class="colSm mono">{{ tool.P }}</td>
            <td class="colNum mono">{{ fmtCell(tool.D) }}</td>
            <td class="colNum mono">{{ fmtCell(tool.Z, 6) }}</td>
            <td class="colType">{{ toolTypeLabel(tool.type) }}</td>
            <td class="colSm mono">{{ tool.flutes ?? "-" }}</td>
            <td class="colDesc" :title="tool.description">{{ tool.description || tool.remark || "-" }}</td>
            <td class="colAction">
              <MachineBtn type="manage" @click="openEdit(tool)" title="Edit tool"><Pencil :size="14" /></MachineBtn>
            </td>
            <td class="colAction">
              <MachineBtn
                v-if="tool.T !== currentTool"
                type="reset"
                @click.stop="requestDelete(tool.T)"
                title="Delete tool"
              ><Trash2 :size="14" /></MachineBtn>
            </td>
          </tr>
          <tr v-if="!loading && filteredTools.length === 0">
            <td colspan="9" class="emptyState">No tools loaded. Add tools manually or import a Fusion 360 library.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Hover tool preview -->
    <Teleport to="body">
      <div v-if="hoverTool" class="toolHoverPreview"
           :style="{ left: hoverPos.x + 'px', top: hoverPos.y + 'px' }">
        <ToolPreview
          :diameter="hoverTool.D || 6"
          :length="hoverTool.oal || Math.abs(hoverTool.Z) || 50"
          :flute-length="hoverTool.flute_length || (hoverTool.oal || 50) * 0.6"
          :shaft-diameter="hoverTool.shaft_diameter ?? undefined"
          :tool-type="hoverTool.type || 'other'"
          :corner-radius="hoverTool.corner_radius ?? undefined"
          :taper-angle="hoverTool.taper_angle ?? undefined"
          :point-angle="hoverTool.point_angle ?? undefined"
          :tip-diameter="hoverTool.tip_diameter ?? undefined"
          :body-length="hoverTool.body_length ?? undefined"
          :width="100"
          :height="160"
        />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.container {
  height: 100%;
  position: relative;
  padding: var(--gap-section) 14px 14px;
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
  padding: var(--gap-tight) var(--gap-controls);
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
  padding: var(--gap-tight) var(--gap-controls);
  border-radius: var(--radius-xl);
  font-size: var(--fs-base);
  margin-bottom: var(--gap-tight);
  flex-shrink: 0;
}

/* ---- Edit dialog ---- */
.editDialog {
  min-width: 500px;
  max-width: 620px;
  max-height: 90%;
}

.editBody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  gap: var(--gap-panel);
  padding: var(--gap-panel);
}

.editFields {
  flex: 1;
  min-width: 0;
}

.editGrid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--gap-controls);
  align-items: center;
}

.editGrid > label {
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
}

.editGrid > .sub {
  grid-column: 1 / -1;
}

.editGrid > .sub + label {
  /* no extra top margin on first label after sub */
}

.editPreviewCol {
  flex-shrink: 0;
  align-self: flex-start;
}

.editPreviewCanvas {
  display: flex;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--gap-controls);
  margin-bottom: var(--gap-section);
}

.editFooter {
  display: flex;
  gap: var(--gap-controls);
  justify-content: flex-end;
  padding: var(--gap-section) var(--gap-panel);
  border-top: 1px solid var(--border);
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

.importWarn {
  font-size: var(--fs-base);
  color: var(--warn);
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
  padding: var(--gap-tight) var(--gap-controls);
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
  background: var(--hl-selected);
}
.activeTool:hover {
  background: var(--hl-active);
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

<style>
.toolHoverPreview {
  position: fixed;
  z-index: 1000;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--gap-controls);
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}
</style>
