<script setup lang="ts">
import { ref, computed, watch, onMounted, defineAsyncComponent } from "vue";
import { send, lastReply, connected, toolTableVersion } from "./lcncWs";
import { useFire } from "./permissions";
import { loadMachineDefaults, type ToolChangeMode } from "./defaults";
import { TOOL_TYPE_LABELS, toolTypeLabel } from "./toolTypes";
import { fmtCell } from "./format";
import { authHeaders } from "./auth";
import { Pencil, Trash2, X } from "lucide-vue-next";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import FileBrowser from "./FileBrowser.vue";
import { listToolLibraries, readToolLibrary, type FileEntry } from "./lcncApi";
import MachineInput from "./MachineInput.vue";
import MachineSelect from "./MachineSelect.vue";
import MachineToggle from "./MachineToggle.vue";
import type { ToolMeta } from "./toolGeometry";
import { nominalHolderBase } from "./toolHolder";
import { toolUnitsPerMillimeter } from "./toolUnits";
import { toolPreviewNotice } from "./toolPreviewNotice";
import { summarizeToolImport } from "./toolImportSummary";
import { registerModal } from "./modalRegistry";
// Async on purpose (WS-E / F10-finish): ToolPreview is the ONLY statically
// eager three.js importer left — this edge alone kept the 866 kB three
// chunk in the entry graph (static import + modulepreload in index.html),
// defeating the ThreeViewer async split. ProbePanel already dynamic-imports
// three; with this async too, three loads only via async graphs.
const ToolPreview = defineAsyncComponent(() => import("./ToolPreview.vue"));

const FETCH_DELAY_MS = 500;
const REFETCH_AFTER_DELETE_MS = 300;
// Parametric preview canvas in the edit dialog — one constant drives the
// canvas size AND the preview column's width (--preview-w).
const PREVIEW_W = 160;
const PREVIEW_H = 280;

const props = defineProps<{
  currentTool: number | null;
  iniFilename: string | null;
  linearUnit: string;
  hideHeader?: boolean;
  dialogTarget?: string;
}>();

const fire = useFire();
const toolChangeMode = ref<ToolChangeMode>(loadMachineDefaults().toolChangeMode);
const unitsPerMm = computed(() => toolUnitsPerMillimeter(props.linearUnit));

interface Tool extends ToolMeta {
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
const tableError = ref<string | null>(null);
// Every tool write (add / save / renumber / delete) keeps its dialog open
// until the CORRELATED reply (UI-12): the command goes out with a req_id
// (fire() returns it), the reply that carries the same id closes the dialog
// or shows its error; a reply with another id — an older session's, a
// second tab's — is ignored. `cmd` alone cannot tell two sessions apart.
const saving = ref(false);
const editError = ref<string | null>(null);
const saveSession = ref<{ id: string; cmd: string } | null>(null);
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
  tableError.value = null;
  send({ cmd: "get_tool_table" });
}

// Handle replies from gateway
watch(lastReply, (reply) => {
  if (!reply || !loading.value) return;
  // Only consume the reply to OUR get_tool_table request. The gateway echoes
  // the command name (issue #28), so an unrelated failed command no longer
  // poisons this panel's error/loading state.
  if (reply.cmd !== "get_tool_table") return;
  if (reply.ok && Array.isArray(reply.tools)) {
    tools.value = reply.tools;
    loading.value = false;
  } else if (reply.ok === false && reply.error) {
    tableError.value = reply.error;
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

// Re-fetch when any client edits the tool table (gateway pings via tool_table_changed).
watch(toolTableVersion, () => fetchTools());

// ---- Edit modal ----
const editTool = ref<Tool | null>(null);
registerModal(() => editTool.value !== null);
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
const showNominalHolder = ref(false);
const editPreviewMeta = computed(() => ({ ...editTool.value, ...editForm.value }));
const hasNominalHolder = computed(() => nominalHolderBase(editPreviewMeta.value) !== null);
const editNotice = computed(() => toolPreviewNotice(editPreviewMeta.value, unitsPerMm.value));
// Header X and footer Cancel run ONE check (UX-02): an unchanged form closes
// at once, an edited one asks (Keep editing / Discard) — the overlay was
// hardened against a mis-grab, the X still discarded silently.
const editSnapshot = ref("");
function snapshotEdit() { editSnapshot.value = JSON.stringify(editForm.value); }
const editDirty = computed(() => JSON.stringify(editForm.value) !== editSnapshot.value);
const showEditDiscard = ref(false);
registerModal(() => showEditDiscard.value);
function closeEditModal() {
  if (saving.value) return;   // a pending write owns the dialog until its reply
  if (editDirty.value) { showEditDiscard.value = true; return; }
  cancelEditModal();
}
function confirmEditDiscard() { showEditDiscard.value = false; cancelEditModal(); }
// Keypad readout context per field: "T12 · Diameter · mm" (UI-13).
type FieldUnit = "len" | "deg" | "count" | "";
function fieldContext(name: string, unit: FieldUnit): string {
  const who = isNewTool.value ? "New tool" : `T${editTool.value?.T ?? "?"}`;
  const u = unit === "len" ? props.linearUnit : unit === "deg" ? "°" : "";
  return u ? `${who} · ${name} · ${u}` : `${who} · ${name}`;
}

function openEdit(tool: Tool) {
  showNominalHolder.value = false;
  editError.value = null;
  saving.value = false;
  saveSession.value = null;
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
  snapshotEdit();
}

function openAdd() {
  showNominalHolder.value = false;
  editError.value = null;
  saving.value = false;
  saveSession.value = null;
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
  snapshotEdit();
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
  if (!editTool.value || saving.value) return;   // belt and braces: one send per session
  const orig = editTool.value;
  const form = editForm.value;
  editError.value = null;

  // Renumber is one transactional backend command (issue #30); add and
  // save take the same reply-driven path (UI-12): the dialog stays open —
  // fields editable until the send actually happened, disabled while the
  // reply is pending — and closes only on ITS ok.
  const payload = !isNewTool.value && form.T !== orig.T
    ? { cmd: "renumber_tool" as const, old_tool_number: orig.T, ...buildToolMsg(form) }
    : isNewTool.value
      ? { cmd: "add_tool" as const, ...buildToolMsg(form) }
      : { cmd: "save_tool" as const, ...buildToolMsg(form) };
  const id = fire(payload, "setup");
  if (id === null) return;                       // nothing sent — fire() said why; no pending
  saveSession.value = { id, cmd: payload.cmd };
  saving.value = true;
}

// The reply for OUR request (matched by req_id, never by cmd alone) closes
// the dialog on ok and reloads; an ok:false keeps the draft and shows why.
watch(lastReply, (reply) => {
  const s = saveSession.value;
  if (!reply || !s || reply.req_id !== s.id) return;
  saveSession.value = null;
  saving.value = false;
  if (reply.ok) {
    editTool.value = null;
    fetchTools();
  } else {
    editError.value = reply.error || `${s.cmd} failed`;
  }
});

// Disconnect while a write is pending: the outcome is unknown — never a
// blind resend. The draft stays, the table reloads on reconnect (watcher
// above), the operator decides.
watch(connected, (val) => {
  if (val) return;
  if (saveSession.value) {
    saveSession.value = null;
    saving.value = false;
    editError.value = "Connection lost — outcome unknown, the table reloads on reconnect";
  }
  if (deleteSession.value) {
    deleteSession.value = null;
    deleteError.value = "Connection lost — outcome unknown, the table reloads on reconnect";
  }
});

function cancelEditModal() {
  if (saving.value) return;   // a pending write owns the dialog until its reply
  editTool.value = null;
  saving.value = false;
  saveSession.value = null;
  editError.value = null;
}

// ---- Tool change ----
function requestToolChange(toolNum: number) {
  toolChangeMode.value = loadMachineDefaults().toolChangeMode;
  // Through the one gated path (issue #31): `mdi` was fired with a permission
  // re-check at every other call site and raw here — the same command with two
  // policies. Both branches start machine motion, so both take `ready`.
  // Both routines retract with G53 — identity kinematics only (machineFrame).
  if (toolChangeMode.value === "m600") {
    fire({ cmd: "mdi", text: `T${toolNum} M600` }, "machineFrame");
  } else {
    fire({ cmd: "tool_change", tool_number: toolNum }, "machineFrame");
  }
}

// ---- Delete ----
const deletingTool = ref<number | null>(null);
registerModal(() => deletingTool.value != null);
const deleteSession = ref<{ id: string } | null>(null);
const deleteError = ref<string | null>(null);

function requestDelete(toolNum: number) {
  deleteError.value = null;
  deleteSession.value = null;
  deletingTool.value = toolNum;
}

// Same correlated flow as the edit dialog: the confirm waits for ITS reply.
function confirmDelete() {
  if (deletingTool.value == null || deleteSession.value) return;
  deleteError.value = null;
  const id = fire({ cmd: "delete_tool", tool_number: deletingTool.value }, "setup");
  if (id === null) return;
  deleteSession.value = { id };
}

watch(lastReply, (reply) => {
  const s = deleteSession.value;
  if (!reply || !s || reply.req_id !== s.id) return;
  deleteSession.value = null;
  if (reply.ok) {
    deletingTool.value = null;
    fetchTools();
  } else {
    deleteError.value = reply.error || "Delete failed";
  }
});

function cancelDelete() {
  if (deleteSession.value) return;
  deletingTool.value = null;
  deleteError.value = null;
}

// ---- Import ----
interface ImportTool {
  example_z_offset?: number;
  source_format?: string;
  is_example?: boolean;
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
registerModal(() => importPreview.value !== null);
const importPreviewByNumber = computed(() => new Map(importPreview.value?.map(t => [t.T, t])));
const importSkipped = ref<ImportTool[]>([]);
const importExistingCount = ref(0);
const importSummary = ref(summarizeToolImport([]));
const importSource = computed(() => importSummary.value.sourceLabel);
const importBusy = ref(false);
const importResult = ref<{ added?: number; updated?: number; skipped?: number } | null>(null);
const importFile = ref<File | null>(null);
interface RefreshRow {
  T: number;
  type: string;
  D: number;
  description: string;
  current_description: string;
  current_diameter: number | null;
  Z: number | null;
  reason: string | null;
  match: "guid" | "identity" | "number";
}
const importMode = ref("metadata");
const importRefresh = ref<{ rows: RefreshRow[]; updated: number[]; skipped: number[]; revision: string } | null>(null);
const importRefreshError = ref<string | null>(null);
// Table refreshes must not erase an unrelated download/preview failure.
// Show import failures in the dialog, or in the panel if preview never opened.
const importError = ref<string | null>(null);
const canConfirmImport = computed(() => !importBusy.value &&
  (importMode.value === "replace" || !!importRefresh.value?.updated.length));

async function onImportFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  await previewImportFile(file);
}

async function previewImportFile(file: File) {
  showImportBrowser.value = false;
  importFile.value = file;
  importBusy.value = true;
  importResult.value = null;
  importError.value = null;
  importRefresh.value = null;
  importRefreshError.value = null;
  try {
    const form = new FormData();
    form.append("file", file);
    const resp = await fetch("/import-tool-library", { method: "POST", headers: authHeaders(), body: form });
    if (!resp.ok) {
      let body: any = null;
      try {
        body = await resp.json();
      } catch {
        body = { detail: await resp.text().catch(() => "(no body)") };
      }
      throw new Error(body?.detail ? `${body.detail}` : `HTTP ${resp.status}: ${body}`);
    }
    const data = await resp.json();
    importPreview.value = data.tools;
    importSummary.value = summarizeToolImport(data.tools);
    importSkipped.value = data.skipped_duplicates ?? [];
    importExistingCount.value = data.existing_count ?? 0;
    importRefresh.value = data.metadata_refresh ?? null;
    importRefreshError.value = data.metadata_refresh_error ?? null;
    importMode.value = importExistingCount.value > 0 || !importRefresh.value ? "metadata" : "replace";
  } catch (err: any) {
    importError.value = err.message || "Import failed";
    importPreview.value = null;
    importSkipped.value = [];
  } finally {
    importBusy.value = false;
  }
}

// Replacing the whole table is destructive: it asks first (P1). The
// confirm dialog is registered like every other overlay.
const replaceConfirm = ref(false);
registerModal(replaceConfirm);
function requestImport() {
  if (!importFile.value || !canConfirmImport.value) return;
  if (importMode.value === "replace" && importExistingCount.value > 0) { replaceConfirm.value = true; return; }
  confirmImport();
}

async function confirmImport() {
  if (!importFile.value || !canConfirmImport.value) return;
  replaceConfirm.value = false;
  importBusy.value = true;
  importError.value = null;
  try {
    const form = new FormData();
    form.append("file", importFile.value);
    const refresh = importMode.value === "metadata";
    if (refresh) form.append("revision", importRefresh.value!.revision);
    const endpoint = refresh ? "/import-tool-library/refresh" : "/import-tool-library/apply";
    const resp = await fetch(endpoint, { method: "POST", headers: authHeaders(), body: form });
    if (!resp.ok) {
      let body: any = null;
      try {
        body = await resp.json();
      } catch {
        body = { detail: await resp.text().catch(() => "(no body)") };
      }
      throw new Error(body?.detail ? `${body.detail}` : `HTTP ${resp.status}: ${body}`);
    }
    const data = await resp.json();
    importResult.value = refresh ? { updated: data.updated, skipped: data.skipped }
      : { added: data.added, skipped: data.skipped };
    importPreview.value = null;
    importSkipped.value = [];
    importFile.value = null;
    setTimeout(fetchTools, REFETCH_AFTER_DELETE_MS);
  } catch (err: any) {
    importError.value = err.message || "Import failed";
  } finally {
    importBusy.value = false;
  }
}

function cancelImport() {
  // A running import is not cancelled by hiding its dialog (UI-K16): the
  // request would go on unseen. Every close path (X, Cancel, backdrop) waits
  // for the reply, like cancelDelete does for a pending delete.
  if (importBusy.value) return;
  importPreview.value = null;
  importSkipped.value = [];
  importFile.value = null;
  importResult.value = null;
  importRefresh.value = null;
  importError.value = null;
}

// fmtNum → fmtCell imported from format.ts

const importInputRef = ref<HTMLInputElement | null>(null);
const showImportBrowser = ref(false);
const importSubdir = ref("");
async function selectLibrary(entry: FileEntry, signal: AbortSignal) {
  const file = await readToolLibrary(entry, signal);
  if (!signal.aborted) await previewImportFile(file);
}
function toggleImportBrowser() {
  if (!importBusy.value) {
    showImportBrowser.value = !showImportBrowser.value;
    onToolLeave();
  }
}

function uploadLibrary() {
  if (!importBusy.value) importInputRef.value?.click();
}

// ---- Hover preview ----
const hoverTool = ref<Tool | null>(null);
const hoverPos = ref({ x: 0, y: 0 });
let hoverTimer = 0;

const isTouchDevice = () => document.documentElement.classList.contains("touch-device");

function onToolEnter(tool: Tool, e: MouseEvent) {
  // Touch uses the tap path (onToolTap) — the emulated mouseenter that
  // precedes a tap's click would race the 300ms timer against the toggle.
  if (isTouchDevice()) return;
  clearTimeout(hoverTimer);
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  hoverTimer = window.setTimeout(() => {
    hoverPos.value = { x: rect.right + 8, y: rect.top };
    hoverTool.value = tool;
  }, 300);
}

function onToolLeave() {
  // Not touch-gated: the emulated mouseleave when tapping elsewhere is
  // what dismisses a tap-pinned preview.
  clearTimeout(hoverTimer);
  hoverTool.value = null;
}

/** Touch equivalent of the hover preview: tap a row to pin it, re-tap to hide. */
function onToolTap(tool: Tool, e: MouseEvent) {
  if (!isTouchDevice()) return;
  if (hoverTool.value?.T === tool.T) { hoverTool.value = null; return; }
  const cell = (e.currentTarget as HTMLElement).querySelector("td");
  const rect = (cell ?? (e.currentTarget as HTMLElement)).getBoundingClientRect();
  hoverPos.value = { x: rect.right + 8, y: rect.top };
  hoverTool.value = tool;
}

defineExpose({ openAdd, toggleImportBrowser, uploadLibrary, showImportBrowser, importBusy });
</script>

<template>
  <div :class="['container', 'stack-controls', { compact: hideHeader }]">
    <!-- Upload uses the client picker directly, like program loading. -->
    <input ref="importInputRef" type="file" accept=".json,.zip,.fctb,.fctl" @change="onImportFileSelect" hidden />

    <!-- Header -->
    <div v-if="!hideHeader" class="header">
      <div class="sub">Tool Table</div>
      <div class="row-tight">
        <MachineBtn type="manage" @click="openAdd">+ Add</MachineBtn>
        <MachineBtn type="fileOp" :disabled="importBusy" @click="toggleImportBrowser">
          <span class="stable-width"><span :class="{ alt: !showImportBrowser }">Hide Files</span><span :class="{ alt: showImportBrowser }">Browse</span></span>
        </MachineBtn>
        <MachineBtn type="fileOp" :disabled="importBusy" @click="uploadLibrary">Upload</MachineBtn>
      </div>
    </div>

    <MachineInput
      v-show="!showImportBrowser"
      gate="toolSearch"
      type="text"
      v-model="searchText"
      label="Search tools"
      placeholder="Search tools…"
      class="toolSearch"
    />

    <FileBrowser v-if="showImportBrowser" v-model:subdir="importSubdir" label="Server tool libraries"
      empty-text="No tool libraries found" :load-directory="listToolLibraries" :select-file="selectLibrary" />

    <!-- Error banner -->
    <div v-if="tableError" class="statusNote error" role="alert">
      <span>{{ tableError }}</span>
      <MachineBtn type="retry" :disabled="loading" @click="fetchTools">Retry</MachineBtn>
    </div>
    <div v-if="importError && !importPreview" class="statusNote error" role="alert">
      <span>{{ importError }}</span>
      <MachineBtn type="close" aria-label="Dismiss import error" title="Dismiss import error" @click="importError = null"><X :size="14" /></MachineBtn>
    </div>

    <!-- Import result banner -->
    <div v-if="importResult" class="statusNote ok" role="status">
      <template v-if="importResult.updated != null">
        Updated metadata for {{ importResult.updated }} tools. Measured offsets and table diameters retained.
      </template>
      <template v-else>
        Imported {{ importResult.added }} tools. {{ importSummary.resultNotice }}
      </template>
      <template v-if="importResult.skipped"> {{ importResult.skipped }} skipped.</template>
      <MachineBtn type="close" aria-label="Dismiss import result" title="Dismiss import result" @click="importResult = null"><X :size="14" /></MachineBtn>
    </div>

    <!-- Delete confirm dialog -->
      <div v-if="deletingTool != null" class="dialogOverlay" @click.self="cancelDelete">
        <div class="dialog">
          <div class="dialogTitle danger">Delete T{{ deletingTool }}?</div>
          <div class="dialogBody">
            Remove tool <strong>T{{ deletingTool }}</strong> from the tool table?
          </div>
          <div v-if="deleteError" class="statusNote error" role="alert"><span>{{ deleteError }}</span></div>
          <Gate gate="setup" class="dialogActions">
            <MachineBtn type="dialogCancel" :disabled="!!deleteSession" @click="cancelDelete">Cancel</MachineBtn>
            <MachineBtn type="reset" :disabled="!!deleteSession" @click="confirmDelete">{{ deleteSession ? 'Deleting…' : 'Delete' }}</MachineBtn>
          </Gate>
        </div>
      </div>

    <!-- Edit / Add modal — teleported to the content area like the import
         dialog (it used to live inside the 540 px side pane), on the
         .dialog.md.wide tier with the global header / content / actions
         structure. No @click.self dismiss: this is a data-entry form — a
         mis-grab on the overlay must not silently discard edits. -->
    <Teleport v-if="editTool" :to="dialogTarget ?? 'body'" :disabled="!dialogTarget">
      <div v-if="editTool" class="dialogOverlay">
        <div class="dialog md wide editDialog">
          <div class="dialogHeader">
            <span class="dialogTitle">{{ isNewTool ? "Add Tool" : `Edit Tool T${editTool.T}` }}</span>
            <MachineBtn type="close" aria-label="Close tool editor" title="Close tool editor" :disabled="saving" @click="closeEditModal"><X :size="14" /></MachineBtn>
          </div>

          <div class="dialogContent scroll-thin stack-sections">
            <div v-if="editError" class="statusNote error" role="alert"><span>{{ editError }}</span></div>

            <div class="editColumns row-sections">
              <!-- Fields: two sections, each a .paramGrid; the preview column
                   wraps below them when the dialog is narrower than both. -->
              <div class="editFields stack-sections">
                <div class="stack-controls">
                  <div class="sub">General</div>
                  <div class="paramGrid editGrid">
                    <label>Tool #</label>
                    <MachineInput gate="toolEditNum" type="number" v-model.number="editForm.T" min="1" integer
                      label="Tool #" :context="fieldContext('Tool #', 'count')" />
                    <label>Pocket</label>
                    <MachineInput gate="toolEditNum" type="number" v-model.number="editForm.P" min="0" integer
                      label="Pocket" :context="fieldContext('Pocket', 'count')" />
                    <label>Type</label>
                    <MachineSelect gate="toolEdit" v-model="editForm.type" class="full">
                      <option value="">-</option>
                      <option v-for="tt in TOOL_TYPES" :key="tt" :value="tt">{{ toolTypeLabel(tt) }}</option>
                    </MachineSelect>
                    <label for="tool-description">Description</label>
                    <MachineInput id="tool-description" gate="toolEdit" type="text" v-model="editForm.description" class="full"
                      label="Description" :context="fieldContext('Description', 'count')" />
                    <label>Diameter</label>
                    <MachineInput gate="toolEditNum" type="number" v-model.number="editForm.D" min="0"
                      label="Diameter" :context="fieldContext('Diameter', 'len')" :placeholder="linearUnit" />
                    <label>Z Offset</label>
                    <MachineInput gate="toolEditNum" type="number" v-model.number="editForm.Z"
                      label="Z Offset" :context="fieldContext('Z Offset', 'len')" :placeholder="linearUnit" />
                    <label>Flutes</label>
                    <MachineInput gate="toolEditNum" type="number" v-model.number="editForm.flutes" min="0" integer
                      label="Flutes" :context="fieldContext('Flutes', 'count')" />
                    <label for="tool-material">Material</label>
                    <MachineInput id="tool-material" gate="toolEdit" type="text" v-model="editForm.material" placeholder="hss, carbide…" class="full"
                      label="Material" :context="fieldContext('Material', 'count')" />
                  </div>
                </div>

                <div class="stack-controls">
                  <div class="sub">Dimensions</div>
                  <div class="paramGrid twoCol editGrid">
                    <label>Total Length</label>
                    <MachineInput gate="toolEditNum" type="number" v-model.number="editForm.oal" min="0"
                      label="Total Length" :context="fieldContext('Total Length', 'len')" :placeholder="linearUnit" />
                    <label for="tool-below-holder">Below Holder</label>
                    <MachineInput id="tool-below-holder" gate="toolEditNum" type="number" v-model.number="editForm.body_length" min="0"
                      label="Length Below Holder" :context="fieldContext('Below Holder', 'len')" :placeholder="linearUnit" />
                    <label>Flute Len</label>
                    <MachineInput gate="toolEditNum" type="number" v-model.number="editForm.flute_length" min="0"
                      label="Flute Length" :context="fieldContext('Flute Length', 'len')" :placeholder="linearUnit" />
                    <label>Shaft Ø</label>
                    <MachineInput gate="toolEditNum" type="number" v-model.number="editForm.shaft_diameter" min="0"
                      label="Shaft Ø" :context="fieldContext('Shaft Ø', 'len')" :placeholder="linearUnit" />
                    <label>Corner R</label>
                    <MachineInput gate="toolEditNum" type="number" v-model.number="editForm.corner_radius" min="0"
                      label="Corner R" :context="fieldContext('Corner R', 'len')" :placeholder="linearUnit" />
                    <label>Tip Ø</label>
                    <MachineInput gate="toolEditNum" type="number" v-model.number="editForm.tip_diameter" min="0"
                      label="Tip Ø" :context="fieldContext('Tip Ø', 'len')" :placeholder="linearUnit" />
                    <label>Taper °</label>
                    <MachineInput gate="toolEditNum" type="number" v-model.number="editForm.taper_angle" min="0" max="180"
                      label="Taper" :context="fieldContext('Taper', 'deg')" placeholder="deg" />
                    <label>Point °</label>
                    <MachineInput gate="toolEditNum" type="number" v-model.number="editForm.point_angle" min="0" max="180"
                      label="Point" :context="fieldContext('Point', 'deg')" placeholder="deg" />
                    <label for="tool-holder">Holder</label>
                    <MachineInput id="tool-holder" gate="toolEdit" type="text" v-model="editForm.holder" placeholder="Holder name" class="full spanRest"
                      label="Holder" :context="fieldContext('Holder', 'count')" />
                  </div>
                </div>
              </div>

              <!-- Parametric preview: its own column, its width from the
                   canvas size, never squeezed against the fields. -->
              <div class="editPreviewCol stack-controls" :style="{ '--preview-w': PREVIEW_W + 'px' }">
                <div class="editPreviewCanvas inset-panel">
                  <ToolPreview
                    :diameter="editForm.D || 6 * unitsPerMm"
                    :length="editForm.oal || Math.abs(editForm.Z) || 50 * unitsPerMm"
                    :meta="editPreviewMeta"
                    :show-nominal-holder="showNominalHolder && hasNominalHolder"
                    :units-per-mm="unitsPerMm"
                    :width="PREVIEW_W"
                    :height="PREVIEW_H"
                  />
                </div>
                <MachineToggle v-if="hasNominalHolder" gate="toolEdit"
                  v-model="showNominalHolder" label="Show Fusion Holder"
                  help="Nominal library assembly. Actual stickout depends on clamping; this preview does not change measured offsets or the machine view." />
                <span class="label-muted">{{ showNominalHolder && hasNominalHolder ? 'Nominal Fusion assembly' : 'Tool only' }}</span>
              </div>
            </div>

            <!-- Geometry notice (FreeCAD / approximate preview): a full-width
                 row under BOTH columns, never wrapped into the preview column. -->
            <div v-if="editNotice" class="statusNote warn editNotice" role="alert">{{ editNotice }}</div>
          </div>

          <Gate gate="setup" class="dialogActions">
            <MachineBtn type="dialogCancel" :disabled="saving" @click="closeEditModal">Cancel</MachineBtn>
            <MachineBtn type="fileSave" :disabled="saving" @click="saveEdit">{{ saving ? 'Saving…' : isNewTool ? "Add" : "Save" }}</MachineBtn>
          </Gate>
        </div>
      </div>
      <!-- Discard unsaved tool edits (UX-02) — the same ask as the G-code editor's. -->
      <div v-if="showEditDiscard" class="dialogOverlay" @click.self="showEditDiscard = false">
        <div class="dialog">
          <div class="dialogTitle danger">Discard changes?</div>
          <div class="dialogBody">{{ isNewTool ? "The new tool" : `T${editTool?.T}` }} has unsaved changes.</div>
          <div class="dialogActions">
            <MachineBtn type="dialogCancel" @click="showEditDiscard = false">Keep editing</MachineBtn>
            <MachineBtn type="dialogDanger" @click="confirmEditDiscard">Discard</MachineBtn>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Import preview dialog -->
    <Teleport v-if="importPreview" :to="dialogTarget ?? 'body'" :disabled="!dialogTarget">
      <div v-if="importPreview" class="dialogOverlay" @click.self="cancelImport">
        <div class="dialog md wide importDialog">
          <div class="dialogHeader">
            <span class="dialogTitle">{{ importSummary.isExample ? 'Example Tool Library' : `Import ${importSource} Tool Library` }}</span>
            <MachineBtn type="close" aria-label="Close import preview" :title="importBusy ? 'Import in progress' : 'Close import preview'" :disabled="importBusy" @click="cancelImport"><X :size="14" /></MachineBtn>
          </div>
          <div class="dialogContent">
            <div v-if="importSummary.isExample" class="importStats">
              {{ importSummary.fusion }} Fusion 360 and {{ importSummary.freecad }} FreeCAD examples.
              Tool geometry without holders or cutting presets. Review before importing.
            </div>
            <label class="importOption">
              Import mode
              <MachineSelect gate="toolEdit" v-model="importMode" :disabled="importBusy">
                <option value="metadata">Update existing tool metadata</option>
                <option value="replace">Replace entire tool table</option>
              </MachineSelect>
            </label>
            <div v-if="importMode === 'metadata'" class="importStats">
              {{ importRefresh?.updated.length ?? 0 }} existing tools to update.
              Tool numbers, pockets, measured offsets and table diameters are retained.
              Match by tool number; check the current and imported descriptions below.
              Tools with conflicts are skipped. No tools are added or removed.
            </div>
            <div v-else class="importStats">
              {{ importPreview.length }} tools to import.
              <template v-if="importExistingCount">
                Will replace {{ importExistingCount }} existing tools.
              </template>
              {{ importSummary.replacementNotice }}
            </div>
            <div v-if="importMode === 'metadata' && importRefreshError" class="statusNote error" role="alert">{{ importRefreshError }}</div>
            <div v-if="importError" class="statusNote error" role="alert">{{ importError }}</div>
            <div v-if="importSkipped.length" class="statusNote warn" role="alert">
              {{ importSkipped.length }} tools skipped — duplicate tool numbers
              (T{{ [...new Set(importSkipped.map(s => s.T))].join(', T') }}).
              Fix numbering in {{ importSource }} and re-export.
            </div>
            <div v-if="importMode === 'metadata'" class="importList scroll-thin fade-scroll">
              <div v-for="t in importRefresh?.rows ?? []" :key="t.T" class="importRow">
                <span class="importT mono">T{{ t.T }}</span>
                <span class="importDesc">
                  {{ t.current_description || '(no current description)' }} → {{ t.description || '(no imported description)' }}
                  <br />
                  <template v-if="t.reason">Skipped: {{ t.reason }}.</template>
                  <template v-else>Update metadata; keep Z {{ fmtCell(t.Z ?? 0, 3) }}.</template>
                  Ø{{ fmtCell(t.current_diameter, 3) }} → {{ importSource }} Ø{{ fmtCell(t.D, 3) }}
                  <span v-if="toolPreviewNotice(importPreviewByNumber.get(t.T), unitsPerMm)" class="noteWarn">
                    <br />{{ toolPreviewNotice(importPreviewByNumber.get(t.T), unitsPerMm) }}
                  </span>
                </span>
              </div>
            </div>
            <div v-else class="importList scroll-thin fade-scroll">
              <div v-for="t in importPreview" :key="t.T" class="importRow">
                <span class="importT mono">T{{ t.T }}</span>
                <span class="importType">{{ toolTypeLabel(t.type) }}</span>
                <span class="importDia mono">Ø{{ fmtCell(t.D, 2) }}<template v-if="t.example_z_offset != null"><br />Z {{ fmtCell(t.example_z_offset, 2) }}</template></span>
                <span class="importDesc">{{ t.description || '-' }}
                  <span v-if="toolPreviewNotice(t, unitsPerMm)" class="noteWarn"><br />{{ toolPreviewNotice(t, unitsPerMm) }}</span>
                </span>
              </div>
            </div>
          </div>
          <Gate gate="setup" class="dialogActions">
            <MachineBtn type="dialogCancel" :disabled="importBusy" :title="importBusy ? 'Import in progress' : undefined" @click="cancelImport">Cancel</MachineBtn>
            <MachineBtn v-if="importError && importFile" type="fileOp" :disabled="importBusy"
              @click="previewImportFile(importFile)">Preview again</MachineBtn>
            <MachineBtn type="fileSave" @click="requestImport" :disabled="!canConfirmImport">
              {{ importBusy ? 'Importing…' : importMode === 'metadata' ? 'Update metadata' : 'Replace table' }}
            </MachineBtn>
          </Gate>
        </div>
      </div>
      <div v-if="replaceConfirm" class="dialogOverlay" @click.self="replaceConfirm = false">
        <div class="dialog">
          <div class="dialogTitle danger">Replace entire tool table?</div>
          <div class="dialogBody">
            {{ importExistingCount }} existing tool{{ importExistingCount === 1 ? '' : 's' }} — measured offsets included — will be removed and replaced by {{ importPreview?.length ?? 0 }} imported tools.
          </div>
          <Gate gate="setup" class="dialogActions">
            <MachineBtn type="dialogCancel" @click="replaceConfirm = false">Cancel</MachineBtn>
            <MachineBtn type="reset" @click="confirmImport">Replace table</MachineBtn>
          </Gate>
        </div>
      </div>
    </Teleport>

    <!-- Table -->
    <div v-show="!showImportBrowser" class="tableWrap dataTable scroll-thin fade-scroll">
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
            <th class="colAction colEdit"></th>
            <th class="colAction"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="tool in filteredTools"
            :key="tool.T"
            :class="{ activeTool: tool.T === currentTool }"
            @click="onToolTap(tool, $event)"
          >
            <td class="colT"
                @mouseenter="onToolEnter(tool, $event)"
                @mouseleave="onToolLeave">
              <MachineBtn type="toolLoad" @click.stop="requestToolChange(tool.T)">T{{ tool.T }}</MachineBtn>
            </td>
            <td class="colSm mono">{{ tool.P }}</td>
            <td class="colNum mono">{{ fmtCell(tool.D) }}</td>
            <td class="colNum mono">{{ fmtCell(tool.Z, 6) }}</td>
            <td class="colType">{{ toolTypeLabel(tool.type) }}</td>
            <td class="colSm mono">{{ tool.flutes ?? "-" }}</td>
            <td class="colDesc" :title="toolPreviewNotice(tool, unitsPerMm) || tool.description">{{ tool.description || tool.remark || "-" }}
              <span v-if="toolPreviewNotice(tool, unitsPerMm)" class="noteWarn"><br />{{ tool.source_format === "freecad" ? "Imported geometry" : "Approximate preview" }}</span>
            </td>
            <td class="colAction colEdit">
              <MachineBtn type="manage" @click.stop="openEdit(tool)" title="Edit tool"><Pencil :size="14" /></MachineBtn>
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
            <td colspan="9" class="emptyState">No tools loaded. Add tools manually or import a Fusion 360 or FreeCAD library.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Hover tool preview.
         NOTE: Teleported to <body> — escapes this panel's outer <fieldset>
         disable cascade. Safe here because contents are display-only
         (ToolPreview is a static canvas, no inputs). Do NOT add interactive
         controls inside this Teleport without routing them through MachineBtn
         with an explicit gate — they would bypass the panel's permission
         gating. -->
    <Teleport to="body">
      <div v-if="hoverTool" class="toolHoverPreview"
           :style="{ left: hoverPos.x + 'px', top: hoverPos.y + 'px' }">
        <ToolPreview
          :diameter="hoverTool.D || 6 * unitsPerMm"
          :length="hoverTool.oal || Math.abs(hoverTool.Z) || 50 * unitsPerMm"
          :meta="hoverTool"
          :units-per-mm="unitsPerMm"
          :width="100"
          :height="160"
        />
        <span v-if="toolPreviewNotice(hoverTool, unitsPerMm)" class="noteWarn">{{ hoverTool.source_format === "freecad" ? "Imported geometry" : "Approximate preview" }}</span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.container {
  height: 100%;
  min-height: 0;
  padding: var(--gap-section);
}

.container.compact {
  padding: 0;
  flex: 1;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

/* .actions — replaced by row-tight utility (same shape) */

/* ---- Edit dialog (layout only; chrome = .dialog.md.wide + .paramGrid) ---- */
.editColumns {
  flex-wrap: wrap;   /* the preview column drops below the fields when narrow */
}

.editFields {
  flex: 1 1 360px;
  min-width: 0;
}

.editPreviewCol {
  flex: 0 0 calc(var(--preview-w) + 2 * var(--gap-controls));
  align-self: flex-start;
}

.editPreviewCanvas {
  display: flex;
  justify-content: center;
  padding: var(--gap-controls);
}

/* Text fields fill their track; .paramGrid caps inputs at 100px for numbers. */
.editGrid > .full { max-width: none; }
/* The last text field of the two-column grid takes the remaining tracks. */
.editGrid > .spanRest { grid-column: 2 / -1; }

.editNotice {
  flex-shrink: 0;
}

/* ---- Import dialog ---- (width: the global .dialog.md.wide tier) */

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
.activeTool td {
  background: inherit;
}
.activeTool:hover {
  background: var(--hl-active);
}

.colT {
  width: 50px;
  white-space: nowrap;
  font-weight: var(--fw-semibold);
  font-variant-numeric: tabular-nums;
  position: sticky;
  left: 0;
  z-index: var(--z-raised);
  background: var(--panel);
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
  position: sticky;
  z-index: var(--z-raised);
  background: var(--panel);
  right: 0;
}

.colEdit {
  right: 58px;
}


/* Hover preview card — teleported to <body>, but rendered by THIS component,
   so the scoped data-v attribute still lands on it (no unscoped block). */
.toolHoverPreview {
  position: fixed;
  z-index: var(--z-modal);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--gap-controls);
  pointer-events: none;
  box-shadow: var(--shadow-sm);
}
</style>
