<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from "vue";
import Btn from "./Btn.vue";
import Gate from "./Gate.vue";
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
  activeJogActions?: Set<string>;
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
  <div class="stack-sections manualPanel">
    <!-- Sub-view tabs -->
    <div class="row-tight viewTabs" data-gate-exempt>
      <Btn size="sm" muted :selected="manualView === 'dro'" @click="manualView = 'dro'">DRO</Btn>
      <Btn size="sm" muted :selected="manualView === 'jogging'" @click="manualView = 'jogging'">Jog</Btn>
      <Btn size="sm" muted :selected="manualView === 'mdi'" @click="manualView = 'mdi'">MDI</Btn>
    </div>

    <!-- WCS selector -->
    <Gate :allow="can.idle">
      <div class="row-tight g5xRow">
        <Btn
          v-for="g in g5xOptions"
          :key="g"
          size="sm"
          muted
          :selected="g === g5xLabel"
          @click="emit('setG5x', g)"
        >{{ g }}</Btn>
      </div>
    </Gate>

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
      <Gate :allow="can.ready" class="gotoRow">
        <Btn @click="emit('goToG30')">Go to G30</Btn>
        <Btn @click="emit('goToHome')">Go to Home</Btn>
        <Btn @click="emit('goToZero')">Go to Zero</Btn>
      </Gate>
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
        :activeJogActions="activeJogActions"
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
    <Gate v-if="manualView === 'mdi'" :allow="can.ready" class="mdiSection">
      <div class="mdiRow">
        <input
          ref="mdiInputRef"
          type="text"
          class="mdiInput"
          :value="mdiText"
          @input="emit('update:mdiText', ($event.target as HTMLInputElement).value)"
          @keyup.enter="handleSend"
          @keydown="onMdiKeydown"
          placeholder="G-code command (↑↓ history)"
        />
        <Btn inline @click="handleSend">
          Send
        </Btn>
      </div>
      <div class="mdiHistoryHeader">
        <span class="sub">History</span>
        <Btn inline @click="clearHistory" :disabled="history.length === 0">Clear</Btn>
      </div>
      <div class="mdiHistoryList scroll-thin">
        <button v-for="(cmd, i) in history" :key="i" class="mdiHistoryItem"
             :class="{ active: historyIndex === i }"
             @click="emit('update:mdiText', cmd)">{{ cmd }}</button>
        <div v-if="history.length === 0" class="mdiHistoryEmpty">No history</div>
      </div>
    </Gate>
  </div>
</template>

<style scoped>
.manualPanel {
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
  display: block;
  width: 100%;
  text-align: left;
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
  flex-wrap: wrap;
}

.gotoRow {
  display: flex;
  gap: var(--gap-controls);
}

.gotoRow :deep(.b) {
  flex: 1;
}
</style>
