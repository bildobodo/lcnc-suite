<script setup lang="ts">
import { ref, watch } from "vue";
import { usePermissions } from "./permissions";

const props = defineProps<{
  mdiText: string;
}>();

const can = usePermissions();

const emit = defineEmits<{
  (e: "update:mdiText", text: string): void;
  (e: "send"): void;
}>();

// MDI command history (most recent first)
const history = ref<string[]>([]);
const maxHistory = 20;

// Track when send is clicked to add to history
function handleSend() {
  const cmd = props.mdiText.trim();
  if (cmd) {
    // Add to history if not a duplicate of the most recent
    if (history.value[0] !== cmd) {
      history.value.unshift(cmd);
      // Keep only last N commands
      if (history.value.length > maxHistory) {
        history.value = history.value.slice(0, maxHistory);
      }
    }
  }
  emit("send");
}

// Load command from history
function loadFromHistory(cmd: string) {
  emit("update:mdiText", cmd);
}
</script>

<template>
  <div class="mdiContainer">
    <div class="sub">MDI</div>

    <!-- MDI input -->
    <div class="btnrow">
      <input
        class="inp"
        :value="mdiText"
        @input="emit('update:mdiText', ($event.target as HTMLInputElement).value)"
        @keyup.enter="handleSend"
        :disabled="!can.ready"
        placeholder="Enter G-code command..."
      />
      <button class="btn" @click="handleSend" :disabled="!can.ready">
        Send
      </button>
    </div>

    <!-- History section -->
    <div class="historySection">
      <div class="separator"></div>
      <div class="historyLabel">Command History</div>
      <div class="historyList">
        <button
          v-for="(cmd, index) in history"
          :key="index"
          class="historyItem"
          @click="loadFromHistory(cmd)"
          :title="cmd"
        >
          {{ cmd }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mdiContainer {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sub {
  font-size: 12px;
  opacity: 0.65;
  margin-bottom: 8px;
}

.btnrow {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.btn {
  padding: 10px 12px;
  border-radius: 12px;
}

.inp {
  flex: 1;
  min-width: 260px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
}

.inp:focus {
  outline: none;
  border-color: color-mix(in oklab, var(--fg) 40%, var(--border));
}

.pre {
  background: color-mix(in oklab, var(--panel) 50%, transparent);
  padding: 10px;
  border-radius: 12px;
  overflow: auto;
  font-size: 11px;
}

.separator {
  height: 1px;
  background: var(--border);
  opacity: 0.3;
  margin: 12px 0;
}

.historySection {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.historyLabel {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.historyList {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.historyList::-webkit-scrollbar {
  width: 8px;
}

.historyList::-webkit-scrollbar-track {
  background: transparent;
}

.historyList::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

.historyList::-webkit-scrollbar-thumb:hover {
  background: color-mix(in oklab, var(--border) 80%, var(--fg));
}

.historyItem {
  padding: 8px 12px;
  font-size: 12px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
  min-height: 32px;
  display: flex;
  align-items: center;
}

.historyItem:hover {
  background: color-mix(in oklab, var(--button-bg) 85%, var(--fg));
  transform: translateX(2px);
}

.historyItem:active {
  transform: scale(0.98);
}
</style>
