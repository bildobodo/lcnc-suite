<script setup lang="ts">
import { computed } from "vue";
import { usePermissions } from "./permissions";

const props = defineProps<{
  gcodeContent: string | null;
  currentLine: number | null;
  isPaused: boolean;
}>();

const can = usePermissions();

const emit = defineEmits<{
  (e: "cycleStart"): void;
  (e: "cyclePause"): void;
  (e: "cycleResume"): void;
  (e: "abort"): void;
}>();

const VISIBLE_LINES = 7;
const HALF = Math.floor(VISIBLE_LINES / 2);

const lines = computed(() => (props.gcodeContent ?? "").split("\n"));
const lineCount = computed(() => lines.value.length);

const visibleRange = computed(() => {
  const cur = (props.currentLine ?? 1) - 1; // 0-indexed
  let start = Math.max(0, cur - HALF);
  let end = start + VISIBLE_LINES;
  if (end > lines.value.length) {
    end = lines.value.length;
    start = Math.max(0, end - VISIBLE_LINES);
  }
  return { start, end };
});

const visibleLines = computed(() => {
  const { start, end } = visibleRange.value;
  return lines.value.slice(start, end).map((text, i) => ({
    num: start + i + 1, // 1-indexed
    text,
    active: start + i + 1 === props.currentLine,
  }));
});

const progressPercent = computed(() => {
  if (!props.currentLine || lineCount.value <= 0) return 0;
  return Math.min(100, (props.currentLine / lineCount.value) * 100);
});

// ---- Syntax highlighting (same as GcodePanel) ----
type Token = { type: "gcode" | "mcode" | "coord" | "param" | "comment" | "text"; text: string };

function highlightGcode(line: string): Token[] {
  const tokens: Token[] = [];
  const commentMatch = line.match(/^([^;(]*)(;.*|(\(.*\).*)?)$/);
  if (commentMatch) {
    const [, code, comment] = commentMatch;
    if (code) tokenizeCode(code, tokens);
    if (comment) tokens.push({ type: "comment", text: comment });
  } else {
    tokenizeCode(line, tokens);
  }
  return tokens;
}

function tokenizeCode(code: string, tokens: Token[]) {
  const pattern = /([GM]\d+(?:\.\d+)?)|([XYZIJKABC][-+]?\d+(?:\.\d+)?)|([FSTPQRHDL]\d+(?:\.\d+)?)|([N]\d+)|(\s+)|([^\s]+)/gi;
  let match;
  while ((match = pattern.exec(code)) !== null) {
    const [, gcode, coord, param, lineNum, space, other] = match;
    if (gcode) {
      tokens.push({ type: gcode.toUpperCase().startsWith("G") ? "gcode" : "mcode", text: gcode });
    } else if (coord) {
      tokens.push({ type: "coord", text: coord });
    } else if (param) {
      tokens.push({ type: "param", text: param });
    } else if (lineNum) {
      tokens.push({ type: "comment", text: lineNum });
    } else if (space) {
      tokens.push({ type: "text", text: space });
    } else if (other) {
      tokens.push({ type: "text", text: other });
    }
  }
}
</script>

<template>
  <div class="gcodeHud">
    <!-- Program controls -->
    <div class="ctrlRow">
      <button class="ctrlBtn primary" :disabled="!can.ready || !gcodeContent" @click="emit('cycleStart')">&#9654;</button>
      <button
        class="ctrlBtn"
        :disabled="!can.pause && !can.resume"
        @click="isPaused ? emit('cycleResume') : emit('cyclePause')"
      >{{ isPaused ? '&#9654;' : '&#9646;&#9646;' }}</button>
      <button class="ctrlBtn danger" :disabled="!can.abort" @click="emit('abort')">&#9632;</button>
    </div>

    <!-- Progress bar -->
    <div class="progressRow">
      <div class="progressBar">
        <div class="progressFill" :style="{ width: progressPercent + '%' }" />
      </div>
      <span class="progressLabel">{{ currentLine ?? 0 }}/{{ lineCount }} ({{ progressPercent.toFixed(0) }}%)</span>
    </div>

    <!-- G-code lines -->
    <div class="codeBlock">
      <div
        v-for="line in visibleLines"
        :key="line.num"
        class="codeLine"
        :class="{ active: line.active }"
      >
        <span class="lineNum">{{ line.num }}</span>
        <span class="lineText">
          <template v-for="(tok, i) in highlightGcode(line.text)" :key="i">
            <span :class="'tok-' + tok.type">{{ tok.text }}</span>
          </template>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gcodeHud {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: color-mix(in oklab, var(--panel) 85%, transparent);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  min-width: 240px;
}

/* Controls */
.ctrlRow {
  display: flex;
  gap: 4px;
}

.ctrlBtn {
  flex: 1;
  padding: 4px 0;
  font-size: 12px;
  border-radius: 4px;
}

.ctrlBtn.primary {
  background: color-mix(in oklab, #4caf50 20%, var(--button-bg));
}

.ctrlBtn.primary:hover:not(:disabled) {
  background: color-mix(in oklab, #4caf50 35%, var(--button-bg));
}

.ctrlBtn.danger {
  background: color-mix(in oklab, #f44336 20%, var(--button-bg));
}

.ctrlBtn.danger:hover:not(:disabled) {
  background: color-mix(in oklab, #f44336 35%, var(--button-bg));
}

/* Progress */
.progressRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.progressBar {
  flex: 1;
  height: 4px;
  background: color-mix(in oklab, var(--fg) 10%, var(--bg));
  border-radius: 2px;
  overflow: hidden;
}

.progressFill {
  height: 100%;
  background: #569cd6;
  transition: width 0.3s ease;
}

.progressLabel {
  font-size: 9px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  color: var(--fg);
  opacity: 0.6;
  white-space: nowrap;
}

/* Code lines */
.codeBlock {
  display: flex;
  flex-direction: column;
}

.codeLine {
  display: flex;
  gap: 8px;
  padding: 2px 8px 2px 8px;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-size: 11px;
  line-height: 1.5;
  border-left: 3px solid transparent;
}

.codeLine.active {
  background: color-mix(in oklab, #ffa500 20%, transparent);
  border-left-color: #ffa500;
  padding-left: 5px;
}

.lineNum {
  min-width: 28px;
  text-align: right;
  opacity: 0.4;
  user-select: none;
}

.lineText {
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Syntax colors (same as GcodePanel) */
.tok-gcode { color: #569cd6; font-weight: 600; }
.tok-mcode { color: #c586c0; font-weight: 600; }
.tok-coord { color: #4ec9b0; }
.tok-param { color: #9cdcfe; }
.tok-comment { color: #6a9955; opacity: 0.8; }
.tok-text { color: var(--fg); }
</style>
