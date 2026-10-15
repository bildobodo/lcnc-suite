<script setup lang="ts">
// The Simulation tab (operator 2026-10-05, variant A of the renders): the
// collision check with its progress, and ONE list of the timeline's marks —
// × collision, ▲ soft limit, ● tool change — with what happened, the move
// and where on the timeline. A row shows its finding (the simulation, with
// the machine off); ‹ › step through the shown kind. The list and its
// actions are the scrub bar's own (simPanelStore.ts): the marks, the rows and
// prev/next are one navigation. During a run the list marks the next event.
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { ChevronLeft, ChevronRight, Circle, ClipboardList, Triangle, X } from "lucide-vue-next";
import MachineBtn from "./MachineBtn.vue";
import MachineSelect from "./MachineSelect.vue";
import HelpIcon from "./HelpIcon.vue";
import DetailsPopover from "./DetailsPopover.vue";
import { vStickyHead } from "./stickyHead";
import { usePermissions } from "./permissions";
import { explainAt } from "./gateExplain";
import { fmtPct, NO_VALUE } from "./format";
import { cssZoomOf } from "./helpPlacement";
import { glideAt, planGlide, visibleBand, type Glide } from "./codeGlide";
import { SIM_FILTER_KINDS, SIM_SPEEDS, simJump, simRows, simStep, simView, type SimFilter } from "./simPanelStore";
import type { SimRow, SimRowKind } from "./viewer/simRows";

const can = usePermissions();
/** The card before any check (step 4 plan 1c). */
const NO_CHECK = "No check has run on this program yet.";

// The filter is the bar's too: it builds the list's window of these kinds
// (plan 4.4 — the list shows at most a window, the counts every target).
type Filter = SimFilter;
const filter = computed<Filter>({ get: () => simView.filter, set: f => { simView.filter = f; } });
const KINDS = SIM_FILTER_KINDS;
const count = (k: SimRowKind) => simView.counts[k];
const total = computed(() => count("clash") + count("limit") + count("tool"));
const filterOptions = computed(() => [
  { value: "all", label: `All (${total.value})` },
  { value: "clash", label: `Collisions (${count("clash")})` },
  { value: "limit", label: `Limit violations (${count("limit")})` },
  { value: "tool", label: `Tool changes (${count("tool")})` },
]);
/** The window's rows (the filter's kinds): the bar builds it. */
const rows = computed(() => simRows.value);
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

// ── ONE summary line, always there (operator 2026-10-06): the collision
// verdict came in with the check's result — and left with every re-check —
// and moved the filter and the steps under it. Each kind with the list's
// glyph: the check's verdict, the program's soft-limit records (the true
// total — the list holds the gateway's first 200 records), the tool
// changes. Narrow, the glyph and the number; the words are each item's name.
const sumClash = computed(() => {
  const sw = simView.sweep;
  return {
    name: sw ? sw.verdict + (sw.caveat ? " (not certified)" : "")
      : simView.previous ? `Earlier preview: ${simView.previous}` : "Collisions not checked",
    short: !sw || sw.state === "nopairs" ? NO_VALUE : sw.short,
    tone: sw?.tone ?? "muted",
  };
});
const sumLimit = computed(() => {
  const { total, records } = simView.limits;
  if (total == null) return { name: "Limits not checked", short: NO_VALUE, muted: true, cut: false };
  // a tool measurement the preview cannot predict: checked up to it only
  const cut = !!simView.stop;
  const upTo = cut ? " · checked to the tool measurement" : "";
  if (total === 0) return { name: `No limit violations${upTo}`, short: "0", muted: !cut, cut };
  const words = `${total} limit violation${total === 1 ? "" : "s"}`;
  const lines = count("limit");
  return { name: (total > records ? `${words} · the first ${lines} line${lines === 1 ? "" : "s"} listed` : words) + upTo,
           short: String(total), muted: false, cut };
});
/** The summary's "?" — reachable by touch and keyboard (Codex R82 VP-I42:
 *  narrow, the capped list was said only in a name and a mouse tooltip).
 *  Capped: the total, what the parse sent, the lines the list shows. */
const sumHelp = computed(() => {
  // The line's whole statement, whatever form it shows (Codex R137 VP-I94:
  // the short forms cut the coverage and the cap — the "?" is the touch way
  // to them): each kind in its words, the cap explained.
  const { total, records } = simView.limits;
  const lines = count("limit");
  const limit = total != null && total > records
    ? `${total} limit violations, a line and an axis each — the parse sends the first ${records}; the list shows their ${lines} line${lines === 1 ? "" : "s"}`
    : sumLimit.value.name;
  const kinds = `× ${sumClash.value.name}. ▲ ${limit}. ● ${sumTool.value.name}.`;
  // the stop first: it bounds all three
  if (simView.stop) return `${simView.stop}: from there no path, no time, no collision or limit check. ${kinds}${unbound.value}`;
  return kinds + (simView.basis ? ` ${simView.basis}.` : "") + unbound.value;
});
/** Measurements no row can carry (their call line is not verified): the
 *  stats' "Tool Lengths" row lists them (Codex R105 VP-I63). */
const unbound = computed(() => (!simView.unboundMeasurements ? ""
  : simView.unboundWarnings ? " Tool lengths and probe warnings: Program Stats." : " Tool lengths: Program Stats."));
const sumTool = computed(() => {
  const n = count("tool");
  return { name: n ? `${n} tool change${n === 1 ? "" : "s"}` : "No tool changes", short: String(n), muted: !n };
});

// The summary's form, MEASURED (Codex R136 VP-I94: at 540 px the result's
// words pushed the coverage, the cap and the other two kinds out of the
// clipped line — the narrow threshold alone did not see it): from the words
// down — limits and tool changes as glyph and number, then the collision
// result as a count, then its coverage in the fewest words (R137) — the
// first form whose line fits. Every change of width
// or content starts again from the words, so the pick depends on them alone
// and cannot swing; it settles before the browser paints.
const summaryEl = ref<HTMLElement | null>(null);
const sumForm = ref<0 | 1 | 2 | 3>(0);
let _sumFitSeq = 0;
async function fitSummary() {
  const seq = ++_sumFitSeq;
  for (const f of [0, 1, 2, 3] as const) {
    sumForm.value = f;
    await nextTick();
    if (seq !== _sumFitSeq) return;
    const el = summaryEl.value;
    if (!el || el.scrollWidth <= el.clientWidth + 0.5) return;
  }
}
// A change of content is fitted in the next animation frame, before it
// paints: measured in the task that changed it, the read forced the layout of
// everything changed with it — the list's 400 new rows at a large first
// arrival (plan 3.6). A resize is fitted where it is seen (after the layout).
let _sumFitRaf = 0;
function fitSummarySoon() {
  if (!_sumFitRaf) _sumFitRaf = requestAnimationFrame(() => { _sumFitRaf = 0; void fitSummary(); });
}
const sumFit = typeof ResizeObserver === "function" ? new ResizeObserver(() => { void fitSummary(); }) : null;
watch(summaryEl, (el, old) => {
  if (old) sumFit?.unobserve(old.parentElement ?? old);
  if (el) { sumFit?.observe(el.parentElement ?? el); fitSummarySoon(); }
});
watch(() => [simView.sweep?.result, simView.sweep?.coverage, simView.sweep?.short, simView.sweep?.caveat,
             sumClash.value.name, sumLimit.value.name, sumLimit.value.short, sumLimit.value.cut, sumTool.value.name],
      () => fitSummarySoon());
onUnmounted(() => { sumFit?.disconnect(); cancelAnimationFrame(_sumFitRaf); });

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
  simJump(r.key, r.cum);
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
/** Where the window began for the rows on screen (noted after each render). */
let shownBefore = 0;
watch(renders, (_now, before) => {
  const r = root.value, a = document.activeElement as HTMLElement | null;
  if (!r || !a || !r.contains(a)) { held = null; return; }
  const key = a.closest<HTMLElement>("[data-sim-row]")?.dataset.simRow ?? null;
  const old = (before?.[0] ?? []) as readonly SimRow[];
  // its place in the WHOLE list (plan 4.4): the window may move under it
  const local = key ? old.findIndex(x => x.key === key) : -1;
  held = { key, label: key ? null : a.getAttribute("aria-label"), index: local >= 0 ? shownBefore + local : -1 };
}, { flush: "pre" });
watch(renders, () => {
  const h = held, r = root.value;
  held = null;
  if (!h || !r || r.contains(document.activeElement)) return;
  const keys = rows.value.map(x => x.key);
  const tries: (HTMLElement | null)[] = [];
  if (h.key && keys.includes(h.key)) tries.push(pickEl(h.key));
  if (h.label) tries.push(r.querySelector<HTMLElement>(`[aria-label="${CSS.escape(h.label)}"]`));
  // the row now at its place in the whole list, held inside the window
  if (keys.length && h.index >= 0) tries.push(pickEl(keys[Math.max(0, Math.min(h.index - simView.window.before, keys.length - 1))]!));
  tries.push(r.querySelector<HTMLElement>('select[name="simFilter"]'), r);
  for (const el of tries) {
    el?.focus();
    if (el && document.activeElement === el) return;
  }
}, { flush: "post" });
// after the focus watcher (a later post job): the rows now on screen
watch(renders, () => { shownBefore = simView.window.before; }, { flush: "post" });
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
const rowEl = (sc: HTMLElement, key: string) => sc.querySelector<HTMLElement>(`tr[data-sim-row="${CSS.escape(key)}"]`);
function follow(animate: boolean) {
  const sc = scroller.value, key = marked.value;
  if (!sc || !key || !sc.clientHeight) return;
  const tr = rowEl(sc, key);
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
// The list is a window (plan 4.4): when it moves — or rows arrive above —
// the rows shift under the scroll position. The row marked before keeps its
// place on screen across the change, then the list glides as ever — never a
// jump of the whole list.
// The picture is kept in the task that changed the rows (every reader after
// it sees the row where it was — it reads only when a row on screen was
// anchored, never at a first list); the follow runs in the next animation
// frame, before it paints: its read of the new rows' layout in the task that
// made them forced the layout of every new row there — a long task at a
// large first list (plan 3.6).
let shownMarked: string | null = null;
let anchor: { key: string; y: number } | null = null;
let followRaf = 0;
watch(rows, () => {
  anchor = null;
  const sc = scroller.value, key = shownMarked;
  const tr = sc && key ? rowEl(sc, key) : null;
  if (tr && key) anchor = { key, y: tr.getBoundingClientRect().top };
}, { flush: "pre" });
function restoreAnchor() {
  const sc = scroller.value, a = anchor;
  anchor = null;
  const tr = sc && a ? rowEl(sc, a.key) : null;
  if (sc && a && tr) sc.scrollTop += (tr.getBoundingClientRect().top - a.y) / cssZoomOf(sc);
}
watch([marked, rows], () => {
  restoreAnchor();
  if (!followRaf) followRaf = requestAnimationFrame(() => { followRaf = 0; follow(true); shownMarked = marked.value; });
}, { flush: "post" });
// A hidden tab has no height: it catches up when it shows (or resizes).
const sized = typeof ResizeObserver === "function" ? new ResizeObserver(() => follow(false)) : null;
watch(scroller, (el, old) => {
  if (old) sized?.unobserve(old);
  if (el) sized?.observe(el);
});
onUnmounted(() => { sized?.disconnect(); cancelAnimationFrame(glideRaf); cancelAnimationFrame(followRaf); });

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
        <span class="sub">{{ simView.sweep?.label ?? "Collision check" }}</span>
        <template v-if="simView.sweep">
          <div class="progressTrack" role="progressbar" aria-label="Collision check progress"
               :aria-valuenow="Math.round(simView.sweep.frac * 100)" aria-valuemin="0" aria-valuemax="100">
            <div class="progressFill" :style="{ width: `${simView.sweep.frac * 100}%` }"></div>
          </div>
          <span class="mono checkPct">{{ fmtPct(simView.sweep.frac) }}</span>
        </template>
        <span v-else class="text-muted">{{ simView.previous ? "Not checked yet" : "Not checked" }}</span>
        <!-- What the check on screen was computed with (step 4 plan 1c): a
             card, not more text in the "?" — taken when the check began. -->
        <DetailsPopover type="detailsIcon" label="Check basis">
          <template #icon><ClipboardList :size="14" /></template>
          <div class="popTitle">Check basis</div>
          <dl v-if="simView.card?.rows.length" class="detailsList checkCard">
            <template v-for="(r, i) in simView.card.rows" :key="i">
              <dt>{{ r.label }}</dt><dd :class="{ 'text-warn': r.warn }">{{ r.value }}</dd>
            </template>
          </dl>
          <div v-for="n in (simView.card ? simView.card.notes : [NO_CHECK])" :key="n" class="text-muted">{{ n }}</div>
        </DetailsPopover>
        <HelpIcon label="Collision check">{{ simView.sweep?.detail || (simView.previous
          ? "The run published a new preview (tool table changed). The earlier verdict is named only; this one is checked at run end."
          : "Tool and machine parts checked against each other along the program.") }}</HelpIcon>
      </div>
      <!-- ONE summary line, always there: nothing under it moves with the
           check's result. Its form is MEASURED (Codex R136 VP-I94): the
           words; the limits and tool changes as glyph and number; the
           collision result as a count too — the coverage stays. -->
      <div class="simSummaryRow row-tight">
        <div ref="summaryEl" class="simSummary row-controls" :class="`form${sumForm}`" :data-sum-form="sumForm">
          <span class="sumItem sumClash row-tight" role="img" :aria-label="sumClash.name" :title="sumClash.name">
            <X class="sumGlyph clash" :size="12" :stroke-width="3" aria-hidden="true" />
            <span v-if="simView.sweep" class="checkVerdict" :class="simView.sweep.tone === 'danger' ? 'sumKind clash' : `text-${simView.sweep.tone}`"><span
              :class="{ mono: sumForm >= 2 }">{{ sumForm >= 2 ? sumClash.short : simView.sweep.result }}</span><template
              v-if="simView.sweep.coverage"> · {{ sumForm === 3 ? simView.sweep.coverageShort : simView.sweep.coverage }}</template></span>
            <span v-else class="text-muted">{{ sumForm >= 2 ? sumClash.short : sumClash.name }}</span>
            <span v-if="simView.sweep?.caveat" class="text-warn" title="Not certified — see the collision check help">*</span>
          </span>
          <span class="sumItem sumLimit row-tight" role="img" :aria-label="sumLimit.name" :title="sumLimit.name">
            <Triangle class="sumGlyph limit" :size="11" fill="currentColor" aria-hidden="true" />
            <span :class="[sumLimit.muted ? 'text-muted' : 'sumKind limit', { mono: sumForm > 0 }]">{{ sumForm === 0 ? sumLimit.name : sumLimit.short }}</span>
            <span v-if="sumLimit.cut" class="text-warn" title="Checked to the tool measurement only — see the summary help">*</span>
          </span>
          <span class="sumItem row-tight" role="img" :aria-label="sumTool.name" :title="sumTool.name">
            <Circle class="sumGlyph tool" :size="10" fill="currentColor" aria-hidden="true" />
            <span :class="[sumTool.muted ? 'text-muted' : 'sumKind tool', { mono: sumForm > 0 }]">{{ sumForm === 0 ? sumTool.name : sumTool.short }}</span>
          </span>
        </div>
        <HelpIcon label="Summary">{{ sumHelp }}</HelpIcon>
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
        <HelpIcon label="Timeline list">Up to 400 rows near the shown one; ‹ › reach all. × collision, ▲ soft limit (offsets as parsed), ● tool change.</HelpIcon>
      </div>

      <div v-if="!rows.length" class="emptyState">{{ total ? "None of this kind." : "No collisions, limit violations or tool changes." }}</div>
      <div v-else ref="scroller" v-sticky-head class="simTable dataTable scroll-thin fade-scroll" :class="{ locked: !can.armed }">
        <table>
          <thead>
            <tr><th class="colKind" aria-label="Kind"></th><th class="colLine">Line</th><th class="colWhat">What</th><th class="colMove">Move</th><th class="colAt">Time</th></tr>
          </thead>
          <!-- the list is a window (plan 4.4): what lies before and after it,
               counted — ‹ › reach every row -->
          <tbody v-if="simView.window.before" class="windowMore">
            <tr><td colspan="5" class="text-muted">{{ simView.window.before }} earlier</td></tr>
          </tbody>
          <tbody>
            <tr v-for="r in rows" :key="r.key" :data-sim-row="r.key" :data-sim-at="r.kind === 'clash' ? `${r.key[0]}${r.line}` : r.key"
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
                <span class="whatText">{{ r.what }}</span><span v-if="r.rapid != null" class="moveInline text-muted"> · {{ r.rapid ? "Rapid" : "Feed" }}</span><span v-if="r.note" class="text-muted"> · {{ r.note }}</span>
              </td>
              <td class="colMove" :class="r.rapid ? 'text-warn' : 'text-muted'">{{ r.rapid == null ? "" : r.rapid ? "Rapid" : "Feed" }}</td>
              <td class="colAt mono text-muted">{{ r.at }}</td>
            </tr>
          </tbody>
          <tbody v-if="simView.window.after" class="windowMore">
            <tr><td colspan="5" class="text-muted">{{ simView.window.after }} later</td></tr>
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
/* The check basis card: its values are sentences — they read from the start. */
.checkCard dd { text-align: start; }
.checkPct { white-space: nowrap; }
/* The summary keeps ONE line whatever it says: the limit item gives way
   (an ellipsis; the whole text is its name and title). */
/* The "?" ends the row: its invisible hit area reaches past the glyph, and
   the tab content clips — the row keeps that reach inside (Codex R83 VP-I43:
   with a full line the outer 4 px were cut off). */
.simSummaryRow {
  flex-shrink: 0;
  --help-reach: calc((var(--help-hit) - var(--help-icon-size)) / 2);
  padding-inline-end: var(--help-reach);
}
/* The "?" stays outside the clipped line: its hit area reaches past it. */
.simSummary { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; }
.sumItem { flex: none; }
/* The last form gives way inside the collision item: where even the count
   and the coverage in its fewest words do not fit, the coverage takes an
   ellipsis — the whole statement is the item's name, title and the "?". */
.simSummary.form3 .sumClash { flex: 0 1 auto; min-width: 0; }
.simSummary.form3 .checkVerdict { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.filterSelect { flex: 1; min-width: 0; }
.simTable { flex: 1; min-height: 0; overflow: auto; }
tbody tr[data-sim-row] { cursor: pointer; }
.locked tbody tr[data-sim-row] { cursor: default; }
/* The shown finding: the selection tint and a bar; the next one ahead (no
   finding shown — a run's look-ahead): the bar alone. */
.shownRow { background: var(--hl-selected); }
.shownRow td { background: inherit; }
.shownRow td:first-child,
.nextRow td:first-child { box-shadow: inset 3px 0 0 var(--info); }
.colKind { width: 1%; text-align: center; }
.colKind.clash, .sumGlyph.clash { color: var(--mark-clash); }
.colKind.limit, .sumGlyph.limit { color: var(--mark-limit); }
.colKind.tool, .sumGlyph.tool { color: var(--mark-tool); }
/* The words that count a kind take its mark's colour (operator 2026-10-06);
   the collision verdict where it found collisions. */
.sumKind.clash { color: var(--mark-clash); }
.sumKind.limit { color: var(--mark-limit); }
.sumKind.tool { color: var(--mark-tool); }
.sumGlyph { flex: none; }
.colLine, .colMove, .colAt { width: 1%; white-space: nowrap; }
.rowPick { display: block; }
/* What takes what the rest leaves and stays ONE line (the whole text in its
   title): every row one height. */
.colWhat { width: 100%; max-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.moveInline { display: none; }
/* The narrow side pane (one threshold — .sidePane.narrow): the Move column
   joins the What text, BEFORE the note — a long note (the limit stop) must
   not cut "Rapid" off the line. */
.sidePane.narrow .colMove { display: none; }
.sidePane.narrow .moveInline { display: inline; }
</style>
