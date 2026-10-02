// Macro state + execution, extracted from App.vue.
//
// Macros are user-defined MDI templates persisted via loadMacrosDefaults
// / saveMacrosDefaults (server-synced). Edits happen in SettingsPanel,
// which receives the `updateMacros` setter via provide/inject — this
// composable returns that setter so App.vue can do the provide() in the
// right setup order.
//
// settingsVersion-driven cross-client sync is handled inside the
// composable: when another tab saves macros, our copy refreshes from
// the shared store.

import { computed, ref, watch } from "vue";
import { loadMacrosDefaults, settingsVersion, type MacroDef } from "./defaults";
import type { Permissions } from "./permissions";
import type { MacroFile } from "./lcncApi";
import { macroFileByName, macroFolder, macroEditorBasis } from "./macroFiles";
import { fileHoldKey, macroRunBlock } from "./macroBar";

/** The open parameter dialog: WHICH macro (by id — the macro itself is read
 *  live from the list, never copied), its name when it opened (the title
 *  once the macro is removed) and the entered values. */
export interface MacroParamDialogState {
  /** "file" = a macro file (package 5) — `macroId` is then its file name. */
  kind?: "legacy" | "file";
  macroId: string;
  name: string;
  values: Record<string, string>;
}

interface UseMacrosOptions {
  /** Permission-gated send wrapper from App.vue. */
  fire: (payload: any, gate?: keyof Permissions, cooldownMs?: number) => void;
}

export function useMacros(opts: UseMacrosOptions) {
  const userMacros = ref<MacroDef[]>(loadMacrosDefaults().macros);
  /** The macro FILES on the bar, in order (package 5): names from the
   *  `macros` section's `bar` key. */
  const macroBarNames = ref<string[]>(loadMacrosDefaults().bar ?? []);
  const macroParamDialog = ref<MacroParamDialogState | null>(null);

  // Cross-client sync: another tab saved macros → settingsVersion bumps
  // → re-read the shared store.
  watch(settingsVersion, () => {
    const d = loadMacrosDefaults();
    userMacros.value = d.macros;
    macroBarNames.value = d.bar ?? [];
  });

  // The dialog's macro, LIVE: a revision saved while the dialog is open (by
  // another client or in Settings) is what it shows, previews, binds the
  // Execute hold to and runs — it used to keep a copy and ran the old
  // command (implementation review round 4, UI-DI08). null = removed.
  const dialogMacro = computed<MacroDef | null>(() => {
    const d = macroParamDialog.value;
    return d && d.kind !== "file" ? userMacros.value.find(m => m.id === d.macroId) ?? null : null;
  });
  // A macro FILE's dialog reads the file LIVE from the gateway's list, the
  // same rule: a save from any client is what it shows and binds to; a
  // deleted file runs nothing.
  const dialogFile = computed<MacroFile | null>(() => {
    const d = macroParamDialog.value;
    void macroFolder.value;   // re-evaluate when the list changes
    return d && d.kind === "file" ? macroFileByName(d.macroId) : null;
  });
  /** Why the dialog's Execute may not run its file now, or null. */
  const dialogFileBlock = computed<string | null>(() => {
    const f = dialogFile.value;
    if (macroParamDialog.value?.kind !== "file") return null;
    return f ? macroRunBlock(f, macroEditorBasis.value) : "Macro removed — nothing to run";
  });
  watch(() => dialogFile.value?.params, params => {
    const d = macroParamDialog.value;
    if (!d || !params) return;
    for (const p of params) if (!(p.key in d.values)) d.values[p.key] = String(p.default);
    for (const k of Object.keys(d.values)) if (!params.some(p => p.key === k)) delete d.values[k];
  });
  watch(() => dialogFile.value?.title, t => { if (t && macroParamDialog.value?.kind === "file") macroParamDialog.value.name = t; });
  // A changed parameter set: entered values stay, a new parameter shows its
  // default, a dropped one leaves — never a literal `{name}` in the command.
  watch(() => dialogMacro.value?.params, params => {
    const d = macroParamDialog.value;
    if (!d || !params) return;
    for (const p of params) if (!(p.name in d.values)) d.values[p.name] = p.default;
    for (const k of Object.keys(d.values)) if (!params.some(p => p.name === k)) delete d.values[k];
  });
  watch(() => dialogMacro.value?.name, n => { if (n && macroParamDialog.value) macroParamDialog.value.name = n; });

  // Setter that App.vue exposes via provide("updateMacros") so SettingsPanel
  // can push edits back into our local copy. Returned (rather than provided
  // from inside the composable) because the provide call in App.vue must
  // run during setup, before the child SettingsPanel mounts.
  function updateMacros(macros: MacroDef[]) {
    userMacros.value = macros;
  }

  function substituteMacro(command: string, values: Record<string, string>): string {
    let cmd = command;
    for (const [key, val] of Object.entries(values)) cmd = cmd.split(`{${key}}`).join(val);
    return cmd;
  }

  function confirmMacroParams() {
    const d = macroParamDialog.value;
    if (d?.kind === "file") {
      const f = dialogFile.value;
      if (!f || dialogFileBlock.value) return;
      // numbers as entered; the gateway checks them against the header
      opts.fire({ cmd: "run_macro", name: f.name, revision: f.revision,
                  args: f.params.map(p => Number(d.values[p.key])) }, 'probe');
      macroParamDialog.value = null;
      return;
    }
    const m = dialogMacro.value;
    if (!d || !m) return;
    opts.fire({ cmd: "mdi", text: substituteMacro(m.command, d.values) }, 'probe');
    macroParamDialog.value = null;
  }

  /** What a hold on a macro is bound to (MachineBtn holdKey): the macro and
   *  its REVISION — the command and the parameter set — so a revision saved
   *  during the hold cancels it and the next hold runs the new one (UI-D02). */
  function macroHoldKey(macro: MacroDef): string {
    return `${macro.id}\n${JSON.stringify([macro.command, macro.params])}`;
  }
  /** The dialog's Execute: the LIVE macro's revision AND the entered values;
   *  a removed macro binds nothing (its Execute is disabled). */
  function macroExecuteKey(): string {
    const d = macroParamDialog.value;
    if (d?.kind === "file") {
      const f = dialogFile.value;
      return f ? `${fileHoldKey(f)}\n${JSON.stringify(d.values)}` : "";
    }
    const m = dialogMacro.value;
    return d && m ? `${macroHoldKey(m)}\n${JSON.stringify(d.values)}` : "";
  }

  function macroPreview(): string {
    const d = macroParamDialog.value;
    const m = dialogMacro.value;
    return d && m ? substituteMacro(m.command, d.values) : "";
  }

  /** A macro FILE from the bar or the Macros tab: with parameters a tap opens
   *  the dialog (no motion yet); without, a complete hold sends run_macro
   *  bound to the revision shown. */
  function runMacroFile(file: MacroFile) {
    if (macroRunBlock(file, macroEditorBasis.value)) return;
    if (file.params.length > 0) {
      const values: Record<string, string> = {};
      for (const p of file.params) values[p.key] = String(p.default);
      macroParamDialog.value = { kind: "file", macroId: file.name, name: file.title ?? file.name, values };
    } else {
      opts.fire({ cmd: "run_macro", name: file.name, revision: file.revision, args: [] }, 'probe');
    }
  }

  function runMacro(macro: MacroDef) {
    if (macro.params.length > 0) {
      const values: Record<string, string> = {};
      for (const p of macro.params) values[p.name] = p.default;
      macroParamDialog.value = { macroId: macro.id, name: macro.name, values };
    } else {
      // The button's own class (N95): a macro is gated `probe` in the
      // catalog, so the send checks `probe` too — it used to check `ready`.
      opts.fire({ cmd: "mdi", text: macro.command }, 'probe');
    }
  }

  return {
    userMacros,
    macroBarNames,
    macroParamDialog,
    dialogMacro,
    dialogFile,
    dialogFileBlock,
    runMacroFile,
    updateMacros,
    runMacro,
    confirmMacroParams,
    macroHoldKey,
    macroExecuteKey,
    macroPreview,
  };
}
