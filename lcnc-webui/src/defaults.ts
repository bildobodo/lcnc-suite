import { computed, ref } from "vue";
import { TOOLSETTER_FALLBACK } from "./toolsetterSetup";
import { PROBE_FALLBACK } from "./probeVars";
import { withToken } from "./auth";
import { connKey } from "./connKey";
import { mergeViewerSection, ON_TOP_FALLBACK, type OnTopLayer } from "./viewerSection";
import { noteSavePending, noteSaveSent, noteSaveBlocked, noteSaveFailed, noteSaveBeaconed, sectionRev, sectionAcked, sectionFailed, stableJson } from "./settingsSaveStatus";
import { deviceStorage, deviceToken } from "./deviceToken";
import type { GamepadProfile } from "./gamepadProfile";
import { mergeMacrosSection } from "./macroParams";

// lcncWs registers its WS settings-saver here so this module can flush a save
// WITHOUT importing lcncWs (which imports defaults) — removes the import cycle and
// the ineffective-dynamic-import build warning (P6). Registered when lcncWs loads
// (app startup), long before any user-triggered save flush.
// The saver returns the `req_id` the save went out with (null = nothing
// reached the transport) so the save status can follow the reply (UX-08).
let _settingsSaver: ((section: string, data: any, baseRev: number) => string | null) | null = null;
export function registerSettingsSaver(fn: (section: string, data: any, baseRev: number) => string | null): void {
  _settingsSaver = fn;
}

// ─── Input step constants ─────────────────────────────────────────
export const STEP_DEFAULT = 1;
export const STEP_FEED = 10;
export const STEP_RPM = 10;
export const STEP_OVERRIDE = 5;
export const STEP_RAPID_OVERRIDE = 25;

// ─── Shared types (single source of truth) ───────────────────────

export type Vec3 = [number, number, number];

export type Layer = "backplot" | "toolpath" | "rapids" | "machine" | "bounds" | "toolpathBounds" | "reachRoom" | "reachPart" | "workzero" | "hud" | "surface" | "tool" | "toolsetter" | "toolChange" | "workplane" | "groundGrid";
export const ALL_LAYERS: Layer[] = ["backplot", "toolpath", "rapids", "machine", "bounds", "toolpathBounds", "reachRoom", "reachPart", "workzero", "hud", "surface", "tool", "toolsetter", "toolChange", "workplane", "groundGrid"];
export { ON_TOP_LAYERS, ON_TOP_FALLBACK, type OnTopLayer } from "./viewerSection";

export type TrackMode = "none" | "tool" | "wcs";
export type Projection = "perspective" | "parallel";

export interface ColorDefaults {
  feed: string;
  rapid: string;
  backplot: string;
  bounds: string;
  toolpathBounds: string;
  tool: string;
  cutter: string;
}

/** The viewer palette's mode (design wave D8c, UI-D05) — for the WHOLE
 *  palette, stored explicitly: "auto" draws the theme's `--viewer-*` roles
 *  (viewer/viewerPalette.ts), "custom" the colours in `colors`. */
export type PaletteMode = "auto" | "custom";
/** Where a Custom palette came from (viewer contrast plan, V6): "legacy" = a
 *  palette stored before the mode existed (certain: it had no mode), kept as
 *  Custom by the migration; "operator" = chosen in Settings. Absent = unknown
 *  (a palette saved under D8c after the migration — no origin is claimed). */
export type PaletteOrigin = "legacy" | "operator";

export type HudScale = "sm" | "md" | "lg" | "xl";

export interface HudDefaults {
  scale: HudScale;
  showMachine: boolean;      // machine-position column next to work position
  showTool: boolean;         // T / Ø / L segment of the context line
  showFeedSpindle: boolean;  // F / S segment of the context line
  showLoadBar: boolean;      // spindle load bar under the context line
}

// Toolpath preview frame: "part" transforms rotary-swept moves into the
// rotating work frame (matches the backplot); "programmed" plots raw XYZ.
// Only differs on machines with rotary axes in the work/tool chain.
export type PreviewMode = "part" | "programmed";

export interface ViewerDefaults {
  layers: Record<Layer, boolean>;
  paletteMode: PaletteMode;
  paletteOrigin?: PaletteOrigin;
  /** The Custom palette. Kept while Automatic is chosen (Custom → Automatic
   *  → Custom brings it back); empty until Custom was chosen once. */
  colors: Partial<ColorDefaults>;
  machineColors: Record<string, string>;
  machineEdges: boolean;
  trackingMode: TrackMode;
  /** Per layer: drawn over the machine (depth test off, drawn after it). */
  onTop: Record<OnTopLayer, boolean>;
  projection: Projection;
  previewMode: PreviewMode;
  hud: HudDefaults;
}

// ─── Section registry ────────────────────────────────────────────


/** A DEVICE's sections (settings split, operator 2026-11-07, plan Codex
 *  R335–R337): how THIS browser looks and what it runs for itself — its own
 *  profile on the gateway, saved without arm (button gates Q2 / BG-19 for
 *  the look; OP3 the macro bar). Every other section is the MACHINE's and
 *  PROTECTED: the gateway saves it only for an armed writer. The mirror of
 *  settings_store.DEVICE_SECTIONS / FREE_SECTIONS (settingsSections.test.ts). */
export const DEVICE_SECTIONS: ReadonlySet<string> = new Set(["display", "viewer", "panels", "camera", "macroBar", "simulation"]);
export const FREE_SECTIONS: ReadonlySet<string> = DEVICE_SECTIONS;

/** The device sections that act only once the SERVER holds them, like every
 *  machine section — a simulation switched on by a refused or stale save
 *  must never start the check. The mirror of
 *  settings_store.CONFIRMED_DEVICE_SECTIONS. */
export const CONFIRMED_DEVICE_SECTIONS: ReadonlySet<string> = new Set(["simulation"]);

/** Does a save of this section (on this browser's own device) need arm? */
export function isProtectedSection(key: string): boolean {
  return !FREE_SECTIONS.has(key);
}

/** Does this section act only once the server holds it (this tab's change
 *  a DRAFT until then — loadSection vs loadSectionDraft)? Every machine
 *  section and the simulation switch; the look applies at once. */
export function actsWhenConfirmed(key: string): boolean {
  return !DEVICE_SECTIONS.has(key) || CONFIRMED_DEVICE_SECTIONS.has(key);
}

interface SectionDef<T> {
  fallback: T;
  merge: (saved: any, fallback: T) => T;
}

const sections = new Map<string, SectionDef<any>>();

/**
 * Register a defaults section. Call at module top-level.
 * Future features (tooltable, tool handling, etc.) register their own section.
 */
export function registerSection<T>(key: string, fallback: T, merge: (saved: any, fb: T) => T): void {
  sections.set(key, { fallback, merge });
}

// ─── Storage I/O ─────────────────────────────────────────────────

/** Reactive version counter — incremented on every server settings update.
 *  Components watch this to re-read their section when another client saves. */
export const settingsVersion = ref(0);

/** In-memory cache — localStorage is read at most once per page load. What
 *  this tab last wrote or received: the server's blob with this tab's
 *  unconfirmed drafts over it (the forms show it). */
let _cache: Record<string, any> | null = null;

/** This tab's unconfirmed changes of PROTECTED sections (BG-19), tagged with
 *  the ledger revision they were saved under and the server state they were
 *  made on (`baseJson`). The form keeps showing a draft through every server
 *  blob that does not hold it; the active configuration is the server's.
 *  A draft ends when
 *   - the server holds it (an equal section in a blob, or the reply for its
 *     revision): it acts now;
 *   - it FAILED (refused — not armed —, unsendable, a page-hide save not on
 *     the server) and the server's section changed since: another writer's
 *     newer state is what the form shows; the save status keeps the failure;
 *   - the next change replaces it.
 *  While it is on its way it rides along with the server's changes (a newer
 *  base). Nothing resends it: a later Arm applies nothing (Codex R203/R204). */
const _drafts = new Map<string, { data: any; json: string; rev: number; baseJson: string }>();

/** True once server settings have been confirmed (REST fetch or WS delivery). */
export const serverSettingsReady = ref(false);

/** Each section's revision on the server (SS334-06): a save names the one
 *  its change was made on, and the gateway refuses it as stale when another
 *  writer changed the section since — answering with the current state. */
const _revs: Record<string, number> = {};

/** The device profile this tab's connection is bound to (settings split):
 *  its public id and name; `id` null = not bound (the browser's storage is
 *  unusable, or before the hello's settings arrived) — the template's view,
 *  no device section saves. */
export interface DeviceInfo { id: string | null; name: string; created?: boolean }
export const deviceInfo = ref<DeviceInfo>({ id: null, name: "" });

/** Bumped when the gateway says the device LIST changed (a profile made,
 *  renamed, reset, deleted or switched; a device came or went) — the device
 *  views fetch it again. */
export const devicesVersion = ref(0);

function takeServerMeta(revs: unknown, device: unknown): void {
  if (revs && typeof revs === "object") {
    for (const k of Object.keys(_revs)) delete _revs[k];
    for (const [k, v] of Object.entries(revs as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isInteger(v) && v >= 0) _revs[k] = v;
    }
  }
  if (device && typeof device === "object") {
    const d = device as { id?: unknown; name?: unknown; created?: unknown };
    deviceInfo.value = { id: typeof d.id === "string" ? d.id : null, name: typeof d.name === "string" ? d.name : "",
                         ...(d.created === true ? { created: true } : {}) };
  }
}

/** This tab's OWN saves on their way: the request id → the section, the
 *  ledger revision it carries (settingsSaveStatus) and the binding it went
 *  out under. A reply moves this tab's settings ONLY through here (Codex
 *  R338 SS-I01: a save into ANOTHER device's profile — Settings › Devices,
 *  through request() — answered with that profile's revision and state, and
 *  the generic reply path wrote them into this tab's own). */
const _ownSaves = new Map<string, { section: string; ledgerRev: number; gen: number }>();
/** The binding this tab's settings belong to: a renewed binding (another
 *  device profile, R336) starts a new generation — nothing of the old one
 *  applies after it (R338 SS-I02). */
let _bindingGen = 0;
export function bindingGeneration(): number { return _bindingGen; }

/** The old binding ends NOW (R338 SS-I02): its settings stop acting —
 *  nothing is saved, the simulation stops (simulationOn reads
 *  serverSettingsReady) — until the NEW connection's settings arrive; the
 *  replies to its saves no longer move anything. */
export function invalidateServerSettings(): void {
  _bindingGen++;
  _ownSaves.clear();
  serverSettingsReady.value = false;
  deviceInfo.value = { id: null, name: "" };
  settingsVersion.value++;
}

/** A reply to a save. Only this tab's OWN save of the current binding moves
 *  its settings (SS-I01/SS-I02): ok → the section's new revision; stale →
 *  the server's state, where it is not older than what the tab knows
 *  (SS-I03). Returns whether it was one. */
export function noteOwnSaveReply(reqId: string, reply: { ok?: unknown; rev?: unknown; stale?: unknown; data?: unknown }): boolean {
  const own = _ownSaves.get(reqId);
  if (!own) return false;
  _ownSaves.delete(reqId);
  if (own.gen !== _bindingGen) return false;
  if (reply.ok !== false) noteSectionRev(own.section, reply.rev);
  else if (reply.stale === true) applyStale(own.section, reply.data, reply.rev, own.ledgerRev);
  return true;
}

/** A save's reply named the section's new revision. */
export function noteSectionRev(section: string, rev: unknown): void {
  if (typeof rev === "number" && Number.isInteger(rev) && rev > (_revs[section] ?? -1)) _revs[section] = rev;
}

/** The revision this tab knows for a section (tests, the device view). */
export function sectionServerRev(section: string): number {
  return _revs[section] ?? 0;
}

/** Debounce timers for server saves. */
const _saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};

/** Pending saves awaiting debounce flush — used by sendBeacon on page exit —
 *  with the revision each change was made on. */
const _pendingSaves = new Map<string, { data: any; base: number }>();

/** The server's confirmed blob — what the gateway HOLDS. `_cache` also
 *  carries this tab's optimistic writes (saveSection), which a refused or
 *  unanswered save never confirms; a machine-facing decision (is the
 *  toolsetter set up?) reads this, never the cache. */
let _confirmed: Record<string, any> = {};

/** Called once from main.ts before createApp().mount(). */
export function initServerDefaults(data: Record<string, any>, fetchOk: boolean,
                                   revs?: unknown, device?: unknown): void {
  _cache = { ...data };
  if (fetchOk) {
    _confirmed = { ...data };
    takeServerMeta(revs, device);
    serverSettingsReady.value = true;
  }
}

/**
 * Called from lcncWs.ts on settings_init (connect) or settings_changed (broadcast).
 * Full-replace is intentional and load-bearing: the gateway ALWAYS sends the
 * complete per-INI settings blob on both messages (gateway.py status_loop
 * "send full settings when version changes" + settings_init). Do NOT change
 * this to a merge — a merge would resurrect a section the operator deleted.
 */
export function updateServerCache(data: Record<string, any>, revs?: unknown, device?: unknown): void {
  takeServerMeta(revs, device);
  _cache = { ...data };
  _confirmed = { ...data };
  for (const [key, d] of _drafts) {
    const json = stableJson(data[key]);
    if (json === d.json || sectionAcked(key, d.rev)) { _drafts.delete(key); continue; }
    const failed = sectionFailed(key, d.rev);
    if (failed && json !== d.baseJson) { _drafts.delete(key); continue; }
    if (!failed) d.baseJson = json;
    _cache[key] = d.data;     // still a draft: the form keeps it, nothing acts on it
  }
  serverSettingsReady.value = true;
  settingsVersion.value++;
}

/** A save was refused as STALE (SS334-06): another writer changed the
 *  section since its change was made. The reply carries the server's state
 *  at its revision — taken only where the tab knows nothing newer (R338
 *  SS-I03: an old refusal overwrote a newer snapshot and left content and
 *  revision apart). The refused change goes (never retried) — unless the
 *  tab made a NEWER change of the section since (`ledgerRev` < the ledger's
 *  revision): that one stays shown, and its own save answers for it. */
function applyStale(section: string, data: unknown, rev: unknown, ledgerRev: number): void {
  if (typeof rev !== "number" || !Number.isInteger(rev) || rev < (_revs[section] ?? 0)) return;
  _revs[section] = rev;
  if (data === undefined || data === null) delete _confirmed[section]; else _confirmed[section] = data;
  if (sectionRev(section) <= ledgerRev) {
    const all = readAll();
    if (data === undefined || data === null) delete all[section]; else all[section] = data;
    _drafts.delete(section);
  }
  settingsVersion.value++;
}

/** The tab binds to ANOTHER device profile (its stored token changed, R336):
 *  what it has not saved yet does not move to that device — dropped, and
 *  said so in the save status. */
export function dropPendingSaves(reason: string): void {
  for (const key of new Set([..._pendingSaves.keys(), ..._drafts.keys()])) noteSaveFailed(key, reason);
  for (const key of Object.keys(_saveTimers)) { clearTimeout(_saveTimers[key]); delete _saveTimers[key]; }
  _pendingSaves.clear();
  _drafts.clear();
}

/** A section as the SERVER confirmed it — raw, no fallbacks merged in;
 *  `undefined` before the server's settings arrived or when it has none.
 *  Reactive through settingsVersion. */
export function confirmedSection(key: string): unknown {
  void settingsVersion.value;
  return serverSettingsReady.value ? _confirmed[key] : undefined;
}

/** Bumped by every local save — savedSection() follows this tab's own writes. */
const _localRev = ref(0);

/** A section as this tab last wrote or received it — raw, no fallbacks:
 *  which fields were ever SET (a form shows the others as unset). */
export function savedSection(key: string): unknown {
  void settingsVersion.value;
  void _localRev.value;
  return readAll()[key];
}

/** Flush pending debounced saves via sendBeacon (called on page hide).
 *  The status ledger learns of the hand-off (round 6, UI-I12 rest): the
 *  revision is UNCONFIRMED until the gateway's next full settings blob
 *  shows it — the debounce timer is cleared below, so no WS request and no
 *  correlated reply will ever settle it; a refused hand-off is a failure. */
function flushPendingSaves(): void {
  for (const [section, { data, base }] of _pendingSaves) {
    // sendBeacon can't set headers, so the token rides in the query string
    // (the require_token dependency accepts ?token= as well as the header).
    // ...and the connection key in the body (button gates BG-19): a
    // protected section is saved only while this connection is open and
    // armed — a beacon after the close is refused, no grace (Codex R204).
    // A device section names its device by the token (settings split).
    const handedOff = navigator.sendBeacon(
      withToken(`/settings/${section}`),
      new Blob([JSON.stringify({ data, base_rev: base, conn_key: connKey(), device_token: deviceToken() })],
               { type: "application/json" }),
    );
    noteSaveBeaconed(section, data, handedOff);
  }
  _pendingSaves.clear();
  for (const key of Object.keys(_saveTimers)) {
    clearTimeout(_saveTimers[key]);
    delete _saveTimers[key];
  }
}

const _onVisibilityFlush = () => {
  if (document.visibilityState === "hidden") flushPendingSaves();
};
document.addEventListener("visibilitychange", _onVisibilityFlush);
// Remove on HMR dispose so reloads don't stack duplicate flush listeners (#32).
if (import.meta.hot) {
  import.meta.hot.dispose(() => document.removeEventListener("visibilitychange", _onVisibilityFlush));
}

function readAll(): Record<string, any> {
  if (!_cache) _cache = {};
  return _cache;
}

/** Tests only: forget every section, draft and pending save. */
export function resetSettingsForTests(): void {
  for (const key of Object.keys(_saveTimers)) { clearTimeout(_saveTimers[key]); delete _saveTimers[key]; }
  _pendingSaves.clear();
  _drafts.clear();
  _cache = null;
  _confirmed = {};
  _ownSaves.clear();
  for (const k of Object.keys(_revs)) delete _revs[k];
  deviceInfo.value = { id: null, name: "" };
  serverSettingsReady.value = false;
}

/** Load a section AS IT ACTS: fully merged data (saved values + fallbacks).
 *  A machine section and the simulation switch are the server's — this
 *  tab's unconfirmed draft is not in it (BG-19); the look is this tab's
 *  latest. */
export function loadSection<T>(key: string): T {
  return mergeSection<T>(key, actsWhenConfirmed(key) ? _confirmed[key] : readAll()[key]);
}

/** Load a section as this tab's FORM shows it: its latest change, confirmed
 *  or not (for a display section the same as loadSection). The base of a
 *  read-modify-write save, so a second change keeps the first. */
export function loadSectionDraft<T>(key: string): T {
  return mergeSection<T>(key, readAll()[key]);
}

function mergeSection<T>(key: string, saved: unknown): T {
  const def = sections.get(key);
  if (!def) throw new Error(`defaults: unknown section "${key}"`);
  try {
    return def.merge(saved, def.fallback);
  } catch (e) {
    // Section merge functions can throw on malformed server data (e.g. wrong
    // shape after a manual settings.json edit). Fall back to defaults loudly
    // so the issue is visible rather than masked by a partial merge.
    console.warn(`[defaults] merge failed for section "${key}", using fallback:`, e);
    return JSON.parse(JSON.stringify(def.fallback));
  }
}

/** Save a section. Routes server sections through WS, local sections to localStorage. */
export function saveSection(key: string, data: any): void {
  // Block saves until server data is confirmed (prevents overwriting with
  // fallback zeros) — visibly: the Settings header says so (UX-08).
  if (!serverSettingsReady.value) { noteSaveBlocked(key, "waiting for server settings"); return; }
  // A device section is saved into THIS browser's profile — none while the
  // connection is not bound to one (settings split).
  if (DEVICE_SECTIONS.has(key) && deviceInfo.value.id === null) {
    noteSaveBlocked(key, deviceStorage() === "failed"
      ? "browser storage unavailable — this device's settings are not saved"
      : "device not bound yet");
    return;
  }
  const base = _revs[key] ?? 0;   // the revision this change was made on

  const all = readAll();
  all[key] = data;
  _cache = all;
  _localRev.value++;

  // Track pending save for sendBeacon flush on page exit
  _pendingSaves.set(key, { data, base });
  noteSavePending(key);
  if (actsWhenConfirmed(key)) {
    _drafts.set(key, { data, json: stableJson(data), rev: sectionRev(key), baseJson: stableJson(_confirmed[key]) });
  }
  // Debounce server saves (camera sliders fire rapidly)
  clearTimeout(_saveTimers[key]);
  _saveTimers[key] = setTimeout(() => {
    _pendingSaves.delete(key);
    if (_settingsSaver) {
      const reqId = _settingsSaver(key, data, base);  // registered by lcncWs (avoids the import cycle)
      if (reqId === null) noteSaveFailed(key, "not connected");
      else {
        noteSaveSent(key, reqId);
        _ownSaves.set(reqId, { section: key, ledgerRev: sectionRev(key), gen: _bindingGen });
      }
    } else {
      // No silent drop: lcncWs registers at module load, so this "can't happen" —
      // which is exactly why it must be loud if it does (the save would vanish).
      // console.error is captured by the error.console telemetry hook → auditable.
      console.error(`[settings] save DROPPED — no saver registered (section=${key})`);
      noteSaveFailed(key, "no saver registered");
    }
  }, 300);
}

// ─── Viewer section ──────────────────────────────────────────────

export const HUD_FALLBACK: HudDefaults = {
  scale: "md",
  showMachine: true,
  showTool: true,
  showFeedSpindle: true,
  showLoadBar: true,
};

const VIEWER_FALLBACK: ViewerDefaults = {
  layers: { backplot: true, toolpath: true, rapids: true, machine: true, bounds: true, toolpathBounds: false, reachRoom: false, reachPart: false, workzero: true, hud: true, surface: true, tool: true, toolsetter: true, toolChange: true, workplane: true, groundGrid: true },
  paletteMode: "auto",
  colors: {},
  machineColors: {},
  machineEdges: true,
  trackingMode: "none",
  onTop: { ...ON_TOP_FALLBACK },
  projection: "parallel",
  previewMode: "part",
  hud: { ...HUD_FALLBACK },
};

registerSection<ViewerDefaults>("viewer", VIEWER_FALLBACK, mergeViewerSection);

/** Load viewer defaults (typed convenience wrapper). */
export function loadViewerDefaults(): ViewerDefaults {
  return loadSection<ViewerDefaults>("viewer");
}

/** Fresh deep copy of the viewer fallback — the single source for "factory
 *  state" (used by the Settings reset; never hand-duplicate the literal). */
export function viewerFallback(): ViewerDefaults {
  return JSON.parse(JSON.stringify(VIEWER_FALLBACK));
}

/** Save viewer defaults (typed convenience wrapper). */
export function saveViewerDefaults(data: ViewerDefaults): void {
  saveSection("viewer", data);
}

// ─── Machine section ─────────────────────────────────────────────

export type ToolChangeMode = "m6g43" | "m600";

export type SpindleDir = "off" | "forward" | "reverse";

export type SpindleFeedbackUnit = "rps" | "rpm";

export interface MachineDefaults {
  toolChangeMode: ToolChangeMode;
  runFromLine: boolean;
  rflSpindleDir: SpindleDir;
  rflSpindleRpm: number;
  rflSafeZ: boolean;          // retract to G53 Z0 (never lowered) before a run-from-line start
  spindleFeedbackUnit: SpindleFeedbackUnit;
  spindleLoadPin: string;
  autoDisarmMin: number;      // idle auto-disarm timeout in minutes; 0 = off
}

const MACHINE_FALLBACK: MachineDefaults = {
  toolChangeMode: "m6g43",
  runFromLine: false,
  rflSpindleDir: "forward",
  rflSpindleRpm: 10000,
  rflSafeZ: true,
  spindleFeedbackUnit: "rps",
  spindleLoadPin: "",
  autoDisarmMin: 10,
};

registerSection<MachineDefaults>("machine", MACHINE_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb };
  const dir = saved.rflSpindleDir;
  return {
    ...fb,
    ...saved,
    toolChangeMode: (saved.toolChangeMode === "m600" ? "m600" : "m6g43") as ToolChangeMode,
    rflSpindleDir: (dir === "off" || dir === "forward" || dir === "reverse" ? dir : fb.rflSpindleDir) as SpindleDir,
    rflSafeZ: typeof (saved as any).rflSafeZ === "boolean" ? (saved as any).rflSafeZ : fb.rflSafeZ,
    spindleFeedbackUnit: (saved.spindleFeedbackUnit === "rpm" ? "rpm" : "rps") as SpindleFeedbackUnit,
    autoDisarmMin: typeof (saved as any).autoDisarmMin === "number" && (saved as any).autoDisarmMin >= 0
      ? (saved as any).autoDisarmMin : fb.autoDisarmMin,
  };
});

export function loadMachineDefaults(): MachineDefaults {
  return loadSection<MachineDefaults>("machine");
}

/** The machine section as the Settings form shows it (BG-19). */
export function loadMachineDraft(): MachineDefaults {
  return loadSectionDraft<MachineDefaults>("machine");
}

export function saveMachineDefaults(data: MachineDefaults): void {
  saveSection("machine", data);
}

// ─── Panels section ─────────────────────────────────────────────

export const MAX_PANELS = 3;

export interface PanelsDefaults {
  tabs: string[];
}

registerSection<PanelsDefaults>("panels", { tabs: ["viewer", "manual"] }, (saved, fb) => {
  if (!saved) return { ...fb };
  const tabs = saved.tabs;
  if (!Array.isArray(tabs) || tabs.length === 0) return { ...fb };

  // Migration: replace old/removed tabs with "manual"
  const OLD_TABS = new Set(["dro", "jog", "mdi", "overrides", "spindle", "messages", "settings"]);
  let migrated = false;
  const result: string[] = [];
  for (const t of tabs) {
    if (OLD_TABS.has(t)) {
      if (!migrated) { result.push("manual"); migrated = true; }
      // skip subsequent old tabs
    } else {
      result.push(t);
    }
  }

  return { tabs: result.slice(0, MAX_PANELS) };
});

/** Load panels defaults (typed convenience wrapper). */
export function loadPanelsDefaults(): PanelsDefaults {
  return loadSection<PanelsDefaults>("panels");
}

/** Save panels defaults (typed convenience wrapper). */
export function savePanelsDefaults(data: PanelsDefaults): void {
  saveSection("panels", data);
}

// ─── MDI section ────────────────────────────────────────────────

export interface MdiDefaults {
  history: string[];
}

registerSection<MdiDefaults>("mdi", { history: [] }, (saved, fb) => {
  if (!saved) return { ...fb };
  return {
    history: Array.isArray(saved.history) ? saved.history.slice(0, 50) : fb.history,
  };
});

/** The history as this tab last wrote it (a list, not a configuration). */
export function loadMdiHistory(): string[] {
  return loadSectionDraft<MdiDefaults>("mdi").history;
}

export function saveMdiHistory(history: string[]): void {
  saveSection("mdi", { history });
}

// ─── Display section ────────────────────────────────────────────

export type ThemeMode = "auto" | "light" | "dark" | "hc-light" | "hc-dark";
const VALID_THEMES = new Set<string>(["auto", "light", "dark", "hc-light", "hc-dark"]);

export interface DisplayDefaults {
  theme: ThemeMode;
  startFullscreen: boolean;
  keepAwake: boolean;
}

const DISPLAY_FALLBACK: DisplayDefaults = { theme: "auto", startFullscreen: false, keepAwake: true };

registerSection<DisplayDefaults>("display", DISPLAY_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb };
  const t = saved.theme;
  return {
    ...fb,
    ...saved,
    theme: (VALID_THEMES.has(t) ? t : fb.theme) as ThemeMode,
    keepAwake: typeof saved.keepAwake === "boolean" ? saved.keepAwake : fb.keepAwake,
  };
});

export function loadDisplayDefaults(): DisplayDefaults {
  return loadSection<DisplayDefaults>("display");
}

export function saveDisplayDefaults(data: DisplayDefaults): void {
  saveSection("display", data);
}

// ─── Macros section ─────────────────────────────────────────────

export interface MacrosDefaults {
  /** The EARLIER macros (one MDI line with {placeholders} each) — dropped
   *  2026-10-02 on the operator's word: macros are files now. A stored list
   *  is kept exactly as stored (never used, never rewritten); the console
   *  says once that it is there. The macro bar is `macroBar`, a device's. */
  macros: unknown[];
}

export { MACRO_NAME_RE, MACRO_BAR_MAX } from "./macroParams";
import { macroBarOf } from "./macroParams";

const MACROS_FALLBACK: MacrosDefaults = { macros: [] };

registerSection<MacrosDefaults>("macros", MACROS_FALLBACK, mergeMacrosSection);

export function loadMacrosDefaults(): MacrosDefaults {
  return loadSection<MacrosDefaults>("macros");
}


// ─── Macro bar section (a device's, OP3) ──────────────────────────

/** The macro FILES on this device's macro bar, in bar order (package 5;
 *  per device without arm since the settings split, operator OP3): file
 *  names without `.ngc`. The machine's `macros` section keeps only the
 *  earlier MDI-line macros. */
export interface MacroBarDefaults {
  bar: string[];
}

registerSection<MacroBarDefaults>("macroBar", { bar: [] }, (saved, fb) => ({ bar: macroBarOf(saved?.bar) ?? [...fb.bar] }));

export function loadMacroBarDefaults(): MacroBarDefaults {
  return loadSection<MacroBarDefaults>("macroBar");
}

export function saveMacroBarDefaults(data: MacroBarDefaults): void {
  saveSection("macroBar", data);
}

// ─── Simulation section (a device's) ──────────────────────────────

/** Does THIS device run the simulation — the timeline, the collision check,
 *  the Sim tab (settings split, operator 2026-11-07: the check is heavy; a
 *  machine panel may go without it)? Every new device starts with it OFF
 *  (OP1). It acts only once the server holds it (CONFIRMED_DEVICE_SECTIONS). */
export interface SimulationDefaults {
  enabled: boolean;
}

registerSection<SimulationDefaults>("simulation", { enabled: false },
  (saved) => ({ enabled: saved?.enabled === true }));

export function loadSimulationDefaults(): SimulationDefaults {
  return loadSection<SimulationDefaults>("simulation");
}

/** The switch as this tab's form shows it (a draft until the server holds it). */
export function loadSimulationDraft(): SimulationDefaults {
  return loadSectionDraft<SimulationDefaults>("simulation");
}

export function saveSimulationDefaults(data: SimulationDefaults): void {
  saveSection("simulation", data);
}

// ─── Features section (the machine's) ─────────────────────────────

/** The switchable suite functions (settings split package 3, plan R335–R337):
 *  each ON unless the server holds it OFF — an install without the section
 *  works as before. Off is the suite's OPERATING function (operator OP2):
 *  its tabs and buttons LEAVE the UI and the gateway refuses its jobs; free
 *  MDI and programs stay. A machine section: armed to change, admitted only
 *  on a machine that stands (the gateway's features.py), acting once the
 *  server holds it. One list with the gateway's `features.FEATURES`. */
export const FEATURE_NAMES = ["probing", "toolsetter", "surfaceMap", "camera", "macros", "gamepad"] as const;
export type FeatureName = typeof FEATURE_NAMES[number];
export type FeaturesDefaults = Record<FeatureName, boolean>;

const FEATURES_FALLBACK: FeaturesDefaults = {
  probing: true, toolsetter: true, surfaceMap: true, camera: true, macros: true, gamepad: true,
};

registerSection<FeaturesDefaults>("features", FEATURES_FALLBACK, (saved, fb) => {
  const out = { ...fb };
  for (const f of FEATURE_NAMES) if (typeof saved?.[f] === "boolean") out[f] = saved[f];
  return out;
});

export function loadFeaturesDefaults(): FeaturesDefaults {
  return loadSection<FeaturesDefaults>("features");
}

/** The switches as the Settings form shows them (BG-19). */
export function loadFeaturesDraft(): FeaturesDefaults {
  return loadSectionDraft<FeaturesDefaults>("features");
}

export function saveFeaturesDefaults(data: FeaturesDefaults): void {
  saveSection("features", data);
}

/** The simulation on THIS device as the SERVER holds it (settings split
 *  package 2, plan Codex R335 SS334-03): false until the server's settings
 *  arrived — no simulation work starts before the confirmed profile — and
 *  false while a switch to on is only this tab's draft. The timeline, the
 *  Sim tab and every collision check follow it; the toolpath, the machine
 *  model and the run display do not. */
export const simulationOn = computed(() => {
  void settingsVersion.value;
  return serverSettingsReady.value && loadSimulationDefaults().enabled;
});

// ─── Camera section ─────────────────────────────────────────────

export interface CameraDefaults {
  showCrosshair: boolean;
  showCircle: boolean;
  showGrid: boolean;
  circleRadius: number;
  gridSpacing: number;
  overlayOpacity: number;
  overlayColor: string;
  pipX: number;
  pipY: number;
  pipWidth: number;
  pipHeight: number;
  pipVisible: boolean;
}

const CAMERA_FALLBACK: CameraDefaults = {
  showCrosshair: true,
  showCircle: true,
  showGrid: false,
  circleRadius: 50,
  gridSpacing: 50,
  overlayOpacity: 0.8,
  overlayColor: "#00ff00",
  pipX: -1,
  pipY: -1,
  pipWidth: 320,
  pipHeight: 240,
  pipVisible: false,
};

registerSection<CameraDefaults>("camera", CAMERA_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb };
  return { ...fb, ...saved };
});

export function loadCameraDefaults(): CameraDefaults {
  return loadSection<CameraDefaults>("camera");
}

export function saveCameraDefaults(data: CameraDefaults): void {
  saveSection("camera", data);
}

// ─── Input bindings: the shared command names ────────────────────
// ONE list for the commands the keyboard and the gamepad both bind, so an
// action reads the same in both binding tables (design wave D4, UI-N69).
// The split differs on purpose and stays: the keyboard's one Cycle key
// toggles start / pause / resume, the gamepad has a button for each.
export const INPUT_COMMAND_LABELS = {
  cycle: "Cycle Start / Pause / Resume",
  start: "Cycle Start / Resume",
  pause: "Pause",
  resume: "Resume",
  abort: "Abort",
  estop: "E-Stop",
} as const;

// ─── Gamepad section ─────────────────────────────────────────────

/** Actions assignable to gamepad buttons. */
export type GamepadAction =
  | "start" | "pause" | "resume" | "abort"
  | "estop" | "spindle_stop" | "flood_toggle" | "mist_toggle" | "home_all"
  | "z_mod" | "dead_man" | "none";

export const GAMEPAD_ACTIONS: { value: GamepadAction; label: string }[] = [
  { value: "start", label: INPUT_COMMAND_LABELS.start },
  { value: "pause", label: INPUT_COMMAND_LABELS.pause },
  { value: "resume", label: INPUT_COMMAND_LABELS.resume },
  { value: "abort", label: INPUT_COMMAND_LABELS.abort },
  { value: "estop", label: INPUT_COMMAND_LABELS.estop },
  { value: "spindle_stop", label: "Spindle Stop" },
  { value: "flood_toggle", label: "Flood Toggle" },
  { value: "mist_toggle", label: "Mist Toggle" },
  { value: "home_all", label: "Home All" },
  { value: "z_mod", label: "Z Modifier (D-pad)" },
  { value: "dead_man", label: "Dead Man (hold to jog)" },
  { value: "none", label: "None" },
];

export interface GamepadMapping {
  btn_a: GamepadAction;
  btn_b: GamepadAction;
  btn_x: GamepadAction;
  btn_y: GamepadAction;
  btn_lb: GamepadAction;
  btn_rb: GamepadAction;
  btn_lt: GamepadAction;
  btn_rt: GamepadAction;
  btn_back: GamepadAction;
  btn_start: GamepadAction;
  btn_ls: GamepadAction;
  btn_rs: GamepadAction;
}

export const DEFAULT_MAPPING: GamepadMapping = {
  btn_a: "start",
  btn_b: "abort",
  btn_x: "pause",
  btn_y: "resume",
  btn_lb: "z_mod",
  btn_rb: "none",
  btn_lt: "none",
  btn_rt: "dead_man",
  btn_back: "none",
  btn_start: "none",
  btn_ls: "none",
  btn_rs: "none",
};

export interface GamepadDefaults {
  jogEnabled: boolean;
  buttonsEnabled: boolean;
  deadZone: number;
  invertX: boolean;
  invertY: boolean;
  invertZ: boolean;
  mapping: GamepadMapping;
  /** Per-controller raw-binding profiles, keyed by gamepad.id. */
  profiles: Record<string, GamepadProfile>;
}

export const GAMEPAD_FALLBACK: GamepadDefaults = {
  jogEnabled: false,
  buttonsEnabled: false,
  deadZone: 0.15,
  invertX: false,
  invertY: false,
  invertZ: false,
  mapping: { ...DEFAULT_MAPPING },
  profiles: {},
};

/** Keep only entries shaped like profiles; binding internals are guarded at
    resolve time (isBindingPressed treats unknown shapes as unpressed). */
function mergeProfiles(saved: any): Record<string, GamepadProfile> {
  if (!saved || typeof saved !== "object") return {};
  const out: Record<string, GamepadProfile> = {};
  for (const [key, p] of Object.entries<any>(saved)) {
    if (p && typeof p === "object"
        && typeof p.id === "string"
        && p.buttons && typeof p.buttons === "object"
        && p.sticks && typeof p.sticks === "object") {
      out[key] = p as GamepadProfile;
    }
  }
  return out;
}

function mergeMapping(saved: any, fb: GamepadMapping): GamepadMapping {
  if (!saved || typeof saved !== "object") return { ...fb };
  const valid = new Set<string>(GAMEPAD_ACTIONS.map(a => a.value));
  const result: any = {};
  for (const key of Object.keys(fb)) {
    const v = saved[key];
    result[key] = (typeof v === "string" && valid.has(v)) ? v : (fb as any)[key];
  }
  return result as GamepadMapping;
}

registerSection<GamepadDefaults>("gamepad", GAMEPAD_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb, mapping: { ...fb.mapping } };
  // Migration: old single 'enabled' → both toggles
  const hadOldEnabled = typeof saved.enabled === "boolean" && saved.jogEnabled === undefined;
  const jogEnabled = hadOldEnabled ? saved.enabled : (saved.jogEnabled ?? fb.jogEnabled);
  const buttonsEnabled = hadOldEnabled ? saved.enabled : (saved.buttonsEnabled ?? fb.buttonsEnabled);
  return {
    jogEnabled,
    buttonsEnabled,
    deadZone: typeof saved.deadZone === "number" ? saved.deadZone : fb.deadZone,
    invertX: saved.invertX ?? fb.invertX,
    invertY: saved.invertY ?? fb.invertY,
    invertZ: saved.invertZ ?? fb.invertZ,
    mapping: mergeMapping(saved.mapping, fb.mapping),
    profiles: mergeProfiles(saved.profiles),
  };
});

export function loadGamepadDefaults(): GamepadDefaults {
  return loadSection<GamepadDefaults>("gamepad");
}

/** The pad's configuration as the Settings form shows it (BG-19). */
export function loadGamepadDraft(): GamepadDefaults {
  return loadSectionDraft<GamepadDefaults>("gamepad");
}

export function saveGamepadDefaults(data: GamepadDefaults): void {
  saveSection("gamepad", data);
}

// ── Keyboard shortcuts ──────────────────────────────────────────

// All 9 axes are bindable (WS-D). Axes the machine lacks simply don't get
// a binding row in KeyboardTab; stored bindings for absent axes are inert
// (jogActionToAxis returns null when the letter isn't in viewer_init.axes).
export const KB_AXIS_LETTERS = ["x", "y", "z", "a", "b", "c", "u", "v", "w"] as const;
type KbAxisLetter = (typeof KB_AXIS_LETTERS)[number];

export type KeyboardAction =
  | `jog_${KbAxisLetter}${"+" | "-"}`
  | "estop" | "cycle" | "abort";

function _jogEntries(value: (l: KbAxisLetter, dir: "+" | "-") => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of KB_AXIS_LETTERS) {
    out[`jog_${l}+`] = value(l, "+");
    out[`jog_${l}-`] = value(l, "-");
  }
  return out;
}

export const KEYBOARD_ACTION_LABELS: Record<KeyboardAction, string> = {
  ..._jogEntries((l, d) => `Jog ${l.toUpperCase()}${d}`),
  estop: INPUT_COMMAND_LABELS.estop,
  cycle: INPUT_COMMAND_LABELS.cycle,
  abort: INPUT_COMMAND_LABELS.abort,
} as Record<KeyboardAction, string>;

const ALL_KB_ACTIONS = Object.keys(KEYBOARD_ACTION_LABELS) as KeyboardAction[];

// C/U/V/W ship unbound ("" never matches a KeyboardEvent.key) — the historic
// x/y/z/a/b defaults are preserved for existing users.
export const DEFAULT_KB_MAPPING: Record<KeyboardAction, string> = {
  ..._jogEntries(() => ""),
  "jog_x+": "ArrowRight", "jog_x-": "ArrowLeft",
  "jog_y+": "ArrowUp",    "jog_y-": "ArrowDown",
  "jog_z+": "PageUp",     "jog_z-": "PageDown",
  "jog_a+": "]",           "jog_a-": "[",
  "jog_b+": "'",           "jog_b-": ";",
  estop: "Escape",
  cycle: " ",
  abort: "Backspace",
} as Record<KeyboardAction, string>;

export interface KeyboardDefaults {
  jogEnabled: boolean;
  buttonsEnabled: boolean;
  mapping: Record<KeyboardAction, string>;
}

/** The E-Stop key is reserved: Escape, everywhere, not re-bindable (operator
 *  decision 2026-09-19). useKeyboardShortcuts handles it in a capture
 *  listener; KeyboardTab shows it fixed. */
export const ESTOP_KEY = "Escape";

/** Pin `estop` to Escape and free Escape from any other action — applied on
 *  load and on every save, so a stored mapping can never move E-Stop. */
export function normalizeKeyboardMapping(mapping: Record<KeyboardAction, string>): Record<KeyboardAction, string> {
  const out = { ...mapping };
  for (const action of Object.keys(out) as KeyboardAction[]) {
    if (action !== "estop" && out[action] === ESTOP_KEY) out[action] = "";
  }
  out.estop = ESTOP_KEY;
  return out;
}

const KEYBOARD_FALLBACK: KeyboardDefaults = {
  jogEnabled: false,
  buttonsEnabled: true,
  mapping: { ...DEFAULT_KB_MAPPING },
};

const KEY_DISPLAY: Record<string, string> = {
  ArrowRight: "→", ArrowLeft: "←", ArrowUp: "↑", ArrowDown: "↓",
  " ": "Space", Escape: "Esc", Backspace: "⌫",
  PageUp: "PgUp", PageDown: "PgDn",
  Delete: "Del", Insert: "Ins",
  Enter: "Enter", Home: "Home", End: "End",
};

export function formatKeyName(key: string): string {
  if (!key) return "None";
  if (KEY_DISPLAY[key]) return KEY_DISPLAY[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

registerSection<KeyboardDefaults>("keyboard", KEYBOARD_FALLBACK, (saved, fb) => {
  if (!saved) {
    // Cross-section migration: read keyboardJog from raw machine data
    // (loadSection strips unknown fields, so read raw cache instead)
    const machRaw = readAll().machine;
    const jogEnabled = machRaw?.keyboardJog ?? fb.jogEnabled;
    return { ...fb, jogEnabled, mapping: { ...fb.mapping } };
  }
  const mapping = { ...fb.mapping };
  if (saved.mapping && typeof saved.mapping === "object") {
    for (const action of ALL_KB_ACTIONS) {
      if (typeof saved.mapping[action] === "string") {
        mapping[action] = saved.mapping[action];
      }
    }
  }
  // Migration: old 'enabled' → 'buttonsEnabled'
  const hadOldEnabled = typeof saved.enabled === "boolean" && saved.buttonsEnabled === undefined;
  const buttonsEnabled = hadOldEnabled ? saved.enabled : (saved.buttonsEnabled ?? fb.buttonsEnabled);
  return {
    jogEnabled: saved.jogEnabled ?? fb.jogEnabled,
    buttonsEnabled,
    mapping: normalizeKeyboardMapping(mapping),
  };
});

export function loadKeyboardDefaults(): KeyboardDefaults {
  return loadSection<KeyboardDefaults>("keyboard");
}

/** The key map as the Settings form shows it (BG-19). */
export function loadKeyboardDraft(): KeyboardDefaults {
  return loadSectionDraft<KeyboardDefaults>("keyboard");
}

export function saveKeyboardDefaults(data: KeyboardDefaults): void {
  saveSection("keyboard", data);
}

// ─── Probe section ──────────────────────────────────────────────

export interface ProbeDefaults {
  probeTool: number;
  slowFr: number;
  fastFr: number;
  traverseFr: number;
  maxXYDistance: number;
  xyClearance: number;
  maxZDistance: number;
  zClearance: number;
  calOffset: number;
  stepOffWidth: number;
  extraProbeDepth: number;
  edgeWidth: number;
  diameterHint: number;
  xHintBP: number;
  yHintBP: number;
  xHintRV: number;
  yHintRV: number;
  wcoRotation: number;
  calDiameter: number;
  xCalWidth: number;
  yCalWidth: number;
  scanX0: number;
  scanX1: number;
  scanY0: number;
  scanY1: number;
  scanXProbes: number;
  scanYProbes: number;
  scanSafeZ: number;
  scanDepthZ: number;
  autoZero: boolean;
}

registerSection<ProbeDefaults>("probe", PROBE_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb };
  return { ...fb, ...saved };
});

export function loadProbeDefaults(): ProbeDefaults {
  return loadSection<ProbeDefaults>("probe");
}

/** The probe parameters as the Probing form shows them — and sends them:
 *  a probe runs with what its form shows, under its own gate (BG-19). */
export function loadProbeDraft(): ProbeDefaults {
  return loadSectionDraft<ProbeDefaults>("probe");
}

export function saveProbeDefaults(data: ProbeDefaults): void {
  saveSection("probe", data);
}

// ─── Toolsetter section ─────────────────────────────────────────

export interface ToolsetterDefaults {
  fastFeed: number;
  slowFeed: number;
  traverseFeed: number;
  maxZTravel: number;
  retractDist: number;
  spindleZeroHeight: number;
  offsetDirection: number;
  touchX: number;
  touchY: number;
  touchZ: number;
  useToolTable: number;
  toolMinDis: number;
  brakeAfter: number;
  goBackToStart: number;
  spindleStopM: number;
  disablePrePos: number;
  addReps: number;
  lastTry: number;
  offsetDiameter: number;
  offsetValue: number;
  finderTouchX: number;
  finderTouchY: number;
  finderDiffZ: number;
}

// The fallback and the set-up rule live in toolsetterSetup.ts (pure, node-testable).
export { TOOLSETTER_FALLBACK };

registerSection<ToolsetterDefaults>("toolsetter", TOOLSETTER_FALLBACK, (saved, fb) => {
  if (!saved) return { ...fb };
  return { ...fb, ...saved };
});

export function loadToolsetterDefaults(): ToolsetterDefaults {
  return loadSection<ToolsetterDefaults>("toolsetter");
}

export function saveToolsetterDefaults(data: Partial<ToolsetterDefaults>): void {
  saveSection("toolsetter", data);
}

/** The Reset: an EMPTY section — no field set, so nothing counts as a saved
 *  value (the fallback's zeros used to become "saved coordinates"). */
export function clearToolsetterDefaults(): void {
  saveSection("toolsetter", {});
}

