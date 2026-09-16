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

/** The target the operator saw while entering a value (U-03, review
 *  2026-09-14): the gateway refuses the touch-off when the live kinematics
 *  mode or fixture differs at confirm time — the value must never land on
 *  another target. Nulls = "no claim" for that dimension. */
export interface TouchoffExpect { kins_type: number | null; g5x_index: number | null }

/** The keypad's heading for a DRO touch-off: which axis, which frame, which
 *  datum the value will write ("Touch off Z · Plane · updates G54"). Pure. */
export function touchoffTargetLabel(
  letter: string,
  ctx: { kinsType: number | null | undefined; g5xLabel: string; twpActive?: boolean | null },
): string {
  const L = letter.toUpperCase();
  const k = ctx.kinsType == null || !Number.isFinite(ctx.kinsType) ? null : Math.round(ctx.kinsType);
  const fixture = ctx.g5xLabel || "fixture ?";
  if (k == null) return `Touch off ${L} · ${fixture}`;
  if (k === 0) return `Touch off ${L} · Machine · ${fixture}`;
  if (k === 1) return `Touch off ${L} · TCP · ${fixture}`;
  if (k === 2) return ctx.twpActive ? `Touch off ${L} · Plane · updates G54` : `Touch off ${L} · TOOL kins, no plane`;
  return `Touch off ${L} · kins ${k} · ${fixture}`;
}

export function useTouchoffMath(opts: UseTouchoffMathOptions) {
  function _fireTouchoff(axes: Record<string, number>, expect?: TouchoffExpect) {
    const letters = Object.keys(axes);
    if (!letters.length) return;
    opts.fire({ cmd: "touchoff", axes, ...(expect ? { expect } : {}) }, touchoffGate(letters));
  }

  function setAxis(axis: number, value: number = 0, expect?: TouchoffExpect) {
    // Resolve through the MACHINE's axis list, not the canonical letter
    // string: on a lathe ["X","Z"], index 1 is Z.
    const axisName = opts.axes.value[axis];
    if (!axisName) return;
    _fireTouchoff({ [axisName.toUpperCase()]: value }, expect);
  }

  /** Zero the given letters (default: every configured axis) in ONE command. */
  function setAll(letters?: readonly string[], expect?: TouchoffExpect) {
    const want = letters ?? opts.axes.value;
    const axes: Record<string, number> = {};
    for (const l of want) {
      if (opts.axes.value.includes(l)) axes[l.toUpperCase()] = 0;
    }
    _fireTouchoff(axes, expect);
  }

  function setG5x(gcode: string) {
    opts.fire({ cmd: "mdi", text: gcode }, 'probe');
  }

  return { setAxis, setAll, setG5x };
}
