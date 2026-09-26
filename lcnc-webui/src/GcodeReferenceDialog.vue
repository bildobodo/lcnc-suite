<script setup lang="ts">
import { ref, computed, watch } from "vue";
import DialogFrame from "./DialogFrame.vue";
import { GCODE_REFERENCE, GCODE_GROUPS, type GcodeEntry } from "./gcodeReference";
import MachineInput from "./MachineInput.vue";
import MachineSelect from "./MachineSelect.vue";

const props = defineProps<{ open: boolean; initialSearch?: string }>();
const emit = defineEmits<{ (e: "close"): void }>();

const search = ref("");
const filterGroup = ref("");

watch(() => props.open, (isOpen) => {
  if (isOpen && props.initialSearch) {
    search.value = props.initialSearch;
    filterGroup.value = "";
  }
});
const sortKey = ref<"code" | "name">("code");
const sortAsc = ref(true);

const filtered = computed<GcodeEntry[]>(() => {
  let entries = GCODE_REFERENCE;
  if (filterGroup.value) {
    entries = entries.filter(e => e.group === filterGroup.value);
  }
  const q = search.value.trim().toLowerCase();
  if (q) {
    entries = entries.filter(e =>
      e.code.toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q) ||
      e.desc.toLowerCase().includes(q)
    );
  }
  const key = sortKey.value;
  const dir = sortAsc.value ? 1 : -1;
  return [...entries].sort((a, b) => a[key].localeCompare(b[key]) * dir);
});

function toggleSort(key: "code" | "name") {
  if (sortKey.value === key) sortAsc.value = !sortAsc.value;
  else { sortKey.value = key; sortAsc.value = true; }
}
</script>

<template>
  <DialogFrame v-if="open" kind="info" size="lg" full title="G-code Reference" close-label="Close reference"
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
            <option v-for="g in GCODE_GROUPS" :key="g" :value="g">{{ g }}</option>
          </MachineSelect>
        </div>
        <div class="refTable dataTable scroll-thin fade-scroll">
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
              <tr v-for="entry in filtered" :key="entry.code">
                <td class="colCode refCode">{{ entry.code }}</td>
                <td class="colName">{{ entry.name }}</td>
                <td class="colDesc">{{ entry.desc }}</td>
                <td class="colSyntax refSyntax">{{ entry.syntax }}</td>
                <td class="colGroup">{{ entry.group }}</td>
              </tr>
              <tr v-if="filtered.length === 0">
                <td colspan="5" class="emptyState noMatch refEmpty">No matching codes found.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="refFooter">
          {{ filtered.length }} {{ filtered.length === 1 ? 'code' : 'codes' }}
          <span v-if="filterGroup"> in {{ filterGroup }}</span>
        </div>
      </div>
  </DialogFrame>
</template>

<style scoped>
.refContent {
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
  width: 140px;
  white-space: nowrap;
}

.colDesc {
  min-width: 200px;
}

.colSyntax {
  width: 200px;
  white-space: nowrap;
}

.colGroup {
  width: 120px;
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

/* Specificity over `.refTable td` (0,1,1) instead of !important. */
.refTable td.refEmpty { padding: var(--gap-panel); }

.refFooter {
  font-size: var(--fs-xs);
  color: var(--fg-muted);
  text-align: right;
}

</style>
