// Dialog open-state + open/close helpers, extracted from App.vue.
//
// The "navigation dialogs" (settings, gcodeRef, messages) are mutually
// exclusive — opening one closes the others. The "confirmation dialogs"
// (shutdown, compensation toggle) and the gcode-stats dialog are
// independent. All of them live in one composable because they share the
// same DOM concept (overlay + dialog) and concentrating ownership keeps
// App.vue from sprouting six tiny ref/function clusters.
//
// Side effects requested by callers (markMessagesRead when the messages
// dialog opens; sending a set_compensation command on confirm) are
// injected as factory args so this composable stays free of imports
// from lcncWs.ts.

import { ref, watch } from "vue";
import type { WsCommand } from "./lcnc";
import type { Permissions } from "./permissions";

interface UseDialogStateOptions {
  /** Called when the messages dialog opens via openDialog("messages"). */
  markMessagesRead: () => void;
  /** Raw transport (kept for callers that need it). */
  send: (cmd: WsCommand) => void;
  /** The gated send path (App.vue's fire) — this composable runs in App's
   *  setup, where useFire() cannot inject, so it is handed in explicitly.
   *  The compensation toggle is `ready`-tier on the backend. */
  fire?: (payload: any, gate?: keyof Permissions) => string | null;
  /** Asked before Settings closes by ANY path (its X, the backdrop, opening
   *  another navigation dialog). Returns true when it took over — it shows
   *  "Discard changes?" and calls `proceed` on Discard (UI-K16). */
  guardSettingsClose?: (proceed: () => void) => boolean;
}

export function useDialogState(opts: UseDialogStateOptions) {
  // ── Navigation dialogs (mutually exclusive) ──
  const settingsDialogOpen = ref(false);
  const settingsInitialTab = ref<string | null>(null);
  const gcodeRefOpen = ref(false);
  // What the reference opens on: AT a code word (a code tapped in the
  // program) or on its "Active now" filter (the Safety strip's codes).
  const gcodeRefAt = ref("");
  const gcodeRefActive = ref(false);
  const messagesDialogOpen = ref(false);

  function closeAllDialogs() {
    settingsDialogOpen.value = false;
    gcodeRefOpen.value = false;
    messagesDialogOpen.value = false;
  }

  function openDialog(name: "settings" | "gcodeRef" | "messages") {
    // Leaving Settings is a close of Settings: its draft is asked about
    // first, and the navigation happens only on Discard.
    if (settingsDialogOpen.value && opts.guardSettingsClose?.(() => openDialogNow(name))) return;
    openDialogNow(name);
  }

  function openDialogNow(name: "settings" | "gcodeRef" | "messages") {
    const isOpen = (name === "settings" && settingsDialogOpen.value)
      || (name === "gcodeRef" && gcodeRefOpen.value)
      || (name === "messages" && messagesDialogOpen.value);
    closeAllDialogs();
    if (!isOpen) {
      if (name === "settings") settingsDialogOpen.value = true;
      else if (name === "gcodeRef") gcodeRefOpen.value = true;
      else if (name === "messages") {
        messagesDialogOpen.value = true;
        opts.markMessagesRead();
      }
    }
  }

  /** The message center from the banner, its unread count or the header
   *  icon — ONE way in (design wave D1, UI-N27): the guarded navigation path
   *  (a Settings draft is asked about first), and it OPENS — a second tap on
   *  the banner does not close what the first opened (the header icon
   *  toggles: open → closeMessages). */
  function openMessages() {
    if (messagesDialogOpen.value) { opts.markMessagesRead(); return; }
    openDialog("messages");
  }

  /** ONE way out of the message center: X and backdrop alike mark the
   *  messages read (the backdrop used to leave them unread). */
  function closeMessages() {
    messagesDialogOpen.value = false;
    opts.markMessagesRead();
  }

  /** The Settings dialog's own X and backdrop — the same guarded close. */
  function closeSettings() {
    const close = () => { settingsDialogOpen.value = false; };
    if (opts.guardSettingsClose?.(close)) return;
    close();
  }

  function openSettingsTab(tab: string) {
    settingsInitialTab.value = tab;
    settingsDialogOpen.value = true;
  }

  // Reset the initialTab anchor when the dialog closes so a subsequent
  // open without a tab argument doesn't land on the previous selection.
  watch(settingsDialogOpen, (open) => {
    if (!open) settingsInitialTab.value = null;
  });

  function openGcodeRef(on: { at?: string; active?: boolean } = {}) {
    gcodeRefAt.value = on.at ?? "";
    gcodeRefActive.value = on.active ?? false;
    openDialog("gcodeRef");
  }

  // ── Standalone confirmation / status dialogs ──
  const showShutdownConfirm = ref(false);
  const statsDialogOpen = ref(false);

  // Compensation toggle: null = no dialog; boolean = pending operator
  // confirmation of enabling/disabling compensation.
  const compConfirmPending = ref<boolean | null>(null);

  function requestCompToggle(enable: boolean) {
    compConfirmPending.value = enable;
  }
  function confirmCompToggle() {
    if (compConfirmPending.value !== null) {
      const payload = { cmd: "set_compensation" as const, enable: compConfirmPending.value };
      if (opts.fire) opts.fire(payload, "ready");
      else opts.send(payload);
      compConfirmPending.value = null;
    }
  }
  function cancelCompToggle() {
    compConfirmPending.value = null;
  }

  return {
    // Navigation dialogs
    settingsDialogOpen,
    settingsInitialTab,
    gcodeRefOpen,
    gcodeRefAt,
    gcodeRefActive,
    messagesDialogOpen,
    closeAllDialogs,
    openDialog,
    openMessages,
    closeMessages,
    closeSettings,
    openSettingsTab,
    openGcodeRef,
    // Standalone dialogs
    showShutdownConfirm,
    statsDialogOpen,
    compConfirmPending,
    requestCompToggle,
    confirmCompToggle,
    cancelCompToggle,
  };
}
