<script setup lang="ts">
import { ref } from "vue";
import DroPanel from "./DroPanel.vue";
import JogPanel from "./JogPanel.vue";
import { usePermissions } from "./permissions";

const can = usePermissions();

const props = defineProps<{
  // DRO props
  workPos: number[];
  machinePos: number[];
  dtg: number[];
  g5xLabel: string;
  linearUnit: string;
  homed: boolean;
  homedJoints: boolean[];
  // Jog props
  jogVel: number;
  isTeleop: boolean;
  isHomed: boolean;
  maxJogVel: number;
  activeJogKeys?: Set<string>;
  jogIncrement: number;
  minJogVel: number;
  iniIncrements: number[] | null;
  // MDI props
  mdiText: string;
}>();

const emit = defineEmits<{
  // DRO emits
  (e: "zeroAxis", axis: number): void;
  (e: "zeroAll"): void;
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "homeAxis", joint: number): void;
  (e: "unhomeAxis", joint: number): void;
  (e: "setG5x", gcode: string): void;
  // Jog emits
  (e: "update:jogVel", vel: number): void;
  (e: "update:jogIncrement", val: number): void;
  (e: "toggleTeleop"): void;
  // MDI emits
  (e: "update:mdiText", text: string): void;
  (e: "sendMdi"): void;
}>();

// ---- MDI history (up-arrow recall) ----
const history = ref<string[]>([]);
const historyIndex = ref(-1); // -1 = current input, 0 = most recent, etc.
const savedInput = ref("");   // stash current input when browsing history
const maxHistory = 20;

function handleSend() {
  const cmd = props.mdiText.trim();
  if (cmd) {
    if (history.value[0] !== cmd) {
      history.value.unshift(cmd);
      if (history.value.length > maxHistory) {
        history.value = history.value.slice(0, maxHistory);
      }
    }
  }
  historyIndex.value = -1;
  savedInput.value = "";
  emit("sendMdi");
}

function onMdiKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowUp") {
    e.preventDefault();
    e.stopPropagation(); // prevent global jog handler
    if (history.value.length === 0) return;
    if (historyIndex.value === -1) {
      savedInput.value = props.mdiText;
    }
    if (historyIndex.value < history.value.length - 1) {
      historyIndex.value++;
      emit("update:mdiText", history.value[historyIndex.value]);
    }
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation(); // prevent global jog handler
    if (historyIndex.value < 0) return;
    historyIndex.value--;
    if (historyIndex.value === -1) {
      emit("update:mdiText", savedInput.value);
    } else {
      emit("update:mdiText", history.value[historyIndex.value]);
    }
    return;
  }
}
</script>

<template>
  <div class="manualPanel scroll-thin">
    <!-- DRO section -->
    <DroPanel
      :workPos="workPos"
      :machinePos="machinePos"
      :dtg="dtg"
      :g5xLabel="g5xLabel"
      :homed="homed"
      :homedJoints="homedJoints"
      @zeroAxis="emit('zeroAxis', $event)"
      @zeroAll="emit('zeroAll')"
      @setG5x="emit('setG5x', $event)"
      @homeAll="emit('homeAll')"
      @unhomeAll="emit('unhomeAll')"
      @homeAxis="emit('homeAxis', $event)"
      @unhomeAxis="emit('unhomeAxis', $event)"
    />

    <div class="sep"></div>

    <!-- Jog section -->
    <JogPanel
      :jogVel="jogVel"
      :isTeleop="isTeleop"
      :isHomed="isHomed"
      :linearUnit="linearUnit"
      :maxJogVel="maxJogVel"
      :activeJogKeys="activeJogKeys"
      :jogIncrement="jogIncrement"
      :minJogVel="minJogVel"
      :iniIncrements="iniIncrements"
      @update:jogVel="emit('update:jogVel', $event)"
      @update:jogIncrement="emit('update:jogIncrement', $event)"
      @toggleTeleop="emit('toggleTeleop')"
    />

    <div class="sep"></div>

    <!-- MDI input bar -->
    <div>
      <div class="sub">MDI</div>
      <div class="mdiRow">
        <input
          type="text"
          class="mdiInput"
          :value="mdiText"
          @input="emit('update:mdiText', ($event.target as HTMLInputElement).value)"
          @keyup.enter="handleSend"
          @keydown="onMdiKeydown"
          :disabled="!can.ready"
          placeholder="G-code command (↑↓ history)"
        />
        <button class="btn" @click="handleSend" :disabled="!can.ready">
          Send
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.manualPanel {
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow-y: auto;
  height: 100%;
}

.sep {
  margin: 12px 0;
  border-top: 1px solid var(--border);
  opacity: 0.4;
}

.mdiRow {
  display: flex;
  gap: 10px;
  align-items: center;
}

.mdiInput {
  flex: 1;
  min-width: 0;
  padding: 0.6em 1.2em;
  font-size: 1em;
  border-radius: 8px;
}
</style>
