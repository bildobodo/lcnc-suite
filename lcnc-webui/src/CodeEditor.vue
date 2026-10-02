<script setup lang="ts">
// The ONE CodeMirror host (package 5, stage C — extracted from GcodePanel,
// whose program session keeps its own logic): the dynamic import (CM6 stays
// out of the initial bundle), the theme that follows App's resolved isDark,
// the touch rule (text comes from the strip keyboard, inputmode none), and
// the editor as a CODE target of the text keyboard under the caller's
// owner id. The caller owns the SESSION (which file, its original, its
// revision); this component owns the view: created on mount with `doc`,
// destroyed — and its keyboard session closed — on unmount.
import { inject, onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import { isTouchDevice } from "./touchDetect";
import { openTextSession, closeTextSessionIf, inputSession, type TextTarget } from "./inputSession";
import { emitTelemetry } from "./lcncWs";

const props = withDefaults(defineProps<{
  /** The text the view is created with (read once, on mount). */
  doc: string;
  /** The text keyboard's owner of this editor (its input area too). */
  ownerId: string;
  /** The keyboard readout's context ("Editor · file.ngc"). */
  context: string;
  /** Focus the view and open the strip keyboard on mount (default) — the
   *  program's Edit is a deliberate act; selecting a macro in its list is
   *  not, there a tap into the text opens the keyboard. */
  autoOpen?: boolean;
}>(), { autoOpen: true });   // an absent Boolean prop would be false
const emit = defineEmits<{
  /** The text changed (a keystroke, the strip keyboard, undo). */
  change: [];
  /** The editor could not load — never a silent empty editor. */
  loadError: [message: string];
}>();

const host = ref<HTMLDivElement | null>(null);
let view: any = null;
let theme: { compartment: any; make: (dark: boolean) => any } | null = null;
let cm: { deleteCharBackward: any; undo: any; redo: any; cursorCharLeft: any; cursorCharRight: any; insertTab: any } | null = null;
let alive = true;

// The editor's light/dark base theme follows the RESOLVED app theme (design
// wave D8); reconfigured live on a switch.
const isDark = inject<Ref<boolean>>("isDark", ref(false));
watch(isDark, (dark) => {
  if (view && theme) view.dispatch({ effects: theme.compartment.reconfigure(theme.make(dark)) });
});

onMounted(async () => {
  const t0 = performance.now();
  try {
    const [{ EditorState, Compartment }, { EditorView, keymap, lineNumbers }, { defaultKeymap, history, historyKeymap, deleteCharBackward, undo, redo, cursorCharLeft, cursorCharRight, insertTab }, { gcodeEditorLanguage }] =
      await Promise.all([
        import("@codemirror/state"),
        import("@codemirror/view"),
        import("@codemirror/commands"),
        import("./gcodeCmLanguage"),
      ]);
    cm = { deleteCharBackward, undo, redo, cursorCharLeft, cursorCharRight, insertTab };
    // Unmounted (a session discarded or replaced) during the import: the
    // stale import installs nothing.
    if (!alive || !host.value || view) return;
    const make = (dark: boolean) => EditorView.theme({
      "&": { backgroundColor: "var(--bg)", color: "var(--fg)", height: "100%" },
      ".cm-scroller": { fontFamily: "var(--font-mono)", overflow: "auto" },
      // Line numbers muted by COLOUR, like the viewer's (D8).
      ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--fg-muted)", border: "none" },
      "&.cm-focused": { outline: "none" },
      // CM's dark base theme paints a WHITE native caret; pin it to the
      // theme token so it tracks every theme.
      ".cm-content": { caretColor: "var(--fg)" },
    }, { dark });
    theme = { compartment: new Compartment(), make };
    view = new EditorView({
      state: EditorState.create({
        doc: props.doc,
        extensions: [lineNumbers(), history(), keymap.of([...defaultKeymap, ...historyKeymap]),
                     theme.compartment.of(make(isDark.value)), gcodeEditorLanguage,
                     EditorView.updateListener.of((u: any) => { if (u.docChanged) emit("change"); })],
      }),
      parent: host.value,
    });
    // Touch: text entry comes from the strip keyboard — suppress the OS
    // keyboard the same way MachineInput does for number fields.
    if (isTouchDevice.value) view.contentDOM.setAttribute("inputmode", "none");
    if (props.autoOpen) {
      // Focus on entry so the caret shows at once.
      view.focus();
      // A CODE target of the strip keyboard from the moment it exists (opening
      // the editor is the deliberate act); a tap into it re-opens a closed
      // helper (WP8).
      openSession();
    }
  } catch (e: any) {
    emit("loadError", `Editor failed to load: ${e?.message ?? e}`);
    emitTelemetry("edit.editor_load_failed", { msg: String(e?.message ?? e) });
    return;
  }
  const dt = performance.now() - t0;
  if (dt > 250) emitTelemetry("edit.seed_blocked", { ms: Math.round(dt), bytes: props.doc.length });
});

onUnmounted(() => {
  alive = false;
  closeTextSessionIf(props.ownerId);
  view?.destroy();
  view = null;
  theme = null;
});

function target(): TextTarget {
  const v = () => view;
  return {
    insert(text) { const e = v(); if (!e) return; e.dispatch(e.state.replaceSelection(text)); e.focus(); },
    backspace() { const e = v(); if (!e || !cm) return; cm.deleteCharBackward(e); e.focus(); },
    enter() { const e = v(); if (!e) return; e.dispatch(e.state.replaceSelection("\n")); e.focus(); },
    moveCursor(d) { const e = v(); if (!e || !cm) return; (d < 0 ? cm.cursorCharLeft : cm.cursorCharRight)(e); e.focus(); },
    undo() { const e = v(); if (!e || !cm) return; cm.undo(e); e.focus(); },
    redo() { const e = v(); if (!e || !cm) return; cm.redo(e); e.focus(); },
    tab() { const e = v(); if (!e || !cm) return; cm.insertTab(e); e.focus(); },
    canConfirm: () => !!view,
    isVisible: () => !!host.value && host.value.offsetParent !== null,
    // Explicit close (the X key) hands focus to the content the view itself
    // focuses — its DOM focus handler restores the selection.
    focusEl: () => view?.contentDOM ?? null,
  };
}

function openSession() {
  if (!view) return;
  openTextSession({ ownerId: props.ownerId, kind: "code", context: props.context, target: target(), enterLabel: "newline" });
}

function onPointerUp() {
  if (view && !(inputSession.kind && inputSession.ownerId === props.ownerId)) openSession();
}

defineExpose({
  /** The current text, or null before the view exists. */
  text: (): string | null => (view ? view.state.doc.toString() : null),
  /** Replace the whole text (a reload after a conflict). */
  setText(text: string) {
    if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  },
  openSession,
});
</script>

<template>
  <div ref="host" class="editorHost" :data-input-area="ownerId" @pointerup="onPointerUp"></div>
</template>

<style scoped>
.editorHost {
  flex: 1;
  min-height: 0;
  overflow: hidden;  /* CM6 owns scrolling via .cm-scroller */
}
/* Layout-only deep override (CM6 mounts inside the host): fill the host. */
.editorHost :deep(.cm-editor) {
  height: 100%;
}
</style>
