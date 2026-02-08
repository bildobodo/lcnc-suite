<script setup lang="ts">
defineProps<{
  tabs: Array<{ id: string; label: string }>;
  modelValue: string;
  badges?: Record<string, number>;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", id: string): void;
}>();
</script>

<template>
  <div class="tab-panel">
    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: modelValue === tab.id }"
        @click="emit('update:modelValue', tab.id)"
      >
        {{ tab.label }}
        <span v-if="badges?.[tab.id]" class="badge">{{ badges[tab.id]! > 99 ? '99+' : badges[tab.id] }}</span>
      </button>
    </div>

    <div class="tab-content">
      <template v-for="tab in tabs" :key="tab.id">
        <div v-show="modelValue === tab.id" class="tab-pane">
          <slot :name="tab.id" />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tab-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tab-bar {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.tab-btn {
  padding: 8px 14px;
  border-radius: 10px 10px 4px 4px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
  font-size: 13px;
  opacity: 0.65;
  transition: opacity 0.15s;
}

.tab-btn.active {
  opacity: 1;
  background: var(--panel);
  border-bottom-color: var(--panel);
  font-weight: 650;
}

.tab-btn:hover:not(.active) {
  opacity: 0.85;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  margin-left: 6px;
  border-radius: 9px;
  font-size: 10px;
  font-weight: 700;
  background: #b00020;
  color: #fff;
  line-height: 1;
}

.tab-content {
  flex: 1;
  min-height: 660px;
}

.tab-pane {
  height: 100%;
}
</style>
