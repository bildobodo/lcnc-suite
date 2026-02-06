<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";

const props = defineProps<{
  activeFile: string | null;
  gcodeContent: string | null;
  currentLine: number | null;
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
    const [full, gcode, coord, param, lineNum, space, other] = match;

    if (gcode) {
      // G or M code
      const isG = gcode.toUpperCase().startsWith('G');
      tokens.push({ type: isG ? 'gcode' : 'mcode', text: gcode });
    } else if (coord) {
      // Coordinate (X, Y, Z, I, J, K, A, B, C)
      tokens.push({ type: 'coord', text: coord });
    } else if (param) {
      // Parameter (F, S, T, P, Q, R, H, D, L)
      tokens.push({ type: 'param', text: param });
    } else if (lineNum) {
      // Line number
      tokens.push({ type: 'comment', text: lineNum });
    } else if (space) {
      // Whitespace
      tokens.push({ type: 'text', text: space });
    } else if (other) {
      // Unknown
      tokens.push({ type: 'text', text: other });
    }
  }
}

// Auto-scroll to current line
watch(() => props.currentLine, async (newLine) => {
  if (newLine !== null && codeViewerRef.value) {
    await nextTick();
    const lineElement = codeViewerRef.value.querySelector(`[data-line="${newLine}"]`);
    if (lineElement) {
      lineElement.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
});
</script>

<template>
  <div class="container">
    <div class="header">
      <div class="fileInfo">
        <div class="label">File:</div>
        <div class="fileName">{{ fileName }}</div>
      </div>
      <div class="stats" v-if="gcodeContent">
        <span>{{ lineCount }} lines</span>
      </div>
    </div>

    <div class="codeViewer" v-if="gcodeContent" ref="codeViewerRef">
      <div class="codeLine"
           v-for="(line, index) in lines"
           :key="index"
           :data-line="index + 1"
           :class="{ active: currentLine === index + 1 }">
        <span class="lineNumber">{{ index + 1 }}</span>
        <span class="lineContent">
          <span
            v-for="(token, ti) in highlightGcode(line)"
            :key="ti"
            :class="'token-' + token.type"
          >{{ token.text }}</span>
        </span>
      </div>
    </div>

    <div class="emptyState" v-else>
      <div class="emptyIcon">📄</div>
      <div class="emptyText">No G-code file loaded</div>
      <div class="emptyHint">Load a program to view its G-code</div>
    </div>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 600px;
  gap: 12px;
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

.stats {
  font-size: 12px;
  opacity: 0.7;
  white-space: nowrap;
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
  transition: background-color 0.2s ease;
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
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  opacity: 0.6;
}

.emptyIcon {
  font-size: 48px;
  opacity: 0.5;
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
