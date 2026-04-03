<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from "vue";
import { lastReply, connected, send } from "./lcncWs";
import { usePermissions } from "./permissions";
import { fmtOffset } from "./format";
import MachineBtn from "./MachineBtn.vue";

import Gate from "./Gate.vue";

const can = usePermissions();

const props = defineProps<{
  axes: string[];
  g5xLabel: string;
  g92Offset: number[] | null;
  toolOffset: number[] | null;
  eoffsetZ: number | null;
  eoffsetEnabled: boolean;
  rotationXy: number | null;
}>();

// ─── WCS table data ──────────────────────────────────────────
type WcsRow = { name: string; [axis: string]: string | number };
const wcsTable = ref<WcsRow[]>([]);
const selectedWcs = ref<string | null>(null);
const loading = ref(false);

const offsetColumns = computed(() => [...props.axes.map(l => l.toLowerCase()), "r"]);

function fetchTable() {
  loading.value = true;
  send({ cmd: "get_wcs_table" });
}

watch(lastReply, (r) => {
  if (r?.ok && r.table) {
    wcsTable.value = r.table;
    loading.value = false;
  }
}, { flush: "sync" });

onMounted(() => {
  selectedWcs.value = props.g5xLabel;
  fetchTable();
});

watch(connected, (val) => {
  if (val) setTimeout(fetchTable, 300);
});

// Formatting imported from format.ts (fmtOffset)

// ─── Auxiliary row visibility ────────────────────────────────
const hasG92 = computed(() => props.g92Offset?.some(v => v !== 0) ?? false);
const hasTool = computed(() => props.toolOffset?.some(v => v !== 0) ?? false);
const hasComp = computed(() => props.eoffsetZ != null && props.eoffsetZ !== 0);

// @ts-expect-error TS6133 — hasRotation will be used for warning badge
const hasRotation = computed(() => {
  if (props.rotationXy != null && props.rotationXy !== 0) return true;
  const activeRow = wcsTable.value.find(r => r.name === props.g5xLabel);
  return activeRow != null && activeRow.r !== 0;
});

// ─── Cell editing ────────────────────────────────────────────
const editingCell = ref<{ wcs: string; axis: string } | null>(null);
const editValue = ref("");
const offsetInputRef = ref<HTMLInputElement | null>(null);

function startEditCell(wcs: string, axis: string, current: number) {
  if (!can.value.zero) return;
  editingCell.value = { wcs, axis };
  editValue.value = current.toFixed(4);
  nextTick(() => {
    const el = Array.isArray(offsetInputRef.value) ? offsetInputRef.value[0] : offsetInputRef.value;
    el?.focus();
    el?.select();
  });
}

function commitCell(wcs: string, axis: string) {
  if (!editingCell.value) return;
  const val = parseFloat(editValue.value);
  editingCell.value = null;
  if (isNaN(val)) return;
  send({ cmd: "set_wcs", target: wcs, [axis]: val });
  const row = wcsTable.value.find(r => r.name === wcs);
  if (row) (row as Record<string, string | number>)[axis] = val;
}

function cancelEdit() { editingCell.value = null; }

// ─── Clear actions ───────────────────────────────────────────
function clearSelected() {
  if (!selectedWcs.value) return;
  send({ cmd: "clear_wcs", target: selectedWcs.value });
  const zeroed = Object.fromEntries(offsetColumns.value.map(k => [k, 0]));
  wcsTable.value = wcsTable.value.map(row =>
    row.name === selectedWcs.value ? { ...row, ...zeroed } : row
  );
}

function clearAll() {
  send({ cmd: "clear_wcs", target: "all" });
  const zeroed = Object.fromEntries(offsetColumns.value.map(k => [k, 0]));
  wcsTable.value = wcsTable.value.map(row => ({ ...row, ...zeroed }));
}
</script>

<template>
  <div class="offsetPanel stack-sections">
    <!-- Header -->
    <div class="header row-controls">
      <span class="sub">Work Coordinate Offsets</span>
      <div class="actions row-tight">
        <Gate gate="idle">
          <div class="row-tight">
            <MachineBtn type="manage" :disabled="!selectedWcs" @click="clearSelected">
              Clear {{ selectedWcs ?? '–' }}
            </MachineBtn>
            <MachineBtn type="reset" @click="clearAll">Clear All</MachineBtn>
          </div>
        </Gate>
      </div>
    </div>

    <!-- Table -->
    <div class="tableWrap dataTable scroll-thin">
      <table>
        <thead>
          <tr>
            <th class="colName"></th>
            <th v-for="col in offsetColumns" :key="col" class="colVal">{{ col.toUpperCase() }}</th>
          </tr>
        </thead>
        <tbody>
          <!-- WCS rows (G54–G59.3) -->
          <tr v-for="row in wcsTable" :key="row.name"
              :class="{ activeRow: row.name === g5xLabel, selectedRow: row.name === selectedWcs }"
              @click="selectedWcs = row.name as string">
            <td class="offLabel">{{ row.name }}</td>
            <td v-for="axis in offsetColumns" :key="axis"
                :class="{
                  warn: axis === 'r' && row[axis] !== 0,
                  editableCell: can.zero
                }"
                @dblclick.stop="startEditCell(row.name as string, axis, Number(row[axis]) || 0)">
              <input
                v-if="editingCell?.wcs === row.name && editingCell?.axis === axis"
                ref="offsetInputRef"
                v-model="editValue"
                class="cellInput"
                @keydown.enter.prevent="commitCell(row.name as string, axis)"
                @keydown.escape.prevent="cancelEdit()"
                @blur="commitCell(row.name as string, axis)"
                @click.stop
              />
              <span v-else class="cellValue">{{ fmtOffset(Number(row[axis])) }}</span>
            </td>
          </tr>

          <!-- G92 row -->
          <tr v-if="hasG92" class="auxRow">
            <td class="offLabel auxLabel">G92</td>
            <td v-for="(col, i) in offsetColumns" :key="col">
              {{ col === 'r' ? '' : fmtOffset(g92Offset?.[i]) }}
            </td>
          </tr>

          <!-- Tool offset row -->
          <tr v-if="hasTool" class="auxRow">
            <td class="offLabel auxLabel">Tool</td>
            <td v-for="(col, i) in offsetColumns" :key="col">
              {{ col === 'r' ? '' : fmtOffset(toolOffset?.[i]) }}
            </td>
          </tr>

          <!-- Compensation row -->
          <tr v-if="hasComp" class="auxRow">
            <td class="offLabel auxLabel">Comp</td>
            <td v-for="col in offsetColumns" :key="col">
              {{ col === 'z' ? fmtOffset(eoffsetZ ?? undefined) : '' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.offsetPanel {
  height: 100%;
  min-height: 0;
}

.header {
  justify-content: space-between;
  flex-shrink: 0;
}

.tableWrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.tableWrap table {
  table-layout: fixed;
}

/* Override global dataTable sizing for larger tab layout */
.tableWrap th,
.tableWrap td {
  text-align: right;
  padding: var(--gap-tight) var(--gap-controls);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.colName { width: 60px; }

.tableWrap td.offLabel {
  text-align: left;
  font-weight: var(--fw-semibold);
  color: color-mix(in oklab, var(--fg) 80%, transparent);
  font-family: var(--font-sans);
}

.activeRow .offLabel {
  color: var(--info);
}

.selectedRow {
  background: color-mix(in oklab, var(--info) 15%, transparent);
  outline: 1px solid color-mix(in oklab, var(--info) 40%, transparent);
}

tbody tr {
  cursor: pointer;
}

tbody tr.auxRow {
  border-top: 1px solid color-mix(in oklab, var(--fg) 10%, transparent);
  cursor: default;
}

.auxLabel {
  opacity: var(--opacity-muted);
}

.warn {
  color: var(--warn);
}

.editableCell {
  cursor: cell;
}

.editableCell:hover {
  background: color-mix(in oklab, var(--info) 10%, transparent);
}

.cellInput {
  width: 100%;
  box-sizing: border-box;
  text-align: right;
  padding: 0 var(--gap-tight);
  -moz-appearance: textfield;
}

.cellInput::-webkit-inner-spin-button,
.cellInput::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.cellValue {
  display: block;
}
</style>
