// A finding the operator navigated to on a hidden layer (fixed palette P3,
// Codex R29/R30 VP29-04): the path is shown for it WITHOUT touching the
// stored layer choice — a LOCAL state the viewer names ("… shown for this
// finding"). A new finding replaces it; a manual scrub, the end of the
// simulation, a program change or a CHANGED choice of the toolpath or Rapids
// layer (here or from another client — never a settings refresh that
// re-applies the same value, Codex R31 VP-I01) end it, and the stored choice
// stands again as it is (never "restored" over a choice the operator changed
// meanwhile). Same pattern as simMode.ts: client-local shared state.
import { shallowRef } from "vue";

export interface PathReveal {
  /** The toolpath layer is off: the whole path shown for the finding. */
  toolpath: boolean;
  /** The finding sits on a rapid and the Rapids layer is off. */
  rapids: boolean;
}

export const pathReveal = shallowRef<PathReveal | null>(null);

/** What a finding needs shown, given where it sits and the stored layers;
 *  null = nothing it needs is hidden. Pure. */
export function revealFor(onRapid: boolean, layers: { toolpath: boolean; rapids: boolean }): PathReveal | null {
  const r: PathReveal = { toolpath: !layers.toolpath, rapids: onRapid && !layers.rapids };
  return r.toolpath || r.rapids ? r : null;
}

/** The viewer's line naming the state; null when none. */
export function revealText(r: PathReveal | null): string | null {
  if (!r) return null;
  const what = r.toolpath && r.rapids ? "Toolpath and rapids" : r.toolpath ? "Toolpath" : "Rapids";
  return `${what} shown for this finding — hidden in Layers`;
}
