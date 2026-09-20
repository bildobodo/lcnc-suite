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
}

export function useDialogState(opts: UseDialogStateOptions) {
  // ── Navigation dialogs (mutually exclusive) ──
  const settingsDialogOpen = ref(false);
  const settingsInitialTab = ref<string | null>(null);
  const gcodeRefOpen = ref(false);
  const gcodeRefInitialSearch = ref("");
  const messagesDialogOpen = ref(false);

  function closeAllDialogs() {
    settingsDialogOpen.value = false;
    gcodeRefOpen.value = false;
    messagesDialogOpen.value = false;
  }

  function openDialog(name: "settings" | "gcodeRef" | "messages") {
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

  function openSettingsTab(tab: string) {
    settingsInitialTab.value = tab;
    settingsDialogOpen.value = true;
  }

  // Reset the initialTab anchor when the dialog closes so a subsequent
  // open without a tab argument doesn't land on the previous selection.
  watch(settingsDialogOpen, (open) => {
    if (!open) settingsInitialTab.value = null;
  });

  function openGcodeRef(code?: string) {
    gcodeRefInitialSearch.value = code ?? "";
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
    gcodeRefInitialSearch,
    messagesDialogOpen,
    closeAllDialogs,
    openDialog,
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
