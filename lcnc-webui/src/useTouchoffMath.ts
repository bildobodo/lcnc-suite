// Touch-off math + Z-eoffset compensation, extracted from App.vue.
//
// Z touchoff has to add the current external Z offset back into the G5x
// value so the WCS doesn't absorb the comp eoffset. If eoffset_z hasn't
// yet been delivered by status (cold start, reader stale), treating it
// as 0 silently corrupts the WCS Z. The helper refuses to fire and lets
// the readerStale banner explain the wait. Only blocks when the value
// is genuinely missing — a real 0 is fine.

import type { ComputedRef, Ref } from "vue";
import type { Permissions } from "./permissions";

const AXIS_LETTERS = "XYZABCUVW";

interface UseTouchoffMathOptions {
  /** Axis letters in motion-controller order (e.g. ["X","Y","Z"]). */
  axes: ComputedRef<string[]>;
  /** Live status ref. We only read st.value.eoffset_z. */
  st: Ref<{ eoffset_z?: number;[key: string]: any }>;
  /** Permission-gated send wrapper from App.vue. */
  fire: (payload: any, gate?: keyof Permissions, cooldownMs?: number) => void;
}

export function useTouchoffMath(opts: UseTouchoffMathOptions) {
  function _eoffsetZForTouchoff(): number | null {
    const v = opts.st.value.eoffset_z;
    return (typeof v === "number" && Number.isFinite(v)) ? v : null;
  }

  function setAxis(axis: number, value: number = 0) {
    const axisName = AXIS_LETTERS[axis];
    if (!axisName) return;

    let val = value;
    if (axis === 2) {
      const eoffsetZ = _eoffsetZForTouchoff();
      if (eoffsetZ === null) {
        console.warn("touchoff Z refused: eoffset_z not yet delivered by gateway");
        return;
      }
      val += eoffsetZ;
    }
    opts.fire({ cmd: "mdi", text: `G10 L20 P0 ${axisName}${val.toFixed(6)}` }, 'probe');
  }

  function setAll(values: number[] = []) {
    const needsZ = opts.axes.value.some(letter => letter === "Z");
    let eoffsetZ = 0;
    if (needsZ) {
      const v = _eoffsetZForTouchoff();
      if (v === null) {
        console.warn("touchoff (all axes) refused: eoffset_z not yet delivered by gateway");
        return;
      }
      eoffsetZ = v;
    }
    const parts = opts.axes.value.map((letter, i) => {
      let val = values[i] ?? 0;
      if (letter === "Z") val += eoffsetZ;
      return `${letter}${val.toFixed(6)}`;
    });
    opts.fire({ cmd: "mdi", text: `G10 L20 P0 ${parts.join(" ")}` }, 'probe');
  }

  function setG5x(gcode: string) {
    opts.fire({ cmd: "mdi", text: gcode }, 'probe');
  }

  return { setAxis, setAll, setG5x };
}
