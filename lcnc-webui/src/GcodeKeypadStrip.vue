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
      <div class="gkDigits">
        <MachineBtn
          v-for="d in digits" :key="d" type="numKey" class="gkKey"
          @pointerdown.prevent="press(d, $event)" @contextmenu.prevent
        >{{ d }}</MachineBtn>
      </div>
      <div class="gkOps">
        <MachineBtn type="numOp" class="gkKey" @pointerdown.prevent="press(' ', $event)" @contextmenu.prevent>Space</MachineBtn>
        <MachineBtn type="numOp" class="gkKey" @pointerdown.prevent="emit('backspace')" @contextmenu.prevent><Delete :size="16" /></MachineBtn>
        <MachineBtn v-if="mode === 'mdi'" type="numOp" class="gkKey" @pointerdown.prevent="emit('clear')" @contextmenu.prevent>Clear</MachineBtn>
        <MachineBtn type="numKey" variant="primary" class="gkKey gkEnter" @pointerdown.prevent="emit('enter')" @contextmenu.prevent>
          {{ mode === "mdi" ? "Send" : "⏎" }}
        </MachineBtn>
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
/* Same key-grid pattern as NumberKeypad: tight gaps inside a key cluster,
   1fr rows so the cluster fills the strip height. */
.gkLetters {
  display: grid;
  grid-template-columns: repeat(4, minmax(44px, 1fr));
  grid-auto-rows: 1fr;
  gap: var(--gap-tight);
}
.gkDigits {
  display: grid;
  grid-template-columns: repeat(3, minmax(44px, 1fr));
  grid-auto-rows: 1fr;
  gap: var(--gap-tight);
}
.gkOps {
  display: grid;
  grid-auto-rows: 1fr;
  gap: var(--gap-tight);
  min-width: 70px;
}
.gkKey {
  min-height: 0; /* grid rows own the height — override the touch layer's button floor */
}
</style>
