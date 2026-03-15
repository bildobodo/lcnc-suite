<script setup lang="ts">
const props = defineProps<{
  tabs: Array<{ id: string; label: string }>;
  modelValue: string;
  badges?: Record<string, number>;
  closable?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", id: string): void;
  (e: "close"): void;
}>();
</script>

<template>
  <div class="tab-panel">
    <div class="topBar">
      <div class="tabRow">
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
      <button v-if="closable" class="btn-icon" @click="emit('close')">&times;</button>
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
  flex: 1;
  min-height: 0;
}

/* ---- Top bar row ---- */
.topBar {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  margin-bottom: var(--gap-tight);
}

.tabRow {
  display: flex;
  gap: var(--gap-tight);
  flex: 1;
  min-width: 0;
}

/* ---- Content ---- */
.tab-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.tab-pane {
  height: 100%;
}

/* ---- Badges ---- */
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  margin-left: var(--gap-tight);
  border-radius: var(--radius-xl);
  font-size: var(--fs-2xs);
  font-weight: 700;
  background: var(--err);
  color: #fff;
  line-height: 1;
}
</style>
