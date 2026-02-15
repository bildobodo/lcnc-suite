<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { listFiles, uploadFile, type FileEntry } from "./lcncApi";
import { usePermissions } from "./permissions";

const props = defineProps<{
  activeFile: string | null;
  gcodeContent: string | null;
  currentLine: number | null;
  isPaused: boolean;
}>();

const can = usePermissions();

const emit = defineEmits<{
  (e: "loadFile", path: string): void;
  (e: "unloadFile"): void;
  (e: "cycleStart"): void;
  (e: "cyclePause"): void;
  (e: "cycleResume"): void;
  (e: "abort"): void;
}>();

const codeViewerRef = ref<HTMLDivElement | null>(null);

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
  const file = e.dataTransfer?.files[0];
  if (file) handleUpload(file);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<template>
  <div class="container" @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">
    <div class="header">
      <div class="fileInfo">
        <div class="label">File:</div>
        <div class="fileName">{{ fileName }}</div>
      </div>
      <div class="headerActions">
        <span class="stats" v-if="gcodeContent">{{ lineCount }} lines</span>
        <button class="actionBtn" @click="reloadFile" :disabled="!activeFile || loading || !can.idle">
          Reload
        </button>
        <button class="actionBtn" @click="unloadFile" :disabled="!activeFile || loading || !can.idle">
          Unload
        </button>
        <button class="actionBtn" @click="toggleBrowser" :disabled="loading || !can.idle">
          {{ showBrowser ? 'Hide Files' : 'Browse' }}
        </button>
        <label class="actionBtn uploadBtn" :class="{ disabled: !can.idle }">
          Upload
          <input type="file" accept=".ngc,.nc,.gcode,.tap,.txt" @change="onFileSelect" hidden :disabled="!can.idle" />
        </label>
      </div>
    </div>

    <!-- Program control -->
    <div class="controlRow">
      <button class="ctrlBtn primary" @click="emit('cycleStart')" :disabled="!can.ready || !activeFile">
        <span class="ctrlIcon">&#x25B6;</span> Start
      </button>
      <button class="ctrlBtn"
        @click="isPaused ? emit('cycleResume') : emit('cyclePause')"
        :disabled="!(can.pause || can.resume)">
        <span class="ctrlIcon">{{ isPaused ? '&#x25B6;' : '&#x23F8;' }}</span>
        {{ isPaused ? 'Resume' : 'Pause' }}
      </button>
      <button class="ctrlBtn danger" @click="emit('abort')" :disabled="!can.abort">
        <span class="ctrlIcon">&#x23F9;</span> Abort
      </button>
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
    </div>

    <!-- Error banner -->
    <div v-if="uploadError" class="errorBanner">
      <span>{{ uploadError }}</span>
      <button class="errorClose" @click="uploadError = null">&times;</button>
    </div>

    <!-- File browser (collapsible) -->
    <div v-if="showBrowser" class="fileBrowser">
      <div class="browserHeader">
        <button v-if="currentSubdir" class="backBtn" @click="navigateUp">..</button>
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
        <div v-if="files.length === 0 && !loading" class="emptyBrowser">No G-code files found</div>
        <div v-if="loading" class="emptyBrowser">Loading...</div>
      </div>
    </div>

    <!-- Code area wrapper (drop overlay target) -->
    <div class="codeArea">
      <!-- Drop overlay -->
      <div v-if="dragOver" class="dropOverlay">
        <svg class="dropIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <div class="dropText">Drop G-code file to upload</div>
      </div>

      <!-- Code viewer (virtual scroll) -->
      <div class="codeViewer" v-if="gcodeContent" ref="codeViewerRef" @scroll="onCodeScroll">
        <div :style="{ height: totalHeight + 'px', position: 'relative' }">
          <div :style="{ position: 'absolute', top: offsetY + 'px', left: 0, right: 0 }">
            <div class="codeLine"
                 v-for="item in visibleLines"
                 :key="item.lineNum"
                 :class="{ active: currentLine === item.lineNum }">
              <span class="lineNumber">{{ item.lineNum }}</span>
              <span class="lineContent">
                <span
                  v-for="(token, ti) in item.tokens"
                  :key="ti"
                  :class="'token-' + token.type"
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
        <div class="emptyText">No G-code file loaded</div>
        <div class="emptyHint">Drag &amp; drop a file here, or use Upload / Browse above</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 600px;
  gap: 8px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: color-mix(in oklab, var(--panel) 50%, transparent);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.controlRow {
  display: flex;
  gap: 8px;
}

.ctrlBtn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}

.ctrlBtn.primary {
  background: color-mix(in oklab, #1a9a1a 25%, var(--button-bg));
  border-color: #1a9a1a80;
}

.ctrlBtn.danger {
  background: color-mix(in oklab, #cc3333 25%, var(--button-bg));
  border-color: #cc333380;
}

.ctrlIcon {
  font-size: 14px;
}

.progressRow {
  display: flex;
  align-items: center;
  gap: 10px;
}

.progressTrack {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: color-mix(in oklab, var(--panel) 90%, var(--fg));
  overflow: hidden;
}

.progressFill {
  height: 100%;
  border-radius: 3px;
  background: #569cd6;
  transition: width 0.3s ease;
}

.progressLabel {
  font-size: 11px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  opacity: 0.7;
  white-space: nowrap;
  flex-shrink: 0;
}

.progressPct {
  opacity: 0.6;
}

.fileInfo {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.label {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.fileName {
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.headerActions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.stats {
  font-size: 12px;
  opacity: 0.7;
  white-space: nowrap;
}

.actionBtn {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 6px;
  white-space: nowrap;
}

.uploadBtn {
  cursor: pointer;
}

.uploadBtn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

/* Error banner */
.errorBanner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: color-mix(in oklab, #b00020 15%, var(--panel));
  border: 1px solid #b0002040;
  border-radius: 6px;
  font-size: 12px;
  color: #ff6b6b;
}

.errorClose {
  background: none;
  border: none;
  color: inherit;
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  opacity: 0.7;
}

.errorClose:hover {
  opacity: 1;
}

/* File browser */
.fileBrowser {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in oklab, var(--panel) 70%, transparent);
  max-height: 200px;
  display: flex;
  flex-direction: column;
}

.browserHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  opacity: 0.7;
}

.backBtn {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--button-bg);
  color: var(--fg);
  cursor: pointer;
  font-family: monospace;
}

.backBtn:hover {
  border-color: #646cff;
}

.browserPath {
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-size: 11px;
}

.fileList {
  overflow-y: auto;
  flex: 1;
}

.fileItem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.1s;
}

.fileItem:hover {
  background: color-mix(in oklab, var(--panel) 90%, var(--fg) 5%);
}

.fileItem.activeItem {
  background: color-mix(in oklab, #569cd6 15%, var(--panel));
}

.fileItem.directory .fileEntryName {
  font-weight: 600;
}

.fileIcon {
  font-family: monospace;
  opacity: 0.5;
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
  font-size: 11px;
  opacity: 0.5;
  flex-shrink: 0;
}

.emptyBrowser {
  padding: 12px;
  text-align: center;
  font-size: 12px;
  opacity: 0.5;
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
  gap: 12px;
  border: 2px dashed #569cd6;
  border-radius: 8px;
  background: color-mix(in oklab, #569cd6 10%, var(--panel) 90%);
  pointer-events: none;
}

.dropIcon {
  width: 48px;
  height: 48px;
  color: #569cd6;
  opacity: 0.8;
}

.dropText {
  font-size: 14px;
  font-weight: 600;
  color: #569cd6;
  opacity: 0.9;
}

.codeViewer {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in oklab, var(--panel) 70%, transparent);
  overflow: auto;
  padding: 8px 0;
}

.codeLine {
  display: flex;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.6;
  padding: 2px 12px;
  height: 23px;
  box-sizing: border-box;
}

.codeLine:hover {
  background: color-mix(in oklab, var(--panel) 90%, var(--fg) 5%);
}

.codeLine.active {
  background: color-mix(in oklab, #ffa500 20%, var(--panel));
  border-left: 3px solid #ffa500;
  padding-left: 9px;
}

.lineNumber {
  display: inline-block;
  min-width: 40px;
  text-align: right;
  margin-right: 16px;
  opacity: 0.5;
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
  min-height: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  opacity: 0.6;
  border: 2px dashed var(--border);
  border-radius: 8px;
  transition: border-color 0.2s, background 0.2s, opacity 0.2s;
}

.emptyState.dragOver {
  border-color: #569cd6;
  background: color-mix(in oklab, #569cd6 8%, var(--panel));
  opacity: 1;
}

.uploadIcon {
  width: 40px;
  height: 40px;
  opacity: 0.4;
}

.emptyText {
  font-size: 16px;
  font-weight: 600;
}

.emptyHint {
  font-size: 13px;
  opacity: 0.7;
}

/* Syntax highlighting tokens */
.token-gcode {
  color: #569cd6; /* Blue for G-codes */
  font-weight: 600;
}

.token-mcode {
  color: #c586c0; /* Purple for M-codes */
  font-weight: 600;
}

.token-coord {
  color: #4ec9b0; /* Teal for coordinates */
}

.token-param {
  color: #9cdcfe; /* Light blue for parameters */
}

.token-comment {
  color: #6a9955; /* Green for comments */
  opacity: 0.8;
}

.token-text {
  color: var(--fg);
}
</style>
