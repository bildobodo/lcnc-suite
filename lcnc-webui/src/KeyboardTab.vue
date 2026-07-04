<script setup lang="ts">
// Keyboard-shortcut config — the Settings → Keyboard sub-tab. Extracted
// from SettingsPanel.vue. Owns the key-capture handler, the binding-table
// rendering, and the duplicate-detection logic. The kbConfig prop comes
// from the parent (which mirrors it to the server-synced KeyboardDefaults
// store); local edits emit `setKeyboardConfig` so the parent can persist.
//
// The keydown listener attaches in onMounted and detaches in onUnmounted.
// TabPanel uses v-show, so the child stays mounted across tab switches —
// the global listener is fine because it only acts when listeningAction
// is non-null (the user is actively binding a key).
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import {
  type KeyboardDefaults, type KeyboardAction,
  KEYBOARD_ACTION_LABELS, formatKeyName,
} from "./defaults";
import { viewerInit } from "./lcncWs";
import { isRotaryAxis } from "./useAxes";
import MachineBtn from "./MachineBtn.vue";
import MachineToggle from "./MachineToggle.vue";

const props = defineProps<{ kbConfig: KeyboardDefaults }>();
const emit = defineEmits<{
  (e: "setKeyboardConfig", cfg: KeyboardDefaults): void;
}>();

// Local mirror of the prop so the table inputs stay reactive while edits
// propagate back through `setKeyboardConfig`.
const kbConfig = ref<KeyboardDefaults>(props.kbConfig);
watch(() => props.kbConfig, (cfg) => { kbConfig.value = cfg; });

const listeningAction = ref<KeyboardAction | null>(null);
const captureError = ref("");
let captureErrorTimer: ReturnType<typeof setTimeout> | null = null;

function saveKb() {
  emit("setKeyboardConfig", { ...kbConfig.value, mapping: { ...kbConfig.value.mapping } });
}

// Actions to show in the key binding table. Jog rows are GENERATED from the
// machine's axis list (WS-D): only present axes get binding rows, in machine
// order; before viewer_init arrives we fall back to XYZ so the tab isn't
// empty while disconnected. Bindings stored for absent axes stay saved but
// inert (the runtime resolver ignores letters not in the axis list).
const COMMAND_ACTIONS: KeyboardAction[] = ["estop", "cycle", "abort"];
const machineAxes = computed<string[]>(() => {
  const axes = viewerInit.value?.axes;
  return Array.isArray(axes) && axes.length ? axes : ["X", "Y", "Z"];
});
function jogActionsFor(letters: string[]): KeyboardAction[] {
  return letters.flatMap(l => [`jog_${l.toLowerCase()}+`, `jog_${l.toLowerCase()}-`] as KeyboardAction[]);
}
const LINEAR_JOG_ACTIONS = computed<KeyboardAction[]>(() =>
  jogActionsFor(machineAxes.value.filter(a => !isRotaryAxis(a.toUpperCase()))));
const ROTARY_JOG_ACTIONS = computed<KeyboardAction[]>(() =>
  jogActionsFor(machineAxes.value.filter(a => isRotaryAxis(a.toUpperCase()))));
const hasRotaryAxes = computed(() => ROTARY_JOG_ACTIONS.value.length > 0);

// Modifier keys to reject
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

function startCapture(action: KeyboardAction) {
  listeningAction.value = action;
  captureError.value = "";
  if (captureErrorTimer) clearTimeout(captureErrorTimer);
}

function handleCapture(e: KeyboardEvent) {
  if (!listeningAction.value) return;
  e.preventDefault();
  e.stopPropagation();

  if (MODIFIER_KEYS.has(e.key)) return;

  if (e.key === "Tab") {
    showCaptureError("Tab cannot be bound");
    return;
  }

  // Duplicate check
  const existing = Object.entries(kbConfig.value.mapping).find(
    ([a, k]) => k === e.key && a !== listeningAction.value
  );
  if (existing) {
    showCaptureError(`Already bound to ${KEYBOARD_ACTION_LABELS[existing[0] as KeyboardAction]}`);
    return;
  }

  kbConfig.value.mapping[listeningAction.value] = e.key;
  listeningAction.value = null;
  saveKb();
}

function showCaptureError(msg: string) {
  captureError.value = msg;
  if (captureErrorTimer) clearTimeout(captureErrorTimer);
  captureErrorTimer = setTimeout(() => { captureError.value = ""; }, 2000);
}

function unbindKey(action: KeyboardAction) {
  kbConfig.value.mapping[action] = "";
  saveKb();
}

function cancelCapture() {
  listeningAction.value = null;
  captureError.value = "";
}

function onCaptureKeydown(e: KeyboardEvent) {
  if (listeningAction.value) handleCapture(e);
}

function onClickOutside(e: MouseEvent) {
  if (!listeningAction.value) return;
  const target = e.target as HTMLElement;
  if (!target.closest(".kbKeyCell")) cancelCapture();
}

onMounted(() => {
  window.addEventListener("keydown", onCaptureKeydown, true);
  window.addEventListener("click", onClickOutside);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onCaptureKeydown, true);
  window.removeEventListener("click", onClickOutside);
  if (captureErrorTimer) clearTimeout(captureErrorTimer);
});
</script>

<template>
  <div class="stack-panel">
    <div class="stack-controls">
      <div class="sub">Keyboard</div>
      <div class="settingDesc">Allow keyboard keys to control the machine. E-Stop is always active regardless of these settings.</div>
      <MachineToggle gate="inputConfig" v-model="kbConfig.jogEnabled" @update:modelValue="saveKb()" label="Enable keyboard jogging" />
      <MachineToggle gate="inputConfig" v-model="kbConfig.buttonsEnabled" @update:modelValue="saveKb()" label="Enable keyboard shortcuts" />
    </div>

    <template v-if="kbConfig.jogEnabled || kbConfig.buttonsEnabled">
      <div class="sep"></div>

      <div class="stack-controls">
        <div class="sub">Key Bindings</div>
        <div class="dataTable">
        <table>
          <tbody>
            <tr v-for="action in LINEAR_JOG_ACTIONS" :key="action" :class="{ inactive: !kbConfig.jogEnabled }">
              <td class="kbMapAction">{{ KEYBOARD_ACTION_LABELS[action] }}</td>
              <td class="kbKeyCell"
                  :class="{ listening: listeningAction === action }"
                  @click="startCapture(action)">
                {{ listeningAction === action ? 'Press a key...' : formatKeyName(kbConfig.mapping[action]) }}
              </td>
              <td class="kbUnbind">
                <MachineBtn type="close" v-if="kbConfig.mapping[action]" @click.stop="unbindKey(action)" title="Unbind">&times;</MachineBtn>
              </td>
            </tr>
            <template v-if="hasRotaryAxes">
              <tr v-for="action in ROTARY_JOG_ACTIONS" :key="action" :class="{ inactive: !kbConfig.jogEnabled }">
                <td class="kbMapAction">{{ KEYBOARD_ACTION_LABELS[action] }}</td>
                <td class="kbKeyCell"
                    :class="{ listening: listeningAction === action }"
                    @click="startCapture(action)">
                  {{ listeningAction === action ? 'Press a key...' : formatKeyName(kbConfig.mapping[action]) }}
                </td>
                <td class="kbUnbind">
                  <MachineBtn type="close" v-if="kbConfig.mapping[action]" @click.stop="unbindKey(action)" title="Unbind">&times;</MachineBtn>
                </td>
              </tr>
            </template>
            <tr class="kbSep"><td colspan="3"></td></tr>
            <!-- E-Stop is NEVER dimmed: it fires regardless of the master toggle
                 (useKeyboardShortcuts bypasses it by design) — dimming it here showed
                 a safety control as disabled while it was actually active. -->
            <tr v-for="action in COMMAND_ACTIONS" :key="action" :class="{ inactive: !kbConfig.buttonsEnabled && action !== 'estop' }">
              <td class="kbMapAction">{{ KEYBOARD_ACTION_LABELS[action] }}<span v-if="action === 'estop'" class="kbAlways"> — always active</span></td>
              <td class="kbKeyCell"
                  :class="{ listening: listeningAction === action }"
                  @click="startCapture(action)">
                {{ listeningAction === action ? 'Press a key...' : formatKeyName(kbConfig.mapping[action]) }}
              </td>
              <td class="kbUnbind">
                <MachineBtn type="close" v-if="kbConfig.mapping[action]" @click.stop="unbindKey(action)" title="Unbind">&times;</MachineBtn>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <div v-if="captureError" class="kbCaptureError">{{ captureError }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.kbAlways {
  opacity: var(--opacity-muted);
}

.kbMapAction {
  font-weight: var(--fw-semibold);
  white-space: nowrap;
  width: 1%;
}

.kbKeyCell {
  cursor: pointer;
  font-family: var(--font-mono);
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}

.kbKeyCell:hover {
  background: color-mix(in oklab, var(--fg) var(--hl-hover), var(--bg));
}

.kbKeyCell.listening {
  background: color-mix(in oklab, var(--info) var(--hl-selected), var(--bg));
  outline: 1px solid var(--info);
}

.kbUnbind {
  width: 1%;
}

.kbSep td {
  padding: 0;
  height: var(--gap-section);
  border-bottom: none;
}

.kbCaptureError {
  font-size: var(--fs-sm);
  color: var(--danger);
  margin-top: var(--gap-controls);
}

/* settingDesc is also used in SettingsPanel; duplicated here so the
   description text under the section header keeps its muted styling
   without requiring a global utility. */
.settingDesc {
  font-size: var(--fs-base);
  opacity: var(--opacity-muted);
  margin-bottom: var(--gap-section);
}
</style>
