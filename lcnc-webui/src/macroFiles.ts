// The macro folder as the gateway sees it (package 5, stage C): the list of
// macro files with their parsed headers, revisions and whether LinuxCNC runs
// exactly that file. The gateway is the ONE parser — nothing here reads a
// header. Reloaded when the WS layer reports `macros_changed` (any client's
// write, or a file changed outside the suite) and on every connect.

import { ref, watch } from "vue";
import { listMacroFiles, type MacroFile, type MacroFolder } from "./lcncApi";
import type { MacroEditorBasis } from "./macroBar";

/** Bumped by lcncWs on `macros_changed` and on each connect. */
export const macroFilesVersion = ref(0);
/** The last list the gateway answered (null before the first). */
export const macroFolder = ref<MacroFolder | null>(null);
/** Why the last reload failed (the list keeps its previous value). */
export const macroFolderError = ref<string | null>(null);

let seq = 0;
let inflight: AbortController | null = null;

/** Fetch the list again; a later reload supersedes an earlier one (its
 *  answer is dropped, never applied out of order). */
export async function reloadMacroFiles(): Promise<void> {
  const mine = ++seq;
  inflight?.abort();
  const ac = new AbortController();
  inflight = ac;
  try {
    const folder = await listMacroFiles(ac.signal);
    if (mine !== seq) return;
    macroFolder.value = folder;
    macroFolderError.value = null;
  } catch (e) {
    if (mine !== seq || (e as Error)?.name === "AbortError") return;
    macroFolderError.value = (e as Error)?.message ?? String(e);
  } finally {
    if (inflight === ac) inflight = null;
  }
}

watch(macroFilesVersion, () => { void reloadMacroFiles(); });

export function macroFileByName(name: string): MacroFile | null {
  return macroFolder.value?.macros.find(m => m.name === name) ?? null;
}

/** The Macros tab's open editor and its relation to the file (Codex
 *  VP69-05): the bar, the tab's Run and the parameter dialog read it, so a
 *  macro with an unsaved draft, a text still loading or an open conflict
 *  runs nowhere until Save or Discard / Reload. Null without an editor. */
export const macroEditorBasis = ref<MacroEditorBasis | null>(null);
