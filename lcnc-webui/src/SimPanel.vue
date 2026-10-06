<script setup lang="ts">
// The Simulation tab (operator 2026-10-05, variant A of the renders): the
// collision check with its progress, and ONE list of the timeline's marks —
// × collision, ▲ soft limit, ● tool change — with what happened, the move
// and where on the timeline. A row shows its finding (the simulation, with
// the machine off); ‹ › step through the shown kind. The list and its
// actions are the scrub bar's own (simPanelStore.ts): the marks, the rows and
// prev/next are one navigation. During a run the list marks the next event.
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { ChevronLeft, ChevronRight, Circle, Triangle, X } from "lucide-vue-next";
import MachineBtn from "./MachineBtn.vue";
import MachineSelect from "./MachineSelect.vue";
import HelpIcon from "./HelpIcon.vue";
import { vStickyHead } from "./stickyHead";
import { usePermissions } from "./permissions";
import { explainAt } from "./gateExplain";
import { fmtPct } from "./format";
import { cssZoomOf } from "./helpPlacement";
import { glideAt, planGlide, visibleBand, type Glide } from "./codeGlide";
import { SIM_SPEEDS, simJump, simRows, simStep, simView } from "./simPanelStore";
import type { SimRow, SimRowKind } from "./viewer/simRows";

const can = usePermissions();

type Filter = "all" | SimRowKind;
const filter = ref<Filter>("all");
const KINDS: Record<Filter, readonly SimRowKind[]> = { all: ["clash", "limit", "tool"], clash: ["clash"], limit: ["limit"], tool: ["tool"] };
const count = (k: SimRowKind) => simRows.value.filter(r => r.kind === k).length;
const filterOptions = computed(() => [
  { value: "all", label: `All (${simRows.value.length})` },
  { value: "clash", label: `Collisions (${count("clash")})` },
  { value: "limit", label: `Limit violations (${count("limit")})` },
  { value: "tool", label: `Tool changes (${count("tool")})` },
]);
const rows = computed(() => simRows.value.filter(r => KINDS[filter.value].includes(r.kind)));
/** The step buttons are named for what they step through. */
const NAV: Record<Filter, [string, string]> = {
  all: ["Previous on the timeline", "Next on the timeline"],
  clash: ["Previous collision", "Next collision"],
  limit: ["Previous limit violation", "Next limit violation"],
  tool: ["Previous tool change", "Next tool change"],
};
const stepReason = computed(() => !rows.value.length ? "Nothing of this kind on the timeline" : simView.jumpReason);

const speed = computed({
  get: () => String(simView.speed),
  set: (v: string) => { simView.speed = Number(v); },
});

/** The row that is shown, else the next one ahead of the position. */
const shown = (r: SimRow) => r.key === simView.shownKey;
const isNext = (r: SimRow) => !simView.shownKey && r.key === simView.nextKey;

// ── The rows: a tap shows the finding; the keyboard's way is the row's line
// (ONE Tab stop — the shown row, else the next, else the first): Enter /
// Space show it, Up / Down / Home / End move the focus. EVERY navigation key
// is default-prevented, with a modifier too — one that reached the shortcut
// map would jog (the TabNav rule).
const root = ref<HTMLElement | null>(null);
const rowStop = computed(() => {
  const keys = rows.value.map(r => r.key);
  return [simView.shownKey, simView.nextKey].find(k => k && keys.includes(k)) ?? keys[0] ?? null;
});
const NAV_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];
function pickEl(key: string): HTMLElement | null {
  return root.value?.querySelector<HTMLElement>(`[data-sim-row="${CSS.escape(key)}"] .rowPick`) ?? null;
}
function show(r: SimRow, at: Event | HTMLElement) {
  if (!can.value.armed) return;
  if (simView.jumpReason) { explainAt(at, simView.jumpReason); return; }
  simJump(r.key);
}
function onPickKey(e: KeyboardEvent, r: SimRow) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    show(r, e.currentTarget as HTMLElement);
    return;
  }
  if (!NAV_KEYS.includes(e.key)) return;
  e.preventDefault();
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const keys = rows.value.map(x => x.key);
  const i = keys.indexOf(r.key), n = keys.length;
  const to = e.key === "ArrowDown" ? keys[Math.min(i + 1, n - 1)]
    : e.key === "ArrowUp" ? keys[Math.max(i - 1, 0)]
    : e.key === "Home" ? keys[0] : e.key === "End" ? keys[n - 1] : null;
  if (to) void nextTick(() => pickEl(to)?.focus());
}
const rowName = (r: SimRow) => `Show ${r.lineLabel}: ${r.what}`;

// ── The panel OWNS the focus it holds (Codex R78 VP-I37): a new result, the
// entry merge or a parked sweep replaces the rows, and a focused row — or a
// step button re-rendered with its reason — left the DOM under the focus.
// The focus fell to BODY and the next arrow jogged. Before every change of
// what the panel renders, note where the focus is; after it, a focus that
// fell out of the panel goes to the same row, the same control, the row now
// at its place, the list filter, else the panel itself — which keeps the
// navigation keys (onRootKey).
const renders = () => [rows.value, simView.available, simView.jumpReason, stepReason.value] as const;
let held: { key: string | null; label: string | null; index: number } | null = null;
watch(renders, (_now, before) => {
  const r = root.value, a = document.activeElement as HTMLElement | null;
  if (!r || !a || !r.contains(a)) { held = null; return; }
  const key = a.closest<HTMLElement>("[data-sim-row]")?.dataset.simRow ?? null;
  const old = (before?.[0] ?? []) as readonly SimRow[];
  held = { key, label: key ? null : a.getAttribute("aria-label"), index: key ? old.findIndex(x => x.key === key) : -1 };
}, { flush: "pre" });
watch(renders, () => {
  const h = held, r = root.value;
  held = null;
  if (!h || !r || r.contains(document.activeElement)) return;
  const keys = rows.value.map(x => x.key);
  const tries: (HTMLElement | null)[] = [];
  if (h.key && keys.includes(h.key)) tries.push(pickEl(h.key));
  if (h.label) tries.push(r.querySelector<HTMLElement>(`[aria-label="${CSS.escape(h.label)}"]`));
  if (keys.length && h.index >= 0) tries.push(pickEl(keys[Math.min(h.index, keys.length - 1)]!));
  tries.push(r.querySelector<HTMLElement>('select[name="simFilter"]'), r);
  for (const el of tries) {
    el?.focus();
    if (el && document.activeElement === el) return;
  }
}, { flush: "post" });
// ── The list FOLLOWS the position (operator 2026-10-06: "like the code
// panel when the program runs"): the marked row — the shown finding, else
// the next one ahead — stands in the middle of the list's view while the
// simulation scrubs or plays and while a program runs. It glides the code
// panel's way (codeGlide.ts): each new target over the time since the last
// one (30–150 ms), from a start held in the row's VISIBLE BAND — a row that
// left the view comes back at once, the rest glides. A browser smooth
// scroll restarted per row fell behind at ×100 playback and the marked row
// sat below the view for 1.5 s (Codex R81 VP-I41). A far jump and reduced
// motion snap; the list moves, never the focus; a list that fits stays.
const scroller = ref<HTMLElement | null>(null);
const marked = computed(() => rows.value.find(r => shown(r) || isNext(r))?.key ?? null);
const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
let glide: Glide | null = null;
let glideRaf = 0;
let lastTargetAt = -Infinity;
function glideStep() {
  const sc = scroller.value, g = glide;
  if (!sc || !g) return;
  const { pos, done } = glideAt(g, performance.now());
  sc.scrollTop = pos;
  if (done) glide = null;
  else glideRaf = requestAnimationFrame(glideStep);
}
function follow(animate: boolean) {
  const sc = scroller.value, key = marked.value;
  if (!sc || !key || !sc.clientHeight) return;
  const tr = sc.querySelector<HTMLElement>(`tr[data-sim-row="${CSS.escape(key)}"]`);
  if (!tr) return;
  // In the list's own px: the row's place in the scrolled content; the view
  // is what the sticky head leaves.
  const head = sc.querySelector<HTMLElement>("thead")?.offsetHeight ?? 0;
  const rowY = (tr.getBoundingClientRect().top - sc.getBoundingClientRect().top) / cssZoomOf(sc) + sc.scrollTop - head;
  const lineH = tr.offsetHeight, viewH = sc.clientHeight - head;
  const max = Math.max(0, sc.scrollHeight - sc.clientHeight);
  const clamp = (y: number) => Math.max(0, Math.min(max, y));
  const to = clamp(rowY - (viewH - lineH) / 2);
  const now = performance.now(), gap = now - lastTargetAt;
  lastTargetAt = now;
  cancelAnimationFrame(glideRaf);
  glide = null;
  const plan = animate ? planGlide(sc.scrollTop, to, now, gap, viewH, reduceMotion(), visibleBand(rowY, lineH, viewH, clamp)) : null;
  if (!plan) { sc.scrollTop = to; return; }
  sc.scrollTop = plan.from;   // into the band at once — the row is in view from here on
  glide = plan;
  glideRaf = requestAnimationFrame(glideStep);
}
watch([marked, rows], () => follow(true), { flush: "post" });
// A hidden tab has no height: it catches up when it shows (or resizes).
const sized = typeof ResizeObserver === "function" ? new ResizeObserver(() => follow(false)) : null;
watch(scroller, (el, old) => {
  if (old) sized?.unobserve(old);
  if (el) sized?.observe(el);
});
onUnmounted(() => { sized?.disconnect(); cancelAnimationFrame(glideRaf); });

/** The panel itself, holding a parked focus, keeps the navigation keys —
 *  one that reached the shortcut map would jog. */
function onRootKey(e: KeyboardEvent) {
  if (e.target === root.value && NAV_KEYS.includes(e.key)) e.preventDefault();
}
</script>

<template>
  <div ref="root" class="simPanel stack-controls" tabindex="-1" @keydown="onRootKey">
    <div v-if="!simView.available" class="emptyState">Load a program to simulate it.</div>
    <template v-else>
      <!-- ONE row: the speed and where the simulation (or the run) stands.
           Sim and play stay on the viewer's bar. -->
      <div class="simHead row-controls denseArea">
        <span class="label-muted">Speed</span>
        <MachineSelect gate="simSpeed" v-model="speed" name="simSpeed" aria-label="Playback speed" class="speedSelect">
          <option v-for="v in SIM_SPEEDS" :key="v" v-memo="[v]" :value="String(v)">×{{ v }}</option>
        </MachineSelect>
        <span class="simWhere mono" :title="simView.lineTitle">
          <span class="simLine" :class="{ 'text-warn': simView.lineOffPath }">{{ simView.line }}</span><template v-if="simView.line"> · </template><span class="simTime">{{ simView.time }}</span>
        </span>
      </div>

      <!-- The collision check: how far, what it found, the details in "?" -->
      <div class="checkRow row-controls">
        <span class="sub">Collision check</span>
        <template v-if="simView.sweep">
          <div class="progressTrack" role="progressbar" aria-label="Collision check progress"
               :aria-valuenow="Math.round(simView.sweep.frac * 100)" aria-valuemin="0" aria-valuemax="100">
            <div class="progressFill" :style="{ width: `${simView.sweep.frac * 100}%` }"></div>
          </div>
          <span class="mono checkPct">{{ fmtPct(simView.sweep.frac) }}</span>
        </template>
        <span v-else class="text-muted">Not checked</span>
        <HelpIcon label="Collision check">{{ simView.sweep?.detail || "Tool and machine parts checked against each other along the program." }}</HelpIcon>
      </div>
      <div v-if="simView.sweep" class="checkVerdict" :class="`text-${simView.sweep.tone}`">
        {{ simView.sweep.verdict }}<span v-if="simView.sweep.caveat" class="text-warn" title="Not certified — see the collision check help"> *</span>
      </div>

      <!-- The list's head: what it shows, and the steps through it -->
      <div class="listHead row-controls denseArea">
        <MachineSelect gate="filter" v-model="filter" name="simFilter" aria-label="Show on the list" class="filterSelect">
          <option v-for="o in filterOptions" :key="o.value" v-memo="[o.label]" :value="o.value">{{ o.label }}</option>
        </MachineSelect>
        <MachineBtn type="scrub" :aria-label="NAV[filter][0]" :title="NAV[filter][0]"
                    :disabled="!!stepReason" :reason="stepReason" @click="simStep(KINDS[filter], -1)"><ChevronLeft :size="14" /></MachineBtn>
        <MachineBtn type="scrub" :aria-label="NAV[filter][1]" :title="NAV[filter][1]"
                    :disabled="!!stepReason" :reason="stepReason" @click="simStep(KINDS[filter], 1)"><ChevronRight :size="14" /></MachineBtn>
        <HelpIcon label="Timeline list">One row per mark on the timeline: × collision, ▲ soft limit (offsets as parsed), ● tool change.</HelpIcon>
      </div>

      <div v-if="!rows.length" class="emptyState">{{ simRows.length ? "None of this kind." : "No collisions, limit violations or tool changes." }}</div>
      <div v-else ref="scroller" v-sticky-head class="simTable dataTable scroll-thin fade-scroll" :class="{ locked: !can.armed }">
        <table>
          <thead>
            <tr><th class="colKind" aria-label="Kind"></th><th class="colLine">Line</th><th class="colWhat">What</th><th class="colMove">Move</th><th class="colAt">Time</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.key" :data-sim-row="r.key"
                :class="{ shownRow: shown(r), nextRow: isNext(r) }" @click="show(r, $event)">
              <td class="colKind" :class="r.kind">
                <X v-if="r.kind === 'clash'" :size="12" :stroke-width="3" aria-hidden="true" />
                <Triangle v-else-if="r.kind === 'limit'" :size="11" fill="currentColor" aria-hidden="true" />
                <Circle v-else :size="10" fill="currentColor" aria-hidden="true" />
              </td>
              <td class="colLine mono">
                <span class="rowPick" role="button" :aria-label="rowName(r)" :aria-current="shown(r) ? 'true' : undefined"
                      :tabindex="rowStop === r.key ? 0 : -1" @keydown="onPickKey($event, r)">{{ r.lineLabel }}</span>
              </td>
              <td class="colWhat" :title="r.note ? `${r.what} · ${r.note}` : r.what">
                <span class="whatText">{{ r.what }}</span><span v-if="r.note" class="text-muted"> · {{ r.note }}</span><span v-if="r.rapid != null" class="moveInline text-muted"> · {{ r.rapid ? "Rapid" : "Feed" }}</span>
              </td>
              <td class="colMove" :class="r.rapid ? 'text-warn' : 'text-muted'">{{ r.rapid == null ? "" : r.rapid ? "Rapid" : "Feed" }}</td>
              <td class="colAt mono text-muted">{{ r.at }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Layout only — the table, the fields and the progress bar are global. */
.simPanel { height: 100%; min-height: 0; }
.simHead, .checkRow, .listHead { align-items: center; flex-shrink: 0; }
.speedSelect { width: auto; }
.simWhere { margin-left: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.checkRow .progressTrack { min-width: 48px; }
.checkPct { white-space: nowrap; }
.checkVerdict { flex-shrink: 0; }
.filterSelect { flex: 1; min-width: 0; }
.simTable { flex: 1; min-height: 0; overflow: auto; }
tbody tr { cursor: pointer; }
.locked tbody tr { cursor: default; }
/* The shown finding: the selection tint and a bar; the next one ahead (no
   finding shown — a run's look-ahead): the bar alone. */
.shownRow { background: var(--hl-selected); }
.shownRow td { background: inherit; }
.shownRow td:first-child,
.nextRow td:first-child { box-shadow: inset 3px 0 0 var(--info); }
.colKind { width: 1%; text-align: center; }
.colKind.clash { color: var(--danger-text); }
.colKind.limit { color: var(--warn-text); }
.colKind.tool { color: var(--info-text); }
.colLine, .colMove, .colAt { width: 1%; white-space: nowrap; }
.rowPick { display: block; }
/* What takes what the rest leaves and stays ONE line (the whole text in its
   title): every row one height. */
.colWhat { width: 100%; max-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.moveInline { display: none; }
/* The narrow side pane (one threshold — .sidePane.narrow): the Move column
   joins the What text. */
.sidePane.narrow .colMove { display: none; }
.sidePane.narrow .moveInline { display: inline; }
</style>
