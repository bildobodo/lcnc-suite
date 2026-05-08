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

import { ref, watch } from "vue";
import { loadMacrosDefaults, settingsVersion, type MacroDef } from "./defaults";
import type { Permissions } from "./permissions";

export interface MacroParamDialogState {
  macro: MacroDef;
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
    if (!macroParamDialog.value) return;
    opts.fire(
      { cmd: "mdi", text: substituteMacro(macroParamDialog.value.macro.command, macroParamDialog.value.values) },
      'ready',
    );
    macroParamDialog.value = null;
  }

  function macroPreview(): string {
    if (!macroParamDialog.value) return "";
    return substituteMacro(macroParamDialog.value.macro.command, macroParamDialog.value.values);
  }

  function runMacro(macro: MacroDef) {
    if (macro.params.length > 0) {
      const values: Record<string, string> = {};
      for (const p of macro.params) values[p.name] = p.default;
      macroParamDialog.value = { macro, values };
    } else {
      opts.fire({ cmd: "mdi", text: macro.command }, 'ready');
    }
  }

  return {
    userMacros,
    macroParamDialog,
    updateMacros,
    runMacro,
    confirmMacroParams,
    macroPreview,
  };
}
