<script setup lang="ts">
// The Macros tab (package 5, stage C; plan docs/reviews/makros.plan.md),
// laid out like the tool table (operator 2026-10-03): the head (the selected
// macro; Run · Abort … More: New / Upload / Download), a search row with a
// bar filter, then ONE table of the macro FILES — name (sortable), short
// description, On bar, the pencil, the trash, the bar order. A tap on a row
// selects it for Run; the pencil opens the editor DIALOG (like Edit Tool):
// file name, title and description as fields over the code — the fields
// ARE the file's header lines (macroHeader.ts) — bound to the revision it
// read. There is no Files: the list IS the macro folder.
//
// The run rule (Codex VP69-05): while the file open in the editor has an
// unsaved draft, its text is still loading or a conflict with the disk is
// open, it runs NOWHERE — not here, not on the bar, not from its dialog
// (macroEditorBasis, read by macroRunBlock). Save or Discard / Reload
// restores one basis; nothing saves on its own.
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { ChevronDown, ChevronUp, Pencil, Trash2, X } from "lucide-vue-next";
import CodeEditor from "./CodeEditor.vue";
import DialogFrame from "./DialogFrame.vue";
import FormField from "./FormField.vue";
import MoreMenu from "./MoreMenu.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineSelect from "./MachineSelect.vue";
import MachineToggle from "./MachineToggle.vue";
import { MACRO_EDITOR_OWNER, returnFocusTo } from "./inputSession";
import { useFire } from "./permissions";
import { MACRO_NAME_RE } from "./defaults";
import {
  deleteMacroFile, readMacroFile, saveMacroFile, uploadMacroFile, MacroConflictError, type MacroFile,
} from "./lcncApi";
import { macroEditorBasis, macroFolder, macroFolderError, reloadMacroFiles } from "./macroFiles";
import { fileHoldKey, macroRunBlock } from "./macroBar";
import { newMacroText, titleFromName } from "./macroTemplate";
import { readHeader, titleError, withDescription, withName, withTitle } from "./macroHeader";
import { saveAsFile } from "./download";

const props = defineProps<{
  /** The macro files on the bar, in order (the `macros` section's `bar`). */
  barNames: string[];
}>();
const emit = defineEmits<{
  /** Run a macro file: App's one path (hold, or the parameter dialog). */
  run: [file: MacroFile];
  /** A new bar list (toggle, order, a rename). */
  updateBar: [names: string[]];
}>();
const fire = useFire();
const root = ref<HTMLElement | null>(null);

const files = computed<MacroFile[]>(() => macroFolder.value?.macros ?? []);
const problems = computed(() => macroFolder.value?.problems ?? []);
const missing = computed(() => macroFolder.value ? props.barNames.filter(n => !files.value.some(f => f.name === n)) : []);
/** The short description: the file's first free comment line. */
const descriptionOf = (f: MacroFile) => f.description[0] ?? "";

// ── Search, filter, sort (the tool table's row of fields) ──
const searchText = ref("");
const barFilter = ref<"" | "on" | "off">("");
const sortAsc = ref(true);
/** The rows in NAME order (switching On bar or the bar order moves no
 *  row — operator 2026-10-02), narrowed by the search and the filter. */
const shownRows = computed(() => {
  const q = searchText.value.trim().toLowerCase();
  const on = (f: MacroFile) => props.barNames.includes(f.name);
  const rows = files.value
    .filter(f => !q || [f.name, f.title ?? "", ...f.description].some(t => t.toLowerCase().includes(q)))
    .filter(f => barFilter.value === "" || (barFilter.value === "on") === on(f))
    .sort((a, b) => a.name.localeCompare(b.name));
  return sortAsc.value ? rows : rows.reverse();
});

// ── The selected macro: a tap on its row, Run runs it ──
const selectedName = ref<string | null>(null);
const selected = computed(() => files.value.find(f => f.name === selectedName.value) ?? null);
// a file gone from the folder is selected no more
watch(files, list => { if (selectedName.value && !list.some(f => f.name === selectedName.value)) selectedName.value = null; });
/** The rows' ONE Tab stop: the selected row, else the first shown. */
const rowStop = computed(() => shownRows.value.some(f => f.name === selectedName.value)
  ? selectedName.value : shownRows.value[0]?.name ?? null);
const NAV_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];
function pickEl(name: string): HTMLElement | null {
  return root.value?.querySelector<HTMLElement>(`[data-macro-row="${CSS.escape(name)}"] .rowPick`) ?? null;
}
/** Keys on a row's name: Enter / Space select it; Up / Down / Home / End
 *  select and focus another row. EVERY navigation key is default-prevented,
 *  with a modifier too — one that reached the shortcut map would jog (the
 *  TabNav rule). */
function onPickKey(e: KeyboardEvent, name: string) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    selectedName.value = name;
    return;
  }
  if (!NAV_KEYS.includes(e.key)) return;
  e.preventDefault();
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const names = shownRows.value.map(f => f.name);
  const i = names.indexOf(name), n = names.length;
  const to = e.key === "ArrowDown" ? names[Math.min(i + 1, n - 1)]
    : e.key === "ArrowUp" ? names[Math.max(i - 1, 0)]
    : e.key === "Home" ? names[0] : e.key === "End" ? names[n - 1] : null;
  if (!to) return;
  selectedName.value = to;
  void nextTick(() => pickEl(to)?.focus());
}

// ── The bar ──
function setOnBar(name: string, on: boolean) {
  const names = props.barNames.filter(n => n !== name);
  emit("updateBar", on ? [...names, name] : names);
}
function moveOnBar(name: string, dir: -1 | 1) {
  const names = [...props.barNames];
  const i = names.indexOf(name), j = i + dir;
  if (i < 0 || j < 0 || j >= names.length) return;
  [names[i]!, names[j]!] = [names[j]!, names[i]!];
  emit("updateBar", names);
}
function removeFromBar(name: string) { emit("updateBar", props.barNames.filter(n => n !== name)); }

const note = ref<{ kind: "error" | "warn" | "ok"; text: string } | null>(null);

// ── Run ──
const runBlock = computed(() => selected.value ? macroRunBlock(selected.value, macroEditorBasis.value) : "No macro selected");

// ── The editor dialog: one file (or a new one), bound to the revision of
//    the bytes it shows ──
interface Editor {
  key: number;                 // remounts CodeEditor with `original`
  disk: string | null;         // the file's name on the disk (null: New)
  revision: string;            // the base a Save sends ("new" when the file is gone)
  original: string;            // the text as read / last saved
  loading: boolean;
  conflict: { revision: string | null; reason: string } | null;
}
let seq = 0;
const editor = ref<Editor | null>(null);
const editorRef = ref<InstanceType<typeof CodeEditor> | null>(null);
/** The text as the editor holds it now (updated on every change). */
const text = ref("");
const fName = ref("");
const fTitle = ref("");
const fDesc = ref("");
/** New: the title follows the name until the operator types one. */
const titleTouched = ref(false);
const saving = ref(false);
const editError = ref<string | null>(null);
const dirty = computed(() => !!editor.value && !editor.value.loading && text.value !== editor.value.original);
const editorFile = computed(() => editor.value?.disk ? files.value.find(f => f.name === editor.value!.disk) ?? null : null);

watch([editor, dirty], () => {
  const e = editor.value;
  macroEditorBasis.value = !e?.disk ? null : {
    name: e.disk,
    state: e.loading ? "loading" : e.conflict ? "conflict" : dirty.value ? "draft" : "clean",
    revision: e.loading ? null : e.revision,
  };
}, { deep: true, immediate: true });
onUnmounted(() => { macroEditorBasis.value = null; });

/** The fields read back from the text (an edit in the code). */
function readFields() {
  const h = readHeader(text.value);
  fName.value = h.name ?? "";
  fTitle.value = h.title ?? "";
  fDesc.value = h.description ?? "";
}
let writing = false;
/** A field wrote its line: the editor takes the new text; the field keeps
 *  what is being typed (a read-back would trim a space mid-word). */
function writeText(t: string) {
  if (t === text.value) return;
  writing = true;
  text.value = t;
  editorRef.value?.setText(t);
  writing = false;
}
function onChange() {
  if (writing) return;
  text.value = editorRef.value?.text() ?? text.value;
  readFields();
}

const nameError = computed(() => {
  const n = fName.value;
  if (!n) return null;   // Save waits for one; no error before a word is typed
  if (!MACRO_NAME_RE.test(n)) return "Lower-case letters, digits and _ only";
  if (n !== editor.value?.disk && files.value.some(f => f.name === n)) return "A macro of that name exists";
  return null;
});
const fTitleError = computed(() => titleError(fTitle.value));
const nameModel = computed({
  get: () => fName.value,
  set: (v: string) => {
    const from = readHeader(text.value).name ?? "";
    fName.value = v;
    if (MACRO_NAME_RE.test(v)) {
      let t = withName(text.value, from, v);
      if (!editor.value?.disk && !titleTouched.value) { fTitle.value = titleFromName(v); t = withTitle(t, fTitle.value); }
      writeText(t);
    }
  },
});
const titleModel = computed({
  get: () => fTitle.value,
  set: (v: string) => {
    fTitle.value = v;
    titleTouched.value = true;
    if (!titleError(v)) writeText(withTitle(text.value, v));
  },
});
const descModel = computed({
  get: () => fDesc.value,
  set: (v: string) => { fDesc.value = v; writeText(withDescription(text.value, v)); },
});

function setEditorText(t: string, e: Editor) {
  editor.value = e;
  text.value = t;
  readFields();
}

async function openEdit(f: MacroFile, tries = 0) {
  selectedName.value = f.name;
  const mine = ++seq;
  editError.value = null;
  titleTouched.value = true;
  setEditorText("", { key: mine, disk: f.name, revision: "", original: "", loading: true, conflict: null });
  fName.value = f.name;
  try {
    const { text: t, revision } = await readMacroFile(f.name);
    if (editor.value?.key !== mine) return;   // closed or another file meanwhile: a late reply applies nowhere
    // The list may have moved while the text was on its way (Codex R70
    // VP-I32: the watcher below waits while loading). The editor turns
    // clean only on the revision the list names NOW: else the list is read
    // again, and a text it does not name is read again (twice at most) —
    // never shown as the file.
    const listed = () => files.value.find(m => m.name === f.name) ?? null;
    if (listed()?.revision !== revision) {
      await reloadMacroFiles();
      if (editor.value?.key !== mine) return;
      const now = listed();
      if (now?.revision !== revision) {
        if (now && tries < 2) { void openEdit(now, tries + 1); return; }
        editor.value = null;
        note.value = { kind: "error", text: now ? `${f.name}.ngc kept changing while it was read — open it again`
          : `${f.name}.ngc was deleted while it was read` };
        return;
      }
    }
    setEditorText(t, { ...editor.value, key: ++seq, original: t, revision, loading: false });
  } catch (e) {
    if (editor.value?.key !== mine) return;
    editor.value = null;
    note.value = { kind: "error", text: `Macro not read — ${(e as Error).message}` };
  }
}
function openNew() {
  editError.value = null;
  titleTouched.value = false;
  const t = withDescription(newMacroText(""), "");
  setEditorText(t, { key: ++seq, disk: null, revision: "new", original: t, loading: false, conflict: null });
}

/** Close the dialog: over a draft it asks first (Keep editing / Discard). */
const discardAsk = ref<{ what: string; then: () => void } | null>(null);
function closeEditor() {
  const e = editor.value;
  if (!e) return;
  if (saving.value) return;
  if (dirty.value || e.conflict) discardAsk.value = { what: e.disk ? `The macro ${e.disk}.ngc you are editing` : "The new macro",
                                                      then: () => { editor.value = null; } };
  else editor.value = null;
}
function confirmDiscard() {
  const ask = discardAsk.value;
  discardAsk.value = null;
  ask?.then();
}
/** What leaving the tab would throw away, in operator words — null when nothing. */
function unsavedDraft(): string | null {
  const e = editor.value;
  if (!e || !(dirty.value || e.conflict)) return null;
  return e.disk ? `The macro ${e.disk}.ngc you are editing` : "The new macro";
}
/** Throw the draft away (the tab's guard said Discard). */
function discardAll() { editor.value = null; }
defineExpose({ unsavedDraft, discardAll });

// The list moved under the open file (another client saved, an editor
// outside the suite, a delete): without a draft the editor follows — it
// shows "loading" until the new text lands; with a draft it is a conflict.
watch(editorFile, f => {
  const e = editor.value;
  if (!e?.disk || e.loading || saving.value) return;
  const disk = f?.revision ?? null;
  if (disk === e.revision || (e.conflict && e.conflict.revision === disk)) return;
  if (dirty.value) {
    editor.value = { ...e, conflict: { revision: disk, reason: disk ? "Changed on disk" : "Deleted on disk" } };
  } else if (disk) {
    void openEdit(f!);
  } else {
    editor.value = null;
  }
});

/** The conflict's way out on the disk's side: the editor shows the file now. */
function reload() { if (editorFile.value) void openEdit(editorFile.value); else editor.value = null; }
/** The conflict's other way: keep this text; the next Save replaces what
 *  is on the disk now (or recreates a deleted file) — the operator decided. */
function keepEditing() {
  const e = editor.value;
  if (!e?.conflict) return;
  editor.value = { ...e, revision: e.conflict.revision ?? "new", conflict: null };
}

const canSave = computed(() => !!editor.value && !editor.value.loading && !saving.value
  && !!fName.value && !nameError.value && !fTitleError.value && (dirty.value || !editor.value.disk || editor.value.revision === "new"));

async function save() {
  const e = editor.value;
  const t = editorRef.value?.text() ?? text.value;
  if (!e || !canSave.value) return;
  const name = fName.value;
  // a file deleted under the editor (Keep editing: base "new") is no rename
  const rename = e.disk && name !== e.disk && e.revision !== "new" ? { from: e.disk, base: e.revision } : undefined;
  saving.value = true;
  editError.value = null;
  try {
    const m = await saveMacroFile(name, rename ? "new" : e.revision || "new", t, rename);
    if (editor.value?.key !== e.key) return;
    if (rename && props.barNames.includes(rename.from)) emit("updateBar", props.barNames.map(n => n === rename.from ? name : n));
    editor.value = null;
    selectedName.value = name;
    note.value = m.errors.length ? { kind: "warn", text: `Saved ${name}.ngc — not runnable: line ${m.errors[0]!.line}: ${m.errors[0]!.message}` }
      : { kind: "ok", text: rename ? `Renamed ${rename.from}.ngc to ${name}.ngc` : e.disk ? `Saved ${name}.ngc` : `Created ${name}.ngc` };
    void reloadMacroFiles();
  } catch (err) {
    if (editor.value?.key !== e.key) return;
    // Only a DISK conflict of this editor's file is a conflict — with the
    // revision the gateway read under its lock (Codex R70 VP-I31); a busy
    // machine, a taken name or an answer without a revision is a plain
    // "not saved" and the draft keeps its base.
    if (err instanceof MacroConflictError && err.kind === "conflict" && err.revision !== undefined
        && e.disk && (err.file ?? e.disk) === e.disk) {
      editor.value = { ...editor.value, conflict: { revision: err.revision, reason: err.message } };
    } else {
      editError.value = `Not saved — ${(err as Error).message}`;
    }
  } finally {
    saving.value = false;
  }
}

// ── Upload / Download ──
const replaceAsk = ref<{ file: File; name: string; revision: string | null } | null>(null);
/** A file input made for this pick only — a second permanent `.ngc` input
 *  beside the program upload's would make both ambiguous. */
function pickImport() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".ngc";
  input.addEventListener("change", () => { void onImportPicked(input.files?.[0] ?? null); });
  input.click();
}
async function onImportPicked(file: File | null) {
  if (!file) return;
  const name = file.name.replace(/\.ngc$/, "");
  try {
    await uploadMacroFile(file);
    note.value = { kind: "ok", text: `Uploaded ${file.name}` };
    void reloadMacroFiles();
  } catch (err) {
    if (err instanceof MacroConflictError && err.exists && typeof err.revision === "string") {
      replaceAsk.value = { file, name, revision: err.revision };
    } else note.value = { kind: "error", text: `Not uploaded — ${(err as Error).message}` };
  }
}
async function confirmReplace() {
  const ask = replaceAsk.value;
  replaceAsk.value = null;
  if (!ask?.revision) return;
  try {
    // bound to the revision the operator confirmed — a save in between is
    // a conflict, never overwritten (Codex VP69-03)
    await uploadMacroFile(ask.file, ask.revision);
    note.value = { kind: "ok", text: `Replaced ${ask.name}.ngc` };
    void reloadMacroFiles();
  } catch (err) {
    note.value = { kind: "error", text: err instanceof MacroConflictError && err.kind === "conflict"
      ? `Not replaced — ${ask.name}.ngc changed meanwhile; upload again to decide`
      : `Not replaced — ${(err as Error).message}` };
  }
}
/** Download: the selected macro as the file it is (operator 2026-10-03). */
async function downloadSelected() {
  const f = selected.value;
  if (!f) return;
  try {
    const { text: t } = await readMacroFile(f.name);
    saveAsFile(`${f.name}.ngc`, t);
  } catch (e) {
    note.value = { kind: "error", text: `Not downloaded — ${(e as Error).message}` };
  }
}

// ── Delete (the row's trash) ──
const deleteAsk = ref<MacroFile | null>(null);
/** Where the focus goes after a delete (plan, dialog case 20): the next
 *  row's name, else the previous, else the head's More — never the gone
 *  trash (Chromium then drops the focus to body, where an arrow key jogs). */
function focusAfterDelete(neighbor: string | null) {
  returnFocusTo((neighbor ? pickEl(neighbor) : null) ?? root.value?.querySelector<HTMLElement>(".panelHead .moreTrigger") ?? null);
}
async function confirmDelete() {
  const f = deleteAsk.value;
  deleteAsk.value = null;
  if (!f) return;
  const names = shownRows.value.map(r => r.name);
  const at = names.indexOf(f.name);
  const neighbor = names[at + 1] ?? names[at - 1] ?? null;
  try {
    await deleteMacroFile(f.name, f.revision);
    if (selectedName.value === f.name) selectedName.value = null;
    if (props.barNames.includes(f.name)) removeFromBar(f.name);
    note.value = { kind: "ok", text: `Deleted ${f.name}.ngc` };
    void reloadMacroFiles();
    await nextTick();
    focusAfterDelete(neighbor);
  } catch (e) {
    note.value = { kind: "error", text: `Not deleted — ${(e as Error).message}` };
  }
}
</script>

<template>
  <div ref="root" class="macrosTab stack-controls">
    <!-- The tab's pattern (design wave D5): what it acts on, Run and Abort
         side by side on the left, the management behind More at the right -->
    <div class="panelHead">
      <div class="panelObject">
        <span class="label-muted md">Macro</span>
        <span class="macroObject">{{ selected ? (selected.title ?? selected.name) : 'None selected' }}</span>
        <span v-if="selected" class="label-muted md mono objectFile">{{ selected.name }}.ngc</span>
      </div>
      <div class="actionGroup">
        <MachineBtn type="macroRun" :hold="!!selected && selected.params.length === 0"
                    :hold-key="selected ? fileHoldKey(selected) : ''" :disabled="!!runBlock"
                    :reason="runBlock ?? undefined" @click="selected && emit('run', selected)">Run</MachineBtn>
        <MachineBtn type="abort" @click="fire({ cmd: 'abort' }, 'abort')" />
        <MoreMenu class="actionEnd" label="More macro actions">
          <MachineBtn type="manage" @click="openNew">New</MachineBtn>
          <MachineBtn type="fileOp" @click="pickImport">Upload</MachineBtn>
          <MachineBtn type="fileDownload" :disabled="!selected" :reason="!selected ? 'No macro selected' : undefined"
                      @click="downloadSelected">Download</MachineBtn>
        </MoreMenu>
      </div>
    </div>

    <!-- Search and the bar filter: one row of fields, like the tool table's -->
    <div class="macroSearchRow row-controls">
      <MachineInput gate="macroSearch" type="text" v-model="searchText" label="Search macros"
                    placeholder="Search macros…" class="macroSearch" />
      <MachineSelect gate="macroSearch" v-model="barFilter" name="macroBarFilter" aria-label="Filter by the bar">
        <option value="">All macros</option>
        <option value="on">On the bar</option>
        <option value="off">Not on the bar</option>
      </MachineSelect>
    </div>

    <div v-for="p in problems" :key="p" class="statusNote warn" role="alert"><span>{{ p }}</span></div>
    <div v-if="macroFolderError" class="statusNote error" role="alert">
      <span>Macros not read — {{ macroFolderError }}</span>
      <MachineBtn type="retry" @click="reloadMacroFiles">Retry</MachineBtn>
    </div>
    <div v-for="n in missing" :key="n" class="statusNote warn" role="alert">
      <span>{{ n }}.ngc is on the bar but not in the macro folder</span>
      <MachineBtn type="inline" @click="removeFromBar(n)">Remove from bar</MachineBtn>
    </div>
    <div v-if="note" class="statusNote" :class="note.kind" :role="note.kind === 'ok' ? 'status' : 'alert'">
      <span>{{ note.text }}</span>
      <MachineBtn type="close" aria-label="Dismiss macro note" title="Dismiss macro note" @click="note = null"><X :size="14" /></MachineBtn>
    </div>

    <div v-sticky-head class="tableWrap dataTable scroll-thin fade-scroll">
      <table>
        <thead>
          <!-- The tool table's order (operator 2026-10-03): what it is, what
               it does, then the row's switches and actions -->
          <tr>
            <th class="colName" :aria-sort="sortAsc ? 'ascending' : 'descending'">
              <button class="sortHeader" @click="sortAsc = !sortAsc">Macro {{ sortAsc ? '▲' : '▼' }}</button></th>
            <th class="colDesc">Description</th>
            <th class="colBar">On bar</th>
            <th class="colAction" aria-label="Edit"></th>
            <th class="colAction" aria-label="Delete"></th>
            <th class="colOrder" aria-label="Order on the bar"></th>
          </tr>
        </thead>
        <tbody>
          <!-- A tap on the row selects the macro for Run (no button in the
               row, operator 2026-10-03); its name is the keyboard's way: one
               Tab stop, Enter / Space and the arrows select -->
          <tr v-for="f in shownRows" :key="f.name" :class="{ selectedRow: selectedName === f.name }"
              :data-macro-row="f.name" @click="selectedName = f.name">
            <td class="colName">
              <span class="rowPick" role="radio" :aria-checked="selectedName === f.name"
                    :tabindex="rowStop === f.name ? 0 : -1" @keydown="onPickKey($event, f.name)">{{ f.title ?? f.name }}</span>
              <span v-if="!f.runnable" class="noteWarn notRunnable">{{ f.reason }}</span>
            </td>
            <td class="colDesc text-muted" :title="f.description.join(' ')"><span class="descText">{{ descriptionOf(f) }}</span></td>
            <td class="colBar" @click.stop>
              <MachineToggle gate="macroEdit" :modelValue="barNames.includes(f.name)" :aria-label="`${f.title ?? f.name} on the bar`"
                             @update:modelValue="setOnBar(f.name, !!$event)" />
            </td>
            <td class="colAction" @click.stop>
              <MachineBtn type="listActionSetup" title="Edit macro" :aria-label="`Edit ${f.name}`" @click="openEdit(f)"><Pencil :size="14" /></MachineBtn>
            </td>
            <td class="colAction" @click.stop>
              <MachineBtn type="listActionSetup" title="Delete macro" :aria-label="`Delete ${f.name}`" @click="deleteAsk = f"><Trash2 :size="14" /></MachineBtn>
            </td>
            <td class="colOrder" @click.stop>
              <!-- The slot is in EVERY row — off the bar it is empty space
                   (hidden, not focusable), so On bar changes no row height
                   and no column width (operator 2026-10-02, live) -->
              <span class="orderSlot" :class="{ offBar: !barNames.includes(f.name) }">
                <MachineBtn type="listAction" :disabled="!barNames.includes(f.name) || barNames.indexOf(f.name) === 0"
                            :aria-label="`Move ${f.name} up in the bar order`"
                            @click="moveOnBar(f.name, -1)"><ChevronUp :size="14" /></MachineBtn>
                <MachineBtn type="listAction" :disabled="!barNames.includes(f.name) || barNames.indexOf(f.name) === barNames.length - 1"
                            :aria-label="`Move ${f.name} down in the bar order`" @click="moveOnBar(f.name, 1)"><ChevronDown :size="14" /></MachineBtn>
              </span>
            </td>
          </tr>
          <!-- Empty, no match and loading say different things (N84) -->
          <tr v-if="!macroFolder && !macroFolderError"><td colspan="6" class="emptyState loading">Loading macros…</td></tr>
          <tr v-else-if="macroFolder && files.length === 0 && !problems.length">
            <td colspan="6" class="emptyState">No macro files yet — New or Upload adds one.</td></tr>
          <tr v-else-if="files.length > 0 && shownRows.length === 0">
            <td colspan="6" class="emptyState noMatch">No macros match the search.</td></tr>
        </tbody>
      </table>
    </div>

    <!-- The editor: a dialog like Edit Tool (operator 2026-10-03) — the
         file name, the title and the short description as fields (they are
         the file's header lines), the code below -->
    <DialogFrame v-if="editor" kind="form" size="lg" wide :busy="saving" busy-label="Save in progress"
                 :title="editor.disk ? `Edit Macro ${editor.disk}` : 'New Macro'" close-label="Close macro editor"
                 @close="closeEditor">
      <div class="dialogContent stack-sections">
        <div v-if="editError" class="statusNote error" role="alert"><span>{{ editError }}</span></div>
        <div v-if="editorFile?.errors.length" class="statusNote error" role="alert">
          <span>Not runnable — line {{ editorFile.errors[0]!.line }}: {{ editorFile.errors[0]!.message }}</span>
        </div>
        <div v-for="w in editorFile?.warnings ?? []" :key="w.line + w.message" class="statusNote warn" role="alert">
          <span>Line {{ w.line }}: {{ w.message }}</span>
        </div>
        <div v-if="editor.conflict" class="statusNote warn" role="alert" data-macro-conflict>
          <span>{{ editor.conflict.reason }} — Reload shows it; Keep editing replaces it on your next Save</span>
          <span class="row-tight">
            <MachineBtn type="inline" @click="reload">Reload</MachineBtn>
            <MachineBtn type="inline" @click="keepEditing">Keep editing</MachineBtn>
          </span>
        </div>
        <div class="formGrid">
          <FormField label="File name" :error="nameError">
            <template #default="{ input }">
              <MachineInput v-bind="input" gate="macroEdit" type="text" v-model="nameModel" :disabled="editor.loading" />
            </template>
          </FormField>
          <FormField label="Title (on the bar)" :error="fTitleError">
            <template #default="{ input }">
              <MachineInput v-bind="input" gate="macroEdit" type="text" v-model="titleModel" :disabled="editor.loading" />
            </template>
          </FormField>
          <FormField label="Description" wide>
            <template #default="{ input }">
              <MachineInput v-bind="input" gate="macroEdit" type="text" v-model="descModel" :disabled="editor.loading"
                            placeholder="What the macro does" />
            </template>
          </FormField>
        </div>
        <div v-if="editor.loading" class="emptyState loading">Loading {{ editor.disk }}.ngc…</div>
        <CodeEditor v-else :key="editor.key" ref="editorRef" class="macroCode" :doc="text"
                    :owner-id="MACRO_EDITOR_OWNER" :context="`Macro · ${fName || 'new'}.ngc`" :auto-open="false"
                    @change="onChange" @load-error="editError = $event" />
      </div>
      <template #actions>
        <MachineBtn type="dialogCancel" :disabled="saving" @click="closeEditor">Cancel</MachineBtn>
        <MachineBtn type="fileSave" :disabled="!canSave" @click="save">{{ saving ? 'Saving…' : editor.disk ? 'Save' : 'Create' }}</MachineBtn>
      </template>
    </DialogFrame>

    <DialogFrame v-if="discardAsk" kind="confirm" title="Discard changes?" @close="discardAsk = null">
      <div class="dialogBody">{{ discardAsk.what }} has unsaved changes. This cannot be undone.</div>
      <template #actions>
        <MachineBtn type="dialogCancel" @click="discardAsk = null">Keep editing</MachineBtn>
        <MachineBtn type="dialogDanger" @click="confirmDiscard">Discard</MachineBtn>
      </template>
    </DialogFrame>

    <DialogFrame v-if="deleteAsk" kind="confirm" :title="`Delete ${deleteAsk.title ?? deleteAsk.name}?`" danger @close="deleteAsk = null">
      <div class="dialogBody">{{ deleteAsk.name }}.ngc leaves the macro folder and the bar. This cannot be undone.</div>
      <template #actions>
        <MachineBtn type="dialogCancel" @click="deleteAsk = null">Cancel</MachineBtn>
        <MachineBtn type="dialogDangerSetup" @click="confirmDelete">Delete</MachineBtn>
      </template>
    </DialogFrame>

    <DialogFrame v-if="replaceAsk" kind="confirm" :title="`Replace ${replaceAsk.name}.ngc?`" danger @close="replaceAsk = null">
      <div class="dialogBody">The macro folder has a file of this name; the upload replaces it. This cannot be undone.</div>
      <template #actions>
        <MachineBtn type="dialogCancel" @click="replaceAsk = null">Cancel</MachineBtn>
        <MachineBtn type="dialogDangerSetup" @click="confirmReplace">Replace</MachineBtn>
      </template>
    </DialogFrame>
  </div>
</template>

<style scoped>
.macrosTab {
  flex: 1;
  min-height: 0;
}
.macroObject {
  font-weight: var(--fw-semibold);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Narrow, the object line holds the title only: the file name is in the
   editor and the Download. */
.sidePane.narrow .objectFile {
  display: none;
}
.macroSearchRow {
  flex-shrink: 0;
}
.macroSearch {
  flex: 1;
  min-width: 0;
}
.tableWrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.selectedRow {
  background: var(--hl-selected);
}
.selectedRow td {
  background: inherit;
}
tbody tr {
  cursor: pointer;
}
.colName {
  width: 1%;
  white-space: nowrap;
  font-weight: var(--fw-semibold);
}
.rowPick {
  display: block;
}
.notRunnable {
  display: block;
  white-space: normal;
  font-weight: var(--fw-normal);
}
/* The short description takes what the rest leaves and stays ONE line
   (its full text in the title and the editor): every row one height */
.colDesc {
  width: 100%;
  max-width: 0;
}
.descText {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.colBar,
.colAction {
  width: 1%;
  text-align: center;
}
.colOrder {
  width: 1%;
}
.orderSlot {
  display: flex;
  gap: var(--gap-tight);
}
.orderSlot.offBar {
  visibility: hidden;
}
/* The narrow side pane (150 % portrait, 271 px): the description leaves
   (the editor shows it), the name wraps, the order buttons stand one over
   the other — side by side the name had some 40 px left */
.sidePane.narrow .colDesc {
  display: none;
}
.sidePane.narrow .colName {
  width: auto;
  white-space: normal;
  overflow-wrap: anywhere;
}
.sidePane.narrow .orderSlot {
  flex-direction: column;
}
.sidePane.narrow .tableWrap th,
.sidePane.narrow .tableWrap td {
  padding: var(--gap-tight);
}
.sidePane.narrow .tableWrap th {
  white-space: nowrap;
  padding-block: 0;
}
/* The editor dialog: the fields, then the code filling the rest */
.macroCode {
  flex: 1;
  min-height: calc(8 * var(--code-line-h));
}
</style>
