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
//                     sits on the safety tier (--z-modal-top) and above
//                     every other dialog in the STACK too (modalRegistry:
//                     one order for layer, focus and scope — UI-DI01)
//   busy (running)  — nothing closes until the operation replied; the caller
//                     clears `busy` on success, error and lost connection
//
// No native <dialog> / showModal() / `inert`: those make the safety strip
// inert and turn Escape into a cancel — both violate standing invariants.
// Opening a dialog over another PAUSES the input helper of the one below
// (`pauseInputIn`, never an owner end: its draft survives). Only the TOPMOST
// dialog is an operating position: a dialog opened under a machine flow
// waits behind it without focus, and only the topmost returns focus when it
// closes — a lower dialog closing under it leaves focus where it is
// (implementation review UI-DI01/02).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { X } from "lucide-vue-next";
import MachineBtn from "./MachineBtn.vue";
import { dialogBelowEl, inDialogScope, popDialog, pushDialog, registerModal, takeOpener, topDialog,
         type DialogEntry, type DialogKind } from "./modalRegistry";
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
  /** What the dimmed X says while `busy` ("Import in progress"). */
  busyLabel?: string;
  /** Initial focus: Anhang B's target. `safe` = the first enabled action
   *  (the cancel side sits left), `first-field`, `close` (the X),
   *  `container`, or a selector inside the dialog. Defaults by kind: form →
   *  first field, info → the X, host → the container, confirm / flow → the
   *  safe action (a flow with two machine actions passes `container`). A
   *  disabled target, or one scrolled out of the dialog's view, gives way
   *  to the container. */
  initialFocus?: "safe" | "first-field" | "close" | "container" | string;
}>(), { size: "confirm" });

const emit = defineEmits<{ (e: "close", reason: "x" | "backdrop"): void }>();

const uid = useId();
const id = `dlg-${uid}`;
const titleId = `dlg-title-${uid}`;
const box = ref<HTMLElement | null>(null);

registerModal(() => true);
// The stack entry: its opener is the control focus goes back to on close
// (a lower dialog closing first may re-point it — popDialog).
const entry: DialogEntry = {
  id, kind: props.kind, el: () => box.value,
  initial: () => (box.value ? initialTarget(box.value) : null),
  opener: takeOpener(),
};
pushDialog(entry);
// The dialog underneath (or the panels) — its input helper pauses.
const below = dialogBelowEl(id);
const isTop = () => topDialog.value?.id === id;

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
  // The target must take focus: a control disabled by an enclosing Gate
  // (Settings' selected tab while disarmed — implementation review UI-DI04)
  // or not rendered gives way to the container, which always can. And the
  // initial focus never hides the beginning of a dialog (WAI-ARIA APG
  // dialog pattern): a target outside the visible part of the dialog's
  // content — Run from line's first option under its warning text on a
  // short content area — gives way to it too; the first Tab then scrolls
  // to the controls, and nothing sits unseen under Space or Enter.
  return t && !t.matches(":disabled") && t.getClientRects().length > 0 && shownIn(t, el) ? t : el;
}
function shownIn(t: HTMLElement, box: HTMLElement): boolean {
  const r = t.getBoundingClientRect();
  for (let p = t.parentElement; p && p !== box.parentElement; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
    const c = p.getBoundingClientRect();
    if (r.top < c.top || r.bottom > c.bottom || r.left < c.left || r.right > c.right) return false;
  }
  return true;
}

onMounted(async () => {
  if (isTop()) pauseInputIn(below ?? document.getElementById("content-dialog-area"), "a dialog opened over it");
  // Else it opened UNDER a machine flow: everything beneath the flow paused
  // when the flow opened, and its scrim and scope keep it so.
  await nextTick();
  const el = box.value;
  if (!el) return;
  if (isTop()) { initialTarget(el).focus({ preventScroll: true }); return; }
  // It waits behind the flow without focus. The press that opened it (a
  // header button — Chromium focuses a clicked button) took focus out of
  // the flow's scope: back to the flow.
  if (!inDialogScope(document.activeElement)) topDialog.value?.initial()?.focus({ preventScroll: true });
});

onBeforeUnmount(() => {
  const { wasTop } = popDialog(id);
  const top = topDialog.value;
  if (!wasTop) {
    // A LOWER dialog closes under a surviving top (the machine ends a tool
    // change under a confirm, a save replies under Settings): the top stays
    // the operating position and keeps focus (UI-DI02). Focus still inside
    // this box (the scope keeps it out) would fall to `body`: to the top.
    if (box.value?.contains(document.activeElement)) top?.initial()?.focus({ preventScroll: true });
    return;
  }
  // The topmost closes. With a dialog left, its opener is a return target
  // only inside that dialog's scope (a child's control in its parent); an
  // opener outside it (the header button that opened a flow over Settings,
  // which Tab may not reach while Settings is up) is not — the guarded
  // return falls back to the new top's initial focus. Without one: back to
  // the control that opened it; gone or dimmed → the strip (never `body`).
  returnFocusTo(top && !inDialogScope(entry.opener) ? null : entry.opener);
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
              <MachineBtn v-if="closeLabel" type="close" class="dialogClose" :aria-label="closeLabel" :title="busy && busyLabel ? busyLabel : closeLabel" :disabled="busy"
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
