<script setup lang="ts">
// Gamepad-mapping config — the Settings → Gamepad sub-tab. Extracted from
// SettingsPanel.vue. The tab's internals are mostly emit-based passthroughs
// to the server-synced GamepadDefaults store: each toggle/slider is a
// computed get/set pair that pushes a new config to the parent on change,
// and gpMapping is a local reactive mirror of the prop's mapping object.
//
// The parent owns serverSettingsReady gating, the reset confirmation
// dialog, and the chain to App.vue's settings update.
import { reactive, computed, watch, ref, inject, type Ref } from "vue";
import {
  type GamepadDefaults, type GamepadMapping,
  GAMEPAD_ACTIONS, DEFAULT_MAPPING,
} from "./defaults";
import type { GamepadProfile, MappingSource } from "./gamepadProfile";
import MachineBtn from "./MachineBtn.vue";
import MachineToggle from "./MachineToggle.vue";
import FormField from "./FormField.vue";
import MachineSlider from "./MachineSlider.vue";
import MachineSelect from "./MachineSelect.vue";
import GamepadLiveInput from "./GamepadLiveInput.vue";
import GamepadMapWizard from "./GamepadMapWizard.vue";
import DialogFrame from "./DialogFrame.vue";
import { fmtPct, NO_VALUE } from "./format";
import { viewerInit } from "./lcncWs";
import { useAxes, DEFAULT_AXES } from "./useAxes";

const props = defineProps<{
  gamepadConfig: GamepadDefaults | undefined;
  gamepadConnected: boolean | undefined;
  gamepadName: string | undefined;
  gamepadMappingSource: MappingSource | null | undefined;
}>();

const emit = defineEmits<{
  (e: "setGamepadConfig", cfg: GamepadDefaults): void;
}>();

const GP_BTN_LABELS: Record<keyof GamepadMapping, string> = {
  btn_a: "A", btn_b: "B", btn_x: "X", btn_y: "Y",
  btn_lb: "LB", btn_rb: "RB", btn_lt: "LT", btn_rt: "RT",
  btn_back: "Back", btn_start: "Start", btn_ls: "LS", btn_rs: "RS",
};

// Local reactive mirror so each row's MachineSelect can v-model directly.
// Synced from the prop's mapping; pushed back on change via onGpMappingChanged.
const gpMapping = reactive<GamepadMapping>({ ...(props.gamepadConfig?.mapping ?? DEFAULT_MAPPING) });

watch(() => props.gamepadConfig?.mapping, (m) => {
  if (!m) return;
  for (const k of Object.keys(gpMapping) as (keyof GamepadMapping)[]) {
    if (gpMapping[k] !== m[k]) gpMapping[k] = m[k];
  }
});

// Boolean wrappers — get from prop, emit on set. Avoids a parallel reactive
// mirror per flag and keeps the parent as single source of truth.
const gpJogEnabled = computed({
  get: () => props.gamepadConfig?.jogEnabled ?? false,
  set: (v: boolean) => { emit('setGamepadConfig', { ...props.gamepadConfig!, jogEnabled: v }); },
});
const gpButtonsEnabled = computed({
  get: () => props.gamepadConfig?.buttonsEnabled ?? false,
  set: (v: boolean) => { emit('setGamepadConfig', { ...props.gamepadConfig!, buttonsEnabled: v }); },
});
// Axis inversion for the axes the sticks jog (X, Y, Z — by letter), only
// those the machine has (useAxes, UI-N70): an XZ lathe gets no "Invert Y".
const { primary: stickAxes } = useAxes(computed(() => viewerInit.value?.axes ?? [...DEFAULT_AXES]));
type InvertKey = "invertX" | "invertY" | "invertZ";
const invertKey = (letter: string) => `invert${letter}` as InvertKey;
function isInverted(letter: string): boolean { return props.gamepadConfig?.[invertKey(letter)] ?? false; }
function setInverted(letter: string, v: boolean) {
  emit('setGamepadConfig', { ...props.gamepadConfig!, [invertKey(letter)]: v });
}

function onGpMappingChanged() {
  if (!props.gamepadConfig) return;
  emit("setGamepadConfig", { ...props.gamepadConfig, mapping: { ...gpMapping } });
}

// ── Per-controller mapping profiles ──
const showWizard = ref(false);
// Settings asks before it closes over a running wizard (UI-K16): the wizard
// lives and dies with this tab's parent dialog.
defineExpose({ wizardOpen: () => showWizard.value });
const hasProfile = computed(() =>
  !!(props.gamepadName && props.gamepadConfig?.profiles?.[props.gamepadName]));

const MAPPING_STATUS: Record<MappingSource, string> = {
  profile: "Custom profile active for this controller.",
  standard: "Recognized by the browser — standard layout.",
  assumed: "Layout NOT recognized by the browser — assuming the standard layout. If buttons don't match, run Map Buttons.",
};

function onWizardSave(p: GamepadProfile) {
  showWizard.value = false;
  if (!props.gamepadConfig) return;
  const profiles = { ...(props.gamepadConfig.profiles ?? {}), [p.id]: p };
  emit("setGamepadConfig", { ...props.gamepadConfig, profiles });
}

// Removing a mapped profile asks first (P1); a DialogFrame stacks over
// Settings.
const removeConfirm = ref(false);
function requestRemoveProfile() { removeConfirm.value = true; }
function removeProfile() {
  removeConfirm.value = false;
  if (!props.gamepadConfig || !props.gamepadName) return;
  const profiles = { ...(props.gamepadConfig.profiles ?? {}) };
  delete profiles[props.gamepadName];
  emit("setGamepadConfig", { ...props.gamepadConfig, profiles });
}

// Raw diagnostics — proves whether the device delivers ANY data to the
// browser (if this stays flat, the problem is below the web app: controller
// mode / OS driver, not the mapping).
const rawAxes = inject<Ref<number[]>>("gamepadAxes", ref([]));
const rawButtons = inject<Ref<boolean[]>>("gamepadButtons", ref([]));
const rawSummary = computed(() => {
  const pressed = rawButtons.value.flatMap((p, i) => (p ? [i] : []));
  const axes = rawAxes.value.map(v => v.toFixed(2)).join(" ");
  return `buttons: ${pressed.length ? pressed.join(",") : NO_VALUE}  axes: ${axes || NO_VALUE}`;
});
</script>

<template>
  <div class="stack-panel">
    <div class="stack-controls">
      <div class="sub">Gamepad</div>
      <div class="settingDesc">Use an Xbox, PlayStation, or standard gamepad to control the machine.</div>
      <MachineToggle gate="inputConfig" v-model="gpJogEnabled" label="Enable gamepad jogging" />
      <MachineToggle gate="inputConfig" v-model="gpButtonsEnabled" label="Enable gamepad commands" />
    </div>

    <div class="sep"></div>

    <div class="stack-controls">
      <div class="sub">Connection</div>
      <div class="settingDesc" :class="{ 'text-ok': gamepadConnected }">
        {{ gamepadConnected ? gamepadName : 'No gamepad detected — connect one and press a button' }}
      </div>
      <template v-if="gamepadConnected">
        <div class="settingDesc" :class="{ 'text-ok': gamepadMappingSource === 'profile' }">
          {{ gamepadMappingSource ? MAPPING_STATUS[gamepadMappingSource] : '' }}
        </div>
        <div class="row-controls">
          <MachineBtn type="inlineMd" @click="showWizard = true">Map Buttons…</MachineBtn>
          <MachineBtn v-if="hasProfile" type="profileRemove" @click="requestRemoveProfile">Remove Profile</MachineBtn>
          <DialogFrame v-if="removeConfirm" kind="confirm" title="Remove profile?" danger @close="removeConfirm = false">
            <div class="dialogBody">The button and stick mapping for <strong>{{ gamepadName }}</strong> will be deleted. This cannot be undone.</div>
            <template #actions>
              <MachineBtn type="dialogCancel" @click="removeConfirm = false">Cancel</MachineBtn>
              <MachineBtn type="dialogDanger" @click="removeProfile">Remove</MachineBtn>
            </template>
          </DialogFrame>
        </div>
        <div class="settingDesc mono">{{ rawSummary }}</div>
      </template>
    </div>

    <div class="sep" v-if="gamepadConfig?.jogEnabled"></div>

    <div v-if="gamepadConfig?.jogEnabled" class="stack-controls">
      <div class="sub">Axis Inversion</div>
      <div class="settingDesc">Flip axis direction if your gamepad moves the wrong way.</div>
      <MachineToggle v-for="a in stickAxes" :key="a.letter" gate="inputConfig" :label="`Invert ${a.letter}`"
                     :modelValue="isInverted(a.letter)" @update:modelValue="setInverted(a.letter, $event)" />
    </div>

    <div class="sep" v-if="gamepadConfig?.jogEnabled"></div>

    <div v-if="gamepadConfig?.jogEnabled" class="stack-controls">
      <div class="sub">Dead Zone & Live Input</div>
      <div class="settingDesc">Ignore stick deflection below this threshold to prevent drift.</div>
      <!-- A slider's head shows its value where a field shows its unit -->
      <FormField label="Dead Zone" :unit="fmtPct(gamepadConfig?.deadZone ?? 0.15)">
        <template #default="{ field }">
          <MachineSlider
            v-bind="field"
            :aria-valuetext="fmtPct(gamepadConfig?.deadZone ?? 0.15)"
            gate="inputConfig"
            :min="0.05" :max="0.50" :step="0.01"
            :modelValue="gamepadConfig?.deadZone ?? 0.15"
            @update:modelValue="(v: number | undefined) => emit('setGamepadConfig', { ...gamepadConfig!, deadZone: v ?? 0.15 })"
          />
        </template>
      </FormField>
      <div v-if="gamepadConnected">
        <div class="settingDesc">Move sticks and press buttons to verify mapping.</div>
        <GamepadLiveInput :deadZone="gamepadConfig?.deadZone ?? 0.15" />
      </div>
    </div>

    <div class="sep" v-if="gamepadConfig?.buttonsEnabled"></div>

    <div v-if="gamepadConfig?.buttonsEnabled" class="stack-controls">
      <div class="sub">Button Bindings</div>
      <div class="dataTable">
      <table>
        <!-- Action | binding, like the keyboard's table (UI-N68) -->
        <tbody>
          <tr><td>XY continuous jog (proportional)</td><td class="gpMapKey">Left Stick</td></tr>
          <tr><td>Z continuous jog (proportional)</td><td class="gpMapKey">Right Stick Y</td></tr>
          <tr><td>XY discrete jog (full speed)</td><td class="gpMapKey">D-pad</td></tr>
          <!-- v-memo on the ROW (a v-memo inside a v-for is not honoured):
               the tab re-renders at the pad's poll rate, and Vue re-assigns a
               bound <option value> on every render; Firefox rebuilds an OPEN
               dropdown on any change inside it (2026-10-04, select-writes.spec:
               242 writes in 20 packets). The row changes with its binding. -->
          <tr v-for="(label, key) in GP_BTN_LABELS" :key="key" v-memo="[gpMapping[key], label]">
            <td>
              <MachineSelect
                gate="inputConfig"
                class="gpActionSelect"
                :aria-label="`${label} action`"
                v-model="gpMapping[key]"
                @update:modelValue="onGpMappingChanged"
              >
                <option v-for="a in GAMEPAD_ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
              </MachineSelect>
            </td>
            <td class="gpMapKey">{{ label }}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <GamepadMapWizard
      v-if="showWizard && gamepadName"
      :gamepadName="gamepadName"
      @save="onWizardSave"
      @cancel="showWizard = false"
    />
  </div>
</template>

<style scoped>
.gpMapKey {
  font-weight: var(--fw-semibold);
  white-space: nowrap;
  width: 1%;
}

.gpActionSelect {
  width: 100%;
}
</style>
