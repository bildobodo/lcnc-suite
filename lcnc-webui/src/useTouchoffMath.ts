// Touch-off from the DRO inputs / Zero buttons, extracted from App.vue.
//
// Every touch-off is the gateway's `touchoff` command, never a client-built
// `G10 L20 P0` MDI (2026-08-30). The gateway decides the route from the
// kins mode × active fixture (command_policy.touchoff_route): a plain G10
// L20 into G54–G58, or — in Plane mode — the TWP remap that transforms the
// touched point back through the plane and writes G54. It also adds the
// comp eoffset back on Z (refusing when the reader has not delivered it,
// rather than treating it as 0) and stamps W1 provenance from the resulting
// row. The client's only job is to name the letters and pick the gate class:
// rotary letters are `touchoffRotary` (Machine frame + G54 only), linear
// letters `touchoff`.

import type { ComputedRef } from "vue";
import type { Permissions } from "./permissions";
import { isRotaryAxis } from "./useAxes";

interface UseTouchoffMathOptions {
  /** Axis letters in motion-controller order (e.g. ["X","Y","Z"]). */
  axes: ComputedRef<string[]>;
  /** Permission-gated send wrapper from App.vue. */
  fire: (payload: any, gate?: keyof Permissions, cooldownMs?: number) => void;
}

/** The gate class a touch-off of `letters` needs: rotary if ANY letter is
 *  rotary (the stricter rule wins for a mixed request). */
export function touchoffGate(letters: readonly string[]): keyof Permissions {
  return letters.some((l) => isRotaryAxis(l)) ? "touchoffRotary" : "touchoff";
}

export function useTouchoffMath(opts: UseTouchoffMathOptions) {
  function _fireTouchoff(axes: Record<string, number>) {
    const letters = Object.keys(axes);
    if (!letters.length) return;
    opts.fire({ cmd: "touchoff", axes }, touchoffGate(letters));
  }

  function setAxis(axis: number, value: number = 0) {
    // Resolve through the MACHINE's axis list, not the canonical letter
    // string: on a lathe ["X","Z"], index 1 is Z.
    const axisName = opts.axes.value[axis];
    if (!axisName) return;
    _fireTouchoff({ [axisName.toUpperCase()]: value });
  }

  /** Zero the given letters (default: every configured axis) in ONE command. */
  function setAll(letters?: readonly string[]) {
    const want = letters ?? opts.axes.value;
    const axes: Record<string, number> = {};
    for (const l of want) {
      if (opts.axes.value.includes(l)) axes[l.toUpperCase()] = 0;
    }
    _fireTouchoff(axes);
  }

  function setG5x(gcode: string) {
    opts.fire({ cmd: "mdi", text: gcode }, 'probe');
  }

  return { setAxis, setAll, setG5x };
}
