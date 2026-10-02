<script setup lang="ts">
// The Macros tab (package 5, stage C; plan docs/reviews/makros.plan.md):
// macro FILES — the list the gateway parsed, which go on the macro bar and
// in what order, an editor for the selected file bound to its revision —
// and the EARLIER settings macros, moved here from Settings (one place).
//
// The run rule (Codex VP69-05): while the selected file has an unsaved
// draft, its text is still loading or a conflict with the disk is open, it
// runs NOWHERE — not here, not on the bar, not from its dialog
// (macroEditorBasis, read by macroRunBlock). Save or Discard / Reload
// restores one basis; nothing saves on its own.
import { computed, onUnmounted, ref, watch } from "vue";
import { ChevronDown, ChevronUp, X } from "lucide-vue-next";
import CodeEditor from "./CodeEditor.vue";
import DialogFrame from "./DialogFrame.vue";
import EarlierMacros from "./EarlierMacros.vue";
import FormField from "./FormField.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineSelect from "./MachineSelect.vue";
import MachineToggle from "./MachineToggle.vue";
import { MACRO_EDITOR_OWNER } from "./inputSession";
import { useFire } from "./permissions";
import { MACRO_NAME_RE, type MacroDef } from "./defaults";
import {
  deleteMacroFile, readMacroFile, saveMacroFile, uploadMacroFile, MacroConflictError, type MacroFile,
} from "./lcncApi";
import { macroEditorBasis, macroFolder, macroFolderError, reloadMacroFiles } from "./macroFiles";
import { fileHoldKey, macroRunBlock } from "./macroBar";
import { convertToFile, nameFromLabel, newMacroText, nonNumericDefaults, UNIT_KINDS, type ConvertParam } from "./macroConvert";

const props = defineProps<{
  /** The macro files on the bar, in order (the `macros` section's `bar`). */
  barNames: string[];
}>();
const emit = defineEmits<{
  /** Run a macro file: App's one path (hold, or the parameter dialog). */
  run: [file: MacroFile];
  /** A new bar list (toggle, order). */
  updateBar: [names: string[]];
}>();
const fire = useFire();

const files = computed<MacroFile[]>(() => macroFolder.value?.macros ?? []);
const problems = computed(() => macroFolder.value?.problems ?? []);
/** Bar members first, in bar order; the rest by name. */
const rows = computed(() => {
  const onBar = props.barNames.map(n => files.value.find(f => f.name === n)).filter((f): f is MacroFile => !!f);
  const rest = files.value.filter(f => !props.barNames.includes(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  return [...onBar, ...rest];
});
const missing = computed(() => macroFolder.value ? props.barNames.filter(n => !files.value.some(f => f.name === n)) : []);

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

// ── The editor session: one selected file, bound to the revision of the
//    bytes it shows ──
interface Session {
  key: number;                 // remounts CodeEditor with `original`
  name: string;
  revision: string;            // the base a Save sends ("new" when the file is gone)
  original: string;            // the text as read / last saved
  loading: boolean;
  dirty: boolean;
  conflict: { revision: string | null; reason: string } | null;
}
let seq = 0;
const session = ref<Session | null>(null);
const editorRef = ref<InstanceType<typeof CodeEditor> | null>(null);
const saving = ref(false);
const note = ref<{ kind: "error" | "warn" | "ok"; text: string } | null>(null);
const selected = computed(() => session.value ? files.value.find(f => f.name === session.value!.name) ?? null : null);

watch(session, s => {
  macroEditorBasis.value = !s ? null : {
    name: s.name,
    state: s.loading ? "loading" : s.conflict ? "conflict" : s.dirty ? "draft" : "clean",
  };
}, { deep: true, immediate: true });
onUnmounted(() => { macroEditorBasis.value = null; });

async function open(name: string) {
  const mine = ++seq;
  session.value = { key: mine, name, revision: "", original: "", loading: true, dirty: false, conflict: null };
  note.value = null;
  try {
    const { text, revision } = await readMacroFile(name);
    if (session.value?.key !== mine) return;   // another selection meanwhile: a late reply applies nowhere
    session.value = { ...session.value, key: ++seq, original: text, revision, loading: false };
  } catch (e) {
    if (session.value?.key !== mine) return;
    session.value = null;
    note.value = { kind: "error", text: `Macro not read — ${(e as Error).message}` };
  }
}

/** The tab's draft guard: one question for every way out of a draft. */
const discardAsk = ref<{ what: string; then: () => void } | null>(null);
const earlierRef = ref<InstanceType<typeof EarlierMacros> | null>(null);
function fileDraft(): string | null {
  const s = session.value;
  return s && (s.dirty || (s.conflict && editorRef.value?.text() !== s.original)) ? `${s.name}.ngc` : null;
}
/** What leaving the tab would throw away, in operator words — null when nothing. */
function unsavedDraft(): string | null {
  const f = fileDraft();
  if (f) return `The macro ${f} you are editing`;
  return earlierRef.value?.unsavedDraft() ?? null;
}
/** Throw every draft away (the tab's guard said Discard). */
function discardAll() {
  if (session.value) void open(session.value.name);
  earlierRef.value?.discardDraft();
}
defineExpose({ unsavedDraft, discardAll });

function guarded(then: () => void) {
  const f = fileDraft();
  if (f) discardAsk.value = { what: `The macro ${f} you are editing`, then };
  else then();
}
function select(name: string) {
  if (session.value?.name === name) return;
  guarded(() => void open(name));
}
function confirmDiscard() {
  const ask = discardAsk.value;
  discardAsk.value = null;
  if (session.value) session.value = { ...session.value, dirty: false, conflict: null };
  ask?.then();
}

function onChange() {
  const s = session.value;
  if (!s || s.loading) return;
  const dirty = editorRef.value?.text() !== s.original;
  if (dirty !== s.dirty) session.value = { ...s, dirty };
}

// The list moved under the open file (another client saved, an editor
// outside the suite, a delete): without a draft the editor follows — it
// shows "loading" until the new text lands; with a draft it is a conflict.
watch(selected, f => {
  const s = session.value;
  if (!s || s.loading || saving.value) return;
  const disk = f?.revision ?? null;
  if (disk === s.revision || (s.conflict && s.conflict.revision === disk)) return;
  if (s.dirty) {
    session.value = { ...s, conflict: { revision: disk, reason: disk ? "Changed on disk" : "Deleted on disk" } };
  } else if (disk) {
    void open(s.name);
  } else {
    session.value = null;
  }
});

async function save() {
  const s = session.value;
  const text = editorRef.value?.text();
  if (!s || text == null || saving.value) return;
  saving.value = true;
  note.value = null;
  try {
    const m = await saveMacroFile(s.name, s.revision || "new", text);
    if (session.value?.key !== s.key) return;
    const now = editorRef.value?.text();
    session.value = { ...session.value, revision: m.revision, original: text, conflict: null,
                      dirty: now != null && now !== text };
    note.value = m.errors.length ? { kind: "warn", text: `Saved — not runnable: line ${m.errors[0]!.line}: ${m.errors[0]!.message}` }
      : { kind: "ok", text: `Saved ${s.name}.ngc` };
    void reloadMacroFiles();
  } catch (e) {
    if (session.value?.key !== s.key) return;
    if (e instanceof MacroConflictError) {
      session.value = { ...session.value, conflict: { revision: e.revision, reason: e.message } };
    } else {
      note.value = { kind: "error", text: `Save failed — ${(e as Error).message}` };
    }
  } finally {
    saving.value = false;
  }
}

/** The conflict's way out on the disk's side: the editor shows the file now. */
function reload() { if (session.value) void open(session.value.name); }
/** The conflict's other way: keep this text; the next Save replaces what
 *  is on the disk now (or recreates a deleted file) — the operator decided. */
function keepEditing() {
  const s = session.value;
  if (!s?.conflict) return;
  session.value = { ...s, revision: s.conflict.revision ?? "new", conflict: null, dirty: true };
}
function discardEdit() {
  const s = session.value;
  if (!s) return;
  if (s.conflict) { reload(); return; }
  if (!s.dirty) return;
  discardAsk.value = { what: `The macro ${s.name}.ngc you are editing`,
                       then: () => { session.value = { ...s, key: ++seq, dirty: false }; } };
}

// ── Run ──
const runBlock = computed(() => selected.value ? macroRunBlock(selected.value, macroEditorBasis.value) : "No macro selected");

// ── New ──
const newOpen = ref(false);
const newName = ref("");
const newError = computed(() => {
  const n = newName.value.trim();
  if (!n) return null;
  if (!MACRO_NAME_RE.test(n)) return "Lower-case letters, digits and _ only";
  if (files.value.some(f => f.name === n)) return "A macro of that name exists";
  return null;
});
function openNew() { guarded(() => { newName.value = ""; newOpen.value = true; }); }
async function createNew() {
  const n = newName.value.trim();
  if (!n || newError.value) return;
  try {
    await saveMacroFile(n, "new", newMacroText(n));
    newOpen.value = false;
    await reloadMacroFiles();
    void open(n);
  } catch (e) {
    note.value = { kind: "error", text: `Not created — ${(e as Error).message}` };
    newOpen.value = false;
  }
}

// ── Import / Export ──
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
  const go = async () => {
    try {
      await uploadMacroFile(file);
      note.value = { kind: "ok", text: `Imported ${file.name}` };
      void reloadMacroFiles();
    } catch (err) {
      if (err instanceof MacroConflictError && err.exists) replaceAsk.value = { file, name, revision: err.revision };
      else note.value = { kind: "error", text: `Not imported — ${(err as Error).message}` };
    }
  };
  if (session.value?.name === name) guarded(() => void go());
  else void go();
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
    if (session.value?.name === ask.name) void open(ask.name);
    void reloadMacroFiles();
  } catch (err) {
    note.value = { kind: "error", text: err instanceof MacroConflictError
      ? `Not replaced — ${ask.name}.ngc changed meanwhile; import again to decide`
      : `Not replaced — ${(err as Error).message}` };
  }
}
async function exportSelected() {
  const f = selected.value;
  if (!f) return;
  try {
    const { text } = await readMacroFile(f.name);
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${f.name}.ngc`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    note.value = { kind: "error", text: `Not exported — ${(e as Error).message}` };
  }
}

// ── Delete ──
const deleteAsk = ref<MacroFile | null>(null);
function askDelete() {
  const f = selected.value;
  if (!f) return;
  guarded(() => { deleteAsk.value = f; });
}
async function confirmDelete() {
  const f = deleteAsk.value;
  deleteAsk.value = null;
  if (!f) return;
  try {
    await deleteMacroFile(f.name, session.value?.name === f.name && session.value.revision ? session.value.revision : f.revision);
    if (session.value?.name === f.name) session.value = null;
    if (props.barNames.includes(f.name)) removeFromBar(f.name);
    note.value = { kind: "ok", text: `Deleted ${f.name}.ngc` };
    void reloadMacroFiles();
  } catch (e) {
    note.value = { kind: "error", text: `Not deleted — ${(e as Error).message}` };
  }
}

// ── Convert an earlier macro ──
const convert = ref<{ macro: MacroDef; name: string; units: "mm" | "inch"; params: ConvertParam[] } | null>(null);
function openConvert(m: MacroDef) {
  convert.value = { macro: m, name: nameFromLabel(m.name), units: "mm",
                    params: m.params.map(p => ({ name: p.name, label: p.label || p.name, unit: "none", defaultText: p.default })) };
}
const convertError = computed(() => {
  const c = convert.value;
  if (!c) return null;
  if (!MACRO_NAME_RE.test(c.name)) return "File name: lower-case letters, digits and _ only";
  if (files.value.some(f => f.name === c.name)) return "A macro of that name exists";
  const bad = nonNumericDefaults(c.params);
  return bad.length ? `Enter a number for ${bad.join(", ")}` : null;
});
async function confirmConvert() {
  const c = convert.value;
  if (!c || convertError.value) return;
  const out = convertToFile(c.macro, c.name, c.units, c.params);
  if ("error" in out) { note.value = { kind: "error", text: out.error }; return; }
  try {
    await saveMacroFile(c.name, "new", out.text);   // never over an existing file
    convert.value = null;
    note.value = { kind: "ok", text: `Converted to ${c.name}.ngc — the earlier macro stays until you delete it` };
    await reloadMacroFiles();
    void open(c.name);
  } catch (e) {
    note.value = { kind: "error", text: `Not converted — ${(e as Error).message}` };
    convert.value = null;
  }
}
</script>

<template>
  <div class="macrosTab stack-controls">
    <!-- The tab's pattern (design wave D5): what it acts on, the machine
         actions with Abort last at the right edge, then the management -->
    <div class="panelHead">
      <div class="panelObject">
        <span class="label-muted md">Macro</span>
        <span class="macroObject">{{ selected ? (selected.title ?? selected.name) : 'None selected' }}</span>
        <span v-if="selected" class="label-muted md mono">{{ selected.name }}.ngc</span>
      </div>
      <div class="actionGroup">
        <MachineBtn type="macroRun" :hold="!!selected && selected.params.length === 0"
                    :hold-key="selected ? fileHoldKey(selected) : ''" :disabled="!!runBlock"
                    :reason="runBlock ?? undefined" @click="selected && emit('run', selected)">Run</MachineBtn>
        <MachineBtn type="abort" class="actionEnd" @click="fire({ cmd: 'abort' }, 'abort')" />
      </div>
      <div class="actionGroup">
        <MachineBtn type="manage" @click="openNew">New</MachineBtn>
        <MachineBtn type="fileOp" @click="pickImport">Import</MachineBtn>
        <MachineBtn type="fileOp" :disabled="!selected" @click="exportSelected">Export</MachineBtn>
        <MachineBtn type="manage" :disabled="!selected" @click="askDelete">Delete</MachineBtn>
      </div>
    </div>

    <!-- below the fixed head everything scrolls: Run and Abort stay in reach -->
    <div class="macrosBody stack-controls scroll-thin">
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

    <div v-if="macroFolder && rows.length === 0 && !problems.length" class="emptyState">No macro files yet — New or Import adds one.</div>
    <div v-else-if="rows.length" class="dataTable macroTable">
      <table>
        <thead>
          <tr><th scope="col">On bar</th><th scope="col">Macro</th><th scope="col" aria-label="Order on the bar"></th></tr>
        </thead>
        <tbody>
          <tr v-for="f in rows" :key="f.name" :class="{ selectedRow: session?.name === f.name }" :aria-selected="session?.name === f.name"
              :data-macro-row="f.name">
            <td>
              <MachineToggle gate="macroEdit" :modelValue="barNames.includes(f.name)" :aria-label="`${f.title ?? f.name} on the bar`"
                             @update:modelValue="setOnBar(f.name, !!$event)" />
            </td>
            <td class="macroCell">
              <MachineBtn type="inline" :selected="session?.name === f.name" :aria-label="`Open ${f.name}.ngc`"
                          @click="select(f.name)">{{ f.title ?? f.name }}</MachineBtn>
              <div class="macroFacts">
                <span class="label-muted md mono fileName">{{ f.name }}.ngc</span>
                <span class="label-muted md">· {{ f.params.length === 1 ? '1 value' : `${f.params.length} values` }} ·</span>
                <span :class="f.runnable ? 'text-ok' : 'text-warn'">{{ f.runnable ? 'Ready' : f.reason }}</span>
              </div>
            </td>
            <td>
              <!-- one above the other: side by side they made the list 320 px
                   wide in the 272 px of a narrow pane (150 % portrait) -->
              <span v-if="barNames.includes(f.name)" class="stack-tight">
                <MachineBtn type="listAction" :disabled="barNames.indexOf(f.name) === 0" :aria-label="`Move ${f.name} up in the bar order`"
                            @click="moveOnBar(f.name, -1)"><ChevronUp :size="14" /></MachineBtn>
                <MachineBtn type="listAction" :disabled="barNames.indexOf(f.name) === barNames.length - 1"
                            :aria-label="`Move ${f.name} down in the bar order`" @click="moveOnBar(f.name, 1)"><ChevronDown :size="14" /></MachineBtn>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="session" class="macroEditor stack-controls">
      <div v-if="selected?.errors.length" class="statusNote error" role="alert">
        <span>Not runnable — line {{ selected.errors[0]!.line }}: {{ selected.errors[0]!.message }}</span>
      </div>
      <div v-for="w in selected?.warnings ?? []" :key="w.line + w.message" class="statusNote warn" role="alert">
        <span>Line {{ w.line }}: {{ w.message }}</span>
      </div>
      <div v-if="session.conflict" class="statusNote warn" role="alert" data-macro-conflict>
        <span>{{ session.conflict.reason }} — Reload shows it; Keep editing replaces it on your next Save</span>
        <span class="row-tight">
          <MachineBtn type="inline" @click="reload">Reload</MachineBtn>
          <MachineBtn type="inline" @click="keepEditing">Keep editing</MachineBtn>
        </span>
      </div>
      <div v-if="session.loading" class="emptyState loading">Loading {{ session.name }}.ngc…</div>
      <CodeEditor v-else :key="session.key" ref="editorRef" class="macroCode" :doc="session.original"
                  :owner-id="MACRO_EDITOR_OWNER" :context="`Macro · ${session.name}.ngc`" :auto-open="false"
                  @change="onChange" @load-error="note = { kind: 'error', text: $event }" />
      <div class="editActions">
        <MachineBtn type="fileSave" @click="save" :disabled="saving || session.loading || (!session.dirty && !session.conflict && !!session.revision)">
          {{ saving ? 'Saving…' : 'Save' }}</MachineBtn>
        <MachineBtn type="fileDiscard" @click="discardEdit" :disabled="saving || (!session.dirty && !session.conflict)">Discard</MachineBtn>
      </div>
    </div>

    <div class="sep"></div>
    <div class="sub">Earlier Macros</div>
    <div class="settingDesc">One MDI line each, stored in the settings — they stay on the bar and keep working.</div>
    <EarlierMacros ref="earlierRef" @convert="openConvert" />
    </div>

    <DialogFrame v-if="newOpen" kind="form" size="md" title="New Macro" @close="newOpen = false">
      <div class="dialogContent">
        <div class="formGrid">
          <FormField label="File name" wide :error="newError">
            <template #default="{ input }">
              <MachineInput v-bind="input" gate="macroEdit" type="text" v-model="newName" placeholder="e.g. face_top"
                            @keydown.enter.prevent="createNew" />
            </template>
          </FormField>
        </div>
      </div>
      <template #actions>
        <MachineBtn type="dialogCancel" @click="newOpen = false">Cancel</MachineBtn>
        <MachineBtn type="fileSave" :disabled="!newName.trim() || !!newError" @click="createNew">Create</MachineBtn>
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
      <div class="dialogBody">The macro folder has a file of this name; the import replaces it. This cannot be undone.</div>
      <template #actions>
        <MachineBtn type="dialogCancel" @click="replaceAsk = null">Cancel</MachineBtn>
        <MachineBtn type="dialogDangerSetup" @click="confirmReplace">Replace</MachineBtn>
      </template>
    </DialogFrame>

    <DialogFrame v-if="convert" kind="form" size="md" :title="`Convert ${convert.macro.name} to a File`" @close="convert = null">
      <div class="dialogContent stack-controls">
        <div class="formGrid">
          <FormField label="File name" :error="convertError && convertError.startsWith('File') || convertError?.startsWith('A macro') ? convertError : null">
            <template #default="{ input }">
              <MachineInput v-bind="input" gate="macroEdit" type="text" v-model="convert.name" />
            </template>
          </FormField>
          <FormField label="Units">
            <template #default="{ field }">
              <MachineSelect v-bind="field" gate="macroEdit" v-model="convert.units">
                <option value="mm">mm</option>
                <option value="inch">inch</option>
              </MachineSelect>
            </template>
          </FormField>
        </div>
        <div v-if="convert.params.length" class="sub">Values</div>
        <div v-for="p in convert.params" :key="p.name" class="formGrid">
          <FormField :label="`{${p.name}} default`">
            <template #default="{ input }">
              <MachineInput v-bind="input" gate="macroEdit" type="text" v-model="p.defaultText" />
            </template>
          </FormField>
          <FormField :label="`{${p.name}} kind`">
            <template #default="{ field }">
              <MachineSelect v-bind="field" gate="macroEdit" v-model="p.unit">
                <option v-for="u in UNIT_KINDS" :key="u" :value="u">{{ u }}</option>
              </MachineSelect>
            </template>
          </FormField>
        </div>
        <div v-if="convertError" class="statusNote warn" role="alert"><span>{{ convertError }}</span></div>
      </div>
      <template #actions>
        <MachineBtn type="dialogCancel" @click="convert = null">Cancel</MachineBtn>
        <MachineBtn type="fileSave" :disabled="!!convertError" @click="confirmConvert">Convert</MachineBtn>
      </template>
    </DialogFrame>
  </div>
</template>

<style scoped>
.macrosTab {
  flex: 1;
  min-height: 0;
}
.macrosBody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.macroCell {
  min-width: 0;
}
.macroFacts {
  display: flex;
  flex-wrap: wrap;
  column-gap: var(--gap-tight);
  font-size: var(--fs-sm);
}
/* A long file name (go_to_g30_macro.ngc) breaks where the column ends
   instead of widening the list past a narrow pane (.label-muted is nowrap). */
.fileName {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}
.macroObject {
  font-weight: var(--fw-semibold);
}
.macroTable {
  flex: none;
}
.selectedRow {
  background: var(--hl-selected);
}
.selectedRow td {
  background: inherit;
}
.macroEditor {
  flex: none;
}
.macroCode {
  height: calc(12 * var(--code-line-h));
}
.editActions {
  display: flex;
  gap: var(--gap-controls);
  justify-content: flex-end;
}
</style>
