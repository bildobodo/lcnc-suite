<script setup lang="ts">
import type { LcncMessage } from "./lcncWs";

defineProps<{
  messages: LcncMessage[];
}>();

const emit = defineEmits<{
  (e: "dismiss", id: number): void;
  (e: "clearAll"): void;
}>();

function kindClass(kind: number): string {
  if (kind <= 2) return "error";
  if (kind <= 4) return "info";
  return "display";
}

function kindLabel(kind: number): string {
  if (kind <= 2) return "ERROR";
  if (kind <= 4) return "INFO";
  return "DISPLAY";
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}
</script>

<template>
  <div class="container">
    <div class="headerRow">
      <div class="sub">Messages</div>
      <button
        v-if="messages.length > 0"
        class="clearBtn"
        @click="emit('clearAll')"
      >Clear All</button>
    </div>

    <div v-if="messages.length === 0" class="emptyState">
      No messages
    </div>

    <div v-else class="messageList">
      <div
        v-for="msg in [...messages].reverse()"
        :key="msg.id"
        class="messageItem"
        :class="kindClass(msg.kind)"
      >
        <div class="indicator"></div>
        <div class="msgBody">
          <div class="msgMeta">
            <span class="typeBadge" :class="kindClass(msg.kind)">{{ kindLabel(msg.kind) }}</span>
            <span class="msgTime">{{ formatTime(msg.ts) }}</span>
          </div>
          <div class="msgText">{{ msg.text }}</div>
        </div>
        <button class="dismissBtn" @click="emit('dismiss', msg.id)">&times;</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.headerRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sub {
  font-size: 12px;
  opacity: 0.65;
}

.clearBtn {
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.clearBtn:hover {
  opacity: 0.8;
}

.clearBtn:active {
  transform: scale(0.95);
}

.emptyState {
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
  opacity: 0.4;
}

.messageList {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 600px;
  overflow-y: auto;
}

.messageItem {
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--button-bg);
}

.indicator {
  width: 4px;
  border-radius: 2px;
  flex-shrink: 0;
}

.messageItem.error .indicator {
  background: #b00020;
}

.messageItem.info .indicator {
  background: var(--fg);
  opacity: 0.4;
}

.messageItem.display .indicator {
  background: #22b8cf;
}

.msgBody {
  flex: 1;
  min-width: 0;
}

.msgMeta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.typeBadge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  letter-spacing: 0.5px;
}

.typeBadge.error {
  background: color-mix(in oklab, #b00020 20%, var(--panel));
  color: #e05555;
}

.typeBadge.info {
  background: color-mix(in oklab, var(--fg) 10%, var(--panel));
  color: var(--fg);
  opacity: 0.7;
}

.typeBadge.display {
  background: color-mix(in oklab, #22b8cf 20%, var(--panel));
  color: #22b8cf;
}

.msgTime {
  font-size: 11px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  opacity: 0.5;
}

.msgText {
  font-size: 13px;
  line-height: 1.4;
  word-break: break-word;
}

.dismissBtn {
  align-self: flex-start;
  background: none;
  border: none;
  color: var(--fg);
  opacity: 0.4;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.dismissBtn:hover {
  opacity: 0.8;
  background: color-mix(in oklab, var(--fg) 10%, transparent);
}
</style>
