<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { ClipboardCopy, ListX, Trash2 } from "lucide-vue-next";
import DialogFrame from "./DialogFrame.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineSelect from "./MachineSelect.vue";
import { vStickyHead } from "./stickyHead";
import type { LcncMessage } from "./ws/statusStore";
import {
  MESSAGE_FILTERS, TYPE_LABEL, SOURCE_LABEL, messageRows, messageType, sourceOf, messageLine, type MessageSortKey,
} from "./messageView";

// The message center laid out like the G-code reference and the Macros tab
// (operator 2026-10-04): a search row with one filter, a table with a
// sortable head (Time, Type, Source), Copy and the trash per row.
const props = defineProps<{
  messages: readonly LcncMessage[];
  /** The banner's current condition with its "why" (UI-N26). */
  banner: { tier: "error" | "warn"; text: string; detail?: string } | null;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "dismiss", id: number): void;
  (e: "clearAll"): void;
  (e: "copy", text: string): void;
}>();

const search = ref("");
const filter = ref("");
const sortKey = ref<MessageSortKey>("time");
const asc = ref(false);   // newest first
const rows = computed(() => messageRows(props.messages, { search: search.value, filter: filter.value, sortKey: sortKey.value, asc: asc.value }));
// the count lives in the title — a footer line cost the touchscreen's low
// dialog a whole row
const title = computed(() => rows.value.length === props.messages.length
  ? `Messages (${props.messages.length})` : `Messages (${rows.value.length} of ${props.messages.length})`);

function toggleSort(key: MessageSortKey) {
  if (sortKey.value === key) asc.value = !asc.value;
  else { sortKey.value = key; asc.value = key !== "time"; }
}
const mark = (key: MessageSortKey) => sortKey.value === key ? (asc.value ? " ▲" : " ▼") : "";
const ariaSort = (key: MessageSortKey) => sortKey.value === key ? (asc.value ? "ascending" : "descending") : "none";
function time(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString();
}
const copyLabel = computed(() => rows.value.length === props.messages.length ? "Copy All" : "Copy Shown");

/** ONE narrow flag (the side pane's rule: one threshold, so every narrow
 *  rule flips together): a center narrower than this (150 % portrait) makes
 *  each message a card, and its header's Copy / Clear All become symbols —
 *  with their words the header ran 8 px out of a 255 px dialog. */
const NARROW_PX = 520;
const content = ref<HTMLElement | null>(null);
const narrow = ref(false);
let resize: ResizeObserver | null = null;
onMounted(() => {
  resize = new ResizeObserver(([e]) => { narrow.value = e!.contentRect.width < NARROW_PX; });
  if (content.value) resize.observe(content.value);
});
onBeforeUnmount(() => resize?.disconnect());

function copyShown() { emit("copy", rows.value.map(m => messageLine(m, time(m.ts))).join("\n")); }
</script>

<template>
  <DialogFrame kind="info" size="lg" full wide :title="title"
               close-label="Close messages" initial-focus="input.msgSearch" @close="emit('close')">
    <template #header>
      <MachineBtn type="inline" :aria-label="copyLabel" :title="copyLabel" @click="copyShown" :disabled="rows.length === 0">
        <ClipboardCopy v-if="narrow" :size="14" /><template v-else>{{ copyLabel }}</template>
      </MachineBtn>
      <MachineBtn type="inline" aria-label="Clear All" title="Clear All" @click="emit('clearAll')" :disabled="messages.length === 0">
        <ListX v-if="narrow" :size="14" /><template v-else>Clear All</template>
      </MachineBtn>
    </template>
    <div ref="content" class="stack-controls msgContent" :class="{ narrow }">
      <!-- The banner's current condition with its "why" — a tap on the
           banner lands here (UI-N26: nothing essential only in a title). -->
      <div v-if="banner" class="statusNote" :class="banner.tier" role="alert">
        <span><strong>{{ banner.text }}</strong><template v-if="banner.detail"><br>{{ banner.detail }}</template></span>
      </div>
      <div class="msgSearchRow row-controls">
        <MachineInput gate="search" type="text" v-model="search" label="Search messages"
                      placeholder="Search messages…" class="msgSearch" />
        <MachineSelect gate="filter" v-model="filter" name="messageFilter" aria-label="Filter messages">
          <!-- constant options; the memo keeps them out of the re-render every
               message causes (Firefox rebuilds an open list on any change) -->
          <option v-for="f in MESSAGE_FILTERS" :key="f.value" v-memo="[f.value]" :value="f.value">{{ f.label }}</option>
        </MachineSelect>
      </div>
      <div v-sticky-head class="msgTable dataTable scroll-thin fade-scroll">
        <table>
          <thead>
            <tr>
              <th class="colTime" :aria-sort="ariaSort('time')"><button class="sortHeader" @click="toggleSort('time')">Time{{ mark('time') }}</button></th>
              <th class="colType" :aria-sort="ariaSort('type')"><button class="sortHeader" @click="toggleSort('type')">Type{{ mark('type') }}</button></th>
              <th class="colSource" :aria-sort="ariaSort('source')"><button class="sortHeader" @click="toggleSort('source')">Source{{ mark('source') }}</button></th>
              <th class="colText">Message</th>
              <th class="colActions" aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in rows" :key="m.id" :class="messageType(m.kind)">
              <td class="colTime msgTime">{{ time(m.ts) }}</td>
              <td class="colType"><span class="msgType">{{ TYPE_LABEL[messageType(m.kind)] }}</span></td>
              <td class="colSource">{{ sourceOf(m) ? SOURCE_LABEL[sourceOf(m)!] : "—" }}</td>
              <td class="colText msgText">{{ m.text }}</td>
              <td class="colActions">
                <span class="row-tight">
                  <MachineBtn type="listAction" title="Copy" aria-label="Copy message" @click="emit('copy', messageLine(m, time(m.ts)))"><ClipboardCopy :size="14" /></MachineBtn>
                  <MachineBtn type="listAction" title="Delete" aria-label="Delete message" @click="emit('dismiss', m.id)"><Trash2 :size="14" /></MachineBtn>
                </span>
              </td>
            </tr>
            <tr v-if="rows.length === 0">
              <td colspan="5" class="emptyState msgEmpty">{{ messages.length ? "No matching messages." : "No messages" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </DialogFrame>
</template>

<style scoped>
.msgContent {
  flex: 1;
  min-height: 0;
  padding: var(--gap-section);
}
.msgSearchRow { flex-shrink: 0; }
.msgSearch { flex: 1; min-width: 0; }
.msgTable { flex: 1; min-height: 0; overflow: auto; }
.colTime { width: 140px; white-space: nowrap; }
.colType { width: 70px; }
.colSource { width: 80px; }
.colActions { width: 1%; white-space: nowrap; }
.msgTime { font-variant-numeric: tabular-nums; color: var(--fg-muted); }
.msgType { font-weight: var(--fw-semibold); }
.msgText { overflow-wrap: anywhere; }
/* the type reads by word AND colour, and the row carries a bar */
tr.error .msgType { color: var(--danger-text); }
tr.display .msgType { color: var(--info-text); }
tr.error td:first-child { box-shadow: inset 3px 0 0 var(--danger); }
.msgTable td.msgEmpty { padding: var(--gap-panel); }

/* A narrow center (portrait, 150 %): a message is a card — time, type and
   source on one line, the text under it; the actions one over the other at
   the card's end, over both lines (beside time, type and source they ran out
   of the card). */
.narrow .msgSearchRow { flex-wrap: wrap; }
.narrow .msgSearch { flex-basis: 100%; }
.narrow .msgTable table, .narrow .msgTable thead, .narrow .msgTable tbody { display: block; }
.narrow .msgTable tr { display: grid; grid-template-columns: auto auto 1fr auto; column-gap: var(--gap-tight); row-gap: var(--gap-micro); align-items: center; }
.narrow .msgTable thead { box-shadow: inset 0 -1px 0 var(--border); }
.narrow .msgTable thead tr { column-gap: 0; }
.narrow .msgTable tbody tr { padding: var(--gap-tight) var(--gap-controls); border-bottom: 1px solid var(--border); }
.narrow .msgTable td,
.narrow .msgTable th { display: block; width: auto; min-width: 0; border: none; padding: 0; background: none; }
.narrow .msgTable thead th { padding: var(--gap-tight) var(--gap-controls); box-shadow: none; }
.narrow .msgTable th.colText, .narrow .msgTable th.colActions { display: none; }
.narrow .msgTable td.colText { grid-column: 1 / 4; grid-row: 2; }
.narrow .msgTable td.colActions { grid-column: 4; grid-row: 1 / span 2; }
.narrow .msgTable td.colActions .row-tight { flex-direction: column; }
.narrow .msgTable td.msgEmpty { grid-column: 1 / -1; padding: var(--gap-panel); }
.narrow .msgTable tbody tr.error { box-shadow: inset 3px 0 0 var(--danger); }
.narrow .msgTable tr.error td:first-child { box-shadow: none; }
</style>
