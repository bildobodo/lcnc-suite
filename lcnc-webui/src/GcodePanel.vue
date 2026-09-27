<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, useId, watch, type Ref } from "vue";
import type { CollisionLineMark } from "./viewer/collision";
import { listFiles, uploadFile, saveFile, fetchSubfile, UploadConflictError, type FileEntry } from "./lcncApi";
import DialogFrame from "./DialogFrame.vue";
import { openTextSession, closeTextSessionIf, inputSession, EDITOR_OWNER, type TextTarget } from "./inputSession";
import { splitSubLines, expansionAllowed, totalRows, rowAt, rowForMain, rowForSub, type SubExpansion } from "./subRows";
import { usePermissions } from "./permissions";
import { loadMachineDefaults, saveMachineDefaults, settingsVersion } from "./defaults";
import { confirmedToolsetter } from "./toolsetterVars";
import { scanToolchangesBefore, scanEntryPositionBefore, revisionParts, type RflToolchangeScan, type RflEntryScan, type RflRunOptions } from "./gcodeRfl";
import { highlightGcode, type Token } from "./gcodeHighlight";
import { fmtPct } from "./format";
import { limitViolationText, type LimitViolation } from "./ws/bulkData";
import { isTouchDevice } from "./touchDetect";
import { useMediaMql } from "./useMediaMql";
import { emitTelemetry, pushMessage } from "./lcncWs";
import { OPERATOR_DISPLAY, OPERATOR_ERROR } from "./lcnc";
import { GCODE_LOOKUP, GCODE_REFERENCE } from "./gcodeReference";
import { Play, SkipForward, Pause, X, ChevronDown, ChevronUp, Triangle } from "lucide-vue-next";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineRadio from "./MachineRadio.vue";
import FormField from "./FormField.vue";
import MachineInput from "./MachineInput.vue";
import MachineToggle from "./MachineToggle.vue";
import FileBrowser from "./FileBrowser.vue";
export interface GcodeStats {
  feedMoves: number;
  rapidMoves: number;
  linearMoves: number;
  arcMoves: number;
  feedDist: number;
  rapidDist: number;
  linearDist: number;
  arcDist: number;
  feedTime: number;
  rapidTime: number;
  totalTime: number;
  feedRates: number[];
  toolChanges: number;
  toolsUsed: number[];
  unit: string;
  fileSize: number;
}

const props = defineProps<{
  activeFile: string | null;
  gcodeContent: string | null;
  // The published program revision (`<file>#<version>`, set on the
  // publish's ARRIVAL) and the one the displayed text belongs to (set when
  // its fetch lands) — see ws/bulkData.ts (UI-DI05).
  programRevision: string;
  programTextRevision: string;
  gcodeStats: GcodeStats | null;
  // Soft-limit violations from the parse worker (null = unchecked — the INI
  // had no limits, or no program is loaded; [] = checked clean).
  violations: LimitViolation[] | null;
  violationsTotal: number;
  currentLine: number | null;
  // Marked subroutine the playhead currently sits in (W2 P6): shown as
  // "▶ in subroutine (name)" while currentLine is suppressed — the sub's
  // line numbers collide with this file's and must not highlight here.
  subName?: string | null;
  // Set when the parse determined that NO motion point of this program
  // attributes to a line of this file (per-point trust, W2 P6), so
  // `currentLine` is deliberately null rather than a confidently wrong
  // line. Carries the reason for the operator.
  linesUntrustedReason?: string;
  // Source line at the viewer's scrub position (offline dry run stage 2).
  // Highlights + auto-scrolls like the run highlight; null = not scrubbing.
  scrubLine?: number | null;
  // Lines flagged by the viewer's collision sweep (stage 3) — danger-tinted
  // line numbers (soft-limit violations are warn-tinted; a line with both
  // reads danger), the same colours as the scrub bar's timeline marks.
  collisionLines?: CollisionLineMark[] | null;
  // Marked-span execution state for the inline sub view (W5): while a
  // marked o-call span executes (run playhead or sim scrub), the called
  // file's lines render INDENTED under the call line with the executing
  // sub line highlighted. Null = collapsed.
  subView?: { name: string; subLine: number; callLine: number } | null;
  isPaused: boolean;
  elapsed: string;
  optionalStop: boolean;
  blockDelete: boolean;
  runFromLine: boolean;
}>();

const can = usePermissions();

const emit = defineEmits<{
  (e: "loadFile", path: string): void;
  (e: "unloadFile"): void;
  (e: "cycleStart"): void;
  (e: "cyclePause"): void;
  (e: "cycleResume"): void;
  (e: "abort"): void;
  (e: "cycleStep"): void;
  (e: "toggleOptionalStop"): void;
  (e: "toggleBlockDelete"): void;
  (e: "runFromLine", opts: RflRunOptions): void;
  (e: "openGcodeRef", code: string): void;
  (e: "showStats"): void;
  (e: "editingChange", editing: boolean): void;
}>();

const optionalStopModel = computed({
  get: () => props.optionalStop,
  set: () => emit("toggleOptionalStop"),
});
const blockDeleteModel = computed({
  get: () => props.blockDelete,
  set: () => emit("toggleBlockDelete"),
});

const codeViewerRef = ref<HTMLDivElement | null>(null);
// G-code context help — disabled during program execution for performance
const interactive = computed(() => !props.currentLine);
const tooltip = ref<{ code: string; name: string; desc: string; x: number; y: number } | null>(null);

function onTokenMouseEnter(ev: MouseEvent, token: Token) {
  if (token.type !== 'gcode' && token.type !== 'mcode') return;
  const code = token.text.toUpperCase();
  const entry = GCODE_LOOKUP.get(code);
  const rect = (ev.target as HTMLElement).getBoundingClientRect();
  if (entry) {
    tooltip.value = { code: entry.code, name: entry.name, desc: entry.desc, x: rect.left + rect.width / 2, y: rect.top };
  } else {
    // Prefix match for compound codes (G10 → G10 L2, G10 L20, etc.)
    const matches = GCODE_REFERENCE.filter(e => e.code.toUpperCase().startsWith(code + " ") || e.code.toUpperCase().startsWith(code + "."));
    if (matches.length === 1) {
      tooltip.value = { code: matches[0]!.code, name: matches[0]!.name, desc: matches[0]!.desc, x: rect.left + rect.width / 2, y: rect.top };
    } else if (matches.length > 1) {
      tooltip.value = { code, name: `${matches.length} forms`, desc: "Click for details", x: rect.left + rect.width / 2, y: rect.top };
    }
  }
}

function onTokenMouseLeave() { tooltip.value = null; }

function onTokenClick(ev: MouseEvent, token: Token) {
  if (token.type !== 'gcode' && token.type !== 'mcode') return;
  // Run-from-line selection owns line taps: G0/M3 are the widest targets
  // on a line, so a tap there must bubble to onLineClick and select the
  // line, not open the reference dialog.
  if (props.runFromLine && props.gcodeContent) return;
  ev.stopPropagation();
  tooltip.value = null;
  emit("openGcodeRef", token.text.toUpperCase());
}

function dismissTooltip() { tooltip.value = null; }

const fileName = computed(() => {
  if (!props.activeFile) return "No program loaded";
  return props.activeFile.split("/").pop() || props.activeFile;
});

// Line-START offsets instead of materialized line strings: split("\n") on a 32 MB
// file produced ~1.35 M permanently-retained string objects (≈100–150 MB with
// per-object overhead, plus the 194 ms split itself). The offsets are ONE
// Uint32Array (~5 MB) over the single source string; the virtualized viewer
// renders ~40 lines and now also *stores* only those — visibleLines slices its
// window on demand. Slice [offs[i], offs[i+1]-1) is byte-identical to the old
// split("\n") entries (CRLF files keep their \r either way).
const lineOffsets = computed(() => {
  const text = props.gcodeContent;
  if (!text) return new Uint32Array(0);
  const _t = performance.now();
  let n = 1;  // pass 1: count lines (indexOf runs at C speed, no allocation)
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) n++;
  const offs = new Uint32Array(n);
  let line = 1;  // pass 2: fill starts (offs[0] = 0)
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) offs[line++] = i + 1;
  const _dt = performance.now() - _t;
  if (_dt > 100) emitTelemetry("gcode.line_index_blocked", { ms: Math.round(_dt), lines: n, bytes: text.length });
  return offs;
});

const lineCount = computed(() => (props.gcodeContent ? lineOffsets.value.length : 0));

/** Line idx (0-based) sliced on demand from the source string. */
function lineAt(idx: number): string {
  const text = props.gcodeContent!;
  const offs = lineOffsets.value;
  const start = offs[idx]!;
  const end = idx + 1 < offs.length ? offs[idx + 1]! - 1 : text.length;
  return text.slice(start, end);
}

const progressPercent = computed(() => {
  if (!lineCount.value || props.currentLine == null) return 0;
  return Math.min(100, (props.currentLine / lineCount.value) * 100);
});

// ---------- Inline sub view (W5) ----------
// The called file's source, fetched once per sub name (server resolves it
// through SUBROUTINE_PATH). Guarded against out-of-order responses.
const subText = ref<string | null>(null);
watch(() => props.subView?.name, (name) => {
  subText.value = null;
  if (!name) return;
  fetchSubfile(name).then((t) => {
    if (props.subView?.name === name) subText.value = t;
  });
}, { immediate: true });

// Active expansion: only while the span executes, only when the call
// line's own text IS `o<name> call` for exactly this span (remap wrappers
// and nested spans never pass — see subRows.expansionAllowed), never in
// edit mode. Null = the plain main-file view, all row math is identity.
const expansion = computed<SubExpansion | null>(() => {
  const sv = props.subView;
  const text = subText.value;
  if (!sv || !text || editing.value || !props.gcodeContent) return null;
  if (sv.callLine < 1 || sv.callLine > lineCount.value) return null;
  const lines = splitSubLines(text);
  if (!expansionAllowed(lineAt(sv.callLine - 1), sv.name, lines.length)) return null;
  return { callLine: sv.callLine, name: sv.name, lines };
});
const rowCount = computed(() => totalRows(lineCount.value, expansion.value));
// The executing sub line — the indented row that carries the highlight.
const subActiveLine = computed(() =>
  expansion.value ? props.subView?.subLine ?? null : null);

// Slot floor for the running line number: as wide as the file's last line
// number, so the "current / total" readout never shifts during a run.
const lineDigits = computed(() => String(lineCount.value || 0).length);

// Token type + highlightGcode() imported from gcodeHighlight.ts

// ---------- Virtual scroll ----------
// px — MUST match the .codeLine CSS height (style.css): 23px desktop,
// 32px under html.touch-device (run-from-line selection is a per-line
// tap). Reactive because touch mode latches on the first touch input,
// which can happen mid-session.
const LINE_HEIGHT = computed(() => (isTouchDevice.value ? 32 : 23));
const BUFFER = 10;

const scrollTop = ref(0);

// Split into primitive computeds so a sub-line scroll (which leaves the integer
// start/end unchanged) does NOT re-run visibleLines. During a running program
// currentLine advances 5–50×/s, each nudging scrollTop; keying retokenization
// off the integer bounds avoids redundant work on every sub-LINE_HEIGHT delta.
const rangeStart = computed(() =>
  Math.max(0, Math.floor(_scrollToContent(scrollTop.value) / LINE_HEIGHT.value) - BUFFER)
);
const rangeEnd = computed(() => {
  const viewportH = codeViewerRef.value?.clientHeight ?? 400;
  const count = Math.ceil(viewportH / LINE_HEIGHT.value) + BUFFER * 2;
  return Math.min(rowCount.value, rangeStart.value + count);
});

// Tokenize only the visible window — never the full file — to avoid blocking the
// main thread (and delaying heartbeat) when a large G-code file is opened.
// Rows, not raw lines (W5): with an active sub expansion the window walks
// main rows, then the indented sub rows, then main again (subRows.rowAt).
const visibleLines = computed(() => {
  const start = rangeStart.value;
  const end = rangeEnd.value;
  const exp = expansion.value;
  const out = [];
  for (let i = start; i < end; i++) {
    const r = rowAt(i, exp);
    out.push({
      kind: r.kind,
      lineNum: r.lineNum,
      tokens: highlightGcode(r.kind === "sub" ? exp!.lines[r.lineNum - 1]! : lineAt(r.lineNum - 1)),
    });
  }
  return out;
});

// Scaled spacer: browsers clamp element heights (Firefox ≈17.9M px), so a
// 1.35M-line file's true 31M px spacer silently truncates and the scrollbar
// can't reach the bottom. Cap the spacer and linearly map scrollbar-space ↔
// content-space; at scale 1 (files under ~520k lines) every formula reduces
// exactly to the unscaled originals.
const SPACER_MAX_PX = 12_000_000;
const contentHeight = computed(() => rowCount.value * LINE_HEIGHT.value);
const totalHeight = computed(() => Math.min(contentHeight.value, SPACER_MAX_PX));

function _viewH(): number {
  return codeViewerRef.value?.clientHeight ?? 400;
}
/** scrollbar position → content y */
function _scrollToContent(s: number): number {
  const ch = contentHeight.value, sh = totalHeight.value, vh = _viewH();
  if (sh >= ch || sh <= vh) return s;
  return (s * (ch - vh)) / (sh - vh);
}
/** content y → scrollbar position */
function _contentToScroll(y: number): number {
  const ch = contentHeight.value, sh = totalHeight.value, vh = _viewH();
  if (sh >= ch || ch <= vh) return y;
  return (y * (sh - vh)) / (ch - vh);
}

// Pin the rendered window under the scrollbar thumb: place it at scrollTop,
// backed off by how far rangeStart's content position sits above the mapped
// viewport top. At scale 1 this is exactly rangeStart * LINE_HEIGHT.
const offsetY = computed(() => {
  const y = _scrollToContent(scrollTop.value);
  return Math.max(0, scrollTop.value + rangeStart.value * LINE_HEIGHT.value - y);
});

function onCodeScroll(ev: Event) {
  scrollTop.value = (ev.target as HTMLElement).scrollTop;
  tooltip.value = null;
}

// Scroll to a ROW (mathematical — no DOM search). Target is computed in
// content space, then mapped to scrollbar space (identity at scale 1).
function scrollToRow(row: number) {
  if (!codeViewerRef.value) return;
  const targetY = row * LINE_HEIGHT.value - codeViewerRef.value.clientHeight / 2 + LINE_HEIGHT.value / 2;
  codeViewerRef.value.scrollTop = Math.max(0, _contentToScroll(targetY));
}
function scrollToLine(line: number) {
  scrollToRow(rowForMain(line, expansion.value));
}
watch(() => props.currentLine, (newLine) => {
  if (newLine != null) scrollToLine(newLine);
});
watch(() => props.scrubLine, (newLine) => {
  if (newLine != null && !editing.value) scrollToLine(newLine);
});
// The indented sub view follows its own executing line (W5).
watch(subActiveLine, (ln) => {
  const exp = expansion.value;
  if (ln != null && exp) scrollToRow(rowForSub(ln, exp));
});

/** ---------- Soft-limit violations (offline dry run stage 1) ---------- */
const violationsByLine = computed(() => {
  const m = new Map<number, LimitViolation[]>();
  for (const v of props.violations ?? []) {
    const arr = m.get(v.line);
    if (arr) arr.push(v);
    else m.set(v.line, [v]);
  }
  return m;
});

const collisionLineSet = computed(() => new Map((props.collisionLines ?? []).map(m => [m.line, m])));

function lineMarkTitle(lineNum: number): string | undefined {
  const parts: string[] = [];
  const v = violationsByLine.value.get(lineNum);
  if (v) parts.push(v.map(violationText).join("; "));
  const cm = collisionLineSet.value.get(lineNum);
  if (cm) parts.push(cm.continuation !== undefined
    ? (cm.continuation === 0
      ? "still in contact (began in the entry move) — see viewer Check results"
      : `still in contact (began L${cm.continuation}) — see viewer Check results`)
    : "collision clearance hit — see viewer Check results");
  return parts.length ? parts.join(" · ") : undefined;
}

function violationText(v: LimitViolation): string {
  return limitViolationText(v, props.gcodeStats?.unit ?? "mm");
}

/** ---------- File browser ---------- */
const showBrowser = ref(false);
const currentSubdir = ref("");
const loading = ref(false);
const uploadError = ref<string | null>(null);
const dragOver = ref(false);

function toggleBrowser() {
  showBrowser.value = !showBrowser.value;
}

async function browsePrograms(subdir: string, signal: AbortSignal) {
  const data = await listFiles(subdir, signal);
  return { directory: data.nc_dir, subdir: data.subdir, entries: data.entries };
}

function selectFile(entry: FileEntry) {
  if (editing.value) return;  // the editor's session owns the loaded program
  emit("loadFile", entry.path);
  showBrowser.value = false;
}

function reloadFile() {
  if (props.activeFile) emit("loadFile", props.activeFile);
}

function unloadFile() {
  emit("unloadFile");
}

/** ---------- Upload ---------- */
// Name-conflict dialog (UI-09): the gateway never replaces an existing
// program unless told to. Cancel / Rename (re-send under a new name) /
// Replace (overwrite=1) — the operator decides, never the upload path.
const uploadConflict = ref<{ file: File; filename: string; newName: string } | null>(null);

async function handleUpload(file: File, opts: { overwrite?: boolean; name?: string } = {}) {
  if (editing.value) return;
  uploadError.value = null;
  loading.value = true;
  try {
    const resp = await uploadFile(file, opts);
    uploadConflict.value = null;
    emit("loadFile", resp.path);
    showBrowser.value = false;
  } catch (e: any) {
    if (e instanceof UploadConflictError) {
      uploadConflict.value = { file, filename: e.filename, newName: e.filename };
    } else {
      uploadError.value = `Upload failed: ${e.message}`;
    }
  } finally {
    loading.value = false;
  }
}

function uploadRename() {
  const c = uploadConflict.value;
  if (!c) return;
  const name = c.newName.trim();
  if (!name || name === c.filename) return;
  uploadConflict.value = null;
  handleUpload(c.file, { name });
}

function uploadReplace() {
  const c = uploadConflict.value;
  if (!c) return;
  uploadConflict.value = null;
  handleUpload(c.file, { overwrite: true, name: c.filename });
}

const uploadRenameValid = computed(() => {
  const c = uploadConflict.value;
  if (!c) return false;
  const name = c.newName.trim();
  return !!name && name !== c.filename && /\.(ngc|nc|gcode|tap|txt)$/i.test(name);
});

function onFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files?.[0]) {
    handleUpload(input.files[0]);
    input.value = "";
  }
}

/** ---------- Drag and drop ---------- */
function onDragOver(_e: DragEvent) {
  dragOver.value = true;
}

function onDragLeave(_e: DragEvent) {
  dragOver.value = false;
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  if (!can.value.setup || editing.value) return;
  const file = e.dataTransfer?.files[0];
  if (file) handleUpload(file);
}

/** ---------- Run from line ---------- */
const selectedLine = ref<number | null>(null);
const showRunDialog = ref(false);
const dialogSpindleDir = ref<"off" | "forward" | "reverse">("forward");
// The dialog's OWN native radio name: Settings' default preset is another
// group — with one shared name, mounting Settings unchecked the dialog's
// choice while its model kept it (implementation review round 4, UI-DI07).
const rflDirName = `rflRunSpindleDir${useId()}`;
const dialogSpindleSpeed = ref(10000);
const dialogSafeZ = ref(true);
// Toolchange scan for the RFL × M600 guard (see gcodeRfl.ts): refreshed each
// time the dialog opens; drives the redirect notice / multi-change refusal.
const rflScan = ref<RflToolchangeScan | null>(null);
const rflEntry = ref<RflEntryScan | null>(null);
// Position preamble available: scan clean AND at least one derivable axis.
const rflEntryAvailable = computed(() => {
  const e = rflEntry.value;
  return !!e && e.blockers.length === 0 && (e.x != null || e.y != null);
});
// Redirect case: exactly one toolchange with a known tool before the start
// line — the gateway measures it via MDI first (pre_tool), the #3116 flag
// skips the skim's re-entry.
const rflPreTool = computed(() => {
  const s = rflScan.value;
  return s && s.count === 1 && s.lastTool != null && s.lastTool > 0 ? s.lastTool : 0;
});
// The pre-measurement is an M600: only with the toolsetter set up (Codex R15 B1).
const toolsetter = computed(() => confirmedToolsetter());
const rflSetterUnset = computed(() => rflPreTool.value > 0 && !toolsetter.value.ok);
const rflSetterReason = computed(() => (toolsetter.value.ok ? undefined : toolsetter.value.reason));
// Unsupported: multiple toolchanges before N, an undetermined tool number, or
// T0 (unload). The skim would probe each one with no offsets applied — refuse.
const rflBlocked = computed(() => {
  const s = rflScan.value;
  return !!s && s.count > 0 && rflPreTool.value === 0;
});

// What a hold on a program action is bound to (UI-DI05): the path AND the
// published revision AND the revision of the displayed text — a new
// revision of the same path cancels a running hold at its arrival, and
// the landing of its text cancels one begun while it loaded. (Every
// re-parse bumps the revision, a drift re-parse after a touch-off too.)
const programHoldKey = computed(() => `${props.activeFile ?? ""}|${props.programRevision}|${props.programTextRevision}`);
// The displayed text lags the published revision while its fetch runs:
// Start, Step and the Run-from-line action wait — a confirmation is given
// on the text the operator sees, and the entry position Run from line
// sends is read from it.
const programLoading = computed(() => props.programRevision !== props.programTextRevision);
const LOADING_REASON = "Loading program — wait";

// The narrow side pane folds the run options and the program management
// behind "More" (style.css `.foldNarrow`, UI-DI09). A run option that is
// ON stays named on the toggle while folded — it changes how the program
// runs.
const moreOpen = ref(false);
const foldedOptions = computed(() =>
  [props.optionalStop && "M01", props.blockDelete && "/BD"].filter(Boolean).join(" "));
// A line selection belongs to its program AND its text: another program,
// or a revision whose text differs, clears it and closes a Run-from-line
// dialog opened on it (the line of the old text is not a line of the new).
function dropSelection() {
  selectedLine.value = null;
  showRunDialog.value = false;
}
watch(() => props.activeFile, dropSelection);
watch(() => props.gcodeContent, (now, before) => { if (now !== before) dropSelection(); });

function readRflDefaults() {
  const mach = loadMachineDefaults();
  dialogSpindleDir.value = mach.rflSpindleDir;
  dialogSpindleSpeed.value = mach.rflSpindleRpm;
  dialogSafeZ.value = mach.rflSafeZ;
}
// Server-synced settings arrive after setup (settings_init on every WS
// connect): re-read, or the dialog keeps a stale snapshot.
watch(settingsVersion, readRflDefaults);

onMounted(() => {
  readRflDefaults();
  window.addEventListener("blur", dismissTooltip);
  window.addEventListener("resize", dismissTooltip);
});

onUnmounted(() => {
  window.removeEventListener("blur", dismissTooltip);
  window.removeEventListener("resize", dismissTooltip);
});

function onLineClick(lineNum: number) {
  if (!props.runFromLine || !props.gcodeContent) return;
  selectedLine.value = selectedLine.value === lineNum ? null : lineNum;
}

// A selection is only meaningful while run-from-line mode is ON: clicks can't
// deselect once the mode is off (onLineClick guards on it), so a stale selection
// would silently hijack Start into the run-from-line dialog forever. Clear it on
// disable, and gate Start on the mode as well (belt and braces).
watch(() => props.runFromLine, (on) => {
  if (!on) selectedLine.value = null;
});

/** Start opens the Run-from-line dialog instead of starting (no motion). */
const opensRunDialog = computed(() => !!props.runFromLine && !!selectedLine.value && selectedLine.value > 1);

function onStartClick() {
  if (props.runFromLine && selectedLine.value && selectedLine.value > 1) {
    rflScan.value = props.gcodeContent
      ? scanToolchangesBefore(props.gcodeContent, selectedLine.value)
      : null;
    rflEntry.value = props.gcodeContent
      ? scanEntryPositionBefore(props.gcodeContent, selectedLine.value)
      : null;
    showRunDialog.value = true;
  } else {
    emit("cycleStart");
  }
}

function confirmRunFromLine() {
  // The program the dialog showed — the gateway refuses the run if it is no
  // longer the loaded one at this version (Codex R16 XZ-07).
  const program = revisionParts(props.programTextRevision);
  if (!selectedLine.value || rflBlocked.value || programLoading.value || !program) return;
  const mach = loadMachineDefaults();
  if (mach.rflSafeZ !== dialogSafeZ.value) {
    saveMachineDefaults({ ...mach, rflSafeZ: dialogSafeZ.value });
  }
  emit("runFromLine", {
    line: selectedLine.value,
    spindleDir: dialogSpindleDir.value,
    spindleSpeed: dialogSpindleSpeed.value,
    preTool: rflPreTool.value,
    safeZ: dialogSafeZ.value,
    entry: rflEntryAvailable.value ? rflEntry.value : null,
    program,
  });
  showRunDialog.value = false;
  selectedLine.value = null;
}

/** ---------- Edit mode ---------- */
// Virtualized editor (CodeMirror 6), lazy-loaded on first edit. The previous raw
// <textarea> natively re-laid-out the ENTIRE document on keystrokes — on a ~32 MB
// file that jams the browser main thread for seconds, and Firefox (and WebKit)
// route a worker's WebSocket I/O THROUGH the main thread, so the jam froze the
// client heartbeat → hb_stall disarms (delivery probe caught 6 heartbeats stuck
// in ws.bufferedAmount while typing, inbound silent too). CM6 is rope-backed and
// renders only the viewport, so the main thread stays free regardless of file
// size — the same virtualization principle as the read-only viewer above.
const editing = ref(false);
const editorHost = ref<HTMLDivElement | null>(null);
// Portrait edit mode folds the file ops, the run controls and the progress
// row: none can act while a session is open (Start/Step/Browse/Upload say
// "Finish or discard the edit first"), and the side pane is what the
// editor — the on-screen keyboard's readout — must fit in at 150 % on
// 900 × 1200 (review round 3, UI-I08: 13.5 px were left for it). A
// running or paused program brings the controls back (Pause/Abort must
// stay reachable here; the banner carries Abort in any case).
const isPortrait = useMediaMql("(orientation: portrait)");
const compactEdit = computed(() => isPortrait.value && editing.value && !can.value.pause && !can.value.resume);
const saving = ref(false);
const saveError = ref<string | null>(null);
let _editorView: any = null;
// The editor's light/dark base theme follows the RESOLVED app theme (App's
// "isDark": the explicit theme, else the system scheme) — a constant
// `dark: true` gave the light themes CodeMirror's dark selection and
// active-line colours (design wave D8). Reconfigured live on a switch.
const isDark = inject<Ref<boolean>>("isDark", ref(false));
let _editorTheme: { compartment: any; make: (dark: boolean) => any } | null = null;
watch(isDark, (dark) => {
  if (_editorView && _editorTheme) _editorView.dispatch({ effects: _editorTheme.compartment.reconfigure(_editorTheme.make(dark)) });
});
let _cm: { deleteCharBackward: any; undo: any; redo: any; cursorCharLeft: any; cursorCharRight: any; insertTab: any } | null = null;

// ── Edit SESSION (WP0, UI-01) ──
// The buffer belongs to the file it was opened on, never to "the loaded
// program": saveEdit used to read props.activeFile before AND after the
// HTTP call, so a program switch mid-edit saved buffer A into file B.
// A session is {id, path, original}; every async continuation (CodeMirror
// import, save reply) checks that ITS session is still the current one.
interface EditSession { id: number; path: string; original: string }
let _session: EditSession | null = null;
let _sessionSeq = 0;
const sessionPath = ref<string | null>(null);
const sessionName = computed(() => sessionPath.value?.split("/").pop() ?? "");
// External program change while editing: the buffer stays, a banner names
// the conflict. "Keep editing" acknowledges THIS loaded file; a further
// change raises it again.
const conflictAckFile = ref<string | null>(null);
const editConflict = computed(() =>
  editing.value && sessionPath.value != null && props.activeFile !== sessionPath.value
  && props.activeFile !== conflictAckFile.value);
function keepEditing() { conflictAckFile.value = props.activeFile; }
watch(() => props.activeFile, () => { if (!editing.value) conflictAckFile.value = null; });

// App swaps the bottom strip for the G-code keypad while the editor is open.
watch(editing, (v) => emit("editingChange", v));

function _isDirty(): boolean {
  return !!_editorView && !!_session && _editorView.state.doc.toString() !== _session.original;
}

async function enterEdit() {
  if (!props.gcodeContent || !props.activeFile || editing.value) return;
  saveError.value = null;
  const session: EditSession = { id: ++_sessionSeq, path: props.activeFile, original: props.gcodeContent };
  _session = session;
  sessionPath.value = session.path;
  conflictAckFile.value = null;
  editing.value = true;
  await nextTick();  // v-if mounts the host div
  if (!editorHost.value) return;
  const _t = performance.now();
  try {
    // Dynamic import: CM6 stays out of the initial bundle (P6 pattern) — it loads
    // only when someone actually edits.
    const [{ EditorState, Compartment }, { EditorView, keymap, lineNumbers }, { defaultKeymap, history, historyKeymap, deleteCharBackward, undo, redo, cursorCharLeft, cursorCharRight, insertTab }, { gcodeEditorLanguage }] =
      await Promise.all([
        import("@codemirror/state"),
        import("@codemirror/view"),
        import("@codemirror/commands"),
        import("./gcodeCmLanguage"),
      ]);
    _cm = { deleteCharBackward, undo, redo, cursorCharLeft, cursorCharRight, insertTab };
    // Bound to the SESSION, not to props.activeFile: an external program
    // change during the import leaves session A valid (its view is created
    // with A's text and the conflict banner shows); only a discarded or
    // replaced session aborts — the stale import installs nothing.
    if (_session !== session || !editing.value || !editorHost.value || _editorView) return;
    const make = (dark: boolean) => EditorView.theme({
      "&": { backgroundColor: "var(--bg)", color: "var(--fg)", height: "100%" },
      ".cm-scroller": { fontFamily: "var(--font-mono)", overflow: "auto" },
      // Line numbers muted by COLOUR, like the viewer's (D8).
      ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--fg-muted)", border: "none" },
      "&.cm-focused": { outline: "none" },
      // CM's dark base theme paints a WHITE native caret; pin it to the
      // theme token so it tracks every theme.
      ".cm-content": { caretColor: "var(--fg)" },
    }, { dark });
    _editorTheme = { compartment: new Compartment(), make };
    const theme = _editorTheme.compartment.of(make(isDark.value));
    _editorView = new EditorView({
      state: EditorState.create({
        doc: session.original,
        extensions: [lineNumbers(), history(), keymap.of([...defaultKeymap, ...historyKeymap]), theme, gcodeEditorLanguage],
      }),
      parent: editorHost.value,
    });
    // Touch: text entry comes from the G-code keypad strip — suppress the
    // OS keyboard the same way MachineInput does for number fields.
    if (isTouchDevice.value) _editorView.contentDOM.setAttribute("inputmode", "none");
    // Focus on entry so the caret is visible immediately — without this
    // there is no insertion-point indication until the first tap/click.
    _editorView.focus();
    // The editor is a CODE target of the strip keyboard from the moment it
    // exists (Edit is the deliberate act); a tap into it re-opens a closed
    // helper (WP8).
    openEditorSession();
  } catch (e: any) {
    // No silent empty editor: a failed chunk load (offline, stale deploy) left
    // edit mode open with nothing in it and no message. Surface in the banner.
    saveError.value = `Editor failed to load: ${e?.message ?? e}`;
    emitTelemetry("edit.editor_load_failed", { msg: String(e?.message ?? e) });
    return;
  }
  const _dt = performance.now() - _t;
  if (_dt > 250) emitTelemetry("edit.seed_blocked", { ms: Math.round(_dt), bytes: session.original.length });
}

function _destroyEditor() {
  _editorView?.destroy();
  _editorView = null;
  _editorTheme = null;
}

// ── The editor as a text-keyboard target (WP8) ──
function editorTarget(): TextTarget {
  const v = () => _editorView;
  return {
    insert(text) { const e = v(); if (!e) return; e.dispatch(e.state.replaceSelection(text)); e.focus(); },
    backspace() { const e = v(); if (!e || !_cm) return; _cm.deleteCharBackward(e); e.focus(); },
    enter() { const e = v(); if (!e) return; e.dispatch(e.state.replaceSelection("\n")); e.focus(); },
    moveCursor(d) { const e = v(); if (!e || !_cm) return; (d < 0 ? _cm.cursorCharLeft : _cm.cursorCharRight)(e); e.focus(); },
    undo() { const e = v(); if (!e || !_cm) return; _cm.undo(e); e.focus(); },
    redo() { const e = v(); if (!e || !_cm) return; _cm.redo(e); e.focus(); },
    tab() { const e = v(); if (!e || !_cm) return; _cm.insertTab(e); e.focus(); },
    canConfirm: () => editing.value && !!_editorView,
    isVisible: () => !!editorHost.value && editorHost.value.offsetParent !== null,
    // Explicit close (the X key) hands focus to the content the view itself
    // focuses — its DOM focus handler restores the selection.
    focusEl: () => _editorView?.contentDOM ?? null,
  };
}
function openEditorSession() {
  if (!editing.value || !_editorView) return;
  openTextSession({ ownerId: EDITOR_OWNER, kind: "code", context: `Editor · ${sessionName.value}`, target: editorTarget(), enterLabel: "newline" });
}
function onEditorPointerUp() {
  if (editing.value && _editorView && !(inputSession.kind && inputSession.ownerId === EDITOR_OWNER)) openEditorSession();
}

// Discard asks first when the buffer differs from what was opened; a clean
// buffer closes at once.
const showDiscardConfirm = ref(false);

function _endSession() {
  closeTextSessionIf(EDITOR_OWNER);
  editing.value = false;
  saveError.value = null;
  _session = null;
  sessionPath.value = null;
  conflictAckFile.value = null;
  showDiscardConfirm.value = false;
  _destroyEditor();
}

function discardEdit() {
  if (_isDirty()) { showDiscardConfirm.value = true; return; }
  _endSession();
}

function confirmDiscard() { _endSession(); }

onUnmounted(_destroyEditor);

async function saveEdit() {
  const session = _session;
  if (!session || !_editorView || saving.value) return;
  const path = session.path;
  const name = path.split("/").pop() ?? path;
  saving.value = true;
  saveError.value = null;
  try {
    // doc.toString() materializes the full text once at save — a one-off cost,
    // sent as a raw body (no JSON.stringify pass).
    const text: string = _editorView.state.doc.toString();
    await saveFile(path, text);
    if (_session !== session) {
      // A newer session replaced this one (or it was discarded) while the
      // save was in flight: the file is saved, nothing else is touched — a
      // quiet protocol entry, the operator has moved on (design wave D1).
      pushMessage(OPERATOR_DISPLAY, `Saved ${name}`, "log");
      return;
    }
    session.original = text;
    if (props.activeFile !== path) {
      // External program change while saving: the editor stays on A, the
      // banner keeps naming the conflict, and B is NOT reloaded from A.
      pushMessage(OPERATOR_DISPLAY, `Saved ${name} — the loaded program is ${props.activeFile?.split("/").pop() ?? "another file"}`);
      return;
    }
    if (_editorView && _editorView.state.doc.toString() !== text) {
      // Typed while the save was in flight (implementation review UI-I02):
      // the saved text is the new baseline, the newer edits stay in the
      // editor as unsaved — the reply never destroys them. The loaded
      // program is refreshed from the saved file as after any save.
      pushMessage(OPERATOR_DISPLAY, `Saved ${name} — newer edits are still unsaved`);
      emit("loadFile", path);
      return;
    }
    _endSession();
    emit("loadFile", path);
  } catch (e: any) {
    if (_session === session) saveError.value = `Save failed: ${e.message}`;
    // A failure is never DISPLAY severity (design wave D1, UI-N29): inline
    // while its session is open, else an error in the message center.
    else pushMessage(OPERATOR_ERROR, `Save of ${name} failed: ${e?.message ?? e}`);
    emitTelemetry("edit.save_failed", { file: path, msg: String(e?.message ?? e) });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="container stack-controls" @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">
    <!-- The tab's pattern (design wave D5, UI-K05): what it acts on, the
         machine actions with Abort last at the right edge, then management.
         Portrait edit mode folds both action rows (compactEdit). -->
    <div class="panelHead" :class="{ moreOpen }">
      <div class="panelObject">
        <div class="fileName">{{ fileName }}</div>
        <span class="fileMeta" v-if="gcodeContent">{{ lineCount }} lines</span>
        <MachineBtn v-if="gcodeStats" type="inline" class="actionBtn" @click="emit('showStats')">Stats</MachineBtn>
        <!-- Narrow only (style.css): the run options and the management fold here -->
        <span class="panelMore">
          <MachineBtn type="inline" :selected="moreOpen" :aria-expanded="moreOpen" aria-controls="programOptions programManage"
                      :aria-label="`More program actions${foldedOptions && !moreOpen ? ` — ${foldedOptions} on` : ''}`"
                      @click="moreOpen = !moreOpen">
            More<template v-if="foldedOptions && !moreOpen"> · {{ foldedOptions }}</template>
            <component :is="moreOpen ? ChevronUp : ChevronDown" :size="14" />
          </MachineBtn>
        </span>
      </div>

      <!-- Program control -->
      <div v-if="!compactEdit" class="ctrlRow actionGroup">
        <!-- A hold bound to the program (D6) — a tap when it only opens the
             Run-from-line dialog (no motion yet; the dialog's action holds) -->
        <MachineBtn type="start" class="ctrlBtn" @click="onStartClick" :disabled="!activeFile || editing || programLoading"
          :hold="!opensRunDialog" :hold-key="programHoldKey"
          :reason="editing ? 'Finish or discard the edit first' : !activeFile ? 'No program loaded' : programLoading ? LOADING_REASON : undefined">
          <Play :size="14" class="ctrlIcon" /> {{ selectedLine && selectedLine > 1 ? `Start L${selectedLine}` : 'Start' }}
        </MachineBtn>
        <MachineBtn type="step" class="ctrlBtn" @click="emit('cycleStep')" :disabled="!(activeFile || can.resume) || editing || programLoading"
          :hold-key="programHoldKey"
          :reason="editing ? 'Finish or discard the edit first' : !(activeFile || can.resume) ? 'No program loaded' : programLoading ? LOADING_REASON : undefined">
          <SkipForward :size="14" class="ctrlIcon" /> Step
        </MachineBtn>
        <MachineBtn :type="isPaused ? 'resume' : 'pause'" class="ctrlBtn" :hold-key="programHoldKey"
          @click="isPaused ? emit('cycleResume') : emit('cyclePause')">
          <span class="stable-width"><span :class="{ alt: isPaused }"><Pause :size="14" class="ctrlIcon" /> Pause</span><span :class="{ alt: !isPaused }"><Play :size="14" class="ctrlIcon" /> Resume</span></span>
        </MachineBtn>
        <!-- The run options sit before Abort: Abort closes the row (N80) -->
        <div id="programOptions" class="row-tight switchToggles foldNarrow">
          <MachineToggle gate="optionalStop" v-model="optionalStopModel" label="M01" />
          <MachineToggle gate="blockDelete" v-model="blockDeleteModel" label="/BD" />
        </div>
        <MachineBtn type="abort" class="ctrlBtn" @click="emit('abort')" />
      </div>

      <!-- Program management -->
      <div v-if="!compactEdit" id="programManage" class="actionGroup programManage foldNarrow">
        <MachineBtn type="fileOp" class="actionBtn" @click="enterEdit" :disabled="!activeFile || editing">
          Edit
        </MachineBtn>
        <MachineBtn type="fileOp" class="actionBtn" @click="reloadFile" :disabled="!activeFile || loading || editing">
          Reload
        </MachineBtn>
        <MachineBtn type="fileOp" class="actionBtn" @click="unloadFile" :disabled="!activeFile || loading || editing"
          :reason="editing ? 'Finish or discard the edit first' : undefined">
          Unload
        </MachineBtn>
        <!-- ONE files toggle (N82): pressed while the browser shows -->
        <MachineBtn type="fileOp" class="actionBtn" :selected="showBrowser" :aria-pressed="showBrowser" @click="toggleBrowser"
          :disabled="loading || editing" :reason="editing ? 'Finish or discard the edit first' : undefined">
          Files
        </MachineBtn>
        <MachineBtn type="fileOp" class="actionBtn" @click="($refs.fileInput as HTMLInputElement).click()" :disabled="editing"
          :reason="editing ? 'Finish or discard the edit first' : undefined">
          Upload
        </MachineBtn>
        <input ref="fileInput" type="file" accept=".ngc,.nc,.gcode,.tap,.txt" @change="onFileSelect" hidden />
      </div>
    </div>

    <!-- Progress bar -->
    <div class="row-controls" v-if="gcodeContent && !compactEdit">
      <div class="progressTrack">
        <div class="progressFill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <span class="progressLabel">
        <span class="val-slot" :style="{ '--slot-w': lineDigits + 'ch' }">{{ currentLine ?? 0 }}</span> / {{ lineCount }}
        <span class="progressPct">(<span class="val-slot pctSlot">{{ fmtPct(progressPercent / 100) }}</span>)</span>
      </span>
      <!-- Attributed span (W4): a non-null currentLine alongside subName can
           only be the sub's call/trigger line (a trusted own-line point is
           never inside a marked span), so the chip drops to muted and the
           tooltip says which line is lit. Chip-only (warn) = unattributed. -->
      <span v-if="subName" class="val-status" :class="currentLine != null ? 'muted' : 'warn'"
        :title="currentLine != null
          ? `Executing inside the ${subName} subroutine — the highlighted line ${currentLine} is where it is called`
          : `Executing inside the ${subName} subroutine — its line numbers belong to that file, so no line is highlighted here`">▶ in subroutine ({{ subName }})</span>
      <span class="elapsedLabel">{{ elapsed }}</span>
    </div>

    <!-- Error banner -->
    <div v-if="uploadError" class="statusNote error" role="alert">
        <span>{{ uploadError }}</span>
        <MachineBtn type="close" aria-label="Dismiss upload error" title="Dismiss upload error" @click="uploadError = null"><X :size="14" /></MachineBtn>
    </div>

    <!-- Soft-limit violations surface in the viewer's scrub bar (yellow
         findings button + timeline marks) and as warn line numbers here. -->

    <!-- Shared file browser: same navigation and file rows as Tools. -->
    <FileBrowser v-if="showBrowser" v-model:subdir="currentSubdir" label="Server programs"
      empty-text="No program files found" :active-file="activeFile"
      :load-directory="browsePrograms" :select-file="selectFile" />

    <!-- Code area wrapper (drop overlay target) -->
    <div v-show="!showBrowser || activeFile || editing" class="codeArea">
      <!-- Drop overlay -->
      <div v-if="dragOver" class="dropOverlay stack-sections" :class="{ denied: !can.setup }">
        <svg v-if="can.setup" class="dropIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <svg v-else class="dropIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>
        <div class="dropText">{{ can.setup ? 'Drop program file to upload' : 'Not permitted' }}</div>
      </div>

      <!-- Line numbers belong to a called sub / remap, not this file: the run
           highlight is suppressed rather than pointed at an unrelated line. -->
      <div v-if="linesUntrustedReason" class="statusNote warn" role="alert">
        <span>Line highlight off — {{ linesUntrustedReason }}</span>
      </div>

      <!-- Edit mode -->
      <div v-if="editing" class="stack-controls editArea">
        <div v-if="saveError" class="statusNote error" role="alert">
          <span>{{ saveError }}</span>
          <MachineBtn type="close" aria-label="Dismiss save error" title="Dismiss save error" @click="saveError = null"><X :size="14" /></MachineBtn>
        </div>
        <!-- The loaded program changed under an open session: the buffer is
             kept and stays bound to its file; nothing is saved elsewhere. -->
        <div v-if="editConflict" class="statusNote warn" role="alert" data-edit-conflict>
          <span>Program changed to {{ fileName }} — you are editing {{ sessionName }}</span>
          <span class="row-tight">
            <MachineBtn type="inline" @click="keepEditing">Keep editing</MachineBtn>
            <MachineBtn type="inlineDanger" @click="discardEdit">Discard</MachineBtn>
          </span>
        </div>
        <div ref="editorHost" class="editorHost" :data-input-area="EDITOR_OWNER" @pointerup="onEditorPointerUp"></div>
        <div class="editActions">
          <MachineBtn type="fileSave" class="actionBtn" @click="saveEdit" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</MachineBtn>
          <MachineBtn type="fileOp" class="actionBtn" @click="discardEdit" :disabled="saving">Discard</MachineBtn>
        </div>
      </div>

      <!-- Code viewer (virtual scroll) -->
      <div class="codeViewer scroll-thin fade-scroll" v-else-if="gcodeContent" ref="codeViewerRef" @scroll="onCodeScroll">
        <div :style="{ height: totalHeight + 'px', position: 'relative' }">
          <div :style="{ position: 'absolute', top: offsetY + 'px', left: 0, right: 0 }">
            <!-- Rows, not raw lines (W5): sub rows are the called file's
                 lines indented under the o-call — they carry their OWN
                 line numbers (muted) and never take main-line marks,
                 selection or run-from-line clicks. -->
            <div class="codeLine"
                 v-for="item in visibleLines"
                 :key="item.kind + ':' + item.lineNum"
                 :class="{
                   subRow: item.kind === 'sub',
                   active: item.kind === 'main'
                     ? (currentLine === item.lineNum || scrubLine === item.lineNum)
                     : subActiveLine === item.lineNum,
                   selected: item.kind === 'main' && selectedLine === item.lineNum,
                   selectable: item.kind === 'main' && runFromLine && gcodeContent,
                   violation: item.kind === 'main' && violationsByLine.has(item.lineNum),
                   collision: item.kind === 'main' && collisionLineSet.has(item.lineNum)
                 }"
                 :title="item.kind === 'main' ? lineMarkTitle(item.lineNum) : undefined"
                 @click="item.kind === 'main' && onLineClick(item.lineNum)">
              <span class="lineNumber">{{ item.lineNum }}</span>
              <!-- A finding is a FORM, not only the number's colour (viewer
                   contrast plan, V3): the timeline's glyphs, × wins the look,
                   the name says every finding of the line. -->
              <span class="lineMark">
                <X v-if="item.kind === 'main' && collisionLineSet.has(item.lineNum)" :size="11" role="img"
                   :aria-label="violationsByLine.has(item.lineNum) ? 'Limit violation, collision' : 'Collision'" />
                <Triangle v-else-if="item.kind === 'main' && violationsByLine.has(item.lineNum)" :size="9" fill="currentColor"
                          role="img" aria-label="Limit violation" />
              </span>
              <span class="lineContent">
                <span
                  v-for="(token, ti) in item.tokens"
                  :key="ti"
                  :class="['token-' + token.type, {
                    'token-interactive': interactive && (token.type === 'gcode' || token.type === 'mcode')
                  }]"
                  @mouseenter="interactive && onTokenMouseEnter($event, token)"
                  @mouseleave="interactive && onTokenMouseLeave()"
                  @click="interactive && onTokenClick($event, token)"
                >{{ token.text }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state / drop zone -->
      <div class="emptyState dropTarget stack-sections" v-else :class="{ dragOver }">
        <svg class="uploadIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <div class="emptyText">No program loaded</div>
        <div class="emptyHint">Drag &amp; drop a file here, or use Upload / Browse above</div>
      </div>
    </div>

    <!-- Discard unsaved edits: the safe answer keeps editing (N49) -->
    <DialogFrame v-if="showDiscardConfirm" kind="confirm" title="Discard changes?" danger @close="showDiscardConfirm = false">
      <div class="dialogBody">{{ sessionName }} has unsaved changes.</div>
      <template #actions>
        <MachineBtn type="dialogCancel" @click="showDiscardConfirm = false">Keep editing</MachineBtn>
        <MachineBtn type="dialogDanger" @click="confirmDiscard">Discard</MachineBtn>
      </template>
    </DialogFrame>

    <!-- Upload name conflict (UI-09): the gateway refused to replace. A form
         (a new name), so the backdrop does nothing (N41); Cancel stays
         outside the setup Gate — the dialog always closes. -->
    <DialogFrame v-if="uploadConflict" kind="form" size="md" title="Upload Conflict">
      <div class="dialogContent stack-controls">
        <div class="dialogBody">
          <strong>{{ uploadConflict.filename }}</strong> already exists on the server.
          Replace overwrites it — this cannot be undone.
        </div>
        <FormField label="New Name">
          <template #default="{ input }">
            <MachineInput v-bind="input" gate="uploadName" type="text" v-model="uploadConflict.newName" />
          </template>
        </FormField>
      </div>
      <template #actions>
        <MachineBtn type="dialogCancel" @click="uploadConflict = null">Cancel</MachineBtn>
        <Gate gate="setup" class="row-controls">
          <MachineBtn type="fileOp" :disabled="!uploadRenameValid" @click="uploadRename">Rename</MachineBtn>
          <MachineBtn type="dialogDangerSetup" @click="uploadReplace">Replace</MachineBtn>
        </Gate>
      </template>
    </DialogFrame>

    <!-- Run from line: a form (its options), so the backdrop does nothing -->
    <DialogFrame v-if="showRunDialog" kind="form" size="md" box-class="runDialog" :title="`Run from Line ${selectedLine}`"
                 close-label="Close run-from-line" @close="showRunDialog = false">
        <div class="dialogContent">
          <div class="dialogBody">
            Lines 1–{{ (selectedLine ?? 1) - 1 }} will be interpreted but motion suppressed.
            Arc commands (G2/G3) before the start line may cause
            radius errors and abort the run.
            Axes not commanded at or before the start line keep their current
            position — prefer a start line that commands all axes (e.g. a
            G0 X.. Y.. rapid). Z descends from safe height per the program's own
            words: make sure material above the start point is already cleared.
          </div>

          <div v-if="rflEntryAvailable" class="dialogSection">
            <div class="sub">Start Position</div>
            <div class="dialogBody">
              Will rapid to{{ rflEntry?.x != null ? ` X${rflEntry?.x}` : "" }}{{ rflEntry?.y != null ? ` Y${rflEntry?.y}` : "" }}{{ rflEntry?.wcs ? ` (${rflEntry?.wcs})` : "" }}
              at safe Z before starting, so entry moves run at the position the
              program expects.
            </div>
          </div>
          <div v-else-if="rflEntry && rflEntry.blockers.length" class="dialogSection">
            <div class="sub">Start Position Preamble Unavailable</div>
            <div class="dialogBody">
              {{ rflEntry.blockers.join("; ") }} — entry will follow modal words
              from the machine's current position. Choose the start line with care.
            </div>
          </div>

          <div v-if="rflPreTool > 0" class="dialogSection">
            <div class="sub">Tool Change Before Start Line</div>
            <div class="dialogBody">
              T{{ rflPreTool }} (M600, line {{ rflScan?.lastLine }}) lies before the
              start line. It will be executed and measured via MDI first — full
              routine with retract and applied length offset — then the program
              starts from line {{ selectedLine }} without re-probing.
            </div>
          </div>
          <div v-else-if="rflBlocked" class="dialogSection">
            <div class="sub">Unsupported Start Line</div>
            <div class="statusNote error" role="alert">
              {{ (rflScan?.count ?? 0) > 1
                ? `${rflScan?.count} tool changes lie before this line — run-from-line across multiple tool changes is unsupported. Start before the first or after the last tool change.`
                : `A tool change before this line has no determinable tool number (or is T0) — offsets cannot be guaranteed. Choose a different start line.` }}
            </div>
          </div>

          <div class="dialogSection">
            <MachineToggle gate="displaySetting" v-model="dialogSafeZ"
                           label="Retract to safe Z (G53 Z0, skipped when already at or above it) before positioning" />
          </div>

          <div class="dialogSection">
            <div class="sub">Spindle Preset</div>
            <!-- One option group, the spindle strip's order (design wave D3, N50/N14) -->
            <div class="radioGroup inline" role="radiogroup" aria-label="Spindle preset">
              <label><MachineRadio gate="displaySetting" :name="rflDirName" :modelValue="dialogSpindleDir" value="reverse" @update:modelValue="dialogSpindleDir = 'reverse'" /> Rev</label>
              <label><MachineRadio gate="displaySetting" :name="rflDirName" :modelValue="dialogSpindleDir" value="off" @update:modelValue="dialogSpindleDir = 'off'" /> Stop</label>
              <label><MachineRadio gate="displaySetting" :name="rflDirName" :modelValue="dialogSpindleDir" value="forward" @update:modelValue="dialogSpindleDir = 'forward'" /> Fwd</label>
            </div>
            <FormField v-if="dialogSpindleDir !== 'off'" label="Spindle Speed" unit="RPM" class="rpmField">
              <template #default="{ input }">
                <MachineInput v-bind="input" gate="displaySettingNum" type="number" v-model.number="dialogSpindleSpeed" min="0" />
              </template>
            </FormField>
          </div>
        </div>

        <template #actions>
          <MachineBtn type="dialogCancel" @click="showRunDialog = false">Cancel</MachineBtn>
          <Gate gate="ready" class="row-controls">
            <!-- Starting motion is a hold (D6): bound to the program and the line -->
            <MachineBtn type="dialogConfirm" :disabled="rflBlocked || programLoading || rflSetterUnset" :reason="programLoading ? LOADING_REASON : rflSetterUnset ? rflSetterReason : undefined" hold :hold-key="`${programHoldKey}:${selectedLine}`" @click="confirmRunFromLine">{{ rflPreTool > 0 ? `Measure T${rflPreTool} + Run from Line ${selectedLine}` : `Run from Line ${selectedLine}` }}</MachineBtn>
          </Gate>
        </template>
    </DialogFrame>

    <!-- G-code tooltip (fixed position, pointer-events: none) -->
    <div v-if="tooltip" class="gcodeTooltip"
         :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }">
      <div class="gcodeTooltipCode">{{ tooltip.code }} — {{ tooltip.name }}</div>
      <div class="text-muted">{{ tooltip.desc }}</div>
    </div>
  </div>
</template>

<style scoped>
.container {
  height: 100%;
}
/* The narrow side pane (`.sidePane.narrow`, App's one threshold — 271 px
   at 150 % portrait): the rows sit closer, and with the folded controls
   unfolded the tab scrolls while the code keeps three lines
   (UI-DI09). "40 lines" leaves the object line — the progress row says
   it — and makes room for the toggle. */
.sidePane.narrow .container {
  gap: var(--gap-tight);
  overflow-y: auto;
}
.sidePane.narrow .codeArea {
  min-height: calc(3 * var(--code-line-h) + var(--gap-tight));
}
.sidePane.narrow .fileMeta { display: none; }


/* .controlRow — uses row-tight utility */

/* Four equal GRID tracks, not `flex: 1`: a flex basis of 0 floors at each
   button's padding + border, which the .btnTip wrapper of a dimmed button
   does not have — a dimmed Start came out 9 px narrower than its enabled
   self (design wave D1 live look; the side-panel layout sweep). A track
   gives the button and its wrapper the same width by construction; its
   floor is the label's full width (a button clips its overflow, so a bare
   1fr track would squeeze "Pause/Resume" in touch landscape). */
.ctrlRow {
  display: grid;
  grid-template-columns: repeat(3, minmax(max-content, 1fr)) auto minmax(max-content, 1fr);
  align-items: center;
  gap: var(--gap-tight);
}
/* Narrow pane (< 400 px, the DR threshold): one row needed 489 px at 150 %
   portrait and Abort sat off the pane. Two columns — the run options on
   top (folded behind "More" until asked for), then Start · Step,
   Pause · Abort: Abort still closes the group at its right edge (N80). */
.sidePane.narrow .ctrlRow { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.sidePane.narrow .ctrlRow > .switchToggles { grid-row: 1; grid-column: 1 / -1; }

.ctrlIcon {
  font-size: var(--fs-lg);
}

/* .progressRow — replaced by row-controls utility (same shape) */
/* .progressTrack/.progressFill — global (style.css) */

.progressLabel {
  font-size: var(--fs-md);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}
/* "100 %" (fmtPct, the unit set off by a space — design wave D0 / D10). */
.pctSlot { --slot-w: 5ch; }

.elapsedLabel {
  font-size: var(--fs-md);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
  margin-left: auto;
}



.fileName {
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}


.fileMeta {
  font-size: var(--fs-base);
  color: var(--fg-muted);
  white-space: nowrap;
}

.actionBtn {
  white-space: nowrap;
}


/* .statusNote (error / warn) — global (style.css), the one inline message
   pattern shared with the tool table, the file browser and the dialogs. */

/* Code area wrapper */
.codeArea {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}

.dropOverlay {
  position: absolute;
  inset: 0;
  z-index: var(--z-pane-overlay);
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--info);
  border-radius: var(--radius-xl);
  background: color-mix(in oklab, var(--info) var(--tint-faint), var(--panel));
  pointer-events: none;
}

.dropOverlay.denied {
  border-color: var(--danger);
  background: color-mix(in oklab, var(--danger) var(--tint-faint), var(--panel));
}

.dropIcon {
  width: 48px;
  height: 48px;
  color: var(--info-text);
}

.denied .dropIcon {
  color: var(--danger-text);
}

.dropText {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--info-text);
}

.denied .dropText {
  color: var(--danger-text);
}

/* .codeViewer, .codeLine, .lineNumber, .lineContent — global in style.css */

.dropTarget {
  flex: 1;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--border);
  border-radius: var(--radius-xl);
  transition: border-color 0.2s, background 0.2s;
}

.dropTarget.dragOver {
  border-color: var(--info);
  background: color-mix(in oklab, var(--info) var(--tint-faint), var(--panel));
}

.uploadIcon {
  width: 40px;
  height: 40px;
  opacity: var(--opacity-muted);   /* decoration, not a disabled control */
}

.emptyText {
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
}

.emptyHint {
  font-size: var(--fs-md);
  color: var(--fg-muted);
}

/* Edit mode */
.editArea {
  flex: 1;
  min-height: 0;
}

.editorHost {
  flex: 1;
  min-height: 0;
  overflow: hidden;  /* CM6 owns scrolling via .cm-scroller */
}
/* Layout-only deep override (CM6 mounts inside the host): fill the host. */
.editorHost :deep(.cm-editor) {
  height: 100%;
}

.editActions {
  display: flex;
  gap: var(--gap-controls);
  justify-content: flex-end;
}

/* Run from line */
.codeLine.selectable {
  cursor: pointer;
}

/* Inline sub view (W5): the called file's rows sit indented under the
   o-call line; their line numbers are the SUB file's (muted so they never
   read as main-file numbers). Layout + opacity tokens only. */
.codeLine.subRow .lineContent {
  padding-left: var(--gap-panel);
}

/* .codeLine.selected — global in style.css */

/* Dialog */

.dialogSection {
  margin: var(--gap-section) 0;
}


.rpmField {
  max-width: var(--form-col-min);
  margin-top: var(--gap-controls);
}

/* G-code context help */
.token-interactive {
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background 0.1s;
}

.token-interactive:hover {
  background: var(--hl-hover);
}

.gcodeTooltip {
  position: fixed;
  transform: translate(-50%, -100%) translateY(-6px);
  z-index: var(--z-modal);
  max-width: 320px;
  padding: var(--gap-tight) var(--gap-controls);
  border-radius: var(--radius-lg);
  background: var(--panel);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  pointer-events: none;
  font-family: var(--font-sans);
  font-size: var(--fs-sm);
  line-height: 1.4;
}

.gcodeTooltipCode {
  font-family: var(--font-mono);
  font-weight: var(--fw-semibold);
  color: var(--accent-text);
}


</style>
