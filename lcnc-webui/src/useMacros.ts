// Macro state + execution, extracted from App.vue.
//
// A macro is a FILE in the macro folder (package 5): the gateway lists and
// parses them (macroFiles.ts); the bar holds the names in the `macros`
// settings section's `bar` key. The earlier MDI-line macros of the settings
// were dropped on the operator's word (2026-10-02); a stored list stays in
// the section untouched (macroParams.mergeMacrosSection) and is not used.
//
// settingsVersion-driven cross-client sync is handled inside the
// composable: when another tab saves the bar, our copy refreshes from the
// shared store.

import { computed, ref, watch } from "vue";
import { loadMacrosDefaults, saveMacrosDefaults, settingsVersion } from "./defaults";
import type { Permissions } from "./permissions";
import type { MacroFile } from "./lcncApi";
import { macroFileByName, macroFolder, macroEditorBasis } from "./macroFiles";
import { fileHoldKey, macroRunBlock } from "./macroBar";

/** The open parameter dialog: WHICH macro file (by name — the file itself
 *  is read live from the gateway's list, never copied), its title when it
 *  opened (shown once the file is gone) and the entered values. */
export interface MacroParamDialogState {
  name: string;
  title: string;
  values: Record<string, string>;
}

interface UseMacrosOptions {
  /** Permission-gated send wrapper from App.vue. */
  fire: (payload: any, gate?: keyof Permissions, cooldownMs?: number) => void;
}

let earlierNoted = false;
/** The settings still hold earlier MDI-line macros: said once, never used. */
function noteEarlierMacros(list: unknown[]) {
  if (earlierNoted || list.length === 0) return;
  earlierNoted = true;
  console.info(`[macros] ${list.length} earlier MDI-line macro(s) are stored in the settings and no longer used — macros are files now (operator 2026-10-02); the stored list is left as it is.`);
}

export function useMacros(opts: UseMacrosOptions) {
  /** The macro FILES on the bar, in order: names from the `bar` key. */
  const macroBarNames = ref<string[]>(loadMacrosDefaults().bar ?? []);
  const macroParamDialog = ref<MacroParamDialogState | null>(null);
  noteEarlierMacros(loadMacrosDefaults().macros);

  // Cross-client sync: another tab saved the bar → settingsVersion bumps
  // → re-read the shared store.
  watch(settingsVersion, () => {
    const d = loadMacrosDefaults();
    macroBarNames.value = d.bar ?? [];
    noteEarlierMacros(d.macros);
  });

  // The dialog's file, LIVE from the gateway's list: a save from any client
  // while the dialog is open is what it shows, binds the Execute hold to and
  // runs (the rule of implementation review round 4, UI-DI08); a deleted
  // file runs nothing.
  const dialogFile = computed<MacroFile | null>(() => {
    const d = macroParamDialog.value;
    void macroFolder.value;   // re-evaluate when the list changes
    return d ? macroFileByName(d.name) : null;
  });
  /** Why the dialog's Execute may not run its file now, or null. */
  const dialogFileBlock = computed<string | null>(() => {
    if (!macroParamDialog.value) return null;
    const f = dialogFile.value;
    return f ? macroRunBlock(f, macroEditorBasis.value) : "Macro removed — nothing to run";
  });
  // A changed parameter set: entered values stay, a new parameter shows its
  // default, a dropped one leaves.
  watch(() => dialogFile.value?.params, params => {
    const d = macroParamDialog.value;
    if (!d || !params) return;
    for (const p of params) if (!(p.key in d.values)) d.values[p.key] = String(p.default);
    for (const k of Object.keys(d.values)) if (!params.some(p => p.key === k)) delete d.values[k];
  });
  watch(() => dialogFile.value?.title, t => { if (t && macroParamDialog.value) macroParamDialog.value.title = t; });

  /** The macro files on the bar, in order (the Macros tab's toggle and
   *  arrows): saved with the rest of the section unchanged. */
  function setMacroBar(names: string[]) {
    macroBarNames.value = names;
    saveMacrosDefaults({ ...loadMacrosDefaults(), bar: names });
  }

  function confirmMacroParams() {
    const d = macroParamDialog.value;
    const f = dialogFile.value;
    if (!d || !f || dialogFileBlock.value) return;
    // numbers as entered; the gateway checks them against the header
    opts.fire({ cmd: "run_macro", name: f.name, revision: f.revision,
                args: f.params.map(p => Number(d.values[p.key])) }, 'probe');
    macroParamDialog.value = null;
  }

  /** The dialog's Execute: the LIVE file's revision AND the entered values;
   *  a removed file binds nothing (its Execute is disabled). */
  function macroExecuteKey(): string {
    const d = macroParamDialog.value;
    const f = dialogFile.value;
    return d && f ? `${fileHoldKey(f)}\n${JSON.stringify(d.values)}` : "";
  }

  /** A macro file from the bar or the Macros tab: with parameters a tap
   *  opens the dialog (no motion yet); without, a complete hold sends
   *  run_macro bound to the revision shown. The send checks `probe`, the
   *  button's own class (N95). */
  function runMacroFile(file: MacroFile) {
    if (macroRunBlock(file, macroEditorBasis.value)) return;
    if (file.params.length > 0) {
      const values: Record<string, string> = {};
      for (const p of file.params) values[p.key] = String(p.default);
      macroParamDialog.value = { name: file.name, title: file.title ?? file.name, values };
    } else {
      opts.fire({ cmd: "run_macro", name: file.name, revision: file.revision, args: [] }, 'probe');
    }
  }

  return {
    macroBarNames,
    setMacroBar,
    macroParamDialog,
    dialogFile,
    dialogFileBlock,
    runMacroFile,
    confirmMacroParams,
    macroExecuteKey,
  };
}
