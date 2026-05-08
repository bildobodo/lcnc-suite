<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from "vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
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

// ---- MDI history (up-arrow recall + persistence) ----
// In-memory entries carry a monotonic id so templates can use a stable :key
// when the list is mutated (unshift/slice). Persisted form stays as string[].
interface MdiEntry { id: number; text: string }
let _nextId = 0;
const history = ref<MdiEntry[]>([]);
const historyIndex = ref(-1); // -1 = current input, 0 = most recent, etc.
const savedInput = ref("");   // stash current input when browsing history
const maxHistory = 50;
const mdiInputRef = ref<HTMLInputElement | null>(null);

// Re-focus MDI input when it becomes enabled again after a command
watch(() => can.value.ready, (ready, was) => {
  if (ready && !was) nextTick(() => mdiInputRef.value?.focus());
});

onMounted(() => {
  history.value = loadMdiHistory().map(text => ({ id: _nextId++, text }));
});

function persistHistory() {
  saveMdiHistory(history.value.map(e => e.text));
}

function handleSend() {
  const cmd = props.mdiText.trim();
  if (cmd) {
    if (history.value[0]?.text !== cmd) {
      history.value.unshift({ id: _nextId++, text: cmd });
      if (history.value.length > maxHistory) {
        history.value = history.value.slice(0, maxHistory);
      }
    }
    persistHistory();
  }
  historyIndex.value = -1;
  savedInput.value = "";
  emit("sendMdi");
}

function clearHistory() {
  history.value = [];
  persistHistory();
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
      emit("update:mdiText", history.value[historyIndex.value]?.text ?? "");
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
      emit("update:mdiText", history.value[historyIndex.value]?.text ?? "");
    }
    return;
  }
}
</script>

<template>
  <div class="stack-sections manualPanel">
    <!-- Sub-view tabs -->
    <div class="row-tight viewTabs">
        <MachineBtn type="tab" :selected="manualView === 'dro'" @click="manualView = 'dro'">DRO</MachineBtn>
        <MachineBtn type="tab" :selected="manualView === 'jogging'" @click="manualView = 'jogging'">Jog</MachineBtn>
        <MachineBtn type="tab" :selected="manualView === 'mdi'" @click="manualView = 'mdi'">MDI</MachineBtn>
    </div>

    <!-- WCS selector -->
    <div class="row-tight g5xRow">
      <MachineBtn
        v-for="g in g5xOptions"
        :key="g"
        type="wcs"
        muted
        :selected="g === g5xLabel"
        @click="emit('setG5x', g)"
      >{{ g }}</MachineBtn>
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
      <div class="gotoRow row-controls">
          <MachineBtn type="goTo" @click="emit('goToG30')">Go to G30</MachineBtn>
          <MachineBtn type="goTo" @click="emit('goToHome')">Go to Home</MachineBtn>
          <MachineBtn type="goTo" @click="emit('goToZero')">Go to Zero</MachineBtn>
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
    <div v-if="manualView === 'mdi'" class="mdiSection">
      <div class="row-controls">
        <MachineInput
          gate="mdiText"
          ref="mdiInputRef"
          type="text"
          class="mdiInput"
          :value="mdiText"
          @input="emit('update:mdiText', ($event.target as HTMLInputElement).value)"
          @keyup.enter="handleSend"
          @keydown="onMdiKeydown"
          placeholder="G-code command (↑↓ history)"
        />
        <MachineBtn type="mdi" inline @click="handleSend">
          Send
        </MachineBtn>
      </div>
      <div class="mdiHistoryHeader">
        <span class="sub">History</span>
        <MachineBtn type="inline" @click="clearHistory" :disabled="history.length === 0">Clear</MachineBtn>
      </div>
      <div class="mdiHistoryList scroll-thin">
        <button v-for="(entry, i) in history" :key="entry.id" class="mdiHistoryItem"
             :class="{ active: historyIndex === i }"
             @click="emit('update:mdiText', entry.text)">{{ entry.text }}</button>
        <div v-if="history.length === 0" class="mdiHistoryEmpty">No history</div>
      </div>
    </div>
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
  gap: var(--gap-controls);
}

/* .mdiRow — replaced by row-controls utility (same shape) */

.mdiInput {
  flex: 1;
  min-width: 0;
}

.mdiHistoryHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  padding: var(--gap-section);
  text-align: center;
  opacity: var(--opacity-muted);
}

.g5xRow {
  flex-wrap: wrap;
}

/* .gotoRow layout replaced by row-controls utility on the template element.
   The .gotoRow class is retained as a hook for the :deep(.b) descendant rule
   below — Vue's :deep() needs a real selector to anchor on. */
.gotoRow :deep(.b) {
  flex: 1;
}
</style>
