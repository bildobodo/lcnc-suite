<script setup lang="ts">
import { ref, computed, watch } from "vue";
import DialogFrame from "./DialogFrame.vue";
import { GCODE_REFERENCE, GCODE_GROUPS } from "./gcodeReference";
import { ACTIVE_FILTER, referenceRows, refTargets, unknownActive, normaliseCode } from "./gcodeRefView";
import MachineInput from "./MachineInput.vue";
import MachineSelect from "./MachineSelect.vue";
import { vStickyHead } from "./stickyHead";

// `at`: a code word to open AT (a code tapped in the program) — the whole
// list, scrolled to its entry (or every form it heads), marked; `active`:
// open on "Active now" (the Safety strip's codes block). Operator
// 2026-10-03, variant B of the renders.
const props = defineProps<{ open: boolean; at?: string; active?: boolean; activeCodes: readonly string[] }>();
const emit = defineEmits<{ (e: "close"): void }>();

const search = ref("");
const filterGroup = ref("");
const sortKey = ref<"code" | "name">("code");
const sortAsc = ref(true);
const marked = ref<readonly string[]>([]);
const tableEl = ref<HTMLElement | null>(null);

watch(() => props.open, (isOpen) => {
  if (!isOpen) { marked.value = []; return; }
  // a plain open keeps what the operator typed or chose — but not the view
  // the codes block opened
  if (!props.active && filterGroup.value === ACTIVE_FILTER) filterGroup.value = "";
  if (props.active) {
    search.value = "";
    filterGroup.value = props.activeCodes.length ? ACTIVE_FILTER : "";
  } else if (props.at) {
    const targets = refTargets(GCODE_REFERENCE, props.at);
    filterGroup.value = "";
    // no entry for the word: what a search for it finds (never a blank jump)
    search.value = targets.length ? "" : normaliseCode(props.at);
    marked.value = targets;
  }
}, { immediate: true });
// The table mounts with the dialog (deferred Teleport): scroll to the
// marked entry once it is there, below the sticky head.
watch(tableEl, (el) => {
  el?.querySelector<HTMLElement>("tr.refMarked")?.scrollIntoView({ block: "center" });
}, { flush: "post" });

// no codes (no status yet, a lost connection): the filter has no option
watch(() => props.activeCodes.length === 0, (none) => {
  if (none && filterGroup.value === ACTIVE_FILTER) filterGroup.value = "";
});

const rows = computed(() => referenceRows(GCODE_REFERENCE, {
  search: search.value, group: filterGroup.value, active: props.activeCodes,
  sortKey: sortKey.value, asc: sortAsc.value,
}));
const unknown = computed(() => filterGroup.value === ACTIVE_FILTER ? unknownActive(GCODE_REFERENCE, props.activeCodes) : []);

function toggleSort(key: "code" | "name") {
  if (sortKey.value === key) sortAsc.value = !sortAsc.value;
  else { sortKey.value = key; sortAsc.value = true; }
}
</script>

<template>
  <DialogFrame v-if="open" kind="info" size="lg" full wide title="G-code Reference" close-label="Close reference"
               initial-focus="input.refSearch" @close="emit('close')">
      <div class="stack-controls refContent">
        <!-- Search and group filter: one row of fields (design wave D4) -->
        <div class="refSearchRow row-controls">
          <MachineInput
            gate="search"
            type="text"
            v-model="search"
            label="Search G-code reference"
            placeholder="Search codes, names, descriptions…"
            class="refSearch"
          />
          <MachineSelect gate="filter" v-model="filterGroup" name="gcodeGroupFilter" aria-label="Filter by group">
            <option value="">All groups</option>
            <option v-if="activeCodes.length" :value="ACTIVE_FILTER">Active now</option>
            <option v-for="g in GCODE_GROUPS" :key="g" :value="g">{{ g }}</option>
          </MachineSelect>
        </div>
        <!-- Nothing scrolls sideways: Name and Syntax wrap at Settings'
             width; a narrow dialog stacks each row as a card (below). -->
        <div ref="tableEl" v-sticky-head class="refTable dataTable scroll-thin fade-scroll">
          <table>
            <thead>
              <tr>
                <th class="colCode">
                  <button class="sortHeader" @click="toggleSort('code')">Code {{ sortKey === 'code' ? (sortAsc ? '▲' : '▼') : '' }}</button>
                </th>
                <th class="colName">
                  <button class="sortHeader" @click="toggleSort('name')">Name {{ sortKey === 'name' ? (sortAsc ? '▲' : '▼') : '' }}</button>
                </th>
                <th class="colDesc">Description</th>
                <th class="colSyntax">Syntax</th>
                <th class="colGroup">Group</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in rows" :key="entry.code" :class="{ refMarked: marked.includes(entry.code) }"
                  :aria-current="marked.includes(entry.code) ? 'true' : undefined">
                <td class="colCode refCode">{{ entry.code }}</td>
                <td class="colName">{{ entry.name }}</td>
                <td class="colDesc">{{ entry.desc }}</td>
                <td class="colSyntax refSyntax">{{ entry.syntax }}</td>
                <td class="colGroup">{{ entry.group }}</td>
              </tr>
              <tr v-if="rows.length === 0">
                <td colspan="5" class="emptyState noMatch refEmpty">No matching codes found.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="refFooter">
          {{ rows.length }} {{ rows.length === 1 ? 'code' : 'codes' }}
          <span v-if="filterGroup === ACTIVE_FILTER"> active now<template v-if="unknown.length"> · not in the reference: {{ unknown.join(" ") }}</template></span>
          <span v-else-if="filterGroup"> in {{ filterGroup }}</span>
        </div>
      </div>
  </DialogFrame>
</template>

<style scoped>
.refContent {
  /* the cards below follow the dialog's own width */
  container-type: inline-size;
  flex: 1;
  min-height: 0;
  padding: var(--gap-section);
}

.refSearchRow { flex-shrink: 0; }
.refSearch { flex: 1; min-width: 0; }

.refTable {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.colCode {
  width: 80px;
  white-space: nowrap;
}

.colName {
  width: 130px;
}

.colDesc {
  min-width: 160px;
}

.colSyntax {
  width: 170px;
}

.colGroup {
  width: 96px;
}

.refCode {
  font-family: var(--font-mono);
  font-weight: var(--fw-semibold);
  color: var(--accent-text);
}

.refSyntax {
  font-family: var(--font-mono);
  color: var(--fg-muted);
}

/* The entry the reference was opened AT: the selection tint and a bar at
   the row's start — never colour alone. */
.refTable tr.refMarked td { background: var(--hl-selected); }
.refTable tr.refMarked td:first-child { box-shadow: inset 3px 0 0 var(--info); }

/* Specificity over `.refTable td` (0,1,1) instead of !important. */
.refTable td.refEmpty { padding: var(--gap-panel); }

.refFooter {
  font-size: var(--fs-xs);
  color: var(--fg-muted);
  text-align: right;
}

/* A narrow dialog (portrait, 150 %): a row is a card — code and name, then
   description and syntax across the card; the group lives in the filter.
   The head stays (sticky, the two sort buttons). */
@container (max-width: 520px) {
  .refSearchRow { flex-wrap: wrap; }
  .refSearch { flex-basis: 100%; }
  .refTable table, .refTable thead, .refTable tbody { display: block; }
  .refTable tr { display: grid; grid-template-columns: auto 1fr; column-gap: var(--gap-controls); row-gap: var(--gap-micro); }
  .refTable thead { box-shadow: inset 0 -1px 0 var(--border); }
  .refTable thead tr { column-gap: 0; }
  .refTable tbody tr { padding: var(--gap-tight) var(--gap-controls); border-bottom: 1px solid var(--border); }
  .refContent .refTable td,
  .refContent .refTable th { display: block; width: auto; min-width: 0; border: none; padding: 0; background: none; }
  .refContent .refTable thead th { padding: var(--gap-tight) var(--gap-controls); box-shadow: none; }
  .refTable td.colDesc, .refTable td.colSyntax { grid-column: 1 / -1; }
  .refContent .refTable th.colDesc, .refContent .refTable th.colSyntax, .refContent .refTable .colGroup { display: none; }
  .refContent .refTable td.refEmpty { grid-column: 1 / -1; padding: var(--gap-panel); }
  .refTable tbody tr.refMarked { background: var(--hl-selected); box-shadow: inset 3px 0 0 var(--info); }
  .refTable tr.refMarked td:first-child { box-shadow: none; }
}
</style>
