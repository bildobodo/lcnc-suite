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
  KEYBOARD_ACTION_LABELS, formatKeyName, ESTOP_KEY,
} from "./defaults";
import { viewerInit } from "./lcncWs";
import { isRotaryAxis, DEFAULT_AXES } from "./useAxes";
import MachineBtn from "./MachineBtn.vue";
import { Trash2 } from "lucide-vue-next";
import MachineToggle from "./MachineToggle.vue";

const props = defineProps<{ kbConfig: KeyboardDefaults }>();
const emit = defineEmits<{
  (e: "setKeyboardConfig", cfg: KeyboardDefaults): void;
}>();

// Local COPY of the prop so the table inputs stay reactive while edits
// propagate back through `setKeyboardConfig`. A shallow copy of the config
// plus its mapping (UI-04): mirroring the prop object itself let every key
// capture mutate the parent's store in place before the emit, and
// structuredClone throws DataCloneError on a Vue proxy.
function cloneKb(cfg: KeyboardDefaults): KeyboardDefaults {
  return { ...cfg, mapping: { ...cfg.mapping } };
}
const kbConfig = ref<KeyboardDefaults>(cloneKb(props.kbConfig));
watch(() => props.kbConfig, (cfg) => { kbConfig.value = cloneKb(cfg); }, { deep: true });

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
// `estop` is rendered as a fixed row (Escape, reserved) — see the template.
const COMMAND_ACTIONS: KeyboardAction[] = ["cycle", "abort"];
const machineAxes = computed<string[]>(() => {
  const axes = viewerInit.value?.axes;
  return Array.isArray(axes) && axes.length ? axes : [...DEFAULT_AXES];
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
  if (action === "estop") return;  // fixed to Escape — not re-bindable
  listeningAction.value = action;
  captureError.value = "";
  if (captureErrorTimer) clearTimeout(captureErrorTimer);
}

function handleCapture(e: KeyboardEvent) {
  if (!listeningAction.value) return;
  // Escape is the reserved E-Stop key: it passes through UNTOUCHED (no
  // preventDefault, no stopPropagation — this capture listener used to
  // swallow it while binding a key, UI-03) and merely cancels the capture.
  if (e.key === ESTOP_KEY) { cancelCapture(); return; }
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
      <MachineToggle gate="inputConfig" v-model="kbConfig.buttonsEnabled" @update:modelValue="saveKb()" label="Enable keyboard commands" />
    </div>

    <template v-if="kbConfig.jogEnabled || kbConfig.buttonsEnabled">
      <div class="sep"></div>

      <div class="stack-controls">
        <div class="sub">Key Bindings</div>
        <div class="dataTable">
        <table>
          <!-- Action | binding, like the gamepad's table (UI-N68). No header
               row: .dataTable's sticky head covered the top row inside the
               scrolling Settings page. -->
          <tbody>
            <tr v-for="action in LINEAR_JOG_ACTIONS" :key="action" :class="{ inactive: !kbConfig.jogEnabled }">
              <td class="kbMapAction">{{ KEYBOARD_ACTION_LABELS[action] }}</td>
              <td class="kbKeyCell"
                  :class="{ listening: listeningAction === action }"
                  @click="startCapture(action)">
                {{ listeningAction === action ? 'Press a key…' : formatKeyName(kbConfig.mapping[action]) }}
              </td>
              <td class="kbUnbind">
                <MachineBtn type="listAction" v-if="kbConfig.mapping[action]" :aria-label="`Remove binding for ${KEYBOARD_ACTION_LABELS[action]}`" :title="`Remove binding for ${KEYBOARD_ACTION_LABELS[action]}`" @click.stop="unbindKey(action)"><Trash2 :size="14" /></MachineBtn>
              </td>
            </tr>
            <template v-if="hasRotaryAxes">
              <tr v-for="action in ROTARY_JOG_ACTIONS" :key="action" :class="{ inactive: !kbConfig.jogEnabled }">
                <td class="kbMapAction">{{ KEYBOARD_ACTION_LABELS[action] }}</td>
                <td class="kbKeyCell"
                    :class="{ listening: listeningAction === action }"
                    @click="startCapture(action)">
                  {{ listeningAction === action ? 'Press a key…' : formatKeyName(kbConfig.mapping[action]) }}
                </td>
                <td class="kbUnbind">
                  <MachineBtn type="listAction" v-if="kbConfig.mapping[action]" :aria-label="`Remove binding for ${KEYBOARD_ACTION_LABELS[action]}`" :title="`Remove binding for ${KEYBOARD_ACTION_LABELS[action]}`" @click.stop="unbindKey(action)"><Trash2 :size="14" /></MachineBtn>
                </td>
              </tr>
            </template>
            <tr class="kbSep"><td colspan="3"></td></tr>
            <!-- E-Stop is NEVER dimmed and NEVER re-bound: Escape is reserved
                 (operator decision 2026-09-19) and fires regardless of the
                 master toggle. A fixed row — no capture cell, no unbind. -->
            <tr>
              <td class="kbMapAction">{{ KEYBOARD_ACTION_LABELS.estop }}<span class="text-muted"> — always active, reserved</span></td>
              <td class="kbKeyCell kbFixed" :title="`${formatKeyName(ESTOP_KEY)} is reserved for E-Stop and cannot be changed`">{{ formatKeyName(ESTOP_KEY) }}</td>
              <td class="kbUnbind"></td>
            </tr>
            <tr v-for="action in COMMAND_ACTIONS" :key="action" :class="{ inactive: !kbConfig.buttonsEnabled }">
              <td class="kbMapAction">{{ KEYBOARD_ACTION_LABELS[action] }}</td>
              <td class="kbKeyCell"
                  :class="{ listening: listeningAction === action }"
                  @click="startCapture(action)">
                {{ listeningAction === action ? 'Press a key…' : formatKeyName(kbConfig.mapping[action]) }}
              </td>
              <td class="kbUnbind">
                <MachineBtn type="listAction" v-if="kbConfig.mapping[action]" :aria-label="`Remove binding for ${KEYBOARD_ACTION_LABELS[action]}`" :title="`Remove binding for ${KEYBOARD_ACTION_LABELS[action]}`" @click.stop="unbindKey(action)"><Trash2 :size="14" /></MachineBtn>
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
  background: var(--hl-surface);
}

.kbKeyCell.kbFixed {
  cursor: default;
  color: var(--fg-muted);
}

.kbKeyCell.listening {
  background: var(--hl-surface-info);
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
  color: var(--danger-text);
  margin-top: var(--gap-controls);
}

</style>
