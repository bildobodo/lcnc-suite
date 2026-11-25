<script setup lang="ts">
// "Load tool table into LinuxCNC?" (TF-2, plan v3 §2.2): what a load of the
// tool table FILE would change in LinuxCNC's table, acknowledged by the
// operator, and the ONE request bound to that comparison (toolLoad.ts). The
// list never changes by itself: a table change or a lost connection makes it
// stale — the confirm closes, the acknowledgement is gone — until Check again
// compares anew. What came of the request is the tab's note, from the reads.
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { awaitReply, connected, request, toolTableVersion } from "./lcncWs";
import { useFire } from "./permissions";
import { vStickyHead } from "./stickyHead";
import DialogFrame from "./DialogFrame.vue";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineToggle from "./MachineToggle.vue";
import type { ToolLoadBase } from "./lcnc";
import { writeUnknownWords } from "./toolTableRead";
import {
  loadCounts, loadRemoveLabel, loadReplaces, loadRows, loadSpindleNote, notRequested, readPreview,
  LOAD_CHECK_AGAIN, LOAD_COMPARING, LOAD_COMPLETE_BASIS, LOAD_CONFIRM_REMOVED, LOAD_DISCONNECTED, LOAD_IRREVERSIBLE,
  LOAD_NOT_COMPARED, LOAD_OUTDATED, LOAD_ROWS_STEP, LOAD_STALE, type ToolLoadPreview,
} from "./toolLoad";

const props = defineProps<{ preview: ToolLoadPreview; /** the table version the comparison began under */ version: number }>();
const emit = defineEmits<{
  close: [];
  /** a request goes out: what was said of an earlier one ends */
  sent: [];
  /** its reply: the request reached LinuxCNC (`ok: true, load: requested`) */
  requested: [reply: unknown, base: ToolLoadBase];
  /** no reply: neither is known */
  lost: [base: ToolLoadBase];
}>();

/** As long as a tool-table read waits before it says the outcome is unknown. */
const REPLY_MS = 60_000;

const fire = useFire();
const shown = ref(props.preview);
const comparedAt = ref(props.version);
const dropped = ref(false);           // the connection closed since the comparison
const invalid = ref(false);           // its outcome is unknown, or the last comparison was refused
const error = ref<string | null>(null);
const busy = ref(false);
const checking = ref(false);
const acknowledged = ref(false);

/** Why the list is no longer today's, or null. A ping or a closed connection
 *  while the request is out says nothing here: its reply does. */
const stale = computed(() => {
  if (busy.value) return null;
  if (dropped.value) return LOAD_DISCONNECTED;
  return toolTableVersion.value !== comparedAt.value ? LOAD_STALE : null;
});
watch(connected, up => { if (!up) dropped.value = true; });
watch(stale, s => { if (s) acknowledged.value = false; }, { flush: "sync" });

/** Why the confirm is closed for this dialog's own reasons, or null. */
const closed = computed(() => {
  if (busy.value || checking.value) return checking.value ? LOAD_COMPARING : null;
  if (stale.value) return stale.value;
  if (invalid.value) return LOAD_CHECK_AGAIN;
  if (!shown.value.removed.length) return null;
  return shown.value.removalRefusal ?? (acknowledged.value ? null : LOAD_CONFIRM_REMOVED);
});
const replaces = computed(() => loadReplaces(shown.value));
const asksRemoval = computed(() => shown.value.removed.length > 0 && !shown.value.removalRefusal);
const spindleNote = computed(() => loadSpindleNote(shown.value));

const rows = computed(() => loadRows(shown.value));
const limit = ref(LOAD_ROWS_STEP);
const more = ref<HTMLElement | null>(null);
let seen: IntersectionObserver | null = null;
// the next rows when the list's end comes into view (the first observation
// comes after the layout, so a short list asks for nothing it does not need)
watch(more, (el) => {
  seen?.disconnect();
  seen = null;
  if (!el) return;
  seen = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) {
      limit.value += LOAD_ROWS_STEP;
      // the same row element moved down: observed anew, or it would not fire again
      void nextTick(() => { if (more.value) { seen?.unobserve(more.value); seen?.observe(more.value); } });
    }
  });
  seen.observe(el);
}, { flush: "post" });
onBeforeUnmount(() => seen?.disconnect());

async function checkAgain() {
  if (busy.value || checking.value) return;
  checking.value = true;
  error.value = null;
  acknowledged.value = false;
  dropped.value = !connected.value;
  const began = toolTableVersion.value;
  const reply = await request({ cmd: "tool_table_preview" }, REPLY_MS);
  checking.value = false;
  const p = readPreview(reply, connected.value ? "No reply from the gateway — check again" : LOAD_DISCONNECTED);
  if ("refusal" in p) {               // no comparison: the list stays the old one, the confirm closed
    invalid.value = true;
    error.value = notRequested(p.refusal);
    return;
  }
  shown.value = p;
  comparedAt.value = began;
  invalid.value = false;
  limit.value = LOAD_ROWS_STEP;
}

function load() {
  if (busy.value || closed.value) return;
  const base = { ...shown.value.base };
  error.value = null;
  const id = fire({ cmd: "tool_table_load", base, removed: shown.value.removed.map(t => t.T) }, "toolTableWrite");
  if (id === null) return;            // nothing sent — fire() said why
  busy.value = true;
  emit("sent");
  void awaitReply(id, REPLY_MS).then((reply) => {
    busy.value = false;
    if (reply?.ok && reply.load === "requested") { emit("requested", reply, base); return; }
    if (reply && !reply.ok) {
      const why = typeof reply.error === "string" && reply.error ? reply.error : "the gateway refused it";
      if (LOAD_OUTDATED.has(why)) {         // the comparison is no longer today's: compare anew first
        invalid.value = true;
        acknowledged.value = false;
      }
      error.value = notRequested(why);
      return;
    }
    // never a guessed success or failure, and no second request: compare anew
    invalid.value = true;
    acknowledged.value = false;
    error.value = writeUnknownWords(connected.value);
    emit("lost", base);
  });
}
</script>

<template>
  <DialogFrame kind="form" size="md" wide :danger="replaces" title="Load tool table into LinuxCNC?" initial-focus="safe"
               close-label="Close table comparison" :busy="busy" busy-label="Request in progress" @close="emit('close')">
    <div class="dialogContent scroll-thin" data-tool-load>
      <div class="settingDesc">
        <span data-load-counts>{{ loadCounts(shown) }}</span><br />{{ LOAD_NOT_COMPARED }}
        <template v-if="replaces"><br />{{ LOAD_IRREVERSIBLE }}</template>
      </div>
      <div class="stack-controls">
        <div v-if="spindleNote" class="statusNote warn" role="status"><span>{{ spindleNote }}</span></div>
        <div v-if="shown.basis === 'complete'" class="statusNote warn" role="status"><span>{{ LOAD_COMPLETE_BASIS }}</span></div>
        <div v-if="shown.removalRefusal" class="statusNote warn" role="status"><span>{{ shown.removalRefusal }}</span></div>
        <div v-if="rows.length" v-sticky-head class="dataTable">
          <table>
            <thead><tr><th>Tool</th><th>Change</th></tr></thead>
            <tbody>
              <tr v-for="r in rows.slice(0, limit)" :key="r.key">
                <td class="colWrap"><span class="mono">{{ r.tool }}</span> {{ r.name }}</td>
                <td class="colWrap">{{ r.text }}</td>
              </tr>
              <tr v-if="rows.length > limit" ref="more"><td colspan="2" class="emptyState">{{ rows.length - limit }} more</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <!-- above the actions, never scrolled away: what the confirm waits for -->
    <div v-if="error || stale || asksRemoval" class="foot stack-controls">
      <div v-if="error || stale" class="statusNote" :class="error ? 'error' : 'warn'" role="alert" data-load-check>
        <span>{{ error || stale }}</span>
        <MachineBtn type="retry" :disabled="busy" @click="checkAgain">Check again</MachineBtn>
      </div>
      <MachineToggle v-if="asksRemoval" gate="toolEdit" v-model="acknowledged"
                     :disabled="busy || checking || !!stale || invalid" :label="loadRemoveLabel(shown)" />
    </div>
    <template #actions>
      <MachineBtn type="dialogCancel" :disabled="busy" :title="busy ? 'Request in progress' : undefined" @click="emit('close')">Cancel</MachineBtn>
      <Gate gate="toolTableWrite" class="row-controls">
        <MachineBtn :type="replaces ? 'toolDanger' : 'toolSave'" :disabled="busy || !!closed" :reason="closed ?? undefined"
                    @click="load">{{ busy ? "Requesting…" : "Load table" }}</MachineBtn>
      </Gate>
    </template>
  </DialogFrame>
</template>

<style scoped>
/* Narrow and touch: both columns wrap, nothing runs out sideways. */
.colWrap { overflow-wrap: anywhere; }
.foot { padding: var(--gap-controls) var(--gap-section) 0; }
</style>
