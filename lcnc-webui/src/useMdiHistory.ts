// MDI input + send-history navigation, extracted from App.vue.
//
// In-memory entries carry a monotonic id so the template's :key can stay
// stable across unshift/slice mutations. The persisted form (in
// loadMdiHistory / saveMdiHistory) is plain string[] so older sessions
// stay compatible.
//
// The arrow-key history navigation tracks two extra refs: an index into
// the history list (-1 = "live editing") and a saved snapshot of the
// in-progress text so ArrowUp restores the user's mid-typed command when
// they back out of the history entirely.

import { ref, onMounted } from "vue";
import { loadMdiHistory, saveMdiHistory } from "./defaults";
import type { WsCommand } from "./lcnc";

export interface MdiEntry { id: number; text: string }

const MDI_MAX_HISTORY = 50;

interface UseMdiHistoryOptions {
  /** Send the MDI command to the gateway. Caller controls gating. */
  send: (cmd: WsCommand) => void;
}

export function useMdiHistory(opts: UseMdiHistoryOptions) {
  const mdiText = ref("");
  const mdiHistory = ref<MdiEntry[]>([]);
  const mdiHistoryIndex = ref(-1);
  const mdiSavedInput = ref("");
  let _mdiNextId = 0;

  // Hydrate from the server-synced store. Does not block setup; the list
  // appears empty for the first paint and fills on the next tick.
  onMounted(() => {
    mdiHistory.value = loadMdiHistory().map(text => ({ id: _mdiNextId++, text }));
  });

  function persistMdiHistory() {
    saveMdiHistory(mdiHistory.value.map(e => e.text));
  }

  function handleMdiSend() {
    const cmd = mdiText.value.trim();
    if (!cmd) return;
    if (mdiHistory.value[0]?.text !== cmd) {
      mdiHistory.value.unshift({ id: _mdiNextId++, text: cmd });
      if (mdiHistory.value.length > MDI_MAX_HISTORY) {
        mdiHistory.value = mdiHistory.value.slice(0, MDI_MAX_HISTORY);
      }
    }
    persistMdiHistory();
    mdiHistoryIndex.value = -1;
    mdiSavedInput.value = "";
    opts.send({ cmd: "mdi", text: cmd });
    mdiText.value = "";
  }

  function clearMdiHistory() {
    mdiHistory.value = [];
    persistMdiHistory();
    mdiHistoryIndex.value = -1;
    mdiSavedInput.value = "";
  }

  function onMdiKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      if (mdiHistory.value.length === 0) return;
      if (mdiHistoryIndex.value === -1) {
        mdiSavedInput.value = mdiText.value;
      }
      if (mdiHistoryIndex.value < mdiHistory.value.length - 1) {
        mdiHistoryIndex.value++;
        mdiText.value = mdiHistory.value[mdiHistoryIndex.value]?.text ?? "";
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (mdiHistoryIndex.value < 0) return;
      mdiHistoryIndex.value--;
      if (mdiHistoryIndex.value === -1) {
        mdiText.value = mdiSavedInput.value;
      } else {
        mdiText.value = mdiHistory.value[mdiHistoryIndex.value]?.text ?? "";
      }
      return;
    }
  }

  return {
    mdiText,
    mdiHistory,
    mdiHistoryIndex,
    handleMdiSend,
    clearMdiHistory,
    onMdiKeydown,
  };
}
