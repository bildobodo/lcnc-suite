<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from "vue";
import { usePermissions, useFire, useOwnerPermissions, usePermissionReasons } from "./permissions";
import { fmtOffset, NO_VALUE } from "./format";
import { openKeypad, closeKeypadIf, keypadState, newKeypadOwnerId, dropDrafts } from "./useNumberKeypad";
import { G5X_LABELS } from "./wcs";
import MachineBtn from "./MachineBtn.vue";

import Gate from "./Gate.vue";
import { vStickyHead } from "./stickyHead";
import { offsetAux } from "./offsetRows";
import { isRotaryAxis } from "./useAxes";

const can = usePermissions();
const ownerCan = useOwnerPermissions();
const fire = useFire();

type WcsRow = { name: string; [axis: string]: string | number };

const props = defineProps<{
  axes: string[];
  g5xLabel: string;
  g92Offset: number[] | null;
  toolOffset: number[] | null;
  eoffsetZ: number | null;
  /** null: the reader has no value — unknown, never "off" (Codex R22 OP22-03). */
  eoffsetEnabled: boolean | null;
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

// ─── Auxiliary rows (operator P5/P6) ─────────────────────────
// By each axis letter's CANONICAL slot — the visible column index showed B's
// G92 under C on XYZAC — and unknown told apart from zero (offsetRows.ts).
const aux = computed(() => offsetAux({
  letters: props.axes, g92: props.g92Offset, tool: props.toolOffset,
  compZ: props.eoffsetZ, compEnabled: props.eoffsetEnabled,
}));
const auxValue = (row: { values: Record<string, number | null> }, col: string) =>
  col === "r" ? "" : fmtOffset(row.values[col] ?? undefined);
/** Degrees for R and the rotary axes, the linear unit for the rest. */
function cellUnit(axis: string): string {
  return axis === "r" || isRotaryAxis(axis.toUpperCase()) ? "°" : props.linearUnit ?? "";
}
/** The cell whose keypad session is open — its own mark, not the focus ring. */
function isEditing(wcs: string, axis: string): boolean {
  return keypadState.open && !keypadState.locked && keypadState.ownerId === cellOwner(wcs, axis);
}

// ─── Cell editing ────────────────────────────────────────────
// `set_wcs` is a probe-tier write on the backend (command_policy) — the
// panel used the ready tier and a raw send; both go through fire() now.
// Every cell is its OWN keypad owner (implementation review UI-I03): the
// session is bound to one fixture × axis, its draft stays with that cell,
// and confirm asks — fresh, at confirm time — that the panel is visible,
// the gate open and the row still present. A hidden panel (tab switch)
// LOCKS the session through the trigger cell (inputSession.ts poll), so the
// keypad never stays up for a target the operator cannot see.
const panelEl = ref<HTMLElement | null>(null);
const ownerPrefix = newKeypadOwnerId("wcs");
function cellOwner(wcs: string, axis: string): string { return `${ownerPrefix}:${wcs}:${axis}`; }
function startEditCell(wcs: string, axis: string, current: number, e: Event) {
  if (!can.value.probe) return;
  // Read-only when source data is null/missing — see fmtOffset() in format.ts.
  // Editing a "—" cell with a synthesized 0 would silently replace missing
  // data with a real value the user didn't intend.
  if (!Number.isFinite(current)) return;
  const ownerId = cellOwner(wcs, axis);
  // A second tap on the cell already being edited keeps its expression.
  if (keypadState.open && keypadState.ownerId === ownerId && !keypadState.locked) return;
  const unit = cellUnit(axis);
  openKeypad({
    value: current,
    label: `${wcs} ${axis.toUpperCase()}`,
    context: unit ? `${wcs} · ${axis.toUpperCase()} · ${unit}` : `${wcs} · ${axis.toUpperCase()}`,
    ownerId,
    // The value button (keyboard, or a tap on the value) or the cell (a tap on its padding).
    trigger: (e.target as HTMLElement).closest<HTMLElement>("button, td") ?? (e.currentTarget as HTMLElement),
    canConfirm: () => !!can.value.probe
      && !!panelEl.value && panelEl.value.offsetParent !== null
      && props.wcsTable.some(r => r.name === wcs),
    onConfirm: (v) => { fire({ cmd: "set_wcs", target: wcs, [axis]: v }, "probe"); },
  });
}
function ownsKeypad(): boolean { return keypadState.open && keypadState.ownerId.startsWith(`${ownerPrefix}:`); }
// The gate closing ends EVERY cell's context (same rule as MachineInput):
// the open session, when one of our cells holds the keypad, and every
// filed cell draft — a draft parked on G54/X must not outlive the gate that
// admitted it (review round 2, UI-I05 B). The busy latch after a command
// is not an end (the gate re-opens in DEFAULT_COOLDOWN_MS), a real backend
// revocation inside it is — hence the OWNER permissions, which carry no
// latch term (round 3).
const gateEnded = computed(() => !ownerCan.value.probe);

// Editable or READ-ONLY (Codex R25 OP-I06, answer 5): the owner permissions
// — without the 200 ms busy latch, which must not flip 70 values to text and
// back after every confirmed value. Locked, a value is text in its button's
// place; the reason stands ONCE, in a reserved line under the head (never 70
// hints), and a focused value keeps a focus in its cell: the button's focus
// goes to its text (tabindex -1, the arrows stay local — never BODY, where
// an arrow jogs) and back to the button when the gate opens.
const editable = computed(() => !!ownerCan.value.probe);
const reasons = usePermissionReasons();
const lockLine = computed(() => editable.value ? "Select a value to edit it"
  : `Read-only — ${reasons.value.probe ?? "not available now"}`);
watch(editable, (now) => {
  const td = (document.activeElement as HTMLElement | null)?.closest?.("td[data-input-area]");
  if (!td || !panelEl.value?.contains(td)) return;
  const cell = td.getAttribute("data-input-area");
  void nextTick(() => panelEl.value?.querySelector<HTMLElement>(
    `td[data-input-area="${cell}"] ${now ? "button" : ".cellValue"}`)?.focus());
}, { flush: "pre" });
const LOCKED_NAV = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", " ", "Enter"]);
function onLockedKeydown(e: KeyboardEvent) {
  // Tab moves on; everything a jog or Cycle Start could hear stays here.
  if (LOCKED_NAV.has(e.key)) { e.preventDefault(); e.stopPropagation(); }
}
function endCells(reason?: string) {
  if (ownsKeypad()) closeKeypadIf(keypadState.ownerId, reason);
  dropDrafts(id => id.startsWith(`${ownerPrefix}:`));
}
watch(gateEnded, (ended) => { if (ended) endCells("WCS edit gate closed while the keypad was open"); });
onUnmounted(() => endCells());

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
  <div ref="panelEl" class="offsetPanel stack-sections">
    <!-- Header, and ONE reserved line under it: what a tap on a value does,
         or why the values are read-only (Codex R25 answer 5) — the same
         height in every state, so nothing moves when the gate closes. -->
    <div class="stack-tight">
      <div class="header row-controls">
        <span class="sub">Work Offsets</span>
        <div class="actions row-tight">
          <Gate gate="probe">
            <div class="row-tight">
              <!-- Both are hold-to-fire (operator decision 2026-09-19); the title
                   names the hold and its target, the all-fixtures scope is spelled
                   out (UX-12). -->
              <MachineBtn type="wcsClear" :disabled="!selectedWcs" reason="Select a coordinate system first"
                          :hold-key="selectedWcs ?? ''" :title="selectedWcs ? `Hold to clear ${selectedWcs}` : undefined" @click="clearSelected">
                Clear <span class="val-slot wcsSlot">{{ selectedWcs ?? NO_VALUE }}</span>
              </MachineBtn>
              <MachineBtn type="wcsClearAll" hold-key="all" aria-label="Clear all work offsets (G54–G59.3)" title="Hold to clear all work offsets (G54–G59.3)" @click="clearAll">Clear All</MachineBtn>
            </div>
          </Gate>
        </div>
      </div>
      <div class="lockLine text-muted" role="status" :title="lockLine">{{ lockLine }}</div>
    </div>

    <!-- Table -->
    <div v-sticky-head class="tableWrap dataTable scroll-thin fade-scroll" :style="{ '--val-cols': String(offsetColumns.length) }">
      <table>
        <thead>
          <tr>
            <th class="colName"></th>
            <th v-for="col in offsetColumns" :key="col" class="colVal">{{ col.toUpperCase() }}</th>
          </tr>
        </thead>
        <tbody>
          <!-- WCS rows (G54–G59.3) -->
          <!-- Four states, four cues (operator P5, Codex R21): the machine's
               active fixture = a bar at the row's start + aria-current (not
               the tint alone), the row selected for Clear = .selectedRow,
               the cell being edited = its inner edge (.editingCell), keyboard
               focus = the global ring on the value button. -->
          <tr v-for="row in props.wcsTable" :key="row.name"
              :class="{ activeRow: row.name === g5xLabel, selectedRow: row.name === selectedWcs }"
              :aria-current="row.name === g5xLabel ? 'true' : undefined"
              @click="pinned = row.name as string">
            <td class="offLabel" :title="row.name === g5xLabel ? 'Active work offset' : undefined">{{ row.name }}</td>
            <td v-for="axis in offsetColumns" :key="axis"
                :class="{
                  'text-warn': axis === 'r' && row[axis] !== 0,
                  editableCell: can.probe && Number.isFinite(Number(row[axis])),
                  editingCell: isEditing(row.name as string, axis),
                }"
                :data-input-area="cellOwner(row.name as string, axis)"
                @click="startEditCell(row.name as string, axis, Number(row[axis]), $event)">
              <!-- The keyboard path to the cell (Tab, Enter/Space); a tap on
                   the value or the cell's padding opens it the same way.
                   Locked, the value is TEXT in the button's place: a dimmed
                   button would fade 70 values the operator reads during a
                   run (the fieldset's disabled opacity), and 70 tab stops
                   would say one reason. The layout sweep holds the text to
                   the button's footprint (data-layout-slot). -->
              <MachineBtn v-if="editable && Number.isFinite(Number(row[axis]))" type="offsetCell"
                          :aria-label="`Edit ${row.name} ${axis.toUpperCase()}`">{{ fmtOffset(Number(row[axis])) }}</MachineBtn>
              <span v-else class="cellValue" data-layout-slot tabindex="-1" @keydown="onLockedKeydown">{{ fmtOffset(Number(row[axis])) }}</span>
            </td>
          </tr>

          <!-- G52 and G92 share one register; G92 can be suspended while its
               values stay stored (LinuxCNC coordinate systems). -->
          <tr v-if="aux.g92.state === 'active'" class="auxRow">
            <td class="offLabel auxLabel" title="G52/G92 offset in effect (one register)">G52/G92</td>
            <td v-for="col in offsetColumns" :key="col">{{ auxValue(aux.g92, col) }}</td>
          </tr>

          <!-- The tool offset IN EFFECT (G43…), not the tool table's length. -->
          <tr v-if="aux.tool.state === 'active'" class="auxRow">
            <td class="offLabel auxLabel" title="Tool offset in effect (G43), not the table length">Tool</td>
            <td v-for="col in offsetColumns" :key="col">{{ auxValue(aux.tool, col) }}</td>
          </tr>

          <!-- Comp: enabled (its amount on Z, 0 included); off = no row. -->
          <tr v-if="aux.comp === 'active'" class="auxRow">
            <td class="offLabel auxLabel" title="Surface compensation (external offset) in effect">Comp</td>
            <td v-for="col in offsetColumns" :key="col">{{ col === 'z' ? fmtOffset(aux.compZ ?? undefined) : '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- ONE line: nothing in effect only when every source is known; an
         unknown source is named, never shown as zero (Codex R21/R22). -->
    <div v-if="aux.summary" class="offsetSummary text-muted">
      {{ aux.summary.kind === 'none'
        ? 'No G52/G92, tool or comp offset in effect'
        : `Offset status unknown — ${aux.summary.sources.join(', ')}` }}
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

/* The selected-fixture label is a fixed slot: "G59.3" and "—" must not
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
  min-width: calc(56px + var(--val-cols, 4) * 76px);
}

/* Override global dataTable sizing for larger tab layout */
.tableWrap th,
.tableWrap td {
  text-align: right;
  padding: var(--gap-tight) var(--gap-controls);
  font-variant-numeric: tabular-nums;
}

/* The widest name ("G59.3") needs 36 px + padding. 60 px pushed the 5-axis
   table (6 value columns) 4 px past the reference pane: a sideways
   scrollbar for a sliver (layout sweep, sliver-scroll). */
.colName { width: 56px; }

.tableWrap td.offLabel {
  text-align: left;
  font-weight: var(--fw-semibold);
}

.selectedRow {
  background: color-mix(in oklab, var(--info) var(--tint-note), transparent);
  outline: 1px solid color-mix(in oklab, var(--info) var(--tint-heavy), transparent);
}

/* Active WCS = machine state → --ok (selection stays --info). Declared after
   .selectedRow so the machine-truth background wins when a row is both. */
.activeRow {
  background: var(--hl-surface-ok);
}

.activeRow .offLabel {
  color: var(--ok-text);
  /* A shape beside the tint and the colour (not colour alone, P5). */
  box-shadow: inset 3px 0 0 var(--ok);
}

tbody tr {
  cursor: pointer;
}

tbody tr.auxRow {
  border-top: 1px solid color-mix(in oklab, var(--fg) 10%, transparent);
  cursor: default;
}

/* The auxiliary rows' names (G92, Tool, Comp) read muted beside the
   fixtures — a contextual rule: the offLabel rule above outranks a utility. */
.tableWrap td.auxLabel {
  color: var(--fg-muted);
}


/* Persistent tint, not :hover — hover affordances are invisible on touch,
   and this class only exists while the cell is actually editable (can.probe,
   the busy latch included — a tap inside it opens nothing; the value stays a
   button: `editable` is the owner gate, the latch never flips the table). */
.editableCell {
  cursor: cell;
  background: var(--hl-surface-info);
}

/* The locked value keeps the value button's box — on touch the button
   floor (--touch-target-compact), text centred like a button's — so a
   closing gate never moves a row (the layout sweep's data-layout-slot). */
.cellValue {
  display: grid;
  align-content: center;
}
html.touch-device .cellValue {
  min-height: var(--touch-target-compact);
}

/* The cell being edited: its inner edge, distinct from the focus ring (the
   keypad holds the focus meanwhile — the ring would claim two targets). */
.editingCell {
  box-shadow: inset 0 0 0 2px var(--info);
}

.offsetSummary { flex-shrink: 0; }
/* One line in every state: a reason too long for a narrow pane ends in an
   ellipsis (the whole text is its title) rather than moving the table. */
.lockLine { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
</style>
