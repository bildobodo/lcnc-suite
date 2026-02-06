<script setup lang="ts">
defineProps<{
  mdiText: string;
  canMdi: boolean;
  busy: boolean;
  lastReply: any;
  status: any;
}>();

const emit = defineEmits<{
  (e: "update:mdiText", text: string): void;
  (e: "send"): void;
}>();
</script>

<template>
  <div>
    <div class="sub">MDI</div>

    <div class="btnrow">
      <input
        class="inp"
        :value="mdiText"
        @input="emit('update:mdiText', ($event.target as HTMLInputElement).value)"
        :disabled="!canMdi || busy"
      />
      <button class="btn" @click="emit('send')" :disabled="!canMdi || busy">
        Send
      </button>
    </div>

    <details style="margin-top: 12px">
      <summary class="sub" style="cursor: pointer">Debug</summary>

      <div class="sub" style="margin-top: 10px">Last reply</div>
      <pre class="pre">{{ lastReply }}</pre>

      <div class="sub" style="margin-top: 10px">Raw status</div>
      <pre class="pre">{{ status }}</pre>
    </details>
  </div>
</template>

<style scoped>
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
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.inp {
  min-width: 260px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #0002;
}

.pre {
  background: #00000006;
  padding: 10px;
  border-radius: 12px;
  overflow: auto;
}
</style>
