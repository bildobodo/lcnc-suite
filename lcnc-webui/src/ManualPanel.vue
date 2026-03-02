<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import DroPanel from "./DroPanel.vue";
import JogPanel from "./JogPanel.vue";
import { usePermissions } from "./permissions";
import { loadMdiHistory, saveMdiHistory } from "./defaults";

const can = usePermissions();

const props = defineProps<{
  // DRO props
  axes: string[];
  workPos: number[];
  machinePos: number[];
  dtg: number[];
  g5xLabel: string;
  linearUnit: string;
  homed: boolean;
  homedJoints: boolean[];
  // Jog props
  jogVel: number;
  angularJogVel: number;
  isTeleop: boolean;
  isHomed: boolean;
  maxJogVel: number;
  maxAngularJogVel: number;
  minAngularJogVel: number;
  activeJogKeys?: Set<string>;
  jogIncrement: number;
  minJogVel: number;
  iniIncrements: number[] | null;
  // MDI props
  mdiText: string;
  // Touchoff (shared)
  touchoff: number[];
}>();

const emit = defineEmits<{
  // DRO emits
  (e: "setAxis", axis: number, value: number): void;
  (e: "setAll", values: number[]): void;
  (e: "update:touchoff", values: number[]): void;
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "homeAxis", joint: number): void;
  (e: "unhomeAxis", joint: number): void;
  (e: "setG5x", gcode: string): void;
  // Jog emits
  (e: "update:jogVel", vel: number): void;
  (e: "update:angularJogVel", vel: number): void;
  (e: "update:jogIncrement", val: number): void;
  (e: "toggleTeleop"): void;
  // MDI emits
  (e: "update:mdiText", text: string): void;
  (e: "sendMdi"): void;
  // Navigation
  (e: "goToG30"): void;
  (e: "goToHome"): void;
  (e: "goToZero"): void;
}>();

// ---- MDI history (up-arrow recall + localStorage persistence) ----
const history = ref<string[]>([]);
const historyIndex = ref(-1); // -1 = current input, 0 = most recent, etc.
const savedInput = ref("");   // stash current input when browsing history
const maxHistory = 50;
const mdiPopoverOpen = ref(false);
const mdiSectionRef = ref<HTMLElement | null>(null);

onMounted(() => {
  history.value = loadMdiHistory();
  document.addEventListener("click", onDocClick);
});

onUnmounted(() => {
  document.removeEventListener("click", onDocClick);
});

function onDocClick(e: MouseEvent) {
  if (mdiPopoverOpen.value && mdiSectionRef.value && !mdiSectionRef.value.contains(e.target as Node)) {
    mdiPopoverOpen.value = false;
  }
}

function handleSend() {
  const cmd = props.mdiText.trim();
  if (cmd) {
    if (history.value[0] !== cmd) {
      history.value.unshift(cmd);
      if (history.value.length > maxHistory) {
        history.value = history.value.slice(0, maxHistory);
      }
    }
    saveMdiHistory(history.value);
  }
  historyIndex.value = -1;
  savedInput.value = "";
  emit("sendMdi");
}

function selectHistory(cmd: string) {
  emit("update:mdiText", cmd);
  mdiPopoverOpen.value = false;
}

function clearHistory() {
  history.value = [];
  saveMdiHistory([]);
  historyIndex.value = -1;
  savedInput.value = "";
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
      :axes="axes"
      :workPos="workPos"
      :machinePos="machinePos"
      :dtg="dtg"
      :g5xLabel="g5xLabel"
      :linearUnit="linearUnit"
      :homed="homed"
      :homedJoints="homedJoints"
      :touchoff="touchoff"
      @update:touchoff="emit('update:touchoff', $event)"
      @setAxis="(axis: number, val: number) => emit('setAxis', axis, val)"
      @setAll="(vals: number[]) => emit('setAll', vals)"
      @setG5x="emit('setG5x', $event)"
      @homeAll="emit('homeAll')"
      @unhomeAll="emit('unhomeAll')"
      @homeAxis="emit('homeAxis', $event)"
      @unhomeAxis="emit('unhomeAxis', $event)"
    />

    <div class="sep"></div>

    <!-- Jog section -->
    <JogPanel
      :axes="axes"
      :jogVel="jogVel"
      :angularJogVel="angularJogVel"
      :isTeleop="isTeleop"
      :isHomed="isHomed"
      :linearUnit="linearUnit"
      :maxJogVel="maxJogVel"
      :maxAngularJogVel="maxAngularJogVel"
      :minAngularJogVel="minAngularJogVel"
      :activeJogKeys="activeJogKeys"
      :jogIncrement="jogIncrement"
      :minJogVel="minJogVel"
      :iniIncrements="iniIncrements"
      @update:jogVel="emit('update:jogVel', $event)"
      @update:angularJogVel="emit('update:angularJogVel', $event)"
      @update:jogIncrement="emit('update:jogIncrement', $event)"
      @toggleTeleop="emit('toggleTeleop')"
    />

    <div class="sep"></div>

    <!-- MDI input bar + history popover -->
    <div class="mdiSection" ref="mdiSectionRef">
      <div class="sub">MDI</div>
      <div class="mdiRow">
        <input
          type="text"
          class="mdiInput"
          :value="mdiText"
          @input="emit('update:mdiText', ($event.target as HTMLInputElement).value)"
          @focus="mdiPopoverOpen = true"
          @keyup.enter="handleSend"
          @keydown="onMdiKeydown"
          :disabled="!can.ready"
          placeholder="G-code command (↑↓ history)"
        />
        <button class="btn" @click="handleSend" :disabled="!can.ready">
          Send
        </button>
      </div>
      <div v-if="mdiPopoverOpen" class="mdiPopover" @click.stop>
        <div class="mdiPopoverHeader">
          <span class="sub">History</span>
          <button class="btn" @click="clearHistory" :disabled="!can.ready || history.length === 0">Clear</button>
        </div>
        <div class="mdiHistoryList scroll-thin">
          <div v-for="(cmd, i) in history" :key="i" class="mdiHistoryItem"
               @click="selectHistory(cmd)">{{ cmd }}</div>
          <div v-if="history.length === 0" class="mdiHistoryEmpty">No history</div>
        </div>
      </div>
    </div>

    <div class="sep"></div>

    <!-- Go-to navigation -->
    <div class="gotoRow">
      <button class="btn" :disabled="!can.ready" @click="emit('goToG30')">Go to G30</button>
      <button class="btn" :disabled="!can.ready" @click="emit('goToHome')">Go to Home</button>
      <button class="btn" :disabled="!can.ready" @click="emit('goToZero')">Go to Zero</button>
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

.mdiSection {
  position: relative;
}

.mdiRow {
  display: flex;
  gap: 10px;
  align-items: center;
}

.mdiInput {
  flex: 1;
  min-width: 0;
}

.mdiPopover {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 4px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
  display: flex;
  flex-direction: column;
  max-height: 300px;
}

.mdiPopoverHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.mdiHistoryList {
  overflow-y: auto;
  flex: 1;
}

.mdiHistoryItem {
  padding: 6px 10px;
  cursor: pointer;
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mdiHistoryItem:hover {
  background: color-mix(in oklab, var(--panel) 90%, var(--fg) 5%);
}

.mdiHistoryEmpty {
  padding: 12px;
  text-align: center;
  opacity: 0.5;
}

.gotoRow {
  display: flex;
  gap: 10px;
}

.gotoRow .btn {
  flex: 1;
}
</style>
