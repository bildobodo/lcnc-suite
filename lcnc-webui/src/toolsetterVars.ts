import { inject, type InjectionKey } from "vue";
import { confirmedSection, serverSettingsReady } from "./defaults";
import { toolsetterSetup, TOOLSETTER_PENDING_REASON, type ToolsetterSetup } from "./toolsetterSetup";

export {
  TOOLSETTER_REQUIRED, TOOLSETTER_UNSET_REASON, TOOLSETTER_INVALID_REASON, TOOLSETTER_PENDING_REASON,
  toolsetterSetup, toolsetterVarMap, type ToolsetterSetup,
} from "./toolsetterSetup";

/** The verdict on the server-confirmed section; reactive (settingsVersion). */
export function confirmedToolsetter(): ToolsetterSetup {
  if (!serverSettingsReady.value) {
    return { ok: false, reason: TOOLSETTER_PENDING_REASON, missing: [], invalid: [] };
  }
  return toolsetterSetup(confirmedSection("toolsetter"));
}

/** App's gated M600 path (toolsetter set up, its values taken over, then the
 *  MDI) for the components that start one — the tool table's load. */
export type ToolsetterMdi = (label: string, line: string) => Promise<boolean>;
export const TOOLSETTER_MDI_KEY = Symbol("toolsetterMdi") as InjectionKey<ToolsetterMdi>;
export function useToolsetterMdi(): ToolsetterMdi {
  const fn = inject(TOOLSETTER_MDI_KEY);
  if (!fn) throw new Error("useToolsetterMdi() called without provider — App.vue provides TOOLSETTER_MDI_KEY");
  return fn;
}
