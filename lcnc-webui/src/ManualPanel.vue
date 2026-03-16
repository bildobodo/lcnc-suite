<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from "vue";
import DroPanel from "./DroPanel.vue";
import JogPanel from "./JogPanel.vue";
import { usePermissions } from "./permissions";
import { loadMdiHistory, saveMdiHistory } from "./defaults";

const can = usePermissions();

// ─── Sub-view navigation ──────────────────────────────────────────
const manualView = ref<"dro" | "jogging" | "mdi">("dro");
const g5xOptions = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"];

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
const mdiInputRef = ref<HTMLInputElement | null>(null);

// Re-focus MDI input when it becomes enabled again after a command
watch(() => can.value.ready, (ready, was) => {
  if (ready && !was) nextTick(() => mdiInputRef.value?.focus());
});

onMounted(() => {
  history.value = loadMdiHistory();
});

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

function clearHistory() {
  history.value = [];
  saveMdiHistory([]);
  historyIndex.value = -1;
  savedInput.value = "";
}

function onMdiKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation(); // prevent global jog handler
    if (history.value.length === 0) return;
    if (historyIndex.value === -1) {
      savedInput.value = props.mdiText;
    }
    if (historyIndex.value < history.value.length - 1) {
      historyIndex.value++;
      emit("update:mdiText", history.value[historyIndex.value] ?? "");
    }
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    e.stopPropagation(); // prevent global jog handler
    if (historyIndex.value < 0) return;
    historyIndex.value--;
    if (historyIndex.value === -1) {
      emit("update:mdiText", savedInput.value);
    } else {
      emit("update:mdiText", history.value[historyIndex.value] ?? "");
    }
    return;
  }
}
</script>

<template>
  <div class="manualPanel">
    <!-- Sub-view tabs -->
    <div class="viewTabs">
      <button class="tab-btn" :class="{ active: manualView === 'dro' }" @click="manualView = 'dro'">DRO</button>
      <button class="tab-btn" :class="{ active: manualView === 'jogging' }" @click="manualView = 'jogging'">Jog</button>
      <button class="tab-btn" :class="{ active: manualView === 'mdi' }" @click="manualView = 'mdi'">MDI</button>
    </div>

    <!-- WCS selector -->
    <div class="g5xRow" :class="{ inactive: !can.idle }">
      <button
        v-for="g in g5xOptions"
        :key="g"
        class="g5xBtn"
        :class="{ active: g === g5xLabel }"
        :disabled="!can.idle"
        @click="emit('setG5x', g)"
      >{{ g }}</button>
    </div>

    <!-- ═══ DRO VIEW ═══ -->
    <div v-if="manualView === 'dro'" class="subView scroll-thin">
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
        @homeAll="emit('homeAll')"
        @unhomeAll="emit('unhomeAll')"
        @homeAxis="emit('homeAxis', $event)"
        @unhomeAxis="emit('unhomeAxis', $event)"
      />
      <div class="sep"></div>
      <div class="gotoRow" :class="{ inactive: !can.ready }">
        <button class="btn" :disabled="!can.ready" @click="emit('goToG30')">Go to G30</button>
        <button class="btn" :disabled="!can.ready" @click="emit('goToHome')">Go to Home</button>
        <button class="btn" :disabled="!can.ready" @click="emit('goToZero')">Go to Zero</button>
      </div>
    </div>

    <!-- ═══ JOGGING VIEW ═══ -->
    <div v-if="manualView === 'jogging'" class="subView scroll-thin">
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
    </div>

    <!-- ═══ MDI VIEW ═══ -->
    <div v-if="manualView === 'mdi'" class="mdiSection" :class="{ inactive: !can.ready }">
      <div class="mdiRow">
        <input
          ref="mdiInputRef"
          type="text"
          class="mdiInput"
          :value="mdiText"
          @input="emit('update:mdiText', ($event.target as HTMLInputElement).value)"
          @keyup.enter="handleSend"
          @keydown="onMdiKeydown"
          :disabled="!can.ready"
          placeholder="G-code command (↑↓ history)"
        />
        <button class="btn-inline" @click="handleSend" :disabled="!can.ready">
          Send
        </button>
      </div>
      <div class="mdiHistoryHeader">
        <span class="sub">History</span>
        <button class="btn-inline" @click="clearHistory" :disabled="!can.ready || history.length === 0">Clear</button>
      </div>
      <div class="mdiHistoryList scroll-thin">
        <div v-for="(cmd, i) in history" :key="i" class="mdiHistoryItem"
             :class="{ active: historyIndex === i }"
             @click="emit('update:mdiText', cmd)">{{ cmd }}</div>
        <div v-if="history.length === 0" class="mdiHistoryEmpty">No history</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.manualPanel {
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  height: 100%;
  min-height: 0;
}

.subView {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
}

.mdiSection {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.mdiRow {
  display: flex;
  gap: var(--gap-controls);
  align-items: center;
}

.mdiInput {
  flex: 1;
  min-width: 0;
}

.mdiHistoryHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--gap-controls) 0;
}

.mdiHistoryList {
  overflow-y: auto;
  flex: 1;
}

.mdiHistoryItem {
  padding: 6px 10px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mdiHistoryItem:hover,
.mdiHistoryItem.active {
  background: var(--hl-hover);
}

.mdiHistoryEmpty {
  padding: 12px;
  text-align: center;
  opacity: var(--opacity-muted);
}

.g5xRow {
  display: flex;
  gap: var(--gap-tight);
  flex-wrap: wrap;
}

.gotoRow {
  display: flex;
  gap: var(--gap-controls);
}

.gotoRow .btn {
  flex: 1;
}
</style>
