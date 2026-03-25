<script setup lang="ts">
import { computed } from "vue";
import { usePermissions } from "./permissions";
import { Play, SkipForward, Pause, Square } from "lucide-vue-next";
import Btn from "./Btn.vue";
import Gate from "./Gate.vue";

const props = defineProps<{
  gcodeContent: string | null;
  currentLine: number | null;
  isPaused: boolean;
  elapsed: string;
  optionalStop: boolean;
  blockDelete: boolean;
}>();

const can = usePermissions();

const emit = defineEmits<{
  (e: "cycleStart"): void;
  (e: "cycleStep"): void;
  (e: "cyclePause"): void;
  (e: "cycleResume"): void;
  (e: "abort"): void;
  (e: "toggleOptionalStop"): void;
  (e: "toggleBlockDelete"): void;
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
  <div class="gcodeHud hud-panel">
    <!-- Program controls -->
    <Gate :allow="can.abort">
      <template #exempt>
        <div class="row-tight ctrlGroup">
          <Btn variant="ok" size="sm" :disabled="!can.ready || !gcodeContent" @click="emit('cycleStart')"><Play :size="16" /></Btn>
          <Btn size="sm" :disabled="!((can.ready && gcodeContent) || can.resume)" @click="emit('cycleStep')"><SkipForward :size="16" /></Btn>
          <Btn
            size="sm"
            :disabled="!can.pause && !can.resume"
            @click="isPaused ? emit('cycleResume') : emit('cyclePause')"
          ><component :is="isPaused ? Play : Pause" :size="16" /></Btn>
          <Btn variant="danger" size="sm" @click="emit('abort')"><Square :size="16" /></Btn>
        </div>
      </template>
      <div class="row-tight ctrlRow">
        <Gate :allow="can.override">
          <div class="switchGroup">
            <Btn size="sm" muted :active="optionalStop" @click="emit('toggleOptionalStop')">M01</Btn>
            <Btn size="sm" muted :active="blockDelete" @click="emit('toggleBlockDelete')">/BD</Btn>
          </div>
        </Gate>
      </div>
    </Gate>

    <!-- Progress bar -->
    <div class="progressRow">
      <div class="progressBar">
        <div class="progressFill" :style="{ width: progressPercent + '%' }" />
      </div>
      <span class="progressLabel">{{ currentLine ?? 0 }}/{{ lineCount }} ({{ progressPercent.toFixed(0) }}%)</span>
      <span class="elapsedLabel">{{ elapsed }}</span>
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
  gap: var(--gap-tight);
  min-width: 240px;
}

/* Controls */
.ctrlRow {
}

.ctrlGroup :deep(.b),
.switchGroup :deep(.b) {
  flex: 1;
  padding: 4px 0;
}

/* Progress */
.progressRow {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}

.progressBar {
  flex: 1;
  height: 4px;
  background: color-mix(in oklab, var(--fg) 10%, var(--bg));
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.progressFill {
  height: 100%;
  background: var(--info);
  transition: width 0.3s ease;
}

.progressLabel {
  font-size: var(--fs-2xs);
  font-family: var(--font-mono);
  color: var(--fg);
  opacity: var(--opacity-muted);
  white-space: nowrap;
}

.elapsedLabel {
  font-size: var(--fs-2xs);
  font-family: var(--font-mono);
  color: var(--fg);
  opacity: var(--opacity-muted);
  white-space: nowrap;
  margin-left: auto;
}

/* Code lines */
.codeBlock {
  display: flex;
  flex-direction: column;
}

.codeLine {
  display: flex;
  gap: var(--gap-controls);
  padding: 2px 8px 2px 8px;
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  line-height: 1.5;
  border-left: 3px solid transparent;
}

.codeLine.active {
  background: color-mix(in oklab, var(--highlight) 20%, transparent);
  border-left-color: var(--highlight);
  padding-left: 5px;
}

.lineNum {
  min-width: 28px;
  text-align: right;
  opacity: var(--opacity-disabled);
  user-select: none;
}

.lineText {
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ctrlGroup {
  flex: 3;
}

/* switchGroup is a Gate (fieldset); override fs-reset column direction */
.switchGroup {
  flex: 2;
  flex-direction: row;
  gap: var(--gap-tight);
}

</style>
