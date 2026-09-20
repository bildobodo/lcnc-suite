<script setup lang="ts">
import { ref, computed } from "vue";
import { usePermissions, useFire } from "./permissions";
import { fmtOffset } from "./format";
import { openKeypad, newKeypadOwnerId } from "./useNumberKeypad";
import { G5X_LABELS } from "./wcs";
import MachineBtn from "./MachineBtn.vue";

import Gate from "./Gate.vue";

const can = usePermissions();
const fire = useFire();

type WcsRow = { name: string; [axis: string]: string | number };

const props = defineProps<{
  axes: string[];
  g5xLabel: string;
  g92Offset: number[] | null;
  toolOffset: number[] | null;
  eoffsetZ: number | null;
  eoffsetEnabled: boolean;
  rotationXy: number | null;
  wcsTable: WcsRow[];
  linearUnit?: string;
}>();

// Row selection (WP6, review D): the operator's PINNED row, else the active
// fixture. It used to be a one-shot onMounted snapshot of g5xLabel — before
// the first status that is "-", which is truthy, so Clear sent
// `clear_wcs target=-` and the gateway answered "Invalid target". A
// placeholder is never a target: only a real fixture name selects.
const pinned = ref<string | null>(null);
const selectedWcs = computed<string | null>(() =>
  pinned.value ?? ((G5X_LABELS as readonly string[]).includes(props.g5xLabel) ? props.g5xLabel : null));

const offsetColumns = computed(() => [...props.axes.map(l => l.toLowerCase()), "r"]);

// Formatting imported from format.ts (fmtOffset)

// ─── Auxiliary row visibility ────────────────────────────────
const hasG92 = computed(() => props.g92Offset?.some(v => v !== 0) ?? false);
const hasTool = computed(() => props.toolOffset?.some(v => v !== 0) ?? false);
const hasComp = computed(() => props.eoffsetZ != null && props.eoffsetZ !== 0);

// ─── Cell editing ────────────────────────────────────────────
// `set_wcs` is a probe-tier write on the backend (command_policy) — the
// panel used the ready tier and a raw send; both go through fire() now.
const keypadOwner = newKeypadOwnerId("wcs");
function startEditCell(wcs: string, axis: string, current: number) {
  if (!can.value.probe) return;
  // Read-only when source data is null/missing — see fmtOffset() in format.ts.
  // Editing a "—" cell with a synthesized 0 would silently replace missing
  // data with a real value the user didn't intend.
  if (!Number.isFinite(current)) return;
  const unit = axis === "r" ? "°" : props.linearUnit ?? "";
  openKeypad({
    value: current,
    label: `${wcs} ${axis.toUpperCase()}`,
    context: unit ? `${wcs} · ${axis.toUpperCase()} · ${unit}` : `${wcs} · ${axis.toUpperCase()}`,
    ownerId: keypadOwner,
    canConfirm: () => !!can.value.probe,
    onConfirm: (v) => { fire({ cmd: "set_wcs", target: wcs, [axis]: v }, "probe"); },
  });
}

// ─── Clear actions ───────────────────────────────────────────
// Both are hold-to-fire like Zero/Home (operator decision 2026-09-19); the
// selected button's hold is bound to its target (`hold-key`) so a selection
// change mid-hold cancels instead of retargeting.
function clearSelected() {
  const target = selectedWcs.value;
  if (!target) return;
  fire({ cmd: "clear_wcs", target }, "probe");
}

function clearAll() {
  fire({ cmd: "clear_wcs", target: "all" }, "probe");
}
</script>

<template>
  <div class="offsetPanel stack-sections">
    <!-- Header -->
    <div class="header row-controls">
      <span class="sub">Work Coordinate Offsets</span>
      <div class="actions row-tight">
        <Gate gate="probe">
          <div class="row-tight">
            <MachineBtn type="wcsClear" :disabled="!selectedWcs" reason="Select a coordinate system first"
                        :hold-key="selectedWcs ?? ''" @click="clearSelected">
              Clear <span class="val-slot wcsSlot">{{ selectedWcs ?? '–' }}</span>
            </MachineBtn>
            <MachineBtn type="wcsClearAll" hold-key="all" @click="clearAll">Clear All</MachineBtn>
          </div>
        </Gate>
      </div>
    </div>

    <!-- Table -->
    <div class="tableWrap dataTable scroll-thin fade-scroll" :style="{ '--val-cols': String(offsetColumns.length) }">
      <table>
        <thead>
          <tr>
            <th class="colName"></th>
            <th v-for="col in offsetColumns" :key="col" class="colVal">{{ col.toUpperCase() }}</th>
          </tr>
        </thead>
        <tbody>
          <!-- WCS rows (G54–G59.3) -->
          <tr v-for="row in props.wcsTable" :key="row.name"
              :class="{ activeRow: row.name === g5xLabel, selectedRow: row.name === selectedWcs }"
              @click="pinned = row.name as string">
            <td class="offLabel">{{ row.name }}</td>
            <td v-for="axis in offsetColumns" :key="axis"
                :class="{
                  warn: axis === 'r' && row[axis] !== 0,
                  editableCell: can.probe && Number.isFinite(Number(row[axis]))
                }"
                @click="startEditCell(row.name as string, axis, Number(row[axis]))">
              <span class="cellValue">{{ fmtOffset(Number(row[axis])) }}</span>
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

/* The selected-fixture label is a fixed slot: "G59.3" and "–" must not
   resize the button (the row's other button would shift). */
.wcsSlot { --slot-w: 5ch; text-align: left; }

.tableWrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.tableWrap table {
  table-layout: fixed;
  /* Fixed layout divides width evenly — at 9 axes (10 value columns) the
     cells compressed until digits collided. Give each value column a
     usable minimum and let the .scroll-thin wrap scroll horizontally;
     3-axis tables stay narrower than the pane and render as before. */
  min-width: calc(60px + var(--val-cols, 4) * 76px);
}

/* Override global dataTable sizing for larger tab layout */
.tableWrap th,
.tableWrap td {
  text-align: right;
  padding: var(--gap-tight) var(--gap-controls);
  font-variant-numeric: tabular-nums;
}

.colName { width: 60px; }

.tableWrap td.offLabel {
  text-align: left;
  font-weight: var(--fw-semibold);
  color: color-mix(in oklab, var(--fg) 80%, transparent);
}

.selectedRow {
  background: color-mix(in oklab, var(--info) 15%, transparent);
  outline: 1px solid color-mix(in oklab, var(--info) 40%, transparent);
}

/* Active WCS = machine state → --ok (selection stays --info). Declared after
   .selectedRow so the machine-truth background wins when a row is both. */
.activeRow {
  background: var(--hl-surface-ok);
}

.activeRow .offLabel {
  color: var(--ok);
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

/* Persistent tint, not :hover — hover affordances are invisible on touch,
   and this class only exists while the cell is actually editable (can.probe). */
.editableCell {
  cursor: cell;
  background: var(--hl-surface-info);
}

.cellValue {
  display: block;
}
</style>
