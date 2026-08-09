<script setup lang="ts">
import { computed } from "vue";
import { Delete } from "lucide-vue-next";
import MachineBtn from "./MachineBtn.vue";

const props = defineProps<{
  /** Axis letters from viewer_init (useAxes upstream) — never hardcoded. */
  axes: string[];
  /** mdi: Enter sends the command; editor: Enter inserts a newline. */
  mode: "mdi" | "editor";
}>();

const emit = defineEmits<{
  (e: "key", text: string): void;
  (e: "backspace"): void;
  (e: "enter"): void;
  (e: "clear"): void;
}>();

// Command letters first, then the machine's actual axis letters, then arc/
// parameter letters. Dedup guards against overlap (an axis machine already
// covers none of the fixed sets, but INI axis lists are operator input).
const letters = computed(() => {
  const out: string[] = [];
  for (const l of ["G", "M", "T", "F", "S", ...props.axes.map(a => a.toUpperCase()), "I", "J", "K", "P", "R", "Q"]) {
    if (!out.includes(l)) out.push(l);
  }
  return out;
});

const digits = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ".", "-"];

// All keys act on pointerdown with preventDefault: the press must never
// steal focus from the MDI input (blur would dismiss the keypad mid-word).
function press(t: string, e: PointerEvent) {
  if (e.button !== 0) return;
  emit("key", t);
}
</script>

<template>
  <div class="stripSection gkStrip">
    <div class="sub">{{ mode === "mdi" ? "MDI Keys" : "Editor Keys" }}</div>
    <div class="gkRows">
      <div class="gkLetters">
        <MachineBtn
          v-for="l in letters" :key="l" type="numKey" class="gkKey"
          @pointerdown.prevent="press(l, $event)" @contextmenu.prevent
        >{{ l }}</MachineBtn>
      </div>
      <!-- Pad block: fixed 4×5 numpad-style grid, IDENTICAL in both
           orientations — digits auto-place into the 3-wide block because
           the explicitly-placed ops occupy the whole 4th column, space
           bar spans the bottom row (physical-numpad layout). -->
      <div class="gkPad" :class="mode">
        <MachineBtn
          v-for="d in digits" :key="d" type="numKey" class="gkKey"
          @pointerdown.prevent="press(d, $event)" @contextmenu.prevent
        >{{ d }}</MachineBtn>
        <MachineBtn type="numOp" class="gkKey gkBksp" @pointerdown.prevent="emit('backspace')" @contextmenu.prevent><Delete :size="16" /></MachineBtn>
        <MachineBtn v-if="mode === 'mdi'" type="numOp" class="gkKey gkClear" @pointerdown.prevent="emit('clear')" @contextmenu.prevent>Clear</MachineBtn>
        <MachineBtn type="numKey" variant="primary" class="gkKey gkEnter" @pointerdown.prevent="emit('enter')" @contextmenu.prevent>
          {{ mode === "mdi" ? "Send" : "⏎" }}
        </MachineBtn>
        <MachineBtn type="numOp" class="gkKey gkSpace" @pointerdown.prevent="press(' ', $event)" @contextmenu.prevent>Space</MachineBtn>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gkRows {
  display: flex;
  gap: var(--gap-controls);
  flex: 1;
  min-height: 0;
}
/* Everything is a fixed --key-size square cell (shared token with
   NumberKeypadStrip). The pad block never changes; only the letters grid
   transforms: landscape is height-limited so letters flow column-wise
   into 5 fixed rows (columns appear as needed), portrait is width-limited
   so letters flow row-wise into as many columns as fit. */
.gkLetters {
  display: grid;
  grid-template-rows: repeat(5, var(--key-size));
  grid-auto-flow: column;
  grid-auto-columns: var(--key-size);
  gap: var(--gap-tight);
}
.gkPad {
  display: grid;
  grid-template-columns: repeat(4, var(--key-size));
  grid-auto-rows: var(--key-size);
  gap: var(--gap-tight);
}
/* Ops occupy the 4th column + bottom row; digits auto-place around them.
   Column 4 top-to-bottom: Clear, ⌫, Send (2 tall); the space bar takes
   the whole bottom row. Editor mode has no Clear — ⌫ grows to 2 tall so
   the column stays full. */
.gkClear { grid-column: 4; grid-row: 1; }
.gkBksp  { grid-column: 4; grid-row: 2; }
.gkEnter { grid-column: 4; grid-row: 3 / 5; }
.gkPad.editor .gkBksp { grid-row: 1 / 3; }
.gkSpace { grid-column: 1 / 5; grid-row: 5; }
/* Tall Send key: vertical label, it can't fit horizontally in one cell. */
.gkPad.mdi .gkEnter { writing-mode: vertical-rl; }
.gkKey {
  min-height: 0; /* grid rows own the height — override the touch layer's button floor */
}

@media (orientation: portrait) {
  /* Width-limited: letters become a full-width top block flowing
     row-wise; the pad wraps beneath it, unchanged. */
  .gkRows { flex-wrap: wrap; }
  .gkLetters {
    width: 100%;
    grid-template-rows: none;
    grid-auto-flow: row;
    grid-template-columns: repeat(auto-fill, var(--key-size));
    grid-auto-rows: var(--key-size);
  }
}
</style>
