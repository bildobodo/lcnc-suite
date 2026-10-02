<script setup lang="ts">
// The EARLIER macros — one MDI line with {placeholders} each, stored in the
// `macros` settings section — moved from Settings › Macros into the Macros
// tab (package 5, stage C: ONE place for macros). Behaviour as before: list,
// reorder, edit, delete with a confirmation; a draft is named to the tab's
// discard guard. New: "Convert to file" hands an entry to the tab, which
// writes it as a macro file only on request (the entry stays).
import { computed, inject, ref, watch } from "vue";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-vue-next";
import DialogFrame from "./DialogFrame.vue";
import FormField from "./FormField.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import { loadMacrosDefaults, saveMacrosDefaults, settingsVersion, syncMacroParams, type MacroDef } from "./defaults";

const emit = defineEmits<{ convert: [m: MacroDef] }>();
const updateMacros = inject<(macros: MacroDef[]) => void>("updateMacros", () => {});

const macros = ref<MacroDef[]>(loadMacrosDefaults().macros);
watch(settingsVersion, () => { macros.value = loadMacrosDefaults().macros; });
const editingMacro = ref<MacroDef | null>(null);
// The editor's state when it opened: leaving the tab over a CHANGED draft
// asks first (UI-K16, now the tab's guard).
const macroSnapshot = ref("");
function snapshotMacro() { macroSnapshot.value = JSON.stringify(editingMacro.value); }
/** What leaving would throw away, in operator words — null when nothing. */
function unsavedDraft(): string | null {
  return editingMacro.value && JSON.stringify(editingMacro.value) !== macroSnapshot.value ? "The earlier macro you are editing" : null;
}
/** Drop the draft (the tab's Discard). */
function discardDraft() { editingMacro.value = null; }
defineExpose({ unsavedDraft, discardDraft });

// Keep the macro's params in sync with the {placeholders} in its command as the
// user types (issue #26): syncMacroParams preserves edits to params that remain.
watch(
  () => editingMacro.value?.command,
  () => {
    const m = editingMacro.value;
    if (m) m.params = syncMacroParams(m.command, m.params);
  },
);

function addMacro() {
  editingMacro.value = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: "",
    command: "",
    params: [],
  };
  snapshotMacro();
}

function editMacro(m: MacroDef) {
  const copy = { ...m, params: m.params.map(p => ({ ...p })) };
  // Reconcile params with the command on open (review #4).
  copy.params = syncMacroParams(copy.command, copy.params);
  editingMacro.value = copy;
  snapshotMacro();
}

function saveMacro() {
  if (!editingMacro.value) return;
  const m = editingMacro.value;
  if (!m.name.trim() || !m.command.trim()) return;
  m.params = syncMacroParams(m.command, m.params);
  const idx = macros.value.findIndex(x => x.id === m.id);
  if (idx >= 0) macros.value[idx] = m;
  else macros.value.push(m);
  editingMacro.value = null;
  persistMacros();
}

function deleteMacro(id: string) {
  macros.value = macros.value.filter(m => m.id !== id);
  if (editingMacro.value?.id === id) editingMacro.value = null;
  persistMacros();
}

// Deletion is confirmed via dialog — the trash button is a ~30px icon
// target and macro deletion is irreversible.
const macroDeleteId = ref<string | null>(null);
const macroDeleteName = computed(() => macros.value.find(m => m.id === macroDeleteId.value)?.name ?? "");
function confirmMacroDelete() {
  if (macroDeleteId.value) deleteMacro(macroDeleteId.value);
  macroDeleteId.value = null;
}

function moveMacro(idx: number, dir: -1 | 1) {
  const target = idx + dir;
  if (target < 0 || target >= macros.value.length) return;
  const arr = [...macros.value];
  [arr[idx]!, arr[target]!] = [arr[target]!, arr[idx]!];
  macros.value = arr;
  persistMacros();
}

/** The whole section with these entries: the `bar` key (package 5) stays —
 *  saving `{ macros }` alone dropped it. */
function persistMacros() {
  saveMacrosDefaults({ ...loadMacrosDefaults(), macros: macros.value });
  updateMacros(macros.value);
}
</script>

<template>
  <div class="stack-controls">
    <div v-if="macros.length === 0 && !editingMacro" class="emptyState macroSettingsEmpty">
      No earlier macros. A macro file (above) can do everything they did.
    </div>

    <div class="stack-controls">
      <div v-for="(m, idx) in macros" :key="m.id" class="macroSettingsItem">
        <div class="macroSettingsInfo stack-micro">
          <span class="macroSettingsName">{{ m.name }}</span>
          <code class="macroSettingsCmd">{{ m.command }}</code>
        </div>
        <div class="macroSettingsActions">
          <MachineBtn type="listAction" :disabled="idx === 0" @click="moveMacro(idx, -1)" title="Move up"><ChevronUp :size="14" /></MachineBtn>
          <MachineBtn type="listAction" :disabled="idx === macros.length - 1" @click="moveMacro(idx, 1)" title="Move down"><ChevronDown :size="14" /></MachineBtn>
          <MachineBtn type="inline" @click="emit('convert', m)" :aria-label="`Convert ${m.name} to a macro file`">Convert to file</MachineBtn>
          <MachineBtn type="listAction" @click="editMacro(m)" title="Edit" :aria-label="`Edit macro ${m.name}`"><Pencil :size="14" /></MachineBtn>
          <!-- A destructive control names its target (UX-06) -->
          <MachineBtn type="listAction" @click="macroDeleteId = m.id" title="Delete" :aria-label="`Delete macro ${m.name}`"><Trash2 :size="14" /></MachineBtn>
        </div>
      </div>
    </div>

    <div v-if="editingMacro" class="macroEditForm">
      <div class="sub">{{ macros.some(m => m.id === editingMacro!.id) ? 'Edit' : 'New' }} Earlier Macro</div>
      <div class="stack-controls">
        <div class="formGrid">
          <FormField label="Name" wide>
            <template #default="{ input }">
              <MachineInput v-bind="input" gate="macroEdit" type="text" v-model="editingMacro.name" placeholder="e.g. Face Top" />
            </template>
          </FormField>
          <FormField label="Command" wide>
            <template #default="{ input }">
              <MachineInput v-bind="input" gate="macroEdit" type="text" v-model="editingMacro.command" placeholder="e.g. G0 Z{depth} F{feed}" />
            </template>
          </FormField>
        </div>
        <div class="macroParamHint">
          Use <code>{"{name}"}</code> for parameters. Users will be prompted for values.
        </div>

        <div v-if="editingMacro.params.length > 0" class="macroParamEditor">
          <div class="sub">Parameters</div>
          <div v-for="p in editingMacro.params" :key="p.name" class="macroParamEditRow">
            <code class="macroParamBadge">{{"{"}}{{ p.name }}{{"}"}}</code>
            <MachineInput gate="macroEdit" type="text" v-model="p.label" placeholder="Display label" :label="`${p.name} display label`" />
            <MachineInput gate="macroEdit" type="text" v-model="p.default" placeholder="Default value" :label="`${p.name} default value`" />
          </div>
        </div>
      </div>
      <div class="macroEditActions">
        <div class="hint">Unsaved edit — Save or Cancel</div>
        <MachineBtn type="dialogCancel" @click="editingMacro = null">Cancel</MachineBtn>
        <MachineBtn type="dialogConfirm" @click="saveMacro" :disabled="!editingMacro.name.trim() || !editingMacro.command.trim()">Save</MachineBtn>
      </div>
    </div>

    <MachineBtn v-if="!editingMacro && macros.length < 20" type="inlineMd" @click="addMacro">Add Earlier Macro</MachineBtn>

    <DialogFrame v-if="macroDeleteId" kind="confirm" :title="`Delete macro &quot;${macroDeleteName}&quot;?`" danger
                 @close="macroDeleteId = null">
      <div class="dialogBody">Its button leaves the macro bar. This cannot be undone.</div>
      <template #actions>
        <MachineBtn type="dialogCancel" @click="macroDeleteId = null">Cancel</MachineBtn>
        <MachineBtn type="dialogDanger" @click="confirmMacroDelete">Delete</MachineBtn>
      </template>
    </DialogFrame>
  </div>
</template>

<style scoped>
.macroEditActions > .hint { margin-right: auto; }
.hint {
  font-size: var(--fs-sm);
  color: var(--fg-muted);
}
.macroSettingsEmpty { padding: var(--gap-panel); }
.macroSettingsItem {
  display: flex;
  flex-wrap: wrap;   /* the actions drop below the name in a narrow pane (150 % portrait) */
  align-items: center;
  gap: var(--gap-controls);
  padding: var(--gap-tight) var(--gap-controls);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
}
.macroSettingsInfo {
  flex: 1 1 12rem;
  min-width: 0;
}
.macroSettingsName {
  font-weight: var(--fw-semibold);
}
.macroSettingsCmd {
  font-size: var(--fs-sm);
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.macroSettingsActions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-tight);
  flex-shrink: 0;
  max-width: 100%;
}
.macroEditForm {
  padding: var(--gap-controls);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
}
.macroParamHint {
  font-size: var(--fs-sm);
  color: var(--fg-muted);
}
.macroParamEditor {
  margin-top: var(--gap-controls);
}
.macroParamEditRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  margin-top: var(--gap-tight);
}
.macroParamBadge {
  font-size: var(--fs-sm);
  min-width: 70px;
  flex-shrink: 0;
}
.macroEditActions {
  display: flex;
  justify-content: flex-end;
  gap: var(--gap-controls);
  margin-top: var(--gap-section);
}
</style>
