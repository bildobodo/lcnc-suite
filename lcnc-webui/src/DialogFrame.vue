<script setup lang="ts">
// The ONE dialog frame (design wave D2, UI-K11, K16(3), plan Anhang B).
//
// Every overlay the app shows is this component: the scrim, the dialog box
// with `role="dialog"` named by its title, the tier (confirm / md / lg), the
// header X, self-registration in the modal registry and the dialog STACK,
// the initial focus Anhang B names, the focus return to the control that
// opened it, and ONE close path with a policy per kind:
//
//   info / confirm  — X and the backdrop close (Escape never: it is E-Stop)
//   form            — the backdrop does nothing (a mis-grab never discards)
//   host            — X / backdrop ask the host's own guard (Settings)
//   flow            — a machine flow closes by its own buttons only; it
//                     sits on the safety tier (--z-modal-top)
//   busy (running)  — nothing closes until the operation replied; the caller
//                     clears `busy` on success, error and lost connection
//
// No native <dialog> / showModal() / `inert`: those make the safety strip
// inert and turn Escape into a cancel — both violate standing invariants.
// Opening a dialog over another PAUSES the input helper of the one below
// (`pauseInputIn`, never an owner end: its draft survives).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { X } from "lucide-vue-next";
import MachineBtn from "./MachineBtn.vue";
import { pushDialog, registerModal, topDialogEl, type DialogKind, takeOpener } from "./modalRegistry";
import { pauseInputIn, returnFocusTo } from "./inputSession";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  kind: DialogKind;
  /** confirm = the small centred yes/no box; md / lg = header + content. */
  size?: "confirm" | "md" | "lg";
  title?: string;
  /** A danger title (a destructive question). */
  danger?: boolean;
  /** md.wide / lg.dialog-full modifiers. */
  wide?: boolean;
  full?: boolean;
  /** Extra classes on the dialog box (a per-dialog size rule, global). */
  boxClass?: string;
  /** The header X's contextual name; no X without it (confirm tier). */
  closeLabel?: string;
  /** An operation is in flight: nothing closes (kind running, Anhang B). */
  busy?: boolean;
  /** Initial focus: Anhang B's target. `safe` = the first enabled action
   *  (the cancel side sits left), `first-field`, `close` (the X),
   *  `container`, or a selector inside the dialog. Defaults by kind: form →
   *  first field, info → the X, host → the container, confirm / flow → the
   *  safe action (a flow with two machine actions passes `container`). */
  initialFocus?: "safe" | "first-field" | "close" | "container" | string;
}>(), { size: "confirm" });

const emit = defineEmits<{ (e: "close", reason: "x" | "backdrop"): void }>();

const uid = useId();
const id = `dlg-${uid}`;
const titleId = `dlg-title-${uid}`;
const box = ref<HTMLElement | null>(null);

registerModal(() => true);
const popStack = pushDialog({ id, kind: props.kind, el: () => box.value });

// The control that opened it — focus goes back there on close.
const opener = takeOpener();
// The dialog underneath (or the panels) — its input helper pauses.
const below = topDialogEl(id);

const tierClass = computed(() => [
  props.size === "md" ? "md" : props.size === "lg" ? "lg" : "",
  props.wide ? "wide" : "", props.full ? "dialog-full" : "", props.boxClass ?? "",
]);

function requestClose(reason: "x" | "backdrop") {
  if (props.busy) return;
  if (reason === "backdrop" && (props.kind === "form" || props.kind === "flow")) return;
  emit("close", reason);
}

const FIELD = 'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)';
function initialTarget(el: HTMLElement): HTMLElement {
  const want = props.initialFocus ?? (props.kind === "form" ? "first-field"
    : props.kind === "info" ? "close" : props.kind === "host" ? "container" : "safe");
  let t: HTMLElement | null = null;
  if (want === "first-field") t = el.querySelector<HTMLElement>(FIELD);
  else if (want === "close") t = el.querySelector<HTMLElement>(".dialogClose:not(:disabled)");
  else if (want === "safe") t = el.querySelector<HTMLElement>(".dialogActions button:not(:disabled)");
  else if (want !== "container") t = el.querySelector<HTMLElement>(want);
  return t ?? el;
}

onMounted(async () => {
  pauseInputIn(below ?? document.getElementById("content-dialog-area"), "a dialog opened over it");
  await nextTick();
  const el = box.value;
  if (el) initialTarget(el).focus({ preventScroll: true });
});

onBeforeUnmount(() => {
  popStack();
  // Back to the control that opened it; gone or dimmed → the guarded return
  // falls back to the dialog now on top, else the strip (never `body`).
  returnFocusTo(opener);
});

</script>

<template>
  <Teleport to="#content-dialog-area" defer>
    <div class="dialogOverlay" :class="{ safetyDialog: kind === 'flow' }" v-bind="$attrs" @click.self="requestClose('backdrop')">
      <div :id="id" ref="box" class="dialog" :class="tierClass" role="dialog" :aria-labelledby="titleId" tabindex="-1">
        <template v-if="size === 'confirm'">
          <div :id="titleId" class="dialogTitle" :class="{ danger }"><slot name="title">{{ title }}</slot></div>
          <slot />
        </template>
        <template v-else>
          <div class="dialogHeader">
            <span :id="titleId" class="dialogTitle" :class="{ danger }"><slot name="title">{{ title }}</slot></span>
            <div class="row-tight">
              <slot name="header" />
              <MachineBtn v-if="closeLabel" type="close" class="dialogClose" :aria-label="closeLabel" :title="closeLabel" :disabled="busy"
                          @click="requestClose('x')"><X :size="14" /></MachineBtn>
            </div>
          </div>
          <slot />
        </template>
        <div v-if="$slots.actions" class="dialogActions"><slot name="actions" /></div>
      </div>
    </div>
  </Teleport>
</template>
