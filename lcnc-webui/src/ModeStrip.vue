<script setup lang="ts">
import { ref, computed } from "vue";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineSlider from "./MachineSlider.vue";
import MachineToggle from "./MachineToggle.vue";
import JogHUD from "./JogHUD.vue";

type StripMode = "jog" | "mdi" | "program";
const mode = ref<StripMode>("jog");

const props = defineProps<{
  axes: string[];
  jogVel: number;
  angularJogVel: number;
  linearUnit: string;
  maxJogVel: number;
  maxAngularJogVel: number;
  minAngularJogVel: number;
  jogIncrement: number;
  minJogVel: number;
  iniIncrements: number[] | null;
  isTeleop: boolean;
  isHomed: boolean;
  jogDisabled: boolean;
  mdiText: string;
  activeFile: string | null;
  isPaused: boolean;
  isRunning: boolean;
  elapsed: string;
  optionalStop: boolean;
  blockDelete: boolean;
}>();

const emit = defineEmits<{
  (e: "update:jogVel", v: number): void;
  (e: "update:angularJogVel", v: number): void;
  (e: "update:jogIncrement", v: number): void;
  (e: "toggleTeleop"): void;
  (e: "homeAll"): void;
  (e: "unhomeAll"): void;
  (e: "update:mdiText", text: string): void;
  (e: "sendMdi"): void;
  (e: "cycleStart"): void;
  (e: "cyclePause"): void;
  (e: "cycleResume"): void;
  (e: "cycleStep"): void;
  (e: "abort"): void;
  (e: "toggleOptionalStop"): void;
  (e: "toggleBlockDelete"): void;
}>();

// ─── MDI History ─────────────────────────────────────────────
const history = ref<string[]>([]);
const historyIndex = ref(-1);
const savedInput = ref("");

function handleSend() {
  const cmd = props.mdiText.trim();
  if (cmd) {
    if (history.value[0] !== cmd) {
      history.value.unshift(cmd);
      if (history.value.length > 50) history.value.length = 50;
    }
  }
  historyIndex.value = -1;
  savedInput.value = "";
  emit("sendMdi");
}

function onMdiKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (history.value.length === 0) return;
    if (historyIndex.value === -1) savedInput.value = props.mdiText;
    if (historyIndex.value < history.value.length - 1) {
      historyIndex.value++;
      emit("update:mdiText", history.value[historyIndex.value] ?? "");
    }
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (historyIndex.value === -1) return;
    historyIndex.value--;
    emit("update:mdiText", historyIndex.value === -1 ? savedInput.value : (history.value[historyIndex.value] ?? ""));
    return;
  }
}

function clearHistory() { history.value = []; historyIndex.value = -1; }

const fileName = computed(() => {
  if (!props.activeFile) return "No file loaded";
  const parts = props.activeFile.split("/");
  return parts[parts.length - 1] ?? props.activeFile;
});

const hasFile = computed(() => !!props.activeFile);
</script>

<template>
  <div class="modeStrip">
    <!-- Mode tabs -->
    <div class="modeTabs">
      <button class="modeTab" :class="{ active: mode === 'jog' }" @click="mode = 'jog'">Jog</button>
      <button class="modeTab" :class="{ active: mode === 'mdi' }" @click="mode = 'mdi'">MDI</button>
      <button class="modeTab" :class="{ active: mode === 'program' }" @click="mode = 'program'">Program</button>
    </div>

    <!-- ═══ JOG VIEW ═══ -->
    <div v-show="mode === 'jog'" class="modeContent">
      <div class="jogLayout">
        <!-- Jog wheel + Z (takes available height) -->
        <div class="jogWheelArea">
          <JogHUD
            :axes="axes"
            :jogVel="jogVel"
            :angularJogVel="angularJogVel"
            :linearUnit="linearUnit"
            :maxJogVel="maxJogVel"
            :maxAngularJogVel="maxAngularJogVel"
            :minAngularJogVel="minAngularJogVel"
            :jogIncrement="jogIncrement"
            :minJogVel="minJogVel"
            :iniIncrements="iniIncrements"
            :isTeleop="isTeleop"
            :isHomed="isHomed"
            :disabled="jogDisabled"
            @update:jogVel="emit('update:jogVel', $event)"
            @update:angularJogVel="emit('update:angularJogVel', $event)"
            @update:jogIncrement="emit('update:jogIncrement', $event)"
            @toggleTeleop="emit('toggleTeleop')"
          />
        </div>
      </div>
    </div>

    <!-- ═══ MDI VIEW ═══ -->
    <div v-show="mode === 'mdi'" class="modeContent">
      <Gate gate="ready" class="mdiLayout">
        <div class="mdiHistoryList scroll-thin">
          <button v-for="(cmd, i) in history" :key="i" class="mdiHistoryItem"
               :class="{ active: historyIndex === i }"
               @click="emit('update:mdiText', cmd)">{{ cmd }}</button>
          <div v-if="history.length === 0" class="mdiHistoryEmpty">Type a G-code command below</div>
        </div>
        <div class="mdiBottom">
          <div class="mdiRow">
            <MachineInput
              gate="mdiText"
              type="text"
              class="mdiInput"
              :value="mdiText"
              @input="emit('update:mdiText', ($event.target as HTMLInputElement).value)"
              @keyup.enter="handleSend"
              @keydown="onMdiKeydown"
              placeholder="G-code command..."
            />
            <MachineBtn type="mdi" @click="handleSend">Send</MachineBtn>
            <MachineBtn type="inline" @click="clearHistory" :disabled="history.length === 0">Clear</MachineBtn>
          </div>
        </div>
      </Gate>
    </div>

    <!-- ═══ PROGRAM VIEW ═══ -->
    <div v-show="mode === 'program'" class="modeContent">
      <Gate gate="safety" class="prgLayout">
        <div class="prgFileRow">
          <span class="prgFile" :title="activeFile ?? ''">{{ fileName }}</span>
          <span v-if="hasFile" class="prgElapsed">{{ elapsed }}</span>
        </div>

        <div class="prgBtns">
          <MachineBtn type="start" @click="emit('cycleStart')" :disabled="!hasFile" block>Start</MachineBtn>
          <MachineBtn type="step" @click="emit('cycleStep')" :disabled="!hasFile" block>Step</MachineBtn>
          <MachineBtn
            :type="isPaused ? 'resume' : 'pause'"
            @click="isPaused ? emit('cycleResume') : emit('cyclePause')"
            :disabled="!isRunning && !isPaused"
            block
          >{{ isPaused ? 'Resume' : 'Pause' }}</MachineBtn>
          <MachineBtn type="abort" @click="emit('abort')" block>Stop</MachineBtn>
        </div>

        <div class="prgToggles">
          <MachineToggle gate="optionalStop" :modelValue="optionalStop" @update:modelValue="emit('toggleOptionalStop')" label="Opt Stop" />
          <MachineToggle gate="blockDelete" :modelValue="blockDelete" @update:modelValue="emit('toggleBlockDelete')" label="Blk Del" />
        </div>

        <div v-if="!isHomed" class="prgHome">
          <MachineBtn type="home" @click="emit('homeAll')" block>Home All Axes</MachineBtn>
        </div>
      </Gate>
    </div>
  </div>
</template>

<style scoped>
.modeStrip {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ── Mode tabs (full width, edge-to-edge) ── */
.modeTabs {
  display: flex;
  flex-shrink: 0;
  background: color-mix(in oklab, var(--bg) 80%, transparent);
}
.modeTab {
  flex: 1;
  padding: var(--gap-controls) var(--gap-section);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-weight: var(--fw-bold);
  border: none;
  background: none;
  color: var(--fg);
  opacity: var(--opacity-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: opacity 0.1s, border-color 0.1s;
}
.modeTab:hover {
  opacity: 0.8;
}
.modeTab.active {
  opacity: 1;
  color: var(--accent);
  border-bottom-color: var(--accent);
  background: color-mix(in oklab, var(--accent) 5%, transparent);
}

/* ── Content area ── */
.modeContent {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ── Jog ── */
.jogLayout {
  height: 100%;
  display: flex;
}
.jogWheelArea {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--gap-controls);
}

/* ── MDI ── */
.mdiLayout {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.mdiHistoryList {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding: var(--gap-tight);
}
.mdiHistoryItem {
  display: block;
  width: 100%;
  text-align: left;
  padding: var(--gap-tight) var(--gap-controls);
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.mdiHistoryItem:hover,
.mdiHistoryItem.active {
  background: color-mix(in oklab, var(--fg) var(--hl-hover), transparent);
}
.mdiHistoryEmpty {
  padding: var(--gap-panel);
  text-align: center;
  opacity: var(--opacity-muted);
  font-size: var(--fs-sm);
}
.mdiBottom {
  flex-shrink: 0;
  padding: var(--gap-controls);
  border-top: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
}
.mdiRow {
  display: flex;
  gap: var(--gap-tight);
}
.mdiInput {
  flex: 1;
  font-family: var(--font-mono);
}

/* ── Program ── */
.prgLayout {
  display: flex;
  flex-direction: column;
  gap: var(--gap-controls);
  padding: var(--gap-controls);
}
.prgFileRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-controls);
  padding: var(--gap-tight) var(--gap-controls);
  background: color-mix(in oklab, var(--bg) 80%, transparent);
  border-radius: var(--radius-lg);
}
.prgFile {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.prgElapsed {
  font-family: var(--font-mono);
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  flex-shrink: 0;
}
.prgBtns {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--gap-tight);
}
.prgToggles {
  display: flex;
  gap: var(--gap-section);
}
.prgHome {
  margin-top: var(--gap-tight);
}
</style>
