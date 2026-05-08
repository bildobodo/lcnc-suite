<script setup lang="ts">
// HALshow viewer — the Settings → HAL sub-tab. Extracted from SettingsPanel.
// Reactive state (halPins/halSignals/halParams/halInitialized) lives in
// lcncWs.ts; the gateway pushes a snapshot on subscribe and 5 Hz value
// deltas while the tab is visible. Subscribe/unsubscribe is driven by the
// `active` prop so we only stream values while the operator is looking
// at this tab — TabPanel uses v-show, so the child is mounted always.
//
// Scoped CSS: only component-private rules. Reusable layout uses the
// `row-tight`/`stack-*` utilities from style.css per project rule.
import { ref, computed, watch, onUnmounted } from "vue";
import { halPins, halSignals, halParams, halInitialized, send, type HalPin, type HalParam } from "./lcncWs";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";

const props = defineProps<{ active: boolean }>();

type HalSection = "pins" | "signals" | "params";

const halSection = ref<HalSection>("pins");
const halSearch = ref("");
const halExpanded = ref(new Set<string>());

let _halSubscribed = false;
function _setHalshowLive(on: boolean) {
  if (on === _halSubscribed) return;
  _halSubscribed = on;
  send({ cmd: "halshow_live", on });
}

watch(() => props.active, (active) => {
  _setHalshowLive(active);
}, { immediate: true });

onUnmounted(() => { _setHalshowLive(false); });

function toggleHalGroup(group: string) {
  const s = halExpanded.value;
  if (s.has(group)) s.delete(group);
  else s.add(group);
  halExpanded.value = new Set(s);
}

function expandAllHal() {
  const items = halSection.value === "params" ? halParams.value : halPins.value;
  const groups = new Set<string>();
  for (const p of items) groups.add(p.name.split(".")[0]!);
  halExpanded.value = groups;
}

function collapseAllHal() {
  halExpanded.value = new Set();
}

function pinGroup(name: string): string {
  const dot = name.indexOf(".");
  return dot > 0 ? name.substring(0, dot) : name;
}

const filteredPins = computed(() => {
  const q = halSearch.value.trim().toLowerCase();
  if (!q) return halPins.value;
  return halPins.value.filter(p =>
    p.name.toLowerCase().includes(q) ||
    (p.signal && p.signal.toLowerCase().includes(q)) ||
    p.value.toLowerCase().includes(q)
  );
});

const pinGroups = computed(() => {
  const groups = new Map<string, HalPin[]>();
  for (const p of filteredPins.value) {
    const g = pinGroup(p.name);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }
  return groups;
});

const filteredSignals = computed(() => {
  const q = halSearch.value.trim().toLowerCase();
  if (!q) return halSignals.value;
  return halSignals.value.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.pins.some(p => p.pin.toLowerCase().includes(q))
  );
});

const filteredParams = computed(() => {
  const q = halSearch.value.trim().toLowerCase();
  if (!q) return halParams.value;
  return halParams.value.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.value.toLowerCase().includes(q)
  );
});

const paramGroups = computed(() => {
  const groups = new Map<string, HalParam[]>();
  for (const p of filteredParams.value) {
    const g = pinGroup(p.name);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }
  return groups;
});

const halStats = computed(() => ({
  pins: halPins.value.length,
  signals: halSignals.value.length,
  params: halParams.value.length,
}));
</script>

<template>
  <div class="halPane">
    <!-- Header: section toggles + search (pinned) -->
    <div class="halHeader">
      <div class="row-tight">
        <MachineBtn type="inline" :selected="halSection === 'pins'" class="optBtn"
                @click="halSection = 'pins'">
          Pins <span class="halCount" v-if="halStats.pins">({{ halStats.pins }})</span>
        </MachineBtn>
        <MachineBtn type="inline" :selected="halSection === 'signals'" class="optBtn"
                @click="halSection = 'signals'">
          Signals <span class="halCount" v-if="halStats.signals">({{ halStats.signals }})</span>
        </MachineBtn>
        <MachineBtn type="inline" :selected="halSection === 'params'" class="optBtn"
                @click="halSection = 'params'">
          Params <span class="halCount" v-if="halStats.params">({{ halStats.params }})</span>
        </MachineBtn>
      </div>
      <div class="row-tight">
        <MachineInput gate="search" type="text" class="halSearchInput" v-model="halSearch" placeholder="Search..." />
      </div>
    </div>

    <!-- Tree controls (pinned) -->
    <div v-if="!halSearch.trim() && ((halSection === 'pins' && halPins.length > 0) || (halSection === 'params' && halParams.length > 0))" class="halTreeControls row-tight">
      <MachineBtn type="inline" class="optBtn" @click="expandAllHal">+ all</MachineBtn>
      <MachineBtn type="inline" class="optBtn" @click="collapseAllHal">- all</MachineBtn>
      <span class="halFilterInfo" v-if="halSection === 'pins' && filteredPins.length !== halPins.length">
        {{ filteredPins.length }} / {{ halPins.length }}
      </span>
    </div>

    <div class="stack-panel scrollContent scroll-thin">
    <!-- Empty state (waiting for first snapshot) -->
    <div v-if="!halInitialized" class="halEmpty">
      Connecting…
    </div>

    <!-- PINS -->
    <div v-if="halSection === 'pins' && halPins.length > 0">

      <!-- Tree view -->
      <template v-if="!halSearch.trim()">
        <div v-for="[group, pins] of pinGroups" :key="group" class="halGroup">
          <MachineBtn type="inline" class="halGroupHeader" @click="toggleHalGroup(group)">
            <span class="halChevron">{{ halExpanded.has(group) ? '▼' : '▶' }}</span>
            <span class="halGroupName">{{ group }}</span>
            <span class="halGroupCount">({{ pins.length }})</span>
          </MachineBtn>
          <div v-if="halExpanded.has(group)" class="halGroupBody">
            <div class="halRow" v-for="pin in pins" :key="pin.name">
              <span class="halName" :title="pin.name">{{ pin.name }}</span>
              <span class="halType">{{ pin.type }}</span>
              <span class="halDir">{{ pin.dir }}</span>
              <span class="halValue" :class="{ halTrue: pin.value === 'TRUE', halFalse: pin.value === 'FALSE' }">{{ pin.value }}</span>
              <span class="halSignal" v-if="pin.signal">{{ pin.arrow }} {{ pin.signal }}</span>
              <span class="halSignal halUnlinked" v-else>unlinked</span>
            </div>
          </div>
        </div>
      </template>

      <!-- Flat filtered list -->
      <template v-else>
        <div class="halFilterInfo">{{ filteredPins.length }} matches</div>
        <div class="halRow" v-for="pin in filteredPins" :key="pin.name">
          <span class="halName" :title="pin.name">{{ pin.name }}</span>
          <span class="halType">{{ pin.type }}</span>
          <span class="halDir">{{ pin.dir }}</span>
          <span class="halValue" :class="{ halTrue: pin.value === 'TRUE', halFalse: pin.value === 'FALSE' }">{{ pin.value }}</span>
          <span class="halSignal" v-if="pin.signal">{{ pin.arrow }} {{ pin.signal }}</span>
          <span class="halSignal halUnlinked" v-else>unlinked</span>
        </div>
      </template>
    </div>

    <!-- SIGNALS -->
    <div v-if="halSection === 'signals' && halSignals.length > 0">
      <div class="halFilterInfo" v-if="halSearch.trim()">{{ filteredSignals.length }} matches</div>
      <div class="halSigRow" v-for="sig in filteredSignals" :key="sig.name">
        <div class="halSigHeader">
          <span class="halSigName">{{ sig.name }}</span>
          <span class="halType">{{ sig.type }}</span>
          <span class="halValue" :class="{ halTrue: sig.value === 'TRUE', halFalse: sig.value === 'FALSE' }">{{ sig.value }}</span>
        </div>
        <div class="halSigPins" v-if="sig.pins.length">
          <span v-for="(p, i) in sig.pins" :key="i" class="halSigPin">{{ p.arrow }} {{ p.pin }}</span>
        </div>
      </div>
    </div>

    <!-- PARAMS -->
    <div v-if="halSection === 'params' && halParams.length > 0">
      <template v-if="!halSearch.trim()">
        <div v-for="[group, params] of paramGroups" :key="group" class="halGroup">
          <MachineBtn type="inline" class="halGroupHeader" @click="toggleHalGroup(group)">
            <span class="halChevron">{{ halExpanded.has(group) ? '▼' : '▶' }}</span>
            <span class="halGroupName">{{ group }}</span>
            <span class="halGroupCount">({{ params.length }})</span>
          </MachineBtn>
          <div v-if="halExpanded.has(group)" class="halGroupBody">
            <div class="halRow" v-for="param in params" :key="param.name">
              <span class="halName" :title="param.name">{{ param.name }}</span>
              <span class="halType">{{ param.type }}</span>
              <span class="halDir">{{ param.dir }}</span>
              <span class="halValue">{{ param.value }}</span>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="halFilterInfo">{{ filteredParams.length }} matches</div>
        <div class="halRow" v-for="param in filteredParams" :key="param.name">
          <span class="halName" :title="param.name">{{ param.name }}</span>
          <span class="halType">{{ param.type }}</span>
          <span class="halDir">{{ param.dir }}</span>
          <span class="halValue">{{ param.value }}</span>
        </div>
      </template>
    </div>
    </div>
  </div>
</template>

<style scoped>
/* Component-specific layouts that don't fit existing utilities (space-between
   with wrap, baseline-aligned rows, etc). Pure visual rules below.
   Reusable patterns (row-tight) come from style.css. */
.halPane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.halHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-controls);
  margin-bottom: var(--gap-section);
  flex-wrap: wrap;
  flex-shrink: 0;
}

.halSearchInput {
  width: 160px;
}

.halEmpty {
  text-align: center;
  opacity: var(--opacity-disabled);
  padding: var(--gap-panel) 0;
}

.halTreeControls {
  margin-bottom: var(--gap-controls);
  flex-shrink: 0;
}

.halCount {
  opacity: var(--opacity-muted);
}

.halFilterInfo {
  opacity: var(--opacity-muted);
  margin-bottom: var(--gap-tight);
}

.halGroup {
  margin-bottom: var(--gap-micro);
}

.halGroupHeader {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--gap-tight);
  padding: var(--gap-tight) 0;
  background: none;
  border: none;
  border-radius: 0;
  width: 100%;
  text-align: left;
  user-select: none;
}

.halGroupHeader:hover {
  opacity: var(--opacity-secondary);
  background: none;
}

.halChevron {
  width: 12px;
  text-align: center;
  flex-shrink: 0;
}

.halGroupName {
  font-weight: var(--fw-semibold);
}

.halGroupCount {
  opacity: var(--opacity-disabled);
}

.halGroupBody {
  padding-left: 18px;
}

.halRow {
  display: flex;
  align-items: baseline;
  gap: var(--gap-controls);
  padding: var(--gap-micro) 0;
}

.halRow:hover {
  background: color-mix(in oklab, var(--fg) 4%, transparent);
}

.halName {
  flex: 2;
  min-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.halType {
  width: 36px;
  flex-shrink: 0;
  opacity: var(--opacity-muted);
}

.halDir {
  width: 24px;
  flex-shrink: 0;
  opacity: var(--opacity-muted);
}

.halValue {
  width: 80px;
  flex-shrink: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.halTrue {
  color: var(--ok);
}

.halFalse {
  opacity: var(--opacity-disabled);
}

.halSignal {
  flex: 1;
  min-width: 60px;
  opacity: var(--opacity-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.halUnlinked {
  opacity: var(--opacity-subtle);
}

.halSigRow {
  padding: var(--gap-tight) 0;
  border-bottom: 1px solid color-mix(in oklab, var(--border) 30%, transparent);
}

.halSigHeader {
  display: flex;
  align-items: baseline;
  gap: var(--gap-controls);
}

.halSigName {
  font-weight: var(--fw-semibold);
  flex: 1;
  min-width: 0;
}

.halSigPins {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-tight) var(--gap-section);
  padding-left: var(--gap-section);
  padding-top: var(--gap-micro);
  opacity: var(--opacity-muted);
}

.halSigPin {
  white-space: nowrap;
}
</style>
