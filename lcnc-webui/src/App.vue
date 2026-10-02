<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, provide, reactive, ref, watch } from "vue";
import type { CollisionLineMark } from "./viewer/collision";
import { applyClientOverlay, applyClientOverlayReasons, PERMISSIONS_KEY, OWNER_PERMISSIONS_KEY, PERMISSION_REASONS_KEY, FIRE_KEY, type Permissions, type PermissionReasons } from "./permissions";
import { simMode } from "./simMode";
import { twpPoseOriented, twpPoseStale, twpDatumStale, fixtureOffDatum, stampAForFixture, poseAbcOf } from "./twpPose";
import { semanticKinsMode } from "./viewer/kins";
import { runLineState, subExecState, resolveCurrentLine } from "./trackHighlight";
import { clearSubfileCache } from "./lcncApi";
import { mainLinesTrusted, type ScrubTrack } from "./viewer/scrubTrack";
import { connectWs, connected, status, send, request, armed, lastReply, viewerGcode, viewerInit, gcodeContent, gcodeRevision, gcodeTextRevision, gcodeTextSource, lcncError, latency, networkLatency, messages, unreadCount, dismissMessage, clearAllMessages, markMessagesRead, pushMessage, safetyTrip, acknowledgeSafetyTrip, readerStale, safetyChainIncomplete, configWarning, previewLoadError, previewParseError, previewRefusal, previewRefresh, previewRefreshElapsedMs, previewRefreshLabel, previewRefreshPct, serverShuttingDown, type LcncMessage } from "./lcncWs";
// Lazy-load the 3D viewer so Three.js (~866 KB) + troika load as a separate async
// chunk after first paint instead of blocking the initial bundle (P6). The viewerRef
// methods are all `?.`-guarded, so calls during the brief load gap safely no-op.
const ThreeViewer = defineAsyncComponent(() => import("./ThreeViewer.vue"));
import TabPanel from "./TabPanel.vue";
import GcodePanel from "./GcodePanel.vue";
import SafetyStrip from "./SafetyStrip.vue";
import JogStrip from "./JogStrip.vue";
import StatsDonut from "./StatsDonut.vue";
import SetupStrip from "./SetupStrip.vue";
import TextKeypadStrip from "./TextKeypadStrip.vue";
import OverridesStrip from "./OverridesStrip.vue";
import SpindleStrip from "./SpindleStrip.vue";
import ToolStrip from "./ToolStrip.vue";
import HelpIcon from "./HelpIcon.vue";
import SettingsPanel from "./SettingsPanel.vue";
import ToolTablePanel from "./ToolTablePanel.vue";
import ProbePanel from "./ProbePanel.vue";
import { PROBE_VIEWS, type ProbeView } from "./probeViews";
import MachineSelect from "./MachineSelect.vue";
import OffsetPanel from "./OffsetPanel.vue";
import Gate from "./Gate.vue";
import { toolOffsetState } from "./viewer/toolOffsetState";
import MachineBtn from "./MachineBtn.vue";
import MacroBar from "./MacroBar.vue";
import MacrosPanel from "./MacrosPanel.vue";
import { NARROW_PANE_PX } from "./sidePaneNarrow";
import { macroBarItems, macroParamUnit, type MacroBarItem } from "./macroBar";
import { macroFolder } from "./macroFiles";
import DialogFrame from "./DialogFrame.vue";
import DetailsPopover from "./DetailsPopover.vue";
import FormField from "./FormField.vue";
import MachineInput from "./MachineInput.vue";
import { highlightGcode } from "./gcodeHighlight";
import { fmtElapsed, fmtDuration, fmtDist, fmtSize, fmtProgressTimes, fmtNum, fmtQty, fmtMs, NO_VALUE } from "./format";
import type { GcodeStats } from "./GcodePanel.vue";
import type { LimitViolation } from "./ws/bulkData";
import { Settings, MessageSquare, PowerOff, Gamepad2, Keyboard, BookOpen, ClipboardCopy, Expand, Shrink, X, Activity } from "lucide-vue-next";
import GcodeReferenceDialog from "./GcodeReferenceDialog.vue";
import NumberKeypadStrip from "./NumberKeypadStrip.vue";
import FloatingOverlays from "./FloatingOverlays.vue";
import { keypadState } from "./useNumberKeypad";
import { activeKind, openTextSession, closeTextSessionIf, lockTextSessionIf, EDITOR_OWNER, MACRO_EDITOR_OWNER, type TextTarget, returnFocusTo } from "./inputSession";
import { loadViewerDefaults, saveViewerDefaults, loadMachineDefaults, loadDisplayDefaults, saveDisplayDefaults, loadGamepadDefaults, saveGamepadDefaults, settingsVersion, type ThemeMode, type GamepadDefaults, type Layer, type OnTopLayer, type TrackMode, type Projection } from "./defaults";
import { confirmedToolsetter, toolsetterVarMap, TOOLSETTER_MDI_KEY } from "./toolsetterVars";
import { useGamepad } from "./useGamepad";
import { useMediaMql } from "./useMediaMql";
import { useDialogState } from "./useDialogState";
import { useMdiHistory } from "./useMdiHistory";
import { useTouchoffMath } from "./useTouchoffMath";
import { useMacros } from "./useMacros";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { modalOpen, repointOpeners } from "./modalRegistry";
import { g5xLabel as fixtureLabel } from "./wcs";
import { forceStopAllJogs, initJogPointerSafety, destroyJogPointerSafety, activeJogKeys } from "./useJogPointers";
import {
  INTERP_IDLE, INTERP_READING, INTERP_PAUSED, INTERP_WAITING,
  TRAJ_MODE_FREE, TRAJ_MODE_TELEOP,
  SPINDLE_FORWARD, SPINDLE_REVERSE,
  OPERATOR_DISPLAY,
  OPERATOR_ERROR,
  cooldownFor, isNeverDebounced,
} from "./lcnc";

const _vd = loadViewerDefaults();
const needsRefresh = ref(false);

// ─── Theme ──────────────────────────────────────────────────────
const themeMode = ref<ThemeMode>(loadDisplayDefaults().theme);
// Reactive OS-level dark preference; isDark depends on it so auto mode
// re-evaluates when the OS flips without any manual reassignment hack.
const isSystemDark = useMediaMql("(prefers-color-scheme: dark)");

function applyTheme(mode: ThemeMode) {
  if (mode === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", mode);
  }
}

const isDark = computed(() => {
  const m = themeMode.value;
  if (m === "dark" || m === "hc-dark") return true;
  if (m === "light" || m === "hc-light") return false;
  return isSystemDark.value;
});

function setTheme(mode: ThemeMode) {
  themeMode.value = mode;
  applyTheme(mode);
  saveDisplayDefaults({ ...loadDisplayDefaults(), theme: mode });
}

provide("isDark", isDark);
provide("setTheme", setTheme);
provide("themeMode", themeMode);

applyTheme(themeMode.value);

const isDev = import.meta.env.DEV;

// ─── Fullscreen ──────────────────────────────────────────────────
const isFullscreen = ref(!!document.fullscreenElement);
let _fsListenersActive = false;

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
}

// Browsers require a user gesture before requestFullscreen().
// Register one-shot listeners that enter fullscreen on first interaction.
function armStartFullscreen() {
  if (_fsListenersActive || document.fullscreenElement) return;
  _fsListenersActive = true;
  const enterFs = () => {
    document.removeEventListener("pointerdown", enterFs);
    document.removeEventListener("keydown", enterFs);
    _fsListenersActive = false;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(e => console.info("[fs] requestFullscreen denied or failed:", e?.message ?? e));
    }
  };
  document.addEventListener("pointerdown", enterFs, { once: true });
  document.addEventListener("keydown", enterFs, { once: true });
}

provide("isFullscreen", isFullscreen);
provide("toggleFullscreen", toggleFullscreen);

// ─── Portrait orientation detection ──────────────────────────
const isPortrait = useMediaMql("(orientation: portrait)");
provide("isPortrait", isPortrait);

// Select-all on focus for number inputs — typing replaces value
function onNumFocus(e: FocusEvent) {
  const t = e.target;
  if (t instanceof HTMLInputElement && t.type === "number") t.select();
}

onMounted(() => {
  connectWs();
  document.addEventListener("focusin", onNumFocus);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  if (loadDisplayDefaults().startFullscreen) armStartFullscreen();
});

watch(lcncError, (newVal, oldVal) => {
  if (oldVal && !newVal) needsRefresh.value = true;
});

function reloadPage() { location.reload(); }

/** ---------- permanent status banner ---------- */
type MachineStateKey = 'disconnected' | 'estop' | 'off' | 'unhomed' | 'toolchange' | 'running' | 'paused' | 'idle';

const machineState = computed<MachineStateKey>(() => {
  if (!connected.value || lcncError.value) return 'disconnected';
  if (isEstop.value) return 'estop';
  if (!isEnabled.value) return 'off';
  if (!isHomed.value) return 'unhomed';
  if (toolChangeRequested.value) return 'toolchange';
  if (isRunning.value) return 'running';
  if (isPaused.value) return 'paused';
  return 'idle';
});

const STATE_COLORS: Record<MachineStateKey, string> = {
  disconnected: '--state-danger',
  estop: '--state-danger',
  off: '--state-warn',
  unhomed: '--state-warn',
  toolchange: '--state-warn',
  running: '--state-ok',
  paused: '--state-warn',
  idle: '--state-ok',
};
// Human labels for gateway trip reason codes (status_msg.safety_trip.reason).
// Unknown codes fall through verbatim — never mask a reason we can't name.
const TRIP_REASON_LABELS: Record<string, string> = {
  hal_heartbeat_timeout: 'gateway heartbeat to HAL watchdog lost',
};
const safetyTripReasonLabel = computed(() =>
  safetyTrip.value ? (TRIP_REASON_LABELS[safetyTrip.value.reason] ?? safetyTrip.value.reason) : '');

// ONE banner line for the machine/system conditions (design wave D1,
// UI-N23/N24/N26): the state and its one recovery verb on the line, the
// "why" in `detail` — shown as the title AND at the top of the message
// center, which a tap on the banner opens (touch has no hover). Two tiers:
// `error` for safety, machine and connection, `warn` for the program, the
// preview and the configuration. A recovery that IS a UI action is a banner
// button (Acknowledge, Reload program, Refresh); the others say what to do.
interface BannerLine { key: string; tier: "error" | "warn"; text: string; detail?: string }
const bannerLine = computed<BannerLine | null>(() => {
  if (safetyTrip.value) return { key: "safety", tier: "error",
    text: `SAFETY TRIPPED (${safetyTripReasonLabel.value}) — Acknowledge, re-Arm if needed, then E-Stop Reset`,
    detail: "The HAL watchdog latched E-Stop. Acknowledge the trip, Arm again if this client lost it, then press E-Stop Reset — in that order." };
  if (safetyChainIncomplete.value) return { key: "safety-chain", tier: "error",
    text: `SAFETY CHAIN INCOMPLETE — ${safetyChainIncomplete.value} — restart the suite`,
    detail: `Safety chain incomplete: ${safetyChainIncomplete.value}. Check HALFILE hallib/lcnc_webui.hal, then restart the suite.` };
  if (serverShuttingDown.value) return { key: "shutdown", tier: "error",
    text: "Server shutting down — start LinuxCNC again to reconnect",
    detail: "The gateway is shutting down with its LinuxCNC session. Start LinuxCNC again; this page reconnects by itself." };
  if (readerStale.value) return { key: "reader-stale", tier: "error",
    text: "HAL reader stale — restart the suite if it persists",
    detail: "The HAL reader has not delivered a snapshot for 2 s — UI values may be out of date. If it persists the LinuxCNC session may have ended: restart the suite." };
  if (jointsBeyondLimit.value.length) return { key: "beyond-limit", tier: "error",
    text: `Joint ${jointsBeyondLimit.value.join(", ")} beyond its soft limit — jog it back inside`,
    detail: "Every other move is refused while a joint sits beyond its soft limit. Jog it back inside — the jog runs in joint mode until it is." };
  if (configWarning.value) return { key: "config-warning", tier: "warn",
    text: `Config fallback — ${configWarning.value.reason} — fix the INI, then restart the suite`,
    detail: `The gateway runs on a fallback: ${configWarning.value.reason}. Fix the INI and restart the suite; until then the affected feature shows defaults.` };
  if (previewLoadError.value) return { key: "preview-error", tier: "warn",
    text: "3D preview load failed — reload the program",
    detail: "The viewer could not load the preview payload. Reload the program; restart the suite if it persists." };
  if (previewParseError.value) return { key: "parse-error", tier: "warn",
    text: `Program won't parse — ${previewParseError.value}`,
    detail: `No preview or simulation until it parses — fix the program or load one posted for this machine. ${previewParseError.value}` };
  if (previewRefusal.value) return { key: "preview-refused", tier: "warn",
    text: `Preview stopped — ${previewRefusal.value.text}`,
    detail: `The preview runs from the machine's live state (active work offset, kinematics) and stopped here; a run would stop at the same place. No preview or simulation until it parses. ${previewRefusal.value.text}` };
  if (programUnconfirmed.value) {
    const name = programUnconfirmed.value.replace(/\\/g, "/").split("/").pop();
    return { key: "program-unconfirmed", tier: "warn",
      text: `Program not confirmed — ${name} — load it`,
      detail: `The gateway restarted without its record of loading a program. The interpreter has ${programUnconfirmed.value} open — possibly a subroutine. Nothing counts as loaded, previewed or runnable until you load a program.` };
  }
  if (needsRefresh.value) return { key: "refresh", tier: "warn",
    text: "LinuxCNC is back — refresh the page",
    detail: "LinuxCNC reported an error and has recovered. Refresh the page so every panel reloads the machine's current state." };
  return null;
});

// Preview re-parse banner (2026-09-05): elapsed is the client's own clock
// since first sight (statusStore ticks it); the bar never reaches 100 % on
// its own — only the publish ends it. Expected = the gateway's last
// measured publish of that file (or its size estimate), so a second zero
// on the same program gets an honest countdown.
const previewRefreshTimes = computed(() => fmtProgressTimes(previewRefreshElapsedMs.value, previewRefresh.value?.expected_ms));
// Basename only: the banner is one uppercase line — the full path plus the
// "what is stale" tail is what ran it off the right edge (operator,
// 2026-09-12). The tail and the numbers live in the title now.
const previewRefreshFile = computed(() => (previewRefresh.value?.file ?? '').replace(/\\/g, '/').split('/').pop() ?? '');
const previewRefreshTitle = computed(() => {
  const pr = previewRefresh.value;
  if (!pr) return '';
  return `Re-parsing ${pr.file} — ${previewRefreshTimes.value}${pr.queued ? '; another re-parse is queued behind it' : ''}. The toolpath, soft-limit marks and simulation are stale until it lands. The gateway re-parses whenever an input the preview was built from changes (fixture offsets, rotary pose, kinematics mode, tool length, soft-limit window, the file). Reason: ${pr.reason}. Superseded parses so far: ${pr.superseded}.`;
});

const machineStateColor = computed(() => {
  if (safetyTrip.value) return '--state-danger';
  if (safetyChainIncomplete.value) return '--state-danger';
  if (serverShuttingDown.value) return '--state-warn';
  if (readerStale.value) return '--state-warn';
  if (configWarning.value) return '--state-warn';
  if (previewLoadError.value) return '--state-warn';
  if (previewParseError.value) return '--state-warn';
  if (previewRefusal.value) return '--state-warn';
  if (programUnconfirmed.value) return '--state-warn';
  if (previewRefresh.value) return '--state-warn';
  return STATE_COLORS[machineState.value];
});

const STATE_LABELS: Record<MachineStateKey, string> = {
  disconnected: 'DISCONNECTED',
  estop: 'E-STOP',
  off: 'MACHINE OFF',
  unhomed: 'NOT HOMED',
  toolchange: 'TOOL CHANGE',
  running: 'RUNNING',
  paused: 'PAUSED',
  idle: 'IDLE',
};

const machineStateLabel = computed(() => {
  const label = STATE_LABELS[machineState.value];
  const state = machineState.value;
  if (state === 'disconnected') {
    // With an LCNC error the gateway is up but LinuxCNC is gone — waiting
    // won't fix that; without one the WS retries on its own.
    return lcncError.value
      ? `${label} — ${lcncError.value} — restart the suite to recover`
      : `${label} — reconnecting automatically…`;
  }
  // Distinguish "operator pressed E-Stop" (STAT.estop true) from "HAL chain
  // open while STAT thinks we're cleared" (issue #14). The operator already
  // knows why if STAT.estop is the visible cause; the chain-open subtitle
  // only adds noise in that case.
  if (state === 'estop' && !st.value.estop && safetyChainOpen.value) {
    return `${label} — Safety chain open`;
  }
  if (state === 'running' || state === 'paused') {
    const file = activeFile.value;
    // Normalize Windows-style backslashes (some LinuxCNC builds return them)
    // before basename — same shape as configName at L369.
    const name = file ? file.replace(/\\/g, "/").split('/').pop() : null;
    const parts = [label];
    if (name) parts.push(name);
    if (programElapsed.value != null) parts.push(elapsedDisplay.value);
    return parts.join('  ·  ');
  }
  if (state === 'toolchange' && toolChangeTool.value != null) {
    return `${label}  ·  T${toolChangeTool.value}`;
  }
  return label;
});

const bannerShowAbort = computed(() => isRunning.value || isPaused.value);

const bannerFlashMode = computed<'none' | 'pulse' | 'flash'>(() => {
  if (safetyTrip.value) return 'flash';
  const s = machineState.value;
  if (s === 'estop' || s === 'disconnected') return 'flash';
  if (safetyChainIncomplete.value) return 'pulse';
  if (serverShuttingDown.value) return 'pulse';
  if (readerStale.value) return 'pulse';
  if (configWarning.value) return 'pulse';
  if (previewLoadError.value) return 'pulse';
  if (previewParseError.value) return 'pulse';
  if (previewRefusal.value) return 'pulse';
  if (programUnconfirmed.value) return 'pulse';
  if (previewRefresh.value) return 'pulse';
  if (s === 'unhomed' || s === 'toolchange' || s === 'idle') return 'pulse';
  return 'none';
});

const bannerMessage = ref<string | null>(null);
const bannerMessageKind = ref(0);
let _bannerMsgTimer: ReturnType<typeof setTimeout> | null = null;

// A new message takes over the status line for 5 s — unless it is a quiet
// protocol entry (design wave D1, UI-N22: a dimmed control's reason is told
// AT the control; a local confirmation does not displace the machine state).
watch(() => messages.value.length, (newLen, oldLen) => {
  if (newLen > oldLen) {
    const msg = messages.value[newLen - 1]!;
    if (msg.quiet) return;
    bannerMessage.value = msg.text;
    bannerMessageKind.value = msg.kind;
    if (_bannerMsgTimer) clearTimeout(_bannerMsgTimer);
    _bannerMsgTimer = setTimeout(() => { bannerMessage.value = null; }, 5000);
  }
});

/** ---------- content tab definitions ---------- */
const contentTabs = [
  { id: "gcode", label: "Program" },
  { id: "mdi", label: "MDI" },
  { id: "probe", label: "Probing" },
  { id: "offsets", label: "Offsets" },
  { id: "tools", label: "Tools" },
  { id: "macros", label: "Macros" },
];

const activeTab = ref("gcode");
// Leaving the Macros tab over a draft (a macro file's edit, an earlier
// macro's form) asks first, like the tool editor (package 5): every switch
// goes through here — the tab list, the narrow select, the Tool Table button.
const macrosPanelRef = ref<InstanceType<typeof MacrosPanel> | null>(null);
const tabLeaveAsk = ref<{ what: string; to: string } | null>(null);
function requestTab(to: string) {
  if (to === activeTab.value) return;
  const what = activeTab.value === "macros" ? macrosPanelRef.value?.unsavedDraft() : null;
  if (what) { tabLeaveAsk.value = { what, to }; return; }
  activeTab.value = to;
}
function confirmTabLeave() {
  const ask = tabLeaveAsk.value;
  tabLeaveAsk.value = null;
  if (!ask) return;
  macrosPanelRef.value?.discardAll();
  activeTab.value = ask.to;
}
// Probing's procedure: ProbePanel's 4 × 2 grid and, narrow, the select in
// the tab bar (design wave D3).
const probeView = ref<ProbeView>("outside");

// The side pane below NARROW_PANE_PX of content width is NARROW (DR
// decision 2026-09-24; 430 px since the sixth tab, measured — see
// sidePaneNarrow.ts): the area and the procedure become two selects on one
// row; at 150 % portrait (271 px) tabs left fewer than two form rows of
// content. clientWidth: layout px, the same under the tests' CSS zoom.
const sidePaneEl = ref<HTMLElement | null>(null);
const sideNarrow = ref(false);
let sidePaneRo: ResizeObserver | null = null;
function measureSidePane() {
  const el = sidePaneEl.value;
  if (!el) return;
  const cs = getComputedStyle(el);
  const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  sideNarrow.value = inner > 0 && inner < NARROW_PANE_PX;
}
onMounted(() => {
  sidePaneRo = new ResizeObserver(measureSidePane);
  if (sidePaneEl.value) sidePaneRo.observe(sidePaneEl.value);
  measureSidePane();
});
onUnmounted(() => sidePaneRo?.disconnect());

const viewerRef = ref<any>(null);

/** ---------- local UI state ---------- */
const connLabel = computed(() => {
  const h = location.hostname;
  return (h === "localhost" || h === "127.0.0.1") ? "local" : h;
});
const busy = ref(false);

// MDI input + send-history navigation. See useMdiHistory.ts.
const {
  mdiText,
  mdiHistory,
  mdiHistoryIndex,
  handleMdiSend,
  clearMdiHistory,
  onMdiKeydown,
  // MDI is a state-changing command: route it through the ONE client path so
  // it carries the permission re-check and the busy latch, like every other
  // `mdi` call site (issue #31 — it was raw here and gated at every other).
} = useMdiHistory({
  fire: (c) => { fire(c, 'ready'); },
  // The send disables the line for the busy latch and drops its focus: the
  // guarded return keeps the shortcut map closed until the line holds focus
  // again (or the operator moved on) — the next keystroke is MDI, never a
  // shortcut (review round 4).
  afterSend: () => returnFocusTo(_mdiInputEl()),
});

// ── Input helpers in the bottom strip (WP8, UI-15) ──
// ONE session (inputSession.ts): the number keypad OR the text/code
// keyboard, owned by one target. The strip is derived from it alone —
// `mdiKeypadActive` / `gcodeEditActive` / `keypadState.open` used to be
// three competing truths (an open number keypad hid the code keyboard even
// with an active text target). The editor still reports `editingChange` for
// the keyboard-shortcut guard (Cycle Start never runs an edited buffer).
const gcodeEditActive = ref(false);

// Number keypad swap-in: it replaces the strip sections except the section
// that owns the trigger field (data-strip on each strip component), which
// stays visible so the operator keeps context and can retarget between its
// fields. Sidepanel/dialog triggers have no owning section → only
// SafetyStrip + keypad remain. The text keyboard replaces every section.
const numKeypadOwner = computed(() =>
  keypadState.open
    ? keypadState.trigger?.closest("[data-strip]")?.getAttribute("data-strip") ?? null
    : null
);
// The keypad section sits LAST in the strip DOM: with every non-owner
// section hidden, it lands directly right of the owner (or of SafetyStrip)
// without any reordering logic.
function stripVis(section: string): boolean {
  const k = activeKind.value;
  if (k === "code" || k === "text") return false;
  if (k === "number") return numKeypadOwner.value === section;
  return true;
}

const mdiInputRef = ref<any>(null);

function _mdiInputEl(): HTMLInputElement | null {
  // MachineInput exposes its <input> (its single root, so `$el` is the
  // same element — the accessor is the explicit API).
  const el = mdiInputRef.value?.inputElement?.() ?? mdiInputRef.value?.$el;
  if (el instanceof HTMLInputElement) return el;
  return el?.querySelector?.("input") ?? null;
}

// The MDI line as a CODE target: Enter = Send (the gated MDI path), Clr
// clears the line; the physical keyboard keeps working in parallel.
const MDI_OWNER = "mdi-input";
function mdiTarget(): TextTarget {
  return {
    insert(text) {
      const el = _mdiInputEl();
      const cur = mdiText.value;
      const start = el?.selectionStart ?? cur.length;
      const end = el?.selectionEnd ?? cur.length;
      mdiText.value = cur.slice(0, start) + text + cur.slice(end);
      nextTick(() => { const p = start + text.length; el?.setSelectionRange(p, p); });
    },
    backspace() {
      const el = _mdiInputEl();
      const cur = mdiText.value;
      let start = el?.selectionStart ?? cur.length;
      const end = el?.selectionEnd ?? cur.length;
      if (start === end && start > 0) start -= 1;
      if (start === end) return;
      mdiText.value = cur.slice(0, start) + cur.slice(end);
      nextTick(() => el?.setSelectionRange(start, start));
    },
    enter() { handleMdiSend(); },
    clear() { mdiText.value = ""; },
    moveCursor(d) {
      const el = _mdiInputEl();
      if (!el) return;
      const p = Math.max(0, Math.min(mdiText.value.length, (el.selectionStart ?? 0) + d));
      el.setSelectionRange(p, p);
    },
    canConfirm: () => !!permissions.value.ready,
    isVisible: () => { const el = _mdiInputEl(); return !!el && el.offsetParent !== null; },
    focusEl: _mdiInputEl,
  };
}
function openMdiSession() {
  if (!permissions.value.ready) return;
  openTextSession({ ownerId: MDI_OWNER, kind: "code", context: "MDI", target: mdiTarget(), enterLabel: "Apply" });
}
// Hidden-but-mounted owners (tab switch): the editor's and the MDI line's
// sessions LOCK while their tab is not visible — helper hidden, draft kept.
// A tab switch is never a machine action — but a jog still running (a jog
// key held while a tab is clicked) stops (design wave D3). Only then:
// stopAllJog sends jog_stop per axis whenever jogging is allowed. The main
// tab AND the Probing procedure (grid or narrow select) — the procedure used
// to keep jogging until the keyup (implementation review round 4, UI-DI11).
function stopJogOnNavigation() {
  if (keyboardJogActive.value || activeJogKeys.size > 0) stopAllJog();
}
watch(activeTab, (tab) => {
  lockTextSessionIf(EDITOR_OWNER, tab !== "gcode");
  lockTextSessionIf(MDI_OWNER, tab !== "mdi");
  lockTextSessionIf(MACRO_EDITOR_OWNER, tab !== "macros");
  stopJogOnNavigation();
});
watch(probeView, stopJogOnNavigation);

// Viewer state (initialized from saved defaults, persisted on every change)
const viewerLayers = reactive<Record<Layer, boolean>>({ ..._vd.layers });
const viewerTrackMode = ref<TrackMode>(_vd.trackingMode);
const viewerProjection = ref<Projection>(_vd.projection);

// G-code viewer — gcodeContent is fetched via HTTP by lcncWs on viewer_gcode
const gcodeStats = ref<GcodeStats | null>(null);
// Per-line soft-limit violations from the parse worker. null = unchecked
// (no INI limits, or no program) — distinct from [] = checked clean.
const gcodeViolations = ref<LimitViolation[] | null>(null);
// Why the worker gave no verdict though the INI has limits (VP-I20):
// "start_unknown" — the start tool offset was not known.
const gcodeViolationsReason = ref<string | null>(null);
const gcodeViolationsTotal = ref(0);
const gcodeWorldUnchecked = ref(0);
// Kins-flip honesty counts from the parse worker: flips no twin could
// resolve (segments keep phantom geometry) and frame-relabel CARRY spans
// (geometry corrected under an assumption canon replay cannot verify —
// "axis held" vs "commanded to the stale value"). Both ride the wire;
// shipping a count nobody displays is the delivery gap the review found.
const gcodeKinsUnresolved = ref(0);
const gcodeKinsCarrySpans = ref(0);
const kinsFlipStatus = computed(() => {
  const u = gcodeKinsUnresolved.value, cs = gcodeKinsCarrySpans.value;
  if (!u && !cs) return null;
  const parts: string[] = [];
  if (u) parts.push(`${u} flip${u === 1 ? "" : "s"} unresolved`);
  if (cs) parts.push(`${cs} relabel-carry span${cs === 1 ? "" : "s"} estimated`);
  return { cls: u ? "warn" : "muted", text: parts.join(" · ") };
});
// Called external subs with no WEBUI_SUB markers (W3 P5): their motion's
// line numbers collide with the main file's — one info-tier stats hint,
// no per-point behavior change (markers are the only trust mechanism).
const gcodeUnmarkedSubs = ref<string[]>([]);
// Load-time lint: the kins type the program's last switch leaves in effect
// (null = the program never switches; 0 = restored before M2).
const gcodeKinsEnd = ref<number | null>(null);
// The FRAME the program's last kinematics marker leaves in effect — null when
// no program/marker, 0 when it ends in identity (nothing to restore). Raw
// type 0 is NOT identity on every family (R-01), so the stats row asks the
// family, like the viewer's own warning does.
const gcodeKinsEndMode = computed<number | null>(() =>
  gcodeKinsEnd.value == null ? 0 : semanticKinsMode(gcodeKinsEnd.value, viewerInit.value?.kins));
// Soft-limit stats row: identity-check result plus the honest TCP hole —
// world segments with no kins twin are NOT validated and must never read
// as "OK" (unchecked ≠ clean).
const softLimitStatus = computed(() => {
  if (gcodeViolations.value === null)
    return gcodeViolationsReason.value === "start_unknown"
      ? { cls: "warn", text: "Not validated (start tool offset unknown)" }
      : { cls: "muted", text: "Not validated (no INI limits)" };
  const parts: string[] = [];
  const n = gcodeViolationsTotal.value;
  if (n) parts.push(`${n} violation${n === 1 ? "" : "s"}`);
  const w = gcodeWorldUnchecked.value;
  if (w) parts.push(`${w} TCP segment${w === 1 ? "" : "s"} not validated`);
  return parts.length ? { cls: "warn", text: parts.join(" · ") }
                      : { cls: "ok", text: "OK" };
});
// Source line at the viewer's scrub position (null = not scrubbing).
const scrubLine = ref<number | null>(null);
// Source lines with collision hits from the viewer's sweep (null = none run).
const collisionLines = ref<CollisionLineMark[] | null>(null);

// Donut chart (distance breakdown) lives in StatsDonut.vue.

/** ---------- status helpers ---------- */
const st = computed<Record<string, any>>(() => {
  if (lcncError.value) return {};  // LinuxCNC disconnected — show safe defaults
  return status.value?.data ?? {};
});
const connectedClients = computed<{ip: string, armed: boolean}[]>(() => status.value?.clients ?? []);

// INI/static machine config — delivered once in viewer_init, not per-tick.
const ini = computed<Record<string, any>>(() => viewerInit.value?.ini_config ?? {});

// LinuxCNC config name from INI path (e.g. "/home/cnc/.../my-mill/my-mill.ini" → "my-mill")
const configName = computed(() => {
  const iniFile = ini.value.ini_filename;
  if (!iniFile) return null;
  const parts = iniFile.replace(/\\/g, "/").split("/");
  // Use parent folder name (the config directory)
  return parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1];
});

const lcncLabel = computed(() => {
  if (lcncError.value) return "LCNC error";
  if (configName.value) return configName.value;
  return "LCNC: -";
});

// HAL safety chain (iocontrol.0.emc-enable-in) is the *truth* about whether the
// machine can move; STAT.estop / STAT.enabled go through iocontrol's edge-
// triggered NML pump and can lie when the chain was already LOW at command
// time (issue #14). `=== false` (not falsy) so reader-stale (null/undefined)
// is treated as "unknown" and falls back to STAT, matching backend semantics.
// estop/enabled "merged truth" (issue #14) is computed ONCE on the backend
// (_policy_state_from_payload) and broadcast as is_estop/is_enabled; the banner
// and DRO consume it here (review #5). safetyChainOpen stays local — it's the
// raw chain pin, used only for the "safety chain open" banner text.
const safetyChainOpen = computed(() => st.value.emc_enable_in === false);
const isEstop = computed(() => !!st.value.is_estop);
const isEnabled = computed(() => !!st.value.is_enabled);



/** DRO: work/machine */
const workPos = computed<number[]>(() => {
  const data = st.value ?? {};
  return Array.isArray(data.work_pos) ? data.work_pos : [];
});

const activeFile = computed<string | null>(() => {
  return st.value?.active_file || null;
});
/** After a gateway restart without its load record: the interpreter's open
 *  file, named but not loaded (Codex R16 XZ-08). */
const programUnconfirmed = computed<string | null>(() => {
  const f = st.value?.program_unconfirmed;
  return typeof f === "string" && f ? f : null;
});

/** True when the parse found that this program's motion carries line numbers
 *  from a called subroutine or a remap (gateway_util.check_line_attribution).
 *  Those collide with the main file's numbering and cannot be repaired: a
 *  queued motion carries no file identity, and `call_level` tracks where the
 *  interpreter is READING (which runs ahead and is usually back at 0 while the
 *  sub's motion executes), so it cannot qualify `motion_line` either. */
const linesUntrusted = computed<boolean>(
  () => !!viewerGcode.value?.lines_untrusted);
const linesUntrustedReason = computed<string>(
  () => viewerGcode.value?.lines_untrusted_reason || "");

// W5: the set of main-file lines the track's per-point trust vouches for —
// the only lines a live motion_line value may ever display as (motion ids
// carry no file identity; see trackHighlight.resolveCurrentLine).
const trustedLines = computed<Uint8Array | null>(() => {
  const t = (viewerGcode.value as { scrubTrack?: ScrubTrack | null } | null)?.scrubTrack;
  return t ? mainLinesTrusted(t) : null;
});
const currentLine = computed<number | null>(() => resolveCurrentLine({
  rls: runLineState.value,
  running: interpState.value !== INTERP_IDLE,
  motionLine: st.value?.motion_line,
  linesUntrusted: linesUntrusted.value,
  trustedLines: trustedLines.value,
}));
/** Marked-subroutine name at the playhead (W2 P6) — GcodePanel shows
 *  "▶ in subroutine (name)" instead of a line highlight. */
const runSubName = computed<string | null>(() => runLineState.value?.subName ?? null);

/** ---------- permissions (arming + machine state) ---------- */
const canEstop = computed(() => !isEstop.value);
const canResetEstop = computed(() => armed.value && isEstop.value);


/** Centralized permissions — single source of truth for all button enable/disable.
 *  Memoized: returns the same object reference when values haven't changed,
 *  so child components using usePermissions() don't re-render on every status update. */
let _prevPerms: Permissions | null = null;
const permissions = computed(() => {
  // Policy lives on the backend now (issue #19): consume the broadcast
  // permission classes and overlay only the client-local armed + busy terms.
  const next = applyClientOverlay(st.value.permissions, armed.value, busy.value, simMode.value);
  const keys = Object.keys(next) as (keyof typeof next)[];
  if (_prevPerms && keys.every(k => _prevPerms![k] === next[k])) return _prevPerms;
  _prevPerms = next;
  return next;
});
provide(PERMISSIONS_KEY, permissions);
// The same gates WITHOUT the busy debounce — what an input OWNER's context
// (MachineInput, OffsetPanel cells) lives by: a real backend revocation ends
// it even inside the latch, the latch alone never does (review round 3,
// UI-I05). Memoized like `permissions`.
let _prevOwnerPerms: Permissions | null = null;
const ownerPermissions = computed(() => {
  const next = applyClientOverlay(st.value.permissions, armed.value, false, simMode.value);
  const keys = Object.keys(next) as (keyof typeof next)[];
  if (_prevOwnerPerms && keys.every(k => _prevOwnerPerms![k] === next[k])) return _prevOwnerPerms;
  _prevOwnerPerms = next;
  return next;
});
provide(OWNER_PERMISSIONS_KEY, ownerPermissions);
// MachineBtn shows "Busy — try again" at the control when this latch would
// drop its click (fire()); read-only for children.
provide("busy", busy);
// Gate closes → the MDI session ends (its value could not be sent anyway).
// (Declared after `permissions`: the watch getter runs at setup time.)
watch(() => permissions.value.ready, (ok) => { if (!ok) closeTextSessionIf(MDI_OWNER, "MDI unavailable"); });
// Why each closed gate is closed (U-06): the backend's reasons under the
// client-local overlay's own — what a dimmed control shows on hover and
// says on tap (MachineBtn), and what fire() reports when it drops a send.
const permissionReasons = computed<PermissionReasons>(() =>
  applyClientOverlayReasons(st.value.permission_reasons, armed.value, busy.value, simMode.value));
provide(PERMISSION_REASONS_KEY, permissionReasons);

// Provide a probing flag so catalog-aware MachineBtn instances with
// `whileProbing: true` self-disable while a probe op is in flight. Replaces
// ~14 inline `:disabled="probing"` props that were scattered across panels.
const isProbing = computed(() => !!st.value.probing);
provide("probing", isProbing);

const isHomed = computed(() => {
  const h = st.value.homed;
  if (Array.isArray(h)) return h.every(Boolean);
  return !!h;
});

const motionMode = computed(() => st.value.motion_mode ?? TRAJ_MODE_FREE);
// Live switchkins type as a clean int (null = no switchable kins on this
// machine / not sampled — the kins-mode surfaces hide themselves then).
const liveKinsType = computed<number | null>(() => {
  const k = st.value.kins_type;
  return k == null ? null : Math.round(Number(k));
});
// The FRAME that raw type means on this machine's kins family — 0 Machine,
// 1 TCP, 2 Plane (viewer/kins.semanticKinsMode, the client twin of the
// gateway's semantic_kins). Raw numbers are family-dependent: on an
// xyzac-trt without `sparm=identityfirst` raw 0 is the WORLD kins, so a
// selector bound to raw names the frame wrongly (R-01). Everything the
// operator SEES uses this; the touch-off `expect` payload keeps the raw
// type, which is what the gateway compares against its own pin.
const kinsMode = computed<number | null>(() =>
  semanticKinsMode(liveKinsType.value, viewerInit.value?.kins));
// TWP capability: this machine runs the TWP remap stack — twin of the
// gateway's _twp_capable (the shipped xyzacb-trsrn config IS the stack). A
// switchable-but-TWP-less machine (a TCP trunnion) keeps the kins-frame
// selector but never the Plane frame, the Capture/Orient/Clear row or the
// reserved G59 rows (TWP-08b, review 2026-09-14).
const twpCapable = computed<boolean>(() => viewerInit.value?.kins?.type === "xyzacb-trsrn");
// TWP plane staleness: the A rotary is a WORK-side table, so rotating it after
// the plane was defined/oriented leaves the stored frame pointing at where the
// face USED to be. One predicate (twpPose.ts), two surfaces — the kins chip
// here via prop, the plane overlay inside ThreeViewer.
const twpStale = computed(() =>
  twpPoseStale(poseAbcOf(st.value), st.value.rotary_abc, st.value.twp_defined),
);
// The datum moved AFTER the plane was defined: the remap's saved_work_offset
// snapshot (echoed as twp_datum) no longer matches the live G54 row, so the
// plane overlay and the NEXT ORIENT still use the old datum. Honest surface
// only — the snapshot semantics are deliberate upstream behavior.
const twpDatumMoved = computed(() =>
  twpDatumStale(st.value.wcs_table?.[0] as { x?: number; y?: number; z?: number } | undefined,
    st.value.twp_datum, st.value.twp_defined, st.value.wcs_prov_a?.[0]),
);
// Identity-kins fixture off the part: the ACTIVE fixture's W1 stamp A vs the
// live table A (twpPose.fixtureOffDatum — the Machine-mode mirror of twpStale).
// Same chip/HUD derivation as the other flags via kinsModeChip.
const twpOffDatum = computed(() =>
  // Semantic mode: "is this identity kinematics" is the question, not "is
  // the raw pin 0" (R-01).
  fixtureOffDatum(kinsMode.value, stampAForFixture(st.value.wcs_prov_a, st.value.g5x_index),
    st.value.rotary_abc?.[0]),
);
// A head solve exists (G53.x / Orient ran this session): the pose stamp is
// above the remap's "no orient yet" sentinel. Gates the Plane jog frame —
// a bare M430 before any orient jogs on whatever the kins pins last held.
const twpOriented = computed(() => twpPoseOriented(poseAbcOf(st.value), st.value.twp_defined));
// Kinematics-frame selector (JogStrip): M428 restores identity, M429 enters
// TCP (world XYZ = the table-riding work frame: jog A and the tool tip stays
// on the workpiece, the kins re-solving XYZ — the Heidenhain 3D-ROT-style
// tracking the operator asked for), M430 enters TOOL/plane kins. Switchkins
// preserves joint positions, so the switch itself moves nothing; `ready`
// (idle + homed) makes it a safe stationary relabel. Sent as the TYPED
// `set_kins_mode` command (TWP-04): the Plane frame has a backend admission
// rule — a plane defined AND the head still aligned with it (the A/B/C
// orient stamp vs the live rotaries) — which the `planeFrame` permission
// mirrors for the radio's dimming.
function setKinsMode(t: number): string | null {
  if (t !== 0 && t !== 1 && t !== 2) return null;
  return fire({ cmd: "set_kins_mode", mode: t }, t === 2 ? "planeFrame" : "ready");
}
// Task mode (the strip's Mode group): its req_id back to the group.
function setTaskMode(m: number): string | null {
  return fire({ cmd: "set_mode", mode: m }, "idle");
}
// TWP re-orient: re-solve the head at the CURRENT table pose. Unlike the
// jog-frame switch above this MOVES the rotaries, hence the probe tier.
// Same MDI channel the switchkins remaps use; the o-sub carries the whole
// sequence so a failure aborts as one action and surfaces on the error
// channel like any other MDI. Q1 inside tells g53x_core this is a re-orient,
// so the "TWP already active" refusal is skipped rather than raced.
function twpReorient() {
  fire({ cmd: "mdi", text: "o<twp_reorient> call" }, "probe");
}
// Capture plane (workflow 2, one button): typed command — the gateway
// re-checks twp_capture_check server-side and surfaces the refusal reason;
// the o-sub samples the tip itself after its own sync (no poll race here).
function twpCapture() {
  fire({ cmd: "twp_capture" }, "twpCapture");
}
// Clear plane: plain G69 like the other TWP MDI verbs — idempotent,
// guardless, moves nothing (stationary relabel → ready tier).
function twpClear() {
  fire({ cmd: "mdi", text: "G69" }, "ready");
}
const isTeleop = computed(() => motionMode.value === TRAJ_MODE_TELEOP);

const interpState = computed(() => st.value.interp_state ?? INTERP_IDLE);
const isPaused = computed(() => st.value.paused ?? interpState.value === INTERP_PAUSED);
const isRunning = computed(() => !isPaused.value && (interpState.value === INTERP_READING || interpState.value === INTERP_WAITING));

/** ---------- program elapsed timer ----------
 * Server-authoritative: gateway tracks the anchor across pause/resume and
 * broadcasts the accumulated elapsed time each status tick. Mid-program
 * reconnects see the true value because the first status snapshot already
 * carries it. */
const programElapsed = computed(() => {
  const ms = st.value.program_elapsed_ms;
  // Absent ≠ zero: a synthetic 00:00 would read as "just started" when the
  // field simply hasn't been delivered. Render honest-absent instead.
  return ms == null ? null : Math.floor(ms / 1000);
});
const elapsedDisplay = computed(() => programElapsed.value == null ? "--:--" : fmtElapsed(programElapsed.value));

/** ---------- system clock ---------- */
const clockTime = ref('');
let _clockHandle: ReturnType<typeof setInterval> | null = null;
function _updateClock() {
  const now = new Date();
  clockTime.value = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
_updateClock();
_clockHandle = setInterval(_updateClock, 1000);
onUnmounted(() => { if (_clockHandle) clearInterval(_clockHandle); });

/** ---------- display helpers for machine states ---------- */
// G5x work coordinate system (G54, G55, etc.) — one source: wcs.ts.
const g5xLabel = computed(() => fixtureLabel(st.value.g5x_index));

// Override values (raw 0.0-2.0 scale). Returns null until status delivers a
// real value — never synthesise a default. The watchers below guard with
// Number.isFinite so null never writes to the local slider state, and the
// override sliders stay disabled until the first real value arrives. Without
// this, a cold-start tab would show a synthesised 100% and a user drag
// would send a set_*_override based on a value the machine never reported.
const feedOverrideValue = computed<number | null>(() => {
  const val = st.value.feed_override;
  return (val != null && Number.isFinite(val)) ? val : null;
});
const spindleOverrideValue = computed<number | null>(() => {
  const val = st.value.spindle_override;
  return (val != null && Number.isFinite(val)) ? val : null;
});
const rapidOverrideValue = computed<number | null>(() => {
  const val = st.value.rapid_override;
  return (val != null && Number.isFinite(val)) ? val : null;
});
// `*_enabled === true` (not `!== false`) so missing data → disabled, not enabled.
const feedOvrEnabled = computed(() =>
  feedOverrideValue.value !== null && st.value.feed_override_enabled === true
);
const spindleOvrEnabled = computed(() =>
  spindleOverrideValue.value !== null && st.value.spindle_override_enabled === true
);
const rapidOvrAvailable = computed(() => rapidOverrideValue.value !== null);

const taskMode = computed(() => st.value.task_mode ?? 0);
// Is the spindle tool's own length offset in effect? (operator 2026-10-01;
// viewer/toolOffsetState.ts — the Tool strip's word, the viewer's pin)
const toolOffset = computed(() => toolOffsetState({ tool_number: st.value.tool_number, tool_table_z: st.value.tool_table_z,
  tool_offset: st.value.tool_offset, gcodes: st.value.gcodes }));
const activeGcodes = computed(() => {
  const codes = st.value.gcodes;
  if (!codes || !Array.isArray(codes)) return "";
  return codes.slice(1).filter((c: number) => c !== -1).map((c: number) => `G${(c / 10).toFixed(c % 10 ? 1 : 0)}`).join(" ");
});
const activeMcodes = computed(() => {
  const codes = st.value.mcodes;
  if (!codes || !Array.isArray(codes)) return "";
  return codes.slice(1).filter((c: number) => c !== -1).map((c: number) => `M${c}`).join(" ");
});

// Tool change dialog (global — tool changes can happen from any context)
const toolChangeRequested = computed(() => !!st.value.tool_change_requested);
const toolChangeTool = computed(() => st.value.tool_change_tool ?? null);
// Confirm exactly once per request (UI-05): `confirmSent` holds the req_id
// of the confirm that actually went out (fire() returns null when nothing
// was sent — never a pending). It clears when the request ends, when the
// gateway refuses it (retry allowed) and on disconnect. Gate `armed`: the
// change happens mid-program, never at idle/ready.
const confirmSent = ref<string | null>(null);
function confirmToolChange() {
  if (!toolChangeRequested.value || confirmSent.value) return;
  const id = fire({ cmd: "confirm_tool_change" }, 'armed');
  if (id) confirmSent.value = id;
}
watch(toolChangeRequested, (req) => { if (!req) confirmSent.value = null; });
watch(lastReply, (r) => {
  if (r && confirmSent.value && r.req_id === confirmSent.value && r.ok === false) confirmSent.value = null;
});
watch(connected, (c) => { if (!c) confirmSent.value = null; });

const feedSlider = ref(100);
const spindleSlider = ref(100);
const rapidSlider = ref(100);

watch(feedOverrideValue, (val) => { if (val != null && Number.isFinite(val)) feedSlider.value = Math.round(val * 100); });
watch(spindleOverrideValue, (val) => { if (val != null && Number.isFinite(val)) spindleSlider.value = Math.round(val * 100); });
watch(rapidOverrideValue, (val) => { if (val != null && Number.isFinite(val)) rapidSlider.value = Math.round(val * 100); });

function onFeedChange() { setFeedOverride(feedSlider.value / 100); }
function onSpindleSliderChange() { setSpindleOverride(spindleSlider.value / 100); }
function onRapidChange() { setRapidOverride(rapidSlider.value / 100); }
function setOverridePreset(type: "feed" | "spindle" | "rapid", percent: number) {
  if (type === "feed") { feedSlider.value = percent; onFeedChange(); }
  else if (type === "spindle") { spindleSlider.value = percent; onSpindleSliderChange(); }
  else { rapidSlider.value = percent; onRapidChange(); }
}

// Machine native unit (from INI [TRAJ]LINEAR_UNITS — static, not affected by G20/G21)
const linearUnit = computed(() => ini.value.linear_units ?? "mm");

// Max jog velocity from INI [DISPLAY]MAX_LINEAR_VELOCITY (u/s)
const maxJogVel = computed(() => {
  const v = ini.value.max_jog_velocity ?? ini.value.max_velocity;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 50;
});

// INI config: jog
const defaultJogVel = computed(() => {
  const v = ini.value.default_jog_velocity;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 10;
});
const minJogVel = computed(() => {
  const v = ini.value.min_jog_velocity;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 0.1;
});
// Angular (rotary) jog velocity from INI [DISPLAY]
const defaultAngularJogVel = computed(() => {
  const v = ini.value.default_angular_jog_velocity;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 10;
});
const maxAngularJogVel = computed(() => {
  const v = ini.value.max_angular_jog_velocity;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 50;
});
const minAngularJogVel = computed(() => {
  const v = ini.value.min_angular_jog_velocity;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 0.1;
});

const iniIncrements = computed<number[] | null>(() => {
  const v = ini.value.increments;
  return Array.isArray(v) && v.length > 0 ? v : null;
});

// INI config: spindle
const defaultSpindleSpeed = computed(() => {
  const v = ini.value.default_spindle_speed;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 1000;
});
const minSpindleSpeed = computed(() => {
  const v = ini.value.min_spindle_speed;
  return (v != null && Number.isFinite(v) && v >= 0) ? v : 0;
});
const maxSpindleSpeed = computed(() => {
  const v = ini.value.max_spindle_speed;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 99999;
});
// [SPINDLE_n] INCREMENT — RPM step for +/- buttons. Used by motion controller
// when spinning (SPINDLE_INCREASE/DECREASE); applied client-side when staging.
const spindleIncrement = computed(() => {
  const v = ini.value.spindle_increment;
  return (v != null && Number.isFinite(v) && v > 0) ? v : 100;
});

// INI config: overrides (INI 0-1 fractions → percentage integers)
const minSpindleOverride = computed(() => {
  const v = ini.value.min_spindle_override;
  return (v != null && Number.isFinite(v)) ? Math.round(v * 100) : 50;
});
const maxSpindleOverride = computed(() => {
  const v = ini.value.max_spindle_override;
  return (v != null && Number.isFinite(v)) ? Math.round(v * 100) : 200;
});
const maxFeedOverride = computed(() => {
  const v = ini.value.max_feed_override;
  return (v != null && Number.isFinite(v)) ? Math.round(v * 100) : 200;
});

// Spindle state
const spindleSpeed = computed(() => st.value.spindle_speed ?? null);
const spindleActual = computed(() => st.value.spindle_speed_actual ?? null);
const spindleDirection = computed(() => st.value.spindle_direction ?? null);

// Spindle popover state
const rpmInput = ref(1000);
const isForward = computed(() => spindleDirection.value === SPINDLE_FORWARD);
const isReverse = computed(() => spindleDirection.value === SPINDLE_REVERSE);
const isSpinning = computed(() => isForward.value || isReverse.value);

// Coolant state
const floodOn = computed(() => !!st.value.flood);
const mistOn = computed(() => !!st.value.mist);
function toggleFlood() {
  fire({ cmd: floodOn.value ? "flood_off" : "flood_on" }, 'override');
}
function toggleMist() {
  fire({ cmd: mistOn.value ? "mist_off" : "mist_on" }, 'override');
}

// Program switches
const optionalStopOn = computed(() => !!st.value.optional_stop);
const blockDeleteOn = computed(() => !!st.value.block_delete);

// Server-authoritative toggles (state comes from st.value). These used to route
// around fire() because its flat 200 ms cooldown made a flag toggle feel laggy
// and dropped a deliberate second click; with per-command transport policy
// (lcnc.ts COMMAND_COOLDOWN_MS) they hold no latch and can use the one path.
function toggleOptionalStop() {
  fire({ cmd: "set_optional_stop", value: !optionalStopOn.value }, "override");
}
function toggleBlockDelete() {
  fire({ cmd: "set_block_delete", value: !blockDeleteOn.value }, "override");
}

// Dialog state — see useDialogState.ts. Holds settings, gcode-reference,
// messages, shutdown-confirm, stats, and compensation-toggle dialogs.
const {
  settingsDialogOpen,
  settingsInitialTab,
  gcodeRefOpen,
  gcodeRefInitialSearch,
  messagesDialogOpen,
  openDialog,
  openMessages,
  closeMessages,
  closeSettings,
  openSettingsTab,
  openGcodeRef,
  showShutdownConfirm,
  statsDialogOpen,
  compConfirmPending,
  requestCompToggle,
  confirmCompToggle,
  cancelCompToggle,
} = useDialogState({ markMessagesRead, send, fire, guardSettingsClose: p => guardSettingsClose(p) });

// Settings closes over a draft only after an explicit Discard (UI-K16): the
// macro editor and the gamepad wizard are local to the panel and were lost
// by every close path. Settings themselves save automatically — no ask.
const settingsPanelRef = ref<{ unsavedDraft: () => string | null } | null>(null);
const settingsDiscard = ref<{ what: string; proceed: () => void } | null>(null);
function guardSettingsClose(proceed: () => void): boolean {
  const what = settingsPanelRef.value?.unsavedDraft() ?? null;
  if (!what) return false;
  settingsDiscard.value = { what, proceed };
  return true;
}
function confirmSettingsDiscard() {
  const pending = settingsDiscard.value;
  settingsDiscard.value = null;
  pending?.proceed();
}

// Macro state + execution (macro FILES, package 5). See useMacros.ts.
const {
  macroBarNames,
  setMacroBar,
  macroParamDialog,
  dialogFile,
  dialogFileBlock,
  runMacroFile,
  confirmMacroParams,
  macroExecuteKey,
} = useMacros({ fire });
// The bar's items: the macro files in `bar` — one derivation for the bar in
// either orientation.
const macroBar = computed(() => macroBarItems(macroBarNames.value, macroFolder.value));
function runBarItem(item: MacroBarItem) {
  runMacroFile(item.file);
}

const toolTableRef = ref<InstanceType<typeof ToolTablePanel> | null>(null);
// The toolsetter as the SERVER confirmed it (Codex R15 B1): its values go to
// the machine only once it is set up — TOOLSETTER_FALLBACK is a form's
// starting point, and a config without a saved section used to push its
// zeros on every Measure Current.
const toolsetter = computed(() => confirmedToolsetter());
const toolsetterReason = computed(() => (toolsetter.value.ok ? undefined : toolsetter.value.reason));
const unloadUsesToolsetter = computed(() => {
  void settingsVersion.value;
  return loadMachineDefaults().toolChangeMode === "m600";
});

/**
 * A routine's values and the line that runs it as ONE command — `mdi` with
 * `vars` (the toolsetter's #3004–#3115 before an M600, a probe op's vars
 * before its O-call). The gateway sets the values in the interpreter (the
 * var file is read only at LinuxCNC's start) and sends the line only once
 * they are taken over; an abort from any client cancels that handler.
 * Codex R16 XZ-06: the browser used to hold the continuation between two
 * commands — Abort never reached it, and a delayed reply started the
 * measurement after the abort. Nothing is sent after the reply; it only
 * says what happened. Returns whether the gateway started the line.
 */
async function fireWithVars(label: string, vars: Record<string, number>, line: string,
                            gate: keyof Permissions): Promise<boolean> {
  if (busy.value) { console.warn(`[fireWithVars] ${label} dropped: another command is settling`); return false; }
  if (!permissions.value[gate]) {
    pushMessage(OPERATOR_ERROR, `${label} not sent — ${permissionReasons.value[gate] ?? "not available"}`);
    return false;
  }
  busy.value = true;
  try {
    // The values' MDI waits up to 5 s per chunk in the gateway.
    const reply = await request({ cmd: "mdi", text: line, vars }, 15000);
    if (!reply) {
      // Sent, unanswered: the gateway may still start it — never "not sent".
      pushMessage(OPERATOR_ERROR, `${label}: no reply from the gateway — watch the machine`);
      return false;
    }
    if (reply.ok === false) {
      pushMessage(OPERATOR_ERROR, `${label} not started — ${reply.error ?? "refused"}`);
      return false;
    }
    return true;
  } finally {
    window.setTimeout(() => (busy.value = false), cooldownFor("mdi"));
  }
}

/** Every M600 the WebUI starts (Measure Current, Unload and a table load in
 *  M600 mode): only with the toolsetter set up, its values in the same command. */
async function toolsetterMdi(label: string, line: string): Promise<boolean> {
  const setup = toolsetter.value;
  if (!setup.ok) { pushMessage(OPERATOR_ERROR, `${label} not sent — ${setup.reason}`); return false; }
  return fireWithVars(label, toolsetterVarMap(setup.values), line, "machineFrame");
}
provide(TOOLSETTER_MDI_KEY, toolsetterMdi);

function measureAuto() {
  const t = st.value.tool_number;
  if (!t) { pushMessage(OPERATOR_ERROR, "Measure Current — no tool loaded"); return; }
  if (!permissions.value.machineFrame || st.value.probing) {
    pushMessage(OPERATOR_ERROR, `Measure Current not sent — ${permissionReasons.value.machineFrame ?? (st.value.probing ? "a probe is running" : "not available")}`);
    return;
  }
  void toolsetterMdi("Measure Current", `T${t} M600`);
}

function unloadTool() {
  if (!permissions.value.machineFrame) {
    pushMessage(OPERATOR_ERROR, `Unload not sent — ${permissionReasons.value.machineFrame ?? "not available"}`);
    return;
  }
  if (unloadUsesToolsetter.value) {
    void toolsetterMdi("Unload", "T0 M600");
  } else {
    // The standard tool change needs no toolsetter.
    fire({ cmd: "tool_change", tool_number: 0 }, 'machineFrame');
  }
}

// Probe status (used in tool table dialog action bar)
const probeStatus = computed(() => {
  if (st.value.probing) return "PROBING";
  if (st.value.probe_tripped) return "TRIPPED";
  return "IDLE";
});
const probeStatusClass = computed(() => {
  if (st.value.probing) return "probing";
  if (st.value.probe_tripped) return "tripped";
  return "";
});
const probeIndicatorClass = computed(() => {
  if (st.value.probe_input === true) return "tripped";
  return "";
});

// Message popover helpers
function msgKindClass(kind: number): string {
  if (kind <= 2) return "error";
  if (kind <= 4) return "info";
  return "display";
}
function msgKindLabel(kind: number): string {
  if (kind <= 2) return "ERROR";
  if (kind <= 4) return "INFO";
  return "DISPLAY";
}
function msgFormatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString();
}

// navigator.clipboard is only exposed in secure contexts (HTTPS or
// localhost). The gateway binds 0.0.0.0 by design so the UI is reached
// over LAN HTTP from another machine — a non-secure context. The
// execCommand path is the LAN-HTTP fallback, not legacy cruft. Do NOT
// strip without an HTTPS plan; the failure mode is a runtime TypeError
// on every copy click. See commits e4fdd63 (removal) and the follow-up.
function copyToClipboard(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(err => {
      if (!fallbackCopy(text)) console.error("clipboard copy failed:", err);
    });
    return;
  }
  if (!fallbackCopy(text)) {
    console.error("clipboard copy failed: no API available");
  }
}

function fallbackCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;  // a clipboard fallback must not throw to the caller
  } finally {
    document.body.removeChild(ta);
  }
}

function copyMessage(msg: LcncMessage) {
  copyToClipboard(`[${msgKindLabel(msg.kind)}] ${msgFormatTime(msg.ts)} — ${msg.text}`);
}

function copyAllMessages() {
  const text = [...messages.value].reverse().map(m =>
    `[${msgKindLabel(m.kind)}] ${msgFormatTime(m.ts)} — ${m.text}`
  ).join("\n");
  copyToClipboard(text);
}

/** ---------- actions ---------- */
function arm(v: boolean) {
  send({ cmd: "arm", armed: v });
  // armed.value updates when the gateway reply arrives (server-authoritative)
}

/** ---------- idle auto-disarm ----------
 * Armed is pure command authorization (it never aborts motion — see the
 * armed-is-authorization rule), so expiring it on an untouched client
 * restores the accidental-tap protection when the operator walks away.
 * Refuses to fire unless the interp is IDLE, nothing is probing, and no
 * jog is held: while a program runs/pauses or a jog is live, Abort and
 * jog_stop must stay one tap away without a re-arm.
 * Activity = pointer/key input OR any command round-trip (lastReply),
 * so gamepad-only operation counts as activity too. */
let lastActivityTs = Date.now();
function noteActivity() { lastActivityTs = Date.now(); }
watch(lastReply, noteActivity);
let autoDisarmTimer = 0;
function checkAutoDisarm() {
  const min = loadMachineDefaults().autoDisarmMin;
  if (!min || !armed.value) return;
  if (interpState.value !== INTERP_IDLE || st.value.probing) return;
  if (activeJogKeys.size > 0) return;
  if (Date.now() - lastActivityTs < min * 60_000) return;
  arm(false);
  pushMessage(OPERATOR_DISPLAY, `Auto-disarmed after ${min} min of inactivity (Settings → Machine → Idle Auto-Disarm).`);
}
onMounted(() => {
  document.addEventListener("pointerdown", noteActivity, { capture: true, passive: true });
  document.addEventListener("keydown", noteActivity, { capture: true, passive: true });
  autoDisarmTimer = window.setInterval(checkAutoDisarm, 30_000);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", noteActivity, true);
  document.removeEventListener("keydown", noteActivity, true);
  clearInterval(autoDisarmTimer);
});

/** ---------- scroll-edge affordances (strip + macro bar) ----------
 * Toggles .strip-more (content beyond the far edge) and .strip-scrolled
 * (content hidden at the near edge) on each scroller, fading the
 * .stripFade/.stripFadeStart gradients (strip's near edge is the pinned
 * SafetyStrip's ::after instead). Children are observed too because
 * scrollWidth grows when content arrives (axis chunks after viewer_init)
 * without the scroller itself resizing. The macro bar is v-if-mounted,
 * so attachment re-runs when the macro list changes. */
const fadeEls = new Set<HTMLElement>();
let fadeRo: ResizeObserver | null = null;
function updateScrollFades() {
  for (const el of fadeEls) {
    if (!el.isConnected) { fadeEls.delete(el); continue; }
    const more =
      el.scrollLeft + el.clientWidth < el.scrollWidth - 1 ||
      el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    el.classList.toggle("strip-more", more);
    el.classList.toggle("strip-scrolled", el.scrollLeft > 1 || el.scrollTop > 1);
  }
}
function attachScrollFades() {
  fadeRo ??= new ResizeObserver(updateScrollFades);
  for (const el of document.querySelectorAll<HTMLElement>(".strip, .macroScroll")) {
    if (fadeEls.has(el)) continue;
    fadeEls.add(el);
    el.addEventListener("scroll", updateScrollFades, { passive: true });
    fadeRo.observe(el);
    for (const c of el.children) fadeRo.observe(c);
  }
  updateScrollFades();
}
onMounted(attachScrollFades);
watch(() => macroBar.value.items.length, () => nextTick(attachScrollFades));
// The macro bar changes its place with the orientation (a new element): its
// fades attach again, a focused macro keeps its focus on the same macro, and
// an open parameter dialog returns to the new button (package 5, stage A —
// matched by the macro's id, never by position).
/** The macro a bar control belongs to: the button carries data-macro-id, a
 *  dimmed one's .btnTip wrapper holds it (detached elements work too). */
function macroIdOf(el: Element | null | undefined): string | undefined {
  if (!el?.closest(".macroBar")) return undefined;
  return (el.closest<HTMLElement>("[data-macro-id]") ?? el.querySelector<HTMLElement>("[data-macro-id]"))?.dataset.macroId;
}
function macroControl(id: string | undefined): HTMLElement | null {
  const b = id ? document.querySelector<HTMLElement>(`.macroBar [data-macro-id="${CSS.escape(id)}"]`) : null;
  return b?.closest<HTMLElement>(".btnTip") ?? b;
}
watch(isPortrait, () => {
  const focusedId = macroIdOf(document.activeElement);
  nextTick(() => {
    attachScrollFades();
    repointOpeners(old => macroControl(macroIdOf(old)));
    if (focusedId) macroControl(focusedId)?.focus();
  });
}, { flush: "pre" });
// Strip content swaps (keypad in/out) change scrollWidth without resizing
// the strip itself — re-check the edge fades.
watch(activeKind, () => nextTick(attachScrollFades));
onUnmounted(() => {
  fadeRo?.disconnect();
  fadeRo = null;
  fadeEls.clear();
});

/** ---------- local UI jog ---------- */
const jogVel = ref(10);
const angularJogVel = ref(10); // deg/s for rotary axes
const jogIncrement = ref(0); // 0 = continuous, >0 = increment distance in machine units

// Axis list from viewer_init (gateway derives from axis_mask). Empty until
// viewer_init arrives — axis-dependent UI is gated behind `armed` anyway.
const axes = computed<string[]>(() => viewerInit.value?.axes ?? []);

// Machine STL parts list (for dynamic color pickers in Settings)
const machineParts = computed<Array<{ id: string; group: string | null; direction: string | null; color: [number, number, number] | null }>>(() => {
  const vi = viewerInit.value;
  if (!vi?.parts) return [];
  // Build group → direction map from kinematics. Axis colors mark LINEAR
  // axes (matches ThreeViewer's material mapping) — rotary groups excluded.
  const groupDir: Record<string, string> = {};
  const kin = vi.kinematics;
  if (Array.isArray(kin)) {
    for (const k of kin) if (k.direction && k.type !== "rotate") groupDir[k.group] = k.direction;
  } else if (kin && typeof kin === "object") {
    for (const key of Object.keys(kin)) groupDir[key] = key;
  }
  return vi.parts.map(p => {
    const grp = p.group ?? p.parent ?? null;
    return {
      id: p.id,
      group: grp,
      direction: grp ? (groupDir[grp] ?? null) : null,
      color: (p.color as [number, number, number] | undefined) ?? null,
    };
  });
});

function setMachinePartColor(partId: string, color: string | null) {
  viewerRef.value?.setMachinePartColor?.(partId, color);
}

function setMachineEdges(on: boolean) {
  viewerRef.value?.setMachineEdges?.(on);
}

// Settings changed a viewer colour or the palette mode (design wave D8c).
function applyPaletteFromSettings() {
  viewerRef.value?.applyPaletteFromSettings?.();
}

provide("machineParts", machineParts);
provide("setMachinePartColor", setMachinePartColor);
provide("setMachineEdges", setMachineEdges);
provide("applyPaletteFromSettings", applyPaletteFromSettings);

function setProjection(proj: "perspective" | "parallel") {
  const wantOrtho = proj === "parallel";
  const v = viewerRef.value;
  // defineExpose unwraps refs: v.isOrtho is a plain boolean on the exposed
  // instance (a `.value` read here was undefined → every call blind-toggled).
  if (v && v.isOrtho !== wantOrtho) v.switchProjection?.();
}

const runFromLineEnabled = ref(loadMachineDefaults().runFromLine);

const touchoff = ref<number[]>([0, 0, 0]);

// Resize touchoff when axes change (e.g. 3→5 axes on reconnect)
watch(axes, (a) => {
  if (touchoff.value.length !== a.length) {
    const copy = [...touchoff.value];
    copy.length = a.length;
    for (let i = 0; i < a.length; i++) if (copy[i] == null) copy[i] = 0;
    touchoff.value = copy;
  }
});

// Initialize defaults from INI (once, when first non-fallback value arrives)
let _jogVelInit = false;
watch(defaultJogVel, (v) => { if (!_jogVelInit && v !== 10) { jogVel.value = v; _jogVelInit = true; } });
let _angJogVelInit = false;
watch(defaultAngularJogVel, (v) => { if (!_angJogVelInit && v !== 10) { angularJogVel.value = v; _angJogVelInit = true; } });
let _rpmInit = false;
watch(defaultSpindleSpeed, (v) => { if (!_rpmInit && v !== 1000) { rpmInput.value = v; _rpmInit = true; } });

// While the spindle is running, mirror the live commanded RPM into rpmInput.
// Keeps the displayed value in sync with SPINDLE_INCREASE/DECREASE and gives
// the user the last commanded value as the staging value when they Stop.
watch(spindleSpeed, (v) => {
  if (isSpinning.value && v != null && v > 0 && v !== rpmInput.value) {
    rpmInput.value = v;
  }
});

/**
 * The single client path for a state-changing command (issue #31).
 *
 * Adds two things over raw send(): an imperative permission re-check
 * (defense-in-depth behind Gate.vue's fieldset, in case DOM state drifted) and
 * the anti-spam busy latch. The gate is READ from the backend-broadcast
 * permissions — never re-derived here.
 *
 * The latch NEVER applies to a stop command (isNeverDebounced): `abort` was
 * routed through here from the keyboard and gamepad and could be silently
 * discarded within another action's cooldown. Its permission gate still
 * applies; only the debounce is bypassed. Cooldown length is per-command
 * transport policy (cooldownFor), which is why a flag toggle no longer needs
 * to route around fire() to feel responsive.
 *
 * A drop is logged, not silent — the same honesty rule the backend follows.
 */
function fire(payload: any, gate?: keyof Permissions, cooldownMs?: number): string | null {
  const cmd = String(payload?.cmd ?? "");
  const neverDebounced = isNeverDebounced(cmd);
  if (busy.value && !neverDebounced) {
    console.warn(`[fire] ${cmd} dropped: another command is settling`);
    return null;
  }
  if (gate && !permissions.value[gate]) {
    // Loud in the message center too (U-06): a control that looked live and
    // did nothing is the same silence as an unexplained dimmed one.
    const why = permissionReasons.value[gate] ?? `gate '${gate}' is closed`;
    console.warn(`[fire] ${cmd} dropped: gate '${gate}' is closed`);
    pushMessage(OPERATOR_ERROR, `${cmd} not sent — ${why}`);
    return null;
  }
  const hold = cooldownMs ?? cooldownFor(cmd);
  if (hold <= 0) return send(payload);   // no latch: nothing to release
  busy.value = true;
  try {
    return send(payload);
  } finally {
    window.setTimeout(() => (busy.value = false), hold);
  }
}

function onRunProbe({ vars, macro }: { vars: Record<string, number>; macro: string }) {
  void fireWithVars("Probe", vars, `O<${macro}> CALL`, 'ready');
}

// Reachable by descendants that cannot see this closure, so a component never
// has to fall back to raw send() for a state-changing command (issue #31).
provide(FIRE_KEY, fire);

// Touch-off math + Z-eoffset compensation. See useTouchoffMath.ts.
const { setAxis, setAll, setG5x } = useTouchoffMath({ axes, fire });

// Homing is ZERO-tier on the backend (idle + !eoffset), not idle.
function homeAll() {
  fire({ cmd: "home_all" }, 'zero');
}

function unhomeAll() {
  fire({ cmd: "unhome_all" }, 'zero');
}

// Joint letters outside their own soft-limit window (status
// joints_beyond_limit): motion refuses every world-mode move meanwhile, the
// gateway jogs in joint mode until they are back inside — the banner says so.
const jointsBeyondLimit = computed<string[]>(() => {
  const j = st.value.joints_beyond_limit;
  return Array.isArray(j) ? j.map(String) : [];
});

const homedJoints = computed<boolean[]>(() => {
  const hj = st.value.homed_joints;
  return Array.isArray(hj) ? hj.map(Boolean) : [];
});

function homeAxis(joint: number) {
  fire({ cmd: "home", joint }, 'zero');
}

function unhomeAxis(joint: number) {
  fire({ cmd: "unhome", joint }, 'zero');
}



function cycleStart() {
  fire({ cmd: "cycle_start" }, 'run');
}

function runFromLine(opts: import("./gcodeRfl").RflRunOptions) {
  // ONE command, sent at the confirmation (Codex R16 XZ-07): the program it
  // was confirmed on rides along (the gateway refuses another), and so do
  // the toolsetter's values for the pre-measurement — the gateway sets them
  // before its M600. An await between the two let another program arrive
  // and run with this one's line, tool and entry position.
  let probeVars: Record<string, number> | undefined;
  if (opts.preTool > 0) {
    const setup = toolsetter.value;
    if (!setup.ok) { pushMessage(OPERATOR_ERROR, `Run from line not started — ${setup.reason}`); return; }
    probeVars = toolsetterVarMap(setup.values);
  }
  fire({
    cmd: "auto_run",
    line: opts.line,
    file: opts.program.file,
    version: opts.program.version,
    source: opts.program.source,
    spindle_dir: opts.spindleDir !== "off" ? opts.spindleDir : undefined,
    spindle_speed: opts.spindleDir !== "off" ? opts.spindleSpeed : undefined,
    // RFL × M600 guard: measure this tool via MDI first (gateway bg sequence),
    // retract to G53 Z0 (never lowered — skipped when already at/above it),
    // and rapid to the derived start XY before AUTO_RUN.
    pre_tool: opts.preTool > 0 ? opts.preTool : undefined,
    probe_vars: probeVars,
    safe_z: opts.safeZ || undefined,
    entry_x: opts.entry?.x ?? undefined,
    entry_y: opts.entry?.y ?? undefined,
    entry_wcs: opts.entry?.wcs ?? undefined,
    entry_units: opts.entry?.units ?? undefined,
  }, 'run');
}

function cycleStep() {
  fire({ cmd: "auto_step" }, 'step');
}

function cyclePause() {
  fire({ cmd: "cycle_pause" }, 'pause');
}

function cycleResume() {
  fire({ cmd: "cycle_resume" }, 'resume');
}

function setFeedOverride(scale: number) {
  send({ cmd: "set_feed_override", scale });
}

function setSpindleOverride(scale: number) {
  send({ cmd: "set_spindle_override", scale });
}

function setRapidOverride(scale: number) {
  send({ cmd: "set_rapid_override", scale });
}

function spindleForward(speed: number) {
  fire({ cmd: "spindle_forward", speed }, 'ready');
}

function spindleReverse(speed: number) {
  fire({ cmd: "spindle_reverse", speed }, 'ready');
}

function spindleStop() {
  fire({ cmd: "spindle_stop" }, 'ready');
}

function spindleIncrease() {
  if (isSpinning.value) {
    fire({ cmd: "spindle_increase" }, 'ready');
  } else {
    if (!permissions.value.ready) return;
    rpmInput.value = Math.min(maxSpindleSpeed.value, rpmInput.value + spindleIncrement.value);
  }
}

function spindleDecrease() {
  if (isSpinning.value) {
    fire({ cmd: "spindle_decrease" }, 'ready');
  } else {
    if (!permissions.value.ready) return;
    rpmInput.value = Math.max(minSpindleSpeed.value, rpmInput.value - spindleIncrement.value);
  }
}

function loadFile(path: string) {
  fire({ cmd: "load_file", path }, 'setup');
}

function unloadFile() {
  fire({ cmd: "unload_file" }, 'setup');
}

/** ---------- keyboard shortcuts ---------- */
// See useKeyboardShortcuts.ts. Owns config, reverseKeyMap, jogActions,
// onKeyDown/onKeyUp, and the keydown/keyup window listeners. Cross-client
// sync (settingsVersion → re-read loadKeyboardDefaults) lives inside.
const {
  keyboardConfig,
  setKeyboardConfig,
  clearJogState: clearKeyboardJogState,
  jogActive: keyboardJogActive,
} = useKeyboardShortcuts({
  jogVel,
  angularJogVel,
  jogIncrement,
  axes,
  permissions,
  canEstop,
  activeFile,
  modalOpen,
  editing: gcodeEditActive,
  send,
  fire,
});

// Every dialog App renders is a DialogFrame, which registers itself in the
// modal registry and the dialog stack while it is mounted (design wave D2):
// while any is open — or the keypad — the shortcut map lets only E-Stop
// through.
/** The message center's Clear All asks first (N47). */
const clearMessagesAsk = ref(false);

/** ---------- gamepad jogging ---------- */
const gamepadConfig = ref<GamepadDefaults>(loadGamepadDefaults());
const gamepadGated = computed(() => settingsDialogOpen.value);
const gamepad = useGamepad({
  jogVel,
  angularJogVel,
  jogIncrement,
  permissions,
  send,
  fire,
  activeFile: computed(() => activeFile.value),
  config: gamepadConfig,
  axes: computed(() => axes.value),
  gated: gamepadGated,
});

function setGamepadConfig(cfg: GamepadDefaults) {
  gamepadConfig.value = cfg;
  saveGamepadDefaults(cfg);
}

watch(() => keyboardConfig.value.jogEnabled, (curr, prev) => {
  if (!curr && prev) stopAllJog();
});

watch(() => gamepadConfig.value.jogEnabled, (curr, prev) => {
  if (!curr && prev) gamepad.stopAllJog();
});

provide("gamepadAxes", gamepad.gamepadAxesState);
provide("gamepadButtons", gamepad.gamepadButtonsState);
provide("gamepadLogicalButtons", gamepad.gamepadLogicalButtons);
provide("gamepadLogicalSticks", gamepad.gamepadLogicalSticks);

// Re-read server-synced settings when another client saves.
// (the macro bar and keyboardConfig refresh via their own composable watchers.)
watch(settingsVersion, () => {
  const mach = loadMachineDefaults();
  runFromLineEnabled.value = mach.runFromLine;
  gamepadConfig.value = loadGamepadDefaults();
  const disp = loadDisplayDefaults();
  if (disp.theme !== themeMode.value) {
    themeMode.value = disp.theme;
    applyTheme(disp.theme);
  }
  if (disp.startFullscreen) armStartFullscreen();
  const vd = loadViewerDefaults();
  Object.assign(viewerLayers, vd.layers);
  viewerTrackMode.value = vd.trackingMode;
  viewerProjection.value = vd.projection;
});

/** ---------- safety: stop jog on focus loss ---------- */
function stopAllJog() {
  forceStopAllJogs();          // clear pointer-based jog state + send stops
  clearKeyboardJogState();     // clear active keyboard-jog action set
  gamepad.stopAllJog();
  if (!permissions.value.jog) return; // no jog possible unless armed + enabled + homed
  if (isRunning.value || isPaused.value) return; // no jog during program execution
  for (let i = 0; i < axes.value.length; i++) {
    send({ cmd: "jog_stop", axis: i });
  }
}

function visHandler() {
  if (document.hidden) stopAllJog();
}

// useKeyboardShortcuts owns its own keydown/keyup window listeners.
onMounted(() => {
  initJogPointerSafety();
  window.addEventListener("blur", stopAllJog);
  document.addEventListener("visibilitychange", visHandler);
  gamepad.start();
});

onUnmounted(() => {
  destroyJogPointerSafety();
  window.removeEventListener("blur", stopAllJog);
  document.removeEventListener("visibilitychange", visHandler);
  document.removeEventListener("focusin", onNumFocus);
  document.removeEventListener("fullscreenchange", onFullscreenChange);  // issue #32
  gamepad.stop();
});

/** ---------- Probe results from DEBUG EVAL messages ---------- */
const probeResults = ref<Record<string, number> | null>(null);

watch(status, (st) => {
  if (st?.probe_results && typeof st.probe_results === "object") {
    probeResults.value = st.probe_results;
  }
  // Surface map / comp grid are HTTP-fetched bulk channels carried across
  // every status frame (statusStore.noteBulkData). React on the VERSION EDGE,
  // not on presence: the values are now on every frame, so the old
  // presence-triggered `compGrid = null` would blank the grid mesh ~30×/s.
  //
  // Reacting to the edge also means an EMPTY result can clear the display.
  // The old `&& .length` guard existed because the value was wiped between
  // frames, which left an emptied probe-results.txt showing a stale surface.
  const bv = st?.bulk_versions;
  if (bv && bv.surface_points !== _lastSurfaceVersion) {
    _lastSurfaceVersion = bv.surface_points;
    surfacePoints.value = Array.isArray(st.surface_points) && st.surface_points.length
      ? st.surface_points : null;
    compGrid.value = null;   // grid belongs to the PREVIOUS points; new one lands in ~150 ms
    _lastGridVersion = bv.comp_grid;   // …so don't immediately re-apply the old one
  }
  if (bv && bv.comp_grid !== _lastGridVersion) {
    _lastGridVersion = bv.comp_grid;
    compGrid.value = (st.comp_grid && typeof st.comp_grid === "object") ? st.comp_grid : null;
  }
});

// Last bulk versions applied to the local refs — see the watcher above.
let _lastSurfaceVersion: number | undefined;
let _lastGridVersion: number | undefined;

/** ---------- Surface map probe results ---------- */
const surfacePoints = ref<[number, number, number][] | null>(null);
/** ---------- Compensation grid (from compensation.py) ---------- */
const compGrid = ref<{ x: number[]; y: number[]; zi: number[][]; method: number } | null>(null);

// One state per channel (UI-10): the owner knows whether a request is in
// flight, whether the answer was "nothing recorded yet" (a state, shown as
// an empty state — never a toast) or a real failure (shown with the reason
// and a Retry). Correlated by req_id, so a stale reply cannot flip it.
type SurfaceLoad = "unknown" | "loading" | "empty" | "ready" | "error";
const surfaceState = reactive({
  points: "unknown" as SurfaceLoad, pointsError: null as string | null,
  grid: "unknown" as SurfaceLoad, gridError: null as string | null,
});
let _probeReq: string | null = null;
let _gridReq: string | null = null;

function requestProbeResults() {
  const id = send({ cmd: "get_probe_results" });
  if (id) { _probeReq = id; surfaceState.points = "loading"; }
}

// Independent of the grid: a missing grid never blocks the points.
function requestCompGrid() {
  const id = send({ cmd: "get_comp_grid" });
  if (id) { _gridReq = id; surfaceState.grid = "loading"; }
}

// Listen for get_probe_results / get_comp_grid replies
watch(lastReply, (r: any) => {
  if (!r) return;
  if (r.req_id && r.req_id === _probeReq) {
    _probeReq = null;
    if (r.ok) {
      surfacePoints.value = Array.isArray(r.points) ? r.points : [];
      surfaceState.points = surfacePoints.value!.length ? "ready" : "empty";
      surfaceState.pointsError = null;
    } else {
      surfaceState.points = "error";
      surfaceState.pointsError = r.error ?? "unknown error";
    }
  } else if (r.ok && r.points) {
    surfacePoints.value = r.points;   // pushed by another path — data only
  }
  if (r.req_id && r.req_id === _gridReq) {
    _gridReq = null;
    if (r.ok) {
      compGrid.value = r.comp_grid ?? null;
      surfaceState.grid = r.comp_grid ? "ready" : "empty";
      surfaceState.gridError = null;
    } else {
      surfaceState.grid = "error";
      surfaceState.gridError = r.error ?? "unknown error";
    }
  } else if (r.ok && r.comp_grid) {
    compGrid.value = r.comp_grid;
  }
}, { flush: "sync" });
watch(connected, (c) => {
  if (c) return;
  if (_probeReq) { _probeReq = null; surfaceState.points = "error"; surfaceState.pointsError = "connection lost"; }
  if (_gridReq) { _gridReq = null; surfaceState.grid = "error"; surfaceState.gridError = "connection lost"; }
});

/** ---------- G-code stats watcher ---------- */
// Content is fetched over HTTP by lcncWs (see gcodeContent ref). Here we only
// track the stats payload that still rides inside the viewer_gcode frame.
watch(viewerGcode, (newGcode) => {
  gcodeStats.value = newGcode?.stats ?? null;
  gcodeViolations.value = newGcode?.violations ?? null;
  gcodeViolationsReason.value = newGcode?.violations_reason ?? null;
  gcodeViolationsTotal.value = newGcode?.violations_total ?? 0;
  gcodeWorldUnchecked.value = newGcode?.violations_world_unchecked ?? 0;
  gcodeKinsUnresolved.value = newGcode?.kins_flips_unresolved ?? 0;
  gcodeKinsCarrySpans.value = newGcode?.kins_carry_spans ?? 0;
  gcodeUnmarkedSubs.value = newGcode?.unmarked_subs ?? [];
  gcodeKinsEnd.value = newGcode?.kins_end_type ?? null;
  // New payload = program change or reparse — sub files may have been
  // edited, so the inline sub view must re-fetch (W5).
  clearSubfileCache();
});


</script>

<template>
  <div class="wrap stack-controls">
    <!-- ══ Header ══ -->
    <header class="hdr">
      <div class="title">LinuxCNC WebUI ({{ connLabel }})</div>
      <div class="hdrRight">
        <div class="pill mono">{{ clockTime }}</div>
        <div class="pill" :class="connected ? 'ok' : 'bad'">
          <span class="stable-width"><span :class="{ alt: !connected }">WS connected</span><span :class="{ alt: connected }">WS disconnected</span></span>
        </div>
        <div class="pill" :class="lcncError ? 'bad' : (configName ? 'ok' : '')">{{ lcncLabel }}</div>
        <div class="pill" :class="armed ? 'armed' : 'disarmed'"><span class="stable-width"><span :class="{ alt: !armed }">ARMED</span><span :class="{ alt: armed }">DISARMED</span></span></div>
        <div v-if="gamepad.gamepadConnected.value" class="pill ok iconPill" :title="gamepad.gamepadName.value"><Gamepad2 :size="14" /></div>
        <div v-if="keyboardConfig.jogEnabled || keyboardConfig.buttonsEnabled" class="pill ok iconPill" title="Keyboard shortcuts active"><Keyboard :size="14" /></div>

        <div class="hdrBtns row-controls">
          <!-- Diagnostics, not operating states (design wave D5, K06): the
               clients and the latencies behind one labelled button. -->
          <DetailsPopover label="Connection details">
            <template #icon><Activity :size="22" /></template>
            <div class="popTitle">Connection</div>
            <dl class="connDetails">
              <dt>Clients</dt>
              <dd>{{ connectedClients.length }}</dd>
              <template v-for="c in connectedClients" :key="c.ip">
                <dt></dt><dd class="mono">{{ c.ip }}{{ c.armed ? ' · armed' : '' }}</dd>
              </template>
              <dt>Network</dt>
              <dd class="mono" title="Network latency">{{ connected && networkLatency != null ? fmtMs(networkLatency) : NO_VALUE }}</dd>
              <dt>Round trip</dt>
              <dd class="mono" title="Round-trip latency">{{ connected && latency != null ? fmtMs(latency) : NO_VALUE }}</dd>
            </dl>
          </DetailsPopover>
          <MachineBtn type="headerIcon" :warning="unreadCount > 0" :title="'Messages (' + unreadCount + ')'" @click="messagesDialogOpen ? closeMessages() : openMessages()">
            <MessageSquare :size="22" />
          </MachineBtn>
          <MachineBtn type="headerIcon" title="G-code Reference" @click="openGcodeRef()">
            <BookOpen :size="22" />
          </MachineBtn>
          <MachineBtn type="headerIcon" title="Settings" @click="openDialog('settings')">
            <Settings :size="22" />
          </MachineBtn>
          <MachineBtn type="headerIcon" :title="isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'" @click="toggleFullscreen">
            <Shrink v-if="isFullscreen" :size="22" />
            <Expand v-else :size="22" />
          </MachineBtn>
          <!-- The one destructive header action: an icon alone is not
               identifiable on touch, so it carries a caption, BESIDE the icon
               (stacked it was the header's one tall button, 86 × 47 px beside
               38 × 34 — K06). -->
          <MachineBtn type="headerIcon" title="Shut Down LinuxCNC" @click="showShutdownConfirm = true">
            <PowerOff :size="22" />
            <span class="btn-label-sm">Shut Down</span>
          </MachineBtn>
        </div>
      </div>
    </header>

    <div class="statusBanner" :class="{ 'banner-pulse': bannerFlashMode === 'pulse', 'banner-flash': bannerFlashMode === 'flash' }" :style="{ '--state-color': `var(${machineStateColor})` }">
      <div class="bannerContent" @click="openMessages">
        <Transition name="banner-fade" mode="out-in">
          <!-- Every banner carries its recovery path — an operator must
               never have to guess whether waiting, a UI action, or a
               suite restart is the way out (no auto-recovery implied). -->
          <span v-if="bannerLine" :key="bannerLine.key" :class="bannerLine.tier === 'error' ? 'bannerError text-danger' : 'bannerWarn text-warn'"
                :title="bannerLine.detail">
            {{ bannerLine.text }}
          </span>
          <span v-else-if="previewRefresh" :key="'preview-refresh'" class="bannerProgress" :title="previewRefreshTitle">
            <span>Re-parsing · {{ previewRefreshLabel(previewRefresh.reason) }} · {{ previewRefreshFile }}{{ previewRefresh.queued ? ' · queued' : '' }}</span>
            <div class="progressTrack" :title="previewRefreshTimes"><div class="progressFill" :style="{ width: previewRefreshPct + '%' }"></div></div>
          </span>
          <span v-else-if="bannerMessage && !bannerShowAbort" :key="'msg'" :class="{ 'bannerError text-danger': bannerMessageKind <= 2 }">
            {{ bannerMessage }}
          </span>
          <span v-else :key="machineState">
            {{ machineStateLabel }}
          </span>
        </Transition>
      </div>
      <!-- Abort is ALWAYS the last action: a stop must not move when a
           message count or a Refresh appears beside it (P2). -->
      <div class="bannerActions row-controls">
        <!-- data-dialog-reachable: in Tab reach from inside an open dialog
             (modalRegistry focus scope, UI-D01) — the trip acknowledgement
             and the running program's Abort, nothing else of the banner. -->
        <MachineBtn v-if="safetyTrip" type="bannerAck" data-dialog-reachable @click="acknowledgeSafetyTrip">Acknowledge</MachineBtn>
        <MachineBtn v-if="bannerLine?.key === 'preview-error' && activeFile" type="bannerReload" @click="loadFile(activeFile)">Reload program</MachineBtn>
        <MachineBtn v-if="bannerLine?.key === 'program-unconfirmed' && programUnconfirmed" type="bannerReload" @click="loadFile(programUnconfirmed)">Load program</MachineBtn>
        <MachineBtn v-if="machineState === 'unhomed'" type="bannerHome" @click="homeAll">Home All</MachineBtn>
        <MachineBtn v-if="unreadCount > 0" type="bannerAction" @click="openMessages">
          {{ unreadCount }} message{{ unreadCount === 1 ? '' : 's' }}
        </MachineBtn>
        <MachineBtn v-if="needsRefresh" type="bannerAction" @click="reloadPage">Refresh</MachineBtn>
        <MachineBtn v-if="bannerShowAbort" type="bannerAbort" data-dialog-reachable @click="fire({ cmd: 'abort' }, 'abort')" />
      </div>
    </div>

    <!-- ══ Content area — outer Gate wraps tabs ══ -->
    <Gate gate="armed" class="content" id="content-dialog-area">
      <!-- ══ Left pane — 3D Viewer (always visible); in portrait the macro
           bar sits under it, in the same column (package 5, stage A) ══ -->
      <div class="viewerColumn stack-controls">
      <div class="viewerPane">
        <ThreeViewer
          ref="viewerRef"
          :active="true"
          :g5xLabel="g5xLabel"
          :linearUnit="linearUnit"
          :activeFile="activeFile"
          :spindleSpeed="spindleSpeed"
          :spindleActual="spindleActual"
          :spindleDirection="spindleDirection"
          :surfacePoints="surfacePoints"
          :compGrid="compGrid"
          :axes="axes"
          @open-settings="openSettingsTab"
          @scrub-line="scrubLine = $event"
          @collision-lines="collisionLines = $event"
        />
      </div>
      <MacroBar v-if="isPortrait && macroBar.items.length" :items="macroBar.items" @run="runBarItem" />
      </div>

      <!-- ══ Right pane — Program / Probing tabs ══ -->
      <div ref="sidePaneEl" class="sidePane bordered-panel" :class="{ narrow: sideNarrow }">
        <TabPanel :tabs="contentTabs" :modelValue="activeTab" label="Side panel" variant="main" :narrow="sideNarrow"
                  @update:modelValue="requestTab($event)">
          <template #bar>
            <MachineSelect v-if="activeTab === 'probe'" gate="tabSelect" name="probe-view"
                           aria-label="Probing procedure" v-model="probeView">
              <option v-for="v in PROBE_VIEWS" :key="v.id" :value="v.id">{{ v.label }}</option>
            </MachineSelect>
          </template>
          <template #gcode>
            <GcodePanel
              :activeFile="activeFile"
              :gcodeContent="gcodeContent"
              :programRevision="gcodeRevision"
              :programTextRevision="gcodeTextRevision"
              :programTextSource="gcodeTextSource"
              :gcodeStats="gcodeStats"
              :violations="gcodeViolations"
              :violationsTotal="gcodeViolationsTotal"
              :currentLine="currentLine"
              :subName="runSubName"
              :subView="subExecState"
              :linesUntrustedReason="linesUntrustedReason"
              :scrubLine="linesUntrusted ? null : scrubLine"
              :collisionLines="collisionLines"
              :isPaused="isPaused"
              :elapsed="elapsedDisplay"
              :optionalStop="optionalStopOn"
              :blockDelete="blockDeleteOn"
              :runFromLine="runFromLineEnabled"
              @loadFile="loadFile"
              @unloadFile="unloadFile"
              @cycleStart="cycleStart"
              @runFromLine="runFromLine"
              @cycleStep="cycleStep"
              @cyclePause="cyclePause"
              @cycleResume="cycleResume"
              @abort="fire({ cmd: 'abort' }, 'abort')"
              @toggleOptionalStop="toggleOptionalStop"
              @toggleBlockDelete="toggleBlockDelete"
              @openGcodeRef="openGcodeRef"
              @showStats="statsDialogOpen = true"
              @editingChange="gcodeEditActive = $event"
            />
          </template>

          <template #probe>
            <ProbePanel
              v-model:view="probeView"
              :narrow="sideNarrow"
              :linearUnit="linearUnit"
              :probing="st.probing === true"
              :probeTripped="st.probe_tripped === true"
              :probeInput="st.probe_input === true"
              :probedPosition="st.probed_position ?? null"
              :workPos="workPos"
              :probeResults="probeResults"
              :eoffsetZ="st.eoffset_z ?? null"
              :eoffsetEnabled="!!st.eoffset_enabled"
              :compMethod="st.comp_method ?? null"
              :compGridVersion="st.comp_grid_version ?? 0"
              :surfacePoints="surfacePoints"
              :compGrid="compGrid"
              :surfaceState="surfaceState"
              :surfaceLayerVisible="viewerLayers.surface"
              :rotaryTilted="st.rotary_at_zero === false"
              @toggleSurfaceLayer="(on: boolean) => { viewerLayers.surface = on; viewerRef?.setLayerVisible?.('surface', on); saveViewerDefaults({ ...loadViewerDefaults(), layers: { ...loadViewerDefaults().layers, surface: on } }); }"
              @mdi="fire({ cmd: 'mdi', text: $event }, 'machineFrame')"
              @abort="fire({ cmd: 'abort' }, 'abort')"
              @simTrip="send({ cmd: 'simulate_probe_trip' })"
              @setProbeVars="fire({ cmd: 'set_probe_vars', vars: $event }, 'ready')"
              @runProbe="onRunProbe($event)"
              @getProbeResults="requestProbeResults"
              @getCompGrid="requestCompGrid"
              @setCompensation="requestCompToggle"
              @setCompMethod="fire({ cmd: 'set_compensation_method', method: $event }, 'probe')"
            />
          </template>

          <template #mdi>
            <div class="mdiTab stack-controls">
              <!-- Machine actions (design wave D5): the line, Send, Abort last -->
              <div class="mdiRow actionGroup">
                <!-- v-model, like every other text field: one ref (mdiText) is the
                     line's single source — physical typing, the on-screen keys
                     (mdiTarget) and the history all write it. `:value` + `@input`
                     against MachineInput's own model left two writers on the
                     element and lost every typed character (review round 4,
                     UI-I11). Enter sends on keydown (onMdiKeydown). -->
                <MachineInput
                  ref="mdiInputRef"
                  gate="mdiText"
                  type="text"
                  class="mdiInput"
                  v-model="mdiText"
                  label="MDI command"
                  :session-owner="MDI_OWNER"
                  :session-open="openMdiSession"
                  @keydown="onMdiKeydown"
                  placeholder="MDI command (↑↓ history)"
                />
                <!-- UX-13: never the word "code" in this placeholder — Apple
                     Passwords (Firefox/macOS) read "G-code command" as a
                     verification-code field and popped up on every focus
                     (operator's variant test 2026-09-23). -->
                <MachineBtn type="mdi" @click="handleMdiSend">Send</MachineBtn>
                <MachineBtn type="abort" class="actionEnd" @click="fire({ cmd: 'abort' }, 'abort')" />
              </div>
              <div class="mdiHistoryHeader">
                <span class="sub">History</span>
                <MachineBtn type="inlineMd" aria-label="Clear MDI history" title="Clear MDI history" @click="clearMdiHistory" :disabled="mdiHistory.length === 0">Clear</MachineBtn>
              </div>
              <div class="codeViewer mdiHistoryList scroll-thin fade-scroll">
                <div v-for="(entry, i) in mdiHistory" :key="entry.id"
                     class="codeLine"
                     :class="{ active: mdiHistoryIndex === i }"
                     @click="mdiText = entry.text">
                  <span class="lineContent"><span
                    v-for="(token, ti) in highlightGcode(entry.text)" :key="ti"
                    :class="'token-' + token.type">{{ token.text }}</span></span>
                </div>
                <div v-if="mdiHistory.length === 0" class="emptyState mdiHistoryEmpty">No history</div>
              </div>
            </div>
          </template>

          <template #offsets>
            <OffsetPanel
              :axes="axes"
              :g5xLabel="g5xLabel"
              :g92Offset="st.g92_offset ?? null"
              :toolOffset="st.tool_offset ?? null"
              :eoffsetZ="st.eoffset_z ?? null"
              :eoffsetEnabled="st.eoffset_enabled ?? null"
              :rotationXy="st.rotation_xy ?? null"
              :wcsTable="st.wcs_table ?? []"
              :linearUnit="linearUnit"
            />
          </template>

          <template #tools>
            <div class="toolsTab stack-controls">
              <!-- The tab's pattern (design wave D5, UI-K05): the tool in the
                   spindle and the probe's state, the machine actions with Abort
                   last at the right edge, then the table's management. The
                   table's search row keeps --gap-controls from the head, as in
                   Program (the operator found it ON the action row, 0 px). -->
              <div class="panelHead toolsHead">
                <div class="panelObject">
                  <span class="label-muted md">In spindle</span>
                  <span class="toolInSpindle mono">{{ st.tool_number ? `T${st.tool_number}` : 'No tool loaded' }}</span>
                  <span v-if="st.tool_number && toolTableRef?.currentDescription" class="toolInSpindleDesc">{{ toolTableRef.currentDescription }}</span>
                  <div class="row-tight probeState">
                    <span class="statusDot" :class="probeIndicatorClass"></span>
                    <span class="label-muted md">Probe</span>
                    <span class="statusDot" :class="probeStatusClass"></span>
                    <span class="label-muted md mono">{{ probeStatus }}</span>
                    <MachineBtn v-if="isDev" type="simTrip" @click="send({ cmd: 'simulate_probe_trip' })">Sim Trip</MachineBtn>
                  </div>
                </div>
                <div class="actionGroup">
                  <MachineBtn type="toolMeasure" :disabled="!st.tool_number || !toolsetter.ok" :reason="!st.tool_number ? 'No tool loaded' : toolsetterReason" @click="measureAuto">Measure Current</MachineBtn>
                  <MachineBtn type="toolUnload" :disabled="unloadUsesToolsetter && !toolsetter.ok" :reason="toolsetterReason" @click="unloadTool">Unload</MachineBtn>
                  <MachineBtn type="abort" class="actionEnd" @click="fire({ cmd: 'abort' }, 'abort')" />
                </div>
                <div class="actionGroup toolTabManage">
                  <MachineBtn type="manage" @click="toolTableRef?.openAdd()">+ Add</MachineBtn>
                  <!-- ONE files toggle (N82): pressed while the library browser shows -->
                  <MachineBtn type="fileOp" :selected="!!toolTableRef?.showImportBrowser" :aria-pressed="!!toolTableRef?.showImportBrowser"
                              :disabled="toolTableRef?.importBusy" @click="toolTableRef?.toggleImportBrowser()">Files</MachineBtn>
                  <MachineBtn type="fileOp" :disabled="toolTableRef?.importBusy" @click="toolTableRef?.uploadLibrary()">Upload</MachineBtn>
                </div>
              </div>
              <ToolTablePanel
                ref="toolTableRef"
                :currentTool="st.tool_number ?? null"
                :iniFilename="ini.ini_filename ?? null"
                :linearUnit="linearUnit"
              />
            </div>
          </template>
          <template #macros>
            <MacrosPanel ref="macrosPanelRef" :bar-names="macroBarNames" @run="runMacroFile" @update-bar="setMacroBar" />
          </template>
        </TabPanel>

        <DialogFrame v-if="tabLeaveAsk" kind="confirm" title="Discard changes?" @close="tabLeaveAsk = null">
          <div class="dialogBody">{{ tabLeaveAsk.what }} has unsaved changes. This cannot be undone.</div>
          <template #actions>
            <MachineBtn type="dialogCancel" @click="tabLeaveAsk = null">Keep editing</MachineBtn>
            <MachineBtn type="dialogDanger" @click="confirmTabLeave">Discard</MachineBtn>
          </template>
        </DialogFrame>

        <!-- Program stats dialog -->
        <DialogFrame v-if="statsDialogOpen && gcodeStats" kind="info" size="md" box-class="statsDialog"
                     title="Program Stats" close-label="Close program stats" @close="statsDialogOpen = false">
            <div class="dialogContent stack-sections scroll-thin fade-scroll">
              <StatsDonut :stats="gcodeStats" />

              <div class="sep"></div>

              <div class="stack-controls">
                <div class="sub">Time</div>
                <div class="statsGrid">
                  <span class="statsLabel">Estimated</span>
                  <span class="statsValue mono">{{ fmtDuration(gcodeStats.totalTime) }}</span>
                  <span class="statsLabel">Feed</span>
                  <span class="statsValue mono">{{ fmtDuration(gcodeStats.feedTime) }}</span>
                  <span class="statsLabel">Rapid</span>
                  <span class="statsValue mono">{{ fmtDuration(gcodeStats.rapidTime) }}</span>
                </div>
              </div>

              <div class="sep"></div>

              <div class="stack-controls">
                <div class="sub">Distance</div>
                <div class="statsGrid">
                  <span class="statsLabel">Rapid</span>
                  <span class="statsValue mono">{{ fmtDist(gcodeStats.rapidDist, gcodeStats.unit) }} ({{ gcodeStats.rapidMoves }})</span>
                  <span class="statsLabel">Linear</span>
                  <span class="statsValue mono">{{ fmtDist(gcodeStats.linearDist, gcodeStats.unit) }} ({{ gcodeStats.linearMoves }})</span>
                  <span class="statsLabel">Arc</span>
                  <span class="statsValue mono">{{ fmtDist(gcodeStats.arcDist, gcodeStats.unit) }} ({{ gcodeStats.arcMoves }})</span>
                </div>
              </div>

              <div class="sep"></div>

              <div class="stack-controls">
                <div class="sub">Tools &amp; Feeds</div>
                <div class="statsGrid">
                  <span class="statsLabel">Tool Changes</span>
                  <span class="statsValue mono">{{ gcodeStats.toolChanges }}</span>
                  <span class="statsLabel">Tools Used</span>
                  <span class="statsValue mono">{{ gcodeStats.toolsUsed.length ? gcodeStats.toolsUsed.map(t => 'T' + t).join(', ') : 'None' }}</span>
                  <span class="statsLabel">Feed Rates</span>
                  <span class="statsValue mono">{{ gcodeStats.feedRates.length ? gcodeStats.feedRates.join(', ') : 'None' }}</span>
                  <span class="statsLabel">File Size</span>
                  <span class="statsValue mono">{{ fmtSize(gcodeStats.fileSize) }}</span>
                  <span class="statsLabel">Soft Limits</span>
                  <span class="statsValue val-status" :class="softLimitStatus.cls">
                    {{ softLimitStatus.text }}
                  </span>
                  <template v-if="kinsFlipStatus">
                    <!-- The why of a stats row is a HelpIcon on its label, never
                         only a title (design wave D1, UI-N32). -->
                    <span class="statsLabel">Kins Frames<HelpIcon label="Kins frames">Unresolved: no model for a kinematics switch, geometry uncorrected. Carried: corrected assuming untouched axes held.</HelpIcon></span>
                    <span class="statsValue val-status" :class="kinsFlipStatus.cls">
                      {{ kinsFlipStatus.text }}
                    </span>
                  </template>
                  <template v-if="gcodeKinsEndMode !== 0">
                    <span class="statsLabel">Kinematics at End<HelpIcon label="Kinematics at end">M2 keeps this kinematics mode — Cycle Start stays refused until the Machine frame is selected.</HelpIcon></span>
                    <span class="statsValue val-status warn">
                      {{ gcodeKinsEndMode === 1 ? 'TCP' : gcodeKinsEndMode === 2 ? 'TOOL (plane)' : 'unsupported' }} — not restored before M2 ({{ gcodeKinsEndMode === 2 ? 'add G69, or select the Machine frame' : 'select the Machine frame' }})
                    </span>
                  </template>
                  <template v-if="previewRefusal">
                    <span class="statsLabel">Parse<HelpIcon label="Parse">The preview refused this line from the machine's live state — a run would refuse it too.</HelpIcon></span>
                    <span class="statsValue val-status warn">
                      refused — {{ previewRefusal.text }}
                    </span>
                  </template>
                  <template v-if="gcodeUnmarkedSubs.length">
                    <span class="statsLabel">Line Tracking<HelpIcon label="Line tracking">Subroutines without WEBUI_SUB markers — the line highlight may be off during their moves.</HelpIcon></span>
                    <span class="statsValue val-status muted">
                      {{ gcodeUnmarkedSubs.map(n => n + '.ngc').join(', ') }} unmarked
                    </span>
                  </template>
                </div>
              </div>
            </div>
        </DialogFrame>
      </div>

      <!-- Dialogs — inside content area so strip stays accessible beneath -->

      <!-- Settings dialog -->
      <DialogFrame v-if="settingsDialogOpen" kind="host" size="lg" full wide title="Settings" close-label="Close settings"
                   initial-focus="button.selected" @close="closeSettings">
          <div class="dialogContent">
            <SettingsPanel
              ref="settingsPanelRef"
              :initialTab="settingsInitialTab"
              :gamepadConnected="gamepad.gamepadConnected.value"
              :gamepadName="gamepad.gamepadName.value"
              :gamepadConfig="gamepadConfig"
              :gamepadMappingSource="gamepad.gamepadMappingSource.value"
              @setLayerOnTop="(l: OnTopLayer, on: boolean) => viewerRef?.setLayerOnTop?.(l, on)"
              @setProjection="(p: Projection) => { viewerProjection = p; setProjection(p); }"
              @setTrackMode="(m: TrackMode) => { viewerTrackMode = m; viewerRef?.setTrackingMode?.(m); }"
              @toggleLayer="(l: Layer, on: boolean) => { viewerLayers[l] = on; viewerRef?.setLayerVisible?.(l, on); }"
              :keyboardConfig="keyboardConfig"
              @setKeyboardConfig="setKeyboardConfig"
              @setRunFromLine="runFromLineEnabled = $event"
              @setGamepadConfig="setGamepadConfig" />
          </div>
      </DialogFrame>

      <!-- Closing Settings over a local draft (UI-K16) — the tool editor's ask. -->
      <DialogFrame v-if="settingsDiscard" kind="confirm" title="Discard changes?" danger @close="settingsDiscard = null">
        <div class="dialogBody">{{ settingsDiscard.what }} has unsaved changes.</div>
        <template #actions>
          <MachineBtn type="dialogCancel" @click="settingsDiscard = null">Keep editing</MachineBtn>
          <MachineBtn type="dialogDanger" @click="confirmSettingsDiscard">Discard</MachineBtn>
        </template>
      </DialogFrame>

      <!-- G-code reference dialog -->
      <GcodeReferenceDialog :open="gcodeRefOpen" :initialSearch="gcodeRefInitialSearch" @close="gcodeRefOpen = false" />

      <!-- Messages dialog -->
      <DialogFrame v-if="messagesDialogOpen" kind="info" size="lg" full :title="`Messages (${messages.length})`"
                   close-label="Close messages" @close="closeMessages">
          <template #header>
            <MachineBtn type="inline" @click="copyAllMessages" :disabled="messages.length === 0">Copy All</MachineBtn>
            <MachineBtn type="inline" @click="clearMessagesAsk = true" :disabled="messages.length === 0">Clear All</MachineBtn>
          </template>
          <div class="dialogContent stack-tight scroll-thin fade-scroll">
            <!-- The banner's current condition with its "why" — a tap on the
                 banner lands here (UI-N26: nothing essential only in a title). -->
            <div v-if="bannerLine" class="statusNote" :class="bannerLine.tier" role="alert">
              <span><strong>{{ bannerLine.text }}</strong><template v-if="bannerLine.detail"><br>{{ bannerLine.detail }}</template></span>
            </div>
            <div v-for="msg in [...messages].reverse()" :key="msg.id" class="msgItem" :class="msgKindClass(msg.kind)">
              <span class="msgTime">{{ msgFormatTime(msg.ts) }}</span>
              <span class="msgKind">{{ msgKindLabel(msg.kind) }}</span>
              <span class="msgText">{{ msg.text }}</span>
              <MachineBtn type="listAction" @click="copyMessage(msg)" title="Copy" aria-label="Copy message"><ClipboardCopy :size="12" /></MachineBtn>
              <MachineBtn type="listAction" @click="dismissMessage(msg.id)" title="Dismiss" aria-label="Dismiss message"><X :size="12" /></MachineBtn>
            </div>
            <div v-if="messages.length === 0" class="emptyState msgEmpty">No messages</div>
          </div>
      </DialogFrame>

      <!-- Clear All asks first (N47): the message center is the protocol. -->
      <DialogFrame v-if="clearMessagesAsk" kind="confirm" title="Clear all messages?" danger @close="clearMessagesAsk = false">
        <div class="dialogBody">All {{ messages.length }} messages leave the log. This cannot be undone.</div>
        <template #actions>
          <MachineBtn type="dialogCancel" @click="clearMessagesAsk = false">Cancel</MachineBtn>
          <MachineBtn type="dialogDanger" @click="clearAllMessages(); clearMessagesAsk = false">Clear All</MachineBtn>
        </template>
      </DialogFrame>

      <!-- Safety confirmation dialogs — z-index 1010 to always appear above other dialogs -->
      <!-- Both actions are machine actions: focus starts on the container, so
           no button sits under Enter / Space (Anhang B); Abort is the cancel
           side, left (N40). -->
      <DialogFrame v-if="toolChangeRequested" kind="flow" initial-focus="container"
                   :title="!toolChangeTool ? 'Remove Tool from Spindle' : 'Load Tool into Spindle'">
          <div class="dialogBody">
            <template v-if="toolChangeTool">
              <strong>T{{ toolChangeTool }}</strong><template v-if="st.tool_change_info"> D{{ fmtNum(st.tool_change_info.D, 3) }} Z{{ fmtNum(st.tool_change_info.Z, 3) }}</template><br>
              <template v-if="st.tool_change_info?.description">{{ st.tool_change_info.description }}<br></template>
              Insert tool and press Confirm
            </template>
            <template v-else>
              Remove tool and press Confirm
            </template>
          </div>
          <template #actions>
            <MachineBtn type="abort" @click="fire({ cmd: 'abort' }, 'abort')" />
            <MachineBtn type="toolChangeConfirm" :disabled="!toolChangeRequested || !!confirmSent"
                        :reason="confirmSent ? 'Confirmation sent — waiting for the controller' : undefined"
                        @click="confirmToolChange">{{ confirmSent ? 'Confirming…' : 'Confirm' }}</MachineBtn>
          </template>
      </DialogFrame>

      <DialogFrame v-if="macroParamDialog" kind="form" size="md" :title="macroParamDialog.title">
          <div class="dialogContent">
            <!-- A macro FILE (package 5): its header's parameters, numbers with
                 their range and unit, read live from the gateway's list
                 (UI-DI08): saved or deleted by another client while open, it
                 shows the new state — a deleted one has nothing left to run -->
            <div v-if="dialogFileBlock" class="statusNote warn" role="alert">{{ dialogFileBlock }}</div>
            <div v-if="dialogFile" class="formGrid">
              <FormField v-for="p in dialogFile.params" :key="p.key" :label="p.label"
                         :unit="macroParamUnit(p.unit, dialogFile.units)">
                <template #default="{ input }">
                  <MachineInput
                    v-bind="input"
                    gate="macroParam"
                    type="number"
                    :min="p.min ?? undefined"
                    :max="p.max ?? undefined"
                    :integer="p.integer"
                    :context="`${dialogFile.title ?? dialogFile.name} · ${p.label}`"
                    v-model="macroParamDialog.values[p.key]"
                  />
                </template>
              </FormField>
            </div>
            <p v-for="(line, i) in dialogFile?.description ?? []" :key="i" class="settingDesc">{{ line }}</p>
            <code v-if="dialogFile" class="macroPreview">{{ dialogFile.name }}.ngc</code>
          </div>
          <template #actions>
            <MachineBtn type="dialogCancel" @click="macroParamDialog = null">Cancel</MachineBtn>
            <!-- A hold bound to the macro, its command and these values: an edit
                 or a save from another client during the hold cancels it -->
            <MachineBtn type="macroExecute" class="macroExecute"
                        :hold-key="macroExecuteKey()" :disabled="!!dialogFileBlock || (dialogFile?.frame === 'machine' && !permissions.machineFrame)"
                        :reason="dialogFileBlock ?? (dialogFile?.frame === 'machine' && !permissions.machineFrame ? permissionReasons.machineFrame ?? 'Machine frame only' : undefined)"
                        @click="confirmMacroParams">Execute</MachineBtn>
          </template>
      </DialogFrame>

      <DialogFrame v-if="showShutdownConfirm" kind="flow" title="Shut Down LinuxCNC?" danger>
        <div class="dialogBody">This will stop all motion and exit LinuxCNC.</div>
        <template #actions>
          <MachineBtn type="dialogCancel" @click="showShutdownConfirm = false">Cancel</MachineBtn>
          <MachineBtn type="shutdown" @click="send({ cmd: 'shutdown' }); showShutdownConfirm = false">Shut Down</MachineBtn>
        </template>
      </DialogFrame>

      <DialogFrame v-if="compConfirmPending !== null" kind="flow"
                   :title="compConfirmPending ? 'Enable surface compensation?' : 'Disable surface compensation?'">
          <div class="dialogBody">
            <template v-if="compConfirmPending">
              Z axis will move based on the surface compensation map.<br>
              Ensure tool is clear of the workpiece.
            </template>
            <template v-else-if="st.eoffset_z != null">
              Z axis will move by approximately
              <strong>{{ fmtQty(st.eoffset_z * -1, linearUnit) }}</strong>.<br>
              Ensure tool is clear of the workpiece.
            </template>
            <template v-else>
              <!-- eoffset_z not yet delivered (cold start / reader stale): a
                   synthetic 0.0000 here would tell the operator "no move"
                   right before a real Z move. Say we don't know instead. -->
              Z axis will move by an <strong>unknown</strong> amount — the
              current Z offset has not been reported by the gateway.<br>
              Ensure tool is clear of the workpiece.
            </template>
          </div>
          <template #actions>
            <MachineBtn type="dialogCancel" @click="cancelCompToggle">Cancel</MachineBtn>
            <MachineBtn type="dialogReady" @click="confirmCompToggle">{{ compConfirmPending ? 'Enable' : 'Disable' }}</MachineBtn>
          </template>
      </DialogFrame>
    </Gate><!-- /content (outer gate) -->

    <!-- ══ Macro Bar — landscape: a row under the content (portrait: in the
         viewer column above) ══ -->
    <MacroBar v-if="!isPortrait && macroBar.items.length" :items="macroBar.items" @run="runBarItem" />

    <!-- ══ Bottom Action Strip — default-deny Gate, SafetyStrip exempt + sticky ══ -->
    <Gate gate="armed" class="strip bordered-panel scroll-thin" tabindex="-1">
      <template #exempt>
      <SafetyStrip
        :armed="armed"
        :busy="busy"
        :tripUnacked="safetyTrip !== null"
        :isEstop="isEstop"
        :isEnabled="isEnabled"
        :isHomed="isHomed"
        :canEstop="canEstop"
        :canResetEstop="canResetEstop"
        :isTeleop="isTeleop"
        :taskMode="taskMode"
        :interpState="interpState"
        :feedOverride="feedOverrideValue"
        :spindleOverride="spindleOverrideValue"
        :rapidOverride="rapidOverrideValue"
        :gcodes="activeGcodes"
        :mcodes="activeMcodes"
        :elapsed="elapsedDisplay"
        @arm="arm"
        @estop="send({ cmd: 'estop' })"
        @estop-reset="send({ cmd: 'estop_reset' })"
        @machine-on="fire({ cmd: 'machine_on' }, 'safety')"
        @machine-off="fire({ cmd: 'machine_off' }, 'safety')"
      />
      </template>

      <JogStrip
        v-show="stripVis('jog')"
        data-strip="jog"
        :axes="axes"
        :jogVel="jogVel"
        :defaultJogVel="defaultJogVel"
        :defaultAngularJogVel="defaultAngularJogVel"
        :angularJogVel="angularJogVel"
        :linearUnit="linearUnit"
        :maxJogVel="maxJogVel"
        :maxAngularJogVel="maxAngularJogVel"
        :minAngularJogVel="minAngularJogVel"
        :jogIncrement="jogIncrement"
        :minJogVel="minJogVel"
        :iniIncrements="iniIncrements"
        :kinsType="liveKinsType"
        :kinsMode="kinsMode"
        :twpCapable="twpCapable"
        :twpDefined="st.twp_defined ?? null"
        :twpStale="twpStale"
        :twpOriented="twpOriented"
        :frameAct="setKinsMode"
        :jogDisabled="!permissions.jog"
        :taskMode="taskMode"
        @update:jogVel="jogVel = $event"
        @update:angularJogVel="angularJogVel = $event"
        @update:jogIncrement="jogIncrement = $event"
        @resetJogVel="jogVel = defaultJogVel"
        @resetAngularJogVel="angularJogVel = defaultAngularJogVel"
        :modeAct="setTaskMode"
      />

      <SetupStrip
        v-show="stripVis('setup')"
        data-strip="setup"
        :axes="axes"
        :workPos="workPos"
        :homedJoints="homedJoints"
        :isHomed="isHomed"
        :g5xLabel="g5xLabel"
        :kinsType="liveKinsType"
        :kinsMode="kinsMode"
        :twpCapable="twpCapable"
        :twpActive="st.twp_active ?? null"
        :twpDefined="st.twp_defined ?? null"
        :twpStale="twpStale"
        :twpOriented="twpOriented"
        :twpDatumMoved="twpDatumMoved"
        :twpOffDatum="twpOffDatum"
        :g5xIndex="st.g5x_index ?? null"
        :entryOpen="numKeypadOwner === 'setup'"
        @twpOrient="twpReorient"
        @twpCapture="twpCapture"
        @twpClear="twpClear"
        @homeAll="homeAll"
        @unhomeAll="unhomeAll"
        @homeAxis="homeAxis"
        @unhomeAxis="unhomeAxis"
        @setAxis="setAxis"
        @setAll="setAll"
        :wcsAct="setG5x"
        @goToG30="fire({ cmd: 'mdi', text: 'O<go_to_g30> CALL' }, 'machineFrame')"
        @goToHome="fire({ cmd: 'mdi', text: 'O<go_to_home> CALL' }, 'machineFrame')"
        @goToZero="fire({ cmd: 'go_to_zero' }, 'goZero')"
      />

      <!-- Text/code keyboard: replaces every strip section except
           SafetyStrip while a text session is open (MDI line, editor,
           search/description fields) — none of them are usable mid-typing,
           and the active WCS stays visible in the HUD. SafetyStrip is
           pinned first, so nothing shifts when the keyboard swaps in/out. -->
      <TextKeypadStrip v-if="activeKind === 'code' || activeKind === 'text'" :axes="axes" />

      <OverridesStrip
        v-show="stripVis('overrides')"
        data-strip="overrides"
        :feedSlider="feedSlider"
        :spindleSlider="spindleSlider"
        :rapidSlider="rapidSlider"
        :feedOvrEnabled="feedOvrEnabled"
        :spindleOvrEnabled="spindleOvrEnabled"
        :rapidOvrAvailable="rapidOvrAvailable"
        :maxFeedOverride="maxFeedOverride"
        :minSpindleOverride="minSpindleOverride"
        :maxSpindleOverride="maxSpindleOverride"
        @update:feedSlider="feedSlider = $event"
        @update:spindleSlider="spindleSlider = $event"
        @update:rapidSlider="rapidSlider = $event"
        @feedChange="onFeedChange"
        @spindleSliderChange="onSpindleSliderChange"
        @rapidChange="onRapidChange"
        @overridePreset="setOverridePreset"
      />

      <SpindleStrip
        v-show="stripVis('spindle')"
        data-strip="spindle"
        :isForward="isForward"
        :isReverse="isReverse"
        :isSpinning="isSpinning"
        :isRunning="isRunning"
        :rpmInput="rpmInput"
        :minSpindleSpeed="minSpindleSpeed"
        :maxSpindleSpeed="maxSpindleSpeed"
        :floodOn="floodOn"
        :mistOn="mistOn"
        @spindleFwd="spindleForward"
        @spindleRev="spindleReverse"
        @spindleStop="spindleStop"
        @spindleIncrease="spindleIncrease"
        @spindleDecrease="spindleDecrease"
        @update:rpmInput="rpmInput = $event"
        @toggleFlood="toggleFlood"
        @toggleMist="toggleMist"
      />

      <ToolStrip
        v-show="stripVis('tool')"
        data-strip="tool"
        :currentTool="st.tool_number ?? 0"
        :toolDiameter="st.tool_diameter ?? null"
        :toolLength="st.tool_length ?? null"
        :linearUnit="linearUnit"
        :offsetState="toolOffset"
        @openToolTable="requestTab('tools')"
      />

      <!-- Number keypad: swaps in like the G-code keypad, but keeps the
           section that owns the edited field visible (see stripVis). Last in
           DOM so it renders directly right of whichever section survives. -->
      <NumberKeypadStrip v-if="keypadState.open" v-show="!keypadState.locked" />

      <!-- Scroll-edge affordance: fades in at the far edge while strip
           sections are scrolled out of view (strip-more class, JS-toggled).
           SafetyStrip pins the near edge, so only the far edge needs it. -->
      <div class="stripFade" aria-hidden="true"></div>
    </Gate><!-- /strip -->

    <!-- The app-wide floating hint and keyboard glyph (single instances). -->
    <FloatingOverlays />
  </div>
</template>
<style scoped>
.wrap {
  height: 100%;
  box-sizing: border-box;
  padding: var(--gap-controls);
  font-family: var(--font-sans);
}

.content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  gap: var(--gap-controls);
  overflow: hidden;
  position: relative; /* containing block for dialogs */
}

.viewerColumn {
  flex: 1;
  min-width: var(--panel-min-w);
  min-height: 0;
}
.viewerPane {
  flex: 1;
  min-height: 0;
}


.sidePane {
  width: var(--panel-min-w-wide);
  flex-shrink: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  padding: var(--gap-controls);
  border-radius: var(--radius-container);
}


/* Programmatic focus target (the keypad's fallback when the field that
   opened it is gone): no ring — that focus operates nothing. */
.strip:focus { outline: none; }

.strip {
  display: flex;
  /* Auto height, sized by the fixed --strip-section-h sections: the
     scrollbar band height is UA-defined (Chromium ignores
     ::-webkit-scrollbar once scrollbar-width is set → ~10px; Firefox thin
     ~12px; macOS overlay 0), so any layout that carves the section budget
     out of a fixed strip height clips content on some engines. Here the
     band (when reserved) grows the strip outward and the viewer pane
     absorbs the difference — the content budget never varies. */
  flex-shrink: 0;
  /* no left padding: the sticky SafetyStrip carries it (see .safetyStrip) —
     scroller padding would form a bleed-through gutter beside the stuck
     element */
  padding: var(--gap-controls) var(--gap-controls) var(--gap-controls) 0;
  gap: var(--gap-controls);
  /* ALWAYS reserve the horizontal scrollbar band (WP4, review B): with
     `auto`, opening the number keypad hides every non-owner section, the
     overflow disappears, the band (8–11 px, UA-defined) goes with it and
     the strip gets shorter — the viewer pane grew every time the keypad
     opened. `scroll` keeps the band whether or not there is overflow, so
     the strip's height is invariant across keypad/keyboard swaps.
     (scrollbar-gutter only reserves the BLOCK-axis band — it cannot fix
     this axis.) The e2e layout gate injects `auto` as a negative control. */
  overflow-x: scroll;
  overflow-y: hidden;
  border-radius: var(--radius-container);
}
/* Center all sections when space allows; collapse to 0 on overflow */
.strip::before,
.strip::after {
  content: '';
  flex: 1;
}
.strip > * + * {
  border-left: 1px solid var(--border-subtle);
  padding-left: var(--gap-controls);
}

/* Scroll-edge fades — signal that more sections exist beyond an edge.
   Zero-width sticky children; the gradient hangs inward over the content.
   The strip needs only the far edge (SafetyStrip pins its near edge); the
   macro bar's own fades live in MacroBar.vue. */
.strip > .stripFade {
  position: sticky;
  flex: 0 0 0px;
  align-self: stretch;
  border-left: none;   /* exempt from the .strip > * + * divider */
  padding-left: 0;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
  z-index: var(--z-raised);
}
.strip > .stripFade { right: 0; }
.strip > .stripFade::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: calc(2 * var(--gap-panel) + var(--gap-controls));
  /* Solid paint + alpha mask with the same eased curve as .fade-scroll
     (style.css) — NOT a color gradient; see the mask rationale there
     (macOS Firefox color management renders gradient ramps unevenly). */
  background: var(--panel);
}
/* Hang past the sticky element by the scroller's edge padding: sticky is
   confined to the CONTENT box, but scrolled content stays visible through
   the padding and radius region — without this the fade stops 8px short
   of the visible edge. */
.strip > .stripFade::before {
  right: calc(-1 * var(--gap-controls));
  -webkit-mask-image: linear-gradient(to right,
    transparent 0%, rgba(0, 0, 0, 0.15) 40%, rgba(0, 0, 0, 0.45) 70%,
    rgba(0, 0, 0, 0.8) 88%, black 100%);
  mask-image: linear-gradient(to right,
    transparent 0%, rgba(0, 0, 0, 0.15) 40%, rgba(0, 0, 0, 0.45) 70%,
    rgba(0, 0, 0, 0.8) 88%, black 100%);
}
.strip.strip-more > .stripFade {
  opacity: 1;
}

.hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: var(--gap-section);
}

.hdrRight {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-tight);
  align-items: center;
  justify-content: flex-end;
}
.hdrBtns { flex-shrink: 0; }
/* The connection details card (DetailsPopover): label | value rows. */
.connDetails {
  display: grid;
  grid-template-columns: auto auto;
  gap: var(--gap-micro) var(--gap-section);
  margin: 0;
}
.connDetails dt { color: var(--fg-muted); }
.connDetails dd { margin: 0; text-align: right; }

.title {
  font-size: var(--fs-2xl);
  font-weight: var(--fw-bold);
}

.pill {
  padding: 6px 10px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-base);
  border: 1px solid var(--border);
  user-select: none;
  background: color-mix(in oklab, var(--panel) 80%, transparent);
  color: var(--fg);
}
/* An icon-only pill (keyboard, gamepad) is ONE centred row: its SVG sat on
   the text baseline — 2.5 px above the middle and 1 px taller than the text
   pills (operator, 2026-09-26). The zero-width strut gives it the text
   pills' line box, so every pill is one height. Text pills stay inline: a
   flex row drops the space in "Net 1 ms". */
.iconPill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.iconPill::before { content: "\200b"; }

.pill.ok {
  background: color-mix(in oklab, var(--panel) 92%, transparent);
}

.pill.bad {
  background: color-mix(in oklab, var(--danger) var(--tint-fill), var(--panel));
}


.pill.armed {
  background: color-mix(in oklab, var(--ok) var(--tint-fill), var(--panel));
}

.pill.disarmed {
  background: color-mix(in oklab, var(--panel) 92%, transparent);
}

.statusBanner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-section);
  padding: 4px 14px;
  min-height: 44px;
  color: var(--fg);
  font-size: var(--fs-xl);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  flex-shrink: 0;
  border-radius: var(--radius-container);
  background: color-mix(in oklab, var(--state-color, var(--info)) var(--tint-fill), var(--panel));
  transition: background 0.4s ease;
}

.bannerContent {
  flex: 1;
  /* A flex item holding single-line text refuses to shrink below that text
     unless told to; without this a long banner set the content's minimum
     width and pushed the actions row (messages, Refresh, Home All, Abort)
     past the right edge (operator, 2026-09-12: "the messages button
     vanished briefly"). */
  min-width: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.bannerContent > span,
.bannerProgress > span:first-child {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Re-parse banner: text + a progress track side by side (layout only —
   .progressTrack/.progressFill are the global program-progress styles).
   Track and fill are DIVs like GcodePanel's: as inline spans the fill
   ignored its width, so the track always read as an empty grey bar after
   the ellipsis (operator, 2026-09-12; the gateway always has an expected
   duration — a size estimate at worst — so the track is always shown).
   The text takes the slack and the track keeps ONE width at the right
   end, so it sits in the same place whatever the reason label or the
   elapsed readout does (operator: "does not appear in the same place"). */
.bannerProgress {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-controls);
  width: 100%;
}
.bannerProgress > span:first-child {
  flex: 1;
  min-width: 0;
}
.bannerProgress > .progressTrack {
  flex: 0 0 160px;
}
/* The banner's two tiers (design wave D1, UI-N23) are class names the
   code and the specs read (.bannerError: safety, machine, connection;
   .bannerWarn: program, preview, configuration); their colour is the text
   role beside them (.text-danger / .text-warn). */

.bannerActions {
  flex-shrink: 0;
}

.banner-fade-enter-active,
.banner-fade-leave-active {
  transition: opacity 0.3s ease;
}
.banner-fade-enter-from,
.banner-fade-leave-to {
  opacity: 0;
}

.statusBanner.banner-pulse {
  animation: banner-pulse var(--pulse-duration) ease-in-out infinite;
}

/* The pulse moves the BACKGROUND — never the text (design wave D8,
   UI-D07): it faded the whole banner to 50 %, the state words included. */
@keyframes banner-pulse {
  0%, 100% { background: color-mix(in oklab, var(--state-color, var(--info)) var(--tint-fill), var(--panel)); }
  50% { background: color-mix(in oklab, var(--state-color, var(--info)) var(--tint-faint), var(--panel)); }
}

.statusBanner.banner-flash {
  animation: flash-danger var(--flash-duration) step-start infinite;
}

@keyframes flash-danger {
  0%, 100% { background: color-mix(in oklab, var(--state-color) var(--tint-heavy), var(--panel)); }
  50% { background: var(--panel); }
}

/* Motion is optional (D8): no pulse, no flash — the state stays the
   static fill (the flash's "on" colour). */
@media (prefers-reduced-motion: reduce) {
  .statusBanner.banner-pulse,
  .statusBanner.banner-flash { animation: none; }
  .statusBanner.banner-flash { background: color-mix(in oklab, var(--state-color) var(--tint-heavy), var(--panel)); }
  .banner-fade-enter-active,
  .banner-fade-leave-active { transition: none; }
}
/* Forced colours drop every background: the banner keeps an outline so
   the state line still reads as one (its words carry the state). */
@media (forced-colors: active) {
  .statusBanner { border: 2px solid CanvasText; }
}

/* ---- Macro param dialog ---- */
.macroPreview {
  display: block;
  margin-top: var(--gap-section);
  font-size: var(--fs-sm);
  color: var(--fg-muted);
}


/* ---- Stats dialog ----
   (.statsGrid/.donut/.legendDot etc. are global — see style.css and
    StatsDonut.vue) */

/* ---- Messages dialog ---- */
.msgItem {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  padding: var(--gap-tight) var(--gap-controls);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
}
.msgItem.error { border-color: color-mix(in oklab, var(--danger) var(--tint-heavy), var(--border)); }
.msgItem.display { border-color: color-mix(in oklab, var(--display) var(--tint-heavy), var(--border)); }
.msgTime {
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted);
  flex-shrink: 0;
}
.msgKind {
  font-size: var(--fs-2xs);
  font-weight: var(--fw-bold);
  flex-shrink: 0;
  min-width: 50px;
}
.msgText {
  flex: 1;
  font-size: var(--fs-sm);
  word-break: break-word;
}
.msgEmpty { padding: var(--gap-panel); }


/* ─── MDI tab ─── */
.mdiTab {
  flex: 1;
  min-height: 0;
}

.mdiRow {
  display: flex;
  gap: var(--gap-controls);
  align-items: stretch;
}

.mdiInput {
  flex: 1;
  min-width: 0;
}

.mdiHistoryHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mdiHistoryList {
  min-height: 0;
}

.mdiHistoryList .codeLine {
  cursor: pointer;
}

.mdiHistoryEmpty { padding: var(--gap-section); }

.toolsTab {
  flex: 1;
  min-height: 0;
}
.toolsHead { padding-top: var(--gap-tight); }
.toolInSpindle { font-weight: var(--fw-semibold); }
.toolInSpindleDesc {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.probeState { margin-inline-start: auto; flex-shrink: 0; }




/* ── Portrait layout ─────────────────────────────────────────── */
@media (orientation: portrait) {
  .wrap {
    display: grid;
    grid-template-columns: var(--strip-fixed-w) 1fr;
    grid-template-rows: auto auto 1fr;
  }

  /* Header + status banner span both columns */
  .wrap > header.hdr {
    grid-column: 1 / -1;
    grid-row: 1;
  }
  .statusBanner {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  /* Action strip: left column, vertical */
  .wrap > .strip {
    grid-column: 1;
    grid-row: 3;
    height: auto;
    width: var(--strip-fixed-w);
    flex-direction: column;
    overflow-x: hidden;
    /* Portrait scrolls vertically: the vertical band is ALWAYS present so
       hiding sections (keypad open) never widens the inner column and
       re-flows every control in it (the root box stayed 280 px — only the
       INNER width moved, which a bounding-box compare cannot see, UI-08).
       `overflow-y: scroll`, not `scrollbar-gutter: stable`: the strip is a
       <fieldset> (Gate), whose scroll container is its anonymous inner box,
       and Chromium does not reserve the gutter there — the sticky Safety
       section measured 252 → 262 px when the overflow vanished (layout
       gate, 2026-09-20). Same rule as landscape's `overflow-x: scroll`. */
    overflow-y: scroll;
    /* scroll axis is vertical here: top padding moves into the sticky
       SafetyStrip, left padding is restored (no horizontal scroll) */
    padding: 0 var(--gap-controls) var(--gap-controls) var(--gap-controls);
  }
  .wrap > .strip > * + * {
    border-left: none;
    padding-left: 0;
    border-top: 1px solid var(--border-subtle);
    padding-top: var(--gap-controls);
  }
  .wrap > .strip::before,
  .wrap > .strip::after {
    display: none;
  }
  /* Vertical scroller: fade moves to the bottom edge */
  .wrap > .strip > .stripFade {
    right: auto;
    bottom: 0;
    border-top: none;
    padding-top: 0;
  }
  .wrap > .strip > .stripFade::before {
    top: auto;
    right: 0;
    left: 0;
    /* Same content-box constraint as landscape, bottom padding here */
    bottom: calc(-1 * var(--gap-controls));
    width: auto;
    height: calc(2 * var(--gap-panel) + var(--gap-controls));
    -webkit-mask-image: linear-gradient(to bottom,
      transparent 0%, rgba(0, 0, 0, 0.15) 40%, rgba(0, 0, 0, 0.45) 70%,
      rgba(0, 0, 0, 0.8) 88%, black 100%);
    mask-image: linear-gradient(to bottom,
      transparent 0%, rgba(0, 0, 0, 0.15) 40%, rgba(0, 0, 0, 0.45) 70%,
      rgba(0, 0, 0, 0.8) 88%, black 100%);
  }

  /* Content: right column, viewer on top / side panel below. The viewer
     and the macro bar are ONE flex item: the bar takes its row out of the
     viewer, and the side pane sees the same column with or without macros
     (package 5, stage A — the viewer floor counts the bar) */
  .wrap > .content {
    grid-column: 2;
    grid-row: 3;
    flex-direction: column;
  }
  .viewerColumn {
    flex: 1 1 0;
    min-width: 0;
    min-height: var(--viewer-min-h-portrait);
  }
  .viewerPane {
    flex: 1 1 0;
  }
  .sidePane {
    flex: 1 1 0;
    width: auto;
    min-width: 0;
  }
}

</style>
