<script setup lang="ts">
import { computed } from "vue";

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

const totalBadge = computed(() => {
  if (!props.badges) return 0;
  return Object.values(props.badges).reduce((sum, n) => sum + n, 0);
});
</script>

<template>
  <div class="tab-panel">
    <!-- Top bar: tab selector + optional close button -->
    <div class="topBar">
      <div class="tabPill">
        <span class="pillLabel">
          {{ tabs.find(t => t.id === modelValue)?.label || 'Tab' }}
          <span v-if="totalBadge" class="pillBadge">{{ totalBadge > 99 ? '99+' : totalBadge }}</span>
        </span>
        <div class="popover pillPopover">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="tabOption"
            :class="{ active: modelValue === tab.id }"
            @click="emit('update:modelValue', tab.id)"
          >
            {{ tab.label }}
            <span v-if="badges?.[tab.id]" class="badge">{{ badges[tab.id]! > 99 ? '99+' : badges[tab.id] }}</span>
          </button>
        </div>
      </div>
      <button v-if="closable" class="panelClose" @click="emit('close')">&times;</button>
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
  gap: 6px;
  margin-bottom: 6px;
}

.tabPill {
  position: relative;
  min-width: 0;
  cursor: default;
}

.pillLabel {
  display: block;
  padding: 5px 10px;
  font-size: var(--fs-sm);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-radius: var(--radius-lg);
  background: var(--button-bg);
  color: var(--fg);
  border: 1px solid var(--border);
  user-select: none;
  opacity: 0.75;
}

.tabPill:hover > .pillLabel {
  opacity: 1;
  background: var(--panel);
}

/* ---- Popover (opens downward) ---- */
.pillPopover {
  top: 100%;
  left: 0;
  padding: 14px 8px 8px 8px;
  flex-direction: column;
  gap: 2px;
}

.tabPill:hover > .pillPopover {
  display: flex;
}

/* ---- Tab options ---- */
.tabOption {
  padding: 6px 10px;
  font-size: var(--fs-base);
  border-radius: var(--radius-md);
  white-space: nowrap;
  text-align: left;
}

.tabOption.active {
  background: color-mix(in oklab, var(--fg) 15%, var(--button-bg));
  font-weight: 600;
}

/* ---- Close button ---- */
.panelClose {
  flex-shrink: 0;
  padding: 5px 10px;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--danger) 50%, transparent);
  background: color-mix(in oklab, var(--danger) 25%, var(--button-bg));
  color: var(--fg);
  font-size: var(--fs-lg);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
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
.pillBadge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  margin-left: 5px;
  border-radius: var(--radius-xl);
  font-size: var(--fs-2xs);
  font-weight: 700;
  background: var(--err);
  color: #fff;
  line-height: 1;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  margin-left: 6px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  font-weight: 700;
  background: var(--err);
  color: #fff;
  line-height: 1;
}
</style>
