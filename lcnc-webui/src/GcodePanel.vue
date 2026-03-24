<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { listFiles, uploadFile, saveFile, type FileEntry } from "./lcncApi";
import { usePermissions } from "./permissions";
import { loadMachineDefaults, STEP_RPM } from "./defaults";
import { GCODE_LOOKUP, GCODE_REFERENCE } from "./gcodeReference";
import { Play, SkipForward, Pause, Square } from "lucide-vue-next";
import Btn from "./Btn.vue";
import Gate from "./Gate.vue";
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
  gcodeStats: GcodeStats | null;
  currentLine: number | null;
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
  (e: "runFromLine", line: number, spindleDir: "off" | "forward" | "reverse", spindleSpeed: number): void;
  (e: "openGcodeRef", code: string): void;
}>();

const codeViewerRef = ref<HTMLDivElement | null>(null);
const showStats = ref(false);

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
  ev.stopPropagation();
  tooltip.value = null;
  emit("openGcodeRef", token.text.toUpperCase());
}

function dismissTooltip() { tooltip.value = null; }

function fmtTime(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtDist(val: number, unit: string): string {
  return `${val.toFixed(1)} ${unit}`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// SVG donut chart segments (distance breakdown: rapid / linear / arc)
const DONUT_R = 40;
const DONUT_C = 2 * Math.PI * DONUT_R;

const donutSegments = computed(() => {
  const s = props.gcodeStats;
  if (!s) return [];
  const total = s.rapidDist + s.linearDist + s.arcDist;
  if (total <= 0) return [];
  const segs: { color: string; label: string; value: number; pct: number; dasharray: string; dashoffset: number }[] = [];
  let offset = 0;
  const items = [
    { color: "var(--warn)", label: "Rapid", value: s.rapidDist },
    { color: "var(--info)", label: "Linear", value: s.linearDist },
    { color: "var(--ok)", label: "Arc", value: s.arcDist },
  ];
  for (const item of items) {
    if (item.value <= 0) continue;
    const pct = item.value / total;
    const len = pct * DONUT_C;
    segs.push({
      color: item.color,
      label: item.label,
      value: item.value,
      pct: Math.round(pct * 100),
      dasharray: `${len} ${DONUT_C - len}`,
      dashoffset: -offset,
    });
    offset += len;
  }
  return segs;
});

const fileName = computed(() => {
  if (!props.activeFile) return "No file loaded";
  return props.activeFile.split("/").pop() || props.activeFile;
});

const lines = computed(() => {
  if (!props.gcodeContent) return [];
  return props.gcodeContent.split("\n");
});

const lineCount = computed(() => lines.value.length);

const progressPercent = computed(() => {
  if (!lineCount.value || props.currentLine == null) return 0;
  return Math.min(100, (props.currentLine / lineCount.value) * 100);
});

type Token = {
  type: 'gcode' | 'mcode' | 'coord' | 'param' | 'comment' | 'text';
  text: string;
};

// Syntax highlighter for G-code
function highlightGcode(line: string): Token[] {
  const tokens: Token[] = [];

  // Check for comment (everything after semicolon or inside parentheses)
  const commentMatch = line.match(/^([^;(]*)(;.*|(\(.*\).*)?)$/);
  if (commentMatch) {
    const [, code, comment] = commentMatch;

    // Process the code part
    if (code) {
      tokenizeCode(code, tokens);
    }

    // Add comment
    if (comment) {
      tokens.push({ type: 'comment', text: comment });
    }
  } else {
    tokenizeCode(line, tokens);
  }

  return tokens;
}

function tokenizeCode(code: string, tokens: Token[]) {
  // Regex to match G-code tokens
  const pattern = /([GM]\d+(?:\.\d+)?)|([XYZIJKABC][-+]?\d+(?:\.\d+)?)|([FSTPQRHDL]\d+(?:\.\d+)?)|([N]\d+)|(\s+)|([^\s]+)/gi;

  let match;
  while ((match = pattern.exec(code)) !== null) {
    const [, gcode, coord, param, lineNum, space, other] = match;

    if (gcode) {
      const isG = gcode.toUpperCase().startsWith('G');
      tokens.push({ type: isG ? 'gcode' : 'mcode', text: gcode });
    } else if (coord) {
      tokens.push({ type: 'coord', text: coord });
    } else if (param) {
      tokens.push({ type: 'param', text: param });
    } else if (lineNum) {
      tokens.push({ type: 'comment', text: lineNum });
    } else if (space) {
      tokens.push({ type: 'text', text: space });
    } else if (other) {
      tokens.push({ type: 'text', text: other });
    }
  }
}

// ---------- Virtual scroll ----------
const LINE_HEIGHT = 23; // px — matches .codeLine (12px × 1.6 + 4px padding)
const BUFFER = 10;

const tokenizedLines = computed(() => lines.value.map(highlightGcode));

const scrollTop = ref(0);

const visibleRange = computed(() => {
  const viewportH = codeViewerRef.value?.clientHeight ?? 400;
  const start = Math.max(0, Math.floor(scrollTop.value / LINE_HEIGHT) - BUFFER);
  const count = Math.ceil(viewportH / LINE_HEIGHT) + BUFFER * 2;
  const end = Math.min(lines.value.length, start + count);
  return { start, end };
});

const visibleLines = computed(() => {
  const { start, end } = visibleRange.value;
  return tokenizedLines.value.slice(start, end).map((tokens, i) => ({
    lineNum: start + i + 1,
    tokens,
  }));
});

const totalHeight = computed(() => lines.value.length * LINE_HEIGHT);
const offsetY = computed(() => visibleRange.value.start * LINE_HEIGHT);

function onCodeScroll(ev: Event) {
  scrollTop.value = (ev.target as HTMLElement).scrollTop;
  tooltip.value = null;
}

// Scroll to current line (mathematical — no DOM search)
watch(() => props.currentLine, (newLine) => {
  if (newLine != null && codeViewerRef.value) {
    const targetTop = (newLine - 1) * LINE_HEIGHT - codeViewerRef.value.clientHeight / 2 + LINE_HEIGHT / 2;
    codeViewerRef.value.scrollTop = Math.max(0, targetTop);
  }
});

/** ---------- File browser ---------- */
const showBrowser = ref(false);
const files = ref<FileEntry[]>([]);
const currentSubdir = ref("");
const loading = ref(false);
const uploadError = ref<string | null>(null);
const dragOver = ref(false);

async function toggleBrowser() {
  showBrowser.value = !showBrowser.value;
  if (showBrowser.value) await refreshFiles();
}

async function refreshFiles() {
  loading.value = true;
  uploadError.value = null;
  try {
    const resp = await listFiles(currentSubdir.value);
    files.value = resp.entries;
  } catch (e: any) {
    uploadError.value = `Failed to list files: ${e.message}`;
  } finally {
    loading.value = false;
  }
}

function navigateInto(entry: FileEntry) {
  currentSubdir.value = entry.path;
  refreshFiles();
}

function navigateUp() {
  const parts = currentSubdir.value.split("/");
  parts.pop();
  currentSubdir.value = parts.join("/");
  refreshFiles();
}

function selectFile(entry: FileEntry) {
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
async function handleUpload(file: File) {
  uploadError.value = null;
  loading.value = true;
  try {
    const resp = await uploadFile(file);
    emit("loadFile", resp.path);
    if (showBrowser.value) await refreshFiles();
  } catch (e: any) {
    uploadError.value = `Upload failed: ${e.message}`;
  } finally {
    loading.value = false;
  }
}

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
  if (!can.value.idle) return;
  const file = e.dataTransfer?.files[0];
  if (file) handleUpload(file);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** ---------- Run from line ---------- */
const selectedLine = ref<number | null>(null);
const showRunDialog = ref(false);
const dialogSpindleDir = ref<"off" | "forward" | "reverse">("forward");
const dialogSpindleSpeed = ref(10000);

onMounted(() => {
  const mach = loadMachineDefaults();
  dialogSpindleDir.value = mach.rflSpindleDir;
  dialogSpindleSpeed.value = mach.rflSpindleRpm;
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

function onStartClick() {
  if (selectedLine.value && selectedLine.value > 1) {
    showRunDialog.value = true;
  } else {
    emit("cycleStart");
  }
}

function confirmRunFromLine() {
  if (!selectedLine.value) return;
  emit("runFromLine", selectedLine.value, dialogSpindleDir.value, dialogSpindleSpeed.value);
  showRunDialog.value = false;
  selectedLine.value = null;
}

/** ---------- Edit mode ---------- */
const editing = ref(false);
const editBuffer = ref("");
const saving = ref(false);
const saveError = ref<string | null>(null);

function enterEdit() {
  if (!props.gcodeContent || !props.activeFile) return;
  editBuffer.value = props.gcodeContent;
  saveError.value = null;
  editing.value = true;
}

function discardEdit() {
  editing.value = false;
  saveError.value = null;
}

async function saveEdit() {
  if (!props.activeFile) return;
  saving.value = true;
  saveError.value = null;
  try {
    await saveFile(props.activeFile, editBuffer.value);
    editing.value = false;
    emit("loadFile", props.activeFile);
  } catch (e: any) {
    saveError.value = `Save failed: ${e.message}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="container" @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">
    <div class="header">
      <Gate :allow="can.idle" class="headerActions">
        <Btn class="actionBtn" size="sm" @click="enterEdit" :disabled="!activeFile || editing">
          Edit
        </Btn>
        <Btn class="actionBtn" size="sm" @click="reloadFile" :disabled="!activeFile || loading || editing">
          Reload
        </Btn>
        <Btn class="actionBtn" size="sm" @click="unloadFile" :disabled="!activeFile || loading">
          Unload
        </Btn>
        <Btn class="actionBtn" size="sm" @click="toggleBrowser" :disabled="loading">
          {{ showBrowser ? 'Hide Files' : 'Browse' }}
        </Btn>
        <Btn class="actionBtn" size="sm" @click="($refs.fileInput as HTMLInputElement).click()">
          Upload
        </Btn>
        <input ref="fileInput" type="file" accept=".ngc,.nc,.gcode,.tap,.txt" @change="onFileSelect" hidden />
      </Gate>
      <div class="fileInfo">
        <span class="label">File:</span>
        <div class="fileName">{{ fileName }}</div>
        <span class="fileMeta" v-if="gcodeContent">{{ lineCount }} lines</span>
        <div v-if="gcodeStats" class="statsAnchor">
          <Btn class="actionBtn" size="sm" @click.stop="showStats = !showStats">Stats</Btn>
          <div class="popover statsPopover" :class="{ open: showStats }" @click.stop>
            <div class="popHeader"><span class="popTitle">Program Stats</span><Btn icon @click="showStats = false">&times;</Btn></div>
            <!-- Donut chart -->
            <div class="donutRow" v-if="donutSegments.length > 0">
              <svg class="donut" viewBox="0 0 100 100">
                <circle class="donutBg" cx="50" cy="50" r="40" />
                <circle v-for="(seg, i) in donutSegments" :key="i"
                  cx="50" cy="50" r="40"
                  fill="none"
                  :stroke="seg.color"
                  stroke-width="12"
                  :stroke-dasharray="seg.dasharray"
                  :stroke-dashoffset="seg.dashoffset"
                  transform="rotate(-90 50 50)"
                />
              </svg>
              <div class="donutLegend">
                <div v-for="seg in donutSegments" :key="seg.label" class="legendItem">
                  <span class="legendDot" :style="{ background: seg.color }"></span>
                  <span>{{ seg.label }}</span>
                  <span class="legendPct">{{ seg.pct }}%</span>
                </div>
              </div>
            </div>

            <div class="sep"></div>

            <div class="statsGrid">
              <span class="statsLabel">Estimated time</span>
              <span class="statsValue">{{ fmtTime(gcodeStats.totalTime) }}</span>

              <span class="statsLabel">Feed time</span>
              <span class="statsValue">{{ fmtTime(gcodeStats.feedTime) }}</span>

              <span class="statsLabel">Rapid time</span>
              <span class="statsValue">{{ fmtTime(gcodeStats.rapidTime) }}</span>
            </div>

            <div class="sep"></div>

            <div class="statsGrid">
              <span class="statsLabel">Rapid</span>
              <span class="statsValue">{{ fmtDist(gcodeStats.rapidDist, gcodeStats.unit) }} ({{ gcodeStats.rapidMoves }})</span>

              <span class="statsLabel">Linear</span>
              <span class="statsValue">{{ fmtDist(gcodeStats.linearDist, gcodeStats.unit) }} ({{ gcodeStats.linearMoves }})</span>

              <span class="statsLabel">Arc</span>
              <span class="statsValue">{{ fmtDist(gcodeStats.arcDist, gcodeStats.unit) }} ({{ gcodeStats.arcMoves }})</span>
            </div>

            <div class="sep"></div>

            <div class="statsGrid">
              <span class="statsLabel">Tool changes</span>
              <span class="statsValue">{{ gcodeStats.toolChanges }}</span>

              <span class="statsLabel">Tools used</span>
              <span class="statsValue">{{ gcodeStats.toolsUsed.length ? gcodeStats.toolsUsed.map(t => 'T' + t).join(', ') : 'None' }}</span>

              <span class="statsLabel">Feed rates</span>
              <span class="statsValue">{{ gcodeStats.feedRates.length ? gcodeStats.feedRates.join(', ') : '-' }}</span>

              <span class="statsLabel">File size</span>
              <span class="statsValue">{{ fmtSize(gcodeStats.fileSize) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Program control -->
    <div class="controlRow">
      <Btn class="ctrlBtn" variant="primary" @click="onStartClick" :disabled="!can.ready || !activeFile || editing">
        <Play :size="14" class="ctrlIcon" /> {{ selectedLine && selectedLine > 1 ? `Start L${selectedLine}` : 'Start' }}
      </Btn>
      <Btn class="ctrlBtn" @click="emit('cycleStep')" :disabled="!((can.ready && activeFile) || can.resume) || editing">
        <SkipForward :size="14" class="ctrlIcon" /> Step
      </Btn>
      <Btn class="ctrlBtn"
        @click="isPaused ? emit('cycleResume') : emit('cyclePause')"
        :disabled="!(can.pause || can.resume)">
        <component :is="isPaused ? Play : Pause" :size="14" class="ctrlIcon" />
        {{ isPaused ? 'Resume' : 'Pause' }}
      </Btn>
      <Btn class="ctrlBtn" variant="danger" @click="emit('abort')" :disabled="!can.abort">
        <Square :size="14" class="ctrlIcon" /> Abort
      </Btn>
      <Btn class="ctrlBtn switchBtn" :active="optionalStop" :disabled="!can.override" @click="emit('toggleOptionalStop')">M01</Btn>
      <Btn class="ctrlBtn switchBtn" :active="blockDelete" :disabled="!can.override" @click="emit('toggleBlockDelete')">/BD</Btn>
    </div>

    <!-- Progress bar -->
    <div class="progressRow" v-if="gcodeContent">
      <div class="progressTrack">
        <div class="progressFill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <span class="progressLabel">
        {{ currentLine ?? 0 }} / {{ lineCount }}
        <span class="progressPct">({{ progressPercent.toFixed(0) }}%)</span>
      </span>
      <span class="elapsedLabel">{{ elapsed }}</span>
    </div>

    <!-- Error banner -->
    <div v-if="uploadError" class="errorBanner">
      <span>{{ uploadError }}</span>
      <Btn icon @click="uploadError = null">&times;</Btn>
    </div>

    <!-- File browser (collapsible) -->
    <div v-if="showBrowser" class="fileBrowser">
      <div class="browserHeader">
        <Btn v-if="currentSubdir" class="backBtn" size="xs" @click="navigateUp">..</Btn>
        <span class="browserPath">{{ currentSubdir || '/' }}</span>
      </div>
      <div class="fileList">
        <div v-for="entry in files" :key="entry.name" class="fileItem"
             :class="{ directory: entry.type === 'directory', activeItem: entry.type === 'file' && entry.path === activeFile }"
             @click="entry.type === 'directory' ? navigateInto(entry) : selectFile(entry)">
          <span class="fileIcon">{{ entry.type === 'directory' ? '/' : '' }}</span>
          <span class="fileEntryName">{{ entry.name }}</span>
          <span v-if="entry.size != null" class="fileSize">{{ formatSize(entry.size) }}</span>
        </div>
        <div v-if="files.length === 0 && !loading" class="emptyBrowser">No program files found</div>
        <div v-if="loading" class="emptyBrowser">Loading...</div>
      </div>
    </div>

    <!-- Code area wrapper (drop overlay target) -->
    <div class="codeArea">
      <!-- Drop overlay -->
      <div v-if="dragOver" class="dropOverlay" :class="{ denied: !can.idle }">
        <svg v-if="can.idle" class="dropIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <svg v-else class="dropIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>
        <div class="dropText">{{ can.idle ? 'Drop program file to upload' : 'Not permitted' }}</div>
      </div>

      <!-- Edit mode -->
      <div v-if="editing" class="stack-controls editArea">
        <div v-if="saveError" class="errorBanner">
          <span>{{ saveError }}</span>
          <Btn icon @click="saveError = null">&times;</Btn>
        </div>
        <textarea class="editTextarea" v-model="editBuffer" spellcheck="false"></textarea>
        <div class="editActions">
          <Btn class="actionBtn" size="sm" variant="primary" @click="saveEdit" :disabled="saving">{{ saving ? 'Saving...' : 'Save' }}</Btn>
          <Btn class="actionBtn" size="sm" @click="discardEdit" :disabled="saving">Discard</Btn>
        </div>
      </div>

      <!-- Code viewer (virtual scroll) -->
      <div class="codeViewer" v-else-if="gcodeContent" ref="codeViewerRef" @scroll="onCodeScroll">
        <div :style="{ height: totalHeight + 'px', position: 'relative' }">
          <div :style="{ position: 'absolute', top: offsetY + 'px', left: 0, right: 0 }">
            <div class="codeLine"
                 v-for="item in visibleLines"
                 :key="item.lineNum"
                 :class="{
                   active: currentLine === item.lineNum,
                   selected: selectedLine === item.lineNum,
                   selectable: runFromLine && gcodeContent
                 }"
                 @click="onLineClick(item.lineNum)">
              <span class="lineNumber">{{ item.lineNum }}</span>
              <span class="lineContent">
                <span
                  v-for="(token, ti) in item.tokens"
                  :key="ti"
                  :class="['token-' + token.type, {
                    'token-interactive': interactive && (token.type === 'gcode' || token.type === 'mcode')
                  }]"
                  @mouseenter="interactive && onTokenMouseEnter($event, token)"
                  @mouseleave="interactive && onTokenMouseLeave()"
                  @click.stop="interactive && onTokenClick($event, token)"
                >{{ token.text }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state / drop zone -->
      <div class="emptyState" v-else :class="{ dragOver }">
        <svg class="uploadIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <div class="emptyText">No program loaded</div>
        <div class="emptyHint">Drag &amp; drop a file here, or use Upload / Browse above</div>
      </div>
    </div>

    <!-- Run from line confirmation dialog -->
    <div v-if="showRunDialog" class="dialogOverlay" @click.self="showRunDialog = false">
      <div class="dialog runDialog">
        <div class="dialogTitle">Run from Line {{ selectedLine }}</div>
        <div class="dialogBody">
          Lines 1–{{ (selectedLine ?? 1) - 1 }} will be interpreted but motion suppressed.
          Arc commands (G2/G3) before the start line may cause
          radius errors and abort the run.
        </div>

        <div class="dialogSection">
          <div class="sub">Spindle Preset</div>
          <div class="spindleBtnRow">
            <Btn class="optBtn" size="sm" :selected="dialogSpindleDir === 'off'"
                    @click="dialogSpindleDir = 'off'">Off</Btn>
            <Btn class="optBtn" size="sm" :selected="dialogSpindleDir === 'forward'"
                    @click="dialogSpindleDir = 'forward'">FWD</Btn>
            <Btn class="optBtn" size="sm" :selected="dialogSpindleDir === 'reverse'"
                    @click="dialogSpindleDir = 'reverse'">REV</Btn>
          </div>
          <div v-if="dialogSpindleDir !== 'off'" class="rpmRow">
            <label>RPM</label>
            <input type="number" v-model.number="dialogSpindleSpeed" min="0" :step="STEP_RPM" />
          </div>
        </div>

        <div class="dialogActions">
          <Btn @click="showRunDialog = false">Cancel</Btn>
          <Btn variant="primary" @click="confirmRunFromLine"
                  :disabled="!can.ready">Run from Line {{ selectedLine }}</Btn>
        </div>
      </div>
    </div>

    <!-- G-code tooltip (fixed position, pointer-events: none) -->
    <div v-if="tooltip" class="gcodeTooltip"
         :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }">
      <div class="gcodeTooltipCode">{{ tooltip.code }} — {{ tooltip.name }}</div>
      <div class="gcodeTooltipDesc">{{ tooltip.desc }}</div>
    </div>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: var(--gap-controls);
}

.header {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  padding: 8px 12px;
  background: color-mix(in oklab, var(--panel) 50%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
}

.controlRow {
  display: flex;
  gap: var(--gap-controls);
}

.ctrlBtn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--gap-tight);
}

.switchBtn {
  flex: 0 0 auto;
  opacity: var(--opacity-muted);
}

.switchBtn.active {
  opacity: 1;
}

.ctrlIcon {
  font-size: var(--fs-lg);
}

.progressRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
}

.progressTrack {
  flex: 1;
  height: 6px;
  border-radius: var(--radius-sm);
  background: color-mix(in oklab, var(--panel) 90%, var(--fg));
  overflow: hidden;
}

.progressFill {
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--info);
  transition: width 0.3s ease;
}

.progressLabel {
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
  opacity: var(--opacity-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.progressPct {
  opacity: var(--opacity-muted);
}

.elapsedLabel {
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
  opacity: var(--opacity-muted);
  white-space: nowrap;
  flex-shrink: 0;
  margin-left: auto;
}

.fileInfo {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  min-width: 0;
}


.fileName {
  font-family: var(--font-mono);
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.headerActions {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  flex-shrink: 0;
}

.fileMeta {
  font-size: var(--fs-base);
  opacity: var(--opacity-muted);
  white-space: nowrap;
}

.statsAnchor {
  position: relative;
  margin-left: auto;
}

.statsPopover.open {
  display: flex;
  flex-direction: column;
  gap: var(--gap-controls);
  right: 0;
  top: 100%;
  margin-top: var(--gap-tight);
  min-width: 260px;
}

.statsGrid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--gap-tight) var(--gap-controls);
  font-size: var(--fs-base);
}

.statsLabel {
  opacity: var(--opacity-muted);
}

.statsValue {
  font-family: var(--font-mono);
  text-align: right;
}

.donutRow {
  display: flex;
  align-items: center;
  gap: var(--gap-section);
}

.donut {
  width: 80px;
  height: 80px;
  flex-shrink: 0;
}

.donutBg {
  fill: none;
  stroke: color-mix(in oklab, var(--panel) 90%, var(--fg));
  stroke-width: 12;
}

.donutLegend {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  font-size: var(--fs-sm);
}

.legendItem {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}

.legendDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legendPct {
  font-family: var(--font-mono);
  opacity: var(--opacity-muted);
  margin-left: auto;
}

.actionBtn {
  white-space: nowrap;
}


/* Error banner */
.errorBanner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-controls);
  padding: 6px 10px;
  background: color-mix(in oklab, var(--err) 15%, var(--panel));
  border: 1px solid color-mix(in srgb, var(--err) 25%, transparent);
  border-radius: var(--radius-lg);
  font-size: var(--fs-base);
  color: var(--danger);
}

/* File browser */
.fileBrowser {
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: color-mix(in oklab, var(--panel) 70%, transparent);
  max-height: 200px;
  display: flex;
  flex-direction: column;
}

.browserHeader {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
}

.backBtn {
  font-size: var(--fs-sm);
  padding: 2px 8px;
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
}

.backBtn:hover {
  border-color: var(--accent);
}

.browserPath {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
}

.fileList {
  overflow-y: auto;
  flex: 1;
}

.fileItem {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  padding: 5px 10px;
  cursor: pointer;
  font-size: var(--fs-base);
  transition: background 0.1s;
}

.fileItem:hover {
  background: color-mix(in oklab, var(--panel) 90%, var(--fg) 5%);
}

.fileItem.activeItem {
  background: color-mix(in oklab, var(--info) 15%, var(--panel));
}

.fileItem.directory .fileEntryName {
  font-weight: var(--fw-semibold);
}

.fileIcon {
  font-family: var(--font-mono);
  opacity: var(--opacity-muted);
  width: 10px;
  text-align: center;
}

.fileEntryName {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fileSize {
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
  flex-shrink: 0;
}

.emptyBrowser {
  padding: 12px;
  text-align: center;
  font-size: var(--fs-base);
  opacity: var(--opacity-muted);
}

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
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-section);
  border: 2px dashed var(--info);
  border-radius: var(--radius-xl);
  background: color-mix(in oklab, var(--info) 10%, var(--panel) 90%);
  pointer-events: none;
}

.dropOverlay.denied {
  border-color: var(--danger);
  background: color-mix(in oklab, var(--danger) 10%, var(--panel) 90%);
}

.dropIcon {
  width: 48px;
  height: 48px;
  color: var(--info);
  opacity: 0.8;
}

.denied .dropIcon {
  color: var(--danger);
}

.dropText {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--info);
  opacity: 0.9;
}

.denied .dropText {
  color: var(--danger);
}

.codeViewer {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: color-mix(in oklab, var(--panel) 70%, transparent);
  overflow: auto;
  padding: 8px 0;
}

.codeLine {
  display: flex;
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  line-height: 1.6;
  padding: 2px 12px;
  height: 23px;
  box-sizing: border-box;
}

.codeLine:hover {
  background: color-mix(in oklab, var(--panel) 90%, var(--fg) 5%);
}

.codeLine.active {
  background: color-mix(in oklab, var(--highlight) 20%, var(--panel));
  border-left: 3px solid var(--highlight);
  padding-left: 9px;
}

.lineNumber {
  display: inline-block;
  min-width: 40px;
  text-align: right;
  margin-right: 16px;
  opacity: var(--opacity-muted);
  user-select: none;
  flex-shrink: 0;
}

.lineContent {
  color: var(--fg);
  white-space: pre;
  flex: 1;
}

.emptyState {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-section);
  opacity: var(--opacity-muted);
  border: 2px dashed var(--border);
  border-radius: var(--radius-xl);
  transition: border-color 0.2s, background 0.2s, opacity 0.2s;
}

.emptyState.dragOver {
  border-color: var(--info);
  background: color-mix(in oklab, var(--info) 8%, var(--panel));
  opacity: 1;
}

.uploadIcon {
  width: 40px;
  height: 40px;
  opacity: var(--opacity-disabled);
}

.emptyText {
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
}

.emptyHint {
  font-size: var(--fs-md);
  opacity: var(--opacity-muted);
}

/* Edit mode */
.editArea {
  flex: 1;
  min-height: 0;
}

.editTextarea {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: color-mix(in oklab, var(--panel) 70%, transparent);
  padding: 8px 12px;
  resize: none;
  white-space: pre;
  tab-size: 4;
  overflow: auto;
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

.codeLine.selected {
  background: color-mix(in oklab, var(--info) 20%, transparent);
  border-left: 2px solid var(--info);
  padding-left: 10px;
}

/* Dialog */
.runDialog {
  text-align: left;
  min-width: 320px;
}

.dialogSection {
  margin: var(--gap-section) 0;
}

.spindleBtnRow {
  display: flex;
  gap: var(--gap-tight);
  margin-top: var(--gap-tight);
}

.rpmRow {
  display: flex;
  align-items: center;
  gap: var(--gap-controls);
  margin-top: var(--gap-controls);
}

.rpmRow input {
  width: 100px;
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
  z-index: 1000;
  max-width: 320px;
  padding: 6px 10px;
  border-radius: var(--radius-lg);
  background: var(--panel);
  border: 1px solid var(--border);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  pointer-events: none;
  font-family: var(--font-sans);
  font-size: var(--fs-sm);
  line-height: 1.4;
}

.gcodeTooltipCode {
  font-family: var(--font-mono);
  font-weight: var(--fw-semibold);
  color: var(--accent);
}

.gcodeTooltipDesc {
  opacity: 0.8;
}

</style>
