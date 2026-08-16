// useAxes — single source of truth for the machine's axis set (WS-D).
//
// The canonical axis list is `viewer_init.axes`: letters in motion-controller
// order, gateway-derived from the axis mask (up to 9: X Y Z A B C U V W).
// JOINT-ordered status arrays (work_pos, machine_pos, joint_pos,
// homed_joints) are index-aligned to it. The OFFSET vectors
// (g5x_offset, g92_offset, tool_offset) are CANONICAL 9-wide — X..W at
// fixed slots regardless of the machine's axis set; resolve them with
// "XYZABC".indexOf(letter), never with the joint index (on XYZBC, B is
// joint 3 but canonical slot 4 — mixing the layouts was the "Zero B does
// nothing" gateway bug).
//
// Components must NEVER assume positions ("Z is index 2") or keep local
// ABC/UVW letter sets — both patterns broke on machines whose axes aren't
// XYZ… in canonical order (lathe ["X","Z"], rotary-only trunnions). Resolve
// indices by letter via `indexOf`/`find`, group via `abc`/`uvw`/`primary`.
import { computed, type Ref } from "vue";

export interface AxisEntry {
  letter: string;
  index: number; // index into the axes array == index into per-axis status arrays
  kind: "linear" | "rotary";
}

export const PRIMARY_LETTERS: ReadonlySet<string> = new Set(["X", "Y", "Z"]);
export const ROTARY_LETTERS: ReadonlySet<string> = new Set(["A", "B", "C"]);
export const UVW_LETTERS: ReadonlySet<string> = new Set(["U", "V", "W"]);

/** A/B/C are rotary (degrees, 2 decimals); X/Y/Z/U/V/W are linear. */
export function isRotaryAxis(letter: string): boolean {
  return ROTARY_LETTERS.has(letter);
}

export function useAxes(axes: Ref<string[]>) {
  const entries = computed<AxisEntry[]>(() =>
    axes.value.map((letter, index) => ({
      letter,
      index,
      kind: isRotaryAxis(letter) ? "rotary" as const : "linear" as const,
    }))
  );

  /** X/Y/Z present on this machine, in machine order. */
  const primary = computed(() => entries.value.filter(a => PRIMARY_LETTERS.has(a.letter)));
  /** Rotary axes (A/B/C) — jog with angular velocity, format in degrees. */
  const abc = computed(() => entries.value.filter(a => ROTARY_LETTERS.has(a.letter)));
  /** Secondary linear axes (U/V/W). */
  const uvw = computed(() => entries.value.filter(a => UVW_LETTERS.has(a.letter)));
  /** Everything beyond X/Y/Z, in machine order (ABC + UVW interleaved as the machine orders them). */
  const extra = computed(() => entries.value.filter(a => !PRIMARY_LETTERS.has(a.letter)));
  const hasRotary = computed(() => abc.value.length > 0);

  /** Machine index of a letter, -1 when the machine lacks that axis. */
  function indexOf(letter: string): number {
    return axes.value.indexOf(letter);
  }

  function find(letter: string): AxisEntry | undefined {
    return entries.value.find(a => a.letter === letter);
  }

  return { entries, primary, abc, uvw, extra, hasRotary, indexOf, find };
}
