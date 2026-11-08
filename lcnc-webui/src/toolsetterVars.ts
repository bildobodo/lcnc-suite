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

/** App's gated M600 job (the toolsetter set up; the gateway applies the
 *  values IT holds, then `T<tool> M600` — settings split package 3) for the
 *  components that start one — the tool table's load. `tool` 0 = unload. */
export type ToolsetterJob = (label: string, tool: number) => Promise<boolean>;
export const TOOLSETTER_JOB_KEY = Symbol("toolsetterJob") as InjectionKey<ToolsetterJob>;
export function useToolsetterJob(): ToolsetterJob {
  const fn = inject(TOOLSETTER_JOB_KEY);
  if (!fn) throw new Error("useToolsetterJob() called without provider — App.vue provides TOOLSETTER_JOB_KEY");
  return fn;
}
