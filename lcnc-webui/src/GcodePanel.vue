<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { listFiles, uploadFile, saveFile, type FileEntry } from "./lcncApi";
import { usePermissions } from "./permissions";
import { loadMachineDefaults, STEP_RPM } from "./defaults";
import { highlightGcode, type Token } from "./gcodeHighlight";
import { GCODE_LOOKUP, GCODE_REFERENCE } from "./gcodeReference";
import { Play, SkipForward, Pause } from "lucide-vue-next";
import Gate from "./Gate.vue";
import MachineBtn from "./MachineBtn.vue";
import MachineInput from "./MachineInput.vue";
import MachineToggle from "./MachineToggle.vue";
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
  (e: "showStats"): void;
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
  ev.stopPropagation();
  tooltip.value = null;
  emit("openGcodeRef", token.text.toUpperCase());
}

function dismissTooltip() { tooltip.value = null; }

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

// Token type + highlightGcode() imported from gcodeHighlight.ts

// ---------- Virtual scroll ----------
const LINE_HEIGHT = 23; // px — matches .codeLine (12px × 1.6 + 4px padding)
const BUFFER = 10;

const scrollTop = ref(0);

const visibleRange = computed(() => {
  const viewportH = codeViewerRef.value?.clientHeight ?? 400;
  const start = Math.max(0, Math.floor(scrollTop.value / LINE_HEIGHT) - BUFFER);
  const count = Math.ceil(viewportH / LINE_HEIGHT) + BUFFER * 2;
  const end = Math.min(lines.value.length, start + count);
  return { start, end };
});

// Tokenize only the visible window — never the full file — to avoid blocking the
// main thread (and delaying heartbeat) when a large G-code file is opened.
const visibleLines = computed(() => {
  const { start, end } = visibleRange.value;
  return lines.value.slice(start, end).map((line, i) => ({
    lineNum: start + i + 1,
    tokens: highlightGcode(line),
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
  if (!can.value.setup) return;
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
  <div class="container stack-controls" @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">
    <div class="header stack-tight">
      <div class="headerActions">
          <MachineBtn type="fileOp" class="actionBtn" @click="enterEdit" :disabled="!activeFile || editing">
            Edit
          </MachineBtn>
          <MachineBtn type="fileOp" class="actionBtn" @click="reloadFile" :disabled="!activeFile || loading || editing">
            Reload
          </MachineBtn>
          <MachineBtn type="fileOp" class="actionBtn" @click="unloadFile" :disabled="!activeFile || loading">
            Unload
          </MachineBtn>
          <MachineBtn type="fileOp" class="actionBtn" @click="toggleBrowser" :disabled="loading">
            <span class="stable-width"><span :class="{ alt: !showBrowser }">Hide Files</span><span :class="{ alt: showBrowser }">Browse</span></span>
          </MachineBtn>
          <MachineBtn type="fileOp" class="actionBtn" @click="($refs.fileInput as HTMLInputElement).click()">
            Upload
          </MachineBtn>
          <input ref="fileInput" type="file" accept=".ngc,.nc,.gcode,.tap,.txt" @change="onFileSelect" hidden />
        </div>
      <div class="fileInfo">
        <span class="label">File:</span>
        <div class="fileName">{{ fileName }}</div>
        <span class="fileMeta" v-if="gcodeContent">{{ lineCount }} lines</span>
        <MachineBtn v-if="gcodeStats" type="inline" class="actionBtn" @click="emit('showStats')">Stats</MachineBtn>
      </div>
    </div>

    <!-- Program control -->
    <div class="row-tight">
      <MachineBtn type="start" class="ctrlBtn" @click="onStartClick" :disabled="!activeFile || editing">
        <Play :size="14" class="ctrlIcon" /> {{ selectedLine && selectedLine > 1 ? `Start L${selectedLine}` : 'Start' }}
      </MachineBtn>
      <MachineBtn type="step" class="ctrlBtn" @click="emit('cycleStep')" :disabled="!(activeFile || can.resume) || editing">
        <SkipForward :size="14" class="ctrlIcon" /> Step
      </MachineBtn>
      <MachineBtn :type="isPaused ? 'resume' : 'pause'" class="ctrlBtn"
        @click="isPaused ? emit('cycleResume') : emit('cyclePause')">
        <span class="stable-width"><span :class="{ alt: isPaused }"><Pause :size="14" class="ctrlIcon" /> Pause</span><span :class="{ alt: !isPaused }"><Play :size="14" class="ctrlIcon" /> Resume</span></span>
      </MachineBtn>
      <MachineBtn type="abort" class="ctrlBtn" @click="emit('abort')" />
      <div class="row-tight switchToggles">
        <MachineToggle gate="optionalStop" v-model="optionalStopModel" label="M01" />
        <MachineToggle gate="blockDelete" v-model="blockDeleteModel" label="/BD" />
      </div>
    </div>

    <!-- Progress bar -->
    <div class="row-controls" v-if="gcodeContent">
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
        <MachineBtn type="close" @click="uploadError = null">&times;</MachineBtn>
    </div>

    <!-- File browser (collapsible) -->
    <Gate v-if="showBrowser" gate="setup" class="fileBrowser">
        <div class="browserHeader">
          <MachineBtn v-if="currentSubdir" type="inline" class="backBtn" @click="navigateUp">..</MachineBtn>
          <span class="browserPath">{{ currentSubdir || '/' }}</span>
        </div>
        <div class="sep"></div>
        <div class="fileList scroll-thin">
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
    </Gate>

    <!-- Code area wrapper (drop overlay target) -->
    <div class="codeArea">
      <!-- Drop overlay -->
      <div v-if="dragOver" class="dropOverlay" :class="{ denied: !can.setup }">
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

      <!-- Edit mode -->
      <div v-if="editing" class="stack-controls editArea">
        <div v-if="saveError" class="errorBanner">
          <span>{{ saveError }}</span>
          <MachineBtn type="close" @click="saveError = null">&times;</MachineBtn>
        </div>
        <textarea class="editTextarea" v-model="editBuffer" spellcheck="false"></textarea>
        <div class="editActions">
          <MachineBtn type="fileSave" class="actionBtn" @click="saveEdit" :disabled="saving">{{ saving ? 'Saving...' : 'Save' }}</MachineBtn>
          <MachineBtn type="fileOp" class="actionBtn" @click="discardEdit" :disabled="saving">Discard</MachineBtn>
        </div>
      </div>

      <!-- Code viewer (virtual scroll) -->
      <div class="codeViewer scroll-thin" v-else-if="gcodeContent" ref="codeViewerRef" @scroll="onCodeScroll">
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
      <div class="emptyState dropTarget" v-else :class="{ dragOver }">
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
      <div class="dialog md runDialog">
        <div class="dialogHeader">
          <span class="dialogTitle">Run from Line {{ selectedLine }}</span>
          <MachineBtn type="close" @click="showRunDialog = false">&times;</MachineBtn>
        </div>
        <div class="dialogContent">
          <div class="dialogBody">
            Lines 1–{{ (selectedLine ?? 1) - 1 }} will be interpreted but motion suppressed.
            Arc commands (G2/G3) before the start line may cause
            radius errors and abort the run.
          </div>

          <div class="dialogSection">
            <div class="sub">Spindle Preset</div>
            <div class="spindleBtnRow">
              <MachineBtn type="tab" class="optBtn" :selected="dialogSpindleDir === 'off'"
                      @click="dialogSpindleDir = 'off'">Off</MachineBtn>
              <MachineBtn type="tab" class="optBtn" :selected="dialogSpindleDir === 'forward'"
                      @click="dialogSpindleDir = 'forward'">FWD</MachineBtn>
              <MachineBtn type="tab" class="optBtn" :selected="dialogSpindleDir === 'reverse'"
                      @click="dialogSpindleDir = 'reverse'">REV</MachineBtn>
            </div>
            <div v-if="dialogSpindleDir !== 'off'" class="rpmRow">
              <label>RPM</label>
              <MachineInput gate="displaySettingNum" type="number" v-model.number="dialogSpindleSpeed" min="0" :step="STEP_RPM" />
            </div>
          </div>
        </div>

        <Gate gate="ready" class="dialogActions">
          <MachineBtn type="dialogCancel" @click="showRunDialog = false">Cancel</MachineBtn>
          <MachineBtn type="dialogConfirm" @click="confirmRunFromLine">Run from Line {{ selectedLine }}</MachineBtn>
        </Gate>
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
  height: 100%;
}

.header {
  padding: var(--gap-controls) var(--gap-section);
  background: color-mix(in oklab, var(--panel) 50%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
}

/* .controlRow — uses row-tight utility */

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

/* .progressRow — replaced by row-controls utility (same shape) */

.progressTrack {
  flex: 1;
  height: 10px;
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
  font-size: var(--fs-md);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}

.elapsedLabel {
  font-size: var(--fs-md);
  font-variant-numeric: tabular-nums;
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
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.headerActions {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  flex-shrink: 0;
}

.fileMeta {
  font-size: var(--fs-base);
  opacity: var(--opacity-muted);
  white-space: nowrap;
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
  padding: var(--gap-tight) var(--gap-controls);
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
  padding: var(--gap-tight) var(--gap-controls);
  font-size: var(--fs-sm);
  opacity: var(--opacity-muted);
}

.backBtn {
  font-size: var(--fs-sm);
  padding: 2px 8px;
  border-radius: var(--radius-md);
}

.backBtn:hover {
  border-color: var(--accent);
}

.browserPath {
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
  padding: var(--gap-tight) var(--gap-controls);
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
  padding: var(--gap-section);
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
  opacity: var(--opacity-secondary);
}

.denied .dropIcon {
  color: var(--danger);
}

.dropText {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--info);
  opacity: var(--opacity-secondary);
}

.denied .dropText {
  color: var(--danger);
}

/* .codeViewer, .codeLine, .lineNumber, .lineContent — global in style.css */

.dropTarget {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-section);
  border: 2px dashed var(--border);
  border-radius: var(--radius-xl);
  transition: border-color 0.2s, background 0.2s, opacity 0.2s;
}

.dropTarget.dragOver {
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

/* .codeLine.selected — global in style.css */

/* Dialog */
.runDialog {
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
  color: var(--accent);
}

.gcodeTooltipDesc {
  opacity: var(--opacity-secondary);
}

</style>
