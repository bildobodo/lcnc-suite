<script setup lang="ts">
// Gamepad-mapping config — the Settings → Gamepad sub-tab. Extracted from
// SettingsPanel.vue. The tab's internals are mostly emit-based passthroughs
// to the server-synced GamepadDefaults store: each toggle/slider is a
// computed get/set pair that pushes a new config to the parent on change,
// and gpMapping is a local reactive mirror of the prop's mapping object.
//
// The parent owns serverSettingsReady gating, the reset confirmation
// dialog, and the chain to App.vue's settings update.
import { reactive, computed, watch } from "vue";
import {
  type GamepadDefaults, type GamepadMapping,
  GAMEPAD_ACTIONS, DEFAULT_MAPPING,
} from "./defaults";
import MachineToggle from "./MachineToggle.vue";
import MachineSlider from "./MachineSlider.vue";
import MachineSelect from "./MachineSelect.vue";
import GamepadLiveInput from "./GamepadLiveInput.vue";

const props = defineProps<{
  gamepadConfig: GamepadDefaults | undefined;
  gamepadConnected: boolean | undefined;
  gamepadName: string | undefined;
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
const gpInvertX = computed({
  get: () => props.gamepadConfig?.invertX ?? false,
  set: (v: boolean) => { emit('setGamepadConfig', { ...props.gamepadConfig!, invertX: v }); },
});
const gpInvertY = computed({
  get: () => props.gamepadConfig?.invertY ?? false,
  set: (v: boolean) => { emit('setGamepadConfig', { ...props.gamepadConfig!, invertY: v }); },
});
const gpInvertZ = computed({
  get: () => props.gamepadConfig?.invertZ ?? false,
  set: (v: boolean) => { emit('setGamepadConfig', { ...props.gamepadConfig!, invertZ: v }); },
});

function onGpMappingChanged() {
  if (!props.gamepadConfig) return;
  emit("setGamepadConfig", { ...props.gamepadConfig, mapping: { ...gpMapping } });
}
</script>

<template>
  <div class="stack-panel">
    <div class="stack-controls">
      <div class="sub">Gamepad</div>
      <div class="settingDesc">Use an Xbox, PlayStation, or standard gamepad to control the machine.</div>
      <MachineToggle gate="inputConfig" v-model="gpJogEnabled" label="Enable gamepad jogging" />
      <MachineToggle gate="inputConfig" v-model="gpButtonsEnabled" label="Enable gamepad buttons" />
    </div>

    <div class="sep"></div>

    <div class="stack-controls">
      <div class="sub">Connection</div>
      <div class="settingDesc" :class="{ okText: gamepadConnected }">
        {{ gamepadConnected ? gamepadName : 'No gamepad detected — connect one and press a button' }}
      </div>
    </div>

    <div class="sep" v-if="gamepadConfig?.jogEnabled"></div>

    <div v-if="gamepadConfig?.jogEnabled" class="stack-controls">
      <div class="sub">Axis Inversion</div>
      <div class="settingDesc">Flip axis direction if your gamepad moves the wrong way.</div>
      <MachineToggle gate="inputConfig" v-model="gpInvertX" label="Invert X" />
      <MachineToggle gate="inputConfig" v-model="gpInvertY" label="Invert Y" />
      <MachineToggle gate="inputConfig" v-model="gpInvertZ" label="Invert Z" />
    </div>

    <div class="sep" v-if="gamepadConfig?.jogEnabled"></div>

    <div v-if="gamepadConfig?.jogEnabled" class="stack-controls">
      <div class="sub">Dead Zone & Live Input</div>
      <div class="settingDesc">Ignore stick deflection below this threshold to prevent drift.</div>
      <div class="sliderRow">
        <MachineSlider
          gate="inputConfig"
          :min="0.05" :max="0.50" :step="0.01"
          :modelValue="gamepadConfig?.deadZone ?? 0.15"
          @update:modelValue="(v: number | undefined) => emit('setGamepadConfig', { ...gamepadConfig!, deadZone: v ?? 0.15 })"
        />
        <span class="sliderVal">{{ Math.round((gamepadConfig?.deadZone ?? 0.15) * 100) }}%</span>
      </div>
      <div v-if="gamepadConnected">
        <div class="settingDesc">Move sticks and press buttons to verify mapping.</div>
        <GamepadLiveInput :deadZone="gamepadConfig?.deadZone ?? 0.15" />
      </div>
    </div>

    <div class="sep" v-if="gamepadConfig?.buttonsEnabled"></div>

    <div v-if="gamepadConfig?.buttonsEnabled" class="stack-controls">
      <div class="sub">Button Mapping</div>
      <div class="dataTable">
      <table>
        <tbody>
          <tr><td class="gpMapKey">Left Stick</td><td>XY continuous jog (proportional)</td></tr>
          <tr><td class="gpMapKey">Right Stick Y</td><td>Z continuous jog (proportional)</td></tr>
          <tr><td class="gpMapKey">D-pad</td><td>XY discrete jog (full speed)</td></tr>
          <tr v-for="(label, key) in GP_BTN_LABELS" :key="key">
            <td class="gpMapKey">{{ label }}</td>
            <td>
              <MachineSelect
                gate="inputConfig"
                class="gpActionSelect"
                v-model="gpMapping[key]"
                @update:modelValue="onGpMappingChanged"
              >
                <option v-for="a in GAMEPAD_ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
              </MachineSelect>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* settingDesc is shared with KeyboardTab + SettingsPanel — duplicated
   here for the same reason (scoped CSS doesn't cross component boundaries).
   Worth promoting to global in a future cleanup. */
.settingDesc {
  font-size: var(--fs-base);
  opacity: var(--opacity-muted);
  margin-bottom: var(--gap-section);
}

/* okText was previously defined only in App.vue's scoped CSS — meaning
   the green-when-connected styling for the connection status label was
   silently broken (App.vue's scope id doesn't reach SettingsPanel's
   children). Local definition fixes it. */
.okText {
  color: var(--ok);
}

.gpMapKey {
  font-weight: var(--fw-semibold);
  white-space: nowrap;
  width: 1%;
}

.gpActionSelect {
  width: 100%;
}
</style>
