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

/** The open parameter dialog: WHICH macro (by id — the macro itself is read
 *  live from the list, never copied), its name when it opened (the title
 *  once the macro is removed) and the entered values. */
export interface MacroParamDialogState {
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
  const macroParamDialog = ref<MacroParamDialogState | null>(null);

  // Cross-client sync: another tab saved macros → settingsVersion bumps
  // → re-read the shared store.
  watch(settingsVersion, () => {
    userMacros.value = loadMacrosDefaults().macros;
  });

  // The dialog's macro, LIVE: a revision saved while the dialog is open (by
  // another client or in Settings) is what it shows, previews, binds the
  // Execute hold to and runs — it used to keep a copy and ran the old
  // command (implementation review round 4, UI-DI08). null = removed.
  const dialogMacro = computed<MacroDef | null>(() => {
    const d = macroParamDialog.value;
    return d ? userMacros.value.find(m => m.id === d.macroId) ?? null : null;
  });
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
    const m = dialogMacro.value;
    return d && m ? `${macroHoldKey(m)}\n${JSON.stringify(d.values)}` : "";
  }

  function macroPreview(): string {
    const d = macroParamDialog.value;
    const m = dialogMacro.value;
    return d && m ? substituteMacro(m.command, d.values) : "";
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
    macroParamDialog,
    dialogMacro,
    updateMacros,
    runMacro,
    confirmMacroParams,
    macroHoldKey,
    macroExecuteKey,
    macroPreview,
  };
}
